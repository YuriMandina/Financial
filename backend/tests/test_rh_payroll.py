import unittest
from unittest.mock import patch
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import models
from datetime import date
from services.rh_payroll_service import calc_inss, calc_irrf, calculate_payroll, get_payroll_month, completed_triennia


class TestPayrollTaxes(unittest.TestCase):

    def test_inss_progressive(self):
        # 1621*7,5% + (2902,84-1621)*9% + (3000-2902,84)*12%
        expected = round(1621 * 0.075 + (2902.84 - 1621) * 0.09 + (3000 - 2902.84) * 0.12, 2)
        self.assertEqual(calc_inss(3000.0), expected)

    def test_inss_ceiling(self):
        self.assertEqual(calc_inss(20000.0), calc_inss(8475.55))

    def test_irrf_exempt_up_to_5000(self):
        self.assertEqual(calc_irrf(5000.0, calc_inss(5000.0), 0), 0.0)

    def test_irrf_partial_reduction(self):
        gross = 6000.0
        inss = calc_inss(gross)
        base = gross - inss
        full_tax = base * 0.275 - 908.73
        reduction = 978.62 - 0.133145 * gross
        self.assertAlmostEqual(calc_irrf(gross, inss, 0), round(full_tax - reduction, 2), places=2)

    def test_irrf_without_reduction_above_limit(self):
        gross = 10000.0
        inss = calc_inss(gross)
        self.assertAlmostEqual(calc_irrf(gross, inss, 0), round((gross - inss) * 0.275 - 908.73, 2), places=2)


class TestCalculatePayroll(unittest.TestCase):

    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        needed = [
            models.Organization, models.RHRole, models.RHWorkShift, models.RHEmployee,
            models.RHMonthlySchedule, models.RHWorkDay, models.RHSettings, models.RHBenefitAdjustment,
            models.RHPayrollItem, models.RHPayrollEntry
        ]
        models.Base.metadata.create_all(engine, tables=[m.__table__ for m in needed])
        self.db = sessionmaker(bind=engine)()
        org = models.Organization(name="Org Teste")
        self.db.add(org)
        self.db.flush()
        self.org_id = org.id
        self.db.add(models.RHSettings(organization_id=org.id))
        self.schedule = models.RHMonthlySchedule(organization_id=org.id, year=2026, month=10)
        self.db.add(self.schedule)
        self.emp = models.RHEmployee(
            organization_id=org.id, name="Fulano", base_salary=3000.0, dependents=0,
            weekly_contract_hours=40.0, weekly_actual_hours=40.0, work_days_per_week=5,
            default_daily_transport_tickets=0, daily_meal_cost=0, active=True
        )
        self.db.add(self.emp)
        self.db.commit()

    def _calc(self):
        with patch("services.rh_payroll_service.get_effective_holidays_map", return_value={}):
            calculate_payroll(self.db, self.org_id, self.schedule)
        return get_payroll_month(self.db, self.org_id, self.schedule)["employees"][0]

    def _by_key(self, row):
        return {e["system_key"] or e["code"]: e for e in row["entries"]}

    def test_salary_and_taxes(self):
        row = self._calc()
        lines = self._by_key(row)
        self.assertEqual(lines["SALARIO"]["amount"], 3000.0)
        self.assertEqual(lines["INSS"]["amount"], calc_inss(3000.0))
        self.assertNotIn("IRRF", lines)  # isento até R$ 5.000
        self.assertEqual(lines["FGTS"]["amount"], 240.0)
        self.assertEqual(row["totals"]["liquido"], round(3000.0 - calc_inss(3000.0), 2))

    def test_absence_discounts_day_and_dsr(self):
        self.db.add(models.RHWorkDay(schedule_id=self.schedule.id, employee_id=self.emp.id, day=6,
                                     status="FALTA", worked_minutes=0, raw_minutes=0))
        self.db.commit()
        lines = self._by_key(self._calc())
        self.assertEqual(lines["FALTAS"]["amount"], 100.0)
        self.assertEqual(lines["DSR_FALTA"]["amount"], 100.0)
        # Faltas reduzem a base do INSS
        self.assertEqual(lines["INSS"]["amount"], calc_inss(2800.0))

    def test_manual_entry_recurring_and_override(self):
        bonus = models.RHPayrollItem(organization_id=self.org_id, code="050", name="Gratificação",
                                     kind="RECEITA", calc_type="PERCENT", default_value=10, recurring=True,
                                     incide_inss=True, incide_irrf=True, incide_fgts=True, affects_net=True)
        self.db.add(bonus)
        self.db.commit()
        row = self._calc()
        lines = self._by_key(row)
        self.assertEqual(lines["050"]["amount"], 300.0)
        self.assertEqual(lines["INSS"]["amount"], calc_inss(3300.0))

        # Valor manual da rubrica recorrente prevalece sobre o automático
        self.db.add(models.RHPayrollEntry(schedule_id=self.schedule.id, employee_id=self.emp.id,
                                          item_id=bonus.id, amount=500.0, source="MANUAL"))
        self.db.commit()
        row = self._calc()
        bonus_lines = [e for e in row["entries"] if e["code"] == "050"]
        self.assertEqual(len(bonus_lines), 1)
        self.assertEqual(bonus_lines[0]["amount"], 500.0)
        self.assertEqual(self._by_key(row)["INSS"]["amount"], calc_inss(3500.0))

    def test_completed_triennia(self):
        ref = date(2026, 10, 31)
        self.assertEqual(completed_triennia(None, ref), 0)
        self.assertEqual(completed_triennia(date(2024, 1, 10), ref), 0)
        self.assertEqual(completed_triennia(date(2023, 10, 31), ref), 1)  # completa 3 anos no último dia
        self.assertEqual(completed_triennia(date(2023, 11, 1), ref), 0)
        self.assertEqual(completed_triennia(date(2019, 5, 2), ref), 2)  # 7 anos

    def test_triennium_is_cumulative_and_configurable(self):
        self.emp.admission_date = date(2019, 5, 2)  # 7 anos em out/2026 = 2 triênios
        self.db.commit()
        lines = self._by_key(self._calc())
        self.assertEqual(lines["TRIENIO"]["amount"], 240.0)  # 3000 x 4% x 2
        self.assertEqual(lines["INSS"]["amount"], calc_inss(3240.0))

        trienio = self.db.query(models.RHPayrollItem).filter_by(system_key="TRIENIO").first()
        trienio.default_value = 5.0
        trienio.incide_inss = False
        self.db.commit()
        lines = self._by_key(self._calc())
        self.assertEqual(lines["TRIENIO"]["amount"], 300.0)
        self.assertEqual(lines["INSS"]["amount"], calc_inss(3000.0))

    def test_recalculate_is_idempotent(self):
        first = self._calc()
        second = self._calc()
        self.assertEqual(len(first["entries"]), len(second["entries"]))
        self.assertEqual(first["totals"], second["totals"])


if __name__ == "__main__":
    unittest.main()
