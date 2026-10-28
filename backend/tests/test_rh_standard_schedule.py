import unittest
from datetime import date
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models import models
from services.rh_contracts import (
    SYSTEM_STANDARD_SCHEDULES, SYSTEM_TEMPLATES, apply_standard_schedule, build_day_from_schedule,
    create_contract_version, normalize_days, parse_days, same_workload, update_contract_version,
    validate_standard_schedule, weekly_minutes
)

TEMPLATES = {t["code"]: t["days"] for t in SYSTEM_TEMPLATES}
SCHEDULES = {s["code"]: SimpleNamespace(**s) for s in SYSTEM_STANDARD_SCHEDULES}


class TestStandardScheduleBuild(unittest.TestCase):

    def test_morning_reproduces_system_templates(self):
        for code, days in TEMPLATES.items():
            self.assertEqual(apply_standard_schedule(days, SCHEDULES["MANHA_07"]), normalize_days(days), code)

    def test_afternoon_keeps_workload_and_moves_hours(self):
        days = apply_standard_schedule(TEMPLATES["44H_6X1_QUA"], SCHEDULES["TARDE_09"])
        self.assertEqual(days["0"], {"start": "09:00", "lunch_start": "12:00", "lunch_end": "14:00", "end": "19:00"})
        self.assertEqual(days["2"], {"start": "09:00", "lunch_start": None, "lunch_end": None, "end": "13:00"})
        self.assertEqual(days["6"], {"rest": "DSR"})
        self.assertEqual(weekly_minutes(parse_days(days)), 44 * 60)
        self.assertTrue(same_workload(TEMPLATES["44H_6X1_QUA"], days))

    def test_breaks_follow_art_71(self):
        self.assertIsNone(build_day_from_schedule(240, "09:00", 120, 180)["lunch_start"])
        five = build_day_from_schedule(300, "09:00", 120, 180)
        self.assertEqual((five["lunch_start"], five["lunch_end"], five["end"]), ("12:00", "12:15", "14:15"))
        # Intervalo configurado depois do fim de um dia curto vai para o meio do dia
        short = build_day_from_schedule(300, "07:00", 60, 360)
        self.assertEqual((short["lunch_start"], short["lunch_end"]), ("09:30", "09:45"))

    def test_compensated_day(self):
        day = build_day_from_schedule(528, "07:00", 60, 300)
        self.assertEqual(day, {"start": "07:00", "lunch_start": "12:00", "lunch_end": "13:00", "end": "16:48"})

    def test_validation(self):
        self.assertEqual(validate_standard_schedule("09:00", 120, 180), [])
        self.assertEqual(len(validate_standard_schedule("9h", 30, 420)), 3)


class TestHorarioReason(unittest.TestCase):

    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        needed = [models.Organization, models.RHEmployee, models.RHEmployeeContract, models.RHContractTemplate,
                  models.RHLegalRegime, models.RHStandardSchedule]
        models.Base.metadata.create_all(engine, tables=[m.__table__ for m in needed])
        self.db = sessionmaker(bind=engine)()
        org = models.Organization(name="Org")
        self.db.add(org)
        self.db.flush()
        self.emp = models.RHEmployee(organization_id=org.id, name="Fulano", active=True)
        self.db.add(self.emp)
        self.db.flush()
        self.first = create_contract_version(self.db, self.emp, {
            "valid_from": date(2026, 1, 1), "days": TEMPLATES["44H_6X1_QUA"]
        }, None)

    def test_first_version_is_admission(self):
        self.assertEqual(self.first.change_reason, "ADMISSAO")

    def test_same_workload_is_horario(self):
        days = apply_standard_schedule(TEMPLATES["44H_6X1_QUA"], SCHEDULES["TARDE_09"])
        v = create_contract_version(self.db, self.emp, {
            "valid_from": date(2026, 10, 1), "days": days, "change_reason": "ACORDO"
        }, None)
        self.assertEqual(v.change_reason, "HORARIO")

    def test_horario_cannot_be_forced(self):
        v = create_contract_version(self.db, self.emp, {
            "valid_from": date(2026, 10, 1), "days": TEMPLATES["40H_5X2"], "change_reason": "HORARIO"
        }, None)
        self.assertEqual(v.change_reason, "ACORDO")

    def test_update_reclassifies(self):
        days = apply_standard_schedule(TEMPLATES["44H_6X1_QUA"], SCHEDULES["TARDE_09"])
        v = create_contract_version(self.db, self.emp, {"valid_from": date(2026, 10, 1), "days": days}, None)
        self.assertEqual(v.change_reason, "HORARIO")
        update_contract_version(self.db, self.emp, v, {"days": TEMPLATES["40H_5X2"]})
        self.assertEqual(v.change_reason, "ACORDO")


if __name__ == "__main__":
    unittest.main()
