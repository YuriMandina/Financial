from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional, Dict, Any
from datetime import date, datetime, timezone
import calendar

import models.models as models
from core import auth
from core.database import get_db
from services.rh_engine import (
    get_month_calendar_info,
    calculate_work_days_summary,
    compute_raw_minutes,
    format_minutes_to_hours,
    derive_day_benefits
)
from services.rh_schedule_service import apply_contract_fill, clear_or_reset_schedule, record_change, snapshot_day
from services.rh_contracts import (
    contract_on, contract_day_on, contract_to_dict, template_to_dict, regime_to_dict, load_regimes, regime_on,
    create_contract_version, update_contract_version, delete_contract_version, normalize_days
)
from services.rh_ledger import load_month_ledgers
from services.rh_compliance_service import (
    refresh_month_audit, audit_summary, audit_to_dict, approve_month_audit, item_to_dict, late_occurrences,
    compute_month_violations, sync_month_audit, audited, NO_DAY_HISTORY_RULES
)
from services.rh_compliance_report import build_report, parse_month, report_to_csv, report_to_pdf
from services.rh_payroll_service import sync_payroll_if_calculated, OVERTIME_POLICIES
from services.rh_salary_service import (
    get_salary_history, current_salary, current_role_salary, apply_salary_change, sync_current_salary
)
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
    absence_dsr_mode: str = "ONE"  # NONE, ONE ou SCHEDULE
    overtime_policy: str = "BANK"  # PAY, PAY_NORMAL, FIXED_PLUS_BANK ou BANK
    overtime_rate: float = 50.0
    overtime_fixed_value: float = 0.0
    max_daily_overtime_min: int = 120
    min_interjornada_min: int = 660
    max_consecutive_work_days: int = 6
    habitual_overtime_weeks: int = 3
    compensation_regime: str = "MONTHLY"  # WEEKLY, MONTHLY ou BANK_6M
    week_start: int = 0  # 0 = segunda ... 6 = domingo
    late_waiver_auto_min: int = 0
    late_compensation_mode: str = "AUTO"  # AUTO, MANUAL ou OFF
    late_compensation_max_min: int = 30
    late_compensation_max_per_month: int = 4

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
    base_salary: float = 0.0

class RHRoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    base_salary: Optional[float] = None

class RHContractTemplateCreate(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    days: Dict[str, Any]

class RHContractCreate(BaseModel):
    valid_from: date
    days: Dict[str, Any]  # {"0": {"start","lunch_start","lunch_end","end"} | {"rest": "DSR"|"FOLGA"}, ...}
    template_id: Optional[int] = None
    overtime_agreement: bool = False
    compensation_agreement: bool = False
    amendment_signed: bool = False
    amendment_signed_at: Optional[date] = None
    amendment_file: Optional[str] = None
    change_reason: Optional[str] = None  # ADMISSAO | ACORDO | ADEQUACAO_LEGAL
    notes: Optional[str] = None

class RHContractUpdate(BaseModel):
    days: Optional[Dict[str, Any]] = None
    overtime_agreement: Optional[bool] = None
    compensation_agreement: Optional[bool] = None
    amendment_signed: Optional[bool] = None
    amendment_signed_at: Optional[date] = None
    amendment_file: Optional[str] = None
    change_reason: Optional[str] = None
    notes: Optional[str] = None

class RHEmployeeCreate(BaseModel):
    name: str
    role_id: Optional[int] = None
    role: Optional[str] = None
    default_daily_transport_tickets: int = 2
    daily_transport_cost: float = 9.40
    daily_meal_cost: float = 25.00
    dependents: int = 0
    admission_date: Optional[date] = None
    overtime_policy: Optional[str] = None
    profile: Optional[Dict[str, Any]] = None
    active: bool = True

class RHEmployeeUpdate(BaseModel):
    name: Optional[str] = None
    role_id: Optional[int] = None
    role: Optional[str] = None
    default_daily_transport_tickets: Optional[int] = None
    daily_transport_cost: Optional[float] = None
    daily_meal_cost: Optional[float] = None
    dependents: Optional[int] = None
    admission_date: Optional[date] = None
    overtime_policy: Optional[str] = None
    profile: Optional[Dict[str, Any]] = None
    active: Optional[bool] = None

class RHSalaryChangeCreate(BaseModel):
    effective_date: date
    new_salary: Optional[float] = None
    percent: Optional[float] = None
    reason: Optional[str] = None

class RHSalaryChangeBulk(BaseModel):
    role_ids: Optional[List[int]] = None  # None = todos os cargos
    effective_date: date
    percent: float
    reason: Optional[str] = None

class RHHolidayCreate(BaseModel):
    date: str # YYYY-MM-DD
    name: str

# Schemas para a nova jornada diária unificada
class RHWorkDayItemUpdate(BaseModel):
    employee_id: int
    day: int
    status: Optional[str] = None
    start_time: Optional[str] = None
    lunch_start: Optional[str] = None
    lunch_end: Optional[str] = None
    end_time: Optional[str] = None
    worked_minutes: Optional[int] = None
    vt_tickets_override: Optional[int] = None
    va_override: Optional[bool] = None
    benefit_note: Optional[str] = None
    notes: Optional[str] = None
    late_decision: Optional[str] = None  # ACEITAR_COMPENSACAO | ABONAR | NORMAL (null limpa)
    is_late_record: Optional[bool] = None  # Horário registrado como ponto (atraso), não remanejamento
    late_decision_note: Optional[str] = None
    is_manual: Optional[bool] = True

class RHBatchWorkDaysUpdate(BaseModel):
    schedule_id: int
    entries: List[RHWorkDayItemUpdate]

class RHScheduleFillRequest(BaseModel):
    schedule_id: int
    employee_ids: Optional[List[int]] = None
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


class RHAuditItemNote(BaseModel):
    id: int
    note: Optional[str] = None
    is_force_majeure: bool = False

class RHAuditApproveRequest(BaseModel):
    acknowledged: bool = False  # "Li todas as irregularidades... e aprovo ciente delas"
    general_note: Optional[str] = None
    items: List[RHAuditItemNote] = []

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
    return [_role_to_dict(db, r) for r in roles]

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
        return _role_to_dict(db, existing)

    new_role = models.RHRole(
        organization_id=current_user.organization_id,
        name=payload.name.strip(),
        description=payload.description.strip() if payload.description else None,
        base_salary=round(payload.base_salary or 0.0, 2)
    )
    db.add(new_role)
    db.commit()
    db.refresh(new_role)
    return _role_to_dict(db, new_role)

@router.put("/roles/{role_id}")
def update_role(
    role_id: int,
    payload: RHRoleUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    role = _get_org_role(db, current_user.organization_id, role_id)
    if payload.name is not None and payload.name.strip():
        role.name = payload.name.strip()
    if payload.description is not None:
        role.description = payload.description.strip() or None
    if payload.base_salary is not None:
        # Com histórico, mudanças de salário só por aumento com data de vigência
        if get_salary_history(db, role.id):
            if round(payload.base_salary, 2) != round(current_role_salary(db, role), 2):
                raise HTTPException(status_code=400, detail="Use o aumento salarial com data de vigência para alterar o salário deste cargo")
        else:
            role.base_salary = round(payload.base_salary, 2)
    db.commit()
    db.refresh(role)
    return _role_to_dict(db, role)

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
    in_use = db.query(models.RHEmployee).filter(models.RHEmployee.role_id == role.id).count()
    if in_use:
        raise HTTPException(status_code=409, detail=f"Cargo em uso por {in_use} colaborador(es). Altere o cargo deles antes de excluir.")
    db.delete(role)
    db.commit()
    return {"message": "Cargo removido com sucesso"}

# ==============================================================================
# --- [BLOCO: CONTRATOS DE JORNADA, MODELOS E REGIMES LEGAIS] ---
# ==============================================================================

def _org_settings(db: Session, organization_id: int) -> Optional[models.RHSettings]:
    return db.query(models.RHSettings).filter(models.RHSettings.organization_id == organization_id).first()


def _get_org_employee(db: Session, organization_id: int, emp_id: int) -> models.RHEmployee:
    emp = db.query(models.RHEmployee).filter(
        models.RHEmployee.id == emp_id,
        models.RHEmployee.organization_id == organization_id
    ).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Colaborador não encontrado")
    return emp


def _get_employee_contract(emp: models.RHEmployee, contract_id: int) -> models.RHEmployeeContract:
    version = next((c for c in emp.contracts if c.id == contract_id), None)
    if not version:
        raise HTTPException(status_code=404, detail="Versão de contrato não encontrada")
    return version


@router.get("/legal-regimes")
def list_legal_regimes(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    return [regime_to_dict(r) for r in load_regimes(db)]


@router.get("/contract-templates")
def list_contract_templates(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    templates = db.query(models.RHContractTemplate).filter(
        (models.RHContractTemplate.organization_id.is_(None))
        | (models.RHContractTemplate.organization_id == current_user.organization_id)
    ).order_by(models.RHContractTemplate.is_system.desc(), models.RHContractTemplate.name.asc()).all()
    return [template_to_dict(t) for t in templates]


@router.post("/contract-templates")
def create_contract_template(
    payload: RHContractTemplateCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    template = models.RHContractTemplate(
        organization_id=current_user.organization_id,
        code=payload.code.strip().upper(),
        name=payload.name.strip(),
        description=payload.description,
        days=normalize_days(payload.days),
        is_system=False
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return template_to_dict(template)


@router.delete("/contract-templates/{template_id}")
def delete_contract_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    template = db.query(models.RHContractTemplate).filter(
        models.RHContractTemplate.id == template_id,
        models.RHContractTemplate.organization_id == current_user.organization_id
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Modelo não encontrado (modelos do sistema não podem ser excluídos)")
    db.delete(template)
    db.commit()
    return {"message": "Modelo removido com sucesso"}


@router.get("/employees/{emp_id}/contracts")
def list_employee_contracts(
    emp_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    emp = _get_org_employee(db, current_user.organization_id, emp_id)
    return [contract_to_dict(c) for c in sorted(emp.contracts, key=lambda c: c.valid_from, reverse=True)]


@router.post("/employees/{emp_id}/contracts")
def create_employee_contract(
    emp_id: int,
    payload: RHContractCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Nova versão do contrato de jornada; a anterior passa a valer até a véspera."""
    emp = _get_org_employee(db, current_user.organization_id, emp_id)
    try:
        version = create_contract_version(
            db, emp, payload.model_dump(), current_user.id, _org_settings(db, current_user.organization_id)
        )
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    db.refresh(version)
    return contract_to_dict(version)


@router.put("/employees/{emp_id}/contracts/{contract_id}")
def update_employee_contract(
    emp_id: int,
    contract_id: int,
    payload: RHContractUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    emp = _get_org_employee(db, current_user.organization_id, emp_id)
    version = _get_employee_contract(emp, contract_id)
    try:
        update_contract_version(
            db, emp, version, payload.model_dump(exclude_unset=True), _org_settings(db, current_user.organization_id)
        )
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    db.refresh(version)
    return contract_to_dict(version)


@router.delete("/employees/{emp_id}/contracts/{contract_id}")
def delete_employee_contract(
    emp_id: int,
    contract_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    emp = _get_org_employee(db, current_user.organization_id, emp_id)
    delete_contract_version(db, emp, _get_employee_contract(emp, contract_id))
    db.commit()
    return {"message": "Versão de contrato removida com sucesso"}


def _employee_contract_info(emp: models.RHEmployee, ref_date: date) -> Dict[str, Any]:
    """Contrato vigente na data de referência (ou o próximo, se ainda não começou)."""
    current = contract_on(emp.contracts, ref_date)
    if current is None:
        future = [c for c in emp.contracts if c.valid_from > ref_date]
        current = min(future, key=lambda c: c.valid_from) if future else None
    return {
        "contract": contract_to_dict(current) if current else None,
        "contract_versions": len(emp.contracts),
    }

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
            hours_display_format="HHMM",
            absence_dsr_mode="ONE",
            overtime_policy="BANK",
            overtime_rate=50.0,
            overtime_fixed_value=0.0
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
    if payload.absence_dsr_mode not in ("NONE", "ONE", "SCHEDULE"):
        raise HTTPException(status_code=400, detail="Modo de desconto de DSR inválido")
    settings.absence_dsr_mode = payload.absence_dsr_mode
    if payload.overtime_policy not in OVERTIME_POLICIES:
        raise HTTPException(status_code=400, detail="Destino das horas extras inválido")
    settings.overtime_policy = payload.overtime_policy
    settings.overtime_rate = max(0.0, round(float(payload.overtime_rate or 0.0), 2))
    settings.overtime_fixed_value = max(0.0, round(float(payload.overtime_fixed_value or 0.0), 2))
    if payload.compensation_regime not in ("WEEKLY", "MONTHLY", "BANK_6M"):
        raise HTTPException(status_code=400, detail="Regime de compensação inválido")
    if payload.late_compensation_mode not in ("AUTO", "MANUAL", "OFF"):
        raise HTTPException(status_code=400, detail="Modo de compensação de atraso inválido")
    if not 0 <= payload.week_start <= 6:
        raise HTTPException(status_code=400, detail="Início da semana inválido")
    settings.compensation_regime = payload.compensation_regime
    settings.late_compensation_mode = payload.late_compensation_mode
    settings.week_start = payload.week_start
    for field in ("max_daily_overtime_min", "min_interjornada_min", "max_consecutive_work_days",
                  "habitual_overtime_weeks", "late_waiver_auto_min", "late_compensation_max_min",
                  "late_compensation_max_per_month"):
        setattr(settings, field, max(0, int(getattr(payload, field))))

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
            "default_daily_transport_tickets": (emp.default_daily_transport_tickets if emp.default_daily_transport_tickets is not None else 2),
            "daily_transport_cost": emp.daily_transport_cost,
            "daily_meal_cost": emp.daily_meal_cost,
            "weekly_contract_hours": emp.weekly_contract_hours or 44.0,
            "work_days_per_week": emp.work_days_per_week or 6,
            **_employee_contract_info(emp, date.today()),
            "base_salary": current_salary(db, emp),
            "dependents": emp.dependents or 0,
            "admission_date": emp.admission_date.isoformat() if emp.admission_date else None,
            "overtime_policy": emp.overtime_policy,
            "profile": emp.profile or {},
            "active": emp.active
        })
    return result

PROFILE_SECTIONS = {"pessoal", "documentos", "contato", "contrato", "bancarios", "dependentes", "saude", "uniforme", "observacoes"}


def _clean_profile(profile: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Mantém apenas as seções conhecidas da ficha cadastral e remove valores vazios."""
    if not profile:
        return None
    cleaned: Dict[str, Any] = {}
    for section, value in profile.items():
        if section not in PROFILE_SECTIONS:
            continue
        if isinstance(value, dict):
            data = {k: v for k, v in value.items() if v not in (None, "")}
            if data:
                cleaned[section] = data
        elif isinstance(value, list):
            items = [i for i in value if isinstance(i, dict) and (i.get("nome") or "").strip()]
            if items:
                cleaned[section] = items
        elif isinstance(value, str) and value.strip():
            cleaned[section] = value.strip()
    return cleaned or None


def _sync_irrf_dependents(emp: models.RHEmployee, raw_profile: Optional[Dict[str, Any]]) -> None:
    """Quando a ficha traz a lista de dependentes, a quantidade para IRRF passa a ser derivada dela."""
    deps = (raw_profile or {}).get("dependentes")
    if isinstance(deps, list):
        emp.dependents = sum(1 for d in deps if isinstance(d, dict) and d.get("irrf") and (d.get("nome") or "").strip())


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
        default_daily_transport_tickets=payload.default_daily_transport_tickets if payload.default_daily_transport_tickets is not None else 2,
        daily_transport_cost=payload.daily_transport_cost,
        daily_meal_cost=payload.daily_meal_cost,
        dependents=payload.dependents or 0,
        admission_date=payload.admission_date,
        overtime_policy=payload.overtime_policy if payload.overtime_policy in OVERTIME_POLICIES else None,
        profile=_clean_profile(payload.profile),
        active=payload.active
    )
    _sync_irrf_dependents(emp, payload.profile)
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
    if payload.default_daily_transport_tickets is not None:
        emp.default_daily_transport_tickets = payload.default_daily_transport_tickets
    if payload.daily_meal_cost is not None:
        emp.daily_meal_cost = payload.daily_meal_cost
    if payload.dependents is not None:
        emp.dependents = payload.dependents
    if "admission_date" in payload.model_fields_set:
        emp.admission_date = payload.admission_date
    if payload.profile is not None:
        emp.profile = _clean_profile(payload.profile)
        _sync_irrf_dependents(emp, payload.profile)
    if "overtime_policy" in payload.model_fields_set:
        emp.overtime_policy = payload.overtime_policy if payload.overtime_policy in OVERTIME_POLICIES else None
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

        # Buscar dias unificados da tabela RHWorkDay
        work_days_db = db.query(models.RHWorkDay).filter(
            models.RHWorkDay.schedule_id == schedule.id
        ).all()

        # Mês sem escala permanece vazio: o preenchimento só ocorre por ação explícita
        # do operador (Aplicar Contrato em Lote / Restaurar Contrato).

        # Buscar ajustes avulsos do mês (D7)
        benefit_adjustments_db = db.query(models.RHBenefitAdjustment).filter(
            models.RHBenefitAdjustment.schedule_id == schedule.id
        ).all()

        # Mapeamento indexado: work_days_by_emp[emp_id][day] = obj
        work_days_by_emp: Dict[int, Dict[int, Any]] = {emp.id: {} for emp in employees}
        for wd in work_days_db:
            if wd.employee_id in work_days_by_emp:
                work_days_by_emp[wd.employee_id][wd.day] = wd

        # Ledger diário (horas extras, débitos, compensação) com contexto do mês anterior e feriados
        ledgers = load_month_ledgers(db, current_user.organization_id, schedule, employees, settings)

        # Montagem dos dados de resposta unificados
        unified_work_days: Dict[int, Dict[int, Dict[str, Any]]] = {}

        for emp in employees:
            unified_work_days[emp.id] = {}
            emp_ledger = ledgers.get(emp.id, {})
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
                    start_time = wd.start_time
                    lunch_start = wd.lunch_start
                    lunch_end = wd.lunch_end
                    end_time = wd.end_time
                    is_manual = wd.is_manual
                    vt_override = wd.vt_tickets_override
                    va_override = wd.va_override
                    benefit_note = wd.benefit_note
                    late_decision = wd.late_decision
                    is_late_record = bool(wd.is_late_record)
                else:
                    is_sun = day in sundays
                    status = "FERIADO" if day in holidays_by_day else ("DSR" if is_sun else "FOLGA")
                    ben = {
                        "vt_calc": 0, "vt_final": 0, "vt_is_overridden": False,
                        "va_calc": False, "va_final": False, "va_is_overridden": False,
                        "benefit_note": None
                    }
                    worked_min = 0
                    start_time = None
                    lunch_start = None
                    lunch_end = None
                    end_time = None
                    is_manual = False
                    vt_override = None
                    va_override = None
                    benefit_note = None
                    late_decision = None
                    is_late_record = False

                day_date = date(year, month, day)
                cd = contract_day_on(emp.contracts, day_date)
                contract_day = None
                if cd is not None:
                    contract_day = {"rest": cd.rest} if cd.rest else {
                        "start_time": cd.start, "lunch_start": cd.lunch_start,
                        "lunch_end": cd.lunch_end, "end_time": cd.end, "minutes": cd.minutes
                    }
                dl = emp_ledger.get(day_date)

                # Estrutura unificada completa
                unified_work_days[emp.id][day] = {
                    "day": day,
                    "status": status,
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
                    "is_manual": is_manual,
                    "late_decision": late_decision,
                    "is_late_record": is_late_record,
                    "contract_day": contract_day,
                    "ledger": dl.to_dict() if dl else None
                }

        # Calcular resumos mensais com o novo motor unificado
        summaries = []
        for emp in employees:
            summary = calculate_work_days_summary(
                employee=emp,
                work_days_map=work_days_by_emp[emp.id],
                benefit_adjustments=benefit_adjustments_db,
                year=year,
                month=month,
                settings=settings,
                ledger=ledgers.get(emp.id, {})
            )
            summaries.append(summary)

        # Auditoria do mês (motor de regras): só a situação resumida vai para a tela da escala
        audit, _ = refresh_month_audit(db, current_user.organization_id, year, month)
        db.commit()
        compliance = audit_summary(audit)
        # Marcador discreto nas células: dias do mês envolvidos em cada irregularidade
        compliance_days: Dict[int, Dict[int, List[str]]] = {}
        for item in audit.items:
            for iso in item.dates or []:
                d = date.fromisoformat(iso)
                if (d.year, d.month) == (year, month):
                    compliance_days.setdefault(item.employee_id, {}).setdefault(d.day, []).append(item.rule_code)
        compliance["days"] = compliance_days

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
            "organization_name": (db.query(models.Organization).get(current_user.organization_id).name
                                  if current_user.organization_id else None),
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
                "hours_display_format": settings.hours_display_format or "HHMM",
                "absence_dsr_mode": settings.absence_dsr_mode or "ONE",
                "overtime_policy": settings.overtime_policy or "BANK",
                "overtime_rate": settings.overtime_rate if settings.overtime_rate is not None else 50.0,
                "overtime_fixed_value": settings.overtime_fixed_value or 0.0,
                "compensation_regime": settings.compensation_regime or "MONTHLY",
                "week_start": settings.week_start or 0,
                "max_daily_overtime_min": settings.max_daily_overtime_min if settings.max_daily_overtime_min is not None else 120,
                "min_interjornada_min": settings.min_interjornada_min if settings.min_interjornada_min is not None else 660,
                "max_consecutive_work_days": settings.max_consecutive_work_days or 6,
                "habitual_overtime_weeks": settings.habitual_overtime_weeks or 3,
                "late_waiver_auto_min": settings.late_waiver_auto_min or 0,
                "late_compensation_mode": settings.late_compensation_mode or "AUTO",
                "late_compensation_max_min": settings.late_compensation_max_min if settings.late_compensation_max_min is not None else 30,
                "late_compensation_max_per_month": settings.late_compensation_max_per_month if settings.late_compensation_max_per_month is not None else 4,
                "company": (db.query(models.Organization).get(current_user.organization_id).company or {})
                           if current_user.organization_id else {}
            },
            "roles": [_role_to_dict(db, r) for r in roles],
            "regime": regime_to_dict(regime_on(load_regimes(db), date(year, month, 1))),
            "employees": [
                {
                    "id": emp.id,
                    "name": emp.name,
                    "role_id": emp.role_id,
                    "role": emp.role_obj.name if emp.role_obj else emp.role or "Geral",
                    "default_daily_transport_tickets": (emp.default_daily_transport_tickets if emp.default_daily_transport_tickets is not None else 2),
                    "daily_meal_cost": emp.daily_meal_cost,
                    "weekly_contract_hours": emp.weekly_contract_hours or 44.0,
                    "work_days_per_week": emp.work_days_per_week or 6,
                    **_employee_contract_info(emp, date(year, month, 1)),
                    "base_salary": current_salary(db, emp),
                    "dependents": emp.dependents or 0,
                    "admission_date": emp.admission_date.isoformat() if emp.admission_date else None,
                    "overtime_policy": emp.overtime_policy,
                    "profile": emp.profile or {}
                }
                for emp in employees
            ],
            "work_days": unified_work_days,
            "benefit_adjustments": serialized_adjustments,
            "summaries": summaries,
            "compliance": compliance
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Erro interno RH: {str(e)}")

# ==============================================================================
# --- [BLOCO: OPERAÇÕES EM LOTE DE JORNADA E BENEFÍCIOS] ---
# ==============================================================================

@router.post("/schedules/fill")
def fill_schedule_from_contract(
    payload: RHScheduleFillRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Preenchimento em lote pelo contrato de jornada, com escopo, dias da semana e proteção de manual."""
    try:
        res = apply_contract_fill(
            db=db,
            organization_id=current_user.organization_id,
            schedule_id=payload.schedule_id,
            employee_ids=payload.employee_ids,
            status=payload.status,
            day_from=payload.day_from,
            day_to=payload.day_to,
            weekdays=payload.weekdays,
            selected_days=payload.selected_days,
            overwrite_manual=payload.overwrite_manual,
            clear_unselected=payload.clear_unselected,
            user_id=current_user.id
        )
        sync_payroll_if_calculated(db, current_user.organization_id, payload.schedule_id)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/schedules/clear")
def clear_or_reset_schedule_endpoint(
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
            overwrite_manual=payload.overwrite_manual,
            user_id=current_user.id
        )
        sync_payroll_if_calculated(db, current_user.organization_id, payload.schedule_id)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/schedules/work-days")
def update_work_days_batch(
    payload: RHBatchWorkDaysUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """
    Ajuste fino de células de jornada (marca is_manual=True). Salva sempre (sem bloqueio);
    a resposta traz as irregularidades NOVAS causadas pela alteração, para o aviso rápido (seção 10.1).
    """
    schedule = db.query(models.RHMonthlySchedule).filter(
        models.RHMonthlySchedule.id == payload.schedule_id,
        models.RHMonthlySchedule.organization_id == current_user.organization_id
    ).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Escala não encontrada")

    org_id = current_user.organization_id
    affected = sorted({item.employee_id for item in payload.entries})
    before_fps = {
        v.fingerprint
        for vs in compute_month_violations(db, org_id, schedule.year, schedule.month, affected).values()
        for v in audited(vs)
    }

    updated = 0
    changes_by_emp: Dict[int, List[models.RHWorkDayChange]] = {}
    for item in payload.entries:
        rec = db.query(models.RHWorkDay).filter(
            models.RHWorkDay.schedule_id == schedule.id,
            models.RHWorkDay.employee_id == item.employee_id,
            models.RHWorkDay.day == item.day
        ).first()
        before = snapshot_day(rec)

        if not rec:
            rec = models.RHWorkDay(
                schedule_id=schedule.id,
                employee_id=item.employee_id,
                day=item.day,
                status=item.status or "TRABALHO",
                raw_minutes=0,
                worked_minutes=0
            )
            db.add(rec)
        elif item.status is not None:
            rec.status = item.status

        # Horários aceitam null explícito (ex: jornada sem intervalo de almoço)
        for field in ("start_time", "lunch_start", "lunch_end", "end_time"):
            if field in item.model_fields_set:
                setattr(rec, field, getattr(item, field))
        if rec.status != "TRABALHO":
            rec.raw_minutes = rec.worked_minutes = 0
        elif item.worked_minutes is not None:
            rec.raw_minutes = rec.worked_minutes = item.worked_minutes
        elif rec.start_time and rec.end_time:
            rec.raw_minutes = rec.worked_minutes = compute_raw_minutes(
                rec.start_time, rec.lunch_start, rec.lunch_end, rec.end_time
            )

        if item.vt_tickets_override is not None:
            rec.vt_tickets_override = item.vt_tickets_override
        if item.va_override is not None:
            rec.va_override = item.va_override
        if item.benefit_note is not None:
            rec.benefit_note = item.benefit_note
        if item.notes is not None:
            rec.notes = item.notes
        if item.is_late_record is not None:
            rec.is_late_record = item.is_late_record
        if "late_decision" in item.model_fields_set:
            if item.late_decision not in (None, "ACEITAR_COMPENSACAO", "ABONAR", "NORMAL"):
                raise HTTPException(status_code=400, detail="Decisão de atraso inválida")
            rec.late_decision = item.late_decision
            rec.late_decision_note = item.late_decision_note
            rec.late_decision_by = current_user.id if item.late_decision else None
            rec.late_decision_at = datetime.now(timezone.utc) if item.late_decision else None

        rec.is_manual = item.is_manual if item.is_manual is not None else True
        change = record_change(
            db, current_user.organization_id, schedule, item.employee_id, item.day,
            before, snapshot_day(rec), "MANUAL", current_user.id
        )
        if change is not None:
            changes_by_emp.setdefault(item.employee_id, []).append(change)
        updated += 1

    # Irregularidades depois da alteração: as novas vão para o aviso rápido e para o histórico do dia
    db.flush()
    after = compute_month_violations(db, org_id, schedule.year, schedule.month, affected)
    names = {e.id: e.name for e in db.query(models.RHEmployee).filter(models.RHEmployee.id.in_(affected)).all()}
    new_violations = [v for vs in after.values() for v in audited(vs) if v.fingerprint not in before_fps]
    for emp_id, changes in changes_by_emp.items():
        for change in changes:
            fps = [v.fingerprint for v in new_violations if v.employee_id == emp_id and change.work_date in v.dates]
            change.violation_fingerprints = fps or None
    sync_month_audit(db, org_id, schedule.year, schedule.month, after, names)

    db.commit()
    sync_payroll_if_calculated(db, current_user.organization_id, schedule.id)
    return {
        "message": f"{updated} registros atualizados com sucesso",
        "new_violations": [
            {
                "code": v.code,
                "title": v.title,
                "severity": v.severity,
                "employee_id": v.employee_id,
                "employee_name": names.get(v.employee_id),
                "dates": [d.isoformat() for d in v.dates],
                "fingerprint": v.fingerprint,
            }
            for v in new_violations
        ],
    }

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
        # Dia ainda sem registro na escala: cria como folga/DSR para receber o ajuste do benefício
        schedule = db.query(models.RHMonthlySchedule).filter(
            models.RHMonthlySchedule.id == payload.schedule_id,
            models.RHMonthlySchedule.organization_id == current_user.organization_id
        ).first()
        if not schedule:
            raise HTTPException(status_code=404, detail="Escala não encontrada")
        is_sunday = date(schedule.year, schedule.month, payload.day).weekday() == 6
        rec = models.RHWorkDay(
            schedule_id=schedule.id, employee_id=payload.employee_id, day=payload.day,
            status="DSR" if is_sunday else "FOLGA", raw_minutes=0, worked_minutes=0, is_manual=False
        )
        db.add(rec)

    if payload.vt_tickets_override is not None:
        rec.vt_tickets_override = payload.vt_tickets_override
    if payload.va_override is not None:
        rec.va_override = payload.va_override
    if payload.benefit_note is not None:
        rec.benefit_note = payload.benefit_note

    db.commit()
    sync_payroll_if_calculated(db, current_user.organization_id, payload.schedule_id)
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
    sync_payroll_if_calculated(db, current_user.organization_id, payload.schedule_id)
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
    sync_payroll_if_calculated(db, current_user.organization_id, payload.schedule_id)
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
    schedule_id = adj.schedule_id
    db.delete(adj)
    db.commit()
    sync_payroll_if_calculated(db, current_user.organization_id, schedule_id)
    return {"message": "Ajuste removido com sucesso"}

# ==============================================================================
# --- [BLOCO: CONFORMIDADE TRABALHISTA E AUDITORIA MENSAL] ---
# ==============================================================================

def _get_schedule_by_month(db: Session, organization_id: int, year: int, month: int) -> Optional[models.RHMonthlySchedule]:
    return db.query(models.RHMonthlySchedule).filter(
        models.RHMonthlySchedule.organization_id == organization_id,
        models.RHMonthlySchedule.year == year,
        models.RHMonthlySchedule.month == month
    ).first()


@router.get("/compliance")
def get_month_compliance(
    year: int = Query(...),
    month: int = Query(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Irregularidades do mês (auditoria), informativos e ocorrências de ponto."""
    audit, violations = refresh_month_audit(db, current_user.organization_id, year, month)
    db.commit()
    names = {e.id: e.name for e in db.query(models.RHEmployee).filter(
        models.RHEmployee.organization_id == current_user.organization_id
    ).all()}
    infos = [
        {**v.to_dict(), "employee_name": names.get(v.employee_id)}
        for vs in violations.values() for v in vs if v.severity == "INFO"
    ]
    schedule = _get_schedule_by_month(db, current_user.organization_id, year, month)
    return {
        "audit": audit_to_dict(db, audit),
        "infos": infos,
        "occurrences": late_occurrences(db, current_user.organization_id, schedule) if schedule else [],
    }


@router.post("/compliance/audits/{year}/{month}/approve")
def approve_compliance_audit(
    year: int,
    month: int,
    payload: RHAuditApproveRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Aprova o conjunto de irregularidades do mês e grava o snapshot do que foi lido (seção 10.2)."""
    if not payload.acknowledged:
        raise HTTPException(status_code=400, detail="Confirme a leitura das irregularidades antes de aprovar.")
    audit, _ = refresh_month_audit(db, current_user.organization_id, year, month)
    if not audit.items:
        raise HTTPException(status_code=400, detail="Não há irregularidades para aprovar neste mês.")
    notes = {n.id: n.model_dump() for n in payload.items}
    approve_month_audit(audit, current_user, payload.general_note, notes)
    db.commit()
    return audit_to_dict(db, audit)


@router.get("/compliance/report")
def get_compliance_report(
    date_from: str = Query(..., description="Mês inicial, AAAA-MM"),
    date_to: str = Query(..., description="Mês final, AAAA-MM"),
    employee_id: Optional[int] = Query(None),
    rule: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    format: str = Query("json"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Relatório de irregularidades do período (JSON, CSV ou PDF) com filtros, totais e reincidências."""
    try:
        report = build_report(
            db, current_user.organization_id, parse_month(date_from), parse_month(date_to),
            employee_id=employee_id, rule=rule or None, severity=severity or None, status=status or None
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    filename = f"irregularidades_{date_from}_a_{date_to}"
    if format == "csv":
        return Response(report_to_csv(report), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="{filename}.csv"'})
    if format == "pdf":
        org = db.query(models.Organization).get(current_user.organization_id)
        return Response(report_to_pdf(report, org.name if org else None), media_type="application/pdf",
                        headers={"Content-Disposition": f'attachment; filename="{filename}.pdf"'})
    return report


@router.get("/compliance/items/{item_id}")
def get_compliance_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Ficha completa da irregularidade, com o histórico de alterações dos dias envolvidos."""
    item = db.query(models.RHAuditItem).join(models.RHMonthlyAudit).filter(
        models.RHAuditItem.id == item_id,
        models.RHMonthlyAudit.organization_id == current_user.organization_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Irregularidade não encontrada")
    dates = [] if item.rule_code in NO_DAY_HISTORY_RULES else [date.fromisoformat(d) for d in (item.dates or [])]
    users = {u.id: (u.name or u.email) for u in db.query(models.User).filter(
        models.User.organization_id == current_user.organization_id
    ).all()}
    changes = db.query(models.RHWorkDayChange).filter(
        models.RHWorkDayChange.employee_id == item.employee_id,
        models.RHWorkDayChange.work_date.in_(dates)
    ).order_by(models.RHWorkDayChange.created_at.asc(), models.RHWorkDayChange.id.asc()).all() if dates else []
    return {
        **item_to_dict(item),
        "changes": [
            {
                "id": c.id,
                "work_date": c.work_date.isoformat(),
                "origin": c.origin,
                "before": c.before,
                "after": c.after,
                "user": users.get(c.user_id),
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in changes
        ],
    }


# ==============================================================================
# --- [BLOCO: HISTÓRICO DE ALTERAÇÕES DA ESCALA] ---
# ==============================================================================

@router.get("/schedules/{schedule_id}/changes")
def list_schedule_changes(
    schedule_id: int,
    employee_id: Optional[int] = Query(None),
    day: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Histórico imutável das gravações de dias da escala (seção 10.4 do planejamento)."""
    query = db.query(models.RHWorkDayChange).filter(
        models.RHWorkDayChange.schedule_id == schedule_id,
        models.RHWorkDayChange.organization_id == current_user.organization_id
    )
    if employee_id:
        query = query.filter(models.RHWorkDayChange.employee_id == employee_id)
    if day:
        schedule = db.query(models.RHMonthlySchedule).get(schedule_id)
        if schedule:
            query = query.filter(models.RHWorkDayChange.work_date == date(schedule.year, schedule.month, day))
    users = {u.id: (u.name or u.email) for u in db.query(models.User).filter(
        models.User.organization_id == current_user.organization_id
    ).all()}
    return [
        {
            "id": c.id,
            "employee_id": c.employee_id,
            "work_date": c.work_date.isoformat(),
            "origin": c.origin,
            "before": c.before,
            "after": c.after,
            "user": users.get(c.user_id),
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c in query.order_by(models.RHWorkDayChange.created_at.desc(), models.RHWorkDayChange.id.desc()).all()
    ]


# ==============================================================================
# --- [BLOCO: SALÁRIO DO CARGO, HISTÓRICO E AUMENTO SALARIAL] ---
# ==============================================================================

def _get_org_role(db: Session, organization_id: int, role_id: int) -> models.RHRole:
    role = db.query(models.RHRole).filter(
        models.RHRole.id == role_id,
        models.RHRole.organization_id == organization_id
    ).first()
    if not role:
        raise HTTPException(status_code=404, detail="Cargo não encontrado")
    return role


def _role_to_dict(db: Session, role: models.RHRole) -> Dict[str, Any]:
    return {
        "id": role.id,
        "name": role.name,
        "description": role.description,
        "base_salary": current_role_salary(db, role),
        "employee_count": db.query(models.RHEmployee).filter(
            models.RHEmployee.role_id == role.id, models.RHEmployee.active == True
        ).count(),
        "has_salary_history": bool(get_salary_history(db, role.id)),
    }


def _salary_change_to_dict(c: models.RHSalaryChange) -> Dict[str, Any]:
    return {
        "id": c.id,
        "role_id": c.role_id,
        "effective_date": c.effective_date.isoformat() if c.effective_date else None,
        "salary": round(c.salary or 0.0, 2),
        "reason": c.reason,
        "is_initial": c.effective_date is None,
    }


def _get_org_salary_change(db: Session, organization_id: int, change_id: int) -> models.RHSalaryChange:
    change = db.query(models.RHSalaryChange).join(models.RHRole).filter(
        models.RHSalaryChange.id == change_id,
        models.RHRole.organization_id == organization_id
    ).first()
    if not change:
        raise HTTPException(status_code=404, detail="Registro salarial não encontrado")
    return change


@router.get("/roles/{role_id}/salary-history")
def list_role_salary_history(
    role_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    role = _get_org_role(db, current_user.organization_id, role_id)
    history = get_salary_history(db, role.id)
    if not history:
        # Sem aumentos ainda: exibe o salário do cargo como inicial
        return [{
            "id": None, "role_id": role.id, "effective_date": None,
            "salary": round(role.base_salary or 0.0, 2), "reason": "Salário inicial", "is_initial": True
        }]
    return [_salary_change_to_dict(c) for c in history]


@router.post("/roles/{role_id}/salary-changes")
def create_role_salary_change(
    role_id: int,
    payload: RHSalaryChangeCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    role = _get_org_role(db, current_user.organization_id, role_id)
    try:
        change = apply_salary_change(
            db, role, payload.effective_date,
            new_salary=payload.new_salary, percent=payload.percent, reason=payload.reason
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    db.refresh(change)
    return _salary_change_to_dict(change)


@router.post("/salary-changes/bulk")
def create_bulk_salary_change(
    payload: RHSalaryChangeBulk,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Aumento coletivo (ex: dissídio) em percentual para todos os cargos ou os selecionados."""
    query = db.query(models.RHRole).filter(models.RHRole.organization_id == current_user.organization_id)
    if payload.role_ids:
        query = query.filter(models.RHRole.id.in_(payload.role_ids))
    roles = query.all()

    for role in roles:
        apply_salary_change(db, role, payload.effective_date, percent=payload.percent, reason=payload.reason)
    db.commit()
    return {"message": f"Aumento de {payload.percent:g}% aplicado em {len(roles)} cargo(s)."}


@router.put("/salary-changes/{change_id}")
def update_salary_change(
    change_id: int,
    payload: RHSalaryChangeCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    change = _get_org_salary_change(db, current_user.organization_id, change_id)
    if payload.new_salary is None or payload.new_salary < 0:
        raise HTTPException(status_code=400, detail="Informe o salário")
    if change.effective_date is not None and payload.effective_date != change.effective_date:
        clash = db.query(models.RHSalaryChange.id).filter(
            models.RHSalaryChange.role_id == change.role_id,
            models.RHSalaryChange.effective_date == payload.effective_date,
            models.RHSalaryChange.id != change.id
        ).first()
        if clash:
            raise HTTPException(status_code=400, detail="Já existe um lançamento salarial nesta data para o cargo")
        change.effective_date = payload.effective_date
    change.salary = round(payload.new_salary, 2)
    change.reason = (payload.reason or "").strip() or None
    db.flush()
    sync_current_salary(db, change.role)
    db.commit()
    return _salary_change_to_dict(change)


@router.delete("/salary-changes/{change_id}")
def delete_salary_change(
    change_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    change = _get_org_salary_change(db, current_user.organization_id, change_id)
    if change.effective_date is None:
        raise HTTPException(status_code=400, detail="O salário inicial não pode ser excluído; edite o valor")
    role = change.role
    db.delete(change)
    db.flush()
    sync_current_salary(db, role)
    db.commit()
    return {"message": "Aumento salarial excluído"}
