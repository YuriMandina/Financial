"""
Service da Folha de Pagamento
Rubricas (receitas/despesas), lançamentos mensais por colaborador e cálculo automático
de salário, horas extras, faltas, VT/VA e encargos (INSS, IRRF, FGTS).
"""

from typing import Dict, List, Optional, Any
from datetime import date
from sqlalchemy.orm import Session
from models import models
from services.rh_engine import calculate_work_days_summary, get_month_calendar_info
from services.rh_holidays_service import get_effective_holidays_map
from services.rh_salary_service import get_salary_history, salary_for_month, salary_on

# ==============================================================================
# --- [BLOCO: TABELAS LEGAIS 2026] ---
# Revisar a cada atualização anual (salário mínimo, INSS e IRRF).
# ==============================================================================

# INSS empregado (progressivo): (limite superior da faixa, alíquota)
INSS_BRACKETS_2026 = [
    (1621.00, 0.075),
    (2902.84, 0.09),
    (4354.27, 0.12),
    (8475.55, 0.14),
]

# IRRF mensal: (limite superior da faixa, alíquota, parcela a deduzir)
IRRF_BRACKETS_2026 = [
    (2428.80, 0.0, 0.0),
    (2826.65, 0.075, 182.16),
    (3751.05, 0.15, 394.16),
    (4664.68, 0.225, 675.49),
    (float("inf"), 0.275, 908.73),
]
IRRF_DEPENDENT_DEDUCTION = 189.59
IRRF_SIMPLIFIED_DISCOUNT = 607.20

# Redução do IRRF a partir de 2026 (Lei 15.270/2025): isenção até R$ 5.000,00
# e redução decrescente até R$ 7.350,00 de rendimentos tributáveis.
IRRF_REDUCTION_FULL_LIMIT = 5000.00
IRRF_REDUCTION_FULL_VALUE = 312.89
IRRF_REDUCTION_PARTIAL_LIMIT = 7350.00
IRRF_REDUCTION_PARTIAL_BASE = 978.62
IRRF_REDUCTION_PARTIAL_FACTOR = 0.133145

FGTS_RATE = 0.08
VT_DISCOUNT_RATE = 0.06

# Destino das horas extras / saldo do banco de horas
OVERTIME_POLICIES = {
    "PAY": "Pagar com acréscimo",
    "PAY_NORMAL": "Pagar valor normal",
    "FIXED_PLUS_BANK": "Valor fixo + folga (banco)",
    "BANK": "Somente folga (banco de horas)",
}

# ==============================================================================
# --- [BLOCO: RUBRICAS DO SISTEMA] ---
# ==============================================================================

# system_key: (código, nome, tipo, incide_inss, incide_irrf, incide_fgts, afeta_liquido)
SYSTEM_ITEMS = {
    "SALARIO": ("001", "Salário Base", "RECEITA", True, True, True, True),
    "HE50": ("002", "Horas Extras", "RECEITA", True, True, True, True),
    "HE_FIXO": ("005", "Valor Fixo por Horas Extras (Banco)", "RECEITA", True, True, True, True),
    "DSR_HE": ("003", "DSR sobre Horas Extras", "RECEITA", True, True, True, True),
    "TRIENIO": ("004", "Triênio", "RECEITA", True, True, True, True),
    "FALTAS": ("101", "Faltas", "DESPESA", True, True, True, True),
    "DSR_FALTA": ("102", "DSR sobre Faltas", "DESPESA", True, True, True, True),
    "VT": ("103", "Vale Transporte (6%)", "DESPESA", False, False, False, True),
    "ADIANTAMENTO": ("104", "Adiantamento Salarial", "DESPESA", False, False, False, True),
    "INSS": ("201", "INSS", "DESPESA", False, False, False, True),
    "IRRF": ("202", "IRRF", "DESPESA", False, False, False, True),
    "VA": ("901", "Vale Alimentação (benefício)", "RECEITA", False, False, False, False),
    "FGTS": ("902", "FGTS 8% (encargo empresa)", "DESPESA", False, False, False, False),
}

TAX_KEYS = {"INSS", "IRRF", "FGTS"}

# Rubricas do sistema com percentual configurável: system_key -> % padrão
CONFIGURABLE_PERCENT_ITEMS = {"TRIENIO": 4.0, "ADIANTAMENTO": 40.0}


def ensure_system_items(db: Session, organization_id: int) -> Dict[str, models.RHPayrollItem]:
    """Garante as rubricas automáticas da organização e retorna o mapa system_key -> rubrica."""
    existing = {
        it.system_key: it for it in db.query(models.RHPayrollItem).filter(
            models.RHPayrollItem.organization_id == organization_id,
            models.RHPayrollItem.system_key.isnot(None)
        ).all()
    }
    created = False
    for key, (code, name, kind, inss, irrf, fgts, affects_net) in SYSTEM_ITEMS.items():
        if key in existing:
            continue
        item = models.RHPayrollItem(
            organization_id=organization_id, code=code, name=name, kind=kind,
            calc_type="PERCENT" if key in CONFIGURABLE_PERCENT_ITEMS else "FIXED",
            default_value=CONFIGURABLE_PERCENT_ITEMS.get(key, 0.0), recurring=False,
            incide_inss=inss, incide_irrf=irrf, incide_fgts=fgts,
            system_key=key, affects_net=affects_net, active=True
        )
        db.add(item)
        existing[key] = item
        created = True
    if created:
        db.flush()
    return existing


# ==============================================================================
# --- [BLOCO: CÁLCULO DE ENCARGOS] ---
# ==============================================================================

def calc_inss(base: float) -> float:
    total = 0.0
    lower = 0.0
    for upper, rate in INSS_BRACKETS_2026:
        if base <= lower:
            break
        total += (min(base, upper) - lower) * rate
        lower = upper
    return round(total, 2)


def calc_irrf(gross_taxable: float, inss: float, dependents: int) -> float:
    legal_deductions = inss + dependents * IRRF_DEPENDENT_DEDUCTION
    base = max(0.0, gross_taxable - max(legal_deductions, IRRF_SIMPLIFIED_DISCOUNT))

    tax = 0.0
    for upper, rate, deduction in IRRF_BRACKETS_2026:
        if base <= upper:
            tax = base * rate - deduction
            break
    tax = max(0.0, tax)

    if gross_taxable <= IRRF_REDUCTION_FULL_LIMIT:
        tax -= min(tax, IRRF_REDUCTION_FULL_VALUE)
    elif gross_taxable <= IRRF_REDUCTION_PARTIAL_LIMIT:
        reduction = IRRF_REDUCTION_PARTIAL_BASE - IRRF_REDUCTION_PARTIAL_FACTOR * gross_taxable
        tax -= min(tax, max(0.0, reduction))
    return round(max(0.0, tax), 2)


def completed_triennia(admission: Optional[date], reference: date) -> int:
    """Quantidade de triênios (3 anos completos de contrato) até a data de referência."""
    if not admission or admission > reference:
        return 0
    years = reference.year - admission.year
    if (reference.month, reference.day) < (admission.month, admission.day):
        years -= 1
    return max(0, years) // 3


def count_lost_dsr(
    absence_days: List[int],
    work_days: Dict[int, Any],
    schedule: models.RHMonthlySchedule,
    num_days: int,
    mode: str
) -> int:
    """
    Quantidade de DSR perdidos pelas faltas injustificadas do mês (Lei 605/1949, art. 6º).
    - NONE: empregador não desconta o DSR
    - ONE: 1 DSR por semana com falta (regra vigente: um repouso semanal)
    - SCHEDULE: todos os dias marcados como DSR na escala nas semanas com falta (mín. 1)
    """
    if mode == "NONE" or not absence_days:
        return 0

    def week_of(day: int) -> int:
        return date(schedule.year, schedule.month, day).isocalendar()[1]

    weeks = {week_of(d) for d in absence_days}
    if mode != "SCHEDULE":
        return len(weeks)

    total = 0
    for wk in weeks:
        dsr_in_week = sum(
            1 for d in range(1, num_days + 1)
            if week_of(d) == wk and getattr(work_days.get(d), "status", None) == "DSR"
        )
        total += max(1, dsr_in_week)
    return total


def _fmt_hours(minutes: int) -> str:
    sign = "-" if minutes < 0 else ""
    minutes = abs(minutes)
    return f"{sign}{minutes // 60}h{minutes % 60:02d}"


def _get_bank_row(db: Session, schedule_id: int, employee_id: int) -> models.RHBankHours:
    row = db.query(models.RHBankHours).filter(
        models.RHBankHours.schedule_id == schedule_id,
        models.RHBankHours.employee_id == employee_id
    ).first()
    if not row:
        row = models.RHBankHours(schedule_id=schedule_id, employee_id=employee_id)
        db.add(row)
    return row


def _previous_bank_balance(db: Session, schedule: models.RHMonthlySchedule, employee_id: int) -> int:
    """Saldo do banco de horas no fim do mês anterior mais recente calculado."""
    previous = db.query(models.RHBankHours).join(
        models.RHMonthlySchedule, models.RHBankHours.schedule_id == models.RHMonthlySchedule.id
    ).filter(
        models.RHBankHours.employee_id == employee_id,
        models.RHMonthlySchedule.organization_id == schedule.organization_id,
        (models.RHMonthlySchedule.year * 12 + models.RHMonthlySchedule.month) < (schedule.year * 12 + schedule.month)
    ).order_by(models.RHMonthlySchedule.year.desc(), models.RHMonthlySchedule.month.desc()).first()
    return int(previous.balance_minutes or 0) if previous else 0


def daily_bank_movements(emp: models.RHEmployee, work_days: Dict[int, Any]) -> List[Dict[str, Any]]:
    """Movimentos do banco vindos da escala, dia a dia (horas a mais, saídas antecipadas, folgas BH)."""
    weekly = float(emp.weekly_contract_hours or 44.0)
    days_per_week = int(emp.work_days_per_week or 6)
    expected = int(round(weekly / days_per_week * 60))
    movements = []
    for day in sorted(work_days):
        wd = work_days[day]
        if wd.status == "TRABALHO":
            diff = int(wd.worked_minutes or 0) - expected
            if diff:
                movements.append({"day": day, "minutes": diff, "kind": "EXTRA" if diff > 0 else "SHORT"})
        elif wd.status == "FOLGA_BH":
            movements.append({"day": day, "minutes": -expected, "kind": "FOLGA_BH"})
    return movements


def bank_entry_to_dict(e: models.RHBankHoursEntry) -> Dict[str, Any]:
    return {
        "id": e.id,
        "kind": e.kind,
        "minutes": int(e.minutes or 0),
        "pay_mode": e.pay_mode,
        "note": e.note,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


def bank_to_dict(
    row: Optional[models.RHBankHours],
    emp: models.RHEmployee,
    default_policy: str,
    entries: Optional[List[models.RHBankHoursEntry]] = None,
    movements: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    override = row.policy if row else None
    return {
        "policy": override,
        "employee_policy": emp.overtime_policy,
        "effective_policy": override or emp.overtime_policy or default_policy,
        "previous_balance_minutes": int(row.previous_balance_minutes or 0) if row else 0,
        "month_balance_minutes": int(row.month_balance_minutes or 0) if row else 0,
        "adjustments_minutes": int(row.adjustments_minutes or 0) if row else 0,
        "paid_minutes": int(row.paid_minutes or 0) if row else 0,
        "balance_minutes": int(row.balance_minutes or 0) if row else 0,
        "entries": [bank_entry_to_dict(e) for e in (entries or [])],
        "movements": movements or [],
    }


def calculate_payroll_through(db: Session, organization_id: int, schedule: models.RHMonthlySchedule) -> None:
    """
    Recalcula os meses anteriores com escala (em ordem) e depois o mês informado,
    para o saldo acumulado do banco de horas refletir alterações feitas no passado.
    Folhas fechadas (status CLOSED) não são recalculadas.
    """
    earlier = db.query(models.RHMonthlySchedule).filter(
        models.RHMonthlySchedule.organization_id == organization_id,
        (models.RHMonthlySchedule.year * 12 + models.RHMonthlySchedule.month) < (schedule.year * 12 + schedule.month)
    ).order_by(models.RHMonthlySchedule.year.asc(), models.RHMonthlySchedule.month.asc()).all()
    for sched in earlier:
        if sched.status == "CLOSED":
            continue
        has_schedule = db.query(models.RHWorkDay.id).filter(models.RHWorkDay.schedule_id == sched.id).first()
        if has_schedule:
            calculate_payroll(db, organization_id, sched)
    if schedule.status != "CLOSED":
        calculate_payroll(db, organization_id, schedule)


# ==============================================================================
# --- [BLOCO: CÁLCULO DA FOLHA] ---
# ==============================================================================

def calculate_payroll(
    db: Session,
    organization_id: int,
    schedule: models.RHMonthlySchedule,
    employee_ids: Optional[List[int]] = None
) -> int:
    """
    Recalcula os lançamentos automáticos da folha do mês.
    Lançamentos manuais são preservados; se houver lançamento manual de uma rubrica,
    o valor automático dela não é gerado (o manual prevalece).
    Retorna a quantidade de colaboradores calculados.
    """
    system_items = ensure_system_items(db, organization_id)

    settings = db.query(models.RHSettings).filter(
        models.RHSettings.organization_id == organization_id
    ).first()

    emp_query = db.query(models.RHEmployee).filter(
        models.RHEmployee.organization_id == organization_id,
        models.RHEmployee.active == True
    )
    if employee_ids:
        emp_query = emp_query.filter(models.RHEmployee.id.in_(employee_ids))
    employees = emp_query.all()

    recurring_items = db.query(models.RHPayrollItem).filter(
        models.RHPayrollItem.organization_id == organization_id,
        models.RHPayrollItem.system_key.is_(None),
        models.RHPayrollItem.recurring == True,
        models.RHPayrollItem.active == True
    ).all()

    adjustments = db.query(models.RHBenefitAdjustment).filter(
        models.RHBenefitAdjustment.schedule_id == schedule.id
    ).all()

    advance_ids = {
        a.employee_id for a in db.query(models.RHSalaryAdvance).filter(
            models.RHSalaryAdvance.schedule_id == schedule.id,
            models.RHSalaryAdvance.enabled == True
        ).all()
    }

    cal_info = get_month_calendar_info(schedule.year, schedule.month)
    num_days = cal_info["num_days"]
    sundays = set(cal_info["sundays"])
    holidays = get_effective_holidays_map(db, organization_id, schedule.year, schedule.month)
    holiday_days = {int(d.split("-")[2]) for d in holidays.keys()}
    rest_days = len(sundays | holiday_days)
    dsr_mode = getattr(settings, "absence_dsr_mode", None) or "ONE"
    overtime_policy_default = getattr(settings, "overtime_policy", None) or "BANK"
    overtime_rate = float(getattr(settings, "overtime_rate", None) if getattr(settings, "overtime_rate", None) is not None else 50.0)
    overtime_fixed_value = float(getattr(settings, "overtime_fixed_value", None) or 0.0)
    business_days = max(1, num_days - rest_days)

    for emp in employees:
        work_days = {
            wd.day: wd for wd in db.query(models.RHWorkDay).filter(
                models.RHWorkDay.schedule_id == schedule.id,
                models.RHWorkDay.employee_id == emp.id
            ).all()
        }
        summary = calculate_work_days_summary(
            employee=emp, work_days_map=work_days, benefit_adjustments=adjustments,
            year=schedule.year, month=schedule.month, settings=settings
        )

        # Remove os automáticos anteriores; manuais ficam
        db.query(models.RHPayrollEntry).filter(
            models.RHPayrollEntry.schedule_id == schedule.id,
            models.RHPayrollEntry.employee_id == emp.id,
            models.RHPayrollEntry.source == "AUTO"
        ).delete(synchronize_session=False)
        db.flush()

        manual_entries = db.query(models.RHPayrollEntry).filter(
            models.RHPayrollEntry.schedule_id == schedule.id,
            models.RHPayrollEntry.employee_id == emp.id,
            models.RHPayrollEntry.source == "MANUAL"
        ).all()
        manual_item_ids = {e.item_id for e in manual_entries}

        lines: List[tuple] = []  # (item, amount, reference)

        def add_auto(item: models.RHPayrollItem, amount: float, reference: Optional[str] = None):
            amount = round(amount, 2)
            if item.id in manual_item_ids or amount <= 0:
                return
            lines.append((item, amount, reference))

        # Salário do cargo vigente no mês (proporcional se o aumento for no meio do mês)
        salary, salary_reference, end_salary = salary_for_month(
            emp.role_obj, get_salary_history(db, emp.role_id), schedule.year, schedule.month, num_days
        )
        weekly_hours = float(emp.weekly_contract_hours or 44.0)
        hourly_rate = end_salary / (weekly_hours * 5) if weekly_hours else 0.0  # divisor CLT (220h para 44h)
        daily_rate = end_salary / 30

        add_auto(system_items["SALARIO"], salary, salary_reference)

        # Triênio: % do salário base para cada 3 anos completos até o fim do mês
        triennium_item = system_items["TRIENIO"]
        triennia = completed_triennia(emp.admission_date, date(schedule.year, schedule.month, num_days))
        if triennia > 0 and triennium_item.active:
            pct = float(triennium_item.default_value or 0.0)
            add_auto(triennium_item, salary * pct / 100 * triennia,
                     f"{triennia} triênio(s) x {pct:g}%")

        # Banco de horas: saldo anterior + escala do mês + ajustes manuais - pagamentos lançados.
        # O destino automático (política) pode ainda pagar o restante ao fim do mês.
        month_balance = int(summary.get("final_balance_minutes") or 0)
        bank = _get_bank_row(db, schedule.id, emp.id)
        previous_balance = _previous_bank_balance(db, schedule, emp.id)
        policy = bank.policy or emp.overtime_policy or overtime_policy_default

        bank_entries = db.query(models.RHBankHoursEntry).filter(
            models.RHBankHoursEntry.schedule_id == schedule.id,
            models.RHBankHoursEntry.employee_id == emp.id
        ).all()
        bank_adjustments = sum(e.minutes for e in bank_entries if e.kind == "CREDIT") \
            - sum(e.minutes for e in bank_entries if e.kind == "DEBIT")
        paid_by_mode = {"PAY": 0, "PAY_NORMAL": 0}
        for e in bank_entries:
            if e.kind == "PAYMENT":
                paid_by_mode[e.pay_mode if e.pay_mode in paid_by_mode else "PAY"] += e.minutes

        available = previous_balance + month_balance + bank_adjustments
        if policy in ("PAY", "PAY_NORMAL"):
            # Pagamento automático do saldo positivo que restar após os lançamentos
            paid_by_mode[policy] += max(0, available - sum(paid_by_mode.values()))

        paid_minutes = sum(paid_by_mode.values())
        if paid_minutes > 0:
            factor_pay = 1 + overtime_rate / 100
            he_value = round(
                paid_by_mode["PAY"] / 60 * hourly_rate * factor_pay
                + paid_by_mode["PAY_NORMAL"] / 60 * hourly_rate, 2
            )
            parts = []
            if paid_by_mode["PAY"]:
                parts.append(f"{_fmt_hours(paid_by_mode['PAY'])} a {overtime_rate:g}%")
            if paid_by_mode["PAY_NORMAL"]:
                parts.append(f"{_fmt_hours(paid_by_mode['PAY_NORMAL'])} normal")
            add_auto(system_items["HE50"], he_value, " + ".join(parts))
            add_auto(system_items["DSR_HE"], he_value / business_days * rest_days,
                     f"{rest_days}/{business_days} dias")
        if policy == "FIXED_PLUS_BANK" and month_balance > 0:
            add_auto(system_items["HE_FIXO"], month_balance / 60 * overtime_fixed_value,
                     f"{_fmt_hours(month_balance)} x {overtime_fixed_value:.2f}")

        bank.previous_balance_minutes = previous_balance
        bank.month_balance_minutes = month_balance
        bank.adjustments_minutes = bank_adjustments
        bank.paid_minutes = paid_minutes
        bank.balance_minutes = available - paid_minutes

        # Faltas: desconto do dia e perda do DSR da semana
        absence_days = [d for d, wd in work_days.items() if wd.status == "FALTA"]
        if absence_days:
            add_auto(system_items["FALTAS"], len(absence_days) * daily_rate, f"{len(absence_days)} dia(s)")
            dsr_lost = count_lost_dsr(absence_days, work_days, schedule, num_days, dsr_mode)
            add_auto(system_items["DSR_FALTA"], dsr_lost * daily_rate, f"{dsr_lost} DSR")

        # Vale transporte: desconto limitado a 6% do salário base
        vt_amount = float(summary.get("total_vt_amount") or 0.0)
        if vt_amount > 0:
            add_auto(system_items["VT"], min(vt_amount, salary * VT_DISCOUNT_RATE), f"{int(VT_DISCOUNT_RATE * 100)}%")

        # Vale alimentação: benefício informativo (não altera o líquido)
        add_auto(system_items["VA"], float(summary.get("total_va_amount") or 0.0),
                 f"{summary.get('total_va_count_final', 0)} refeição(ões)")

        # Adiantamento salarial: pago somente nos meses marcados para o colaborador
        advance_item = system_items["ADIANTAMENTO"]
        if advance_item.active and emp.id in advance_ids:
            pct = float(advance_item.default_value or 0.0)
            add_auto(advance_item, salary * pct / 100, f"{pct:g}%")

        # Rubricas recorrentes cadastradas pelo operador
        for item in recurring_items:
            value = float(item.default_value or 0.0)
            if item.calc_type == "PERCENT":
                add_auto(item, salary * value / 100, f"{value:g}%")
            else:
                add_auto(item, value)

        # Bases de cálculo a partir de todos os lançamentos (auto + manuais)
        all_lines = [(it, amt) for it, amt, _ in lines] + [(e.item, e.amount) for e in manual_entries]

        def base_for(flag: str) -> float:
            total = 0.0
            for it, amt in all_lines:
                if not getattr(it, flag) or it.system_key in TAX_KEYS:
                    continue
                total += amt if it.kind == "RECEITA" else -amt
            return max(0.0, total)

        inss_base = base_for("incide_inss")
        irrf_base = base_for("incide_irrf")
        fgts_base = base_for("incide_fgts")

        manual_inss = next((e.amount for e in manual_entries if e.item.system_key == "INSS"), None)
        inss = manual_inss if manual_inss is not None else calc_inss(inss_base)
        add_auto(system_items["INSS"], inss, f"base {inss_base:.2f}")
        add_auto(system_items["IRRF"], calc_irrf(irrf_base, inss, int(emp.dependents or 0)),
                 f"base {irrf_base:.2f}")
        add_auto(system_items["FGTS"], fgts_base * FGTS_RATE, f"base {fgts_base:.2f}")

        for item, amount, reference in lines:
            db.add(models.RHPayrollEntry(
                schedule_id=schedule.id, employee_id=emp.id, item_id=item.id,
                reference=reference, amount=amount, source="AUTO"
            ))

    db.commit()
    return len(employees)


def sync_payroll_if_calculated(db: Session, organization_id: int, schedule_id: int) -> bool:
    """
    Mantém a folha em sincronia com a escala: se a folha do mês já foi calculada,
    recalcula os lançamentos automáticos (faltas, horas extras, VT/VA, encargos).
    Falhas aqui não devem impedir o salvamento da escala.
    """
    schedule = db.query(models.RHMonthlySchedule).filter(
        models.RHMonthlySchedule.id == schedule_id,
        models.RHMonthlySchedule.organization_id == organization_id
    ).first()
    if not schedule:
        return False
    has_payroll = db.query(models.RHPayrollEntry.id).filter(
        models.RHPayrollEntry.schedule_id == schedule.id,
        models.RHPayrollEntry.source == "AUTO"
    ).first() is not None
    if not has_payroll:
        return False
    try:
        calculate_payroll(db, organization_id, schedule)
        return True
    except Exception as e:
        db.rollback()
        print(f"Aviso: falha ao sincronizar folha do mês {schedule.month}/{schedule.year}: {e}")
        return False


# ==============================================================================
# --- [BLOCO: CONSULTA DA FOLHA] ---
# ==============================================================================

def entry_to_dict(entry: models.RHPayrollEntry) -> Dict[str, Any]:
    item = entry.item
    return {
        "id": entry.id,
        "item_id": item.id,
        "code": item.code,
        "name": item.name,
        "kind": item.kind,
        "system_key": item.system_key,
        "affects_net": item.affects_net,
        "reference": entry.reference,
        "amount": round(entry.amount or 0.0, 2),
        "source": entry.source,
        "notes": entry.notes,
    }


def get_payroll_month(db: Session, organization_id: int, schedule: models.RHMonthlySchedule) -> Dict[str, Any]:
    employees = db.query(models.RHEmployee).filter(
        models.RHEmployee.organization_id == organization_id,
        models.RHEmployee.active == True
    ).order_by(models.RHEmployee.name.asc()).all()

    entries = db.query(models.RHPayrollEntry).filter(
        models.RHPayrollEntry.schedule_id == schedule.id
    ).all()
    bank_rows = {
        b.employee_id: b for b in db.query(models.RHBankHours).filter(
            models.RHBankHours.schedule_id == schedule.id
        ).all()
    }
    settings = db.query(models.RHSettings).filter(
        models.RHSettings.organization_id == organization_id
    ).first()
    default_policy = (settings.overtime_policy if settings else None) or "BANK"
    bank_entries_by_emp: Dict[int, List[models.RHBankHoursEntry]] = {}
    for be in db.query(models.RHBankHoursEntry).filter(
        models.RHBankHoursEntry.schedule_id == schedule.id
    ).order_by(models.RHBankHoursEntry.created_at.asc(), models.RHBankHoursEntry.id.asc()).all():
        bank_entries_by_emp.setdefault(be.employee_id, []).append(be)
    work_days_by_emp: Dict[int, Dict[int, Any]] = {}
    for wd in db.query(models.RHWorkDay).filter(models.RHWorkDay.schedule_id == schedule.id).all():
        work_days_by_emp.setdefault(wd.employee_id, {})[wd.day] = wd
    advance_ids = {
        a.employee_id for a in db.query(models.RHSalaryAdvance).filter(
            models.RHSalaryAdvance.schedule_id == schedule.id,
            models.RHSalaryAdvance.enabled == True
        ).all()
    }
    by_emp: Dict[int, List[models.RHPayrollEntry]] = {}
    for e in entries:
        by_emp.setdefault(e.employee_id, []).append(e)

    grand = {"receitas": 0.0, "despesas": 0.0, "liquido": 0.0, "fgts": 0.0, "beneficios": 0.0}
    month_end = date(schedule.year, schedule.month, get_month_calendar_info(schedule.year, schedule.month)["num_days"])
    rows = []
    for emp in employees:
        emp_entries = sorted(by_emp.get(emp.id, []), key=lambda e: (e.item.kind != "RECEITA", e.item.code))
        receitas = sum(e.amount for e in emp_entries if e.item.affects_net and e.item.kind == "RECEITA")
        despesas = sum(e.amount for e in emp_entries if e.item.affects_net and e.item.kind == "DESPESA")
        fgts = sum(e.amount for e in emp_entries if e.item.system_key == "FGTS")
        beneficios = sum(e.amount for e in emp_entries
                         if not e.item.affects_net and e.item.system_key != "FGTS")
        totals = {
            "receitas": round(receitas, 2),
            "despesas": round(despesas, 2),
            "liquido": round(receitas - despesas, 2),
            "fgts": round(fgts, 2),
            "beneficios": round(beneficios, 2),
        }
        for k in grand:
            grand[k] += totals[k]
        rows.append({
            "employee_id": emp.id,
            "employee_name": emp.name,
            "employee_role": (emp.role_obj.name if emp.role_obj else emp.role) or "Geral",
            "base_salary": salary_on(emp.role_obj, get_salary_history(db, emp.role_id), month_end),
            "dependents": emp.dependents or 0,
            "admission_date": emp.admission_date.isoformat() if emp.admission_date else None,
            "entries": [entry_to_dict(e) for e in emp_entries],
            "totals": totals,
            "advance": {
                "enabled": emp.id in advance_ids,
                "amount": round(sum(e.amount for e in emp_entries if e.item.system_key == "ADIANTAMENTO"), 2),
            },
            "bank": bank_to_dict(
                bank_rows.get(emp.id), emp, default_policy,
                bank_entries_by_emp.get(emp.id), daily_bank_movements(emp, work_days_by_emp.get(emp.id, {}))
            ),
        })

    # Totais por rubrica (somatório do mês e quantidade de colaboradores)
    row_by_emp = {r["employee_id"]: r for r in rows}
    by_item: Dict[int, Dict[str, Any]] = {}
    for e in entries:
        row = row_by_emp.get(e.employee_id)
        if not row:
            continue
        it = e.item
        agg = by_item.setdefault(it.id, {
            "item_id": it.id, "code": it.code, "name": it.name, "kind": it.kind,
            "system_key": it.system_key, "affects_net": bool(it.affects_net),
            "total": 0.0, "details": []
        })
        agg["total"] += e.amount or 0.0
        agg["details"].append({
            "employee_id": e.employee_id,
            "employee_name": row["employee_name"],
            "employee_role": row["employee_role"],
            "reference": e.reference,
            "amount": round(e.amount or 0.0, 2),
            "source": e.source,
        })
    item_totals = sorted(
        (
            {
                **v,
                "total": round(v["total"], 2),
                "employees": len({d["employee_id"] for d in v["details"]}),
                "details": sorted(v["details"], key=lambda d: (-d["amount"], d["employee_name"])),
            }
            for v in by_item.values()
        ),
        key=lambda v: (v["kind"] != "RECEITA", not v["affects_net"], v["code"])
    )

    # Totais por cargo
    by_role: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        agg = by_role.setdefault(r["employee_role"], {
            "role": r["employee_role"], "headcount": 0,
            "receitas": 0.0, "despesas": 0.0, "liquido": 0.0, "fgts": 0.0, "beneficios": 0.0
        })
        agg["headcount"] += 1
        for k in ("receitas", "despesas", "liquido", "fgts", "beneficios"):
            agg[k] += r["totals"][k]
    role_totals = sorted(
        ({k: (round(v, 2) if isinstance(v, float) else v) for k, v in agg.items()} for agg in by_role.values()),
        key=lambda v: v["role"]
    )

    def item_sum(key: str) -> float:
        return sum(v["total"] for v in item_totals if v["system_key"] == key)

    totals = {k: round(v, 2) for k, v in grand.items()}
    # Custo da empresa: proventos (bruto) + FGTS + benefícios informativos (VA)
    totals.update({
        "headcount": len(rows),
        "inss": round(item_sum("INSS"), 2),
        "irrf": round(item_sum("IRRF"), 2),
        "adiantamento": round(item_sum("ADIANTAMENTO"), 2),
        "custo_empresa": round(totals["receitas"] + totals["fgts"] + totals["beneficios"], 2),
    })

    return {
        "schedule_id": schedule.id,
        "year": schedule.year,
        "month": schedule.month,
        "calculated": any(e.source == "AUTO" for e in entries),
        "employees": rows,
        "totals": totals,
        "item_totals": item_totals,
        "role_totals": role_totals,
    }
