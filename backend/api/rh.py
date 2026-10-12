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
    default_transport_cost: float = 9.40
    default_meal_cost: float = 25.00
    min_daily_hours_for_meal: float = 6.0
    weekly_bank_overtime_hours: float = 4.0
    compensatory_days_per_month: int = 2

class RHEmployeeCreate(BaseModel):
    name: str
    role: Optional[str] = None
    daily_transport_cost: float = 9.40
    daily_meal_cost: float = 25.00
    weekly_contract_hours: float = 44.0
    weekly_actual_hours: float = 48.0
    active: bool = True

class RHEmployeeUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
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
    shift: Optional[str] = None # 'ABRE', 'FECHA', etc.
    daily_hours: Optional[float] = 8.0

class BatchSaveScheduleRequest(BaseModel):
    year: int
    month: int
    entries: List[DayEntryUpdate]

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
    return employees

@router.post("/employees")
def create_employee(
    payload: RHEmployeeCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    emp = models.RHEmployee(
        organization_id=current_user.organization_id,
        name=payload.name.strip(),
        role=payload.role.strip() if payload.role else None,
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
    if payload.role is not None:
        emp.role = payload.role.strip()
    if payload.daily_transport_cost is not None:
        emp.daily_transport_cost = payload.daily_transport_cost
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
# --- [BLOCO: ESCALAS MENSAIS E MATRIZ DE DIAS (VT & VA SEPARADOS - OPÇÃO B)] ---
# ==============================================================================

@router.get("/schedules")
def get_monthly_schedule(
    year: int = Query(...),
    month: int = Query(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """
    Retorna a matriz completa da escala do mês (ano/mês) contendo:
    - Metadados do calendário (número de dias, domingos, feriados)
    - Lista de colaboradores ativos
    - Dados separados para TRANSPORTE e ALIMENTACAO (Opção B)
    - Totais de cálculo antecipado de benefícios
    - Alertas informativos de domingos e banco de horas
    """
    settings = db.query(models.RHSettings).filter(
        models.RHSettings.organization_id == current_user.organization_id
    ).first()
    if not settings:
        settings = models.RHSettings(organization_id=current_user.organization_id)
        db.add(settings)
        db.commit()
        db.refresh(settings)

    # Obter ou criar o cabeçalho da escala mensal
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

    # Feriados do mês
    month_prefix = f"{year:04d}-{month:02d}-"
    holidays = db.query(models.RHHoliday).filter(
        models.RHHoliday.organization_id == current_user.organization_id,
        models.RHHoliday.date.like(f"{month_prefix}%")
    ).all()
    holidays_by_day = {int(h.date.split("-")[2]): h.name for h in holidays}

    # Colaboradores
    employees = db.query(models.RHEmployee).filter(
        models.RHEmployee.organization_id == current_user.organization_id,
        models.RHEmployee.active == True
    ).order_by(models.RHEmployee.name.asc()).all()

    # Itens existentes na escala
    schedule_days = db.query(models.RHScheduleDay).filter(
        models.RHScheduleDay.schedule_id == schedule.id
    ).all()

    # Mapear por [emp_id][schedule_type][day]
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
                    "shift": item.shift,
                    "daily_hours": item.daily_hours
                }

    # Calcular resumos por funcionário
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
            "default_transport_cost": settings.default_transport_cost,
            "default_meal_cost": settings.default_meal_cost,
            "min_daily_hours_for_meal": settings.min_daily_hours_for_meal,
            "weekly_bank_overtime_hours": settings.weekly_bank_overtime_hours,
            "compensatory_days_per_month": settings.compensatory_days_per_month
        },
        "employees": [
            {
                "id": emp.id,
                "name": emp.name,
                "role": emp.role,
                "daily_transport_cost": emp.daily_transport_cost,
                "daily_meal_cost": emp.daily_meal_cost
            }
            for emp in employees
        ],
        "grid": grid_data,
        "summaries": summaries,
        "warnings": all_warnings
    }

@router.post("/schedules/batch-save")
def batch_save_schedule_days(
    payload: BatchSaveScheduleRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """
    Gravação em lote com upsert eficiente dos dias programados.
    """
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
        # Busca registro existente
        existing = db.query(models.RHScheduleDay).filter(
            models.RHScheduleDay.schedule_id == schedule.id,
            models.RHScheduleDay.employee_id == item.employee_id,
            models.RHScheduleDay.schedule_type == item.schedule_type,
            models.RHScheduleDay.day == item.day
        ).first()

        if existing:
            existing.status = item.status
            if item.shift is not None:
                existing.shift = item.shift
            if item.daily_hours is not None:
                existing.daily_hours = item.daily_hours
        else:
            new_day = models.RHScheduleDay(
                schedule_id=schedule.id,
                employee_id=item.employee_id,
                schedule_type=item.schedule_type,
                day=item.day,
                status=item.status,
                shift=item.shift,
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
    """
    Inicializa rapidamente a escala padrão para todos os colaboradores ativos:
    - Segunda a Sábado: 'X' (Trabalho, 8h)
    - Domingos: 'OFF' (Folga semanal padrão)
    - Feriados cadastrados: 'F' (Feriado)
    Preenche tanto para Transporte quanto para Alimentação.
    """
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
    holiday_days = set([int(h.date.split("-")[2]) for h in holidays])

    employees = db.query(models.RHEmployee).filter(
        models.RHEmployee.organization_id == current_user.organization_id,
        models.RHEmployee.active == True
    ).all()

    for emp in employees:
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
                else:
                    db.add(models.RHScheduleDay(
                        schedule_id=schedule.id,
                        employee_id=emp.id,
                        schedule_type=stype,
                        day=day,
                        status=status,
                        daily_hours=8.0
                    ))

    db.commit()
    return {"message": "Escala padrão preenchida com sucesso!"}
