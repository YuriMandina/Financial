import unittest
from datetime import date
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models import models
from services.rh_compliance_service import approve_month_audit, audit_summary, refresh_month_audit
from services.rh_contracts import SYSTEM_TEMPLATES, create_contract_version
from services.rh_schedule_service import apply_contract_fill

TEMPLATES = {t["code"]: t["days"] for t in SYSTEM_TEMPLATES}


class TestMonthlyAudit(unittest.TestCase):

    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        needed = [
            models.Organization, models.User, models.RHRole, models.RHEmployee, models.RHEmployeeContract,
            models.RHContractTemplate, models.RHLegalRegime, models.RHMonthlySchedule, models.RHWorkDay,
            models.RHWorkDayChange, models.RHSettings, models.RHSalaryChange, models.RHMonthlyAudit, models.RHAuditItem
        ]
        models.Base.metadata.create_all(engine, tables=[m.__table__ for m in needed])
        self.db = sessionmaker(bind=engine)()
        org = models.Organization(name="Org")
        self.db.add(org)
        self.db.flush()
        self.org_id = org.id
        self.user = models.User(email="dir@x.com", password_hash="x", organization_id=org.id, name="Diretor")
        self.db.add(self.user)
        self.db.add(models.RHSettings(organization_id=org.id))
        self.schedule = models.RHMonthlySchedule(organization_id=org.id, year=2026, month=10)
        self.db.add(self.schedule)
        self.emp = models.RHEmployee(organization_id=org.id, name="Alaelson", active=True)
        self.db.add(self.emp)
        self.db.flush()
        create_contract_version(self.db, self.emp, {"valid_from": date(2026, 1, 1), "days": TEMPLATES["44H_6X1_QUA"]}, None)
        self.db.commit()
        for target in ("services.rh_schedule_service.get_effective_holidays_map",
                       "services.rh_compliance_service.get_effective_holidays_map"):
            p = patch(target, return_value={})
            p.start()
            self.addCleanup(p.stop)
        apply_contract_fill(self.db, self.org_id, self.schedule.id, selected_days=list(range(1, 32)))

    def _day(self, day):
        return self.db.query(models.RHWorkDay).filter_by(schedule_id=self.schedule.id, employee_id=self.emp.id, day=day).first()

    def _set_work(self, day, start="07:00", end="16:00", lunch=("12:00", "13:00")):
        rec = self._day(day)
        rec.status = "TRABALHO"
        rec.start_time, rec.end_time = start, end
        rec.lunch_start, rec.lunch_end = lunch
        from services.rh_engine import compute_raw_minutes
        rec.worked_minutes = rec.raw_minutes = compute_raw_minutes(start, lunch[0], lunch[1], end)
        rec.is_manual = True
        self.db.commit()

    def _audit(self):
        audit, _ = refresh_month_audit(self.db, self.org_id, 2026, 10)
        self.db.commit()
        return audit

    def test_filled_month_has_no_irregularities(self):
        audit = self._audit()
        self.assertEqual(audit_summary(audit)["status"], "SEM_IRREGULARIDADES")

    def test_approve_then_new_irregularity_reopens_only_new_item(self):
        # Quarta de 8h sem reduzir outro dia, em banco de 6 meses: hora extra acima de 2h (R01)
        self.db.query(models.RHSettings).first().compensation_regime = "BANK_6M"
        self._set_work(14)
        audit = self._audit()
        # 48h na semana sem acordo de prorrogação também é irregular (R02)
        self.assertEqual(sorted(i.rule_code for i in audit.items), ["R01", "R02"])
        self.assertEqual(audit.status, "PENDENTE")

        r01 = next(i for i in audit.items if i.rule_code == "R01")
        approve_month_audit(audit, self.user, "Inventário", {r01.id: {"note": "Inventário", "is_force_majeure": False}})
        self.db.commit()
        self.assertEqual(audit.status, "APROVADA")
        self.assertEqual(sorted(i["rule_code"] for i in audit.snapshot["items"]), ["R01", "R02"])
        self.assertEqual(r01.note, "Inventário")

        self._set_work(19, start="13:00", end="22:00", lunch=("17:00", "18:00"))  # R08 entre 19 e 20
        audit = self._audit()
        self.assertEqual(audit.status, "REABERTA")
        by_code = {i.rule_code: i.status for i in audit.items}
        self.assertEqual(by_code, {"R01": "APROVADA", "R02": "APROVADA", "R08": "PENDENTE"})

    def test_corrected_irregularity_is_discarded(self):
        self._set_work(19, start="13:00", end="22:00", lunch=("17:00", "18:00"))
        audit = self._audit()
        self.assertEqual(len(audit.items), 1)
        self._set_work(19)  # volta ao horário do contrato
        audit = self._audit()
        self.assertEqual(audit.items, [])

    def test_fill_turns_lote_day_into_rest_to_avoid_seventh_day(self):
        # Domingo 11/10 trabalhado manualmente: o lote do mês geraria 7 dias seguidos antes e depois dele
        self._set_work(11)
        res = apply_contract_fill(self.db, self.org_id, self.schedule.id, selected_days=list(range(1, 32)))
        self.assertEqual({a["day"] for a in res["adjusted"]}, {10, 17})
        self.assertEqual(self._day(10).status, "FOLGA")
        self.assertEqual(self._day(11).status, "TRABALHO")  # dia manual preservado
        codes = [i.rule_code for i in self._audit().items]
        self.assertNotIn("R05", codes)

    def test_fill_reports_what_it_cannot_fix(self):
        self._set_work(11)
        res = apply_contract_fill(self.db, self.org_id, self.schedule.id, selected_days=[5, 6, 7, 8, 9, 10])
        self.assertEqual(self._day(10).status, "FOLGA")
        self.assertIn("Alaelson", res["unresolved"])  # 11 a 17 continua com 7 dias (dias fora do lote)

    def test_shift_change_is_not_lateness_unless_recorded(self):
        self._set_work(20, start="10:00", end="19:00")  # remanejado, mesma carga
        self.assertEqual(self._audit().items, [])
        rec = self._day(20)
        rec.is_late_record = True  # registrado como ponto: 3h de atraso fora do limite
        self.db.commit()
        self.assertIn("R01", [i.rule_code for i in self._audit().items])


if __name__ == "__main__":
    unittest.main()
