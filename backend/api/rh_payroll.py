from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional

import models.models as models
from core import auth
from core.database import get_db
from services.rh_payroll_service import (
    ensure_system_items,
    calculate_payroll,
    get_payroll_month,
    entry_to_dict,
    CONFIGURABLE_PERCENT_ITEMS,
    OVERTIME_POLICIES,
    calculate_payroll_through
)

router = APIRouter(prefix="/api/rh/payroll", tags=["rh-payroll"])

# ==============================================================================
# --- [BLOCO: SCHEMAS PYDANTIC] ---
# ==============================================================================

class PayrollItemCreate(BaseModel):
    code: str
    name: str
    kind: str  # RECEITA ou DESPESA
    calc_type: str = "FIXED"  # FIXED ou PERCENT
    default_value: float = 0.0
    recurring: bool = False
    incide_inss: bool = True
    incide_irrf: bool = True
    incide_fgts: bool = True
    active: bool = True

class PayrollItemUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    kind: Optional[str] = None
    calc_type: Optional[str] = None
    default_value: Optional[float] = None
    recurring: Optional[bool] = None
    incide_inss: Optional[bool] = None
    incide_irrf: Optional[bool] = None
    incide_fgts: Optional[bool] = None
    active: Optional[bool] = None

class PayrollCalculateRequest(BaseModel):
    year: int
    month: int
    employee_ids: Optional[List[int]] = None

class PayrollEntryCreate(BaseModel):
    year: int
    month: int
    employee_id: int
    item_id: int
    amount: float
    reference: Optional[str] = None
    notes: Optional[str] = None

class BankHoursPolicyUpdate(BaseModel):
    year: int
    month: int
    employee_id: int
    policy: Optional[str] = None  # None = padrão do colaborador/empresa

class PayrollEntryUpdate(BaseModel):
    amount: Optional[float] = None
    reference: Optional[str] = None
    notes: Optional[str] = None

# ==============================================================================
# --- [BLOCO: AUXILIARES] ---
# ==============================================================================

VALID_KINDS = {"RECEITA", "DESPESA"}
VALID_CALC_TYPES = {"FIXED", "PERCENT"}

# Campos que definem o comportamento do cálculo automático: bloqueados nas rubricas do sistema
SYSTEM_LOCKED_FIELDS = {"kind", "calc_type", "default_value", "recurring", "incide_inss", "incide_irrf", "incide_fgts"}

# Rubricas do sistema que permitem ajustar o percentual e as incidências (ex: Triênio)
SYSTEM_CONFIGURABLE_FIELDS = {"default_value", "incide_inss", "incide_irrf", "incide_fgts"}


def _get_or_create_schedule(db: Session, organization_id: int, year: int, month: int) -> models.RHMonthlySchedule:
    schedule = db.query(models.RHMonthlySchedule).filter(
        models.RHMonthlySchedule.organization_id == organization_id,
        models.RHMonthlySchedule.year == year,
        models.RHMonthlySchedule.month == month
    ).first()
    if not schedule:
        schedule = models.RHMonthlySchedule(organization_id=organization_id, year=year, month=month, status="DRAFT")
        db.add(schedule)
        db.commit()
        db.refresh(schedule)
    return schedule


def _get_item(db: Session, organization_id: int, item_id: int) -> models.RHPayrollItem:
    item = db.query(models.RHPayrollItem).filter(
        models.RHPayrollItem.id == item_id,
        models.RHPayrollItem.organization_id == organization_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Rubrica não encontrada")
    return item


def _get_entry(db: Session, organization_id: int, entry_id: int) -> models.RHPayrollEntry:
    entry = db.query(models.RHPayrollEntry).join(models.RHMonthlySchedule).filter(
        models.RHPayrollEntry.id == entry_id,
        models.RHMonthlySchedule.organization_id == organization_id
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")
    return entry


def _validate_item_fields(kind: Optional[str], calc_type: Optional[str]):
    if kind is not None and kind not in VALID_KINDS:
        raise HTTPException(status_code=400, detail="Tipo inválido: use RECEITA ou DESPESA")
    if calc_type is not None and calc_type not in VALID_CALC_TYPES:
        raise HTTPException(status_code=400, detail="Cálculo inválido: use FIXED ou PERCENT")


def _item_to_dict(item: models.RHPayrollItem, usage_count: int) -> dict:
    return {
        "id": item.id,
        "code": item.code,
        "name": item.name,
        "kind": item.kind,
        "calc_type": item.calc_type,
        "default_value": item.default_value or 0.0,
        "recurring": bool(item.recurring),
        "incide_inss": bool(item.incide_inss),
        "incide_irrf": bool(item.incide_irrf),
        "incide_fgts": bool(item.incide_fgts),
        "system_key": item.system_key,
        "configurable": item.system_key in CONFIGURABLE_PERCENT_ITEMS,
        "affects_net": bool(item.affects_net),
        "active": bool(item.active),
        "usage_count": usage_count,
        "can_delete": item.system_key is None and usage_count == 0,
    }

# ==============================================================================
# --- [BLOCO: RUBRICAS (RECEITAS E DESPESAS)] ---
# ==============================================================================

@router.get("/items")
def list_items(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    ensure_system_items(db, current_user.organization_id)
    db.commit()

    usage = dict(
        db.query(models.RHPayrollEntry.item_id, func.count(models.RHPayrollEntry.id))
        .group_by(models.RHPayrollEntry.item_id).all()
    )
    items = db.query(models.RHPayrollItem).filter(
        models.RHPayrollItem.organization_id == current_user.organization_id
    ).order_by(models.RHPayrollItem.kind.desc(), models.RHPayrollItem.code.asc()).all()
    return [_item_to_dict(it, usage.get(it.id, 0)) for it in items]


@router.post("/items")
def create_item(
    payload: PayrollItemCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    _validate_item_fields(payload.kind, payload.calc_type)
    if not payload.code.strip() or not payload.name.strip():
        raise HTTPException(status_code=400, detail="Código e nome são obrigatórios")

    item = models.RHPayrollItem(
        organization_id=current_user.organization_id,
        code=payload.code.strip(),
        name=payload.name.strip(),
        kind=payload.kind,
        calc_type=payload.calc_type,
        default_value=round(payload.default_value or 0.0, 2),
        recurring=payload.recurring,
        incide_inss=payload.incide_inss,
        incide_irrf=payload.incide_irrf,
        incide_fgts=payload.incide_fgts,
        affects_net=True,
        active=payload.active
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _item_to_dict(item, 0)


@router.put("/items/{item_id}")
def update_item(
    item_id: int,
    payload: PayrollItemUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    item = _get_item(db, current_user.organization_id, item_id)
    _validate_item_fields(payload.kind, payload.calc_type)

    changes = payload.model_dump(exclude_unset=True)
    if item.system_key:
        locked = SYSTEM_LOCKED_FIELDS & changes.keys()
        if item.system_key in CONFIGURABLE_PERCENT_ITEMS:
            locked -= SYSTEM_CONFIGURABLE_FIELDS
        locked = {f for f in locked if changes[f] != getattr(item, f)}
        if locked:
            raise HTTPException(status_code=400, detail="Rubricas do sistema só permitem alterar código e nome")

    for field, value in changes.items():
        if value is None:
            continue
        if isinstance(value, str):
            value = value.strip()
        if field == "default_value":
            value = round(value, 2)
        setattr(item, field, value)

    db.commit()
    db.refresh(item)
    usage = db.query(models.RHPayrollEntry).filter(models.RHPayrollEntry.item_id == item.id).count()
    return _item_to_dict(item, usage)


@router.delete("/items/{item_id}")
def delete_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    item = _get_item(db, current_user.organization_id, item_id)
    if item.system_key:
        raise HTTPException(status_code=400, detail="Rubricas do sistema não podem ser excluídas")
    usage = db.query(models.RHPayrollEntry).filter(models.RHPayrollEntry.item_id == item.id).count()
    if usage > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Rubrica possui {usage} lançamento(s) associado(s). Remova os lançamentos ou desative a rubrica."
        )
    db.delete(item)
    db.commit()
    return {"message": "Rubrica excluída"}

# ==============================================================================
# --- [BLOCO: FOLHA DO MÊS] ---
# ==============================================================================

@router.get("")
def get_payroll(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    schedule = _get_or_create_schedule(db, current_user.organization_id, year, month)
    # A folha é sempre derivada do estado atual (escala, cadastro, rubricas e configurações).
    # Folhas fechadas (status CLOSED) ficam congeladas.
    calculate_payroll_through(db, current_user.organization_id, schedule)
    return get_payroll_month(db, current_user.organization_id, schedule)


@router.post("/calculate")
def calculate(
    payload: PayrollCalculateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    schedule = _get_or_create_schedule(db, current_user.organization_id, payload.year, payload.month)
    count = calculate_payroll(db, current_user.organization_id, schedule, payload.employee_ids)
    return {"message": f"Folha calculada para {count} colaborador(es)."}

# ==============================================================================
# --- [BLOCO: LANÇAMENTOS] ---
# Toda alteração manual recalcula os automáticos do colaborador (impostos e bases).
# ==============================================================================

@router.post("/entries")
def create_entry(
    payload: PayrollEntryCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    org_id = current_user.organization_id
    item = _get_item(db, org_id, payload.item_id)
    emp = db.query(models.RHEmployee).filter(
        models.RHEmployee.id == payload.employee_id,
        models.RHEmployee.organization_id == org_id
    ).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Colaborador não encontrado")
    if payload.amount < 0:
        raise HTTPException(status_code=400, detail="Informe um valor positivo; o tipo da rubrica define se soma ou desconta")

    schedule = _get_or_create_schedule(db, org_id, payload.year, payload.month)
    entry = models.RHPayrollEntry(
        schedule_id=schedule.id, employee_id=emp.id, item_id=item.id,
        amount=round(payload.amount, 2), reference=payload.reference, notes=payload.notes, source="MANUAL"
    )
    db.add(entry)
    db.commit()
    calculate_payroll(db, org_id, schedule, [emp.id])
    db.refresh(entry)
    return entry_to_dict(entry)


@router.put("/entries/{entry_id}")
def update_entry(
    entry_id: int,
    payload: PayrollEntryUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    org_id = current_user.organization_id
    entry = _get_entry(db, org_id, entry_id)
    if payload.amount is not None:
        if payload.amount < 0:
            raise HTTPException(status_code=400, detail="Informe um valor positivo")
        entry.amount = round(payload.amount, 2)
    if payload.reference is not None:
        entry.reference = payload.reference
    if payload.notes is not None:
        entry.notes = payload.notes
    # Editar um valor automático transforma o lançamento em manual (passa a prevalecer)
    entry.source = "MANUAL"
    db.commit()

    schedule = db.query(models.RHMonthlySchedule).get(entry.schedule_id)
    calculate_payroll(db, org_id, schedule, [entry.employee_id])
    db.refresh(entry)
    return entry_to_dict(entry)


@router.delete("/entries/{entry_id}")
def delete_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    org_id = current_user.organization_id
    entry = _get_entry(db, org_id, entry_id)
    if entry.source == "AUTO":
        raise HTTPException(
            status_code=400,
            detail="Lançamentos automáticos são recriados no cálculo. Edite o valor para fixá-lo manualmente."
        )
    schedule_id, employee_id = entry.schedule_id, entry.employee_id
    db.delete(entry)
    db.commit()

    schedule = db.query(models.RHMonthlySchedule).get(schedule_id)
    calculate_payroll(db, org_id, schedule, [employee_id])
    return {"message": "Lançamento excluído"}


# ==============================================================================
# --- [BLOCO: DESTINO DAS HORAS EXTRAS / BANCO DE HORAS] ---
# ==============================================================================

@router.get("/overtime-policies")
def list_overtime_policies():
    return [{"value": k, "label": v} for k, v in OVERTIME_POLICIES.items()]


@router.put("/bank-hours")
def set_bank_hours_policy(
    payload: BankHoursPolicyUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Define o destino das horas do mês para um colaborador (pagar, folga ou valor fixo + folga)."""
    org_id = current_user.organization_id
    if payload.policy is not None and payload.policy not in OVERTIME_POLICIES:
        raise HTTPException(status_code=400, detail="Destino das horas extras inválido")
    emp = db.query(models.RHEmployee).filter(
        models.RHEmployee.id == payload.employee_id,
        models.RHEmployee.organization_id == org_id
    ).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Colaborador não encontrado")

    schedule = _get_or_create_schedule(db, org_id, payload.year, payload.month)
    row = db.query(models.RHBankHours).filter(
        models.RHBankHours.schedule_id == schedule.id,
        models.RHBankHours.employee_id == emp.id
    ).first()
    if not row:
        row = models.RHBankHours(schedule_id=schedule.id, employee_id=emp.id)
        db.add(row)
    row.policy = payload.policy
    db.commit()
    calculate_payroll_through(db, org_id, schedule)
    return {"message": "Destino das horas atualizado."}
