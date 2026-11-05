from datetime import date
from typing import List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models.models as models
from core import auth
from core.database import get_db
from services.rh_payroll_service import sync_payroll_if_calculated
from services.rh_vacation_service import (
    acquisition_bounds,
    apply_to_schedule,
    build_overview,
    calculate_vacation_pay,
    period_index_of,
    revert_from_schedule,
    settle_periods,
    validate_vacation,
    vacation_to_dict,
)

router = APIRouter(prefix="/api/rh/vacations", tags=["rh-vacations"])

# ==============================================================================
# --- [BLOCO: SCHEMAS PYDANTIC] ---
# ==============================================================================

class VacationPayload(BaseModel):
    employee_id: int
    acquisition_start: Optional[date] = None
    start_date: Optional[date] = None
    days: int = 30
    abono_days: int = 0
    abono_start_date: Optional[date] = None  # Primeiro dia do período do abono (escolhido no calendário)
    advance_13th: bool = False
    payment_date: Optional[date] = None
    variable_average: Optional[float] = None  # None = média automática das folhas do período
    historical: bool = False  # Férias já gozadas antes do sistema (não altera a escala)
    notes: Optional[str] = None

class SettlementItem(BaseModel):
    employee_id: int
    acquisition_start: date

class SettlementPayload(BaseModel):
    items: List[SettlementItem]
    note: Optional[str] = None  # Ex.: "Férias gozadas antes do controle pelo sistema"

class VacationPreview(VacationPayload):
    vacation_id: Optional[int] = None  # Edição: desconsidera a própria programação no saldo

# ==============================================================================
# --- [BLOCO: AUXILIARES] ---
# ==============================================================================

def _employee(db: Session, organization_id: int, employee_id: int) -> models.RHEmployee:
    emp = db.query(models.RHEmployee).filter(
        models.RHEmployee.id == employee_id,
        models.RHEmployee.organization_id == organization_id
    ).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Colaborador não encontrado")
    return emp


def _vacation(db: Session, organization_id: int, vacation_id: int) -> models.RHVacation:
    v = db.query(models.RHVacation).filter(
        models.RHVacation.id == vacation_id,
        models.RHVacation.organization_id == organization_id
    ).first()
    if not v:
        raise HTTPException(status_code=404, detail="Programação de férias não encontrada")
    return v


def _evaluate(db: Session, organization_id: int, emp: models.RHEmployee, payload: VacationPayload,
              exclude_id: Optional[int] = None):
    """Validação + cálculo do recibo para a programação informada."""
    check = validate_vacation(
        db, organization_id, emp, payload.acquisition_start, payload.start_date,
        payload.days, payload.abono_days, payload.payment_date,
        historical=payload.historical, exclude_id=exclude_id, abono_start=payload.abono_start_date
    )
    calc = None
    if check["period"] is not None and payload.start_date is not None and payload.days > 0:
        calc = calculate_vacation_pay(
            db, organization_id, emp,
            date.fromisoformat(check["period"]["start"]), date.fromisoformat(check["period"]["end"]),
            payload.start_date, payload.days, payload.abono_days, check["doubled_days"],
            payload.advance_13th, payload.variable_average
        )
    return check, calc


def _raise_errors(check) -> None:
    if check["errors"]:
        raise HTTPException(status_code=400, detail=" ".join(check["errors"]))


def _fill(v: models.RHVacation, emp: models.RHEmployee, payload: VacationPayload, check, calc) -> None:
    index = period_index_of(emp.admission_date, payload.acquisition_start)
    _, acq_end, _ = acquisition_bounds(emp.admission_date, index)
    v.acquisition_start = payload.acquisition_start
    v.acquisition_end = acq_end
    v.start_date = payload.start_date
    v.days = payload.days
    v.abono_days = payload.abono_days
    v.abono_start_date = payload.abono_start_date if payload.abono_days else None
    v.advance_13th = payload.advance_13th
    v.payment_date = date.fromisoformat(check["payment_date"]) if check["payment_date"] else None
    v.variable_average = round(payload.variable_average, 2) if payload.variable_average is not None else None
    v.notes = (payload.notes or "").strip() or None
    v.calc = calc


def _sync_payrolls(db: Session, organization_id: int, schedule_ids: Set[int]) -> None:
    for schedule_id in sorted(schedule_ids):
        sync_payroll_if_calculated(db, organization_id, schedule_id)


def _payload_of(v: models.RHVacation) -> VacationPayload:
    return VacationPayload(
        employee_id=v.employee_id, acquisition_start=v.acquisition_start, start_date=v.start_date,
        days=v.days, abono_days=v.abono_days or 0, abono_start_date=v.abono_start_date,
        advance_13th=bool(v.advance_13th),
        payment_date=v.payment_date, variable_average=v.variable_average, notes=v.notes
    )

# ==============================================================================
# --- [BLOCO: CONTROLE E PROGRAMAÇÃO] ---
# ==============================================================================

@router.get("/overview")
def vacations_overview(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Períodos aquisitivos/concessivos de cada colaborador ativo, agenda de férias e alertas."""
    return build_overview(db, current_user.organization_id)


@router.post("/settlements")
def settle_old_periods(
    payload: SettlementPayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Regulariza períodos antigos: quita o saldo sem informar datas de gozo (não altera a escala)."""
    if not payload.items:
        raise HTTPException(status_code=400, detail="Selecione ao menos um período.")
    result = settle_periods(
        db, current_user.organization_id,
        [(i.employee_id, i.acquisition_start) for i in payload.items],
        payload.note, current_user.id
    )
    if result["errors"] and not result["created"]:
        db.rollback()
        raise HTTPException(status_code=400, detail=" ".join(result["errors"]))
    db.commit()
    message = f"{result['created']} período(s) quitado(s)"
    if result["skipped"]:
        message += f"; {result['skipped']} já estavam quitados"
    return {"message": message, "warnings": result["errors"], **result}


class SettlementUndoPayload(BaseModel):
    ids: List[int]


@router.post("/settlements/undo")
def undo_settlements(
    payload: SettlementUndoPayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Desfaz várias quitações de uma vez: os períodos voltam a mostrar saldo e situação calculada."""
    if not payload.ids:
        raise HTTPException(status_code=400, detail="Selecione ao menos uma quitação.")
    removed = db.query(models.RHVacationSettlement).filter(
        models.RHVacationSettlement.id.in_(payload.ids),
        models.RHVacationSettlement.organization_id == current_user.organization_id
    ).delete(synchronize_session=False)
    db.commit()
    return {"message": f"{removed} quitação(ões) desfeita(s)", "removed": removed}


@router.delete("/settlements/{settlement_id}")
def undo_settlement(
    settlement_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Desfaz a quitação: o período volta a mostrar o saldo e a situação calculada."""
    st = db.query(models.RHVacationSettlement).filter(
        models.RHVacationSettlement.id == settlement_id,
        models.RHVacationSettlement.organization_id == current_user.organization_id
    ).first()
    if not st:
        raise HTTPException(status_code=404, detail="Quitação não encontrada")
    db.delete(st)
    db.commit()
    return {"message": "Quitação desfeita"}


@router.post("/preview")
def preview_vacation(
    payload: VacationPreview,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Simula a programação: erros, avisos, datas e valores do recibo, sem gravar."""
    emp = _employee(db, current_user.organization_id, payload.employee_id)
    check, calc = _evaluate(db, current_user.organization_id, emp, payload, exclude_id=payload.vacation_id)
    db.rollback()
    return {**check, "calc": calc}


@router.post("")
def create_vacation(
    payload: VacationPayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    org_id = current_user.organization_id
    emp = _employee(db, org_id, payload.employee_id)
    check, calc = _evaluate(db, org_id, emp, payload)
    _raise_errors(check)
    v = models.RHVacation(
        organization_id=org_id, employee_id=emp.id, created_by=current_user.id,
        status="HISTORICO" if payload.historical else "PROGRAMADA"
    )
    _fill(v, emp, payload, check, calc)
    db.add(v)
    db.commit()
    db.refresh(v)
    return {"message": "Férias registradas no histórico" if payload.historical else "Férias programadas",
            "warnings": check["warnings"], "vacation": vacation_to_dict(v, date.today())}


@router.put("/{vacation_id}")
def update_vacation(
    vacation_id: int,
    payload: VacationPayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    org_id = current_user.organization_id
    v = _vacation(db, org_id, vacation_id)
    if v.status not in ("PROGRAMADA", "HISTORICO"):
        raise HTTPException(status_code=400, detail="Desfaça a confirmação antes de alterar as férias.")
    if payload.employee_id != v.employee_id:
        raise HTTPException(status_code=400, detail="Não é possível trocar o colaborador da programação.")
    payload.historical = v.status == "HISTORICO"
    emp = _employee(db, org_id, v.employee_id)
    check, calc = _evaluate(db, org_id, emp, payload, exclude_id=v.id)
    _raise_errors(check)
    _fill(v, emp, payload, check, calc)
    db.commit()
    db.refresh(v)
    return {"message": "Programação atualizada", "warnings": check["warnings"],
            "vacation": vacation_to_dict(v, date.today())}


@router.post("/{vacation_id}/confirm")
def confirm_vacation(
    vacation_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Aviso de férias dado: marca os dias como FERIAS na escala (ou remarca dias alterados depois)."""
    org_id = current_user.organization_id
    v = _vacation(db, org_id, vacation_id)
    if v.status not in ("PROGRAMADA", "CONFIRMADA"):
        raise HTTPException(status_code=400, detail="Somente férias programadas podem ser confirmadas.")
    emp = _employee(db, org_id, v.employee_id)
    check, calc = _evaluate(db, org_id, emp, _payload_of(v), exclude_id=v.id)
    _raise_errors(check)
    try:
        touched = apply_to_schedule(db, org_id, emp, v, current_user.id)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    v.calc = calc
    v.status = "CONFIRMADA"
    v.notice_date = v.notice_date or date.today()
    db.commit()
    _sync_payrolls(db, org_id, touched)
    db.refresh(v)
    return {"message": "Férias confirmadas e marcadas na escala", "warnings": check["warnings"],
            "vacation": vacation_to_dict(v, date.today())}


@router.post("/{vacation_id}/unconfirm")
def unconfirm_vacation(
    vacation_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Volta a programação para PROGRAMADA e devolve os dias da escala ao estado anterior."""
    org_id = current_user.organization_id
    v = _vacation(db, org_id, vacation_id)
    if v.status != "CONFIRMADA":
        raise HTTPException(status_code=400, detail="As férias não estão confirmadas.")
    emp = _employee(db, org_id, v.employee_id)
    try:
        touched = revert_from_schedule(db, org_id, emp, v, current_user.id)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    v.status = "PROGRAMADA"
    v.notice_date = None
    db.commit()
    _sync_payrolls(db, org_id, touched)
    db.refresh(v)
    return {"message": "Confirmação desfeita; dias devolvidos à escala", "vacation": vacation_to_dict(v, date.today())}


@router.post("/{vacation_id}/cancel")
def cancel_vacation(
    vacation_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Cancela as férias (fica no histórico) e devolve os dias ao saldo do período e à escala."""
    org_id = current_user.organization_id
    v = _vacation(db, org_id, vacation_id)
    if v.status == "CANCELADA":
        raise HTTPException(status_code=400, detail="As férias já estão canceladas.")
    touched: Set[int] = set()
    if v.status == "CONFIRMADA":
        emp = _employee(db, org_id, v.employee_id)
        try:
            touched = revert_from_schedule(db, org_id, emp, v, current_user.id)
        except ValueError as e:
            db.rollback()
            raise HTTPException(status_code=400, detail=str(e))
    v.status = "CANCELADA"
    db.commit()
    _sync_payrolls(db, org_id, touched)
    return {"message": "Férias canceladas"}


@router.delete("/{vacation_id}")
def delete_vacation(
    vacation_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    v = _vacation(db, current_user.organization_id, vacation_id)
    if v.status == "CONFIRMADA":
        raise HTTPException(status_code=400, detail="Férias confirmadas não podem ser excluídas: desfaça a confirmação ou cancele.")
    db.delete(v)
    db.commit()
    return {"message": "Programação excluída"}


@router.get("/{vacation_id}/receipt")
def vacation_receipt(
    vacation_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Dados do aviso e recibo de férias para impressão."""
    org_id = current_user.organization_id
    v = _vacation(db, org_id, vacation_id)
    emp = _employee(db, org_id, v.employee_id)
    calc = v.calc
    if v.status != "CONFIRMADA" or not calc:
        check, calc = _evaluate(db, org_id, emp, _payload_of(v), exclude_id=v.id)
        db.rollback()
    org = db.query(models.Organization).get(org_id)
    profile = emp.profile or {}
    docs = profile.get("documentos") or {}
    return {
        "vacation": {**vacation_to_dict(v, date.today()), "calc": calc},
        "employee": {
            "name": emp.name,
            "role": emp.role_obj.name if emp.role_obj else emp.role,
            "admission_date": emp.admission_date.isoformat() if emp.admission_date else None,
            "matricula": (profile.get("contrato") or {}).get("matricula"),
            "cpf": docs.get("cpf"),
            "ctps": " / ".join(filter(None, [docs.get("ctps_numero"), docs.get("ctps_serie"), docs.get("ctps_uf")])) or None,
        },
        "company": {"name": org.name if org else None, **((org.company or {}) if org else {})},
    }
