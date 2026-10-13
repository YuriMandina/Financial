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
    selected_days: Optional[List[int]] = None, # Lista explícita de dias do mês (ex: [1,2,5,10])
    overwrite_manual: bool = False,
    clear_unselected: bool = False
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

        has_selected_days = selected_days is not None and len(selected_days) > 0

        # Loop de aplicação principal
        for day in range(start_day, end_day + 1):
            if has_selected_days:
                if day not in selected_days:
                    continue
            else:
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
                if not has_selected_days:
                    if day in holiday_days:
                        effective_status = "FERIADO"
                    elif day in sundays:
                        effective_status = "DSR"
                    else:
                        effective_status = "TRABALHO"
                else:
                    # Quando o operador seleciona dias explicitamente no calendário, aplica o trabalho/turno solicitado
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

        # Se solicitado para limpar os dias não selecionados da escala
        if clear_unselected and has_selected_days:
            for unsel_day in range(1, num_days + 1):
                if unsel_day in selected_days:
                    continue

                rec_unsel = db.query(models.RHWorkDay).filter(
                    models.RHWorkDay.schedule_id == schedule.id,
                    models.RHWorkDay.employee_id == emp.id,
                    models.RHWorkDay.day == unsel_day
                ).first()

                if rec_unsel and rec_unsel.is_manual and not overwrite_manual:
                    continue

                unsel_status = "FERIADO" if unsel_day in holiday_days else ("DSR" if unsel_day in sundays else "FOLGA")

                if rec_unsel:
                    rec_unsel.status = unsel_status
                    rec_unsel.shift_id = None
                    rec_unsel.shift = None
                    rec_unsel.start_time = None
                    rec_unsel.lunch_start = None
                    rec_unsel.lunch_end = None
                    rec_unsel.end_time = None
                    rec_unsel.raw_minutes = 0
                    rec_unsel.worked_minutes = 0
                    rec_unsel.is_manual = False
                else:
                    new_unsel = models.RHWorkDay(
                        schedule_id=schedule.id,
                        employee_id=emp.id,
                        day=unsel_day,
                        status=unsel_status,
                        shift_id=None,
                        shift=None,
                        start_time=None,
                        lunch_start=None,
                        lunch_end=None,
                        end_time=None,
                        raw_minutes=0,
                        worked_minutes=0,
                        is_manual=False
                    )
                    db.add(new_unsel)

    db.commit()
    return {
        "updated_count": updated_count,
        "skipped_manual_count": skipped_manual_count,
        "message": f"Preenchimento concluído! {updated_count} dias atualizados."
    }

# ==============================================================================
# --- [BLOCO: LIMPEZA E RESET DE ESCALA] ---
# ==============================================================================

def clear_or_reset_schedule(
    db: Session,
    organization_id: int,
    schedule_id: int,
    employee_id: Optional[int] = None,
    mode: str = "CLEAR_OFF", # 'CLEAR_OFF' ou 'RESET_DEFAULT'
    overwrite_manual: bool = True
) -> Dict[str, Any]:
    """
    Limpa ou restaura a escala de trabalho de um colaborador específico ou de toda a equipe.
    Modos:
    - CLEAR_OFF: Define dias como folga (FOLGA_BH/DSR/FERIADO), zerando horas e turnos.
    - RESET_DEFAULT: Restaura o turno contratual padrão do colaborador de Seg-Sáb e DSR aos domingos.
    """
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

    emp_query = db.query(models.RHEmployee).filter(
        models.RHEmployee.organization_id == organization_id,
        models.RHEmployee.active == True
    )
    if employee_id:
        emp_query = emp_query.filter(models.RHEmployee.id == employee_id)
    employees = emp_query.all()

    affected_days = 0

    for emp in employees:
        default_shift = None
        if mode == "RESET_DEFAULT" and emp.default_shift_id:
            default_shift = db.query(models.RHWorkShift).filter(
                models.RHWorkShift.id == emp.default_shift_id,
                models.RHWorkShift.organization_id == organization_id
            ).first()

        start_time = default_shift.start_time if default_shift else "08:00"
        lunch_start = default_shift.lunch_start if default_shift else "12:00"
        lunch_end = default_shift.lunch_end if default_shift else "13:00"
        end_time = default_shift.end_time if default_shift else "17:00"
        raw_min = compute_raw_minutes(start_time, lunch_start, lunch_end, end_time) if default_shift else 480

        for day in range(1, num_days + 1):
            rec = db.query(models.RHWorkDay).filter(
                models.RHWorkDay.schedule_id == schedule.id,
                models.RHWorkDay.employee_id == emp.id,
                models.RHWorkDay.day == day
            ).first()

            if rec and rec.is_manual and not overwrite_manual:
                continue

            if mode == "RESET_DEFAULT":
                if day in holiday_days:
                    st = "FERIADO"
                    is_work = False
                elif day in sundays:
                    st = "DSR"
                    is_work = False
                else:
                    st = "TRABALHO"
                    is_work = True
                
                final_min = raw_min if is_work else 0
                shift_id_val = default_shift.id if (is_work and default_shift) else None
                shift_code_val = default_shift.code if (is_work and default_shift) else None
                s_time = start_time if is_work else None
                l_start = lunch_start if is_work else None
                l_end = lunch_end if is_work else None
                e_time = end_time if is_work else None
            else: # CLEAR_OFF
                if day in holiday_days:
                    st = "FERIADO"
                elif day in sundays:
                    st = "DSR"
                else:
                    st = "FOLGA"
                
                final_min = 0
                shift_id_val = None
                shift_code_val = None
                s_time = None
                l_start = None
                l_end = None
                e_time = None

            if rec:
                rec.status = st
                rec.shift_id = shift_id_val
                rec.shift = shift_code_val
                rec.start_time = s_time
                rec.lunch_start = l_start
                rec.lunch_end = l_end
                rec.end_time = e_time
                rec.raw_minutes = final_min
                rec.worked_minutes = final_min
                rec.is_manual = False
            else:
                new_day = models.RHWorkDay(
                    schedule_id=schedule.id,
                    employee_id=emp.id,
                    day=day,
                    status=st,
                    shift_id=shift_id_val,
                    shift=shift_code_val,
                    start_time=s_time,
                    lunch_start=l_start,
                    lunch_end=l_end,
                    end_time=e_time,
                    raw_minutes=final_min,
                    worked_minutes=final_min,
                    is_manual=False
                )
                db.add(new_day)

            affected_days += 1

    db.commit()
    target_desc = f"do colaborador {employees[0].name}" if (employee_id and employees) else "de toda a equipe"
    action_desc = "restaurada para os turnos contratuais" if mode == "RESET_DEFAULT" else "limpa com folgas"
    return {
        "affected_days": affected_days,
        "message": f"Escala {target_desc} foi {action_desc} com sucesso ({affected_days} dias processados)."
    }

