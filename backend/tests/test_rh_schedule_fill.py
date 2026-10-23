import unittest
from unittest.mock import patch
from datetime import date
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import models
from services.rh_contracts import SYSTEM_TEMPLATES, create_contract_version
from services.rh_schedule_service import apply_contract_fill, clear_or_reset_schedule

TEMPLATES = {t["code"]: t["days"] for t in SYSTEM_TEMPLATES}


class TestApplyContractFill(unittest.TestCase):

    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        # Apenas as tabelas necessárias (o schema completo usa tipos exclusivos do Postgres)
        needed = [
            models.Organization, models.RHRole, models.RHEmployee, models.RHEmployeeContract,
            models.RHContractTemplate, models.RHLegalRegime, models.RHMonthlySchedule,
            models.RHWorkDay, models.RHWorkDayChange, models.RHSettings, models.RHSalaryChange, models.RHBankHours
        ]
        models.Base.metadata.create_all(engine, tables=[m.__table__ for m in needed])
        self.db = sessionmaker(bind=engine)()
        org = models.Organization(name="Org Teste")
        self.db.add(org)
        self.db.flush()
        self.org_id = org.id
        self.schedule = self._schedule(2026, 10)
        # O motor de regras (chamado pelo lote) consulta os feriados do próprio módulo
        holidays_patch = patch("services.rh_compliance_service.get_effective_holidays_map", return_value={})
        holidays_patch.start()
        self.addCleanup(holidays_patch.stop)

    def _schedule(self, year, month):
        sched = models.RHMonthlySchedule(organization_id=self.org_id, year=year, month=month)
        self.db.add(sched)
        self.db.flush()
        return sched

    def _employee(self, template="44H_6X1_QUA", valid_from=date(2026, 1, 1), name="Fulano"):
        emp = models.RHEmployee(organization_id=self.org_id, name=name, active=True)
        self.db.add(emp)
        self.db.flush()
        if template:
            create_contract_version(self.db, emp, {
                "valid_from": valid_from, "days": TEMPLATES[template], "compensation_agreement": True
            }, user_id=None)
        self.db.commit()
        return emp

    def _fill(self, schedule=None, holidays=None, **kw):
        schedule = schedule or self.schedule
        with patch("services.rh_schedule_service.get_effective_holidays_map", return_value=holidays or {}),                 patch("services.rh_compliance_service.get_effective_holidays_map", return_value=holidays or {}):
            return apply_contract_fill(self.db, self.org_id, schedule.id, selected_days=list(range(1, 32)), **kw)

    def _days(self, emp, schedule=None):
        schedule = schedule or self.schedule
        return {r.day: r for r in self.db.query(models.RHWorkDay).filter_by(
            schedule_id=schedule.id, employee_id=emp.id).all()}

    def test_fill_applies_weekly_contract(self):
        emp = self._employee()
        self._fill()
        days = self._days(emp)
        self.assertEqual(days[5].status, "TRABALHO")  # segunda
        self.assertEqual((days[5].start_time, days[5].end_time, days[5].worked_minutes), ("07:00", "16:00", 480))
        self.assertEqual(days[7].worked_minutes, 240)  # quarta reduzida
        self.assertIsNone(days[7].lunch_start)
        self.assertEqual(days[11].status, "DSR")  # domingo
        week = sum(days[d].worked_minutes for d in range(5, 12))
        self.assertEqual(week, 44 * 60)

    def test_holiday_is_not_worked(self):
        emp = self._employee()
        self._fill(holidays={"2026-10-12": "Nossa Senhora Aparecida"})
        self.assertEqual(self._days(emp)[12].status, "FERIADO")

    def test_manual_days_are_preserved(self):
        emp = self._employee()
        self.db.add(models.RHWorkDay(schedule_id=self.schedule.id, employee_id=emp.id, day=7, status="FERIAS",
                                     worked_minutes=0, raw_minutes=0, is_manual=True))
        self.db.commit()
        res = self._fill()
        self.assertEqual(self._days(emp)[7].status, "FERIAS")
        self.assertEqual(res["skipped_manual_count"], 1)
        self._fill(overwrite_manual=True)
        self.assertEqual(self._days(emp)[7].status, "TRABALHO")

    def test_employee_without_contract_is_reported_and_not_filled(self):
        emp = self._employee(template=None, name="Sem Contrato")
        res = self._fill()
        self.assertEqual(self._days(emp), {})
        self.assertIn("Sem Contrato", res["without_contract"])

    def test_contract_version_changes_mid_month(self):
        dec = self._schedule(2026, 12)
        emp = self._employee()
        create_contract_version(self.db, emp, {
            "valid_from": date(2026, 12, 14), "days": TEMPLATES["40H_5X2"], "change_reason": "ADEQUACAO_LEGAL"
        }, user_id=None)
        self.db.commit()
        self._fill(schedule=dec)
        days = self._days(emp, dec)
        self.assertEqual(days[9].worked_minutes, 240)  # quarta 09/12: contrato 44h
        self.assertEqual(days[16].status, "FOLGA")  # quarta 16/12: contrato 40h 5x2
        self.assertEqual(sum(days[d].worked_minutes for d in range(14, 21)), 40 * 60)
        self.assertEqual(emp.contracts[0].valid_to, date(2026, 12, 13))

    def test_history_is_recorded_only_on_changes(self):
        emp = self._employee()
        self._fill()
        first = self.db.query(models.RHWorkDayChange).filter_by(employee_id=emp.id).count()
        self.assertEqual(first, 31)
        self._fill()
        self.assertEqual(self.db.query(models.RHWorkDayChange).filter_by(employee_id=emp.id).count(), first)
        change = self.db.query(models.RHWorkDayChange).filter_by(employee_id=emp.id).first()
        self.assertEqual(change.origin, "LOTE")
        self.assertIsNone(change.before)

    def test_clear_and_reset(self):
        emp = self._employee()
        self._fill()
        with patch("services.rh_schedule_service.get_effective_holidays_map", return_value={}):
            clear_or_reset_schedule(self.db, self.org_id, self.schedule.id, mode="CLEAR_OFF")
            days = self._days(emp)
            self.assertEqual(days[5].status, "FOLGA")
            self.assertEqual(days[11].status, "DSR")
            clear_or_reset_schedule(self.db, self.org_id, self.schedule.id, mode="RESET_DEFAULT")
        self.assertEqual(self._days(emp)[5].worked_minutes, 480)
        origins = {c.origin for c in self.db.query(models.RHWorkDayChange).all()}
        self.assertEqual(origins, {"LOTE", "RESET"})

    def test_other_status_is_applied_directly(self):
        emp = self._employee()
        with patch("services.rh_schedule_service.get_effective_holidays_map", return_value={}):
            apply_contract_fill(self.db, self.org_id, self.schedule.id, status="FERIAS", day_from=19, day_to=23)
        days = self._days(emp)
        self.assertEqual({days[d].status for d in range(19, 24)}, {"FERIAS"})
        self.assertNotIn(18, days)

    def test_clear_unselected_uses_contract_rest(self):
        emp = self._employee(template="40H_5X2")
        with patch("services.rh_schedule_service.get_effective_holidays_map", return_value={}):
            apply_contract_fill(self.db, self.org_id, self.schedule.id, selected_days=[5, 6], clear_unselected=True)
        days = self._days(emp)
        self.assertEqual(days[7].status, "FOLGA")  # quarta: folga do contrato
        self.assertEqual(days[8].status, "FOLGA")  # quinta não selecionada
        self.assertEqual(days[11].status, "DSR")


class TestContractVersions(unittest.TestCase):

    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        needed = [models.Organization, models.RHEmployee, models.RHEmployeeContract,
                  models.RHContractTemplate, models.RHLegalRegime]
        models.Base.metadata.create_all(engine, tables=[m.__table__ for m in needed])
        self.db = sessionmaker(bind=engine)()
        org = models.Organization(name="Org")
        self.db.add(org)
        self.db.flush()
        self.emp = models.RHEmployee(organization_id=org.id, name="Fulano", active=True)
        self.db.add(self.emp)
        self.db.flush()

    def test_invalid_contract_is_not_saved(self):
        with self.assertRaises(ValueError):
            create_contract_version(self.db, self.emp, {
                "valid_from": date(2026, 12, 14), "days": TEMPLATES["44H_6X1_QUA"]
            }, user_id=None)
        self.assertEqual(self.emp.contracts, [])

    def test_version_without_amendment_still_takes_effect(self):
        v = create_contract_version(self.db, self.emp, {
            "valid_from": date(2026, 10, 1), "days": TEMPLATES["44H_6X1_QUA"]
        }, user_id=None)
        self.assertFalse(v.amendment_signed)
        self.assertEqual(self.emp.weekly_contract_hours, 44.0)
        self.assertEqual(self.emp.work_days_per_week, 6)

    def test_version_dates_must_increase(self):
        create_contract_version(self.db, self.emp, {"valid_from": date(2026, 10, 1), "days": TEMPLATES["44H_6X1_QUA"]}, None)
        with self.assertRaises(ValueError):
            create_contract_version(self.db, self.emp, {"valid_from": date(2026, 9, 1), "days": TEMPLATES["40H_5X2"]}, None)


if __name__ == "__main__":
    unittest.main()
