"""
Fluxo do inventário (balanço por família): criação, contagem pelo app (sync offline),
conferência, recontagem, aprovação, exportação de faltas e via assinada.
"""
import csv
import io
from urllib.parse import quote
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, selectinload

import models.models as models
from api.estoque_catalogo import guard
from api.tasks import TaskQueue
from core.database import get_db
from core.deps import get_current_user_and_set_org, current_org
from services import estoque_engine as engine
from services import estoque_omie_service as omie_service
from services import estoque_service as service

router = APIRouter(prefix="/api/estoque", tags=["estoque"])

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_UPLOAD_TYPES = {"application/pdf", "image/jpeg", "image/png"}


# ==============================================================================
# --- [BLOCO: Schemas Pydantic] ---
# ==============================================================================

class InventoryCreate(BaseModel):
    family_id: int
    cutoff_date: date
    product_ids: Optional[List[int]] = None  # None = produtos marcados como padrão na família
    notes: Optional[str] = None
    omie_local_code: Optional[int] = None
    recount_pct: Optional[float] = Field(None, ge=0)
    recount_value: Optional[float] = Field(None, ge=0)
    cmc_tolerance_pct: Optional[float] = Field(None, ge=0)


class ScopeUpdate(BaseModel):
    product_ids: List[int]


class TransitionRequest(BaseModel):
    action: str


class EntryPayload(BaseModel):
    client_uuid: str = Field(..., min_length=8, max_length=64)
    item_id: int
    mode: str = engine.MODE_UNIDADE
    raw_qty: Optional[float] = None
    expression: Optional[str] = Field(None, max_length=200)
    packaging_id: Optional[int] = None
    tare_total: Optional[float] = Field(None, ge=0)
    tare_units: Optional[float] = Field(None, ge=0)
    device_id: Optional[str] = Field(None, max_length=100)
    counted_at: Optional[str] = None


class EntriesSync(BaseModel):
    entries: List[EntryPayload] = Field(..., max_length=500)


class ConfirmZero(BaseModel):
    confirmed: bool = True


class ReviewUpdate(BaseModel):
    justification: Optional[str] = None
    reference_cost: Optional[float] = None
    cmc_correction_approved: Optional[bool] = None
    pair_item_id: Optional[int] = None


class ReasonAllocation(BaseModel):
    reason: str
    quantity: float = Field(..., gt=0)
    note: Optional[str] = Field(None, max_length=500)


class ReasonsUpdate(BaseModel):
    reasons: List[ReasonAllocation] = Field(default_factory=list, max_length=20)


class BatchReview(BaseModel):
    item_ids: List[int] = Field(..., min_length=1, max_length=1000)
    reason: Optional[str] = None  # Atribui o restante da divergência a este motivo
    justification: Optional[str] = Field(None, max_length=1000)
    note: Optional[str] = Field(None, max_length=500)


# ==============================================================================
# --- [BLOCO: Serialização] ---
# ==============================================================================

def _load_count(db: Session, count_id: int) -> models.InventoryCount:
    count = (
        db.query(models.InventoryCount)
        .options(selectinload(models.InventoryCount.items).selectinload(models.InventoryCountItem.entries))
        .filter_by(id=count_id, organization_id=current_org.get().id)
        .first()
    )
    if not count:
        raise HTTPException(status_code=404, detail="Inventário não encontrado")
    return count


def _serialize_entry(e: models.InventoryCountEntry):
    return {
        "id": e.id, "client_uuid": e.client_uuid, "round": e.round, "mode": e.mode,
        "packaging_id": e.packaging_id, "raw_qty": e.raw_qty, "factor": e.factor,
        "tare_total": e.tare_total, "quantity": e.quantity, "expression": e.expression,
        "user_id": e.user_id, "user_name": e.user.name if e.user else None,
        "counted_at": e.counted_at, "created_at": e.created_at,
        "voided": e.voided, "voided_at": e.voided_at,
    }


def _serialize_adjustment(adj: Optional[models.InventoryAdjustment]):
    if not adj:
        return None
    return {"tipo": adj.tipo, "motivo": adj.motivo, "quantity": adj.quantity, "unit_value": adj.unit_value,
            "status": adj.status, "omie_ajuste_id": adj.omie_ajuste_id, "error_msg": adj.error_msg}


def _serialize_item(item: models.InventoryCountItem, blind: bool, with_entries: bool = True):
    """blind=True oculta saldo, custos e divergência (contagem cega)."""
    data = {
        "id": item.id, "product_id": item.product_id, "omie_id": item.omie_id,
        "product_name": item.product_name, "product_code": item.product_code, "unit": item.unit, "ean": item.ean,
        "current_round": item.current_round, "counted_qty": item.counted_qty,
        "confirmed_zero": item.confirmed_zero, "count_status": item.count_status,
    }
    if with_entries:
        data["entries"] = [_serialize_entry(e) for e in item.entries if e.round == item.current_round]
    if blind:
        return data

    diff = engine.compute_difference(item.counted_qty, item.system_qty)
    cost = engine.unit_cost_for_valuation(item.cmc, item.reference_cost)
    data.update({
        "system_qty": item.system_qty, "system_value": item.system_value,
        "cmc": item.cmc, "reference_cost": item.reference_cost,
        "difference": diff,
        "difference_value": engine.round_money(diff * cost) if diff is not None else None,
        "adjustment_case": item.adjustment_case,
        "cmc_suspicious": engine.is_cmc_suspicious(item.cmc, item.reference_cost)
        if item.system_qty is not None else None,
        "reference_cost_source": item.reference_cost_source,
        "reasons": [{"id": r.id, "reason": r.reason, "quantity": r.quantity, "note": r.note} for r in item.reasons],
        "remaining_to_allocate": engine.remaining_to_allocate(
            diff, [{"quantity": r.quantity} for r in item.reasons]) if diff is not None else None,
        "justification": item.justification,
        "pair_item_id": item.pair_item_id, "cmc_correction_approved": item.cmc_correction_approved,
        "verified_qty": item.verified_qty, "verified_cmc": item.verified_cmc, "verify_status": item.verify_status,
        "adjustment": _serialize_adjustment(item.adjustment),
    })
    if with_entries:
        data["history"] = [_serialize_entry(e) for e in item.entries if e.round != item.current_round]
    return data


def _serialize_count(count: models.InventoryCount, blind: bool, with_items: bool = True):
    data = {
        "id": count.id, "family_id": count.family_id,
        "family_name": count.family.name if count.family else None,
        "cutoff_date": count.cutoff_date, "status": count.status, "notes": count.notes,
        "omie_local_code": count.omie_local_code,
        "created_by": count.created_by.name if count.created_by else None,
        "created_at": count.created_at,
        "item_count": len(count.items),
        "counted_items": sum(1 for i in count.items if i.count_status == engine.ITEM_CONTADO),
    }
    if not blind:
        data.update({
            "recount_pct": count.recount_pct, "recount_value": count.recount_value,
            "cmc_tolerance_pct": count.cmc_tolerance_pct,
            "snapshot_at": count.snapshot_at, "snapshot_hash": count.snapshot_hash,
            "approved_by": count.approved_by.name if count.approved_by else None,
            "approved_at": count.approved_at, "effective_at": count.effective_at,
            "concluded_at": count.concluded_at,
            "omie_task_id": count.omie_task_id, "last_error": count.last_error,
            "documents": [{"id": d.id, "kind": d.kind, "filename": d.filename, "created_at": d.created_at}
                          for d in count.documents],
        })
    if with_items:
        data["items"] = [_serialize_item(i, blind) for i in count.items]
    return data


# ==============================================================================
# --- [BLOCO: Referências e Indicadores] ---
# ==============================================================================

@router.get("/motivos")
def list_reasons(user: models.User = Depends(get_current_user_and_set_org)):
    return {"falta": engine.FALTA_REASONS, "sobra": engine.SOBRA_REASONS, "bloqueantes": sorted(engine.BLOCKING_REASONS)}


@router.get("/indicadores")
def indicators(family_id: Optional[int] = None, date_from: Optional[date] = None,
               user: models.User = Depends(get_current_user_and_set_org), db: Session = Depends(get_db)):
    """% de quebra técnica, divergência e recorrência por produto e família (inventários efetivados)."""
    guard(lambda: service.require_manager(user))
    rows = service.build_indicator_rows(db, current_org.get().id, family_id, date_from)
    return engine.aggregate_indicators(rows)


# ==============================================================================
# --- [BLOCO: Inventários] ---
# ==============================================================================

@router.get("/inventarios")
def list_counts(status: Optional[str] = None, family_id: Optional[int] = None,
                user: models.User = Depends(get_current_user_and_set_org), db: Session = Depends(get_db)):
    q = (
        db.query(models.InventoryCount)
        .options(selectinload(models.InventoryCount.items))
        .filter_by(organization_id=current_org.get().id)
    )
    if status:
        q = q.filter(models.InventoryCount.status == status)
    if family_id:
        q = q.filter(models.InventoryCount.family_id == family_id)
    if not service.is_manager(user):
        # Contador só enxerga inventários com contagem em andamento
        q = q.filter(models.InventoryCount.status.in_([engine.EM_CONTAGEM, engine.CONFERENCIA]))
    counts = q.order_by(models.InventoryCount.created_at.desc()).limit(200).all()
    blind = not service.is_manager(user)
    return {"inventarios": [_serialize_count(c, blind, with_items=False) for c in counts]}


@router.post("/inventarios")
def create_count(req: InventoryCreate, user: models.User = Depends(get_current_user_and_set_org),
                 db: Session = Depends(get_db)):
    count = guard(lambda: service.create_count(
        db, current_org.get().id, user, req.family_id, req.cutoff_date,
        product_ids=req.product_ids, notes=req.notes, omie_local_code=req.omie_local_code,
        recount_pct=req.recount_pct, recount_value=req.recount_value, cmc_tolerance_pct=req.cmc_tolerance_pct,
    ))
    return _serialize_count(_load_count(db, count.id), blind=False)


@router.get("/inventarios/{count_id}")
def get_count(count_id: int, user: models.User = Depends(get_current_user_and_set_org), db: Session = Depends(get_db)):
    return _serialize_count(_load_count(db, count_id), blind=not service.is_manager(user))


@router.get("/inventarios/{count_id}/contagem")
def get_count_for_counting(count_id: int, user: models.User = Depends(get_current_user_and_set_org),
                           db: Session = Depends(get_db)):
    """Visão do app de contagem: sempre cega, com embalagens ativas de cada produto."""
    count = _load_count(db, count_id)
    data = _serialize_count(count, blind=True)
    product_ids = [i.product_id for i in count.items]
    packs = {}
    if product_ids:
        for p in db.query(models.ProductPackaging).filter(
            models.ProductPackaging.product_id.in_(product_ids), models.ProductPackaging.is_active.is_(True)
        ).all():
            packs.setdefault(p.product_id, []).append(
                {"id": p.id, "name": p.name, "factor": p.factor, "ean": p.ean, "tare_kg": p.tare_kg})
    for item in data["items"]:
        item["packagings"] = packs.get(item["product_id"], [])
    return data


@router.put("/inventarios/{count_id}/escopo")
def update_scope(count_id: int, req: ScopeUpdate, user: models.User = Depends(get_current_user_and_set_org),
                 db: Session = Depends(get_db)):
    count = _load_count(db, count_id)
    guard(lambda: service.update_scope(db, current_org.get().id, user, count, req.product_ids))
    return _serialize_count(_load_count(db, count_id), blind=False)


@router.delete("/inventarios/{count_id}")
def delete_draft(count_id: int, user: models.User = Depends(get_current_user_and_set_org), db: Session = Depends(get_db)):
    guard(lambda: service.require_manager(user))
    count = _load_count(db, count_id)
    if count.status != engine.RASCUNHO:
        raise HTTPException(status_code=400, detail="Apenas rascunhos podem ser excluídos. Use cancelar.")
    db.delete(count)
    db.commit()
    return {"message": "Rascunho excluído"}


@router.post("/inventarios/{count_id}/transicao")
async def transition(count_id: int, req: TransitionRequest, user: models.User = Depends(get_current_user_and_set_org),
                     db: Session = Depends(get_db)):
    """Transições de status. efetivar/reprocessar/reverter disparam a integração com a Omie (retornam task_id)."""
    count = _load_count(db, count_id)
    task_id = None
    if req.action == "efetivar":
        task_id = guard(lambda: omie_service.start_effectivation(db, user, count))
        await TaskQueue.enqueue(omie_service.bg_prepare_effectivation, task_id, count_id)
    elif req.action == "reprocessar":
        task_id = guard(lambda: omie_service.start_reprocess(db, user, count))
    elif req.action == "reverter":
        task_id = guard(lambda: omie_service.start_revert(db, user, count))
    else:
        guard(lambda: service.apply_transition(db, user, count, req.action))
    db.expire_all()
    data = _serialize_count(_load_count(db, count_id), blind=False)
    data["task_id"] = task_id
    return data


@router.post("/inventarios/{count_id}/snapshot")
async def capture_snapshot(count_id: int, user: models.User = Depends(get_current_user_and_set_org),
                           db: Session = Depends(get_db)):
    """Captura saldo/CMC e último custo de compra na Omie para a data de corte (conferência)."""
    count = _load_count(db, count_id)
    task_id = guard(lambda: omie_service.start_snapshot(db, user, count))
    await TaskQueue.enqueue(omie_service.bg_capture_snapshot, task_id, count_id)
    return {"task_id": task_id}


@router.get("/inventarios/{count_id}/pendencias")
def approval_issues(count_id: int, user: models.User = Depends(get_current_user_and_set_org),
                    db: Session = Depends(get_db)):
    guard(lambda: service.require_manager(user))
    count = _load_count(db, count_id)
    issues = engine.validate_items_for_approval([service.item_to_engine(i) for i in count.items])
    return {"total": len(issues), "pendencias": issues}


@router.get("/inventarios/{count_id}/resumo")
def summary(count_id: int, user: models.User = Depends(get_current_user_and_set_org), db: Session = Depends(get_db)):
    guard(lambda: service.require_manager(user))
    count = _load_count(db, count_id)
    return engine.summarize([service.item_to_engine(i) for i in count.items])


@router.get("/inventarios/{count_id}/pares-sugeridos")
def suggested_pairs(count_id: int, user: models.User = Depends(get_current_user_and_set_org),
                    db: Session = Depends(get_db)):
    guard(lambda: service.require_manager(user))
    count = _load_count(db, count_id)
    unpaired = [service.item_to_engine(i) for i in count.items if not i.pair_item_id]
    return {"pares": engine.suggest_pairs(unpaired)}


@router.post("/inventarios/{count_id}/recontagem-sugerida")
def suggested_recounts(count_id: int, user: models.User = Depends(get_current_user_and_set_org),
                       db: Session = Depends(get_db)):
    count = _load_count(db, count_id)
    flagged = guard(lambda: service.request_suggested_recounts(db, user, count))
    return {"itens": flagged, "total": len(flagged)}


@router.get("/inventarios/{count_id}/faltas.csv")
def export_shortages(count_id: int, user: models.User = Depends(get_current_user_and_set_org),
                     db: Session = Depends(get_db)):
    """Planilha das faltas para o fiscal (padrão Excel BR: ';' e vírgula decimal)."""
    guard(lambda: service.require_manager(user))
    count = _load_count(db, count_id)
    if count.snapshot_at is None:
        raise HTTPException(status_code=400, detail="Saldo do sistema ainda não capturado.")
    rows = service.build_shortages_rows(count)
    columns = ["codigo", "codigo_omie", "produto", "ncm", "unidade", "quantidade", "custo_unitario",
               "custo_ultima_compra", "total", "motivo", "justificativa"]

    def fmt(value):
        if isinstance(value, float):
            return f"{value:.6f}".rstrip("0").rstrip(".").replace(".", ",")
        return "" if value is None else value

    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(columns)
    for row in rows:
        writer.writerow([fmt(row[c]) for c in columns])
    filename = f"faltas_inventario_{count.id}.csv"
    return Response(
        content=buffer.getvalue().encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ==============================================================================
# --- [BLOCO: Lançamentos de Contagem] ---
# ==============================================================================

@router.get("/inventarios/{count_id}/buscar")
def find_by_code(count_id: int, codigo: str, user: models.User = Depends(get_current_user_and_set_org),
                 db: Session = Depends(get_db)):
    """Resolve um código bipado (EAN do produto ou DUN da embalagem) para o item do inventário."""
    count = _load_count(db, count_id)
    code = codigo.strip()
    for item in count.items:
        if (item.ean and item.ean == code) or (item.product_code and item.product_code == code):
            return {"item_id": item.id, "product_name": item.product_name, "packaging": None}
    product_ids = [i.product_id for i in count.items]
    pack = db.query(models.ProductPackaging).filter(
        models.ProductPackaging.product_id.in_(product_ids),
        models.ProductPackaging.ean == code,
        models.ProductPackaging.is_active.is_(True),
    ).first() if product_ids else None
    if pack:
        item = next(i for i in count.items if i.product_id == pack.product_id)
        return {"item_id": item.id, "product_name": item.product_name,
                "packaging": {"id": pack.id, "name": pack.name, "factor": pack.factor, "tare_kg": pack.tare_kg}}
    raise HTTPException(status_code=404, detail="Código não pertence a nenhum produto deste inventário.")


@router.post("/inventarios/{count_id}/lancamentos/sync")
def sync_entries(count_id: int, req: EntriesSync, user: models.User = Depends(get_current_user_and_set_org),
                 db: Session = Depends(get_db)):
    count = _load_count(db, count_id)
    payload = [e.model_dump() for e in req.entries]
    return guard(lambda: service.sync_entries(db, count, user, payload))


@router.post("/lancamentos/{entry_id}/estornar")
def void_entry(entry_id: int, user: models.User = Depends(get_current_user_and_set_org), db: Session = Depends(get_db)):
    item = guard(lambda: service.void_entry(db, current_org.get().id, user, entry_id))
    return _serialize_item(item, blind=not service.is_manager(user))


@router.post("/itens/{item_id}/zerado")
def confirm_zero(item_id: int, req: ConfirmZero, user: models.User = Depends(get_current_user_and_set_org),
                 db: Session = Depends(get_db)):
    item = guard(lambda: service.get_item(db, current_org.get().id, item_id))
    guard(lambda: service.confirm_zero(db, item, req.confirmed))
    return _serialize_item(item, blind=not service.is_manager(user))


# ==============================================================================
# --- [BLOCO: Conferência] ---
# ==============================================================================

@router.post("/itens/{item_id}/recontagem")
def request_recount(item_id: int, user: models.User = Depends(get_current_user_and_set_org),
                    db: Session = Depends(get_db)):
    item = guard(lambda: service.get_item(db, current_org.get().id, item_id))
    guard(lambda: service.request_recount(db, user, item))
    return _serialize_item(item, blind=False)


@router.put("/itens/{item_id}/conferencia")
def update_review(item_id: int, req: ReviewUpdate, user: models.User = Depends(get_current_user_and_set_org),
                  db: Session = Depends(get_db)):
    item = guard(lambda: service.get_item(db, current_org.get().id, item_id))
    guard(lambda: service.update_review(db, user, item, req.model_dump(exclude_unset=True)))
    return _serialize_item(item, blind=False)


@router.put("/itens/{item_id}/motivos")
def update_reasons(item_id: int, req: ReasonsUpdate, user: models.User = Depends(get_current_user_and_set_org),
                   db: Session = Depends(get_db)):
    """Distribui a divergência do item entre motivos (ex: 2 un avaria + 3 un desaparecimento)."""
    item = guard(lambda: service.get_item(db, current_org.get().id, item_id))
    guard(lambda: service.set_reasons(db, user, item, [r.model_dump() for r in req.reasons]))
    return _serialize_item(item, blind=False)


@router.post("/inventarios/{count_id}/conferencia-lote")
def batch_review(count_id: int, req: BatchReview, user: models.User = Depends(get_current_user_and_set_org),
                 db: Session = Depends(get_db)):
    """Aplica a vários itens: motivo para o restante da divergência e/ou justificativa única."""
    if not req.reason and not (req.justification or "").strip():
        raise HTTPException(status_code=400, detail="Informe um motivo e/ou uma justificativa.")
    count = _load_count(db, count_id)
    return guard(lambda: service.batch_review(db, user, count, req.item_ids, req.reason, req.justification, req.note))


# ==============================================================================
# --- [BLOCO: Documentos] ---
# ==============================================================================

@router.post("/inventarios/{count_id}/via-assinada")
async def upload_signed_copy(count_id: int, file: UploadFile = File(...),
                             user: models.User = Depends(get_current_user_and_set_org),
                             db: Session = Depends(get_db)):
    guard(lambda: service.require_manager(user))
    count = _load_count(db, count_id)
    if count.status not in {engine.APROVADO, engine.EFETIVANDO, engine.EFETIVANDO_COM_ERRO, engine.EFETIVADO}:
        raise HTTPException(status_code=400, detail="A via assinada só pode ser enviada após a aprovação.")
    if file.content_type not in ALLOWED_UPLOAD_TYPES:
        raise HTTPException(status_code=400, detail="Envie um PDF, JPG ou PNG.")
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="Arquivo maior que 10 MB.")
    if not content:
        raise HTTPException(status_code=400, detail="Arquivo vazio.")
    doc = models.InventoryDocument(
        count_id=count.id, kind="VIA_ASSINADA", filename=file.filename or "via_assinada",
        content_type=file.content_type, content=content, size_bytes=len(content), uploaded_by_id=user.id,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return {"id": doc.id, "kind": doc.kind, "filename": doc.filename, "created_at": doc.created_at}


@router.get("/documentos/{document_id}")
def download_document(document_id: int, user: models.User = Depends(get_current_user_and_set_org),
                      db: Session = Depends(get_db)):
    guard(lambda: service.require_manager(user))
    doc = (
        db.query(models.InventoryDocument)
        .join(models.InventoryCount, models.InventoryCount.id == models.InventoryDocument.count_id)
        .filter(models.InventoryDocument.id == document_id,
                models.InventoryCount.organization_id == current_org.get().id)
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Documento não encontrado")
    return Response(content=doc.content, media_type=doc.content_type,
                    headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(doc.filename)}"})
