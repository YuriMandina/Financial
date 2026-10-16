import unittest
from unittest.mock import patch
from datetime import date
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import models
from services.rh_schedule_service import apply_shift_fill


class TestApplyShiftFillWeeklyCap(unittest.TestCase):

    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        # Apenas as tabelas necessárias (o schema completo usa tipos exclusivos do Postgres)
        needed = [
            models.Organization, models.RHRole, models.RHWorkShift, models.RHEmployee,
            models.RHMonthlySchedule, models.RHWorkDay
        ]
        models.Base.metadata.create_all(engine, tables=[m.__table__ for m in needed])
        self.db = sessionmaker(bind=engine)()
        org = models.Organization(name="Org Teste")
        self.db.add(org)
        self.db.flush()
        self.org_id = org.id
        self.schedule = models.RHMonthlySchedule(organization_id=org.id, year=2026, month=10)
        self.db.add(self.schedule)
        self.db.flush()

    def _add_employee(self, weekly_hours, days_per_week):
        emp = models.RHEmployee(
            organization_id=self.org_id, name="Fulano",
            weekly_contract_hours=weekly_hours, weekly_actual_hours=weekly_hours,
            work_days_per_week=days_per_week, active=True
        )
        self.db.add(emp)
        self.db.commit()
        return emp

    def _fill_whole_month(self, holidays=None):
        with patch("services.rh_schedule_service.get_effective_holidays_map", return_value=holidays or {}):
            return apply_shift_fill(
                self.db, self.org_id, self.schedule.id,
                selected_days=list(range(1, 32))
            )

    def _weekly_minutes(self, emp):
        weeks = {}
        for r in self.db.query(models.RHWorkDay).filter_by(employee_id=emp.id).all():
            wk = date(2026, 10, r.day).isocalendar()[1]
            weeks[wk] = weeks.get(wk, 0) + (r.worked_minutes or 0)
        return weeks

    def test_whole_month_respects_weekly_hours(self):
        emp = self._add_employee(44.0, 6)
        res = self._fill_whole_month()
        # Turno padrão de 8h: no máximo 5 dias (40h) cabem em 44h semanais
        for wk_min in self._weekly_minutes(emp).values():
            self.assertLessEqual(wk_min, 44 * 60)
        self.assertGreater(res["capped_days_count"], 0)

    def test_sundays_become_dsr_when_cap_reached(self):
        emp = self._add_employee(40.0, 5)
        self._fill_whole_month()
        recs = {r.day: r for r in self.db.query(models.RHWorkDay).filter_by(employee_id=emp.id)}
        # Outubro/2026: domingos 4, 11, 18, 25; semana completa 5-11
        self.assertEqual(recs[11].status, "DSR")
        self.assertEqual(recs[10].status, "FOLGA")  # sábado excede 5 dias / 40h
        self.assertTrue(all(recs[d].status == "TRABALHO" for d in range(5, 10)))

    def test_holiday_is_not_worked(self):
        emp = self._add_employee(44.0, 6)
        self._fill_whole_month(holidays={"2026-10-12": "Nossa Senhora Aparecida"})
        rec = self.db.query(models.RHWorkDay).filter_by(employee_id=emp.id, day=12).first()
        self.assertEqual(rec.status, "FERIADO")
        self.assertEqual(rec.worked_minutes, 0)

    def test_manual_days_count_toward_weekly_cap(self):
        emp = self._add_employee(40.0, 6)
        # Segunda (dia 5) editada manualmente com 10h
        self.db.add(models.RHWorkDay(
            schedule_id=self.schedule.id, employee_id=emp.id, day=5,
            status="TRABALHO", worked_minutes=600, raw_minutes=600, is_manual=True
        ))
        self.db.commit()
        self._fill_whole_month()
        weeks = self._weekly_minutes(emp)
        self.assertLessEqual(weeks[date(2026, 10, 5).isocalendar()[1]], 40 * 60)


    def _fill_november(self):
        nov = models.RHMonthlySchedule(organization_id=self.org_id, year=2026, month=11)
        self.db.add(nov)
        self.db.commit()
        with patch("services.rh_schedule_service.get_effective_holidays_map", return_value={}):
            apply_shift_fill(self.db, self.org_id, nov.id, selected_days=list(range(1, 31)))
        return nov

    def test_partial_first_week_assumes_standard_week_without_previous_schedule(self):
        # Sem escala de outubro: move a criada no setUp para outro mês
        self.schedule.month = 9
        self.db.commit()
        emp = self._add_employee(44.0, 6)
        nov = self._fill_november()
        # 01/11/2026 é domingo e fecha a semana iniciada em outubro (26 a 31)
        rec = self.db.query(models.RHWorkDay).filter_by(schedule_id=nov.id, employee_id=emp.id, day=1).first()
        self.assertEqual(rec.status, "DSR")

    def test_partial_first_week_uses_previous_month_schedule(self):
        emp = self._add_employee(44.0, 6)
        # Em outubro o colaborador folgou de 26 a 31: o domingo 01/11 ainda cabe na semana
        for d in range(26, 32):
            self.db.add(models.RHWorkDay(
                schedule_id=self.schedule.id, employee_id=emp.id, day=d,
                status="FOLGA", worked_minutes=0, raw_minutes=0, is_manual=True
            ))
        self.db.commit()
        nov = self._fill_november()
        rec = self.db.query(models.RHWorkDay).filter_by(schedule_id=nov.id, employee_id=emp.id, day=1).first()
        self.assertEqual(rec.status, "TRABALHO")


if __name__ == "__main__":
    unittest.main()
