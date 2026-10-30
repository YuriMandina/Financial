"""
Service da Folha de Pagamento
Rubricas (receitas/despesas), lançamentos mensais por colaborador e cálculo automático
de salário, horas extras, faltas, VT/VA e encargos (INSS, IRRF, FGTS).
"""

from typing import Dict, List, Optional, Any
from datetime import date
from sqlalchemy import or_
from sqlalchemy.orm import Session
from models import models
from services.rh_engine import calculate_work_days_summary, get_month_calendar_info
from services.rh_contracts import contract_on
from services.rh_ledger import load_month_ledgers, rest_folga_window
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
    "HE_NORMAL": ("008", "Horas Pagas sem Acréscimo", "RECEITA", True, True, True, True),
    "HE100": ("006", "Horas Extras 100% (DSR/feriado)", "RECEITA", True, True, True, True),
    "HE_FIXO": ("005", "Valor Fixo por Horas Extras (Banco)", "RECEITA", True, True, True, True),
    "DSR_HE": ("003", "DSR sobre Horas Extras", "RECEITA", True, True, True, True),
    "TRIENIO": ("004", "Triênio", "RECEITA", True, True, True, True),
    "PREMIO": ("007", "Prêmio", "RECEITA", True, True, True, True),
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

# Rubricas do sistema lançadas à mão, com incidências editáveis (prêmio: confirmar com a contabilidade)
CONFIGURABLE_INCIDENCE_ITEMS = {"PREMIO"}

# Informe à contabilidade (v08 seção 20.3): system_key -> (informa, forma). Ausentes não são informados:
# a contabilidade calcula ou já tem (salário, triênio, DSR, VT, VA, adiantamento e encargos).
ACCOUNTING_REPORT_DEFAULTS = {
    "HE50": (True, "QUANTIDADE"),
    "HE_NORMAL": (True, "QUANTIDADE"),
    "HE100": (True, "QUANTIDADE"),
    "HE_FIXO": (True, "VALOR"),
    "FALTAS": (True, "QUANTIDADE"),
    "PREMIO": (True, "VALOR"),
}
REPORT_MODES = {"QUANTIDADE", "VALOR"}


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
        report, mode = ACCOUNTING_REPORT_DEFAULTS.get(key, (False, "VALOR"))
        item = models.RHPayrollItem(
            organization_id=organization_id, code=code, name=name, kind=kind,
            calc_type="PERCENT" if key in CONFIGURABLE_PERCENT_ITEMS else "FIXED",
            default_value=CONFIGURABLE_PERCENT_ITEMS.get(key, 0.0), recurring=False,
            incide_inss=inss, incide_irrf=irrf, incide_fgts=fgts,
            system_key=key, affects_net=affects_net, active=True,
            report_to_accounting=report, report_mode=mode
        )
        db.add(item)
        existing[key] = item
        created = True

    # Rubricas anteriores ao informe à contabilidade (colunas novas vazias): aplica os padrões uma vez
    for item in db.query(models.RHPayrollItem).filter(
        models.RHPayrollItem.organization_id == organization_id,
        models.RHPayrollItem.report_mode.is_(None)
    ).all():
        if item.system_key:
            report, mode = ACCOUNTING_REPORT_DEFAULTS.get(item.system_key, (False, "VALOR"))
        else:
            report, mode = True, "VALOR"
        item.report_to_accounting, item.report_mode = report, mode
        created = True
    if created:
        db.flush()
    return existing


def payroll_employees(db: Session, organization_id: int, schedule: models.RHMonthlySchedule) -> List[models.RHEmployee]:
    """
    Colaboradores da folha do mês: ativos sem desligamento anterior ao mês e desligados dentro do mês
    (mesmo já inativos), que continuam na folha do mês do desligamento.
    """
    month_start = date(schedule.year, schedule.month, 1)
    employees = db.query(models.RHEmployee).filter(
        models.RHEmployee.organization_id == organization_id,
        or_(models.RHEmployee.active == True, models.RHEmployee.termination_date >= month_start)
    ).order_by(models.RHEmployee.name.asc()).all()
    return [e for e in employees if not e.termination_date or e.termination_date >= month_start]


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


def daily_bank_movements(ledger: Dict[date, Any]) -> List[Dict[str, Any]]:
    """
    Movimentos do banco vindos do ledger, dia a dia (horas extras, saídas antecipadas, folgas BH).
    EXTRA_100 (repouso/feriado sem folga compensatória) aparece no extrato, mas fica fora do saldo:
    é pago a 100% na folha do mês.
    """
    movements = []
    for d in sorted(ledger):
        dl = ledger[d]
        if dl.extra_double_min:
            movements.append({"day": d.day, "minutes": dl.extra_double_min, "kind": "EXTRA_100", "in_bank": False})
        elif dl.extra_min:
            movements.append({"day": d.day, "minutes": dl.extra_min, "kind": "EXTRA", "in_bank": True})
        if dl.short_min:
            kind = "FOLGA_BH" if dl.status == "FOLGA_BH" else "SHORT"
            movements.append({"day": d.day, "minutes": -dl.short_min, "kind": kind, "in_bank": True})
    return movements


def rest_work_items(ledger: Dict[date, Any]) -> List[Dict[str, Any]]:
    """
    DSR/feriado trabalhado no mês (horas 100%): situação e prazo da folga compensatória.
    FOLGA = quitado com folga de dia inteiro (troca na escala ou decisão); PAGAR = em dobro na folha;
    PENDENTE = precisa de decisão antes de fechar a folha do mês.
    """
    items = []
    for d in sorted(ledger):
        dl = ledger[d]
        if dl.status != "TRABALHO" or not dl.rest_kind:
            continue
        status = "FOLGA" if dl.rest_full_day else ("PAGAR" if dl.rest_decision == "PAGAR" else "PENDENTE")
        start, end = rest_folga_window(d, dl.rest_kind)
        items.append({
            "date": d.isoformat(),
            "rest_kind": dl.rest_kind,
            "worked_minutes": dl.worked_min,
            "status": status,
            "auto": bool(dl.rest_swap_auto),
            "folga_date": dl.rest_swap_with.isoformat() if dl.rest_full_day and dl.rest_swap_with else None,
            "double_minutes": dl.extra_double_min,
            "excess_to_bank_minutes": dl.extra_min if dl.rest_full_day else 0,
            "window_start": start.isoformat(),
            "window_end": end.isoformat(),
        })
    return items


def bank_entry_to_dict(e: models.RHBankHoursEntry) -> Dict[str, Any]:
    return {
        "id": e.id,
        "kind": e.kind,
        "minutes": int(e.minutes or 0),
        "pay_mode": e.pay_mode,
        "note": e.note,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }




# ==============================================================================
# --- [BLOCO: RASTREAMENTO DE AGING E CCT DO BANCO DE HORAS] ---
# ==============================================================================

def compute_bank_aging_map(
    db: Session,
    organization_id: int,
    target_schedule: models.RHMonthlySchedule,
    employees: List[models.RHEmployee],
    settings: Optional[models.RHSettings] = None
) -> Dict[int, Dict[str, Any]]:
    """
    Calcula a idade (aging) das horas extras no banco de horas com controle FIFO e regra da CCT:
    - O banco de horas tem prazo fatal de quitacao de 3 meses conforme a CCT.
    - O fluxo operacional habitual acumula em um mes e compensa (folgas) no mes seguinte.
    - FIFO: folgas na escala, saidas antecipadas, debitos e pagamentos abatem sempre o saldo mais antigo primeiro.
    - Classificacao por idade dos baldes positivos remanescentes:
        * status='CURRENT' (0 meses): acumulado no proprio mes em apuracao.
        * status='FOLGA_PROXIMO' (1 mes): acumulado no mes anterior, periodo padrao para conceder folgas.
        * status='WARNING' (2 meses): acumulado ha 2 meses, necessita de agendamento de folga.
        * status='EXPIRED' (3+ meses): atingiu o limite da CCT, deve ser pago na folha de pagamento.
    """
    emp_ids = [e.id for e in employees]
    if not emp_ids:
        return {}

    all_scheds = db.query(models.RHMonthlySchedule).filter(
        models.RHMonthlySchedule.organization_id == organization_id,
        (models.RHMonthlySchedule.year * 12 + models.RHMonthlySchedule.month) <= (target_schedule.year * 12 + target_schedule.month)
    ).order_by(models.RHMonthlySchedule.year.asc(), models.RHMonthlySchedule.month.asc()).all()

    sched_ids = [s.id for s in all_scheds]
    sched_map = {s.id: s for s in all_scheds}

    all_entries = db.query(models.RHBankHoursEntry).filter(
        models.RHBankHoursEntry.schedule_id.in_(sched_ids),
        models.RHBankHoursEntry.employee_id.in_(emp_ids)
    ).all()
    entries_map: Dict[Tuple[int, int], List[models.RHBankHoursEntry]] = {}
    for e in all_entries:
        entries_map.setdefault((e.schedule_id, e.employee_id), []).append(e)

    all_bank_rows = db.query(models.RHBankHours).filter(
        models.RHBankHours.schedule_id.in_(sched_ids),
        models.RHBankHours.employee_id.in_(emp_ids)
    ).all()
    bank_rows_map = {(r.schedule_id, r.employee_id): r for r in all_bank_rows}

    ledgers_by_sched = {}
    for s in all_scheds:
        ledgers_by_sched[s.id] = load_month_ledgers(db, organization_id, s, employees, settings)

    target_idx = target_schedule.year * 12 + target_schedule.month
    result: Dict[int, Dict[str, Any]] = {}

    for emp in employees:
        buckets: List[Dict[str, Any]] = []
        for s in all_scheds:
            emp_ledger = ledgers_by_sched[s.id].get(emp.id, {})
            mvs = daily_bank_movements(emp_ledger)
            scale_pos = sum(m['minutes'] for m in mvs if m.get('in_bank') and m['minutes'] > 0)
            scale_neg = sum(-m['minutes'] for m in mvs if m.get('in_bank') and m['minutes'] < 0)

            ents = entries_map.get((s.id, emp.id), [])
            cred = sum(e.minutes for e in ents if e.kind == 'CREDIT')
            deb = sum(e.minutes for e in ents if e.kind == 'DEBIT')
            paid = sum(e.minutes for e in ents if e.kind == 'PAYMENT')

            r = bank_rows_map.get((s.id, emp.id))
            auto_paid = max(0, (r.paid_minutes or 0) - paid) if r else 0
            total_paid = paid + auto_paid

            consumed = scale_neg + deb + total_paid
            while consumed > 0 and buckets:
                first = buckets[0]
                if first['remaining_minutes'] <= consumed:
                    consumed -= first['remaining_minutes']
                    buckets.pop(0)
                else:
                    first['remaining_minutes'] -= consumed
                    consumed = 0

            added = scale_pos + cred
            if consumed > 0:
                added -= consumed

            if added > 0:
                buckets.append({
                    'year': s.year,
                    'month': s.month,
                    'origin_minutes': added,
                    'remaining_minutes': added
                })
            elif added < 0:
                buckets = [{
                    'year': s.year,
                    'month': s.month,
                    'origin_minutes': added,
                    'remaining_minutes': added
                }]

        aging_buckets = []
        expired_min = 0
        warning_min = 0
        folga_min = 0
        current_min = 0

        for b in buckets:
            rem = b['remaining_minutes']
            if rem <= 0:
                continue
            age = target_idx - (b['year'] * 12 + b['month'])
            if age >= 3:
                st = 'EXPIRED'
                expired_min += rem
            elif age == 2:
                st = 'WARNING'
                warning_min += rem
            elif age == 1:
                st = 'FOLGA_PROXIMO'
                folga_min += rem
            else:
                st = 'CURRENT'
                current_min += rem

            aging_buckets.append({
                'year': b['year'],
                'month': b['month'],
                'origin_minutes': b['origin_minutes'],
                'remaining_minutes': rem,
                'age_months': age,
                'status': st
            })

        result[emp.id] = {
            'buckets': aging_buckets,
            'expired_minutes': expired_min,
            'warning_minutes': warning_min,
            'folga_proximo_minutes': folga_min,
            'current_minutes': current_min,
            'total_positive_minutes': sum(b['remaining_minutes'] for b in aging_buckets)
        }

    return result


def bank_to_dict(
    row: Optional[models.RHBankHours],
    emp: models.RHEmployee,
    default_policy: str,
    entries: Optional[List[models.RHBankHoursEntry]] = None,
    movements: Optional[List[Dict[str, Any]]] = None,
    rest_work: Optional[List[Dict[str, Any]]] = None,
    aging: Optional[Dict[str, Any]] = None
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
        "rest_work": rest_work or [],
        "rest_work_pending": sum(1 for r in (rest_work or []) if r["status"] == "PENDENTE"),
        "aging": aging or {
            "buckets": [],
            "expired_minutes": 0,
            "warning_minutes": 0,
            "folga_proximo_minutes": 0,
            "current_minutes": 0,
            "total_positive_minutes": 0
        },
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

    employees = payroll_employees(db, organization_id, schedule)
    if employee_ids:
        employees = [e for e in employees if e.id in employee_ids]

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
    ledgers = load_month_ledgers(db, organization_id, schedule, employees, settings)
    month_end = date(schedule.year, schedule.month, num_days)

    for emp in employees:
        work_days = {
            wd.day: wd for wd in db.query(models.RHWorkDay).filter(
                models.RHWorkDay.schedule_id == schedule.id,
                models.RHWorkDay.employee_id == emp.id
            ).all()
        }
        summary = calculate_work_days_summary(
            employee=emp, work_days_map=work_days, benefit_adjustments=adjustments,
            year=schedule.year, month=schedule.month, settings=settings, ledger=ledgers[emp.id]
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

        lines: List[tuple] = []  # (item, amount, reference, quantidade: (valor, unidade, datas) | None)

        def add_auto(item: models.RHPayrollItem, amount: float, reference: Optional[str] = None,
                     quantity: Optional[tuple] = None):
            amount = round(amount, 2)
            if item.id in manual_item_ids or amount <= 0:
                return
            lines.append((item, amount, reference, quantity))

        # Salário do cargo vigente no mês (proporcional se o aumento for no meio do mês)
        salary, salary_reference, end_salary = salary_for_month(
            emp.role_obj, get_salary_history(db, emp.role_id), schedule.year, schedule.month, num_days
        )
        # Divisor pela jornada do contrato vigente no fim do mês: 220h (44h), 210h (42h), 200h (40h)
        contract = contract_on(emp.contracts, month_end)
        weekly_hours = (contract.weekly_min / 60) if contract and contract.weekly_min else float(emp.weekly_contract_hours or 44.0)
        hourly_rate = end_salary / (weekly_hours * 5) if weekly_hours else 0.0
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
        he_value = 0.0
        if paid_minutes > 0:
            factor_pay = 1 + overtime_rate / 100
            he_rate_value = round(paid_by_mode["PAY"] / 60 * hourly_rate * factor_pay, 2)
            he_normal_value = round(paid_by_mode["PAY_NORMAL"] / 60 * hourly_rate, 2)
            he_value = he_rate_value + he_normal_value
            add_auto(system_items["HE50"], he_rate_value,
                     f"{_fmt_hours(paid_by_mode['PAY'])} a {overtime_rate:g}%", (paid_by_mode["PAY"], "MIN", None))
            add_auto(system_items["HE_NORMAL"], he_normal_value,
                     f"{_fmt_hours(paid_by_mode['PAY_NORMAL'])} normal", (paid_by_mode["PAY_NORMAL"], "MIN", None))

        # DSR/feriado trabalhado sem folga compensatória que o administrativo decidiu pagar em dobro
        # (aba Banco de horas). Quitado no próprio mês, fora do banco comum (Lei 605/49 art. 9º; Súmula 146 TST)
        double_minutes = int(summary.get("double_to_pay_minutes") or 0)
        he_double_value = round(double_minutes / 60 * hourly_rate * 2, 2) if double_minutes > 0 else 0.0
        if he_double_value:
            days_double = int(summary.get("double_to_pay_days") or 0)
            double_dates = [d.isoformat() for d, dl in sorted(ledgers[emp.id].items())
                            if dl.double_to_pay_min and d.month == schedule.month]
            add_auto(system_items["HE100"], he_double_value,
                     f"{_fmt_hours(double_minutes)} a 100% ({days_double} dia(s))",
                     (double_minutes, "MIN", double_dates))

        # Reflexo das horas extras habituais no DSR (Súmula 172 TST; Lei 605/49 art. 7º)
        if he_value + he_double_value > 0:
            add_auto(system_items["DSR_HE"], (he_value + he_double_value) / business_days * rest_days,
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
        absence_days = sorted(d for d, wd in work_days.items() if wd.status == "FALTA")
        if absence_days:
            add_auto(system_items["FALTAS"], len(absence_days) * daily_rate, f"{len(absence_days)} dia(s)",
                     (len(absence_days), "DIAS",
                      [date(schedule.year, schedule.month, d).isoformat() for d in absence_days]))
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
        all_lines = [(it, amt) for it, amt, _, _ in lines] + [(e.item, e.amount) for e in manual_entries]

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

        for item, amount, reference, quantity in lines:
            qty, unit, dates = quantity or (None, None, None)
            db.add(models.RHPayrollEntry(
                schedule_id=schedule.id, employee_id=emp.id, item_id=item.id,
                reference=reference, amount=amount, source="AUTO",
                quantity=qty, quantity_unit=unit, dates=dates
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
        "quantity": entry.quantity,
        "quantity_unit": entry.quantity_unit,
        "dates": entry.dates or [],
        "report_to_accounting": bool(item.report_to_accounting),
        "report_mode": item.report_mode or "VALOR",
        "source": entry.source,
        "notes": entry.notes,
    }


def get_payroll_month(db: Session, organization_id: int, schedule: models.RHMonthlySchedule) -> Dict[str, Any]:
    employees = payroll_employees(db, organization_id, schedule)

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
    ledgers = load_month_ledgers(db, organization_id, schedule, employees, settings)
    advance_ids = {
        a.employee_id for a in db.query(models.RHSalaryAdvance).filter(
            models.RHSalaryAdvance.schedule_id == schedule.id,
            models.RHSalaryAdvance.enabled == True
        ).all()
    }
    by_emp: Dict[int, List[models.RHPayrollEntry]] = {}
    for e in entries:
        by_emp.setdefault(e.employee_id, []).append(e)

    aging_by_emp = compute_bank_aging_map(db, organization_id, schedule, employees, settings)

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
            "termination_date": emp.termination_date.isoformat() if emp.termination_date else None,
            "entries": [entry_to_dict(e) for e in emp_entries],
            "totals": totals,
            "advance": {
                "enabled": emp.id in advance_ids,
                "amount": round(sum(e.amount for e in emp_entries if e.item.system_key == "ADIANTAMENTO"), 2),
            },
            "bank": bank_to_dict(
                bank_rows.get(emp.id), emp, default_policy,
                bank_entries_by_emp.get(emp.id), daily_bank_movements(ledgers.get(emp.id, {})),
                rest_work_items(ledgers.get(emp.id, {})),
                aging=aging_by_emp.get(emp.id)
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
        # Horas 100% sem decisão: impedem o fechamento da folha (devem ser quitadas no mês)
        "rest_work_pending": sum(r["bank"]["rest_work_pending"] for r in rows),
    })

    return {
        "schedule_id": schedule.id,
        "year": schedule.year,
        "month": schedule.month,
        "calculated": any(e.source == "AUTO" for e in entries),
        "status": schedule.status or "DRAFT",
        "employees": rows,
        "totals": totals,
        "item_totals": item_totals,
        "role_totals": role_totals,
    }
