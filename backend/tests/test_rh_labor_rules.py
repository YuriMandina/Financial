import unittest
from datetime import date, timedelta
from types import SimpleNamespace

from services.rh_contracts import SYSTEM_TEMPLATES, contract_day_on, default_regimes, parse_days, weekly_minutes
from services.rh_engine import compute_raw_minutes
from services.rh_labor_rules import RuleContext, RuleDay, RulePolicy, bank_lots, evaluate
from services.rh_ledger import DayInput, LedgerSettings, build_ledger

TEMPLATES = {t["code"]: t["days"] for t in SYSTEM_TEMPLATES}
OCT = (date(2026, 10, 1), date(2026, 10, 31))


def contract(code="44H_6X1_QUA", valid_from=date(2026, 1, 1), cid=1, **kw):
    days = TEMPLATES[code]
    return SimpleNamespace(
        id=cid, valid_from=valid_from, valid_to=kw.get("valid_to"), days=days,
        weekly_min=weekly_minutes(parse_days(days)),
        overtime_agreement=kw.get("overtime_agreement", True),
        amendment_signed=kw.get("amendment_signed", True),
        change_reason=kw.get("change_reason", "ADMISSAO"),
    )


def work(d, start="07:00", end="16:00", lunch=("12:00", "13:00")):
    ls, le = lunch if lunch else (None, None)
    return DayInput(d, "TRABALHO", start, ls, le, end, compute_raw_minutes(start, ls, le, end))


def rest(d, status="DSR"):
    return DayInput(d, status)


def schedule_by_contract(contracts, start, end):
    """Dias preenchidos exatamente como o contrato."""
    days = {}
    d = start
    while d <= end:
        cd = contract_day_on(contracts, d)
        if cd and cd.is_work:
            days[d] = work(d, cd.start, cd.end, (cd.lunch_start, cd.lunch_end) if cd.lunch_start else None)
        else:
            days[d] = rest(d, cd.rest if cd else "FOLGA")
        d += timedelta(days=1)
    return days


def ctx_for(days, contracts=None, period=OCT, holidays=None, policy=None, **ledger_kw):
    contracts = contracts or [contract()]
    holidays = holidays or {}
    inputs = list(days.values()) if isinstance(days, dict) else days
    ledger = build_ledger(inputs, lambda d: contract_day_on(contracts, d), set(holidays),
                          LedgerSettings(**ledger_kw), default_regimes())
    return RuleContext(
        employee_id=1, employee_name="Alaelson",
        days={i.date: RuleDay(i.date, i.status, i.start_time, i.lunch_start, i.lunch_end, i.end_time, i.worked_minutes)
              for i in inputs},
        ledger=ledger, contracts=contracts, regimes=default_regimes(), holidays=holidays,
        period=period, policy=policy or RulePolicy(),
    )


def codes(ctx):
    return [v.code for v in evaluate(ctx)]


def base_october(contracts=None):
    contracts = contracts or [contract()]
    return schedule_by_contract(contracts, date(2026, 8, 24), date(2026, 10, 31))


class TestDailyRules(unittest.TestCase):

    def test_schedule_as_contract_has_no_irregularities(self):
        self.assertEqual(codes(ctx_for(base_october())), [])

    def test_r01_wednesday_8h_without_reduction(self):
        days = base_october()
        days[date(2026, 10, 14)] = work(date(2026, 10, 14))
        found = evaluate(ctx_for(days, compensation_regime="BANK_6M"))
        r01 = [v for v in found if v.code == "R01"]
        self.assertEqual(len(r01), 1)
        self.assertEqual(r01[0].severity, "CRITICA")
        self.assertIn("4h00 de hora extra", r01[0].cause)
        self.assertEqual(r01[0].fingerprint, "R01:1:2026-10-14")

    def test_r01_not_triggered_when_reduced_day_is_swapped(self):
        days = base_october()
        days[date(2026, 10, 14)] = work(date(2026, 10, 14))
        days[date(2026, 10, 16)] = work(date(2026, 10, 16), end="11:00", lunch=None)
        self.assertNotIn("R01", codes(ctx_for(days)))

    def test_r01_day_above_10h_even_if_compensated(self):
        days = base_october()
        days[date(2026, 10, 13)] = work(date(2026, 10, 13), end="18:30")
        days[date(2026, 10, 15)] = work(date(2026, 10, 15), end="13:30")
        self.assertIn("R01", codes(ctx_for(days)))

    def test_r10_intervals(self):
        days = base_october()
        days[date(2026, 10, 5)] = work(date(2026, 10, 5), end="15:59", lunch=("12:00", "12:59"))  # 59 min em 8h
        days[date(2026, 10, 6)] = work(date(2026, 10, 6), end="18:01", lunch=("12:00", "14:01"))  # 2h01
        days[date(2026, 10, 7)] = work(date(2026, 10, 7), end="12:14", lunch=("10:00", "10:14"))  # 14 min em 5h
        r10 = [v for v in evaluate(ctx_for(days)) if v.code == "R10"]
        self.assertEqual({v.dates[0].day for v in r10}, {5, 6, 7})

    def test_r08_interjornada(self):
        days = base_october()
        days[date(2026, 10, 19)] = work(date(2026, 10, 19), start="13:00", end="22:00", lunch=("17:00", "18:00"))
        r08 = [v for v in evaluate(ctx_for(days)) if v.code == "R08"]
        self.assertEqual(len(r08), 1)
        self.assertIn("9h00 de descanso", r08[0].cause)
        self.assertEqual(r08[0].dates, [date(2026, 10, 19), date(2026, 10, 20)])

    def test_r09_35h_around_dsr(self):
        days = base_october()
        days[date(2026, 10, 10)] = work(date(2026, 10, 10), start="13:00", end="22:00", lunch=("17:00", "18:00"))
        r09 = [v for v in evaluate(ctx_for(days)) if v.code == "R09"]
        self.assertEqual(len(r09), 1)
        self.assertIn("33h00", r09[0].cause)


class TestRestRules(unittest.TestCase):

    def test_r05_seventh_day_counted_across_months(self):
        days = base_october()
        days[date(2026, 10, 4)] = work(date(2026, 10, 4))  # domingo trabalhado sem folga
        r05 = [v for v in evaluate(ctx_for(days)) if v.code == "R05"]
        self.assertEqual(len(r05), 1)
        self.assertEqual(r05[0].dates[0], date(2026, 9, 28))
        self.assertEqual(r05[0].ref_date, date(2026, 10, 4))

    def test_sunday_swapped_with_day_off_has_no_r05_nor_double(self):
        # 6x1: o domingo trabalhado precisa de folga antes (sábado) e de outra antes do 7º dia seguinte
        days = base_october()
        days[date(2026, 10, 3)] = rest(date(2026, 10, 3))
        days[date(2026, 10, 4)] = work(date(2026, 10, 4))
        days[date(2026, 10, 8)] = rest(date(2026, 10, 8), "FOLGA")
        found = codes(ctx_for(days))
        self.assertNotIn("R05", found)
        self.assertNotIn("R11", found)

    def test_sunday_swapped_only_with_previous_thursday_still_breaks_seventh_day(self):
        days = base_october()
        days[date(2026, 10, 1)] = rest(date(2026, 10, 1))
        days[date(2026, 10, 4)] = work(date(2026, 10, 4))
        r05 = [v for v in evaluate(ctx_for(days)) if v.code == "R05"]
        self.assertEqual(len(r05[0].dates), 9)  # 02/10 a 10/10

    def test_r07_consecutive_sundays_across_months(self):
        days = base_october()
        for sun, off in ((date(2026, 9, 27), date(2026, 9, 24)), (date(2026, 10, 4), date(2026, 10, 1)),
                         (date(2026, 10, 11), date(2026, 10, 8))):
            days[sun] = work(sun)
            days[off] = rest(off)
        r07 = [v for v in evaluate(ctx_for(days)) if v.code == "R07"]
        self.assertEqual(len(r07), 1)
        self.assertEqual(r07[0].dates, [date(2026, 9, 27), date(2026, 10, 4), date(2026, 10, 11)])
        self.assertEqual(r07[0].ref_date, date(2026, 10, 11))

    def test_r11_holiday_worked_without_compensation(self):
        days = base_october()
        found = evaluate(ctx_for(days, holidays={date(2026, 10, 12): "Nossa Senhora Aparecida"}))
        r11 = [v for v in found if v.code == "R11"]
        self.assertEqual(len(r11), 1)
        self.assertEqual(r11[0].severity, "ALERTA")
        self.assertIn("Nossa Senhora Aparecida", r11[0].cause)

    def test_r06_rest_days_in_42h_regime(self):
        c = contract("40H_5X2")
        days = schedule_by_contract([c], date(2026, 11, 2), date(2026, 12, 31))
        days[date(2026, 12, 16)] = work(date(2026, 12, 16))  # folga de quarta trabalhada
        found = evaluate(ctx_for(days, [c], period=(date(2026, 12, 1), date(2026, 12, 31))))
        self.assertIn("R06", [v.code for v in found])

    def test_r13_absence_is_info(self):
        days = base_october()
        days[date(2026, 10, 6)] = DayInput(date(2026, 10, 6), "FALTA")
        r13 = [v for v in evaluate(ctx_for(days)) if v.code == "R13"]
        self.assertEqual(r13[0].severity, "INFO")


class TestWeeklyAndContractRules(unittest.TestCase):

    def test_r02_overtime_without_agreement_is_critical(self):
        c = contract("40H_5X2", overtime_agreement=False)
        days = schedule_by_contract([c], date(2026, 8, 24), date(2026, 10, 31))
        days[date(2026, 10, 7)] = work(date(2026, 10, 7))  # folga trabalhada: 48h na semana
        r02 = [v for v in evaluate(ctx_for(days, [c], compensation_regime="BANK_6M")) if v.code == "R02"]
        self.assertEqual(r02[0].severity, "CRITICA")

    def test_r02_with_agreement_is_alert(self):
        c = contract("40H_5X2", overtime_agreement=True)
        days = schedule_by_contract([c], date(2026, 8, 24), date(2026, 10, 31))
        days[date(2026, 10, 7)] = work(date(2026, 10, 7))
        r02 = [v for v in evaluate(ctx_for(days, [c], compensation_regime="BANK_6M")) if v.code == "R02"]
        self.assertEqual(r02[0].severity, "ALERTA")

    def test_r03_habitual_overtime(self):
        days = base_october()
        for d in (date(2026, 10, 5), date(2026, 10, 12), date(2026, 10, 19)):
            days[d] = work(d, end="17:00")
        r03 = [v for v in evaluate(ctx_for(days, compensation_regime="BANK_6M")) if v.code == "R03"]
        self.assertEqual(len(r03), 1)
        self.assertEqual(r03[0].severity, "ALERTA")

    def test_r04_44h_contract_in_42h_regime(self):
        c = contract()
        days = schedule_by_contract([c], date(2026, 11, 2), date(2026, 12, 31))
        r04 = [v for v in evaluate(ctx_for(days, [c], period=(date(2026, 12, 1), date(2026, 12, 31)))) if v.code == "R04"]
        self.assertEqual(len(r04), 1)
        self.assertEqual(r04[0].ref_date, date(2026, 12, 14))

    def test_r14_amendment(self):
        first = contract(valid_from=date(2026, 1, 1), valid_to=date(2026, 9, 30), cid=1)
        changed = contract("44H_6X1_QUA", valid_from=date(2026, 10, 1), cid=2, change_reason="ACORDO", amendment_signed=False)
        days = base_october([first, changed])
        r14 = [v for v in evaluate(ctx_for(days, [first, changed])) if v.code == "R14"]
        self.assertEqual(r14[0].severity, "CRITICA")

        changed.change_reason = "ADEQUACAO_LEGAL"
        r14 = [v for v in evaluate(ctx_for(days, [first, changed])) if v.code == "R14"]
        self.assertEqual(r14[0].severity, "ALERTA")

        changed.amendment_signed = True
        self.assertNotIn("R14", codes(ctx_for(days, [first, changed])))

    def test_violation_dict_has_legal_texts(self):
        days = base_october()
        days[date(2026, 10, 14)] = work(date(2026, 10, 14))
        v = [x for x in evaluate(ctx_for(days, compensation_regime="BANK_6M")) if x.code == "R01"][0].to_dict()
        for key in ("legal_basis", "financial_consequence", "administrative_consequence", "cause", "evidence", "suggestion"):
            self.assertTrue(v[key], key)
        self.assertIn("art. 75", v["administrative_consequence"])
        self.assertIn("Pagar o valor devido não afasta", v["administrative_footer"])


class TestBankExpiry(unittest.TestCase):

    def _r12(self, lots, validity, period):
        ctx = ctx_for(base_october(), period=period)
        ctx.bank_lots, ctx.bank_validity_months = lots, validity
        return [v for v in evaluate(ctx) if v.code == "R12"]

    def test_monthly_compensation_expires_at_month_end(self):
        lots = bank_lots([(date(2026, 10, 1), 240)], 1)
        self.assertEqual(lots[0].expiry, date(2026, 10, 31))
        r12 = self._r12(lots, 1, OCT)
        self.assertEqual(r12[0].severity, "CRITICA")
        self.assertIn("mesmo mês", r12[0].cause)

    def test_six_month_bank_alerts_then_expires(self):
        lots = bank_lots([(date(2026, 10, 1), 240)], 6)
        self.assertEqual(lots[0].expiry, date(2027, 3, 31))
        alert = self._r12(lots, 6, (date(2027, 2, 1), date(2027, 2, 28)))
        self.assertEqual(alert[0].severity, "ALERTA")
        expired = self._r12(lots, 6, (date(2027, 3, 1), date(2027, 3, 31)))
        self.assertEqual(expired[0].severity, "CRITICA")
        self.assertNotEqual(alert[0].fingerprint, expired[0].fingerprint)

    def test_debits_consume_oldest_credit_first(self):
        lots = bank_lots([(date(2026, 9, 1), 120), (date(2026, 10, 1), 240), (date(2026, 11, 1), -180)], 6)
        self.assertEqual([lot.remaining for lot in lots], [0, 180])

    def test_compensated_balance_has_no_r12(self):
        lots = bank_lots([(date(2026, 10, 1), 240), (date(2026, 10, 1), -240)], 1)
        self.assertEqual(self._r12(lots, 1, OCT), [])


if __name__ == "__main__":
    unittest.main()
