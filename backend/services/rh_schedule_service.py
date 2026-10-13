"""
Service de Regras de Negócio e Operações em Lote de Escalas de RH
Gerencia preenchimento em lote com escopo, dias da semana e proteção contra sobrescrita manual.
"""

from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from datetime import date
from models import models
from services.rh_engine import get_month_calendar_info, compute_raw_minutes

def apply_shift_fill(
    db: Session,
    organization_id: int,
    schedule_id: int,
    employee_ids: Optional[List[int]] = None,
    shift_id: Optional[int] = None,
    status: str = "TRABALHO",
    day_from: int = 1,
    day_to: Optional[int] = None,
    weekdays: Optional[List[int]] = None, # 0=Segunda ... 6=Domingo
    overwrite_manual: bool = False
) -> Dict[str, Any]:
    schedule = db.query(models.RHMonthlySchedule).filter(
        models.RHMonthlySchedule.id == schedule_id,
        models.RHMonthlySchedule.organization_id == organization_id
    ).first()

    if not schedule:
        raise ValueError("Escala mensal não encontrada")

    cal_info = get_month_calendar_info(schedule.year, schedule.month)
    num_days = cal_info["num_days"]
    sundays = set(cal_info["sundays"])

    month_prefix = f"{schedule.year:04d}-{schedule.month:02d}-"
    holidays = db.query(models.RHHoliday).filter(
        models.RHHoliday.organization_id == organization_id,
        models.RHHoliday.date.like(f"{month_prefix}%")
    ).all()
    holiday_days = {int(h.date.split("-")[2]) for h in holidays}

    end_day = min(num_days, day_to) if day_to is not None else num_days
    start_day = max(1, day_from)

    # Buscar turno
    shift_obj = None
    if shift_id:
        shift_obj = db.query(models.RHWorkShift).filter(
            models.RHWorkShift.id == shift_id,
            models.RHWorkShift.organization_id == organization_id
        ).first()

    # Buscar colaboradores
    emp_query = db.query(models.RHEmployee).filter(
        models.RHEmployee.organization_id == organization_id,
        models.RHEmployee.active == True
    )
    if employee_ids and len(employee_ids) > 0:
        emp_query = emp_query.filter(models.RHEmployee.id.in_(employee_ids))
    employees = emp_query.all()

    updated_count = 0
    skipped_manual_count = 0

    for emp in employees:
        # Se nenhum turno específico foi passado, usa o turno padrão do colaborador
        target_shift = shift_obj
        if not target_shift and emp.default_shift_id:
            target_shift = db.query(models.RHWorkShift).filter(
                models.RHWorkShift.id == emp.default_shift_id,
                models.RHWorkShift.organization_id == organization_id
            ).first()

        start_time = target_shift.start_time if target_shift else "08:00"
        lunch_start = target_shift.lunch_start if target_shift else "12:00"
        lunch_end = target_shift.lunch_end if target_shift else "13:00"
        end_time = target_shift.end_time if target_shift else "17:00"
        raw_min = compute_raw_minutes(start_time, lunch_start, lunch_end, end_time) if target_shift else 480

        for day in range(start_day, end_day + 1):
            d_obj = date(schedule.year, schedule.month, day)
            w_day = d_obj.weekday()

            if weekdays is not None and len(weekdays) > 0:
                if w_day not in weekdays:
                    continue

            # Buscar registro existente
            rec = db.query(models.RHWorkDay).filter(
                models.RHWorkDay.schedule_id == schedule.id,
                models.RHWorkDay.employee_id == emp.id,
                models.RHWorkDay.day == day
            ).first()

            if rec and rec.is_manual and not overwrite_manual:
                skipped_manual_count += 1
                continue

            # Determinar status inteligente se status for o padrão
            effective_status = status
            if status == "TRABALHO":
                if day in holiday_days:
                    effective_status = "FERIADO"
                elif day in sundays:
                    effective_status = "DSR"
                else:
                    effective_status = "TRABALHO"

            is_work = effective_status == "TRABALHO"
            final_minutes = raw_min if is_work else 0

            if rec:
                rec.status = effective_status
                rec.shift_id = target_shift.id if target_shift else None
                rec.shift = target_shift.code if target_shift else None
                rec.start_time = start_time if is_work else None
                rec.lunch_start = lunch_start if is_work else None
                rec.lunch_end = lunch_end if is_work else None
                rec.end_time = end_time if is_work else None
                rec.raw_minutes = final_minutes
                rec.worked_minutes = final_minutes
                rec.is_manual = False
            else:
                new_day = models.RHWorkDay(
                    schedule_id=schedule.id,
                    employee_id=emp.id,
                    day=day,
                    status=effective_status,
                    shift_id=target_shift.id if target_shift else None,
                    shift=target_shift.code if target_shift else None,
                    start_time=start_time if is_work else None,
                    lunch_start=lunch_start if is_work else None,
                    lunch_end=lunch_end if is_work else None,
                    end_time=end_time if is_work else None,
                    raw_minutes=final_minutes,
                    worked_minutes=final_minutes,
                    is_manual=False
                )
                db.add(new_day)

            updated_count += 1

    db.commit()
    return {
        "updated_count": updated_count,
        "skipped_manual_count": skipped_manual_count,
        "message": f"Preenchimento concluído! {updated_count} dias atualizados."
    }
