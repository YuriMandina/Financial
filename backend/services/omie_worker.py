import asyncio
from sqlalchemy.orm import Session
from core.database import SessionLocal
from models.models import OmieJobQueue
from services.circuit_breaker import circuit_breaker
from api.tasks import TaskManager
from services import omie_products
import json

async def start_omie_queue_worker():
    print("[WORKER] Omie Queue Worker Iniciado.")
    while True:
        await process_next_job()
        # 2 Segundos conforme escolha do usuário
        await asyncio.sleep(2.0)

async def process_next_job():
    db: Session = SessionLocal()
    try:
        if circuit_breaker.is_open():
            return
            
        # Puxa o próximo PENDING
        job = db.query(OmieJobQueue).filter(OmieJobQueue.status == "PENDING").order_by(OmieJobQueue.created_at.asc()).first()
        if not job:
            return
            
        # Marca como PROCESSING
        job.status = "PROCESSING"
        db.commit()
        
        action = job.action_type
        payload = job.payload
        task_id = job.task_id
        
        # Injeta contexto para funções que dependem do current_org
        from core.deps import current_org
        from models.models import Organization
        org = db.query(Organization).filter_by(id=job.organization_id).first()
        if org:
            current_org.set(org)
        else:
            job.status = "FAILED"
            job.error_msg = "Organização não localizada."
            db.commit()
            return
            
        sucesso, msg = False, ""
        
        try:
            if action == "REVERT_ADJUST":
                ajuste_id = payload.get("id_ajuste")
                sucesso, msg = await asyncio.to_thread(omie_products.excluir_ajuste_estoque, ajuste_id)
                if sucesso:
                    circuit_breaker.record_success()
                else:
                    if "bloqueada" in msg.lower() or "tente novamente em" in msg.lower():
                        import re
                        match = re.search(r'Tente novamente em (\d+) segundos', msg, re.IGNORECASE)
                        if match:
                            penalty = int(match.group(1))
                            circuit_breaker.record_failure(msg, penalty_seconds=penalty)
                            TaskManager.update_task(task_id, log=f"Omie bloqueou a API por {penalty}s. Fila pausada.")
                        else:
                            circuit_breaker.record_failure(msg, penalty_seconds=1800)
                    else:
                        circuit_breaker.record_failure(msg)
                        
            elif action == "ZERO_STOCK":
                prod_id = payload.get("produto_id")
                local_id = payload.get("local_id")
                dt = payload.get("data")
                saldo = payload.get("saldo_negativo")
                cost = payload.get("unit_cost")
                
                res = await asyncio.to_thread(omie_products.zerar_estoque_negativo, prod_id, local_id, dt, saldo, cost)
                if isinstance(res, dict) and "id_ajuste" in res:
                    job.error_msg = str(res["id_ajuste"])
                sucesso = True
                msg = "Estoque zerado."
                circuit_breaker.record_success()
                
            elif action == "EXPORT_CMC":
                prod_id = payload.get("produto_id")
                qtd = payload.get("quantidade")
                cost = payload.get("custo_unitario")
                dt = payload.get("data_processo")
                local_id = payload.get("local_id")
                
                sucesso, res_msg = await asyncio.to_thread(omie_products.lancar_entrada_estoque_omie, prod_id, qtd, cost, dt, local_id)
                if sucesso:
                    job.error_msg = str(res_msg)
                    await asyncio.to_thread(omie_products.atualizar_custo_produto, prod_id, cost)
                    msg = "Custo exportado."
                    circuit_breaker.record_success()
                else:
                    msg = str(res_msg)
                    circuit_breaker.record_failure(msg)
        except Exception as e:
            sucesso = False
            msg = str(e)
            circuit_breaker.record_failure(msg)
            
        prefix = ""
        nome = payload.get('nome_produto') or f"ID {payload.get('produto_id')}"
        if action == "ZERO_STOCK":
            prefix = f"[Zerar Estoque] {nome}"
        elif action == "EXPORT_CMC":
            prefix = f"[Lançar Custeio] {nome}"
        elif action == "REVERT_ADJUST":
            prefix = f"[Reverter Lançamento] Ajuste {payload.get('id_ajuste')}"
            
        if sucesso:
            job.status = "COMPLETED"
            # Mantemos o error_msg se existir pois usamos ele temporariamente para guardar os IDs da Omie!
            TaskManager.update_task(task_id, log=f"{prefix}: Sucesso")
        else:
            job.status = "FAILED"
            job.error_msg = msg
            TaskManager.update_task(task_id, log=f"{prefix}: Falha - {msg}")
            
        db.commit()
        
        # Verifica se todos os jobs desta task terminaram
        pendentes = db.query(OmieJobQueue).filter(OmieJobQueue.task_id == task_id, OmieJobQueue.status.in_(["PENDING", "PROCESSING"])).count()
        total = db.query(OmieJobQueue).filter(OmieJobQueue.task_id == task_id).count()
        
        if total > 0:
            prog = 100.0 * ((total - pendentes) / total)
            if pendentes == 0:
                falhas = db.query(OmieJobQueue).filter(OmieJobQueue.task_id == task_id, OmieJobQueue.status == "FAILED").all()
                if falhas:
                    erros = [f"{f.action_type}: {f.error_msg}" for f in falhas]
                    TaskManager.update_task(task_id, progress=100.0, result={"falhas": erros})
                    # O TaskManager usa "status" no próprio result ou como campo separado.
                    if task_id in TaskManager._tasks:
                        TaskManager._tasks[task_id]["status"] = "error"
                # --- TRATAMENTO DE SNAPSHOTS APÓS SUCESSO ---
                if action in ["EXPORT_CMC", "ZERO_STOCK"]:
                    # Pega todos os IDs de ajuste guardados em error_msg (como string). Hack temporário no SQLite.
                    sucessos = db.query(OmieJobQueue).filter(OmieJobQueue.task_id == task_id, OmieJobQueue.status == "COMPLETED").all()
                    ajustes_ids = [int(s.error_msg) for s in sucessos if s.error_msg and s.error_msg.isdigit()]
                    if ajustes_ids:
                        from models.models import SyncSnapshot
                        from datetime import datetime
                        tipo = "RATEIO_CUSTEIO" if action == "EXPORT_CMC" else "ESTOQUES_NEGATIVOS"
                        snap = SyncSnapshot(
                            cache_key=f"{tipo}_{datetime.now().strftime('%Y%m%d%H%M%S')}_{len(ajustes_ids)}",
                            tipo_relatorio=tipo,
                            data_referencia=datetime.now().strftime("%Y-%m-%d"),
                            dados={"ajustes_ids": ajustes_ids},
                            organization_id=job.organization_id
                        )
                        db.add(snap)
                        db.commit()
                elif action == "REVERT_ADJUST":
                    snapshot_id = payload.get("snapshot_id")
                    # Só exclui do Histórico se TODAS as reversões do lote deram sucesso (nenhuma falha)
                    if snapshot_id and not falhas:
                        from models.models import SyncSnapshot
                        snap = db.query(SyncSnapshot).filter_by(id=snapshot_id).first()
                        if snap:
                            db.delete(snap)
                            db.commit()
                            
                TaskManager.update_task(task_id, progress=100.0, result={"sucesso": True})
            else:
                TaskManager.update_task(task_id, progress=prog)
                
    except Exception as e:
        print(f"[WORKER] Erro no process_next_job: {e}")
        db.rollback()
    finally:
        db.close()
