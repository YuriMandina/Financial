"""
Integração do Módulo de Inventário com a Omie.

- Snapshot: saldo/CMC (ListarPosEstoque) e último custo de compra na data de corte.
- Efetivação: confere se o saldo mudou desde a aprovação, enfileira um ajuste por item
  (OmieJobQueue) e, ao final, confere saldo/CMC resultantes na Omie.
- Reversão: exclui os ajustes efetivados e devolve o inventário para conferência.
- Catálogo: sincroniza EAN/unidade/NCM e produtos sem família; atribui família na Omie.

Os jobs são processados pelo omie_worker via registro de handlers (sem tocar no rateio).
"""
import asyncio
import time
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy.orm import Session

import models.models as models
from api.tasks import TaskManager
from core.database import SessionLocal
from core.deps import current_org
from services import estoque_engine as engine
from services import estoque_service as service
from services import omie_estoque as omie
from services.circuit_breaker import circuit_breaker
from services.omie_worker import register_job_handler

JOB_ADJUST = "INVENTORY_ADJUST"
JOB_VERIFY = "INVENTORY_VERIFY"
JOB_REVERT = "INVENTORY_REVERT"

MAX_RETRIES = 6
QTY_TOLERANCE = 1e-4
CMC_TOLERANCE = 0.01
ITEM_PAUSE_SECONDS = 0.25

ADJ_PENDING, ADJ_DONE, ADJ_FAILED = "PENDING", "DONE", "FAILED"
ADJ_REVERTED, ADJ_REVERT_FAILED = "REVERTED", "REVERT_FAILED"


def _now():
    return datetime.now(timezone.utc)


# ==============================================================================
# --- [BLOCO: Helpers de Task e Estado] ---
# ==============================================================================

def _task_running(task_id: Optional[str]) -> bool:
    task = TaskManager.get_task(task_id) if task_id else None
    return bool(task and task.get("status") not in ("completed", "error", "canceled"))


def _ensure_idle(count: models.InventoryCount):
    if _task_running(count.omie_task_id):
        raise service.InventoryError("Já existe uma operação com a Omie em andamento para este inventário.",
                                     status_code=409, details={"task_id": count.omie_task_id})


def _ensure_omie_credentials(org: models.Organization):
    if not org.omie_app_key or not org.omie_app_secret:
        raise service.InventoryError("Credenciais da Omie não configuradas para a organização.")


def _obs(count: models.InventoryCount) -> str:
    family = count.family.name if count.family else ""
    return f"Inventário #{count.id} - {family} - corte {count.cutoff_date.strftime('%d/%m/%Y')}"


def _apply_position(item: models.InventoryCountItem, pos: Optional[dict]):
    if pos is None:
        item.system_qty, item.cmc, item.system_value = 0.0, None, 0.0
    else:
        item.system_qty = engine.round_qty(pos["saldo"])
        item.cmc = pos["cmc"]
        item.system_value = engine.round_money(pos["valor"])


def _bind_org(db: Session, org_id: int):
    """Tarefas em segundo plano usam a organização carregada na própria sessão.

    O objeto da requisição HTTP é expirado no commit e desanexado quando a sessão fecha,
    o que impediria ler as credenciais da Omie fora da requisição.
    """
    org = db.query(models.Organization).filter_by(id=org_id).first()
    current_org.set(org)
    return org


def _task_counts(db: Session, task_id: str):
    q = db.query(models.OmieJobQueue).filter(models.OmieJobQueue.task_id == task_id)
    total = q.count()
    pending = q.filter(models.OmieJobQueue.status.in_(["PENDING", "PROCESSING"])).count()
    return total, pending


def _clear_approval(count: models.InventoryCount):
    count.approved_by_id = None
    count.approved_at = None
    count.snapshot_hash = None


# ==============================================================================
# --- [BLOCO: Snapshot do Sistema] ---
# ==============================================================================

def start_snapshot(db: Session, user: models.User, count: models.InventoryCount) -> str:
    service.require_manager(user)
    if count.status != engine.CONFERENCIA:
        raise service.InventoryError("O saldo do sistema é capturado na conferência (após encerrar a contagem).")
    _ensure_idle(count)
    _ensure_omie_credentials(user.organization)
    task_id = TaskManager.create_task(f"inventario_snapshot_{count.id}")
    count.omie_task_id = task_id
    count.last_error = None
    db.commit()
    return task_id


def bg_capture_snapshot(task_id: str, count_id: int):
    db = SessionLocal()
    try:
        count = db.query(models.InventoryCount).filter_by(id=count_id).first()
        if not count or count.status != engine.CONFERENCIA:
            TaskManager.update_task(task_id, log="Inventário não está em conferência.", status="error")
            return
        _bind_org(db, count.organization_id)
        TaskManager.update_task(task_id, progress=5.0, log="Lendo posição de estoque na Omie...")
        positions = omie.listar_posicoes(count.cutoff_date, count.omie_local_code)
        TaskManager.update_task(task_id, progress=30.0,
                                log=f"{len(positions)} posições lidas. Buscando custo da última compra...")

        missing: List[str] = []
        total = len(count.items) or 1
        for idx, item in enumerate(count.items, start=1):
            task = TaskManager.get_task(task_id)
            if task and task.get("status") == "canceled":
                db.rollback()
                count.omie_task_id = None
                db.commit()
                return
            pos = positions.get(int(item.omie_id))
            if pos is None:
                missing.append(item.product_name)
            _apply_position(item, pos)
            if item.reference_cost_source != "MANUAL":
                try:
                    ref = omie.obter_ultimo_custo(item.omie_id, count.cutoff_date, count.omie_local_code)
                except omie.OmieError as exc:
                    ref = None
                    TaskManager.update_task(task_id, log=f"{item.product_name}: custo da última compra indisponível ({exc.message})")
                item.reference_cost = ref
                item.reference_cost_source = "OMIE" if ref else None
            service.recompute_item(item, count.cmc_tolerance_pct)
            if idx % 10 == 0 or idx == total:
                TaskManager.update_task(task_id, progress=30.0 + 70.0 * idx / total)
            time.sleep(ITEM_PAUSE_SECONDS)

        count.snapshot_at = _now()
        count.omie_task_id = None
        count.last_error = (f"Produtos sem posição na Omie (considerados com saldo 0): {', '.join(missing)}"
                            if missing else None)
        db.commit()
        TaskManager.update_task(task_id, progress=100.0, log="Saldo do sistema capturado.", status="completed",
                                result={"itens": total, "sem_posicao": missing})
    except Exception as exc:
        db.rollback()
        _record_task_error(db, count_id, task_id, f"Falha ao capturar saldo: {exc}")
    finally:
        db.close()


def _record_task_error(db: Session, count_id: int, task_id: str, message: str, status: Optional[str] = None):
    count = db.query(models.InventoryCount).filter_by(id=count_id).first()
    if count:
        count.last_error = message
        count.omie_task_id = None
        if status:
            count.status = status
        db.commit()
    TaskManager.update_task(task_id, log=message, status="error")


# ==============================================================================
# --- [BLOCO: Efetivação] ---
# ==============================================================================

def start_effectivation(db: Session, user: models.User, count: models.InventoryCount) -> str:
    service.require_manager(user)
    try:
        engine.check_transition("efetivar", count.status)
    except ValueError as exc:
        raise service.InventoryError(str(exc))
    _ensure_idle(count)
    _ensure_omie_credentials(user.organization)
    current = engine.snapshot_hash([service.item_to_engine(i) for i in count.items])
    if current != count.snapshot_hash:
        raise service.InventoryError("O conteúdo do inventário mudou após a aprovação. Desaprove e aprove novamente.")

    task_id = TaskManager.create_task(f"inventario_efetivar_{count.id}")
    count.status = engine.EFETIVANDO
    count.omie_task_id = task_id
    count.last_error = None
    db.commit()
    return task_id


def bg_prepare_effectivation(task_id: str, count_id: int):
    """Confere se o saldo na Omie mudou desde a aprovação e enfileira os ajustes."""
    db = SessionLocal()
    try:
        count = db.query(models.InventoryCount).filter_by(id=count_id).first()
        _bind_org(db, count.organization_id)
        TaskManager.update_task(task_id, progress=5.0, log="Conferindo saldo atual na Omie antes de ajustar...")
        positions = omie.listar_posicoes(count.cutoff_date, count.omie_local_code)

        drift = []
        for item in count.items:
            pos = positions.get(int(item.omie_id))
            current = engine.round_qty(pos["saldo"]) if pos else 0.0
            if abs(current - float(item.system_qty or 0.0)) > QTY_TOLERANCE:
                drift.append(f"{item.product_name} ({item.system_qty:g} → {current:g})")
                _apply_position(item, pos)
                service.recompute_item(item, count.cmc_tolerance_pct)
        if drift:
            count.status = engine.CONFERENCIA
            _clear_approval(count)
            count.snapshot_at = _now()
            count.omie_task_id = None
            count.last_error = ("O saldo na Omie mudou desde a aprovação (ex: NF lançada com data até o corte). "
                                f"Revise e aprove novamente: {'; '.join(drift)}")
            db.commit()
            TaskManager.update_task(task_id, log=count.last_error, status="error")
            return

        queued = _enqueue_adjustments(db, count, task_id)
        if queued == 0:
            _enqueue_verify(db, count, task_id)
            TaskManager.update_task(task_id, progress=50.0, log="Nenhum ajuste necessário. Conferindo saldos...")
        else:
            TaskManager.update_task(task_id, progress=10.0, log=f"{queued} ajustes enfileirados para a Omie.")
    except Exception as exc:
        db.rollback()
        _record_task_error(db, count_id, task_id, f"Falha ao preparar efetivação: {exc}", status=engine.APROVADO)
    finally:
        db.close()


def _enqueue_adjustments(db: Session, count: models.InventoryCount, task_id: str) -> int:
    """Cria/atualiza o ajuste de cada item pendente e enfileira um job por ajuste."""
    queued = 0
    for item in count.items:
        adj = item.adjustment
        if adj and adj.status == ADJ_DONE:
            continue
        plan = engine.build_adjustment(item.system_qty, item.counted_qty, item.cmc, item.reference_cost,
                                       item.adjustment_case, item.cmc_correction_approved)
        if not plan:
            continue
        if not adj:
            adj = models.InventoryAdjustment(
                cod_int_ajuste=engine.adjustment_integration_code(count.id, item.id, count.effectivation_seq))
            item.adjustment = adj
        adj.tipo, adj.motivo = plan["tipo"], plan["motivo"]
        adj.quantity, adj.unit_value = plan["quan"], plan["valor"]
        adj.status, adj.error_msg = ADJ_PENDING, None
        db.flush()
        db.add(models.OmieJobQueue(
            organization_id=count.organization_id, task_id=task_id, action_type=JOB_ADJUST,
            payload={"adjustment_id": adj.id, "count_id": count.id, "nome_produto": item.product_name},
        ))
        queued += 1
    db.commit()
    return queued


def _enqueue_verify(db: Session, count: models.InventoryCount, task_id: str):
    db.add(models.OmieJobQueue(organization_id=count.organization_id, task_id=task_id,
                               action_type=JOB_VERIFY, payload={"count_id": count.id}))
    db.commit()


def start_reprocess(db: Session, user: models.User, count: models.InventoryCount) -> str:
    """Reenvia apenas os ajustes que falharam (os já efetivados são preservados)."""
    service.require_manager(user)
    try:
        engine.check_transition("reprocessar", count.status)
    except ValueError as exc:
        raise service.InventoryError(str(exc))
    _ensure_idle(count)
    task_id = TaskManager.create_task(f"inventario_efetivar_{count.id}")
    count.status = engine.EFETIVANDO
    count.omie_task_id = task_id
    count.last_error = None
    db.commit()
    if _enqueue_adjustments(db, count, task_id) == 0:
        _enqueue_verify(db, count, task_id)
    return task_id


# ==============================================================================
# --- [BLOCO: Reversão] ---
# ==============================================================================

def start_revert(db: Session, user: models.User, count: models.InventoryCount) -> str:
    service.require_manager(user)
    try:
        engine.check_transition("reverter", count.status)
    except ValueError as exc:
        raise service.InventoryError(str(exc))
    _ensure_idle(count)
    task_id = TaskManager.create_task(f"inventario_reverter_{count.id}")
    count.status = engine.REVERTENDO
    count.omie_task_id = task_id
    count.last_error = None
    queued = 0
    for item in count.items:
        adj = item.adjustment
        if adj and adj.omie_ajuste_id and adj.status in (ADJ_DONE, ADJ_REVERT_FAILED):
            db.add(models.OmieJobQueue(
                organization_id=count.organization_id, task_id=task_id, action_type=JOB_REVERT,
                payload={"adjustment_id": adj.id, "count_id": count.id, "nome_produto": item.product_name},
            ))
            queued += 1
    db.commit()
    if queued == 0:
        _finish_revert(db, count, task_id)
    return task_id


def _finish_revert(db: Session, count: models.InventoryCount, task_id: str):
    """Todos os ajustes excluídos: volta para conferência com novo sequencial de cod_int_ajuste."""
    for item in count.items:
        if item.adjustment:
            db.delete(item.adjustment)
        item.verified_qty = item.verified_cmc = item.verify_status = None
    count.effectivation_seq = (count.effectivation_seq or 1) + 1
    count.status = engine.CONFERENCIA
    count.effective_at = None
    _clear_approval(count)
    count.omie_task_id = None
    count.last_error = None
    db.commit()
    TaskManager.update_task(task_id, progress=100.0, log="Ajustes excluídos na Omie. Inventário voltou para conferência.",
                            status="completed")


# ==============================================================================
# --- [BLOCO: Handlers da Fila (omie_worker)] ---
# ==============================================================================

def _load_adjustment(db: Session, job: models.OmieJobQueue):
    adj = db.query(models.InventoryAdjustment).filter_by(id=job.payload.get("adjustment_id")).first()
    if not adj:
        return None, None, None
    return adj, adj.item, adj.item.count


def _requeue_or_fail(db: Session, job: models.OmieJobQueue, exc: omie.OmieError) -> bool:
    """Bloqueio temporário: devolve o job à fila e pausa o worker. Retorna True se reenfileirou."""
    if exc.retryable and (job.retry_count or 0) < MAX_RETRIES:
        job.retry_count = (job.retry_count or 0) + 1
        job.status = "PENDING"
        job.error_msg = exc.message
        circuit_breaker.record_failure(exc.message, penalty_seconds=exc.retry_after)
        TaskManager.update_task(job.task_id, log=f"Omie pediu espera de {exc.retry_after}s. Fila pausada.")
        db.commit()
        return True
    return False


async def handle_adjust(db: Session, job: models.OmieJobQueue):
    adj, item, count = _load_adjustment(db, job)
    if not adj or count.status != engine.EFETIVANDO:
        job.status, job.error_msg = "FAILED", "Ajuste ou inventário fora de efetivação."
        db.commit()
        return
    if adj.status != ADJ_DONE:
        try:
            ajuste_id = await asyncio.to_thread(
                omie.incluir_ajuste, item.omie_id, count.cutoff_date, adj.tipo, adj.motivo,
                adj.quantity, adj.unit_value, adj.cod_int_ajuste, _obs(count), count.omie_local_code,
            )
            adj.omie_ajuste_id, adj.status, adj.error_msg, adj.done_at = ajuste_id, ADJ_DONE, None, _now()
            circuit_breaker.record_success()
            TaskManager.update_task(job.task_id, log=f"[Inventário] {item.product_name}: {adj.tipo}/{adj.motivo} ok")
        except omie.OmieError as exc:
            if _requeue_or_fail(db, job, exc):
                return
            adj.status, adj.error_msg = ADJ_FAILED, exc.message
            TaskManager.update_task(job.task_id, log=f"[Inventário] {item.product_name}: falha - {exc.message}")
        except Exception as exc:
            adj.status, adj.error_msg = ADJ_FAILED, str(exc)
    job.status = "COMPLETED" if adj.status == ADJ_DONE else "FAILED"
    job.error_msg = adj.error_msg
    job.completed_at = _now()
    db.commit()

    total, pending = _task_counts(db, job.task_id)
    TaskManager.update_task(job.task_id, progress=10.0 + 80.0 * (total - pending) / max(total, 1))
    if pending:
        return
    failed = [i.product_name for i in count.items if i.adjustment and i.adjustment.status == ADJ_FAILED]
    if failed:
        count.status = engine.EFETIVANDO_COM_ERRO
        count.omie_task_id = None
        count.last_error = f"{len(failed)} ajuste(s) falharam: {', '.join(failed)}. Use reprocessar ou reverter."
        db.commit()
        TaskManager.update_task(job.task_id, log=count.last_error, status="error")
    else:
        _enqueue_verify(db, count, job.task_id)


async def handle_verify(db: Session, job: models.OmieJobQueue):
    """Lê saldo/CMC na data de corte após os ajustes e marca cada item como OK ou DIVERGENTE."""
    count = db.query(models.InventoryCount).filter_by(id=job.payload.get("count_id")).first()
    if not count:
        job.status, job.error_msg = "FAILED", "Inventário não encontrado."
        db.commit()
        return
    try:
        positions = await asyncio.to_thread(omie.listar_posicoes, count.cutoff_date, count.omie_local_code)
    except omie.OmieError as exc:
        if _requeue_or_fail(db, job, exc):
            return
        positions, verify_error = None, exc.message
    else:
        verify_error = None

    divergent = []
    if positions is not None:
        for item in count.items:
            pos = positions.get(int(item.omie_id))
            saldo = engine.round_qty(pos["saldo"]) if pos else 0.0
            cmc = pos["cmc"] if pos else None
            item.verified_qty, item.verified_cmc = saldo, cmc
            ok = abs(saldo - float(item.counted_qty or 0.0)) <= QTY_TOLERANCE
            adj = item.adjustment
            if ok and adj and adj.tipo == "SLD" and saldo > 0 and cmc is not None:
                ok = abs(cmc - adj.unit_value) <= CMC_TOLERANCE
            item.verify_status = "OK" if ok else "DIVERGENTE"
            if not ok:
                divergent.append(item.product_name)

    count.status = engine.EFETIVADO
    count.effective_at = _now()
    count.omie_task_id = None
    if verify_error:
        count.last_error = f"Ajustes efetivados, mas a conferência pós-efetivação falhou: {verify_error}"
    elif divergent:
        count.last_error = (f"Ajustes efetivados. {len(divergent)} item(ns) com saldo/CMC divergente na Omie "
                            f"(movimentos na data de corte?): {', '.join(divergent)}")
    else:
        count.last_error = None
    job.status, job.completed_at = "COMPLETED", _now()
    db.commit()
    TaskManager.update_task(job.task_id, progress=100.0, log=count.last_error or "Inventário efetivado e conferido.",
                            status="completed", result={"divergentes": divergent})


async def handle_revert(db: Session, job: models.OmieJobQueue):
    adj, item, count = _load_adjustment(db, job)
    if not adj or count.status != engine.REVERTENDO:
        job.status, job.error_msg = "FAILED", "Ajuste ou inventário fora de reversão."
        db.commit()
        return
    try:
        await asyncio.to_thread(omie.excluir_ajuste, adj.omie_ajuste_id)
        adj.status, adj.error_msg = ADJ_REVERTED, None
        circuit_breaker.record_success()
        TaskManager.update_task(job.task_id, log=f"[Inventário] {item.product_name}: ajuste excluído")
    except omie.OmieError as exc:
        if _requeue_or_fail(db, job, exc):
            return
        adj.status, adj.error_msg = ADJ_REVERT_FAILED, exc.message
    except Exception as exc:
        adj.status, adj.error_msg = ADJ_REVERT_FAILED, str(exc)
    job.status = "COMPLETED" if adj.status == ADJ_REVERTED else "FAILED"
    job.error_msg = adj.error_msg
    job.completed_at = _now()
    db.commit()

    total, pending = _task_counts(db, job.task_id)
    TaskManager.update_task(job.task_id, progress=100.0 * (total - pending) / max(total, 1))
    if pending:
        return
    failed = [i.product_name for i in count.items if i.adjustment and i.adjustment.status == ADJ_REVERT_FAILED]
    if failed:
        count.status = engine.REVERSAO_COM_ERRO
        count.omie_task_id = None
        count.last_error = f"Falha ao excluir {len(failed)} ajuste(s): {', '.join(failed)}. Tente reverter novamente."
        db.commit()
        TaskManager.update_task(job.task_id, log=count.last_error, status="error")
    else:
        _finish_revert(db, count, job.task_id)


register_job_handler(JOB_ADJUST, handle_adjust)
register_job_handler(JOB_VERIFY, handle_verify)
register_job_handler(JOB_REVERT, handle_revert)


# ==============================================================================
# --- [BLOCO: Catálogo de Produtos] ---
# ==============================================================================

def bg_sync_catalog(task_id: str, org_id: int):
    """Atualiza EAN/unidade/NCM/família de todos os produtos e cria os que ainda não existem (inclusive sem família)."""
    db = SessionLocal()
    try:
        _bind_org(db, org_id)
        TaskManager.update_task(task_id, progress=5.0, log="Lendo cadastro de produtos na Omie...")
        families = {f.omie_id: f for f in db.query(models.BoningFamily).filter_by(organization_id=org_id).all()}
        products = {p.omie_id: p for p in db.query(models.BoningProduct).filter_by(organization_id=org_id).all()}
        created = updated = 0
        for idx, prod in enumerate(omie.listar_produtos(), start=1):
            omie_id = int(prod["codigo_produto"])
            cod_fam = prod.get("codigo_familia") or None
            family = None
            if cod_fam:
                family = families.get(cod_fam)
                if not family:
                    name = str(prod.get("descricao_familia") or "").strip() or "Sem Nome"
                    family = models.BoningFamily(omie_id=cod_fam, name=name, organization_id=org_id)
                    db.add(family)
                    db.flush()
                    families[cod_fam] = family
            fields = {
                "ean": str(prod.get("ean") or "").strip() or None,
                "unit": str(prod.get("unidade") or "").strip() or None,
                "ncm": str(prod.get("ncm") or "").strip() or None,
                "family_id": family.id if family else None,
            }
            db_prod = products.get(omie_id)
            if db_prod:
                for key, value in fields.items():
                    setattr(db_prod, key, value)
                db_prod.name = prod.get("descricao") or db_prod.name
                updated += 1
            elif prod.get("inativo") != "S":
                db_prod = models.BoningProduct(
                    omie_id=omie_id, name=prod.get("descricao") or "Sem Descrição",
                    unit_price=float(prod.get("valor_unitario") or 0.0), organization_id=org_id, **fields,
                )
                db.add(db_prod)
                products[omie_id] = db_prod
                created += 1
            if idx % 500 == 0:
                db.commit()
                TaskManager.update_task(task_id, progress=min(95.0, 5.0 + idx / 20.0),
                                        log=f"{idx} produtos processados...")
        db.commit()
        TaskManager.update_task(task_id, progress=100.0, status="completed",
                                log=f"Catálogo sincronizado: {created} novos, {updated} atualizados.",
                                result={"created": created, "updated": updated})
    except Exception as exc:
        db.rollback()
        TaskManager.update_task(task_id, log=f"Falha ao sincronizar catálogo: {exc}", status="error")
    finally:
        db.close()


def assign_family(db: Session, user: models.User, org_id: int, product_id: int, family_id: int) -> models.BoningProduct:
    """Atribui a família ao produto na Omie (com conferência do cadastro) e localmente."""
    service.require_manager(user)
    product = db.query(models.BoningProduct).filter_by(id=product_id, organization_id=org_id).first()
    family = db.query(models.BoningFamily).filter_by(id=family_id, organization_id=org_id).first()
    if not product or not family:
        raise service.InventoryError("Produto ou família não encontrado.", status_code=404)
    _ensure_omie_credentials(user.organization)
    try:
        omie.alterar_familia_produto(product.omie_id, family.omie_id)
    except omie.OmieError as exc:
        raise service.InventoryError(exc.message, status_code=502)
    product.family_id = family.id
    db.commit()
    return product
