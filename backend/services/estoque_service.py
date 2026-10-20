"""
Orquestração do Módulo de Inventário com o banco de dados.

Regras de negócio puras ficam em services/estoque_engine.py; aqui ficam as
operações que leem/gravam o estado (criação, sync de lançamentos, transições).
Não depende de nenhum código do rateio/custeio.
"""
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

import models.models as models
from services import estoque_engine as engine

ROLE_GERENTE = "GERENTE"
ROLE_CONTADOR = "CONTADOR"
INVENTORY_ROLES = {ROLE_GERENTE, ROLE_CONTADOR}


class InventoryError(Exception):
    """Erro de regra de negócio do inventário (mapeado para HTTP 400/409 na API)."""

    def __init__(self, message: str, status_code: int = 400, details: Any = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.details = details


def _now():
    return datetime.now(timezone.utc)


# ==============================================================================
# --- [BLOCO: Permissões] ---
# ==============================================================================

def is_manager(user: models.User) -> bool:
    """Usuários sem papel definido mantêm acesso completo (comportamento atual do sistema)."""
    return (getattr(user, "inventory_role", None) or ROLE_GERENTE) == ROLE_GERENTE


def require_manager(user: models.User):
    if not is_manager(user):
        raise InventoryError("Ação permitida apenas para a gerência.", status_code=403)


# ==============================================================================
# --- [BLOCO: Consultas Auxiliares] ---
# ==============================================================================

def get_count(db: Session, org_id: int, count_id: int) -> models.InventoryCount:
    count = db.query(models.InventoryCount).filter_by(id=count_id, organization_id=org_id).first()
    if not count:
        raise InventoryError("Inventário não encontrado.", status_code=404)
    return count


def get_item(db: Session, org_id: int, item_id: int) -> models.InventoryCountItem:
    item = (
        db.query(models.InventoryCountItem)
        .join(models.InventoryCount, models.InventoryCount.id == models.InventoryCountItem.count_id)
        .filter(models.InventoryCountItem.id == item_id, models.InventoryCount.organization_id == org_id)
        .first()
    )
    if not item:
        raise InventoryError("Item do inventário não encontrado.", status_code=404)
    return item


def find_open_conflicts(db: Session, org_id: int, family_id: int, product_ids: List[int],
                        exclude_count_id: Optional[int] = None) -> List[str]:
    """Impede dois inventários abertos para a mesma família ou para o mesmo produto."""
    conflicts = []
    q = db.query(models.InventoryCount).filter(
        models.InventoryCount.organization_id == org_id,
        models.InventoryCount.status.in_(engine.OPEN_STATUSES),
    )
    if exclude_count_id:
        q = q.filter(models.InventoryCount.id != exclude_count_id)

    same_family = q.filter(models.InventoryCount.family_id == family_id).first()
    if same_family:
        conflicts.append(f"A família já possui o inventário #{same_family.id} em aberto ({same_family.status}).")

    if product_ids:
        open_ids = [c.id for c in q.all()]
        if open_ids:
            busy = (
                db.query(models.InventoryCountItem)
                .filter(models.InventoryCountItem.count_id.in_(open_ids),
                        models.InventoryCountItem.product_id.in_(product_ids))
                .all()
            )
            for it in busy:
                conflicts.append(f"{it.product_name} já está no inventário #{it.count_id} em aberto.")
    return conflicts


def item_to_engine(item: models.InventoryCountItem) -> Dict[str, Any]:
    """Converte o item do banco no dicionário consumido pelo estoque_engine."""
    return {
        "id": item.id,
        "product_id": item.product_id,
        "product_name": item.product_name,
        "unit": item.unit,
        "system_qty": item.system_qty,
        "counted_qty": item.counted_qty,
        "confirmed_zero": item.confirmed_zero,
        "count_status": item.count_status,
        "reasons": [{"reason": r.reason, "quantity": r.quantity} for r in item.reasons],
        "justification": item.justification,
        "case": item.adjustment_case,
        "has_entries": any(not e.voided and e.round == item.current_round for e in item.entries),
        "cmc": item.cmc,
        "reference_cost": item.reference_cost,
        "cmc_correction_approved": item.cmc_correction_approved,
    }


# ==============================================================================
# --- [BLOCO: Recalcular Item] ---
# ==============================================================================

def recompute_item(item: models.InventoryCountItem, cmc_tolerance_pct: float):
    """Atualiza total contado, status de contagem e caso de ajuste a partir dos lançamentos."""
    entries = [{"quantity": e.quantity, "round": e.round, "voided": e.voided} for e in item.entries]
    item.counted_qty = engine.sum_entries(entries, item.current_round)
    has_entries = any(not e.voided and e.round == item.current_round for e in item.entries)

    if has_entries or item.confirmed_zero:
        item.count_status = engine.ITEM_CONTADO
    elif item.current_round > 1:
        item.count_status = engine.ITEM_RECONTAGEM
    else:
        item.count_status = engine.ITEM_PENDENTE

    if item.system_qty is not None:
        item.adjustment_case = engine.classify_case(
            item.system_qty, item.counted_qty, item.cmc, item.reference_cost, cmc_tolerance_pct
        )


# ==============================================================================
# --- [BLOCO: Criação e Escopo] ---
# ==============================================================================

def _load_scope_products(db: Session, org_id: int, family: models.BoningFamily,
                         product_ids: Optional[List[int]]) -> List[models.BoningProduct]:
    q = db.query(models.BoningProduct).filter(
        models.BoningProduct.organization_id == org_id,
        models.BoningProduct.family_id == family.id,
    )
    if product_ids is None:
        products = q.filter(models.BoningProduct.is_inventory_default.isnot(False)).all()
    else:
        products = q.filter(models.BoningProduct.id.in_(product_ids)).all()
        found = {p.id for p in products}
        missing = [pid for pid in product_ids if pid not in found]
        if missing:
            raise InventoryError(f"Produtos não pertencem à família selecionada: {missing}")
    if not products:
        raise InventoryError("Selecione ao menos um produto da família para o inventário.")
    return products


def _new_item(product: models.BoningProduct) -> models.InventoryCountItem:
    return models.InventoryCountItem(
        product_id=product.id,
        omie_id=product.omie_id,
        product_name=product.name,
        unit=product.unit,
        ean=product.ean,
    )


def create_count(db: Session, org_id: int, user: models.User, family_id: int, cutoff_date: date,
                 product_ids: Optional[List[int]] = None, notes: Optional[str] = None,
                 omie_local_code: Optional[int] = None, recount_pct: Optional[float] = None,
                 recount_value: Optional[float] = None, cmc_tolerance_pct: Optional[float] = None) -> models.InventoryCount:
    require_manager(user)
    family = db.query(models.BoningFamily).filter_by(id=family_id, organization_id=org_id).first()
    if not family:
        raise InventoryError("Família não encontrada.", status_code=404)
    if not family.is_active_for_inventory:
        raise InventoryError("A família não está habilitada para inventário.")
    if cutoff_date > date.today():
        raise InventoryError("A data de corte não pode ser futura.")

    products = _load_scope_products(db, org_id, family, product_ids)
    conflicts = find_open_conflicts(db, org_id, family.id, [p.id for p in products])
    if conflicts:
        raise InventoryError("Existe inventário em aberto para esta família/produtos.", status_code=409, details=conflicts)

    count = models.InventoryCount(
        organization_id=org_id,
        family_id=family.id,
        cutoff_date=cutoff_date,
        omie_local_code=omie_local_code,
        notes=notes,
        recount_pct=engine.DEFAULT_RECOUNT_PCT if recount_pct is None else recount_pct,
        recount_value=engine.DEFAULT_RECOUNT_VALUE if recount_value is None else recount_value,
        cmc_tolerance_pct=engine.DEFAULT_CMC_TOLERANCE_PCT if cmc_tolerance_pct is None else cmc_tolerance_pct,
        created_by_id=user.id,
        status=engine.RASCUNHO,
    )
    count.items = [_new_item(p) for p in products]
    db.add(count)
    db.commit()
    db.refresh(count)
    return count


def update_scope(db: Session, org_id: int, user: models.User, count: models.InventoryCount,
                 product_ids: List[int]) -> models.InventoryCount:
    """Redefine os produtos do escopo (somente em RASCUNHO)."""
    require_manager(user)
    if count.status != engine.RASCUNHO:
        raise InventoryError("O escopo só pode ser alterado em rascunho.")
    products = _load_scope_products(db, org_id, count.family, product_ids)
    conflicts = find_open_conflicts(db, org_id, count.family_id, [p.id for p in products], exclude_count_id=count.id)
    conflicts = [c for c in conflicts if "família" not in c]
    if conflicts:
        raise InventoryError("Produtos já estão em outro inventário aberto.", status_code=409, details=conflicts)

    wanted = {p.id: p for p in products}
    count.items = [it for it in count.items if it.product_id in wanted]
    existing = {it.product_id for it in count.items}
    for pid, product in wanted.items():
        if pid not in existing:
            count.items.append(_new_item(product))
    db.commit()
    db.refresh(count)
    return count


# ==============================================================================
# --- [BLOCO: Lançamentos de Contagem (sync offline idempotente)] ---
# ==============================================================================

def _entry_allowed(count: models.InventoryCount, item: models.InventoryCountItem) -> Optional[str]:
    if count.status == engine.EM_CONTAGEM:
        return None
    if count.status == engine.CONFERENCIA and item.count_status == engine.ITEM_RECONTAGEM:
        return None
    if count.status == engine.CONFERENCIA and item.current_round > 1:
        return None  # Recontagem em andamento (já recebeu lançamentos da nova rodada)
    return "CONTAGEM_ENCERRADA"


def _build_entry(item: models.InventoryCountItem, payload: Dict[str, Any], user: models.User,
                 packagings: Dict[int, models.ProductPackaging]) -> models.InventoryCountEntry:
    mode = (payload.get("mode") or engine.MODE_UNIDADE).upper()
    expression = payload.get("expression")
    raw_qty = engine.evaluate_expression(expression) if expression else float(payload.get("raw_qty") or 0.0)

    packaging = None
    if payload.get("packaging_id"):
        packaging = packagings.get(int(payload["packaging_id"]))
        if not packaging or packaging.product_id != item.product_id:
            raise ValueError("Embalagem inválida para este produto.")

    factor = 1.0
    tare_total = 0.0
    if mode == engine.MODE_EMBALAGEM:
        if not packaging:
            raise ValueError("Lançamento por embalagem exige a embalagem.")
        factor = packaging.factor
    elif mode == engine.MODE_PESO:
        if payload.get("tare_total") is not None:
            tare_total = float(payload["tare_total"])
        elif packaging:
            tare_total = float(packaging.tare_kg or 0.0) * float(payload.get("tare_units") or 1)

    quantity = engine.compute_entry_quantity(mode, raw_qty, factor=factor, tare_total=tare_total)
    counted_at = payload.get("counted_at")
    if isinstance(counted_at, str):
        try:
            counted_at = datetime.fromisoformat(counted_at.replace("Z", "+00:00"))
        except ValueError:
            counted_at = None

    return models.InventoryCountEntry(
        item_id=item.id,
        client_uuid=str(payload["client_uuid"]),
        round=item.current_round,
        mode=mode,
        packaging_id=packaging.id if packaging else None,
        raw_qty=engine.round_qty(raw_qty),
        factor=factor,
        tare_total=engine.round_qty(tare_total),
        quantity=quantity,
        expression=expression,
        user_id=user.id,
        device_id=payload.get("device_id"),
        counted_at=counted_at,
    )


def sync_entries(db: Session, count: models.InventoryCount, user: models.User,
                 entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Recebe um lote de lançamentos do app. Reenvios com o mesmo client_uuid são ignorados (idempotente).

    Retorna, por client_uuid, o resultado: ACEITO, DUPLICADO ou REJEITADO (com motivo).
    """
    items = {it.id: it for it in count.items}
    product_ids = [it.product_id for it in count.items]
    packagings = {
        p.id: p for p in db.query(models.ProductPackaging).filter(models.ProductPackaging.product_id.in_(product_ids)).all()
    } if product_ids else {}

    uuids = [str(e.get("client_uuid")) for e in entries if e.get("client_uuid")]
    existing = {
        e.client_uuid for e in db.query(models.InventoryCountEntry.client_uuid)
        .filter(models.InventoryCountEntry.client_uuid.in_(uuids)).all()
    } if uuids else set()

    results, touched = [], set()
    for payload in entries:
        client_uuid = str(payload.get("client_uuid") or "")
        if not client_uuid:
            results.append({"client_uuid": None, "status": "REJEITADO", "reason": "client_uuid obrigatório."})
            continue
        if client_uuid in existing:
            results.append({"client_uuid": client_uuid, "status": "DUPLICADO"})
            continue
        item = items.get(int(payload.get("item_id") or 0))
        if not item:
            results.append({"client_uuid": client_uuid, "status": "REJEITADO", "reason": "Item não pertence ao inventário."})
            continue
        blocked = _entry_allowed(count, item)
        if blocked:
            results.append({"client_uuid": client_uuid, "status": "REJEITADO", "reason": blocked})
            continue
        try:
            entry = _build_entry(item, payload, user, packagings)
        except (ValueError, TypeError) as exc:
            results.append({"client_uuid": client_uuid, "status": "REJEITADO", "reason": str(exc)})
            continue
        item.entries.append(entry)
        existing.add(client_uuid)
        touched.add(item.id)
        results.append({"client_uuid": client_uuid, "status": "ACEITO", "item_id": item.id, "quantity": entry.quantity})

    for item_id in touched:
        item = items[item_id]
        item.confirmed_zero = False
        recompute_item(item, count.cmc_tolerance_pct)
    db.commit()
    return {"results": results, "items": {iid: items[iid].counted_qty for iid in touched}}


def void_entry(db: Session, org_id: int, user: models.User, entry_id: int) -> models.InventoryCountItem:
    entry = (
        db.query(models.InventoryCountEntry)
        .join(models.InventoryCountItem, models.InventoryCountItem.id == models.InventoryCountEntry.item_id)
        .join(models.InventoryCount, models.InventoryCount.id == models.InventoryCountItem.count_id)
        .filter(models.InventoryCountEntry.id == entry_id, models.InventoryCount.organization_id == org_id)
        .first()
    )
    if not entry:
        raise InventoryError("Lançamento não encontrado.", status_code=404)
    item, count = entry.item, entry.item.count
    if _entry_allowed(count, item):
        raise InventoryError("A contagem deste item está encerrada.")
    if entry.round != item.current_round:
        raise InventoryError("Só é possível estornar lançamentos da rodada atual.")
    # Contador só estorna os próprios lançamentos; gerência estorna qualquer um
    if not is_manager(user) and entry.user_id != user.id:
        raise InventoryError("Você só pode estornar seus próprios lançamentos.", status_code=403)
    if entry.voided:
        return item
    entry.voided = True
    entry.voided_by_id = user.id
    entry.voided_at = _now()
    recompute_item(item, count.cmc_tolerance_pct)
    db.commit()
    return item


def confirm_zero(db: Session, item: models.InventoryCountItem, value: bool = True):
    count = item.count
    if _entry_allowed(count, item):
        raise InventoryError("A contagem deste item está encerrada.")
    has_entries = any(not e.voided and e.round == item.current_round for e in item.entries)
    if value and has_entries:
        raise InventoryError("O item possui lançamentos na rodada atual. Estorne-os antes de confirmar zerado.")
    item.confirmed_zero = value
    recompute_item(item, count.cmc_tolerance_pct)
    db.commit()


# ==============================================================================
# --- [BLOCO: Conferência e Recontagem] ---
# ==============================================================================

def request_recount(db: Session, user: models.User, item: models.InventoryCountItem):
    require_manager(user)
    if item.count.status != engine.CONFERENCIA:
        raise InventoryError("Recontagem só pode ser solicitada na conferência.")
    item.current_round += 1
    item.confirmed_zero = False
    recompute_item(item, item.count.cmc_tolerance_pct)
    db.commit()


def request_suggested_recounts(db: Session, user: models.User, count: models.InventoryCount) -> List[int]:
    """Solicita recontagem dos itens cuja divergência ultrapassa os limites (apenas uma recontagem automática)."""
    require_manager(user)
    if count.status != engine.CONFERENCIA:
        raise InventoryError("Recontagem só pode ser solicitada na conferência.")
    flagged = []
    for item in count.items:
        if item.current_round > 1 or item.system_qty is None:
            continue
        diff = engine.compute_difference(item.counted_qty, item.system_qty)
        cost = engine.unit_cost_for_valuation(item.cmc, item.reference_cost)
        if engine.needs_recount(diff, item.system_qty, cost, count.recount_pct, count.recount_value):
            item.current_round += 1
            item.confirmed_zero = False
            recompute_item(item, count.cmc_tolerance_pct)
            flagged.append(item.id)
    db.commit()
    return flagged


def _require_review(user: models.User, count: models.InventoryCount):
    require_manager(user)
    if count.status != engine.CONFERENCIA:
        raise InventoryError("A conferência só pode ser editada com o inventário em conferência.")


def update_review(db: Session, user: models.User, item: models.InventoryCountItem, data: Dict[str, Any]):
    """Grava justificativa, par, custo de referência e aprovação de correção de CMC."""
    _require_review(user, item.count)

    if "justification" in data:
        item.justification = (data["justification"] or "").strip() or None
    if "reference_cost" in data:
        ref = data["reference_cost"]
        if ref is not None and float(ref) < 0:
            raise InventoryError("Custo de referência não pode ser negativo.")
        item.reference_cost = None if ref is None else float(ref)
        item.reference_cost_source = None if ref is None else "MANUAL"
    if "cmc_correction_approved" in data:
        item.cmc_correction_approved = bool(data["cmc_correction_approved"])
    if "pair_item_id" in data:
        _set_pair(item, data["pair_item_id"])

    recompute_item(item, item.count.cmc_tolerance_pct)
    db.commit()


def _validated_allocations(item: models.InventoryCountItem, allocations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    diff = engine.compute_difference(item.counted_qty, item.system_qty)
    allowed = engine.reasons_for_sign(diff) if diff else {**engine.FALTA_REASONS, **engine.SOBRA_REASONS}
    clean = []
    for alloc in allocations:
        reason = alloc.get("reason")
        qty = engine.round_qty(alloc.get("quantity"))
        if reason not in allowed:
            raise InventoryError(f"Motivo inválido para {item.product_name}: {reason}")
        if qty <= 0:
            raise InventoryError("A quantidade de cada motivo deve ser maior que zero.")
        clean.append({"reason": reason, "quantity": qty, "note": (alloc.get("note") or "").strip() or None})
    return clean


def set_reasons(db: Session, user: models.User, item: models.InventoryCountItem, allocations: List[Dict[str, Any]]):
    """Substitui a distribuição da divergência do item entre motivos.

    A soma pode ficar parcial durante a edição; o fechamento exato é exigido no envio para aprovação.
    """
    _require_review(user, item.count)
    clean = _validated_allocations(item, allocations)
    item.reasons = [models.InventoryItemReason(**c) for c in clean]
    db.commit()


def batch_review(db: Session, user: models.User, count: models.InventoryCount, item_ids: List[int],
                 reason: Optional[str] = None, justification: Optional[str] = None,
                 note: Optional[str] = None) -> Dict[str, Any]:
    """Conferência em lote: atribui o restante da divergência de cada item a um motivo e/ou aplica justificativa."""
    _require_review(user, count)
    items = {it.id: it for it in count.items}
    updated, skipped = [], []
    justification = (justification or "").strip() or None
    for item_id in item_ids:
        item = items.get(item_id)
        if not item:
            skipped.append({"item_id": item_id, "reason": "Item não pertence ao inventário."})
            continue
        if reason:
            diff = engine.compute_difference(item.counted_qty, item.system_qty)
            if not diff:
                skipped.append({"item_id": item_id, "reason": "Item sem divergência."})
                continue
            if reason not in engine.reasons_for_sign(diff):
                skipped.append({"item_id": item_id, "reason": "Motivo incompatível com o tipo de divergência."})
                continue
            remaining = engine.remaining_to_allocate(diff, [{"quantity": r.quantity} for r in item.reasons])
            if remaining > 0:
                existing = next((r for r in item.reasons if r.reason == reason), None)
                if existing:
                    existing.quantity = engine.round_qty(existing.quantity + remaining)
                else:
                    item.reasons.append(models.InventoryItemReason(reason=reason, quantity=remaining, note=note))
        if justification:
            item.justification = justification
        updated.append(item_id)
    db.commit()
    return {"updated": updated, "skipped": skipped}


def _set_pair(item: models.InventoryCountItem, pair_item_id: Optional[int]):
    """Vincula (ou desvincula) o par falta x sobra nos dois itens."""
    siblings = {it.id: it for it in item.count.items}
    if item.pair_item_id and item.pair_item_id in siblings:
        siblings[item.pair_item_id].pair_item_id = None
    if not pair_item_id:
        item.pair_item_id = None
        return
    other = siblings.get(int(pair_item_id))
    if not other or other.id == item.id:
        raise InventoryError("Par inválido: o item precisa pertencer ao mesmo inventário.")
    if other.pair_item_id and other.pair_item_id != item.id and other.pair_item_id in siblings:
        siblings[other.pair_item_id].pair_item_id = None
    item.pair_item_id = other.id
    other.pair_item_id = item.id


# ==============================================================================
# --- [BLOCO: Transições de Status] ---
# ==============================================================================

def apply_transition(db: Session, user: models.User, count: models.InventoryCount, action: str) -> models.InventoryCount:
    # Todas as transições são da gerência; o papel CONTADOR apenas lança contagens
    require_manager(user)
    if action in engine.OMIE_ACTIONS:
        raise InventoryError(f"A ação '{action}' é executada pela integração com a Omie.")
    try:
        target = engine.check_transition(action, count.status)
    except ValueError as exc:
        raise InventoryError(str(exc))

    if action == "iniciar" and not count.items:
        raise InventoryError("O inventário não possui produtos.")

    if action in {"enviar", "aprovar"}:
        for item in count.items:
            recompute_item(item, count.cmc_tolerance_pct)
        issues = engine.validate_items_for_approval([item_to_engine(i) for i in count.items])
        if issues:
            db.rollback()
            raise InventoryError("Existem pendências na conferência.", status_code=409, details=issues)

    if action == "aprovar":
        count.snapshot_hash = engine.snapshot_hash([item_to_engine(i) for i in count.items])
        count.approved_by_id = user.id
        count.approved_at = _now()

    if action == "concluir":
        has_signed = any(d.kind == "VIA_ASSINADA" for d in count.documents)
        if not has_signed:
            raise InventoryError("Envie a via assinada do relatório antes de concluir.")
        count.concluded_at = _now()

    count.status = target
    db.commit()
    db.refresh(count)
    return count


# ==============================================================================
# --- [BLOCO: Exportação de Faltas] ---
# ==============================================================================

def build_shortages_rows(count: models.InventoryCount) -> List[Dict[str, Any]]:
    """Linhas das faltas para o fiscal (base da eventual NF-e de baixa por perda emitida manualmente)."""
    rows = []
    for item in count.items:
        diff = engine.compute_difference(item.counted_qty, item.system_qty)
        if not diff or diff >= 0:
            continue
        cost = engine.unit_cost_for_valuation(item.cmc, item.reference_cost)
        qty = abs(diff)
        rows.append({
            "codigo_omie": item.omie_id,
            "produto": item.product_name,
            "ncm": item.product.ncm if item.product else None,
            "unidade": item.unit,
            "quantidade": qty,
            "custo_unitario": round(cost, 6),
            "custo_ultima_compra": item.reference_cost,
            "total": engine.round_money(qty * cost),
            "motivo": engine.allocation_label([{"reason": r.reason, "quantity": r.quantity} for r in item.reasons], item.unit),
            "justificativa": item.justification,
        })
    return rows
