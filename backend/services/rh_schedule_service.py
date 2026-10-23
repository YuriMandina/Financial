"""
Service de Regras de Negócio e Operações em Lote de Escalas de RH
Preenchimento em lote seguindo o contrato de jornada de cada colaborador (nunca gera hora extra nem
irregularidade crítica), limpeza/restauração e histórico de alterações de cada dia
(docs/conformidade-clt v05, seções 9 e 10.4).
"""

from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from models import models
from services.rh_contracts import contract_day_on
from services.rh_engine import compute_raw_minutes, get_month_calendar_info
from services.rh_holidays_service import get_effective_holidays_map

TIME_FIELDS = ("start_time", "lunch_start", "lunch_end", "end_time")
# Irregularidades que o lote consegue evitar trocando um dia por descanso
# (descanso entre jornadas e repouso; hora extra e intervalo vêm de dias manuais e não são "corrigidos" pelo lote)
DAY_FIXABLE_RULES = ("R05", "R06", "R07", "R08", "R09")
MAX_FIX_ITERATIONS = 20

# ==============================================================================
# --- [BLOCO: HISTÓRICO DE ALTERAÇÕES DA ESCALA] ---
# ==============================================================================

def snapshot_day(rec: Optional[models.RHWorkDay]) -> Optional[Dict[str, Any]]:
    if rec is None:
        return None
    return {
        "status": rec.status,
        "start_time": rec.start_time,
        "lunch_start": rec.lunch_start,
        "lunch_end": rec.lunch_end,
        "end_time": rec.end_time,
        "worked_minutes": int(rec.worked_minutes or 0),
    }


def record_change(db: Session, organization_id: int, schedule: models.RHMonthlySchedule, employee_id: int,
                  day: int, before: Optional[Dict[str, Any]], after: Optional[Dict[str, Any]],
                  origin: str, user_id: Optional[int]) -> Optional[models.RHWorkDayChange]:
    """Grava a alteração no histórico imutável; não grava quando nada mudou."""
    if before == after:
        return None
    change = models.RHWorkDayChange(
        organization_id=organization_id,
        schedule_id=schedule.id,
        employee_id=employee_id,
        work_date=date(schedule.year, schedule.month, day),
        origin=origin,
        before=before,
        after=after,
        user_id=user_id,
    )
    db.add(change)
    return change


# ==============================================================================
# --- [BLOCO: SITUAÇÃO DO DIA PELO CONTRATO] ---
# ==============================================================================

def contract_day_status(contracts: List[Any], d: date, is_holiday: bool) -> Optional[Tuple[str, Optional[Dict[str, Any]]]]:
    """(status, horários) do dia conforme o contrato; None quando não há contrato vigente."""
    if is_holiday:
        return "FERIADO", None
    cd = contract_day_on(contracts, d)
    if cd is None:
        return None
    if cd.rest:
        return cd.rest, None
    return "TRABALHO", {"start_time": cd.start, "lunch_start": cd.lunch_start, "lunch_end": cd.lunch_end, "end_time": cd.end}


def rest_day_status(contracts: List[Any], d: date, is_holiday: bool) -> str:
    """Situação de descanso do dia: feriado, o descanso do contrato ou DSR no domingo/folga."""
    if is_holiday:
        return "FERIADO"
    cd = contract_day_on(contracts, d)
    if cd is not None and cd.rest:
        return cd.rest
    return "DSR" if d.weekday() == 6 else "FOLGA"


def _apply_day(db: Session, organization_id: int, schedule: models.RHMonthlySchedule, employee_id: int, day: int,
               rec: Optional[models.RHWorkDay], status: str, times: Optional[Dict[str, Any]],
               origin: str, user_id: Optional[int]) -> Tuple[models.RHWorkDay, Optional[models.RHWorkDayChange]]:
    before = snapshot_day(rec)
    is_work = status == "TRABALHO" and times is not None
    minutes = compute_raw_minutes(times["start_time"], times["lunch_start"], times["lunch_end"], times["end_time"]) if is_work else 0
    if rec is None:
        rec = models.RHWorkDay(schedule_id=schedule.id, employee_id=employee_id, day=day)
        db.add(rec)
    rec.status = status
    for f in TIME_FIELDS:
        setattr(rec, f, times.get(f) if is_work else None)
    rec.raw_minutes = minutes
    rec.worked_minutes = minutes
    rec.is_manual = False
    rec.late_decision = None
    rec.is_late_record = False
    change = record_change(db, organization_id, schedule, employee_id, day, before, snapshot_day(rec), origin, user_id)
    return rec, change


def _avoid_critical_violations(db: Session, organization_id: int, schedule: models.RHMonthlySchedule,
                               emp: models.RHEmployee, existing: Dict[int, models.RHWorkDay], applied_days: set,
                               holiday_days: set, changes: Dict[int, models.RHWorkDayChange]) -> Tuple[List[Dict[str, Any]], List[str]]:
    """
    Seção 9.2: o lote nunca cria irregularidade crítica. Quando um dia preenchido pelo lote participa
    de uma (ex.: 7º dia por causa de um dia manual vizinho), ele vira descanso; se ainda assim
    não resolver, a irregularidade é reportada.
    """
    from services.rh_compliance_service import compute_month_violations

    def fixable(v):
        return [
            d.day for d in v.dates
            if (d.year, d.month) == (schedule.year, schedule.month) and d.day in applied_days
            and existing.get(d.day) is not None and existing[d.day].status == "TRABALHO"
        ]

    adjusted: List[Dict[str, Any]] = []
    unresolved: List[str] = []
    for _ in range(MAX_FIX_ITERATIONS):
        db.flush()
        violations = compute_month_violations(db, organization_id, schedule.year, schedule.month, [emp.id]).get(emp.id, [])
        critical = [v for v in violations if v.severity == "CRITICA" and v.code in DAY_FIXABLE_RULES]
        candidates = [(v, fixable(v)) for v in critical]
        candidates = [(v, days) for v, days in candidates if days]
        if not candidates:
            unresolved = [f"{v.title} ({', '.join(d.strftime('%d/%m') for d in v.dates[:3])})" for v in critical]
            break
        v, days = candidates[0]
        # Corta no dia em que a irregularidade se completa (ex.: o 7º dia) ou no dia do lote mais próximo antes dele
        ref = v.ref_date.day if (v.ref_date.year, v.ref_date.month) == (schedule.year, schedule.month) else max(days)
        before_ref = [x for x in days if x <= ref]
        day = max(before_ref) if before_ref else min(days)
        rec = existing[day]
        d = date(schedule.year, schedule.month, day)
        rec.status = rest_day_status(list(emp.contracts), d, day in holiday_days)
        for f in TIME_FIELDS:
            setattr(rec, f, None)
        rec.raw_minutes = rec.worked_minutes = 0
        change = changes.get(day)
        if change is not None:
            change.after = snapshot_day(rec)
            if change.before == change.after:
                db.expunge(change)
                changes.pop(day)
        applied_days.discard(day)
        adjusted.append({"employee": emp.name, "day": day, "reason": v.title})
    return adjusted, unresolved


def _load_schedule(db: Session, organization_id: int, schedule_id: int) -> models.RHMonthlySchedule:
    schedule = db.query(models.RHMonthlySchedule).filter(
        models.RHMonthlySchedule.id == schedule_id,
        models.RHMonthlySchedule.organization_id == organization_id
    ).first()
    if not schedule:
        raise ValueError("Escala mensal não encontrada")
    return schedule


def _load_employees(db: Session, organization_id: int, employee_ids: Optional[List[int]]) -> List[models.RHEmployee]:
    query = db.query(models.RHEmployee).filter(
        models.RHEmployee.organization_id == organization_id,
        models.RHEmployee.active == True
    )
    if employee_ids:
        query = query.filter(models.RHEmployee.id.in_(employee_ids))
    return query.all()


# ==============================================================================
# --- [BLOCO: PREENCHIMENTO EM LOTE PELO CONTRATO] ---
# ==============================================================================

def apply_contract_fill(
    db: Session,
    organization_id: int,
    schedule_id: int,
    employee_ids: Optional[List[int]] = None,
    status: str = "TRABALHO",
    day_from: int = 1,
    day_to: Optional[int] = None,
    weekdays: Optional[List[int]] = None,  # 0=Segunda ... 6=Domingo
    selected_days: Optional[List[int]] = None,  # Lista explícita de dias do mês
    overwrite_manual: bool = False,
    clear_unselected: bool = False,
    user_id: Optional[int] = None,
    origin: str = "LOTE",
) -> Dict[str, Any]:
    """
    Status TRABALHO aplica exatamente a semana-padrão do contrato vigente em cada data
    (horários, DSR/folga do contrato e feriados). Outros status (ex.: FERIAS) são aplicados
    diretamente. Dias manuais só são sobrescritos com `overwrite_manual`.
    """
    schedule = _load_schedule(db, organization_id, schedule_id)
    num_days = get_month_calendar_info(schedule.year, schedule.month)["num_days"]
    holiday_days = {int(k.split("-")[2]) for k in get_effective_holidays_map(db, organization_id, schedule.year, schedule.month)}

    start_day = max(1, day_from)
    end_day = min(num_days, day_to) if day_to is not None else num_days
    selected_set = set(selected_days or [])
    target_days = []
    for day in range(start_day, end_day + 1):
        if selected_set:
            if day not in selected_set:
                continue
        elif weekdays and date(schedule.year, schedule.month, day).weekday() not in weekdays:
            continue
        target_days.append(day)
    target_set = set(target_days)

    updated_count = skipped_manual_count = 0
    without_contract: Dict[str, int] = {}
    adjusted: List[Dict[str, Any]] = []
    unresolved: Dict[str, List[str]] = {}

    for emp in _load_employees(db, organization_id, employee_ids):
        contracts = list(emp.contracts)
        existing = {
            r.day: r for r in db.query(models.RHWorkDay).filter(
                models.RHWorkDay.schedule_id == schedule.id,
                models.RHWorkDay.employee_id == emp.id
            ).all()
        }

        def locked(day: int) -> bool:
            rec = existing.get(day)
            return bool(rec and rec.is_manual and not overwrite_manual)

        applied_days: set = set()
        changes: Dict[int, models.RHWorkDayChange] = {}

        for day in target_days:
            if locked(day):
                skipped_manual_count += 1
                continue
            d = date(schedule.year, schedule.month, day)
            if status == "TRABALHO":
                planned = contract_day_status(contracts, d, day in holiday_days)
                if planned is None:
                    without_contract[emp.name] = without_contract.get(emp.name, 0) + 1
                    continue
                st, times = planned
            else:
                st, times = status, None
            existing[day], change = _apply_day(db, organization_id, schedule, emp.id, day, existing.get(day), st, times, origin, user_id)
            if change is not None:
                changes[day] = change
            applied_days.add(day)
            updated_count += 1

        if clear_unselected and selected_set:
            for day in range(1, num_days + 1):
                if day in target_set or locked(day):
                    continue
                d = date(schedule.year, schedule.month, day)
                st = rest_day_status(contracts, d, day in holiday_days)
                existing[day], _ = _apply_day(db, organization_id, schedule, emp.id, day, existing.get(day), st, None, origin, user_id)

        if status == "TRABALHO" and applied_days:
            fixed, still = _avoid_critical_violations(
                db, organization_id, schedule, emp, existing, applied_days, holiday_days, changes
            )
            adjusted.extend(fixed)
            if still:
                unresolved[emp.name] = still

    db.commit()
    message = f"Preenchimento concluído! {updated_count} dias atualizados conforme o contrato."
    if skipped_manual_count:
        message += f" {skipped_manual_count} dia(s) manuais preservados."
    if adjusted:
        detail = "; ".join(f"{a['employee']} {a['day']:02d} ({a['reason'].lower()})" for a in adjusted)
        message += f" {len(adjusted)} dia(s) viraram descanso para evitar irregularidade: {detail}."
    if unresolved:
        detail = "; ".join(f"{name}: {', '.join(items)}" for name, items in unresolved.items())
        message += f" Irregularidades causadas por dias manuais, não resolvidas pelo lote: {detail}."
    if without_contract:
        names = ", ".join(sorted(without_contract))
        message += f" Sem contrato de jornada vigente (dias não preenchidos): {names}."
    return {
        "updated_count": updated_count,
        "skipped_manual_count": skipped_manual_count,
        "without_contract": without_contract,
        "adjusted": adjusted,
        "unresolved": unresolved,
        "message": message,
    }


# ==============================================================================
# --- [BLOCO: LIMPEZA E RESTAURAÇÃO DA ESCALA] ---
# ==============================================================================

def clear_or_reset_schedule(
    db: Session,
    organization_id: int,
    schedule_id: int,
    employee_id: Optional[int] = None,
    mode: str = "CLEAR_OFF",  # 'CLEAR_OFF' ou 'RESET_DEFAULT'
    overwrite_manual: bool = True,
    user_id: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Limpa ou restaura a escala de um colaborador ou de toda a equipe.
    - CLEAR_OFF: todos os dias viram descanso (feriado, descanso do contrato, DSR no domingo ou folga).
    - RESET_DEFAULT: restaura a semana-padrão do contrato vigente em cada data.
    """
    employee_ids = [employee_id] if employee_id else None
    if mode == "RESET_DEFAULT":
        res = apply_contract_fill(
            db, organization_id, schedule_id, employee_ids=employee_ids,
            overwrite_manual=overwrite_manual, user_id=user_id, origin="RESET"
        )
        res["affected_days"] = res["updated_count"]
        return res

    schedule = _load_schedule(db, organization_id, schedule_id)
    num_days = get_month_calendar_info(schedule.year, schedule.month)["num_days"]
    holiday_days = {int(k.split("-")[2]) for k in get_effective_holidays_map(db, organization_id, schedule.year, schedule.month)}
    employees = _load_employees(db, organization_id, employee_ids)

    affected_days = 0
    for emp in employees:
        contracts = list(emp.contracts)
        existing = {
            r.day: r for r in db.query(models.RHWorkDay).filter(
                models.RHWorkDay.schedule_id == schedule.id,
                models.RHWorkDay.employee_id == emp.id
            ).all()
        }
        for day in range(1, num_days + 1):
            rec = existing.get(day)
            if rec and rec.is_manual and not overwrite_manual:
                continue
            st = rest_day_status(contracts, date(schedule.year, schedule.month, day), day in holiday_days)
            _apply_day(db, organization_id, schedule, emp.id, day, rec, st, None, "RESET", user_id)  # descanso nunca cria irregularidade
            affected_days += 1

    db.commit()
    target_desc = f"do colaborador {employees[0].name}" if (employee_id and employees) else "de toda a equipe"
    return {
        "affected_days": affected_days,
        "message": f"Escala {target_desc} foi limpa com folgas com sucesso ({affected_days} dias processados)."
    }
