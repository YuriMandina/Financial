from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import date
import calendar

import models.models as models
from core import auth
from core.database import get_db
from services.rh_engine import (
    get_month_calendar_info,
    calculate_employee_month_summary,
    check_consecutive_sundays_warnings
)

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
    weekly_actual_hours: float = 48.0
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

def ensure_default_shifts(db: Session, organization_id: int):
    """Garante a existência dos turnos padrão de Abertura e Fechamento."""
    count = db.query(models.RHWorkShift).filter(
        models.RHWorkShift.organization_id == organization_id
    ).count()

    if count == 0:
        shifts = [
            models.RHWorkShift(
                organization_id=organization_id,
                name="Abertura de Loja",
                code="ABRE",
                start_time="07:00",
                lunch_start="12:00",
                lunch_end="13:00",
                end_time="16:00",
                net_hours=8.0,
                description="07:00 às 12:00 (almoço 12:00 às 13:00) 13:00 às 16:00",
                is_default=True
            ),
            models.RHWorkShift(
                organization_id=organization_id,
                name="Fechamento de Loja",
                code="FECHA",
                start_time="09:00",
                lunch_start="13:00",
                lunch_end="14:00",
                end_time="19:00",
                net_hours=9.0,
                description="09:00 às 13:00 (almoço 13:00 às 14:00) 14:00 às 19:00",
                is_default=False
            )
        ]
        db.add_all(shifts)
        db.commit()

@router.get("/shifts")
def list_shifts(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    ensure_default_shifts(db, current_user.organization_id)
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
            compensatory_days_per_month=2
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
    settings.transport_ticket_unit_price = payload.transport_ticket_unit_price
    settings.default_transport_cost = payload.default_transport_cost
    settings.default_meal_cost = payload.default_meal_cost
    settings.min_daily_hours_for_meal = payload.min_daily_hours_for_meal
    settings.weekly_bank_overtime_hours = payload.weekly_bank_overtime_hours
    settings.compensatory_days_per_month = payload.compensatory_days_per_month

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
            "default_daily_transport_tickets": emp.default_daily_transport_tickets or 2,
            "daily_transport_cost": emp.daily_transport_cost,
            "daily_meal_cost": emp.daily_meal_cost,
            "weekly_contract_hours": emp.weekly_contract_hours or 44.0,
            "weekly_actual_hours": emp.weekly_actual_hours or 48.0,
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
        default_daily_transport_tickets=payload.default_daily_transport_tickets or 2,
        daily_transport_cost=payload.daily_transport_cost,
        daily_meal_cost=payload.daily_meal_cost,
        weekly_contract_hours=payload.weekly_contract_hours,
        weekly_actual_hours=payload.weekly_actual_hours,
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
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    holidays = db.query(models.RHHoliday).filter(
        models.RHHoliday.organization_id == current_user.organization_id
    ).order_by(models.RHHoliday.date.asc()).all()
    return holidays

@router.post("/holidays")
def add_holiday(
    payload: RHHolidayCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    existing = db.query(models.RHHoliday).filter(
        models.RHHoliday.organization_id == current_user.organization_id,
        models.RHHoliday.date == payload.date
    ).first()
    if existing:
        existing.name = payload.name
        db.commit()
        db.refresh(existing)
        return existing

    hol = models.RHHoliday(
        organization_id=current_user.organization_id,
        date=payload.date,
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
        ensure_default_shifts(db, current_user.organization_id)

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

        month_prefix = f"{year:04d}-{month:02d}-"
        holidays = db.query(models.RHHoliday).filter(
            models.RHHoliday.organization_id == current_user.organization_id,
            models.RHHoliday.date.like(f"{month_prefix}%")
        ).all()
        holidays_by_day = {int(h.date.split("-")[2]): h.name for h in holidays}

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

        schedule_days = db.query(models.RHScheduleDay).filter(
            models.RHScheduleDay.schedule_id == schedule.id
        ).all()

        grid_data: Dict[int, Dict[str, Dict[int, Dict[str, Any]]]] = {}
        for emp in employees:
            grid_data[emp.id] = {
                "TRANSPORTE": {},
                "ALIMENTACAO": {}
            }

        for item in schedule_days:
            if item.employee_id in grid_data:
                if item.schedule_type in grid_data[item.employee_id]:
                    grid_data[item.employee_id][item.schedule_type][item.day] = {
                        "status": item.status,
                        "shift_id": item.shift_id,
                        "shift": item.shift,
                        "tickets_count": item.tickets_count or 2,
                        "daily_hours": item.daily_hours
                    }

        summaries = []
        all_warnings = []
        for emp in employees:
            t_map = grid_data[emp.id]["TRANSPORTE"]
            m_map = grid_data[emp.id]["ALIMENTACAO"]
            summary = calculate_employee_month_summary(emp, t_map, m_map, year, month, settings)
            summaries.append(summary)
            all_warnings.extend(summary.get("warnings", []))

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
                "transport_ticket_unit_price": settings.transport_ticket_unit_price or 4.70,
                "default_transport_cost": settings.default_transport_cost,
                "default_meal_cost": settings.default_meal_cost,
                "min_daily_hours_for_meal": settings.min_daily_hours_for_meal,
                "weekly_bank_overtime_hours": settings.weekly_bank_overtime_hours,
                "compensatory_days_per_month": settings.compensatory_days_per_month
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
                    "default_daily_transport_tickets": emp.default_daily_transport_tickets or 2,
                    "daily_meal_cost": emp.daily_meal_cost,
                    "weekly_contract_hours": emp.weekly_contract_hours or 44.0
                }
                for emp in employees
            ],
            "grid": grid_data,
            "summaries": summaries,
            "warnings": all_warnings
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Erro interno RH: {str(e)}")

@router.post("/schedules/batch-save")
def batch_save_schedule_days(
    payload: BatchSaveScheduleRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
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
        shift_to_use = emp.default_shift_id or (default_shift.id if default_shift else None)
        shift_code = "ABRE"
        if default_shift:
            shift_code = default_shift.code

        tickets_default = emp.default_daily_transport_tickets or 2

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
                        daily_hours=8.0
                    ))

    db.commit()
    return {"message": "Escala padrão preenchida com sucesso!"}
