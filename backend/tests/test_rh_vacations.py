import unittest
from datetime import date
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models import models
from services.rh_payroll_service import calc_inss, calc_irrf, calculate_payroll, ensure_system_items, get_payroll_month
from services.rh_vacation_service import (
    apply_to_schedule, build_overview, calculate_vacation_pay, entitlement_for_absences,
    revert_from_schedule, settle_periods, validate_vacation,
)

TODAY = date(2026, 11, 5)
P1 = date(2024, 3, 4)  # 1º período aquisitivo: 04/03/2024 a 03/03/2025 (concessivo até 03/03/2026)
P2 = date(2025, 3, 4)  # 2º período aquisitivo: 04/03/2025 a 03/03/2026 (concessivo até 03/03/2027)


class TestVacations(unittest.TestCase):
    """Férias: períodos, regras de programação da CLT, recibo e marcação na escala."""

    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        needed = [
            models.Organization, models.RHRole, models.RHEmployee, models.RHEmployeeContract,
            models.RHLegalRegime, models.RHContractTemplate, models.RHTeam,
            models.RHMonthlySchedule, models.RHWorkDay, models.RHWorkDayChange, models.RHRestWorkDecision,
            models.RHSettings, models.RHBenefitAdjustment, models.RHPayrollItem, models.RHPayrollEntry,
            models.RHSalaryChange, models.RHBankHours, models.RHBankHoursEntry, models.RHSalaryAdvance,
            models.RHVacation, models.RHVacationSettlement,
        ]
        models.Base.metadata.create_all(engine, tables=[m.__table__ for m in needed])
        self.db = sessionmaker(bind=engine)()
        org = models.Organization(name="Org Teste")
        self.db.add(org)
        self.db.flush()
        self.org_id = org.id
        self.db.add(models.RHSettings(organization_id=org.id))
        role = models.RHRole(organization_id=org.id, name="Açougueiro", base_salary=3000.0)
        self.db.add(role)
        self.db.flush()
        self.emp = models.RHEmployee(
            organization_id=org.id, name="Fulano", role_id=role.id, dependents=0, admission_date=P1,
            weekly_contract_hours=40.0, work_days_per_week=5,
            default_daily_transport_tickets=0, daily_meal_cost=0, active=True
        )
        self.db.add(self.emp)
        self.db.flush()
        # Contrato 40h: 8h de segunda a sexta, folga no sábado e DSR no domingo
        eight = {"start": "07:00", "lunch_start": "12:00", "lunch_end": "13:00", "end": "16:00"}
        days = {str(wd): eight for wd in range(5)}
        days.update({"5": {"rest": "FOLGA"}, "6": {"rest": "DSR"}})
        self.db.add(models.RHEmployeeContract(employee_id=self.emp.id, valid_from=P1, days=days, weekly_min=2400))
        self.db.commit()

        self.holidays = {}
        targets = ("services.rh_vacation_service.get_effective_holidays_map",
                   "services.rh_ledger.get_effective_holidays_map",
                   "services.rh_payroll_service.get_effective_holidays_map")
        for target in targets:
            p = patch(target, side_effect=lambda db, org, y, m=None: {
                k: v for k, v in self.holidays.items() if k.startswith(f"{y:04d}-{m:02d}" if m else f"{y:04d}")
            })
            p.start()
            self.addCleanup(p.stop)

    # ------------------------------------------------------------------ helpers

    def _check(self, start, days, abono=0, period=P2, payment=None):
        return validate_vacation(self.db, self.org_id, self.emp, period, start, days, abono, payment, today=TODAY)

    def _add(self, start, days, abono=0, period=P2, status="PROGRAMADA"):
        end = date(period.year + 1, period.month, period.day - 1)
        v = models.RHVacation(organization_id=self.org_id, employee_id=self.emp.id, acquisition_start=period,
                              acquisition_end=end, start_date=start, days=days, abono_days=abono, status=status)
        self.db.add(v)
        self.db.commit()
        return v

    def _schedule(self, year, month, status="DRAFT"):
        s = models.RHMonthlySchedule(organization_id=self.org_id, year=year, month=month, status=status)
        self.db.add(s)
        self.db.flush()
        return s

    def _day(self, schedule, day):
        return self.db.query(models.RHWorkDay).filter(
            models.RHWorkDay.schedule_id == schedule.id, models.RHWorkDay.employee_id == self.emp.id,
            models.RHWorkDay.day == day
        ).first()

    # ------------------------------------------------------------------ períodos

    def test_entitlement_by_absences(self):
        self.assertEqual([entitlement_for_absences(n) for n in (0, 5, 6, 14, 15, 23, 24, 32, 33)],
                         [30, 30, 24, 24, 18, 18, 12, 12, 0])

    def test_period_status(self):
        periods = build_overview(self.db, self.org_id, today=TODAY)["employees"][0]["periods"]
        self.assertEqual([p["status"] for p in periods], ["VENCIDO", "A_PROGRAMAR", "EM_AQUISICAO"])
        self.assertEqual(periods[1]["concessive_end"], "2027-03-03")
        self.assertEqual(periods[1]["latest_start"], "2027-02-02")

    def test_absences_reduce_entitlement_and_abono(self):
        s = self._schedule(2025, 6)
        for day in range(2, 8):  # 6 faltas
            self.db.add(models.RHWorkDay(schedule_id=s.id, employee_id=self.emp.id, day=day, status="FALTA"))
        self.db.commit()
        check = self._check(date(2026, 11, 9), 16, abono=8)
        self.assertEqual(check["errors"], [])
        self.assertEqual(check["period"]["entitled"], 24)
        check = self._check(date(2026, 11, 9), 15, abono=9)
        self.assertTrue(any("1/3" in e for e in check["errors"]))

    def test_settle_old_period_without_dates(self):
        res = settle_periods(self.db, self.org_id, [(self.emp.id, P1)], "Gozadas antes do sistema", None, today=TODAY)
        self.db.commit()
        self.assertEqual((res["created"], res["errors"]), (1, []))
        overview = build_overview(self.db, self.org_id, today=TODAY)
        p1 = overview["employees"][0]["periods"][0]
        self.assertEqual((p1["status"], p1["balance"]), ("REGULARIZADO", 0))
        self.assertEqual(p1["settlement"]["note"], "Gozadas antes do sistema")
        self.assertEqual(overview["summary"]["vencidos"], 0)
        # Repetir não duplica; período quitado não aceita programação
        self.assertEqual(settle_periods(self.db, self.org_id, [(self.emp.id, P1)], None, None, today=TODAY)["skipped"], 1)
        errors = self._check(date(2026, 11, 9), 30, period=P1)["errors"]
        self.assertTrue(any("quitado na regularização" in e for e in errors))

    def test_settle_rejects_period_in_acquisition(self):
        res = settle_periods(self.db, self.org_id, [(self.emp.id, date(2026, 3, 4))], None, None, today=TODAY)
        self.assertEqual(res["created"], 0)
        self.assertTrue(any("em aquisição" in e for e in res["errors"]))

    # ------------------------------------------------------------------ início vedado

    def test_start_on_rest_day_or_two_days_before(self):
        self.assertTrue(any("PN 100" in e for e in self._check(date(2026, 11, 8), 30)["errors"]))  # domingo
        self.assertTrue(any("134 §3º" in e for e in self._check(date(2026, 11, 13), 30)["errors"]))  # sexta
        self.assertEqual(self._check(date(2026, 11, 9), 30)["errors"], [])  # segunda
        self.holidays = {"2026-12-25": "Natal"}
        errors = self._check(date(2026, 12, 23), 30)["errors"]
        self.assertTrue(any("Natal" in e for e in errors))

    def test_start_before_acquisition_ends(self):
        errors = self._check(date(2026, 3, 2), 30, period=date(2026, 3, 4))["errors"]
        self.assertTrue(any("só se completa" in e for e in errors))

    # ------------------------------------------------------------------ fracionamento e abono

    def test_fraction_rules(self):
        self.assertTrue(any("mínimo 5" in e for e in self._check(date(2026, 11, 9), 4)["errors"]))
        # 10 + 10 deixaria 10 dias: nenhuma fração chegaria a 14
        self._add(date(2027, 1, 4), 10)
        self.assertTrue(any("14 dias" in e for e in self._check(date(2026, 11, 9), 10)["errors"]))
        # 10 + 15 + 5 = três frações válidas
        self.assertEqual(self._check(date(2026, 11, 9), 15)["errors"], [])
        self._add(date(2026, 11, 9), 15)
        self.assertEqual(self._check(date(2027, 2, 1), 5)["errors"], [])
        self._add(date(2027, 2, 1), 5)
        self.assertTrue(any("restam 0" in e for e in self._check(date(2027, 2, 15), 5)["errors"]))

    def test_abono_with_main_fraction(self):
        self.assertEqual(self._check(date(2026, 11, 9), 20, abono=10)["errors"], [])
        errors = self._check(date(2026, 11, 9), 10, abono=10)["errors"]
        self.assertTrue(any("14 dias" in e for e in errors))
        self.assertTrue(any("1/3" in e for e in self._check(date(2026, 11, 9), 19, abono=11)["errors"]))

    def test_abono_period_outside_gozo(self):
        gozo = (date(2026, 11, 9), 20)  # 09/11 a 28/11
        ok = validate_vacation(self.db, self.org_id, self.emp, P2, *gozo, 10, None, today=TODAY,
                               abono_start=date(2026, 11, 29))
        self.assertEqual(ok["errors"], [])
        self.assertEqual(ok["abono_end_date"], "2026-12-08")
        clash = validate_vacation(self.db, self.org_id, self.emp, P2, *gozo, 10, None, today=TODAY,
                                  abono_start=date(2026, 11, 25))
        self.assertTrue(any("abono não pode coincidir" in e for e in clash["errors"]))

    def test_overlap(self):
        self._add(date(2026, 11, 9), 20)
        errors = self._check(date(2026, 11, 23), 10, period=P1)["errors"]
        self.assertTrue(any("Sobrepõe" in e for e in errors))

    # ------------------------------------------------------------------ recibo

    def test_pay_with_abono(self):
        calc = calculate_vacation_pay(self.db, self.org_id, self.emp, P2, date(2026, 3, 3),
                                      date(2026, 11, 9), 20, 10)
        lines = {l["key"]: l["amount"] for l in calc["lines"]}
        self.assertEqual(lines["FERIAS"], 2000.0)
        self.assertEqual(lines["FERIAS_TERCO"], 666.67)
        self.assertEqual(lines["ABONO"], 1000.0)
        self.assertEqual(lines["ABONO_TERCO"], 333.33)
        inss = calc_inss(2666.67)  # abono e 1/3 fora da base
        self.assertEqual(lines["INSS"], inss)
        self.assertEqual(lines.get("IRRF", 0.0), calc_irrf(2666.67, inss, 0))
        self.assertEqual(calc["fgts"], round(2666.67 * 0.08, 2))
        raw_net = round(4000.0 - inss - lines.get("IRRF", 0.0), 2)
        self.assertEqual(calc["rounding"], round(-raw_net % 1, 2))
        self.assertEqual(calc["net"], float(-(-raw_net // 1)))  # arredondado para o próximo real

    def test_cash_allowance_integrates_vacation(self):
        # Quebra de caixa 10% (300) integra férias, 1/3 e abono (Súmula 247 TST)
        self.emp.role_obj.cash_allowance = True
        self.db.commit()
        calc = calculate_vacation_pay(self.db, self.org_id, self.emp, P2, date(2026, 3, 3),
                                      date(2026, 11, 9), 20, 10)
        lines = {l["key"]: l["amount"] for l in calc["lines"]}
        self.assertEqual(lines["FERIAS_QUEBRA_CAIXA"], 200.0)  # 300 / 30 x 20
        self.assertEqual(lines["FERIAS_TERCO"], 733.33)  # (2000 + 200) / 3
        self.assertEqual(lines["ABONO"], 1100.0)  # 3300 / 30 x 10
        self.assertEqual(lines["INSS"], calc_inss(2933.33))

    def test_receipt_matches_accounting(self):
        # Recibo da contabilidade: salário 1.700, triênio 4%, 20 dias de gozo + 10 de abono
        self.emp.role_obj.base_salary = 1700.0
        self.emp.admission_date = date(2022, 1, 6)  # 1 triênio completo em 11/2026
        self.db.commit()
        calc = calculate_vacation_pay(self.db, self.org_id, self.emp, date(2025, 1, 6), date(2026, 1, 5),
                                      date(2026, 11, 9), 20, 10)
        lines = {l["code"]: l["amount"] for l in calc["lines"]}
        self.assertEqual(lines, {"009": 1133.33, "046": 45.33, "597": 392.89, "598": 589.33,
                                 "716": 196.44, "999": 0.54, "902": 117.86})
        self.assertEqual((calc["gross"], calc["discounts"], calc["net"]), (2357.86, 117.86, 2240.0))

    def test_expired_period_pays_double(self):
        check = self._check(date(2026, 11, 9), 30, period=P1)
        self.assertEqual(check["doubled_days"], 30)
        self.assertTrue(any("art. 137" in w for w in check["warnings"]))
        calc = calculate_vacation_pay(self.db, self.org_id, self.emp, P1, date(2025, 3, 3),
                                      date(2026, 11, 9), 30, 0, doubled_days=30)
        lines = {l["key"]: l["amount"] for l in calc["lines"]}
        self.assertEqual(lines["FERIAS_DOBRA"], 3000.0)
        self.assertEqual(lines["INSS"], calc_inss(4000.0))  # dobra fora da base do INSS

    def test_variable_average_from_payroll(self):
        s = self._schedule(2025, 6)
        items = ensure_system_items(self.db, self.org_id)
        self.db.add(models.RHPayrollEntry(schedule_id=s.id, employee_id=self.emp.id, item_id=items["HE50"].id,
                                          amount=600.0, source="AUTO"))
        self.db.commit()
        calc = calculate_vacation_pay(self.db, self.org_id, self.emp, P2, date(2026, 3, 3),
                                      date(2026, 11, 9), 30, 0)
        self.assertEqual(calc["variable_average"], 50.0)
        self.assertEqual(calc["remuneration"], 3050.0)

    # ------------------------------------------------------------------ escala

    def test_apply_and_revert_schedule_across_months(self):
        nov = self._schedule(2026, 11)
        self.db.add(models.RHWorkDay(schedule_id=nov.id, employee_id=self.emp.id, day=23, status="TRABALHO",
                                     start_time="07:00", lunch_start="12:00", lunch_end="13:00", end_time="16:00",
                                     raw_minutes=480, worked_minutes=480))
        self.db.commit()
        v = self._add(date(2026, 11, 23), 14)
        touched = apply_to_schedule(self.db, self.org_id, self.emp, v, None)
        self.db.commit()
        self.assertEqual(len(touched), 2)
        dec = self.db.query(models.RHMonthlySchedule).filter_by(year=2026, month=12).one()
        self.assertEqual(self._day(nov, 23).status, "FERIAS")
        self.assertTrue(self._day(nov, 23).is_manual)
        self.assertEqual(self._day(dec, 6).status, "FERIAS")
        self.assertIsNone(self._day(dec, 7))

        revert_from_schedule(self.db, self.org_id, self.emp, v, None)
        self.db.commit()
        restored = self._day(nov, 23)
        self.assertEqual((restored.status, restored.start_time, restored.worked_minutes), ("TRABALHO", "07:00", 480))
        self.assertIsNone(self._day(dec, 1))  # dia vazio antes das férias volta a ficar vazio

    def test_apply_blocked_by_absence_or_closed_month(self):
        nov = self._schedule(2026, 11)
        self.db.add(models.RHWorkDay(schedule_id=nov.id, employee_id=self.emp.id, day=25, status="FALTA"))
        self.db.commit()
        v = self._add(date(2026, 11, 23), 14)
        with self.assertRaisesRegex(ValueError, "falta"):
            apply_to_schedule(self.db, self.org_id, self.emp, v, None)
        self.db.rollback()
        self._schedule(2026, 12, status="CLOSED")
        self._day(nov, 25).status = "TRABALHO"
        self.db.commit()
        with self.assertRaisesRegex(ValueError, "fechada"):
            apply_to_schedule(self.db, self.org_id, self.emp, v, None)

    def test_payroll_pays_only_days_outside_vacation(self):
        oct_ = self._schedule(2026, 10)
        for day in range(19, 29):  # 10 dias de férias
            self.db.add(models.RHWorkDay(schedule_id=oct_.id, employee_id=self.emp.id, day=day, status="FERIAS"))
        self.db.commit()
        calculate_payroll(self.db, self.org_id, oct_)
        row = get_payroll_month(self.db, self.org_id, oct_)["employees"][0]
        salary = next(e for e in row["entries"] if e["system_key"] == "SALARIO")
        self.assertEqual(salary["amount"], 2000.0)
        self.assertIn("10 de férias", salary["reference"])

    def test_old_vacation_items_are_removed(self):
        oct_ = self._schedule(2026, 10)
        old = models.RHPayrollItem(organization_id=self.org_id, code="009", name="Férias", kind="RECEITA",
                                   system_key="FERIAS", active=True)
        manual = models.RHPayrollItem(organization_id=self.org_id, code="902", name="INSS Férias", kind="DESPESA",
                                      system_key="INSS_FERIAS", active=True)
        self.db.add_all([old, manual])
        self.db.flush()
        self.db.add(models.RHPayrollEntry(schedule_id=oct_.id, employee_id=self.emp.id, item_id=old.id, amount=10, source="AUTO"))
        self.db.add(models.RHPayrollEntry(schedule_id=oct_.id, employee_id=self.emp.id, item_id=manual.id, amount=5, source="MANUAL"))
        self.db.commit()
        items = ensure_system_items(self.db, self.org_id)
        self.db.commit()
        self.assertNotIn("FERIAS", items)
        self.assertIsNone(self.db.get(models.RHPayrollItem, old.id))  # só tinha lançamento automático: excluída
        self.assertFalse(self.db.get(models.RHPayrollItem, manual.id).active)  # lançamento manual: só desativada

    def test_payroll_like_accounting_with_vacation(self):
        # Folha 10/2026 da contabilidade: salário 1.700, triênio 4%, férias de 26/10 a 14/11 (6 dias no mês)
        # com 10 dias de abono; recibo de férias com base de INSS 1.571,55 e INSS férias 117,86
        self.emp.role_obj.base_salary = 1700.0
        self.emp.admission_date = date(2023, 10, 10)
        oct_ = self._schedule(2026, 10)
        period = date(2024, 10, 10)
        v = models.RHVacation(organization_id=self.org_id, employee_id=self.emp.id, acquisition_start=period,
                              acquisition_end=date(2025, 10, 9), start_date=date(2026, 10, 26), days=20,
                              abono_days=10, status="CONFIRMADA")
        v.calc = calculate_vacation_pay(self.db, self.org_id, self.emp, period, date(2025, 10, 9), v.start_date, 20, 10)
        self.db.add(v)
        self.db.flush()
        apply_to_schedule(self.db, self.org_id, self.emp, v, None)
        self.db.commit()
        self.assertEqual(v.calc["net"], 2240.0)

        calculate_payroll(self.db, self.org_id, oct_)
        row = get_payroll_month(self.db, self.org_id, oct_)["employees"][0]
        lines = {e["system_key"]: e for e in row["entries"]}

        # Recibo fica fora da folha: nenhuma rubrica de férias
        self.assertFalse({"FERIAS", "FERIAS_TERCO", "ABONO_FERIAS", "INSS_FERIAS", "FERIAS_LIQUIDO"} & set(lines))
        # Salário dos 25 dias fora de férias (1 a 25/10; o dia 31 não conta no mês comercial) e triênio
        self.assertEqual(lines["SALARIO"]["amount"], 1416.67)
        self.assertEqual(lines["TRIENIO"]["amount"], 56.67)
        # INSS Folha: INSS(salário + triênio + férias do recibo) - INSS férias (como a contabilidade: 100,03)
        self.assertEqual(lines["INSS"]["amount"], round(calc_inss(1416.67 + 56.67 + 1571.55) - 117.86, 2))
        self.assertEqual(round(calc_inss(1076.67 + 43.07 + 1571.55) - 117.86, 2), 100.03)  # números da contabilidade
        self.assertEqual(lines["FGTS"]["amount"], round((1416.67 + 56.67 + 1571.55) * 0.08, 2))
        # Linha informativa "Férias de 26/10/2026 até 14/11/2026 Dia(s) 6"
        self.assertEqual(row["vacations"], [{
            "vacation_id": v.id, "start_date": "2026-10-26", "end_date": "2026-11-14", "days_in_month": 6,
            "hours": "040:00", "abono_days": 10, "paid_in_month": True, "receipt_net": 2240.0,
        }])


if __name__ == "__main__":
    unittest.main()
