from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import traceback
import time
import requests
import pandas as pd
import models.models as models
from core.database import SessionLocal
from core.deps import current_org, get_current_user_and_set_org
from core.utils import tratar_vazio
from api.tasks import TaskManager, TaskQueue
from services.omie_dicionarios import (
    extrair_dicionario_contas_correntes, 
    extrair_dicionario_fornecedores, 
    extrair_dicionario_categorias
)
from services.omie_financeiro import extrair_contas_receber_abertas

router = APIRouter()

def bg_sync_recebimentos(task_id: str, org_id: int):
    try:
        TaskManager.update_task(task_id, progress=5.0, log=f"Iniciando sincronização de Recebimentos...")
        extrair_contas_receber_abertas(task_id=task_id, force_sync=True)
        TaskManager.update_task(task_id, progress=100.0, log="Sincronização concluída com sucesso!", status="completed")
    except Exception as e:
        import traceback
        traceback.print_exc()
        TaskManager.update_task(task_id, log=f"Erro durante sincronização: {str(e)}", status="error")

@router.post("/api/relatorios/recebimentos/sync")
async def sync_recebimentos(
    current_user: models.User = Depends(get_current_user_and_set_org)
):
    current_org.set(current_user.organization)
    action_id = "sync_recebimentos"
    active_id = TaskManager.get_active_task_id(action_id)
    if active_id:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=409, content={"detail": "Esta ação já está em andamento. Cancele-a antes de iniciar uma nova.", "task_id": active_id})
        
    task_id = TaskManager.create_task(action_id)
    TaskManager.update_task(task_id, progress=0.0, log="Aguardando na fila de sincronização...")
    org_id = current_org.get().id
    
    await TaskQueue.enqueue(bg_sync_recebimentos, task_id, org_id)
    return {"task_id": task_id, "message": "Sincronização iniciada em background."}

class PagamentoItem(BaseModel):
    codigo_lancamento: int
    valor: float
    desconto: float = 0.0
    juros: float = 0.0

class BaixaLoteRequest(BaseModel):
    id_conta_corrente: int
    data_pagamento: str
    pagamentos: list[PagamentoItem]

class RecebimentoReciboCreate(BaseModel):
    cliente: str
    banco: str | None
    data_pagamento: str
    totalOriginal: float
    totalDesconto: float
    totalJuros: float
    totalPago: float
    notas: list

@router.get("/api/relatorios/recebimentos/dados")
def obter_recebimentos_abertos(data_inicio: str = None, data_fim: str = None, force_sync: bool = False, current_user: models.User = Depends(get_current_user_and_set_org)):
    current_org.set(current_user.organization)
    try:
        dict_clientes = extrair_dicionario_fornecedores()
        dict_categorias = extrair_dicionario_categorias()
        dict_contas = extrair_dicionario_contas_correntes()

        dict_cli_str = {str(k): v for k, v in dict_clientes.items()}
        dict_cat_str = {str(k): v for k, v in dict_categorias.items()}

        contas_brutas, ultima_sync = extrair_contas_receber_abertas(force_sync=force_sync, return_metadata=True)
        ultima_sync_str = ultima_sync.strftime("%d/%m/%Y %H:%M:%S") if ultima_sync else None

        if not contas_brutas:
            return JSONResponse(content={"total": 0.0, "contas": [], "ultima_sincronizacao": ultima_sync_str})

        contas_lista = []
        total = 0.0

        for c in contas_brutas:
            tipo_doc = str(c.get("codigo_tipo_documento", "")).strip().upper()

            if tipo_doc != "CRE":
                continue

            id_cli = str(c.get("codigo_cliente_fornecedor", ""))
            id_cat = str(c.get("codigo_categoria", ""))
            id_conta = str(c.get("id_conta_corrente", ""))

            nome_cli = dict_cli_str.get(id_cli, tratar_vazio(id_cli))
            desc_cat = dict_cat_str.get(id_cat, tratar_vazio(id_cat))
            nome_conta = dict_contas.get(id_conta, f"Conta {id_conta}")

            valor_documento = float(c.get("valor_documento", 0.0))
            valor_pag = float(c.get("valor_pag", 0.0))

            if valor_pag >= valor_documento:
                continue
            elif valor_pag > 0:
                saldo = round(valor_documento - valor_pag, 2)
            else:
                saldo = valor_documento

            info_registro = c.get("info", {})
            hora_exata = info_registro.get("hInc", "00:00:00")

            contas_lista.append(
                {
                    "codigo_lancamento": c.get("codigo_lancamento_omie"),
                    "data_previsao_br": tratar_vazio(c.get("data_previsao") or c.get("data_vencimento")),
                    "data_emissao": tratar_vazio(c.get("data_emissao")),
                    "hora_emissao": hora_exata,
                    "tipo_documento": tipo_doc,
                    "numero_documento_fiscal": tratar_vazio(
                        c.get("numero_documento_fiscal")
                    ),
                    "numero_parcela": tratar_vazio(c.get("numero_parcela")),
                    "nome_cliente": nome_cli,
                    "nome_fornecedor": nome_cli,
                    "desc_categoria": desc_cat,
                    "conta_corrente": nome_conta,
                    "valor_documento": valor_documento,
                    "valor_pag": valor_pag,
                    "saldo_devedor": saldo,
                    "tem_pagamento_parcial": valor_pag > 0 and valor_pag < valor_documento,
                }
            )
            total += saldo


        contas_lista = sorted(
            contas_lista,
            key=lambda x: (
                pd.to_datetime(
                    x["data_previsao_br"], format="%d/%m/%Y", errors="coerce"
                )
                if x["data_previsao_br"] != "-"
                else pd.Timestamp.min
            ),
        )
        return JSONResponse(content={"total": total, "contas": contas_lista, "ultima_sincronizacao": ultima_sync_str})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"detail": str(e)})

def bg_baixar_recebimentos_lote(task_id: str, req_dict: dict, org_id: int):
    try:
        req = BaixaLoteRequest(**req_dict)
        db = SessionLocal()
        org = db.query(models.Organization).filter(models.Organization.id == org_id).first()
        current_org.set(org)
        
        url = "https://app.omie.com.br/api/v1/financas/contareceber/"
        erros = []
        baixas_sucesso = []
        
        TaskManager.update_task(task_id, progress=5.0, log="Iniciando processamento das baixas no Omie...")
        
        total_items = len(req.pagamentos)
        for i, pag in enumerate(req.pagamentos):
            t = TaskManager.get_task(task_id)
            if t and t.get("status") == "canceled":
                TaskManager.update_task(task_id, log="Cancelamento solicitado pelo usuário. Revertendo baixas já efetuadas...")
                rollback_erros = []
                for baixa in baixas_sucesso:
                    codigo_baixa = baixa.get("codigo_baixa")
                    if not codigo_baixa:
                        continue
                    payload_cancel = {
                        "call": "CancelarRecebimento",
                        "app_key": current_org.get().omie_app_key,
                        "app_secret": current_org.get().omie_app_secret,
                        "param": [{"codigo_baixa": codigo_baixa}]
                    }
                    try:
                        res_cancel = requests.post(url, json=payload_cancel, headers={"Content-Type": "application/json"}).json()
                        if "faultstring" in res_cancel:
                            rollback_erros.append(f"Erro ao reverter {codigo_baixa}: {res_cancel['faultstring']}")
                    except Exception as e:
                        rollback_erros.append(f"Erro ao reverter {codigo_baixa}: {str(e)}")
                    time.sleep(0.3)
                
                if rollback_erros:
                    TaskManager.update_task(task_id, log="Rollback com erros: " + " | ".join(rollback_erros), status="error")
                else:
                    TaskManager.update_task(task_id, log="Baixas revertidas com sucesso. Operação abortada.", status="error")
                
                db.close()
                return

            time.sleep(0.3)
            payload = {
                "call": "LancarRecebimento",
                "app_key": current_org.get().omie_app_key,
                "app_secret": current_org.get().omie_app_secret,
                "param": [
                    {
                        "codigo_lancamento": pag.codigo_lancamento,
                        "codigo_conta_corrente": req.id_conta_corrente,
                        "valor": pag.valor,
                        "desconto": pag.desconto,
                        "juros": pag.juros,
                        "data": req.data_pagamento,
                        "observacao": "Baixa em Lote c/ Rateio via GabaritoBI",
                    }
                ],
            }
            try:
                res = requests.post(
                    url, json=payload, headers={"Content-Type": "application/json"}
                ).json()
                if "faultstring" in res:
                    erros.append(f"Erro na nota {pag.codigo_lancamento}: {res['faultstring']}")
                else:
                    baixas_sucesso.append({
                        "codigo_lancamento": pag.codigo_lancamento,
                        "codigo_baixa": res.get("codigo_baixa")
                    })
            except Exception as e:
                erros.append(f"Erro na comunicação: {str(e)}")
            
            progress = 5.0 + ((i + 1) / total_items) * 80.0
            TaskManager.update_task(task_id, progress=progress, log=f"Processado {i+1} de {total_items} recebimentos...")

        if baixas_sucesso:
            TaskManager.update_task(task_id, progress=90.0, log="Atualizando cache local...")
            try:
                cache_key = "contas_receber_abertas_global"
                snap = db.query(models.SyncSnapshot).filter(
                    models.SyncSnapshot.cache_key == cache_key, 
                    models.SyncSnapshot.organization_id == current_org.get().id
                ).first()

                if snap and isinstance(snap.dados, list):
                    dados_atualizados = list(snap.dados)
                    for pag in req.pagamentos:
                        for c in dados_atualizados:
                            if c.get("codigo_lancamento_omie") == pag.codigo_lancamento:
                                v_pag = float(c.get("valor_pag") or 0.0)
                                c["valor_pag"] = v_pag + pag.valor
                                break
                    
                    snap.dados = dados_atualizados
                    from sqlalchemy.orm.attributes import flag_modified
                    flag_modified(snap, "dados")
                    db.commit()
            except Exception as e:
                print("Erro ao atualizar cache local:", e)
                
        db.close()

        if erros:
            TaskManager.update_task(task_id, log="Concluído com erros: " + " | ".join(erros), status="error")
        else:
            TaskManager.update_task(
                task_id, 
                progress=100.0, 
                log="Recebimentos efetuados com sucesso!", 
                status="completed", 
                result={"baixas": baixas_sucesso}
            )
            
    except Exception as e:
        import traceback
        traceback.print_exc()
        TaskManager.update_task(task_id, log=f"Erro fatal: {str(e)}", status="error")

@router.post("/api/relatorios/recebimentos/baixar")
async def baixar_recebimento_lote(req: BaixaLoteRequest, current_user: models.User = Depends(get_current_user_and_set_org)):
    action_id = "baixar_recebimentos"
    active_id = TaskManager.get_active_task_id(action_id)
    if active_id:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=409, content={"detail": "Já existe um processamento de baixas em andamento. Aguarde.", "task_id": active_id})

    task_id = TaskManager.create_task(action_id)
    TaskManager.update_task(task_id, progress=0.0, log="Aguardando na fila...")
    await TaskQueue.enqueue(bg_baixar_recebimentos_lote, task_id, req.dict(), current_org.get().id)
    return {"task_id": task_id, "message": "Iniciando recebimento em lote..."}

@router.post("/api/recibos")
def salvar_recibo(req: RecebimentoReciboCreate, current_user: models.User = Depends(get_current_user_and_set_org)):
    current_org.set(current_user.organization)
    db = SessionLocal()
    try:
        novo_recibo = models.PaymentReceipt(
            cliente=req.cliente,
            banco=req.banco,
            data_pagamento=req.data_pagamento,
            total_original=req.totalOriginal,
            total_desconto=req.totalDesconto,
            total_juros=req.totalJuros,
            total_pago=req.totalPago,
            notas=req.notas,
            organization_id=current_org.get().id
        )
        db.add(novo_recibo)
        db.commit()
        db.refresh(novo_recibo)
        return {"status": "success", "id": novo_recibo.id}
    finally:
        db.close()

@router.get("/api/recibos")
def listar_recibos(current_user: models.User = Depends(get_current_user_and_set_org)):
    current_org.set(current_user.organization)
    db = SessionLocal()
    try:
        recibos = db.query(models.PaymentReceipt).filter(models.PaymentReceipt.organization_id == current_org.get().id).order_by(models.PaymentReceipt.id.desc()).all()
        return [
            {
                "id": r.id,
                "cliente": r.cliente,
                "banco": r.banco,
                "data_pagamento": r.data_pagamento,
                "totalOriginal": r.total_original,
                "totalDesconto": r.total_desconto,
                "totalJuros": r.total_juros,
                "totalPago": r.total_pago,
                "notas": r.notas,
                "created_at": r.created_at.strftime("%d/%m/%Y %H:%M:%S")
            }
            for r in recibos
        ]
    finally:
        db.close()

@router.delete("/api/recibos/{id}")
def deletar_recibo(id: int, current_user: models.User = Depends(get_current_user_and_set_org)):
    current_org.set(current_user.organization)
    db = SessionLocal()
    try:
        recibo = db.query(models.PaymentReceipt).filter(models.PaymentReceipt.id == id, models.PaymentReceipt.organization_id == current_org.get().id).first()
        if not recibo:
            return JSONResponse(status_code=404, content={"detail": "Recibo não encontrado"})
        db.delete(recibo)
        db.commit()
        return {"status": "success"}
    finally:
        db.close()

def bg_desfazer_baixa(task_id: str, recibo_id: int, org_id: int):
    try:
        db = SessionLocal()
        org = db.query(models.Organization).filter(models.Organization.id == org_id).first()
        current_org.set(org)

        recibo = db.query(models.PaymentReceipt).filter(models.PaymentReceipt.id == recibo_id, models.PaymentReceipt.organization_id == org_id).first()
        if not recibo:
            TaskManager.update_task(task_id, log="Recibo não encontrado", status="error")
            db.close()
            return
            
        url = "https://app.omie.com.br/api/v1/financas/contareceber/"
        erros = []
        desfeitas_sucesso = []
        
        TaskManager.update_task(task_id, progress=5.0, log="Iniciando cancelamento das baixas no Omie...")
        
        total_items = len(recibo.notas)
        for i, nota in enumerate(recibo.notas):
            t = TaskManager.get_task(task_id)
            if t and t.get("status") == "canceled":
                TaskManager.update_task(task_id, log="Cancelamento solicitado pelo usuário. Revertendo operações (re-baixando)...")
                
                # Fetch dictionary to find account id from bank name
                dict_contas = extrair_dicionario_contas_correntes()
                id_conta = 0
                for k, v in dict_contas.items():
                    if v == recibo.banco:
                        id_conta = k
                        break
                        
                rollback_erros = []
                for baixa_reverter in desfeitas_sucesso:
                    payload_rebaixar = {
                        "call": "LancarRecebimento",
                        "app_key": current_org.get().omie_app_key,
                        "app_secret": current_org.get().omie_app_secret,
                        "param": [
                            {
                                "codigo_lancamento": baixa_reverter["codigo_lancamento"],
                                "codigo_conta_corrente": int(id_conta),
                                "valor": baixa_reverter["valor"],
                                "desconto": baixa_reverter.get("desconto", 0),
                                "juros": baixa_reverter.get("juros", 0),
                                "data": recibo.data_pagamento,
                                "observacao": "Baixa restaurada pós-interrupção via GabaritoBI",
                            }
                        ]
                    }
                    try:
                        res_rebaixar = requests.post(url, json=payload_rebaixar, headers={"Content-Type": "application/json"}).json()
                        if "faultstring" in res_rebaixar:
                            rollback_erros.append(f"Erro ao re-baixar {baixa_reverter['codigo_lancamento']}: {res_rebaixar['faultstring']}")
                    except Exception as e:
                        rollback_erros.append(f"Erro ao re-baixar {baixa_reverter['codigo_lancamento']}: {str(e)}")
                    time.sleep(0.3)
                    
                if rollback_erros:
                    TaskManager.update_task(task_id, log="Rollback com erros: " + " | ".join(rollback_erros), status="error")
                else:
                    TaskManager.update_task(task_id, log="Baixas restauradas com sucesso. Operação abortada.", status="error")
                db.close()
                return

            codigo_baixa = nota.get("codigo_baixa")
            codigo_lancamento = nota.get("codigo_lancamento")
            if not codigo_baixa:
                continue

            time.sleep(0.3)
            payload = {
                "call": "CancelarRecebimento",
                "app_key": current_org.get().omie_app_key,
                "app_secret": current_org.get().omie_app_secret,
                "param": [{"codigo_baixa": codigo_baixa}]
            }
            try:
                res = requests.post(url, json=payload, headers={"Content-Type": "application/json"}).json()
                if "faultstring" in res:
                    erros.append(f"Erro na baixa {codigo_baixa}: {res['faultstring']}")
                else:
                    desfeitas_sucesso.append(nota)
            except Exception as e:
                erros.append(f"Erro na comunicação: {str(e)}")
                
            progress = 5.0 + ((i + 1) / total_items) * 80.0
            TaskManager.update_task(task_id, progress=progress, log=f"Processado {i+1} de {total_items} cancelamentos...")

        if desfeitas_sucesso:
            TaskManager.update_task(task_id, progress=90.0, log="Atualizando cache local...")
            try:
                cache_key = "contas_receber_abertas_global"
                snap = db.query(models.SyncSnapshot).filter(
                    models.SyncSnapshot.cache_key == cache_key, 
                    models.SyncSnapshot.organization_id == current_org.get().id
                ).first()

                if snap and isinstance(snap.dados, list):
                    dados_atualizados = list(snap.dados)
                    for desf in desfeitas_sucesso:
                        for c in dados_atualizados:
                            if c.get("codigo_lancamento_omie") == desf["codigo_lancamento"]:
                                v_pag = float(c.get("valor_pag") or 0.0)
                                val_cancelado = float(desf.get("valor") or 0.0)
                                c["valor_pag"] = max(0.0, v_pag - val_cancelado)
                                break
                    
                    snap.dados = dados_atualizados
                    from sqlalchemy.orm.attributes import flag_modified
                    flag_modified(snap, "dados")
                    db.commit()
            except Exception as e:
                print("Erro ao atualizar cache local (desfazer):", e)
                
        if erros:
            # If partially completed, don't delete receipt, but let user know
            TaskManager.update_task(task_id, log="Concluído com erros: " + " | ".join(erros), status="error")
        else:
            db.delete(recibo)
            db.commit()
            TaskManager.update_task(
                task_id, 
                progress=100.0, 
                log="Baixas desfeitas com sucesso e histórico removido!", 
                status="completed"
            )
            
    except Exception as e:
        import traceback
        traceback.print_exc()
        TaskManager.update_task(task_id, log=f"Erro fatal: {str(e)}", status="error")
    finally:
        db.close()

@router.post("/api/recibos/{id}/desfazer")
def desfazer_baixa(id: int, current_user: models.User = Depends(get_current_user_and_set_org)):
    action_id = "desfazer_baixa"
    active_id = TaskManager.get_active_task_id(action_id)
    if active_id:
        return JSONResponse(status_code=409, content={"detail": "Já existe um processamento de cancelamento em andamento. Aguarde.", "task_id": active_id})

    task_id = TaskManager.create_task(action_id)
    TaskManager.update_task(task_id, progress=0.0, log="Aguardando na fila...")
    # asyncio run for enqueueing since desfazer_baixa is synchronous
    import asyncio
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(TaskQueue.enqueue(bg_desfazer_baixa, task_id, id, current_user.organization.id))
    except RuntimeError:
        asyncio.run(TaskQueue.enqueue(bg_desfazer_baixa, task_id, id, current_user.organization.id))
        
    return {"task_id": task_id, "message": "Iniciando cancelamento do recibo..."}
