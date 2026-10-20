"""
Cadastro do Módulo de Inventário: famílias habilitadas, produtos do escopo padrão,
embalagens/tara, pendências de cadastro e papéis de usuário.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

import models.models as models
from core.database import get_db
from core.deps import get_current_user_and_set_org, current_org
from api.tasks import TaskManager, TaskQueue
from services import estoque_omie_service as omie_service
from services import estoque_service as service

router = APIRouter(prefix="/api/estoque", tags=["estoque"])


# ==============================================================================
# --- [BLOCO: Schemas Pydantic] ---
# ==============================================================================

class FamilyToggle(BaseModel):
    is_active_for_inventory: bool


class ProductInventoryUpdate(BaseModel):
    is_inventory_default: bool


class PackagingCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=20)
    factor: float = Field(1.0, gt=0)
    ean: Optional[str] = None
    tare_kg: float = Field(0.0, ge=0)


class PackagingUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=20)
    factor: Optional[float] = Field(None, gt=0)
    ean: Optional[str] = None
    tare_kg: Optional[float] = Field(None, ge=0)
    is_active: Optional[bool] = None


class FamilyAssign(BaseModel):
    family_id: int


class UserRoleUpdate(BaseModel):
    inventory_role: Optional[str] = None  # GERENTE, CONTADOR ou null


# ==============================================================================
# --- [BLOCO: Helpers] ---
# ==============================================================================

def guard(fn):
    """Converte InventoryError em HTTPException mantendo detalhes estruturados."""
    try:
        return fn()
    except service.InventoryError as exc:
        detail = {"message": exc.message, "details": exc.details} if exc.details else exc.message
        raise HTTPException(status_code=exc.status_code, detail=detail)


def _serialize_packaging(p: models.ProductPackaging):
    return {"id": p.id, "name": p.name, "factor": p.factor, "ean": p.ean, "tare_kg": p.tare_kg, "is_active": p.is_active}


def _get_product(db: Session, product_id: int) -> models.BoningProduct:
    prod = db.query(models.BoningProduct).filter_by(id=product_id, organization_id=current_org.get().id).first()
    if not prod:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    return prod


def _get_packaging(db: Session, packaging_id: int) -> models.ProductPackaging:
    pack = db.query(models.ProductPackaging).filter_by(id=packaging_id, organization_id=current_org.get().id).first()
    if not pack:
        raise HTTPException(status_code=404, detail="Embalagem não encontrada")
    return pack


# ==============================================================================
# --- [BLOCO: Famílias] ---
# ==============================================================================

@router.get("/familias")
def list_families(user: models.User = Depends(get_current_user_and_set_org), db: Session = Depends(get_db)):
    org_id = current_org.get().id
    counts = dict(
        db.query(models.BoningProduct.family_id, func.count(models.BoningProduct.id))
        .filter(models.BoningProduct.organization_id == org_id)
        .group_by(models.BoningProduct.family_id).all()
    )
    families = db.query(models.BoningFamily).filter_by(organization_id=org_id).order_by(models.BoningFamily.name).all()
    return {"familias": [{
        "id": f.id,
        "name": f.name,
        "is_active_for_inventory": bool(f.is_active_for_inventory),
        "product_count": counts.get(f.id, 0),
    } for f in families]}


@router.put("/familias/{family_id}")
def toggle_family(family_id: int, req: FamilyToggle,
                  user: models.User = Depends(get_current_user_and_set_org), db: Session = Depends(get_db)):
    guard(lambda: service.require_manager(user))
    fam = db.query(models.BoningFamily).filter_by(id=family_id, organization_id=current_org.get().id).first()
    if not fam:
        raise HTTPException(status_code=404, detail="Família não encontrada")
    fam.is_active_for_inventory = req.is_active_for_inventory
    db.commit()
    return {"id": fam.id, "is_active_for_inventory": fam.is_active_for_inventory}


# ==============================================================================
# --- [BLOCO: Produtos e Embalagens] ---
# ==============================================================================

@router.get("/produtos")
def list_products(family_id: int, user: models.User = Depends(get_current_user_and_set_org), db: Session = Depends(get_db)):
    org_id = current_org.get().id
    prods = (
        db.query(models.BoningProduct)
        .filter_by(organization_id=org_id, family_id=family_id)
        .order_by(models.BoningProduct.name).all()
    )
    packs = {}
    if prods:
        for p in db.query(models.ProductPackaging).filter(
            models.ProductPackaging.product_id.in_([p.id for p in prods]),
            models.ProductPackaging.is_active.is_(True),
        ).all():
            packs.setdefault(p.product_id, []).append(_serialize_packaging(p))
    return {"produtos": [{
        "id": p.id,
        "omie_id": p.omie_id,
        "name": p.name,
        "ean": p.ean,
        "unit": p.unit,
        "ncm": p.ncm,
        "is_inventory_default": p.is_inventory_default is not False,
        "packagings": packs.get(p.id, []),
    } for p in prods]}


@router.put("/produtos/{product_id}")
def update_product(product_id: int, req: ProductInventoryUpdate,
                   user: models.User = Depends(get_current_user_and_set_org), db: Session = Depends(get_db)):
    guard(lambda: service.require_manager(user))
    prod = _get_product(db, product_id)
    prod.is_inventory_default = req.is_inventory_default
    db.commit()
    return {"id": prod.id, "is_inventory_default": prod.is_inventory_default}


@router.post("/produtos/{product_id}/embalagens")
def create_packaging(product_id: int, req: PackagingCreate,
                     user: models.User = Depends(get_current_user_and_set_org), db: Session = Depends(get_db)):
    guard(lambda: service.require_manager(user))
    prod = _get_product(db, product_id)
    pack = models.ProductPackaging(
        organization_id=current_org.get().id,
        product_id=prod.id,
        name=req.name.strip().upper(),
        factor=req.factor,
        ean=(req.ean or "").strip() or None,
        tare_kg=req.tare_kg,
    )
    db.add(pack)
    db.commit()
    db.refresh(pack)
    return _serialize_packaging(pack)


@router.put("/embalagens/{packaging_id}")
def update_packaging(packaging_id: int, req: PackagingUpdate,
                     user: models.User = Depends(get_current_user_and_set_org), db: Session = Depends(get_db)):
    guard(lambda: service.require_manager(user))
    pack = _get_packaging(db, packaging_id)
    data = req.model_dump(exclude_unset=True)
    if "name" in data and data["name"]:
        data["name"] = data["name"].strip().upper()
    if "ean" in data:
        data["ean"] = (data["ean"] or "").strip() or None
    for key, value in data.items():
        setattr(pack, key, value)
    db.commit()
    return _serialize_packaging(pack)


@router.delete("/embalagens/{packaging_id}")
def delete_packaging(packaging_id: int,
                     user: models.User = Depends(get_current_user_and_set_org), db: Session = Depends(get_db)):
    """Inativa a embalagem (lançamentos antigos continuam referenciando o fator usado)."""
    guard(lambda: service.require_manager(user))
    pack = _get_packaging(db, packaging_id)
    pack.is_active = False
    db.commit()
    return {"message": "Embalagem inativada"}


# ==============================================================================
# --- [BLOCO: Pendências de Cadastro] ---
# ==============================================================================

@router.get("/pendencias")
def list_pending_registrations(user: models.User = Depends(get_current_user_and_set_org), db: Session = Depends(get_db)):
    """Produtos com cadastro incompleto para inventário (sem família, EAN, unidade ou NCM)."""
    org_id = current_org.get().id
    prods = (
        db.query(models.BoningProduct)
        .filter(models.BoningProduct.organization_id == org_id)
        .filter(or_(
            models.BoningProduct.family_id.is_(None),
            models.BoningProduct.ean.is_(None), models.BoningProduct.ean == "",
            models.BoningProduct.unit.is_(None), models.BoningProduct.unit == "",
            models.BoningProduct.ncm.is_(None), models.BoningProduct.ncm == "",
        ))
        .order_by(models.BoningProduct.name).all()
    )
    pendencias = []
    for p in prods:
        issues = []
        if not p.family_id:
            issues.append("SEM_FAMILIA")
        if not p.ean:
            issues.append("SEM_EAN")
        if not p.unit:
            issues.append("SEM_UNIDADE")
        if not p.ncm:
            issues.append("SEM_NCM")
        pendencias.append({
            "id": p.id, "omie_id": p.omie_id, "name": p.name,
            "family_name": p.family.name if p.family else None, "issues": issues,
        })
    sem_familia = sum(1 for p in pendencias if "SEM_FAMILIA" in p["issues"])
    return {"total": len(pendencias), "sem_familia": sem_familia, "pendencias": pendencias}


@router.put("/pendencias/{product_id}/familia")
def assign_family(product_id: int, req: FamilyAssign,
                  user: models.User = Depends(get_current_user_and_set_org), db: Session = Depends(get_db)):
    """Atribui a família na Omie (conferindo que nada mais do cadastro mudou) e no sistema."""
    prod = guard(lambda: omie_service.assign_family(db, user, current_org.get().id, product_id, req.family_id))
    return {"id": prod.id, "family_id": prod.family_id, "family_name": prod.family.name if prod.family else None}


@router.post("/catalogo/sincronizar")
async def sync_catalog(user: models.User = Depends(get_current_user_and_set_org)):
    """Sincroniza EAN, unidade, NCM e família de todos os produtos da Omie (inclui produtos sem família)."""
    guard(lambda: service.require_manager(user))
    org = current_org.get()
    if not org.omie_app_key:
        raise HTTPException(status_code=400, detail="Credenciais da Omie não configuradas.")
    action_id = f"inventario_catalogo_{org.id}"
    active = TaskManager.get_active_task_id(action_id)
    if active:
        raise HTTPException(status_code=409, detail={"message": "Sincronização já em andamento.", "task_id": active})
    task_id = TaskManager.create_task(action_id)
    await TaskQueue.enqueue(omie_service.bg_sync_catalog, task_id, org.id)
    return {"task_id": task_id}


# ==============================================================================
# --- [BLOCO: Papéis de Usuário] ---
# ==============================================================================

@router.get("/usuarios")
def list_users(user: models.User = Depends(get_current_user_and_set_org), db: Session = Depends(get_db)):
    guard(lambda: service.require_manager(user))
    users = db.query(models.User).filter_by(organization_id=current_org.get().id).order_by(models.User.name).all()
    return {"usuarios": [{
        "id": u.id, "name": u.name, "email": u.email, "is_active": u.is_active,
        "inventory_role": u.inventory_role or service.ROLE_GERENTE,
    } for u in users]}


@router.put("/usuarios/{user_id}/papel")
def update_user_role(user_id: int, req: UserRoleUpdate,
                     user: models.User = Depends(get_current_user_and_set_org), db: Session = Depends(get_db)):
    guard(lambda: service.require_manager(user))
    role = (req.inventory_role or "").upper() or None
    if role and role not in service.INVENTORY_ROLES:
        raise HTTPException(status_code=400, detail="Papel inválido. Use GERENTE ou CONTADOR.")
    target = db.query(models.User).filter_by(id=user_id, organization_id=current_org.get().id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if target.id == user.id and role == service.ROLE_CONTADOR:
        raise HTTPException(status_code=400, detail="Você não pode remover o próprio acesso de gerência.")
    target.inventory_role = role
    db.commit()
    return {"id": target.id, "inventory_role": target.inventory_role or service.ROLE_GERENTE}
