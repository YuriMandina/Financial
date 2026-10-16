from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional, Dict, Any
from datetime import date
import calendar

import models.models as models
from core import auth
from core.database import get_db
from services.rh_engine import (
    get_month_calendar_info,
    calculate_employee_month_summary,
    calculate_work_days_summary,
    check_consecutive_sundays_warnings,
    compute_raw_minutes,
    format_minutes_to_hours,
    derive_day_benefits
)
from services.rh_schedule_service import apply_shift_fill, clear_or_reset_schedule
from services.rh_holidays_service import get_effective_holidays_map, list_all_holidays_for_organization

router = APIRouter(prefix="/api/rh", tags=["rh"])

# ==============================================================================
# --- [BLOCO: SCHEMAS PYDANTIC] ---
# ==============================================================================

class RHSettingsSchema(BaseModel):
    max_consecutive_sundays: int = 2
    transport_ticket_unit_price: float = 4.70
    default_transport_cost: float = 9.40
    default_meal_cost: float = 25.00
    min_daily_hours_for_meal: float = 6.0
    weekly_bank_overtime_hours: float = 4.0
    compensatory_days_per_month: int = 2
    time_rounding_minutes: int = 0
    time_rounding_mode: str = "NEAREST"
    clt_tolerance_enabled: bool = True
    hours_display_format: str = "HHMM"

    @field_validator(
        "transport_ticket_unit_price",
        "default_transport_cost",
        "default_meal_cost",
        "min_daily_hours_for_meal",
        "weekly_bank_overtime_hours",
        mode="after"
    )
    @classmethod
    def round_floats(cls, v: float) -> float:
        return round(float(v), 2) if v is not None else v

class RHRoleCreate(BaseModel):
    name: str
    description: Optional[str] = None

class RHWorkShiftCreate(BaseModel):
    name: str
    code: str
    start_time: str # "07:00"
    lunch_start: Optional[str] = "12:00"
    lunch_end: Optional[str] = "13:00"
    end_time: str # "16:00"
    net_hours: float = 8.0
    description: Optional[str] = None
    is_default: bool = False

class RHWorkShiftUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    start_time: Optional[str] = None
    lunch_start: Optional[str] = None
    lunch_end: Optional[str] = None
    end_time: Optional[str] = None
    net_hours: Optional[float] = None
    description: Optional[str] = None
    is_default: Optional[bool] = None

class RHEmployeeCreate(BaseModel):
    name: str
    role_id: Optional[int] = None
    role: Optional[str] = None
    default_shift_id: Optional[int] = None
    default_daily_transport_tickets: int = 2
    daily_transport_cost: float = 9.40
    daily_meal_cost: float = 25.00
    weekly_contract_hours: float = 44.0
    weekly_actual_hours: Optional[float] = None
    work_days_per_week: int = 6
    base_salary: float = 0.0
    dependents: int = 0
    active: bool = True

class RHEmployeeUpdate(BaseModel):
    name: Optional[str] = None
    role_id: Optional[int] = None
    role: Optional[str] = None
    default_shift_id: Optional[int] = None
    default_daily_transport_tickets: Optional[int] = None
    daily_transport_cost: Optional[float] = None
    daily_meal_cost: Optional[float] = None
    weekly_contract_hours: Optional[float] = None
    weekly_actual_hours: Optional[float] = None
    work_days_per_week: Optional[int] = None
    base_salary: Optional[float] = None
    dependents: Optional[int] = None
    active: Optional[bool] = None

class RHHolidayCreate(BaseModel):
    date: str # YYYY-MM-DD
    name: str

class DayEntryUpdate(BaseModel):
    employee_id: int
    schedule_type: str # 'TRANSPORTE' ou 'ALIMENTACAO'
    day: int
    status: str # 'X', 'BH', 'F', 'FE', 'OFF'
    shift_id: Optional[int] = None
    shift: Optional[str] = None # 'ABRE', 'FECHA', etc.
    tickets_count: Optional[int] = 2
    daily_hours: Optional[float] = 8.0

class BatchSaveScheduleRequest(BaseModel):
    year: int
    month: int
    entries: List[DayEntryUpdate]

# Schemas para a nova jornada diária unificada
class RHWorkDayItemUpdate(BaseModel):
    employee_id: int
    day: int
    status: Optional[str] = None
    shift_id: Optional[int] = None
    shift: Optional[str] = None
    start_time: Optional[str] = None
    lunch_start: Optional[str] = None
    lunch_end: Optional[str] = None
    end_time: Optional[str] = None
    worked_minutes: Optional[int] = None
    vt_tickets_override: Optional[int] = None
    va_override: Optional[bool] = None
    benefit_note: Optional[str] = None
    notes: Optional[str] = None
    is_manual: Optional[bool] = True

class RHBatchWorkDaysUpdate(BaseModel):
    schedule_id: int
    entries: List[RHWorkDayItemUpdate]

class RHScheduleFillRequest(BaseModel):
    schedule_id: int
    employee_ids: Optional[List[int]] = None
    shift_id: Optional[int] = None
    status: str = "TRABALHO"
    day_from: int = 1
    day_to: Optional[int] = None
    weekdays: Optional[List[int]] = None
    selected_days: Optional[List[int]] = None
    overwrite_manual: bool = False
    clear_unselected: bool = False

class RHScheduleClearRequest(BaseModel):
    schedule_id: int
    employee_id: Optional[int] = None
    mode: str = "CLEAR_OFF" # 'CLEAR_OFF' ou 'RESET_DEFAULT'
    overwrite_manual: bool = True


class RHBenefitOverrideRequest(BaseModel):
    schedule_id: int
    employee_id: int
    day: int
    vt_tickets_override: Optional[int] = None
    va_override: Optional[bool] = None
    benefit_note: Optional[str] = None

class RHResetBenefitRequest(BaseModel):
    schedule_id: int
    employee_id: Optional[int] = None
    day: Optional[int] = None
    benefit_type: str = "ALL" # 'VT', 'VA', ou 'ALL'

class RHBenefitAdjustmentCreate(BaseModel):
    schedule_id: int
    employee_id: int
    benefit_type: str # 'VT' ou 'VA'
    quantity: float
    reason: Optional[str] = None

# ==============================================================================
# --- [BLOCO: CARGOS CADASTRAVEIS] ---
# ==============================================================================

@router.get("/roles")
def list_roles(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    roles = db.query(models.RHRole).filter(
        models.RHRole.organization_id == current_user.organization_id
    ).order_by(models.RHRole.name.asc()).all()
    return roles

@router.post("/roles")
def create_role(
    payload: RHRoleCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    existing = db.query(models.RHRole).filter(
        models.RHRole.organization_id == current_user.organization_id,
        models.RHRole.name.ilike(payload.name.strip())
    ).first()
    if existing:
        return existing

    new_role = models.RHRole(
        organization_id=current_user.organization_id,
        name=payload.name.strip(),
        description=payload.description.strip() if payload.description else None
    )
    db.add(new_role)
    db.commit()
    db.refresh(new_role)
    return new_role

@router.delete("/roles/{role_id}")
def delete_role(
    role_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    role = db.query(models.RHRole).filter(
        models.RHRole.id == role_id,
        models.RHRole.organization_id == current_user.organization_id
    ).first()
    if not role:
        raise HTTPException(status_code=404, detail="Cargo não encontrado")
    db.delete(role)
    db.commit()
    return {"message": "Cargo removido com sucesso"}

# ==============================================================================
# --- [BLOCO: TEMPLATES DE TURNOS E ESCALAS] ---
# ==============================================================================

@router.get("/shifts")
def list_shifts(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    shifts = db.query(models.RHWorkShift).filter(
        models.RHWorkShift.organization_id == current_user.organization_id
    ).order_by(models.RHWorkShift.name.asc()).all()
    return shifts

@router.post("/shifts")
def create_shift(
    payload: RHWorkShiftCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    existing = db.query(models.RHWorkShift).filter(
        models.RHWorkShift.organization_id == current_user.organization_id,
        models.RHWorkShift.code == payload.code.strip().upper()
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Código de turno já cadastrado")

    desc = payload.description
    if not desc:
        lunch_part = f" (almoço {payload.lunch_start} às {payload.lunch_end}) " if payload.lunch_start else " "
        desc = f"{payload.start_time} às {payload.end_time}{lunch_part}({payload.net_hours}h)"

    if payload.is_default:
        db.query(models.RHWorkShift).filter(
            models.RHWorkShift.organization_id == current_user.organization_id
        ).update({"is_default": False})

    shift = models.RHWorkShift(
        organization_id=current_user.organization_id,
        name=payload.name.strip(),
        code=payload.code.strip().upper(),
        start_time=payload.start_time,
        lunch_start=payload.lunch_start,
        lunch_end=payload.lunch_end,
        end_time=payload.end_time,
        net_hours=payload.net_hours,
        description=desc,
        is_default=payload.is_default
    )
    db.add(shift)
    db.commit()
    db.refresh(shift)
    return shift

@router.put("/shifts/{shift_id}")
def update_shift(
    shift_id: int,
    payload: RHWorkShiftUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    shift = db.query(models.RHWorkShift).filter(
        models.RHWorkShift.id == shift_id,
        models.RHWorkShift.organization_id == current_user.organization_id
    ).first()
    if not shift:
        raise HTTPException(status_code=404, detail="Turno não encontrado")

    if payload.code is not None:
        new_code = payload.code.strip().upper()
        if new_code != shift.code:
            existing = db.query(models.RHWorkShift).filter(
                models.RHWorkShift.organization_id == current_user.organization_id,
                models.RHWorkShift.code == new_code,
                models.RHWorkShift.id != shift_id
            ).first()
            if existing:
                raise HTTPException(status_code=400, detail="Código de turno já cadastrado")
            shift.code = new_code

    if payload.name is not None:
        shift.name = payload.name.strip()
    if payload.start_time is not None:
        shift.start_time = payload.start_time
    if payload.lunch_start is not None:
        shift.lunch_start = payload.lunch_start
    if payload.lunch_end is not None:
        shift.lunch_end = payload.lunch_end
    if payload.end_time is not None:
        shift.end_time = payload.end_time
    if payload.net_hours is not None:
        shift.net_hours = payload.net_hours
    if payload.description is not None:
        shift.description = payload.description
    else:
        lunch_part = f" (almoço {shift.lunch_start} às {shift.lunch_end}) " if shift.lunch_start else " "
        shift.description = f"{shift.start_time} às {shift.end_time}{lunch_part}({shift.net_hours}h)"

    if payload.is_default is not None:
        if payload.is_default:
            db.query(models.RHWorkShift).filter(
                models.RHWorkShift.organization_id == current_user.organization_id,
                models.RHWorkShift.id != shift_id
            ).update({"is_default": False})
        shift.is_default = payload.is_default

    db.commit()
    db.refresh(shift)
    return shift

@router.delete("/shifts/{shift_id}")
def delete_shift(
    shift_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    shift = db.query(models.RHWorkShift).filter(
        models.RHWorkShift.id == shift_id,
        models.RHWorkShift.organization_id == current_user.organization_id
    ).first()
    if not shift:
        raise HTTPException(status_code=404, detail="Turno não encontrado")

    # Desvincular de colaboradores e escalas para não violar integridade referencial
    db.query(models.RHEmployee).filter(
        models.RHEmployee.default_shift_id == shift_id
    ).update({"default_shift_id": None})
    db.query(models.RHScheduleDay).filter(
        models.RHScheduleDay.shift_id == shift_id
    ).update({"shift_id": None, "shift": None})

    db.delete(shift)
    db.commit()
    return {"message": "Turno removido com sucesso"}

# ==============================================================================
# --- [BLOCO: CONFIGURAÇÕES DE RH] ---
# ==============================================================================

@router.get("/settings", response_model=RHSettingsSchema)
def get_rh_settings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    settings = db.query(models.RHSettings).filter(
        models.RHSettings.organization_id == current_user.organization_id
    ).first()

    if not settings:
        settings = models.RHSettings(
            organization_id=current_user.organization_id,
            max_consecutive_sundays=2,
            transport_ticket_unit_price=4.70,
            default_transport_cost=9.40,
            default_meal_cost=25.00,
            min_daily_hours_for_meal=6.0,
            weekly_bank_overtime_hours=4.0,
            compensatory_days_per_month=2,
            time_rounding_minutes=0,
            time_rounding_mode="NEAREST",
            clt_tolerance_enabled=True,
            hours_display_format="HHMM"
        )
        db.add(settings)
        db.commit()
        db.refresh(settings)

    return settings

@router.post("/settings", response_model=RHSettingsSchema)
def update_rh_settings(
    payload: RHSettingsSchema,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    settings = db.query(models.RHSettings).filter(
        models.RHSettings.organization_id == current_user.organization_id
    ).first()

    if not settings:
        settings = models.RHSettings(organization_id=current_user.organization_id)
        db.add(settings)

    settings.max_consecutive_sundays = payload.max_consecutive_sundays
    settings.transport_ticket_unit_price = round(float(payload.transport_ticket_unit_price), 2)
    settings.default_transport_cost = round(float(payload.default_transport_cost), 2)
    settings.default_meal_cost = round(float(payload.default_meal_cost), 2)
    settings.min_daily_hours_for_meal = round(float(payload.min_daily_hours_for_meal), 2)
    settings.weekly_bank_overtime_hours = round(float(payload.weekly_bank_overtime_hours), 2)
    settings.compensatory_days_per_month = payload.compensatory_days_per_month
    settings.time_rounding_minutes = payload.time_rounding_minutes
    settings.time_rounding_mode = payload.time_rounding_mode
    settings.clt_tolerance_enabled = payload.clt_tolerance_enabled
    settings.hours_display_format = payload.hours_display_format

    db.commit()
    db.refresh(settings)
    return settings

# ==============================================================================
# --- [BLOCO: GESTÃO DE COLABORADORES] ---
# ==============================================================================

@router.get("/employees")
def list_employees(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    employees = db.query(models.RHEmployee).filter(
        models.RHEmployee.organization_id == current_user.organization_id
    ).order_by(models.RHEmployee.name.asc()).all()

    result = []
    for emp in employees:
        role_label = emp.role
        if emp.role_obj:
            role_label = emp.role_obj.name
        result.append({
            "id": emp.id,
            "name": emp.name,
            "role_id": emp.role_id,
            "role": role_label,
            "default_shift_id": emp.default_shift_id,
            "default_daily_transport_tickets": (emp.default_daily_transport_tickets if emp.default_daily_transport_tickets is not None else 2),
            "daily_transport_cost": emp.daily_transport_cost,
            "daily_meal_cost": emp.daily_meal_cost,
            "weekly_contract_hours": emp.weekly_contract_hours or 44.0,
            "weekly_actual_hours": emp.weekly_actual_hours if emp.weekly_actual_hours is not None else (emp.weekly_contract_hours or 44.0),
            "work_days_per_week": emp.work_days_per_week or 6,
            "base_salary": emp.base_salary or 0.0,
            "dependents": emp.dependents or 0,
            "active": emp.active
        })
    return result

@router.post("/employees")
def create_employee(
    payload: RHEmployeeCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    role_text = payload.role
    if payload.role_id:
        r = db.query(models.RHRole).filter(models.RHRole.id == payload.role_id).first()
        if r:
            role_text = r.name

    emp = models.RHEmployee(
        organization_id=current_user.organization_id,
        name=payload.name.strip(),
        role_id=payload.role_id,
        role=role_text,
        default_shift_id=payload.default_shift_id,
        default_daily_transport_tickets=payload.default_daily_transport_tickets if payload.default_daily_transport_tickets is not None else 2,
        daily_transport_cost=payload.daily_transport_cost,
        daily_meal_cost=payload.daily_meal_cost,
        weekly_contract_hours=payload.weekly_contract_hours,
        weekly_actual_hours=payload.weekly_actual_hours if payload.weekly_actual_hours is not None else (payload.weekly_contract_hours or 44.0),
        work_days_per_week=payload.work_days_per_week or 6,
        base_salary=round(payload.base_salary or 0.0, 2),
        dependents=payload.dependents or 0,
        active=payload.active
    )
    db.add(emp)
    db.commit()
    db.refresh(emp)
    return emp

@router.put("/employees/{emp_id}")
def update_employee(
    emp_id: int,
    payload: RHEmployeeUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    emp = db.query(models.RHEmployee).filter(
        models.RHEmployee.id == emp_id,
        models.RHEmployee.organization_id == current_user.organization_id
    ).first()

    if not emp:
        raise HTTPException(status_code=404, detail="Colaborador não encontrado")

    if payload.name is not None:
        emp.name = payload.name.strip()
    if payload.role_id is not None:
        emp.role_id = payload.role_id
        r = db.query(models.RHRole).filter(models.RHRole.id == payload.role_id).first()
        if r:
            emp.role = r.name
    elif payload.role is not None:
        emp.role = payload.role.strip()
    if payload.default_shift_id is not None:
        emp.default_shift_id = payload.default_shift_id
    if payload.default_daily_transport_tickets is not None:
        emp.default_daily_transport_tickets = payload.default_daily_transport_tickets
    if payload.daily_meal_cost is not None:
        emp.daily_meal_cost = payload.daily_meal_cost
    if payload.weekly_contract_hours is not None:
        emp.weekly_contract_hours = payload.weekly_contract_hours
    if payload.weekly_actual_hours is not None:
        emp.weekly_actual_hours = payload.weekly_actual_hours
    if payload.work_days_per_week is not None:
        emp.work_days_per_week = payload.work_days_per_week
    if payload.base_salary is not None:
        emp.base_salary = round(payload.base_salary, 2)
    if payload.dependents is not None:
        emp.dependents = payload.dependents
    if payload.active is not None:
        emp.active = payload.active

    db.commit()
    db.refresh(emp)
    return emp

@router.delete("/employees/{emp_id}")
def delete_employee(
    emp_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    emp = db.query(models.RHEmployee).filter(
        models.RHEmployee.id == emp_id,
        models.RHEmployee.organization_id == current_user.organization_id
    ).first()

    if not emp:
        raise HTTPException(status_code=404, detail="Colaborador não encontrado")

    db.delete(emp)
    db.commit()
    return {"message": "Colaborador excluído com sucesso"}

# ==============================================================================
# --- [BLOCO: GESTÃO DE FERIADOS] ---
# ==============================================================================

@router.get("/holidays")
def list_holidays(
    year: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    target_year = year or date.today().year
    return list_all_holidays_for_organization(db, current_user.organization_id, target_year)

@router.post("/holidays")
def add_holiday(
    payload: RHHolidayCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    raw_date = payload.date.strip()
    normalized_date = raw_date[-5:] if len(raw_date) >= 5 else raw_date

    existing = db.query(models.RHHoliday).filter(
        models.RHHoliday.organization_id == current_user.organization_id,
        (models.RHHoliday.date == normalized_date) | (models.RHHoliday.date.like(f"%{normalized_date}"))
    ).first()
    if existing:
        existing.name = payload.name
        existing.date = normalized_date
        db.commit()
        db.refresh(existing)
        return existing

    hol = models.RHHoliday(
        organization_id=current_user.organization_id,
        date=normalized_date,
        name=payload.name
    )
    db.add(hol)
    db.commit()
    db.refresh(hol)
    return hol

@router.delete("/holidays/{holiday_id}")
def delete_holiday(
    holiday_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    hol = db.query(models.RHHoliday).filter(
        models.RHHoliday.id == holiday_id,
        models.RHHoliday.organization_id == current_user.organization_id
    ).first()
    if not hol:
        raise HTTPException(status_code=404, detail="Feriado não encontrado")
    db.delete(hol)
    db.commit()
    return {"message": "Feriado removido com sucesso"}

# ==============================================================================
# --- [BLOCO: ESCALAS MENSAIS E MATRIZ DE DIAS] ---
# ==============================================================================

@router.get("/schedules")
def get_monthly_schedule(
    year: int = Query(...),
    month: int = Query(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    try:
        settings = db.query(models.RHSettings).filter(
            models.RHSettings.organization_id == current_user.organization_id
        ).first()
        if not settings:
            settings = models.RHSettings(organization_id=current_user.organization_id)
            db.add(settings)
            db.commit()
            db.refresh(settings)

        schedule = db.query(models.RHMonthlySchedule).filter(
            models.RHMonthlySchedule.organization_id == current_user.organization_id,
            models.RHMonthlySchedule.year == year,
            models.RHMonthlySchedule.month == month
        ).first()

        if not schedule:
            schedule = models.RHMonthlySchedule(
                organization_id=current_user.organization_id,
                year=year,
                month=month,
                status="DRAFT"
            )
            db.add(schedule)
            db.commit()
            db.refresh(schedule)

        cal_info = get_month_calendar_info(year, month)
        num_days = cal_info["num_days"]
        sundays = cal_info["sundays"]

        effective_holidays = get_effective_holidays_map(db, current_user.organization_id, year, month)
        holidays_by_day = {int(d_str.split("-")[2]): name for d_str, name in effective_holidays.items()}

        employees = db.query(models.RHEmployee).filter(
            models.RHEmployee.organization_id == current_user.organization_id,
            models.RHEmployee.active == True
        ).order_by(models.RHEmployee.name.asc()).all()

        roles = db.query(models.RHRole).filter(
            models.RHRole.organization_id == current_user.organization_id
        ).order_by(models.RHRole.name.asc()).all()

        shifts = db.query(models.RHWorkShift).filter(
            models.RHWorkShift.organization_id == current_user.organization_id
        ).order_by(models.RHWorkShift.name.asc()).all()

        # Buscar dias unificados da nova tabela RHWorkDay
        work_days_db = db.query(models.RHWorkDay).filter(
            models.RHWorkDay.schedule_id == schedule.id
        ).all()

        # Se work_days estiver vazio e houver schedule_days legados, migra em runtime
        if not work_days_db:
            schedule_days = db.query(models.RHScheduleDay).filter(
                models.RHScheduleDay.schedule_id == schedule.id
            ).all()
            if schedule_days:
                from scripts.migrate_rh_work_days import migrate
                migrate(dry_run=False)
                work_days_db = db.query(models.RHWorkDay).filter(
                    models.RHWorkDay.schedule_id == schedule.id
                ).all()

        # Mês sem escala permanece vazio: o preenchimento só ocorre por ação explícita
        # do operador (Aplicar Turnos em Lote / Restaurar Turno Contratual).

        # Buscar ajustes avulsos do mês (D7)
        benefit_adjustments_db = db.query(models.RHBenefitAdjustment).filter(
            models.RHBenefitAdjustment.schedule_id == schedule.id
        ).all()

        # Mapeamento indexado: work_days_by_emp[emp_id][day] = obj
        work_days_by_emp: Dict[int, Dict[int, Any]] = {emp.id: {} for emp in employees}
        for wd in work_days_db:
            if wd.employee_id in work_days_by_emp:
                work_days_by_emp[wd.employee_id][wd.day] = wd

        # Montagem dos dados de resposta unificados e retrocompatíveis
        unified_work_days: Dict[int, Dict[int, Dict[str, Any]]] = {}
        grid_data: Dict[int, Dict[str, Dict[int, Dict[str, Any]]]] = {}

        for emp in employees:
            unified_work_days[emp.id] = {}
            grid_data[emp.id] = {"TRANSPORTE": {}, "ALIMENTACAO": {}}
            emp_default_tickets = (emp.default_daily_transport_tickets if emp.default_daily_transport_tickets is not None else 2)

            for day in range(1, num_days + 1):
                wd = work_days_by_emp[emp.id].get(day)
                if wd:
                    ben = derive_day_benefits(
                        work_day=wd,
                        default_tickets=emp_default_tickets,
                        min_daily_hours_for_meal=settings.min_daily_hours_for_meal or 6.0
                    )
                    status = wd.status
                    worked_min = wd.worked_minutes or 0
                    shift_code = wd.shift
                    shift_id = wd.shift_id
                    start_time = wd.start_time
                    lunch_start = wd.lunch_start
                    lunch_end = wd.lunch_end
                    end_time = wd.end_time
                    is_manual = wd.is_manual
                    vt_override = wd.vt_tickets_override
                    va_override = wd.va_override
                    benefit_note = wd.benefit_note
                else:
                    is_sun = day in sundays
                    status = "FERIADO" if day in holidays_by_day else ("DSR" if is_sun else "FOLGA")
                    ben = {
                        "vt_calc": 0, "vt_final": 0, "vt_is_overridden": False,
                        "va_calc": False, "va_final": False, "va_is_overridden": False,
                        "benefit_note": None
                    }
                    worked_min = 0
                    shift_code = None
                    shift_id = None
                    start_time = None
                    lunch_start = None
                    lunch_end = None
                    end_time = None
                    is_manual = False
                    vt_override = None
                    va_override = None
                    benefit_note = None

                # Estrutura unificada completa
                unified_work_days[emp.id][day] = {
                    "day": day,
                    "status": status,
                    "shift_id": shift_id,
                    "shift": shift_code,
                    "start_time": start_time,
                    "lunch_start": lunch_start,
                    "lunch_end": lunch_end,
                    "end_time": end_time,
                    "raw_minutes": worked_min,
                    "worked_minutes": worked_min,
                    "worked_hours_formatted": format_minutes_to_hours(worked_min, settings.hours_display_format or "HHMM"),
                    "vt_calc": ben["vt_calc"],
                    "vt_final": ben["vt_final"],
                    "vt_is_overridden": ben["vt_is_overridden"],
                    "vt_tickets_override": vt_override,
                    "va_calc": ben["va_calc"],
                    "va_final": ben["va_final"],
                    "va_is_overridden": ben["va_is_overridden"],
                    "va_override": va_override,
                    "benefit_note": benefit_note,
                    "is_manual": is_manual
                }

                # Compatibilidade com telas antigas de matriz
                legacy_t_status = "X" if status == "TRABALHO" else ("BH" if status == "FOLGA_BH" else ("FE" if status == "FERIAS" else ("F" if status == "FERIADO" else "OFF")))
                legacy_m_status = "X" if ben["va_final"] else "OFF"

                grid_data[emp.id]["TRANSPORTE"][day] = {
                    "status": legacy_t_status,
                    "shift_id": shift_id,
                    "shift": shift_code,
                    "tickets_count": ben["vt_final"],
                    "daily_hours": round(worked_min / 60.0, 2)
                }
                grid_data[emp.id]["ALIMENTACAO"][day] = {
                    "status": legacy_m_status,
                    "shift_id": shift_id,
                    "shift": shift_code,
                    "daily_hours": round(worked_min / 60.0, 2)
                }

        # Calcular resumos mensais com o novo motor unificado
        summaries = []
        all_warnings = []
        for emp in employees:
            summary = calculate_work_days_summary(
                employee=emp,
                work_days_map=work_days_by_emp[emp.id],
                benefit_adjustments=benefit_adjustments_db,
                year=year,
                month=month,
                settings=settings
            )
            summaries.append(summary)
            all_warnings.extend(summary.get("warnings", []))

        # Ajustes avulsos serializados
        serialized_adjustments = [
            {
                "id": adj.id,
                "schedule_id": adj.schedule_id,
                "employee_id": adj.employee_id,
                "benefit_type": adj.benefit_type,
                "quantity": adj.quantity,
                "reason": adj.reason,
                "created_at": adj.created_at.isoformat() if adj.created_at else None
            }
            for adj in benefit_adjustments_db
        ]

        return {
            "schedule_id": schedule.id,
            "year": year,
            "month": month,
            "status": schedule.status,
            "num_days": num_days,
            "sundays": sundays,
            "holidays": holidays_by_day,
            "settings": {
                "max_consecutive_sundays": settings.max_consecutive_sundays,
                "transport_ticket_unit_price": round(float(settings.transport_ticket_unit_price), 2) if settings.transport_ticket_unit_price is not None else 4.70,
                "default_transport_cost": round(float(settings.default_transport_cost), 2) if settings.default_transport_cost is not None else 9.40,
                "default_meal_cost": round(float(settings.default_meal_cost), 2) if settings.default_meal_cost is not None else 25.00,
                "min_daily_hours_for_meal": round(float(settings.min_daily_hours_for_meal), 2) if settings.min_daily_hours_for_meal is not None else 6.0,
                "weekly_bank_overtime_hours": round(float(settings.weekly_bank_overtime_hours), 2) if settings.weekly_bank_overtime_hours is not None else 4.0,
                "compensatory_days_per_month": settings.compensatory_days_per_month,
                "time_rounding_minutes": settings.time_rounding_minutes or 0,
                "time_rounding_mode": settings.time_rounding_mode or "NEAREST",
                "clt_tolerance_enabled": settings.clt_tolerance_enabled if settings.clt_tolerance_enabled is not None else True,
                "hours_display_format": settings.hours_display_format or "HHMM"
            },
            "roles": [{"id": r.id, "name": r.name, "description": r.description} for r in roles],
            "shifts": [
                {
                    "id": s.id,
                    "name": s.name,
                    "code": s.code,
                    "start_time": s.start_time,
                    "lunch_start": s.lunch_start,
                    "lunch_end": s.lunch_end,
                    "end_time": s.end_time,
                    "net_hours": s.net_hours,
                    "description": s.description,
                    "is_default": s.is_default
                }
                for s in shifts
            ],
            "employees": [
                {
                    "id": emp.id,
                    "name": emp.name,
                    "role_id": emp.role_id,
                    "role": emp.role_obj.name if emp.role_obj else emp.role or "Geral",
                    "default_shift_id": emp.default_shift_id,
                    "default_daily_transport_tickets": (emp.default_daily_transport_tickets if emp.default_daily_transport_tickets is not None else 2),
                    "daily_meal_cost": emp.daily_meal_cost,
                    "weekly_contract_hours": emp.weekly_contract_hours or 44.0,
                    "weekly_actual_hours": emp.weekly_actual_hours if emp.weekly_actual_hours is not None else (emp.weekly_contract_hours or 44.0),
                    "work_days_per_week": emp.work_days_per_week or 6,
                    "base_salary": emp.base_salary or 0.0,
                    "dependents": emp.dependents or 0
                }
                for emp in employees
            ],
            "work_days": unified_work_days,
            "benefit_adjustments": serialized_adjustments,
            "grid": grid_data,
            "summaries": summaries,
            "warnings": all_warnings
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Erro interno RH: {str(e)}")

# ==============================================================================
# --- [BLOCO: OPERAÇÕES EM LOTE DE JORNADA E BENEFÍCIOS] ---
# ==============================================================================

@router.post("/schedules/fill")
def fill_schedule_shifts(
    payload: RHScheduleFillRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Preenchimento em lote por turno com escopo, dias da semana e proteção de manual."""
    try:
        res = apply_shift_fill(
            db=db,
            organization_id=current_user.organization_id,
            schedule_id=payload.schedule_id,
            employee_ids=payload.employee_ids,
            shift_id=payload.shift_id,
            status=payload.status,
            day_from=payload.day_from,
            day_to=payload.day_to,
            weekdays=payload.weekdays,
            selected_days=payload.selected_days,
            overwrite_manual=payload.overwrite_manual,
            clear_unselected=payload.clear_unselected
        )
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/schedules/clear")
def clear_schedule_shifts_endpoint(
    payload: RHScheduleClearRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Limpa ou restaura a escala de trabalho (para um colaborador ou toda a equipe)."""
    try:
        res = clear_or_reset_schedule(
            db=db,
            organization_id=current_user.organization_id,
            schedule_id=payload.schedule_id,
            employee_id=payload.employee_id,
            mode=payload.mode,
            overwrite_manual=payload.overwrite_manual
        )
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/schedules/work-days")
def update_work_days_batch(
    payload: RHBatchWorkDaysUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Ajuste fino de células de jornada (marca is_manual=True)."""
    schedule = db.query(models.RHMonthlySchedule).filter(
        models.RHMonthlySchedule.id == payload.schedule_id,
        models.RHMonthlySchedule.organization_id == current_user.organization_id
    ).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Escala não encontrada")

    updated = 0
    for item in payload.entries:
        rec = db.query(models.RHWorkDay).filter(
            models.RHWorkDay.schedule_id == schedule.id,
            models.RHWorkDay.employee_id == item.employee_id,
            models.RHWorkDay.day == item.day
        ).first()

        if rec:
            if item.status is not None:
                rec.status = item.status
            # Turno e horários aceitam null explícito (ex: jornada sem intervalo de almoço)
            for field in ("shift_id", "shift", "start_time", "lunch_start", "lunch_end", "end_time"):
                if field in item.model_fields_set:
                    setattr(rec, field, getattr(item, field))
            if item.worked_minutes is not None:
                rec.worked_minutes = item.worked_minutes
                rec.raw_minutes = item.worked_minutes
            elif item.start_time and item.end_time:
                mins = compute_raw_minutes(rec.start_time, rec.lunch_start, rec.lunch_end, rec.end_time)
                rec.raw_minutes = mins
                rec.worked_minutes = mins

            if item.vt_tickets_override is not None:
                rec.vt_tickets_override = item.vt_tickets_override
            if item.va_override is not None:
                rec.va_override = item.va_override
            if item.benefit_note is not None:
                rec.benefit_note = item.benefit_note
            if item.notes is not None:
                rec.notes = item.notes

            rec.is_manual = item.is_manual if item.is_manual is not None else True
            updated += 1
        else:
            new_rec = models.RHWorkDay(
                schedule_id=schedule.id,
                employee_id=item.employee_id,
                day=item.day,
                status=item.status or "TRABALHO",
                shift_id=item.shift_id,
                shift=item.shift,
                start_time=item.start_time,
                lunch_start=item.lunch_start,
                lunch_end=item.lunch_end,
                end_time=item.end_time,
                raw_minutes=item.worked_minutes if item.worked_minutes is not None else 480,
                worked_minutes=item.worked_minutes if item.worked_minutes is not None else 480,
                vt_tickets_override=item.vt_tickets_override,
                va_override=item.va_override,
                benefit_note=item.benefit_note,
                notes=item.notes,
                is_manual=item.is_manual if item.is_manual is not None else True
            )
            db.add(new_rec)
            updated += 1

    db.commit()
    return {"message": f"{updated} registros atualizados com sucesso"}

@router.post("/schedules/benefits/override")
def override_day_benefit(
    payload: RHBenefitOverrideRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Aplica override pontual de VT ou VA em um dia (D5)."""
    rec = db.query(models.RHWorkDay).filter(
        models.RHWorkDay.schedule_id == payload.schedule_id,
        models.RHWorkDay.employee_id == payload.employee_id,
        models.RHWorkDay.day == payload.day
    ).first()

    if not rec:
        raise HTTPException(status_code=404, detail="Dia de trabalho não encontrado")

    if payload.vt_tickets_override is not None:
        rec.vt_tickets_override = payload.vt_tickets_override
    if payload.va_override is not None:
        rec.va_override = payload.va_override
    if payload.benefit_note is not None:
        rec.benefit_note = payload.benefit_note

    db.commit()
    return {"message": "Benefício ajustado com sucesso"}

@router.post("/schedules/benefits/reset")
def reset_day_benefits(
    payload: RHResetBenefitRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Restaura o cálculo de benefício (limpa overrides) para célula, colaborador ou mês."""
    query = db.query(models.RHWorkDay).filter(
        models.RHWorkDay.schedule_id == payload.schedule_id
    )
    if payload.employee_id:
        query = query.filter(models.RHWorkDay.employee_id == payload.employee_id)
    if payload.day:
        query = query.filter(models.RHWorkDay.day == payload.day)

    recs = query.all()
    for r in recs:
        if payload.benefit_type in ("VT", "ALL"):
            r.vt_tickets_override = None
        if payload.benefit_type in ("VA", "ALL"):
            r.va_override = None
        if payload.benefit_type == "ALL":
            r.benefit_note = None

    db.commit()
    return {"message": f"{len(recs)} registros restaurados para o valor calculado"}

@router.get("/schedules/{schedule_id}/benefit-adjustments")
def list_benefit_adjustments(
    schedule_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Lista ajustes avulsos do mês (D7)."""
    adjs = db.query(models.RHBenefitAdjustment).filter(
        models.RHBenefitAdjustment.schedule_id == schedule_id
    ).all()
    return adjs

@router.post("/schedules/benefit-adjustments")
def create_benefit_adjustment(
    payload: RHBenefitAdjustmentCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Cria ajuste avulso de benefício para o mês (D7)."""
    adj = models.RHBenefitAdjustment(
        schedule_id=payload.schedule_id,
        employee_id=payload.employee_id,
        benefit_type=payload.benefit_type.upper(),
        quantity=payload.quantity,
        reason=payload.reason
    )
    db.add(adj)
    db.commit()
    db.refresh(adj)
    return adj

@router.delete("/schedules/benefit-adjustments/{adj_id}")
def delete_benefit_adjustment(
    adj_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    adj = db.query(models.RHBenefitAdjustment).filter(
        models.RHBenefitAdjustment.id == adj_id
    ).first()
    if not adj:
        raise HTTPException(status_code=404, detail="Ajuste não encontrado")
    db.delete(adj)
    db.commit()
    return {"message": "Ajuste removido com sucesso"}

# ==============================================================================
# --- [BLOCO: COMPATIBILIDADE LEGADA - BATCH SAVE E AUTO-FILL] ---
# ==============================================================================

@router.post("/schedules/batch-save")
def batch_save_schedule_days(
    payload: BatchSaveScheduleRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Endpoint legado de compatibilidade que salva e também sincroniza com RHWorkDay."""
    schedule = db.query(models.RHMonthlySchedule).filter(
        models.RHMonthlySchedule.organization_id == current_user.organization_id,
        models.RHMonthlySchedule.year == payload.year,
        models.RHMonthlySchedule.month == payload.month
    ).first()

    if not schedule:
        schedule = models.RHMonthlySchedule(
            organization_id=current_user.organization_id,
            year=payload.year,
            month=payload.month,
            status="DRAFT"
        )
        db.add(schedule)
        db.flush()

    for item in payload.entries:
        # 1. Atualiza na tabela legada
        existing = db.query(models.RHScheduleDay).filter(
            models.RHScheduleDay.schedule_id == schedule.id,
            models.RHScheduleDay.employee_id == item.employee_id,
            models.RHScheduleDay.schedule_type == item.schedule_type,
            models.RHScheduleDay.day == item.day
        ).first()

        if existing:
            existing.status = item.status
            if item.shift_id is not None:
                existing.shift_id = item.shift_id
            if item.shift is not None:
                existing.shift = item.shift
            if item.tickets_count is not None:
                existing.tickets_count = item.tickets_count
            if item.daily_hours is not None:
                existing.daily_hours = item.daily_hours
        else:
            new_day = models.RHScheduleDay(
                schedule_id=schedule.id,
                employee_id=item.employee_id,
                schedule_type=item.schedule_type,
                day=item.day,
                status=item.status,
                shift_id=item.shift_id,
                shift=item.shift,
                tickets_count=item.tickets_count if item.tickets_count is not None else 2,
                daily_hours=item.daily_hours if item.daily_hours is not None else 8.0
            )
            db.add(new_day)

        # 2. Sincroniza na nova tabela RHWorkDay
        wd = db.query(models.RHWorkDay).filter(
            models.RHWorkDay.schedule_id == schedule.id,
            models.RHWorkDay.employee_id == item.employee_id,
            models.RHWorkDay.day == item.day
        ).first()

        st = "TRABALHO" if item.status == "X" else ("FOLGA_BH" if item.status == "BH" else ("FERIAS" if item.status == "FE" else ("FERIADO" if item.status == "F" else "FOLGA")))
        raw_m = int(round((item.daily_hours or 8.0) * 60)) if st == "TRABALHO" else 0

        if wd:
            if item.schedule_type == "TRANSPORTE":
                wd.status = st
                wd.shift_id = item.shift_id
                wd.shift = item.shift
                wd.worked_minutes = raw_m
                wd.raw_minutes = raw_m
                wd.vt_tickets_override = item.tickets_count
            elif item.schedule_type == "ALIMENTACAO":
                wd.va_override = (item.status == "X")
            wd.is_manual = True
        else:
            new_wd = models.RHWorkDay(
                schedule_id=schedule.id,
                employee_id=item.employee_id,
                day=item.day,
                status=st,
                shift_id=item.shift_id,
                shift=item.shift,
                raw_minutes=raw_m,
                worked_minutes=raw_m,
                vt_tickets_override=item.tickets_count if item.schedule_type == "TRANSPORTE" else None,
                va_override=(item.status == "X") if item.schedule_type == "ALIMENTACAO" else None,
                is_manual=True
            )
            db.add(new_wd)

    db.commit()
    return {"message": "Escala atualizada com sucesso", "count": len(payload.entries)}

@router.post("/schedules/auto-fill-standard")
def auto_fill_standard_schedule(
    year: int = Query(...),
    month: int = Query(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    schedule = db.query(models.RHMonthlySchedule).filter(
        models.RHMonthlySchedule.organization_id == current_user.organization_id,
        models.RHMonthlySchedule.year == year,
        models.RHMonthlySchedule.month == month
    ).first()

    if not schedule:
        schedule = models.RHMonthlySchedule(
            organization_id=current_user.organization_id,
            year=year,
            month=month,
            status="DRAFT"
        )
        db.add(schedule)
        db.flush()

    cal_info = get_month_calendar_info(year, month)
    num_days = cal_info["num_days"]
    sundays = set(cal_info["sundays"])

    month_prefix = f"{year:04d}-{month:02d}-"
    holidays = db.query(models.RHHoliday).filter(
        models.RHHoliday.organization_id == current_user.organization_id,
        models.RHHoliday.date.like(f"{month_prefix}%")
    ).all()
    holiday_days = {int(h.date.split("-")[2]) for h in holidays}

    default_shift = db.query(models.RHWorkShift).filter(
        models.RHWorkShift.organization_id == current_user.organization_id,
        models.RHWorkShift.is_default == True
    ).first()

    employees = db.query(models.RHEmployee).filter(
        models.RHEmployee.organization_id == current_user.organization_id,
        models.RHEmployee.active == True
    ).all()

    for emp in employees:
        emp_shift = None
        if emp.default_shift_id:
            emp_shift = db.query(models.RHWorkShift).filter(
                models.RHWorkShift.id == emp.default_shift_id,
                models.RHWorkShift.organization_id == current_user.organization_id
            ).first()

        target_shift = emp_shift or default_shift
        shift_to_use = target_shift.id if target_shift else None
        shift_code = target_shift.code if target_shift else None
        shift_net_hours = target_shift.net_hours if target_shift else 8.0

        tickets_default = (emp.default_daily_transport_tickets if emp.default_daily_transport_tickets is not None else 2)

        for day in range(1, num_days + 1):
            if day in holiday_days:
                status = "F"
            elif day in sundays:
                status = "OFF"
            else:
                status = "X"

            for stype in ["TRANSPORTE", "ALIMENTACAO"]:
                rec = db.query(models.RHScheduleDay).filter(
                    models.RHScheduleDay.schedule_id == schedule.id,
                    models.RHScheduleDay.employee_id == emp.id,
                    models.RHScheduleDay.schedule_type == stype,
                    models.RHScheduleDay.day == day
                ).first()
                if rec:
                    rec.status = status
                    rec.shift_id = shift_to_use
                    rec.shift = shift_code
                    rec.tickets_count = tickets_default
                else:
                    db.add(models.RHScheduleDay(
                        schedule_id=schedule.id,
                        employee_id=emp.id,
                        schedule_type=stype,
                        day=day,
                        status=status,
                        shift_id=shift_to_use,
                        shift=shift_code,
                        tickets_count=tickets_default,
                        daily_hours=shift_net_hours
                    ))

    db.commit()
    return {"message": "Escala padrão preenchida com sucesso!"}
