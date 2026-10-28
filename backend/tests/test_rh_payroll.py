import unittest
from types import SimpleNamespace
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
            models.Organization, models.RHRole, models.RHEmployee, models.RHEmployeeContract,
            models.RHLegalRegime, models.RHContractTemplate,
            models.RHMonthlySchedule, models.RHWorkDay, models.RHWorkDayChange, models.RHRestWorkDecision, models.RHSettings, models.RHBenefitAdjustment,
            models.RHPayrollItem, models.RHPayrollEntry, models.RHSalaryChange, models.RHBankHours,
            models.RHBankHoursEntry, models.RHSalaryAdvance
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
        self.role = models.RHRole(organization_id=org.id, name="Açougueiro", base_salary=3000.0)
        self.db.add(self.role)
        self.db.flush()
        self.emp = models.RHEmployee(
            organization_id=org.id, name="Fulano", role_id=self.role.id, dependents=0,
            weekly_contract_hours=40.0, work_days_per_week=5,
            default_daily_transport_tickets=0, daily_meal_cost=0, active=True
        )
        self.db.add(self.emp)
        self.db.flush()
        # Contrato 40h: 8h de segunda a sexta, folga no sábado e DSR no domingo
        eight = {"start": "07:00", "lunch_start": "12:00", "lunch_end": "13:00", "end": "16:00"}
        days = {str(wd): eight for wd in range(5)}
        days.update({"5": {"rest": "FOLGA"}, "6": {"rest": "DSR"}})
        self.db.add(models.RHEmployeeContract(employee_id=self.emp.id, valid_from=date(2026, 1, 1),
                                              days=days, weekly_min=2400))
        self.db.commit()
        holidays_patch = patch("services.rh_ledger.get_effective_holidays_map", return_value={})
        holidays_patch.start()
        self.addCleanup(holidays_patch.stop)

    def _calc(self):
        with patch("services.rh_payroll_service.get_effective_holidays_map", return_value={}):
            calculate_payroll(self.db, self.org_id, self.schedule)
        return get_payroll_month(self.db, self.org_id, self.schedule)["employees"][0]

    def _by_key(self, row):
        return {e["system_key"] or e["code"]: e for e in row["entries"]}

    def test_salary_advance_only_when_enabled(self):
        lines = self._by_key(self._calc())
        self.assertNotIn("ADIANTAMENTO", lines)

        self.db.add(models.RHSalaryAdvance(schedule_id=self.schedule.id, employee_id=self.emp.id, enabled=True))
        self.db.commit()
        row = self._calc()
        lines = self._by_key(row)
        self.assertEqual(lines["ADIANTAMENTO"]["amount"], 1200.0)  # 40% de 3000
        self.assertEqual(lines["INSS"]["amount"], calc_inss(3000.0))  # não reduz a base do INSS
        self.assertTrue(row["advance"]["enabled"])
        self.assertEqual(row["advance"]["amount"], 1200.0)

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

    def _absence_week_5x2(self):
        # Semana 5-11/out/2026: falta na quarta (7), sábado (10) e domingo (11) como DSR
        for day, status in [(7, "FALTA"), (10, "DSR"), (11, "DSR")]:
            self.db.add(models.RHWorkDay(schedule_id=self.schedule.id, employee_id=self.emp.id, day=day,
                                         status=status, worked_minutes=0, raw_minutes=0))
        self.db.commit()

    def _set_dsr_mode(self, mode):
        settings = self.db.query(models.RHSettings).first()
        settings.absence_dsr_mode = mode
        self.db.commit()

    def test_dsr_mode_one_discounts_single_dsr(self):
        self._absence_week_5x2()
        lines = self._by_key(self._calc())
        self.assertEqual(lines["FALTAS"]["amount"], 100.0)
        self.assertEqual(lines["DSR_FALTA"]["amount"], 100.0)

    def test_dsr_mode_schedule_discounts_all_dsr_of_week(self):
        self._absence_week_5x2()
        self._set_dsr_mode("SCHEDULE")
        lines = self._by_key(self._calc())
        self.assertEqual(lines["DSR_FALTA"]["amount"], 200.0)
        self.assertEqual(lines["DSR_FALTA"]["reference"], "2 DSR")

    def test_dsr_mode_none_discounts_only_the_day(self):
        self._absence_week_5x2()
        self._set_dsr_mode("NONE")
        lines = self._by_key(self._calc())
        self.assertEqual(lines["FALTAS"]["amount"], 100.0)
        self.assertNotIn("DSR_FALTA", lines)

    def test_absence_saved_in_schedule_syncs_calculated_payroll(self):
        from services.rh_payroll_service import sync_payroll_if_calculated
        with patch("services.rh_payroll_service.get_effective_holidays_map", return_value={}):
            # Folha ainda não calculada: escala salva não gera folha
            self.assertFalse(sync_payroll_if_calculated(self.db, self.org_id, self.schedule.id))
            calculate_payroll(self.db, self.org_id, self.schedule)

            self.db.add(models.RHWorkDay(schedule_id=self.schedule.id, employee_id=self.emp.id, day=7,
                                         status="FALTA", worked_minutes=0, raw_minutes=0, is_manual=True))
            self.db.commit()
            self.assertTrue(sync_payroll_if_calculated(self.db, self.org_id, self.schedule.id))

        row = get_payroll_month(self.db, self.org_id, self.schedule)["employees"][0]
        lines = self._by_key(row)
        self.assertEqual(lines["FALTAS"]["amount"], 100.0)
        self.assertEqual(lines["FALTAS"]["reference"], "1 dia(s)")

    def _raise(self, effective, **kw):
        from services.rh_salary_service import apply_salary_change
        apply_salary_change(self.db, self.role, effective, **kw)
        self.db.commit()

    def _calc_month(self, year, month):
        sched = self.db.query(models.RHMonthlySchedule).filter_by(year=year, month=month).first()
        if not sched:
            sched = models.RHMonthlySchedule(organization_id=self.org_id, year=year, month=month)
            self.db.add(sched)
            self.db.commit()
        with patch("services.rh_payroll_service.get_effective_holidays_map", return_value={}):
            calculate_payroll(self.db, self.org_id, sched)
        return self._by_key(get_payroll_month(self.db, self.org_id, sched)["employees"][0])

    def test_raise_applies_only_from_effective_date(self):
        self._raise(date(2026, 12, 1), percent=10, reason="Dissídio")
        self.assertEqual(self._calc_month(2026, 10)["SALARIO"]["amount"], 3000.0)
        self.assertEqual(self._calc_month(2026, 12)["SALARIO"]["amount"], 3300.0)

    def test_raise_mid_month_is_proportional(self):
        self._raise(date(2026, 10, 16), new_salary=3600.0)
        # 15 dias a 3000 + 15 dias a 3600 (mês comercial de 30 dias)
        self.assertEqual(self._calc_month(2026, 10)["SALARIO"]["amount"], 3300.0)
        self.assertEqual(self._calc_month(2026, 11)["SALARIO"]["amount"], 3600.0)

    def test_initial_salary_preserved_before_first_raise(self):
        from services.rh_salary_service import get_salary_history
        self._raise(date(2027, 1, 1), new_salary=4000.0)
        history = get_salary_history(self.db, self.role.id)
        self.assertIsNone(history[0].effective_date)
        self.assertEqual(history[0].salary, 3000.0)
        self.assertEqual(self._calc_month(2026, 10)["SALARIO"]["amount"], 3000.0)

    def test_same_role_same_salary_and_role_change(self):
        other = models.RHEmployee(organization_id=self.org_id, name="Ciclano", role_id=self.role.id,
                                  weekly_contract_hours=40.0, work_days_per_week=5,
                                  default_daily_transport_tickets=0, daily_meal_cost=0, active=True)
        senior = models.RHRole(organization_id=self.org_id, name="Açougueiro II", base_salary=4000.0)
        self.db.add_all([other, senior])
        self.db.commit()
        self._raise(date(2026, 10, 1), percent=10)
        with patch("services.rh_payroll_service.get_effective_holidays_map", return_value={}):
            calculate_payroll(self.db, self.org_id, self.schedule)
        rows = get_payroll_month(self.db, self.org_id, self.schedule)["employees"]
        self.assertEqual({r["base_salary"] for r in rows}, {3300.0})

        # Promoção: o salário acompanha o novo cargo
        other.role_id = senior.id
        self.db.commit()
        with patch("services.rh_payroll_service.get_effective_holidays_map", return_value={}):
            calculate_payroll(self.db, self.org_id, self.schedule)
        rows = {r["employee_name"]: r for r in get_payroll_month(self.db, self.org_id, self.schedule)["employees"]}
        self.assertEqual(rows["Ciclano"]["base_salary"], 4000.0)
        self.assertEqual(rows["Fulano"]["base_salary"], 3300.0)

    def test_detailed_totals(self):
        other = models.RHEmployee(organization_id=self.org_id, name="Ciclano", role_id=self.role.id,
                                  weekly_contract_hours=40.0, work_days_per_week=5,
                                  default_daily_transport_tickets=0, daily_meal_cost=0, active=True)
        self.db.add(other)
        self.db.commit()
        with patch("services.rh_payroll_service.get_effective_holidays_map", return_value={}):
            calculate_payroll(self.db, self.org_id, self.schedule)
        data = get_payroll_month(self.db, self.org_id, self.schedule)
        items = {i["system_key"]: i for i in data["item_totals"]}
        self.assertEqual(items["SALARIO"]["total"], 6000.0)
        self.assertEqual(items["SALARIO"]["employees"], 2)
        self.assertEqual(data["totals"]["inss"], round(2 * calc_inss(3000.0), 2))
        self.assertEqual(data["totals"]["headcount"], 2)
        self.assertEqual(data["totals"]["custo_empresa"], 6000.0 + 480.0)
        self.assertEqual(data["role_totals"][0]["headcount"], 2)
        self.assertEqual(data["role_totals"][0]["receitas"], 6000.0)

    # --- Banco de horas e destino das horas extras --------------------------------

    def _work_month(self, sched, extra_days=(), extra_minutes=120):
        """Escala de 5 dias/semana com 8h; dias em extra_days recebem minutos a mais."""
        for d in range(1, 32):
            try:
                wd = date(sched.year, sched.month, d)
            except ValueError:
                break
            status = "TRABALHO" if wd.weekday() < 5 else "DSR"
            minutes = 480 + (extra_minutes if d in extra_days else 0) if status == "TRABALHO" else 0
            self.db.add(models.RHWorkDay(schedule_id=sched.id, employee_id=self.emp.id, day=d,
                                         status=status, worked_minutes=minutes, raw_minutes=minutes))
        self.db.commit()

    def _set_policy(self, policy, rate=50.0, fixed=0.0):
        st = self.db.query(models.RHSettings).first()
        st.overtime_policy, st.overtime_rate, st.overtime_fixed_value = policy, rate, fixed
        self.db.commit()

    def _payroll(self, sched):
        from services.rh_payroll_service import calculate_payroll_through
        with patch("services.rh_payroll_service.get_effective_holidays_map", return_value={}):
            calculate_payroll_through(self.db, self.org_id, sched)
        row = get_payroll_month(self.db, self.org_id, sched)["employees"][0]
        return self._by_key(row), row["bank"]

    def test_overtime_paid_with_rate(self):
        self._set_policy("PAY")
        self._work_month(self.schedule, extra_days=(1, 2))  # +4h
        lines, bank = self._payroll(self.schedule)
        hourly = 3000.0 / 200
        self.assertEqual(lines["HE50"]["amount"], round(4 * hourly * 1.5, 2))
        self.assertEqual(bank["paid_minutes"], 240)
        self.assertEqual(bank["balance_minutes"], 0)

    def _set_day(self, day, status, minutes=0):
        rec = self.db.query(models.RHWorkDay).filter_by(employee_id=self.emp.id, day=day).first()
        rec.status, rec.worked_minutes, rec.raw_minutes = status, minutes, minutes
        self.db.commit()

    def _decide(self, worked_day, decision, folga_day=None):
        from services.rh_rest_work_service import decide_rest_work
        with patch("services.rh_rest_work_service.get_effective_holidays_map", return_value={}):
            decide_rest_work(self.db, self.org_id, self.emp, date(2026, 10, worked_day), decision,
                             date(2026, 10, folga_day) if folga_day else None, None, None)
        self.db.commit()

    def test_dsr_worked_without_folga_waits_for_decision(self):
        # Sem decisão: as horas 100% ficam pendentes, fora do banco comum e fora da folha
        self._work_month(self.schedule, extra_days=(1,))  # +2h na quinta (banco comum)
        self._set_day(4, "TRABALHO", 480)  # domingo 04/10 (DSR), sem folga na semana
        lines, bank = self._payroll(self.schedule)
        self.assertNotIn("HE100", lines)
        self.assertEqual(bank["month_balance_minutes"], 120)
        self.assertEqual(bank["rest_work_pending"], 1)
        item = bank["rest_work"][0]
        self.assertEqual((item["date"], item["rest_kind"], item["status"]), ("2026-10-04", "DSR", "PENDENTE"))
        self.assertEqual((item["window_start"], item["window_end"]), ("2026-09-28", "2026-10-10"))
        kinds = {(m["day"], m["kind"], m["in_bank"]) for m in bank["movements"]}
        self.assertIn((4, "EXTRA_100", False), kinds)
        self.assertIn((1, "EXTRA", True), kinds)

    def test_pay_double_decision_goes_to_payroll(self):
        self._work_month(self.schedule)
        self._set_day(4, "TRABALHO", 300)  # 5h no domingo
        self._decide(4, "PAGAR")
        lines, bank = self._payroll(self.schedule)
        hourly = 3000.0 / 200
        self.assertEqual(lines["HE100"]["amount"], round(5 * hourly * 2, 2))
        self.assertIn("100%", lines["HE100"]["reference"])
        self.assertEqual(lines["DSR_HE"]["amount"], round(5 * hourly * 2 / 27 * 4, 2))
        self.assertEqual(bank["month_balance_minutes"], 0)
        self.assertEqual(bank["rest_work"][0]["status"], "PAGAR")
        self.assertEqual(bank["rest_work_pending"], 0)

    def test_folga_decision_is_a_full_day_without_debit(self):
        # 5h no domingo quitadas com a quarta inteira (8h de contrato): sem débito de 3h
        self._work_month(self.schedule)
        self._set_day(4, "TRABALHO", 300)
        self._decide(4, "FOLGA", 7)
        rec = self.db.query(models.RHWorkDay).filter_by(employee_id=self.emp.id, day=7).first()
        self.assertEqual(rec.status, "FOLGA")
        lines, bank = self._payroll(self.schedule)
        self.assertNotIn("HE100", lines)
        self.assertEqual(bank["month_balance_minutes"], 0)
        item = bank["rest_work"][0]
        self.assertEqual((item["status"], item["folga_date"], item["auto"]), ("FOLGA", "2026-10-07", False))
        # Desfazer devolve a quarta ao horário do contrato e a pendência volta
        self._decide(4, None)
        self.assertEqual(rec.status, "TRABALHO")
        _, bank = self._payroll(self.schedule)
        self.assertEqual(bank["rest_work_pending"], 1)

    def test_folga_hours_above_the_day_go_to_common_bank(self):
        self._work_month(self.schedule)
        self._set_day(4, "TRABALHO", 540)  # 9h no domingo
        self._decide(4, "FOLGA", 7)        # quarta de 8h
        _, bank = self._payroll(self.schedule)
        self.assertEqual(bank["month_balance_minutes"], 60)
        self.assertEqual(bank["rest_work"][0]["excess_to_bank_minutes"], 60)

    def test_holiday_worked_on_contract_day_is_100_not_debit(self):
        # Feriado de segunda (12/10), dia de 8h no contrato, trabalhado 5h: 5h a 100%, nunca −3h no banco
        self._work_month(self.schedule)
        self._set_day(12, "TRABALHO", 300)
        with patch("services.rh_ledger.get_effective_holidays_map", return_value={"2026-10-12": "Nossa Senhora Aparecida"}):
            _, bank = self._payroll(self.schedule)
        self.assertEqual(bank["month_balance_minutes"], 0)
        item = bank["rest_work"][0]
        self.assertEqual((item["rest_kind"], item["status"], item["double_minutes"]), ("FERIADO", "PENDENTE", 300))

    def test_folga_in_next_month(self):
        # DSR no último domingo de novembro (29/11) com folga na terça 01/12, dentro do prazo
        from services.rh_rest_work_service import decide_rest_work
        nov = models.RHMonthlySchedule(organization_id=self.org_id, year=2026, month=11)
        self.db.add(nov)
        self.db.flush()
        self._work_month(nov)
        sunday = self.db.query(models.RHWorkDay).filter_by(schedule_id=nov.id, employee_id=self.emp.id, day=29).first()
        sunday.status, sunday.worked_minutes, sunday.raw_minutes = "TRABALHO", 480, 480
        self.db.commit()
        with patch("services.rh_rest_work_service.get_effective_holidays_map", return_value={}):
            decide_rest_work(self.db, self.org_id, self.emp, date(2026, 11, 29), "FOLGA", date(2026, 12, 1), None, None)
        self.db.commit()
        dec = self.db.query(models.RHMonthlySchedule).filter_by(year=2026, month=12).first()
        rec = self.db.query(models.RHWorkDay).filter_by(schedule_id=dec.id, employee_id=self.emp.id, day=1).first()
        self.assertEqual(rec.status, "FOLGA")
        lines, bank = self._payroll(nov)
        self.assertEqual((bank["rest_work"][0]["status"], bank["rest_work"][0]["folga_date"]), ("FOLGA", "2026-12-01"))
        self.assertNotIn("HE100", lines)
        # O repouso está quitado, mas a semana de 23 a 29/11 teve 48h: as 4h acima do limite de 44h
        # são hora extra comum (a folga cai na semana e no período de compensação seguintes)
        self.assertEqual(bank["month_balance_minutes"], 240)
        _, dec_bank = self._payroll(dec)
        self.assertEqual(dec_bank["month_balance_minutes"], 0)  # a folga de 01/12 não vira débito

    def test_folga_outside_window_is_rejected(self):
        from services.rh_rest_work_service import decide_rest_work
        self._work_month(self.schedule)
        self._set_day(4, "TRABALHO", 480)
        with patch("services.rh_rest_work_service.get_effective_holidays_map", return_value={}):
            with self.assertRaises(ValueError):
                decide_rest_work(self.db, self.org_id, self.emp, date(2026, 10, 4), "FOLGA", date(2026, 10, 14), None, None)
            with self.assertRaises(ValueError):  # sábado já é folga do contrato
                decide_rest_work(self.db, self.org_id, self.emp, date(2026, 10, 4), "FOLGA", date(2026, 10, 3), None, None)

    def test_close_requires_rest_work_decisions(self):
        from fastapi import HTTPException
        from api.rh_payroll import close_payroll, PayrollMonth
        self._work_month(self.schedule)
        self._set_day(4, "TRABALHO", 480)
        user = SimpleNamespace(organization_id=self.org_id, id=None)
        with patch("services.rh_payroll_service.get_effective_holidays_map", return_value={}):
            with self.assertRaises(HTTPException):
                close_payroll(PayrollMonth(year=2026, month=10), self.db, user)
            self._decide(4, "PAGAR")
            close_payroll(PayrollMonth(year=2026, month=10), self.db, user)
        self.assertEqual(self.schedule.status, "CLOSED")

    def test_dsr_worked_with_folga_in_week_is_not_double(self):
        self._work_month(self.schedule)
        self._set_day(4, "TRABALHO", 480)  # domingo trabalhado...
        self._set_day(6, "FOLGA")          # ...com folga na terça da mesma semana
        lines, bank = self._payroll(self.schedule)
        self.assertNotIn("HE100", lines)
        self.assertEqual(bank["month_balance_minutes"], 0)
        self.assertEqual((bank["rest_work"][0]["status"], bank["rest_work"][0]["auto"]), ("FOLGA", True))

    def test_auto_swap_with_fewer_hours_has_no_debit(self):
        self._work_month(self.schedule)
        self._set_day(4, "TRABALHO", 300)  # 5h no domingo, folga na terça (8h)
        self._set_day(6, "FOLGA")
        _, bank = self._payroll(self.schedule)
        self.assertEqual(bank["month_balance_minutes"], 0)

    def test_folga_worked_is_regular_overtime(self):
        self._set_policy("PAY")
        self._work_month(self.schedule)
        self._set_day(3, "TRABALHO", 240)  # sábado 03/10 é FOLGA no contrato, não DSR
        lines, bank = self._payroll(self.schedule)
        self.assertNotIn("HE100", lines)
        self.assertEqual(lines["HE50"]["amount"], round(4 * 3000.0 / 200 * 1.5, 2))

    def test_absence_does_not_cancel_overtime(self):
        self._set_policy("PAY")
        self._work_month(self.schedule, extra_days=(1, 2))
        rec = self.db.query(models.RHWorkDay).filter_by(employee_id=self.emp.id, day=7).first()
        rec.status, rec.worked_minutes = "FALTA", 0
        self.db.commit()
        lines, bank = self._payroll(self.schedule)
        self.assertEqual(bank["month_balance_minutes"], 240)
        self.assertIn("HE50", lines)
        self.assertIn("FALTAS", lines)

    def test_bank_only_accumulates_across_months(self):
        self._set_policy("BANK")
        self._work_month(self.schedule, extra_days=(1, 2))  # +4h em out
        nov = models.RHMonthlySchedule(organization_id=self.org_id, year=2026, month=11)
        self.db.add(nov)
        self.db.commit()
        self._work_month(nov, extra_days=(2,))  # +2h em nov
        lines, bank = self._payroll(nov)
        self.assertNotIn("HE50", lines)
        self.assertEqual(bank["previous_balance_minutes"], 240)
        self.assertEqual(bank["balance_minutes"], 360)

    def test_bank_folga_consumes_balance_then_pay_out(self):
        self._set_policy("BANK")
        self._work_month(self.schedule, extra_days=(1, 2, 5, 6), extra_minutes=240)  # +16h
        nov = models.RHMonthlySchedule(organization_id=self.org_id, year=2026, month=11)
        self.db.add(nov)
        self.db.commit()
        self._work_month(nov)
        rec = self.db.query(models.RHWorkDay).filter_by(schedule_id=nov.id, employee_id=self.emp.id, day=2).first()
        rec.status, rec.worked_minutes = "FOLGA_BH", 0
        self.db.commit()
        _, bank = self._payroll(nov)
        self.assertEqual(bank["balance_minutes"], 960 - 480)

        # Decisão do mês: pagar o saldo acumulado
        row = self.db.query(models.RHBankHours).filter_by(schedule_id=nov.id, employee_id=self.emp.id).first()
        row.policy = "PAY_NORMAL"
        self.db.commit()
        lines, bank = self._payroll(nov)
        self.assertEqual(lines["HE50"]["amount"], round(8 * 3000.0 / 200, 2))
        self.assertEqual(bank["balance_minutes"], 0)

    def test_fixed_value_plus_bank(self):
        self._set_policy("FIXED_PLUS_BANK", fixed=10.0)
        self._work_month(self.schedule, extra_days=(1, 2))
        lines, bank = self._payroll(self.schedule)
        self.assertEqual(lines["HE_FIXO"]["amount"], 40.0)
        self.assertNotIn("HE50", lines)
        self.assertEqual(bank["balance_minutes"], 240)

    def test_employee_policy_overrides_company(self):
        self._set_policy("PAY")
        self.emp.overtime_policy = "BANK"
        self.db.commit()
        self._work_month(self.schedule, extra_days=(1, 2))
        lines, bank = self._payroll(self.schedule)
        self.assertNotIn("HE50", lines)
        self.assertEqual(bank["effective_policy"], "BANK")

    def test_default_policy_keeps_hours_in_bank(self):
        self._work_month(self.schedule, extra_days=(1, 2))
        lines, bank = self._payroll(self.schedule)
        self.assertNotIn("HE50", lines)
        self.assertEqual(bank["effective_policy"], "BANK")
        self.assertEqual(bank["balance_minutes"], 240)

    def _bank_entry(self, sched, kind, minutes, pay_mode=None, note="ajuste"):
        self.db.add(models.RHBankHoursEntry(schedule_id=sched.id, employee_id=self.emp.id, kind=kind,
                                            minutes=minutes, pay_mode=pay_mode, note=note))
        self.db.commit()

    def test_partial_payment_keeps_rest_in_bank(self):
        self._work_month(self.schedule, extra_days=(1, 2, 5, 6, 7), extra_minutes=240)  # +20h
        self._bank_entry(self.schedule, "PAYMENT", 360, pay_mode="PAY")  # paga 6h a 50%
        lines, bank = self._payroll(self.schedule)
        self.assertEqual(lines["HE50"]["amount"], round(6 * 3000.0 / 200 * 1.5, 2))
        self.assertEqual(bank["paid_minutes"], 360)
        self.assertEqual(bank["balance_minutes"], 1200 - 360)

    def test_manual_credit_and_debit(self):
        self._work_month(self.schedule)
        self._bank_entry(self.schedule, "CREDIT", 600, note="Saldo de implantação")
        self._bank_entry(self.schedule, "DEBIT", 120, note="Compensação acordada")
        _, bank = self._payroll(self.schedule)
        self.assertEqual(bank["adjustments_minutes"], 480)
        self.assertEqual(bank["balance_minutes"], 480)
        self.assertEqual(len(bank["entries"]), 2)

    def _set_compensation(self, regime):
        st = self.db.query(models.RHSettings).first()
        st.compensation_regime = regime
        self.db.commit()

    def test_monthly_compensation_nets_extra_and_early_leaving(self):
        self._work_month(self.schedule, extra_days=(1,), extra_minutes=120)  # +2h (dia de 10h)
        for d in (5, 6, 7, 8):  # sai 30 min mais cedo em 4 dias
            rec = self.db.query(models.RHWorkDay).filter_by(employee_id=self.emp.id, day=d).first()
            rec.worked_minutes = 450
        self.db.commit()
        _, bank = self._payroll(self.schedule)
        self.assertEqual(bank["balance_minutes"], 0)
        self.assertEqual(bank["movements"], [])

    def test_leaving_early_consumes_bank_daily(self):
        self._set_compensation("BANK_6M")
        self._work_month(self.schedule, extra_days=(1,), extra_minutes=240)  # +4h
        for d in (5, 6, 7, 8):  # sai 1h mais cedo em 4 dias
            rec = self.db.query(models.RHWorkDay).filter_by(employee_id=self.emp.id, day=d).first()
            rec.worked_minutes = 420
        self.db.commit()
        _, bank = self._payroll(self.schedule)
        self.assertEqual(bank["balance_minutes"], 0)
        kinds = [m["kind"] for m in bank["movements"]]
        self.assertEqual(kinds.count("SHORT"), 4)
        self.assertEqual(kinds.count("EXTRA"), 1)

    def test_recalculate_is_idempotent(self):
        first = self._calc()
        second = self._calc()
        self.assertEqual(len(first["entries"]), len(second["entries"]))
        self.assertEqual(first["totals"], second["totals"])


if __name__ == "__main__":
    unittest.main()
