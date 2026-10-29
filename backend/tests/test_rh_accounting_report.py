import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models import models
from services import rh_accounting_report as accounting
from services.rh_payroll_service import calculate_payroll_through, ensure_system_items, get_payroll_month


class TestAccountingReport(unittest.TestCase):
    """Informe mensal à contabilidade (planejamento v08, seção 20)."""

    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        needed = [
            models.Organization, models.User, models.RHRole, models.RHEmployee, models.RHEmployeeContract,
            models.RHLegalRegime, models.RHContractTemplate,
            models.RHMonthlySchedule, models.RHWorkDay, models.RHWorkDayChange, models.RHRestWorkDecision,
            models.RHSettings, models.RHBenefitAdjustment, models.RHPayrollItem, models.RHPayrollEntry,
            models.RHSalaryChange, models.RHBankHours, models.RHBankHoursEntry, models.RHSalaryAdvance,
            models.RHAccountingReport,
        ]
        models.Base.metadata.create_all(engine, tables=[m.__table__ for m in needed])
        self.db = sessionmaker(bind=engine)()
        org = models.Organization(name="Org Teste", company={"nome_fantasia": "Açougue Teste"})
        self.db.add(org)
        self.db.flush()
        self.org_id = org.id
        self.db.add(models.RHSettings(organization_id=org.id, accounting_signature="Administrativo"))
        self.schedule = models.RHMonthlySchedule(organization_id=org.id, year=2026, month=10)
        self.db.add(self.schedule)
        self.role = models.RHRole(organization_id=org.id, name="Açougueiro", base_salary=3000.0)
        self.db.add(self.role)
        self.db.flush()
        self.emp = self._employee("João da Silva Santos", profile={"contrato": {"matricula": "012"}})
        self.db.commit()
        for target in ("services.rh_ledger.get_effective_holidays_map",
                       "services.rh_payroll_service.get_effective_holidays_map",
                       "services.rh_rest_work_service.get_effective_holidays_map"):
            p = patch(target, return_value={})
            p.start()
            self.addCleanup(p.stop)
        self.items = ensure_system_items(self.db, self.org_id)
        self.db.commit()

    # --- Auxiliares -------------------------------------------------------------------

    def _employee(self, name, **kwargs):
        emp = models.RHEmployee(
            organization_id=self.org_id, name=name, role_id=self.role.id, dependents=0,
            weekly_contract_hours=40.0, work_days_per_week=5,
            default_daily_transport_tickets=0, daily_meal_cost=0, active=kwargs.pop("active", True), **kwargs
        )
        self.db.add(emp)
        self.db.flush()
        eight = {"start": "07:00", "lunch_start": "12:00", "lunch_end": "13:00", "end": "16:00"}
        days = {str(wd): eight for wd in range(5)}
        days.update({"5": {"rest": "FOLGA"}, "6": {"rest": "DSR"}})
        self.db.add(models.RHEmployeeContract(employee_id=emp.id, valid_from=date(2026, 1, 1),
                                              days=days, weekly_min=2400))
        return emp

    def _work_month(self, sched=None, emp=None):
        sched, emp = sched or self.schedule, emp or self.emp
        for d in range(1, 32):
            try:
                wd = date(sched.year, sched.month, d)
            except ValueError:
                break
            status = "TRABALHO" if wd.weekday() < 5 else "DSR"
            minutes = 480 if status == "TRABALHO" else 0
            self.db.add(models.RHWorkDay(schedule_id=sched.id, employee_id=emp.id, day=d,
                                         status=status, worked_minutes=minutes, raw_minutes=minutes))
        self.db.commit()

    def _set_days(self, days, status, minutes=0, emp=None):
        emp = emp or self.emp
        for day in days:
            rec = self.db.query(models.RHWorkDay).filter_by(
                schedule_id=self.schedule.id, employee_id=emp.id, day=day).first()
            rec.status, rec.worked_minutes, rec.raw_minutes = status, minutes, minutes
        self.db.commit()

    def _manual(self, item, amount, notes=None, quantity=None, unit=None, emp=None):
        self.db.add(models.RHPayrollEntry(
            schedule_id=self.schedule.id, employee_id=(emp or self.emp).id, item_id=item.id, amount=amount,
            notes=notes, quantity=quantity, quantity_unit=unit, source="MANUAL"))
        self.db.commit()

    def _report(self):
        calculate_payroll_through(self.db, self.org_id, self.schedule)
        return accounting.get_report(self.db, self.org_id, self.schedule)

    def _emp_content(self, report, name="JOÃO DA SILVA SANTOS"):
        return next(e for e in report["content"]["employees"] if e["name"] == name)

    def _close(self):
        from api.rh_payroll import close_payroll, PayrollMonth
        close_payroll(PayrollMonth(year=2026, month=10), self.db, SimpleNamespace(organization_id=self.org_id, id=None))

    def _reopen(self):
        from api.rh_payroll import reopen_payroll, PayrollMonth
        reopen_payroll(PayrollMonth(year=2026, month=10), self.db, SimpleNamespace(organization_id=self.org_id, id=None))

    # --- Rubricas ---------------------------------------------------------------------

    def test_only_variable_items_with_quantity_or_value(self):
        self._work_month()
        self._set_days([6], "FALTA")
        self.db.add(models.RHSalaryAdvance(schedule_id=self.schedule.id, employee_id=self.emp.id, enabled=True))
        vale = models.RHPayrollItem(organization_id=self.org_id, code="150", name="Vale", kind="DESPESA")
        self.db.add(vale)
        self.db.commit()
        self._manual(self.items["PREMIO"], 300.0)
        self._manual(vale, 150.0, notes="compra no mercado")

        emp = self._emp_content(self._report())
        by_label = {l["label"]: l for l in emp["items"]}
        self.assertEqual(set(by_label), {"Prêmio", "Faltas", "Vale"})  # sem salário, DSR, adiantamento, encargos
        self.assertEqual((by_label["Faltas"]["quantity"], by_label["Faltas"]["unit"]), (1, "DIAS"))
        self.assertEqual(by_label["Faltas"]["dates"], ["2026-10-06"])
        self.assertEqual(accounting.item_value_text(by_label["Faltas"]), "1 dia (06/10)")
        self.assertEqual(accounting.item_value_text(by_label["Prêmio"]), "R$ 300,00")
        self.assertEqual(accounting.item_value_text(by_label["Vale"]), "R$ 150,00 (compra no mercado)")

    def test_he100_in_hours_with_dates(self):
        from services.rh_rest_work_service import decide_rest_work
        self._work_month()
        self._set_days([4], "TRABALHO", 300)  # 5h no domingo 04/10, pago em dobro
        decide_rest_work(self.db, self.org_id, self.emp, date(2026, 10, 4), "PAGAR", None, None, None)
        self.db.commit()
        line = next(l for l in self._emp_content(self._report())["items"] if l["label"] == "HE 100%")
        self.assertEqual((line["quantity"], line["unit"], line["dates"]), (300, "MIN", ["2026-10-04"]))
        self.assertEqual(accounting.item_value_text(line), "5h00 (04/10)")

    def test_overtime_paid_with_rate_uses_configured_percent(self):
        st = self.db.query(models.RHSettings).first()
        st.overtime_policy = "PAY"
        self.db.commit()
        self._work_month()
        self._set_days([1, 2], "TRABALHO", 600)  # +2h em cada dia
        line = next(l for l in self._emp_content(self._report())["items"] if l["label"] == "HE 50%")
        self.assertEqual(accounting.item_value_text(line), "4h00")

    def test_manual_override_keeps_informed_quantity(self):
        self._work_month()
        self._manual(self.items["HE50"], 90.0, quantity=240, unit="MIN")
        line = next(l for l in self._emp_content(self._report())["items"] if l["label"] == "HE 50%")
        self.assertEqual(accounting.item_value_text(line), "4h00")

    def test_item_unchecked_is_not_reported(self):
        self._work_month()
        self.items["PREMIO"].report_to_accounting = False
        self.db.commit()
        self._manual(self.items["PREMIO"], 300.0)
        self.assertEqual(self._emp_content(self._report())["items"], [])

    def test_existing_items_get_defaults_once(self):
        custom = models.RHPayrollItem(organization_id=self.org_id, code="160", name="Empréstimo", kind="DESPESA")
        self.db.add(custom)
        self.db.flush()
        self.items["SALARIO"].report_mode = None
        self.items["FALTAS"].report_mode = None
        custom.report_mode = None
        self.db.commit()
        ensure_system_items(self.db, self.org_id)
        self.assertEqual((self.items["SALARIO"].report_to_accounting, self.items["SALARIO"].report_mode), (False, "VALOR"))
        self.assertEqual((self.items["FALTAS"].report_to_accounting, self.items["FALTAS"].report_mode), (True, "QUANTIDADE"))
        self.assertEqual((custom.report_to_accounting, custom.report_mode), (True, "VALOR"))
        # Uma vez preenchido, a escolha do usuário é mantida
        self.items["FALTAS"].report_to_accounting = False
        self.db.commit()
        ensure_system_items(self.db, self.org_id)
        self.assertFalse(self.items["FALTAS"].report_to_accounting)

    # --- Eventos ----------------------------------------------------------------------

    def test_vacation_period_crosses_weekend(self):
        self._work_month()
        self._set_days(list(range(5, 10)) + list(range(12, 17)), "FERIAS")  # 10 e 11 seguem como DSR
        events = self._emp_content(self._report())["events"]
        self.assertEqual([accounting.event_text(e) for e in events], ["Férias de 05/10 a 16/10 (12 dias)"])

    def test_long_medical_leave_is_flagged(self):
        self._work_month()
        self._set_days([d for d in range(1, 18) if date(2026, 10, d).weekday() < 5], "ATESTADO")
        self._set_days([20], "ATESTADO")  # outro atestado, separado por dias de trabalho
        texts = [accounting.event_text(e) for e in self._emp_content(self._report())["events"]]
        self.assertEqual(texts, [
            "Atestado de 01/10 a 16/10 (16 dias) — afastamento pelo INSS a partir do 16º dia",
            "Atestado em 20/10 (1 dia)",
        ])

    def test_admission_and_termination_in_month(self):
        self.emp.admission_date = date(2026, 10, 6)
        self.emp.termination_date = date(2026, 10, 20)
        self.emp.termination_reason = "SEM_JUSTA_CAUSA"
        self.emp.active = False  # desligado continua na folha do mês do desligamento
        self.db.commit()
        self._work_month()
        texts = [accounting.event_text(e) for e in self._emp_content(self._report())["events"]]
        self.assertEqual(texts, ["Admissão em 06/10/2026", "Desligamento em 20/10/2026 — dispensa sem justa causa"])

        nov = models.RHMonthlySchedule(organization_id=self.org_id, year=2026, month=11)
        self.db.add(nov)
        self.db.commit()
        self.assertEqual(get_payroll_month(self.db, self.org_id, nov)["employees"], [])

    # --- Texto ------------------------------------------------------------------------

    def test_text_groups_by_employee_and_lists_without_variables(self):
        other = self._employee("Ana Pereira Lima")
        self.db.commit()
        self._work_month()
        self._work_month(emp=other)
        self._set_days([14], "FALTA")
        self._manual(self.items["PREMIO"], 300.0)
        text = self._report()["text"]
        self.assertIn("Assunto: Variáveis da folha — Outubro/2026 — Açougue Teste", text)
        self.assertIn("JOÃO DA SILVA SANTOS (matr. 012)\n  Proventos: Prêmio — R$ 300,00\n"
                      "  Descontos: Faltas — 1 dia (14/10)", text)
        self.assertIn("Sem variáveis no mês: ANA PEREIRA LIMA.", text)
        self.assertTrue(text.endswith("\n\nAdministrativo"))

    # --- Situações, versões e retificação ---------------------------------------------

    def test_send_flow_and_rectification(self):
        self._work_month()
        self._set_days([14], "FALTA")
        report = self._report()
        self.assertEqual(report["status"], "FOLHA_ABERTA")
        self.assertFalse(report["can_send"])
        with self.assertRaises(ValueError):
            accounting.mark_sent(self.db, self.org_id, self.schedule, None)

        self._close()
        self.assertEqual(self._report()["status"], "PRONTO")
        sent = accounting.mark_sent(self.db, self.org_id, self.schedule, None)
        self.assertEqual(sent["status"], "ENVIADO")
        self.assertEqual(sent["versions"][0]["version"], 1)
        with self.assertRaises(ValueError):  # nada mudou
            accounting.mark_sent(self.db, self.org_id, self.schedule, None)

        self._reopen()
        self._set_days([14], "TRABALHO", 480)
        self._set_days([15, 16], "FALTA")
        self._manual(self.items["PREMIO"], 300.0)
        self._close()
        report = self._report()
        self.assertEqual(report["status"], "DESATUALIZADO")
        rect = report["rectification_text"]
        self.assertIn("Assunto: Retificação — Variáveis da folha — Outubro/2026", rect)
        self.assertIn("  Incluir: Prêmio — R$ 300,00", rect)
        self.assertIn("  Faltas: de 1 dia (14/10) para 2 dias (15/10, 16/10)", rect)

        sent = accounting.mark_sent(self.db, self.org_id, self.schedule, None)
        self.assertEqual(sent["status"], "ENVIADO")
        self.assertEqual([v["version"] for v in sent["versions"]], [2, 1])
        self.assertEqual(sent["versions"][0]["text"], rect)

    def test_api_routes(self):
        from fastapi import HTTPException
        from api.rh_payroll import (PayrollMonth, export_accounting_report, get_accounting_report,
                                    mark_accounting_report_sent)
        from api.rh import _termination_reason
        user = SimpleNamespace(organization_id=self.org_id, id=None)
        self._work_month()
        self._manual(self.items["PREMIO"], 300.0)
        self.assertEqual(get_accounting_report(2026, 10, self.db, user)["status"], "FOLHA_ABERTA")
        with self.assertRaises(HTTPException):
            mark_accounting_report_sent(PayrollMonth(year=2026, month=10), self.db, user)
        self._close()
        self.assertEqual(mark_accounting_report_sent(PayrollMonth(year=2026, month=10), self.db, user)["status"], "ENVIADO")
        pdf = export_accounting_report(2026, 10, "pdf", 1, self.db, user)
        self.assertEqual(pdf.media_type, "application/pdf")
        self.assertIn("informe_contabilidade_2026-10_v1.pdf", pdf.headers["content-disposition"])
        with self.assertRaises(HTTPException):  # versão inexistente
            export_accounting_report(2026, 10, "csv", 9, self.db, user)
        with self.assertRaises(HTTPException):
            _termination_reason(date(2026, 10, 20), "INVALIDO")
        self.assertIsNone(_termination_reason(None, "PEDIDO"))

    def test_exports(self):
        self._work_month()
        self._manual(self.items["PREMIO"], 300.0)
        content = self._report()["content"]
        csv_text = accounting.content_to_csv(content).decode("utf-8-sig")
        self.assertIn("JOÃO DA SILVA SANTOS;012;Provento;Prêmio;R$ 300,00", csv_text)
        pdf = accounting.content_to_pdf(content, "Açougue Teste")
        self.assertTrue(pdf.startswith(b"%PDF"))


if __name__ == "__main__":
    unittest.main()
