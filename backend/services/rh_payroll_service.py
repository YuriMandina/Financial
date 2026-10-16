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
OVERTIME_RATE = 1.5

# ==============================================================================
# --- [BLOCO: RUBRICAS DO SISTEMA] ---
# ==============================================================================

# system_key: (código, nome, tipo, incide_inss, incide_irrf, incide_fgts, afeta_liquido)
SYSTEM_ITEMS = {
    "SALARIO": ("001", "Salário Base", "RECEITA", True, True, True, True),
    "HE50": ("002", "Horas Extras 50%", "RECEITA", True, True, True, True),
    "DSR_HE": ("003", "DSR sobre Horas Extras", "RECEITA", True, True, True, True),
    "TRIENIO": ("004", "Triênio", "RECEITA", True, True, True, True),
    "FALTAS": ("101", "Faltas", "DESPESA", True, True, True, True),
    "DSR_FALTA": ("102", "DSR sobre Faltas", "DESPESA", True, True, True, True),
    "VT": ("103", "Vale Transporte (6%)", "DESPESA", False, False, False, True),
    "INSS": ("201", "INSS", "DESPESA", False, False, False, True),
    "IRRF": ("202", "IRRF", "DESPESA", False, False, False, True),
    "VA": ("901", "Vale Alimentação (benefício)", "RECEITA", False, False, False, False),
    "FGTS": ("902", "FGTS 8% (encargo empresa)", "DESPESA", False, False, False, False),
}

TAX_KEYS = {"INSS", "IRRF", "FGTS"}

# Rubricas do sistema com percentual configurável: system_key -> % padrão
CONFIGURABLE_PERCENT_ITEMS = {"TRIENIO": 4.0}


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


def _fmt_hours(minutes: int) -> str:
    return f"{minutes // 60}h{minutes % 60:02d}"


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

    cal_info = get_month_calendar_info(schedule.year, schedule.month)
    num_days = cal_info["num_days"]
    sundays = set(cal_info["sundays"])
    holidays = get_effective_holidays_map(db, organization_id, schedule.year, schedule.month)
    holiday_days = {int(d.split("-")[2]) for d in holidays.keys()}
    rest_days = len(sundays | holiday_days)
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

        salary = float(emp.base_salary or 0.0)
        weekly_hours = float(emp.weekly_contract_hours or 44.0)
        hourly_rate = salary / (weekly_hours * 5) if weekly_hours else 0.0  # divisor CLT (220h para 44h)
        daily_rate = salary / 30

        add_auto(system_items["SALARIO"], salary)

        # Triênio: % do salário base para cada 3 anos completos até o fim do mês
        triennium_item = system_items["TRIENIO"]
        triennia = completed_triennia(emp.admission_date, date(schedule.year, schedule.month, num_days))
        if triennia > 0 and triennium_item.active:
            pct = float(triennium_item.default_value or 0.0)
            add_auto(triennium_item, salary * pct / 100 * triennia,
                     f"{triennia} triênio(s) x {pct:g}%")

        # Horas extras: saldo positivo do banco de horas do mês
        balance_min = int(summary.get("final_balance_minutes") or 0)
        he_value = 0.0
        if balance_min > 0 and hourly_rate > 0:
            he_value = round(balance_min / 60 * hourly_rate * OVERTIME_RATE, 2)
            add_auto(system_items["HE50"], he_value, _fmt_hours(balance_min))
            add_auto(system_items["DSR_HE"], he_value / business_days * rest_days,
                     f"{rest_days}/{business_days} dias")

        # Faltas: desconto do dia e perda do DSR da semana
        absence_days = [d for d, wd in work_days.items() if wd.status == "FALTA"]
        if absence_days:
            add_auto(system_items["FALTAS"], len(absence_days) * daily_rate, f"{len(absence_days)} dia(s)")
            weeks_with_absence = {date(schedule.year, schedule.month, d).isocalendar()[1] for d in absence_days}
            add_auto(system_items["DSR_FALTA"], len(weeks_with_absence) * daily_rate,
                     f"{len(weeks_with_absence)} DSR")

        # Vale transporte: desconto limitado a 6% do salário base
        vt_amount = float(summary.get("total_vt_amount") or 0.0)
        if vt_amount > 0:
            add_auto(system_items["VT"], min(vt_amount, salary * VT_DISCOUNT_RATE), f"{int(VT_DISCOUNT_RATE * 100)}%")

        # Vale alimentação: benefício informativo (não altera o líquido)
        add_auto(system_items["VA"], float(summary.get("total_va_amount") or 0.0),
                 f"{summary.get('total_va_count_final', 0)} refeição(ões)")

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
    by_emp: Dict[int, List[models.RHPayrollEntry]] = {}
    for e in entries:
        by_emp.setdefault(e.employee_id, []).append(e)

    grand = {"receitas": 0.0, "despesas": 0.0, "liquido": 0.0, "fgts": 0.0, "beneficios": 0.0}
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
            "base_salary": emp.base_salary or 0.0,
            "dependents": emp.dependents or 0,
            "admission_date": emp.admission_date.isoformat() if emp.admission_date else None,
            "entries": [entry_to_dict(e) for e in emp_entries],
            "totals": totals,
        })

    return {
        "schedule_id": schedule.id,
        "year": schedule.year,
        "month": schedule.month,
        "calculated": any(e.source == "AUTO" for e in entries),
        "employees": rows,
        "totals": {k: round(v, 2) for k, v in grand.items()},
    }
