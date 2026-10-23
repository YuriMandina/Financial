import unittest
from datetime import date, timedelta

from services.rh_contracts import (
    SYSTEM_TEMPLATES, parse_days, validate_contract_days, default_regimes, regime_on, days_summary_label
)
from services.rh_ledger import DayInput, LedgerSettings, build_ledger
from services.rh_engine import compute_raw_minutes

# Contrato padrão: 8h (07:00–12:00 / 13:00–16:00) seg, ter, qui, sex, sáb; quarta 07:00–11:00; DSR domingo
CONTRACT_44 = parse_days(next(t for t in SYSTEM_TEMPLATES if t["code"] == "44H_6X1_QUA")["days"])
CONTRACT_40 = parse_days(next(t for t in SYSTEM_TEMPLATES if t["code"] == "40H_5X2")["days"])

MON = date(2026, 10, 5)  # Semana de 05/10 (seg) a 11/10 (dom)


def work(d, start="07:00", end="16:00", lunch=("12:00", "13:00"), decision=None):
    ls, le = lunch if lunch else (None, None)
    return DayInput(d, "TRABALHO", start, ls, le, end, compute_raw_minutes(start, ls, le, end), decision)


def rest(d, status="DSR"):
    return DayInput(d, status)


def contract_week(contract=CONTRACT_44, monday=MON):
    """Semana cumprida exatamente conforme o contrato."""
    days = []
    for i in range(7):
        d = monday + timedelta(days=i)
        cd = contract[d.weekday()]
        if cd.is_work:
            lunch = (cd.lunch_start, cd.lunch_end) if cd.lunch_start else None
            days.append(work(d, cd.start, cd.end, lunch))
        else:
            days.append(rest(d, cd.rest))
    return days


def replace(days, new):
    by_date = {d.date: d for d in days}
    for n in new:
        by_date[n.date] = n
    return list(by_date.values())


def ledger(days, contract=CONTRACT_44, holidays=None, **settings):
    return build_ledger(days, lambda d: contract[d.weekday()], holidays or set(), LedgerSettings(**settings))


class TestLedgerDaily(unittest.TestCase):

    def test_week_as_contract_has_no_overtime(self):
        led = ledger(contract_week())
        self.assertEqual(sum(dl.extra_min for dl in led.values()), 0)
        self.assertEqual(sum(dl.short_min for dl in led.values()), 0)
        self.assertEqual(led[MON].contracted_min, 480)
        self.assertEqual(led[MON + timedelta(days=2)].contracted_min, 240)

    def test_monday_half_hour_longer_is_daily_overtime(self):
        led = ledger(replace(contract_week(), [work(MON, end="16:30")]))
        self.assertEqual(led[MON].extra_min, 30)
        self.assertEqual(led[MON].extra_kind, "DIARIA")

    def test_wednesday_8h_without_reduction_is_4h_overtime(self):
        wed = MON + timedelta(days=2)
        led = ledger(replace(contract_week(), [work(wed)]))
        self.assertEqual(led[wed].extra_min, 240)

    def test_reduced_day_swapped_within_period_has_no_overtime(self):
        wed, fri = MON + timedelta(days=2), MON + timedelta(days=4)
        led = ledger(replace(contract_week(), [work(wed), work(fri, end="11:00", lunch=None)]))
        self.assertEqual(led[wed].extra_min, 0)
        self.assertEqual(led[wed].compensated_min, 240)
        self.assertEqual(led[fri].short_min, 0)

    def test_without_compensation_regime_swap_generates_extra_and_debit(self):
        wed, fri = MON + timedelta(days=2), MON + timedelta(days=4)
        led = ledger(replace(contract_week(), [work(wed), work(fri, end="11:00", lunch=None)]),
                     compensation_regime="BANK_6M")
        self.assertEqual(led[wed].extra_min, 240)
        self.assertEqual(led[fri].short_min, 240)

    def test_day_above_10h_is_never_compensated(self):
        tue, thu = MON + timedelta(days=1), MON + timedelta(days=3)
        led = ledger(replace(contract_week(), [work(tue, end="18:30"), work(thu, end="13:30")]))
        self.assertEqual(led[tue].worked_min, 630)
        self.assertEqual(led[tue].extra_min, 150)
        self.assertEqual(led[thu].short_min, 150)

    def test_folga_bh_consumes_contracted_hours(self):
        led = ledger(replace(contract_week(), [rest(MON, "FOLGA_BH")]))
        self.assertEqual(led[MON].short_min, 480)


class TestLedgerRestSwap(unittest.TestCase):

    def test_sunday_worked_with_day_off_in_same_week_has_no_double(self):
        thu, sun = MON + timedelta(days=3), MON + timedelta(days=6)
        led = ledger(replace(contract_week(), [rest(thu, "DSR"), work(sun)]))
        self.assertEqual(led[sun].extra_min, 0)
        self.assertFalse(led[sun].rest_worked_unpaid_double)
        self.assertEqual(led[sun].rest_swap_with, thu)
        self.assertEqual(led[thu].reduction_min, 0)

    def test_sunday_worked_without_day_off_is_overtime_paid_double(self):
        sun = MON + timedelta(days=6)
        led = ledger(replace(contract_week(), [work(sun)]))
        self.assertEqual(led[sun].extra_min, 480)
        self.assertTrue(led[sun].rest_worked_unpaid_double)

    def test_holiday_worked_without_compensation_is_paid_double(self):
        led = ledger(contract_week(), holidays={MON})
        self.assertEqual(led[MON].contracted_min, 0)
        self.assertEqual(led[MON].extra_min, 480)
        self.assertTrue(led[MON].rest_worked_unpaid_double)

    def test_5x2_folga_worked_without_swap_is_overtime_not_double(self):
        wed = MON + timedelta(days=2)
        led = ledger(replace(contract_week(CONTRACT_40), [work(wed)]), contract=CONTRACT_40)
        self.assertEqual(led[wed].extra_min, 480)
        self.assertFalse(led[wed].rest_worked_unpaid_double)


class TestLedgerToleranceAndLateness(unittest.TestCase):

    def test_legal_tolerance_ignores_small_variations(self):
        led = ledger(replace(contract_week(), [work(MON, start="07:04", end="16:03")]))
        self.assertEqual(led[MON].extra_min, 0)
        self.assertEqual(led[MON].short_min, 0)

    def test_variation_above_tolerance_counts_entirely(self):
        led = ledger(replace(contract_week(), [work(MON, end="16:12")]), compensation_regime="BANK_6M")
        self.assertEqual(led[MON].extra_min, 12)

    def test_late_compensated_by_leaving_later_within_limits(self):
        led = ledger(replace(contract_week(), [work(MON, start="07:15", end="16:15")]))
        self.assertEqual(led[MON].late_compensated_min, 15)
        self.assertEqual(led[MON].extra_min, 0)
        self.assertEqual(led[MON].short_min, 0)

    def test_late_above_limit_becomes_pending_and_is_treated_normally(self):
        led = ledger(replace(contract_week(), [work(MON, start="07:40", end="16:40")]))
        self.assertTrue(led[MON].late_pending_decision)
        self.assertEqual(led[MON].short_min, 40)
        self.assertEqual(led[MON].extra_min, 40)

    def test_employer_accepts_late_compensation(self):
        led = ledger(replace(contract_week(), [work(MON, start="07:40", end="16:40", decision="ACEITAR_COMPENSACAO")]))
        self.assertFalse(led[MON].late_pending_decision)
        self.assertEqual(led[MON].extra_min, 0)
        self.assertEqual(led[MON].short_min, 0)

    def test_monthly_limit_of_automatic_late_compensations(self):
        days = []
        for w in range(2):
            days += replace(contract_week(monday=MON + timedelta(days=7 * w)), [])
        lates = [d for d in sorted(x.date for x in days) if d.weekday() in (0, 1, 3)][:5]
        days = replace(days, [work(d, start="07:10", end="16:10") for d in lates])
        led = ledger(days, late_compensation_max_per_month=4)
        self.assertEqual(sum(1 for d in lates if led[d].late_compensated_min), 4)
        self.assertTrue(led[lates[-1]].late_pending_decision)

    def test_late_waiver(self):
        led = ledger(replace(contract_week(), [work(MON, start="07:20")]), compensation_regime="BANK_6M",
                     late_waiver_auto_min=20)
        self.assertEqual(led[MON].late_waived_min, 20)
        self.assertEqual(led[MON].short_min, 0)

    def test_late_mode_off_never_compensates(self):
        led = ledger(replace(contract_week(), [work(MON, start="07:15", end="16:15")]), late_compensation_mode="OFF")
        self.assertTrue(led[MON].late_pending_decision)
        self.assertEqual(led[MON].short_min, 15)


class TestLedgerWeeklyLimitAndRegimes(unittest.TestCase):

    def test_regimes_start_on_monday(self):
        regimes = default_regimes()
        self.assertEqual(regime_on(regimes, date(2026, 12, 13)).weekly_limit_min, 44 * 60)
        self.assertEqual(regime_on(regimes, date(2026, 12, 14)).weekly_limit_min, 42 * 60)
        self.assertEqual(regime_on(regimes, date(2027, 12, 13)).weekly_limit_min, 40 * 60)

    def test_44h_contract_in_42h_regime_week_generates_weekly_overtime(self):
        monday = date(2026, 12, 14)
        led = ledger(contract_week(monday=monday), compensation_regime="BANK_6M")
        sat = monday + timedelta(days=5)
        self.assertEqual(sum(dl.extra_min for dl in led.values()), 120)
        self.assertEqual(led[sat].extra_weekly_min, 120)
        self.assertEqual(led[sat].extra_kind, "SEMANAL")


class TestContractValidation(unittest.TestCase):

    def test_system_templates_are_valid_in_their_regime(self):
        regimes = default_regimes()
        valid_on = {"44H_6X1_QUA": date(2026, 10, 1), "44H_5X2_COMP": date(2026, 10, 1),
                    "42H_5X2_COMP": date(2026, 12, 14), "40H_5X2": date(2027, 12, 13)}
        for t in SYSTEM_TEMPLATES:
            errors = validate_contract_days(parse_days(t["days"]), regime_on(regimes, valid_on[t["code"]]), True)
            self.assertEqual(errors, [], t["code"])

    def test_44h_contract_is_rejected_in_42h_regime(self):
        errors = validate_contract_days(CONTRACT_44, regime_on(default_regimes(), date(2026, 12, 14)), False)
        self.assertTrue(any("limite" in e for e in errors))

    def test_more_than_8h_requires_compensation_agreement(self):
        days = parse_days(next(t for t in SYSTEM_TEMPLATES if t["code"] == "44H_5X2_COMP")["days"])
        errors = validate_contract_days(days, default_regimes()[0], False)
        self.assertTrue(any("acordo de compensação" in e for e in errors))

    def test_short_interval_and_interjornada(self):
        raw = next(t for t in SYSTEM_TEMPLATES if t["code"] == "44H_6X1_QUA")["days"]
        bad = dict(raw)
        bad["0"] = {"start": "07:00", "lunch_start": "12:00", "lunch_end": "12:30", "end": "15:30"}
        bad["1"] = {"start": "05:00", "lunch_start": "09:00", "lunch_end": "10:00", "end": "14:00"}
        bad["5"] = {"start": "13:00", "lunch_start": "17:00", "lunch_end": "18:00", "end": "22:00"}
        errors = validate_contract_days(parse_days(bad), default_regimes()[0], False)
        self.assertTrue(any("intervalo de 1h a 2h" in e for e in errors))

    def test_summary_label(self):
        raw = next(t for t in SYSTEM_TEMPLATES if t["code"] == "44H_6X1_QUA")["days"]
        self.assertEqual(days_summary_label(raw), "44h (6x1 • qua 4h)")


if __name__ == "__main__":
    unittest.main()
