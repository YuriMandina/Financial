"""
Service de Conformidade Trabalhista
Liga o motor de regras (rh_labor_rules) ao banco: monta a janela de dias do colaborador,
estima valores, relaciona evidências ao histórico da escala e mantém a auditoria mensal.
Planejamento: docs/conformidade-clt (v05, seções 7, 8 e 10).
"""

import calendar
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy.orm import Session

from models import models
from services.rh_contracts import contract_day_on, contract_on, days_summary_label, load_regimes
from services.rh_holidays_service import get_effective_holidays_map
from services.rh_labor_rules import RuleContext, RuleDay, RulePolicy, Violation, evaluate
from services.rh_ledger import LedgerSettings, build_ledger, day_input_from_record, load_month_ledgers
from services.rh_salary_service import current_salary

WINDOW_DAYS = 63  # Semanas anteriores ao mês: domingos seguidos, 7º dia e habitualidade cruzam meses
AUDITED_SEVERITIES = ("CRITICA", "ALERTA")

# ==============================================================================
# --- [BLOCO: JANELA DE DIAS DO COLABORADOR] ---
# ==============================================================================

def _month_bounds(year: int, month: int):
    return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])


def _months_between(start: date, end: date) -> List[tuple]:
    months, y, m = [], start.year, start.month
    while (y, m) <= (end.year, end.month):
        months.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return months


def _holidays(db: Session, organization_id: int, months: Iterable[tuple]) -> Dict[date, str]:
    out: Dict[date, str] = {}
    for y, m in months:
        for k, name in get_effective_holidays_map(db, organization_id, y, m).items():
            out[date.fromisoformat(k)] = name
    return out


def _window_records(db: Session, organization_id: int, employee_ids: List[int], months: List[tuple]) -> Dict[int, Dict[date, Any]]:
    schedules = {
        s.id: s for s in db.query(models.RHMonthlySchedule).filter(
            models.RHMonthlySchedule.organization_id == organization_id
        ).all() if (s.year, s.month) in months
    }
    out: Dict[int, Dict[date, Any]] = {eid: {} for eid in employee_ids}
    if not schedules:
        return out
    for wd in db.query(models.RHWorkDay).filter(
        models.RHWorkDay.schedule_id.in_(list(schedules)),
        models.RHWorkDay.employee_id.in_(employee_ids)
    ).all():
        s = schedules[wd.schedule_id]
        out[wd.employee_id][date(s.year, s.month, wd.day)] = wd
    return out


def _latest_changes(db: Session, employee_ids: List[int], start: date, end: date) -> Dict[tuple, int]:
    """Alteração mais recente de cada dia (para ligar a evidência ao histórico)."""
    latest: Dict[tuple, int] = {}
    for ch in db.query(models.RHWorkDayChange).filter(
        models.RHWorkDayChange.employee_id.in_(employee_ids),
        models.RHWorkDayChange.work_date >= start,
        models.RHWorkDayChange.work_date <= end
    ).order_by(models.RHWorkDayChange.id.asc()).all():
        latest[(ch.employee_id, ch.work_date)] = ch.id
    return latest


# ==============================================================================
# --- [BLOCO: CÁLCULO DAS IRREGULARIDADES] ---
# ==============================================================================

def _hourly_rate(db: Session, emp: models.RHEmployee, ref: date) -> float:
    salary = float(current_salary(db, emp) or 0.0)
    contract = contract_on(emp.contracts, ref)
    weekly_hours = (contract.weekly_min / 60) if contract and contract.weekly_min else float(emp.weekly_contract_hours or 44.0)
    return salary / (weekly_hours * 5) if weekly_hours and salary else 0.0


def _estimate(v: Violation, hourly: float, overtime_rate: float) -> Optional[float]:
    if not v.estimate_minutes or not hourly or not v.estimate_kind:
        return None
    factor = {"HE": 1 + overtime_rate / 100, "DOBRO": 2.0, "INDENIZACAO": 1.5}[v.estimate_kind]
    return round(v.estimate_minutes / 60 * hourly * factor, 2)


def compute_month_violations(db: Session, organization_id: int, year: int, month: int,
                             employee_ids: Optional[List[int]] = None) -> Dict[int, List[Violation]]:
    """Irregularidades que se completam no mês, por colaborador ativo."""
    settings = db.query(models.RHSettings).filter(models.RHSettings.organization_id == organization_id).first()
    query = db.query(models.RHEmployee).filter(
        models.RHEmployee.organization_id == organization_id, models.RHEmployee.active == True
    )
    if employee_ids:
        query = query.filter(models.RHEmployee.id.in_(employee_ids))
    employees = query.all()
    if not employees:
        return {}

    start, end = _month_bounds(year, month)
    window_start = start - timedelta(days=WINDOW_DAYS)
    months = _months_between(window_start, end)
    regimes = load_regimes(db)
    holidays = _holidays(db, organization_id, months)
    records = _window_records(db, organization_id, [e.id for e in employees], months)
    changes = _latest_changes(db, [e.id for e in employees], window_start, end)
    ledger_settings = LedgerSettings.from_settings(settings)
    policy = RulePolicy.from_settings(settings)
    overtime_rate = float(getattr(settings, "overtime_rate", None) or 50.0)

    result: Dict[int, List[Violation]] = {}
    for emp in employees:
        contracts = list(emp.contracts)
        recs = {d: r for d, r in records[emp.id].items() if window_start <= d <= end}
        ledger = build_ledger(
            [day_input_from_record(r, d) for d, r in recs.items()],
            lambda d, c=contracts: contract_day_on(c, d),
            set(holidays), ledger_settings, regimes,
        )
        ctx = RuleContext(
            employee_id=emp.id, employee_name=emp.name,
            days={d: RuleDay(d, r.status, r.start_time, r.lunch_start, r.lunch_end, r.end_time,
                             int(r.worked_minutes or 0) if r.status == "TRABALHO" else 0)
                  for d, r in recs.items()},
            ledger=ledger, contracts=contracts, regimes=regimes, holidays=holidays,
            period=(start, end), policy=policy,
        )
        violations = evaluate(ctx)
        hourly = _hourly_rate(db, emp, end)
        for v in violations:
            v.financial_estimate = _estimate(v, hourly, overtime_rate)
            for ev in v.evidence:
                if ev.date is not None:
                    ev.change_id = changes.get((emp.id, ev.date))
        result[emp.id] = violations
    return result


def audited(violations: Iterable[Violation]) -> List[Violation]:
    return [v for v in violations if v.severity in AUDITED_SEVERITIES]


# ==============================================================================
# --- [BLOCO: AUDITORIA MENSAL] ---
# ==============================================================================

def get_or_create_audit(db: Session, organization_id: int, year: int, month: int) -> models.RHMonthlyAudit:
    audit = db.query(models.RHMonthlyAudit).filter(
        models.RHMonthlyAudit.organization_id == organization_id,
        models.RHMonthlyAudit.year == year,
        models.RHMonthlyAudit.month == month
    ).first()
    if not audit:
        audit = models.RHMonthlyAudit(organization_id=organization_id, year=year, month=month, status="PENDENTE")
        db.add(audit)
        db.flush()
    return audit


def _refresh_status(audit: models.RHMonthlyAudit) -> None:
    pending = any(i.status == "PENDENTE" for i in audit.items)
    if audit.approved_at:
        audit.status = "REABERTA" if pending else "APROVADA"
    else:
        audit.status = "PENDENTE"


def sync_month_audit(db: Session, organization_id: int, year: int, month: int,
                     violations_by_emp: Dict[int, List[Violation]], employee_names: Dict[int, str]) -> models.RHMonthlyAudit:
    """
    Mantém os itens da auditoria iguais às irregularidades atuais dos colaboradores informados:
    novas entram como PENDENTE (reabrindo uma auditoria aprovada); corrigidas são removidas;
    a mesma irregularidade (fingerprint) não volta a ficar pendente.
    """
    audit = get_or_create_audit(db, organization_id, year, month)
    current = {
        v.fingerprint: v for emp_id, vs in violations_by_emp.items() for v in audited(vs)
    }
    for item in list(audit.items):
        if item.employee_id not in violations_by_emp:
            continue
        v = current.pop(item.fingerprint, None)
        if v is None:
            audit.items.remove(item)  # Corrigida: só existiu no planejamento (delete-orphan remove o item)
            continue
        item.severity = v.severity
        item.dates = [d.isoformat() for d in v.dates]
        item.snapshot = {**v.to_dict(), "employee_name": employee_names.get(v.employee_id)}
    for v in current.values():
        audit.items.append(models.RHAuditItem(
            employee_id=v.employee_id, rule_code=v.code, severity=v.severity,
            dates=[d.isoformat() for d in v.dates], fingerprint=v.fingerprint,
            snapshot={**v.to_dict(), "employee_name": employee_names.get(v.employee_id)},
            status="PENDENTE",
        ))
    db.flush()
    _refresh_status(audit)
    return audit


def refresh_month_audit(db: Session, organization_id: int, year: int, month: int,
                        employee_ids: Optional[List[int]] = None):
    """Recalcula as irregularidades e sincroniza a auditoria; devolve (auditoria, irregularidades por colaborador)."""
    violations = compute_month_violations(db, organization_id, year, month, employee_ids)
    names = {e.id: e.name for e in db.query(models.RHEmployee).filter(
        models.RHEmployee.organization_id == organization_id
    ).all()}
    audit = sync_month_audit(db, organization_id, year, month, violations, names)
    return audit, violations


def item_to_dict(item: models.RHAuditItem) -> Dict[str, Any]:
    return {
        "id": item.id,
        "employee_id": item.employee_id,
        "rule_code": item.rule_code,
        "severity": item.severity,
        "dates": item.dates or [],
        "fingerprint": item.fingerprint,
        "status": item.status,
        "note": item.note,
        "is_force_majeure": bool(item.is_force_majeure),
        "first_seen_at": item.first_seen_at.isoformat() if item.first_seen_at else None,
        "approved_at": item.approved_at.isoformat() if item.approved_at else None,
        **(item.snapshot or {}),
    }


def audit_summary(audit: models.RHMonthlyAudit) -> Dict[str, Any]:
    items = audit.items
    return {
        "status": audit.status if items or audit.approved_at else "SEM_IRREGULARIDADES",
        "total": len(items),
        "critical": sum(1 for i in items if i.severity == "CRITICA"),
        "alert": sum(1 for i in items if i.severity == "ALERTA"),
        "pending": sum(1 for i in items if i.status == "PENDENTE"),
        "employees": len({i.employee_id for i in items}),
        "financial_estimate": round(sum((i.snapshot or {}).get("financial_estimate") or 0.0 for i in items), 2),
    }


def audit_to_dict(db: Session, audit: models.RHMonthlyAudit) -> Dict[str, Any]:
    approver = db.query(models.User).get(audit.approved_by_user_id) if audit.approved_by_user_id else None
    severity_order = {"CRITICA": 0, "ALERTA": 1}
    items = sorted(audit.items, key=lambda i: (i.status != "PENDENTE", severity_order.get(i.severity, 2), (i.dates or [""])[0]))
    return {
        "id": audit.id,
        "year": audit.year,
        "month": audit.month,
        "approved_by": (approver.name or approver.email) if approver else None,
        "approved_at": audit.approved_at.isoformat() if audit.approved_at else None,
        "general_note": audit.general_note,
        "has_snapshot": bool(audit.snapshot),
        **audit_summary(audit),
        "items": [item_to_dict(i) for i in items],
    }


def approve_month_audit(audit: models.RHMonthlyAudit, user: models.User, general_note: Optional[str],
                        item_notes: Dict[int, Dict[str, Any]]) -> models.RHMonthlyAudit:
    """Aprova o conjunto do mês e grava o snapshot do que foi lido na aprovação."""
    now = datetime.now(timezone.utc)
    for item in audit.items:
        extra = item_notes.get(item.id) or {}
        if "note" in extra:
            item.note = extra.get("note") or None
        if "is_force_majeure" in extra:
            item.is_force_majeure = bool(extra.get("is_force_majeure"))
        if item.status == "PENDENTE":
            item.status = "APROVADA"
            item.approved_at = now
    audit.approved_by_user_id = user.id
    audit.approved_at = now
    audit.general_note = general_note
    audit.snapshot = {
        "approved_at": now.isoformat(),
        "approved_by": user.name or user.email,
        "general_note": general_note,
        "items": [item_to_dict(i) for i in audit.items],
    }
    _refresh_status(audit)
    return audit


# ==============================================================================
# --- [BLOCO: OCORRÊNCIAS DE PONTO] ---
# ==============================================================================

def late_occurrences(db: Session, organization_id: int, schedule: models.RHMonthlySchedule) -> List[Dict[str, Any]]:
    """Atrasos fora dos limites de compensação automática ou já decididos pelo empregador (seção 10.5)."""
    employees = db.query(models.RHEmployee).filter(
        models.RHEmployee.organization_id == organization_id, models.RHEmployee.active == True
    ).all()
    settings = db.query(models.RHSettings).filter(models.RHSettings.organization_id == organization_id).first()
    ledgers = load_month_ledgers(db, organization_id, schedule, employees, settings)
    records = {
        (wd.employee_id, wd.day): wd
        for wd in db.query(models.RHWorkDay).filter(models.RHWorkDay.schedule_id == schedule.id).all()
    }
    out = []
    for emp in employees:
        for d, dl in sorted(ledgers.get(emp.id, {}).items()):
            rec = records.get((emp.id, d.day))
            if not rec or not (dl.late_pending_decision or rec.late_decision):
                continue
            cd = contract_day_on(emp.contracts, d)
            out.append({
                "employee_id": emp.id,
                "employee_name": emp.name,
                "day": d.day,
                "date": d.isoformat(),
                "start_time": rec.start_time,
                "end_time": rec.end_time,
                "contract_start": cd.start if cd and cd.is_work else None,
                "contract_end": cd.end if cd and cd.is_work else None,
                "late_min": dl.late_min,
                "late_compensated_min": dl.late_compensated_min,
                "pending": dl.late_pending_decision,
                "decision": rec.late_decision,
                "decision_note": rec.late_decision_note,
            })
    return out


def contract_summary_for(emp: models.RHEmployee, ref: date) -> Optional[str]:
    c = contract_on(emp.contracts, ref)
    return days_summary_label(c.days) if c else None
