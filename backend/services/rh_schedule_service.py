"""
Service de Regras de Negócio e Operações em Lote de Escalas de RH
Preenchimento em lote seguindo o contrato de jornada de cada colaborador (nunca gera hora extra),
limpeza/restauração e histórico de alterações de cada dia (docs/conformidade-clt v05, seções 9 e 10.4).
"""

from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from models import models
from services.rh_contracts import contract_day_on
from services.rh_engine import compute_raw_minutes, get_month_calendar_info
from services.rh_holidays_service import get_effective_holidays_map

TIME_FIELDS = ("start_time", "lunch_start", "lunch_end", "end_time")

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
                  origin: str, user_id: Optional[int]) -> bool:
    """Grava a alteração no histórico imutável; não grava quando nada mudou."""
    if before == after:
        return False
    db.add(models.RHWorkDayChange(
        organization_id=organization_id,
        schedule_id=schedule.id,
        employee_id=employee_id,
        work_date=date(schedule.year, schedule.month, day),
        origin=origin,
        before=before,
        after=after,
        user_id=user_id,
    ))
    return True


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
               origin: str, user_id: Optional[int]) -> models.RHWorkDay:
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
    record_change(db, organization_id, schedule, employee_id, day, before, snapshot_day(rec), origin, user_id)
    return rec


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
            existing[day] = _apply_day(db, organization_id, schedule, emp.id, day, existing.get(day), st, times, origin, user_id)
            updated_count += 1

        if clear_unselected and selected_set:
            for day in range(1, num_days + 1):
                if day in target_set or locked(day):
                    continue
                d = date(schedule.year, schedule.month, day)
                st = rest_day_status(contracts, d, day in holiday_days)
                existing[day] = _apply_day(db, organization_id, schedule, emp.id, day, existing.get(day), st, None, origin, user_id)

    db.commit()
    message = f"Preenchimento concluído! {updated_count} dias atualizados conforme o contrato."
    if skipped_manual_count:
        message += f" {skipped_manual_count} dia(s) manuais preservados."
    if without_contract:
        names = ", ".join(sorted(without_contract))
        message += f" Sem contrato de jornada vigente (dias não preenchidos): {names}."
    return {
        "updated_count": updated_count,
        "skipped_manual_count": skipped_manual_count,
        "without_contract": without_contract,
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
            _apply_day(db, organization_id, schedule, emp.id, day, rec, st, None, "RESET", user_id)
            affected_days += 1

    db.commit()
    target_desc = f"do colaborador {employees[0].name}" if (employee_id and employees) else "de toda a equipe"
    return {
        "affected_days": affected_days,
        "message": f"Escala {target_desc} foi limpa com folgas com sucesso ({affected_days} dias processados)."
    }
