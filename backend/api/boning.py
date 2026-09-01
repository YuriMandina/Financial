from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
import models.models as models
from core.database import get_db
from core.deps import get_current_user_and_set_org, current_org
from services import omie_products
from services.boning_engine import calculate_boning_process
from api.tasks import TaskManager, TaskQueue
from core.database import SessionLocal

router = APIRouter(prefix="/api/boning", tags=["boning"])

# --- [BLOCO: PYDANTIC SCHEMAS] ---
class CutInput(BaseModel):
    product_id: int
    actual_weight: float

class CarcassInput(BaseModel):
    weight: float
    cost_per_kg: float

class BoningRequest(BaseModel):
    mode: str # "MANUAL" or "TEMPLATE"
    template_id: Optional[int] = None
    carcass: CarcassInput
    cuts: Optional[List[CutInput]] = None

class CheckStocksRequest(BaseModel):
    date: str
    product_ids: List[int]

class FixStockItem(BaseModel):
    product_id: int
    local_id: int
    saldo_negativo: float
    unit_cost: float = 0.0

class FixStocksRequest(BaseModel):
    date: str
    items: List[FixStockItem]

class ExportItemConfig(BaseModel):
    product_id: int
    local_id: int

class ExportCmcRequest(BaseModel):
    date: str
    items: List[ExportItemConfig]

class TemplateItemSchema(BaseModel):
    product_id: int
    expected_yield_percentage: float

class SampleItemSchema(BaseModel):
    product_id: int
    weight: float
    percentage: float

class SampleSchema(BaseModel):
    date: str
    carcass_weight: float
    is_active: bool
    items: List[SampleItemSchema]

class TemplateSchema(BaseModel):
    name: str
    family_id: int
    items: List[TemplateItemSchema]
    samples: Optional[List[SampleSchema]] = None

# --- [BLOCO: OMIE SYNC & CONFIG] ---
def bg_sync_omie(task_id: str, org_id: int):
    try:
        db = SessionLocal()
        TaskManager.update_task(task_id, progress=10.0, log="Iniciando sincronização com Omie...")
        inseridos = omie_products.sincronizar_produtos_e_familias(db, org_id, task_id=task_id)
        
        msg = f"{inseridos} produtos sincronizados com sucesso." if inseridos > 0 else "Sincronização concluída, mas nenhum produto novo encontrado."
        TaskManager.update_task(task_id, progress=100.0, log=msg, status="completed", result={"inseridos": inseridos})
    except Exception as e:
        import traceback
        TaskManager.update_task(task_id, log=f"Erro: {str(e)}", status="error")
    finally:
        db.close()

@router.post("/sync-omie")
async def sync_omie(
    user: models.User = Depends(get_current_user_and_set_org)
):
    action_id = "sync_omie"
    active_id = TaskManager.get_active_task_id(action_id)
    if active_id:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=409, content={"detail": "Esta ação já está em andamento. Cancele-a antes de iniciar uma nova.", "task_id": active_id})
    task_id = TaskManager.create_task(action_id)
    org_id = current_org.get().id
    await TaskQueue.enqueue(bg_sync_omie, task_id, org_id)
    return {"task_id": task_id, "message": "Sincronização iniciada na fila."}

@router.get("/products")
async def get_products(
    user: models.User = Depends(get_current_user_and_set_org),
    db: Session = Depends(get_db)
):
    prods = db.query(models.BoningProduct).filter(models.BoningProduct.organization_id == current_org.get().id).order_by(models.BoningProduct.name).all()
    return {"products": [{
        "id": p.id, 
        "name": p.name, 
        "unit_price": p.unit_price, 
        "is_standard_cut": p.is_standard_cut,
        "family_id": p.family_id,
        "family_name": p.family.name if p.family else "Sem Família"
    } for p in prods]}

@router.put("/products/{product_id}/toggle-standard")
async def toggle_standard_cut(
    product_id: int,
    user: models.User = Depends(get_current_user_and_set_org),
    db: Session = Depends(get_db)
):
    prod = db.query(models.BoningProduct).filter_by(id=product_id, organization_id=current_org.get().id).first()
    if not prod:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    prod.is_standard_cut = not prod.is_standard_cut
    db.commit()
    return {"message": "Atualizado", "is_standard_cut": prod.is_standard_cut}

@router.get("/families")
async def get_families(
    user: models.User = Depends(get_current_user_and_set_org),
    db: Session = Depends(get_db)
):
    fams = db.query(models.BoningFamily).filter(models.BoningFamily.organization_id == current_org.get().id).order_by(models.BoningFamily.name).all()
    return {"families": [{"id": f.id, "name": f.name, "is_active_for_boning": f.is_active_for_boning} for f in fams]}

@router.put("/families/{family_id}/toggle-active")
async def toggle_family_active(
    family_id: int,
    user: models.User = Depends(get_current_user_and_set_org),
    db: Session = Depends(get_db)
):
    fam = db.query(models.BoningFamily).filter(
        models.BoningFamily.id == family_id,
        models.BoningFamily.organization_id == current_org.get().id
    ).first()
    if not fam:
        raise HTTPException(status_code=404, detail="Família não encontrada")
    
    fam.is_active_for_boning = not fam.is_active_for_boning
    db.commit()
    return {"message": "Status atualizado", "is_active_for_boning": fam.is_active_for_boning}

# --- [BLOCO: TEMPLATES CRUD] ---
@router.post("/templates")
async def create_template(
    schema: TemplateSchema,
    user: models.User = Depends(get_current_user_and_set_org),
    db: Session = Depends(get_db)
):
    org_id = current_org.get().id
    total_yield = sum(item.expected_yield_percentage for item in schema.items)
    if total_yield > 100.0:
        raise HTTPException(status_code=400, detail="O somatório dos rendimentos não pode ultrapassar 100%")
    
    template = models.BoningTemplate(name=schema.name, organization_id=org_id, family_id=schema.family_id)
    db.add(template)
    db.commit()
    db.refresh(template)
    
    for item in schema.items:
        ti = models.BoningTemplateItem(
            template_id=template.id,
            product_id=item.product_id,
            expected_yield_percentage=item.expected_yield_percentage
        )
        db.add(ti)
        
    if schema.samples:
        for s in schema.samples:
            db_sample = models.BoningTemplateSample(
                template_id=template.id,
                date=s.date,
                carcass_weight=s.carcass_weight,
                is_active=s.is_active
            )
            db.add(db_sample)
            db.commit()
            db.refresh(db_sample)
            for s_item in s.items:
                db_s_item = models.BoningTemplateSampleItem(
                    sample_id=db_sample.id,
                    product_id=s_item.product_id,
                    weight=s_item.weight,
                    percentage=s_item.percentage
                )
                db.add(db_s_item)
                
    db.commit()
    return {"message": "Template criado", "id": template.id}

@router.put("/templates/{template_id}")
async def update_template(
    template_id: int,
    schema: TemplateSchema,
    user: models.User = Depends(get_current_user_and_set_org),
    db: Session = Depends(get_db)
):
    org_id = current_org.get().id
    template = db.query(models.BoningTemplate).filter_by(id=template_id, organization_id=org_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template não encontrado")
        
    total_yield = sum(item.expected_yield_percentage for item in schema.items)
    if total_yield > 100.0:
        raise HTTPException(status_code=400, detail="O somatório dos rendimentos não pode ultrapassar 100%")
        
    template.name = schema.name
    template.family_id = schema.family_id
    
    # Exclui itens antigos e recria
    db.query(models.BoningTemplateItem).filter_by(template_id=template_id).delete()
    for item in schema.items:
        ti = models.BoningTemplateItem(
            template_id=template.id,
            product_id=item.product_id,
            expected_yield_percentage=item.expected_yield_percentage
        )
        db.add(ti)
        
    # Exclui samples antigas e recria
    if schema.samples is not None:
        old_samples = db.query(models.BoningTemplateSample).filter_by(template_id=template_id).all()
        old_sample_ids = [s.id for s in old_samples]
        if old_sample_ids:
            db.query(models.BoningTemplateSampleItem).filter(models.BoningTemplateSampleItem.sample_id.in_(old_sample_ids)).delete(synchronize_session=False)
        db.query(models.BoningTemplateSample).filter_by(template_id=template_id).delete(synchronize_session=False)
        for s in schema.samples:
            db_sample = models.BoningTemplateSample(
                template_id=template.id,
                date=s.date,
                carcass_weight=s.carcass_weight,
                is_active=s.is_active
            )
            db.add(db_sample)
            db.flush()
            for s_item in s.items:
                db_s_item = models.BoningTemplateSampleItem(
                    sample_id=db_sample.id,
                    product_id=s_item.product_id,
                    weight=s_item.weight,
                    percentage=s_item.percentage
                )
                db.add(db_s_item)

    db.commit()
    return {"message": "Template atualizado com sucesso"}

@router.get("/templates")
async def get_templates(
    user: models.User = Depends(get_current_user_and_set_org),
    db: Session = Depends(get_db)
):
    templates = db.query(models.BoningTemplate).filter_by(organization_id=current_org.get().id).all()
    result = []
    for t in templates:
        items = [{"product_id": i.product_id, "name": i.product.name, "expected_yield_percentage": i.expected_yield_percentage} for i in t.items]
        samples = []
        for s in t.samples:
            s_items = [{"product_id": si.product_id, "weight": si.weight, "percentage": si.percentage} for si in s.items]
            samples.append({
                "id": s.id,
                "date": s.date,
                "carcass_weight": s.carcass_weight,
                "is_active": s.is_active,
                "items": s_items
            })
        result.append({
            "id": t.id, 
            "name": t.name, 
            "family_id": t.family_id,
            "family_name": t.family.name if t.family else "Sem Família",
            "items": items,
            "samples": samples
        })
    return {"templates": result}

@router.delete("/templates/{template_id}")
async def delete_template(
    template_id: int,
    user: models.User = Depends(get_current_user_and_set_org),
    db: Session = Depends(get_db)
):
    template = db.query(models.BoningTemplate).filter_by(id=template_id, organization_id=current_org.get().id).first()
    if not template:
        raise HTTPException(404, "Não encontrado")
    db.delete(template)
    db.commit()
    return {"message": "Deletado"}

# --- [BLOCO: MOTOR DE CÁLCULO & EXPORTAÇÃO] ---
@router.post("/calculate-apportionment")
async def calculate_apportionment(
    req: BoningRequest,
    user: models.User = Depends(get_current_user_and_set_org),
    db: Session = Depends(get_db)
):
    org_id = current_org.get().id
    result = calculate_boning_process(req, db, org_id)
    return result

def bg_export_cmc(task_id: str, process_id: int, req_date: str, local_id_map: dict, org_id: int, pending_product_ids: list = None):
    db = SessionLocal()
    try:
        process = db.query(models.BoningProcess).filter_by(id=process_id, organization_id=org_id).first()
        if not process:
            TaskManager.update_task(task_id, log="Processo não encontrado.", status="error")
            return
            
        items_to_process = process.items
        if pending_product_ids is not None:
            items_to_process = [i for i in process.items if i.product_id in pending_product_ids]
            
        total_items = len(items_to_process)
        TaskManager.update_task(task_id, progress=5.0, log=f"Enfileirando exportação de {total_items} itens...")
        
        for idx, item in enumerate(items_to_process):
            omie_prod_id = item.product.omie_id
            nome_produto = item.product.name
            data_processo = req_date if req_date else process.created_at.strftime("%Y-%m-%d")
            local_id = local_id_map.get(omie_prod_id, 0)
            
            payload = {
                "produto_id": omie_prod_id,
                "nome_produto": nome_produto,
                "quantidade": item.actual_weight,
                "custo_unitario": item.unit_cost,
                "data_processo": data_processo,
                "local_id": local_id
            }
            
            job = models.OmieJobQueue(
                organization_id=org_id,
                task_id=task_id,
                action_type="EXPORT_CMC",
                payload=payload
            )
            db.add(job)
            
        db.commit()
        TaskManager.update_task(task_id, progress=10.0, log=f"{total_items} itens inseridos na fila do Worker. Aguardando processamento...")
        
    except Exception as e:
        import traceback
        TaskManager.update_task(task_id, log=f"Erro ao enfileirar: {str(e)}", status="error")
    finally:
        db.close()

@router.post("/process/{process_id}/export-cmc")
async def export_cmc(
    process_id: int,
    req: ExportCmcRequest,
    user: models.User = Depends(get_current_user_and_set_org)
):
    action_id = f"export_cmc_{process_id}"
    active_id = TaskManager.get_active_task_id(action_id)
    if active_id:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=409, content={"detail": "Esta ação já está em andamento.", "task_id": active_id})
        
    org_id = current_org.get().id
    local_id_map = {item.product_id: item.local_id for item in req.items}
    task_id = TaskManager.create_task(action_id)
    
    await TaskQueue.enqueue(bg_export_cmc, task_id, process_id, req.date, local_id_map, org_id)
    return {"task_id": task_id, "message": "Exportação iniciada na fila."}

@router.post("/process/{process_id}/reprocess-export-cmc")
async def reprocess_export_cmc(
    process_id: int,
    req: ExportCmcRequest,
    user: models.User = Depends(get_current_user_and_set_org)
):
    action_id = f"reprocess_cmc_{process_id}"
    active_id = TaskManager.get_active_task_id(action_id)
    if active_id:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=409, content={"detail": "Esta ação já está em andamento.", "task_id": active_id})
        
    org_id = current_org.get().id
    local_id_map = {item.product_id: item.local_id for item in req.items}
    pending_product_ids = [item.product_id for item in req.items]
    task_id = TaskManager.create_task(action_id)
    
    await TaskQueue.enqueue(bg_export_cmc, task_id, process_id, req.date, local_id_map, org_id, pending_product_ids)
    return {"task_id": task_id, "message": "Reprocessamento iniciado na fila."}

@router.post("/check-stocks")
async def check_stocks(
    req: CheckStocksRequest,
    user: models.User = Depends(get_current_user_and_set_org),
    db: Session = Depends(get_db)
):
    import asyncio
    from datetime import datetime, timedelta
    results = {}
    try:
        data_d0 = datetime.strptime(req.date, "%Y-%m-%d")
        data_d1 = (data_d0 - timedelta(days=1)).strftime("%Y-%m-%d")
        
        for pid in req.product_ids:
            product = db.query(models.BoningProduct).filter_by(id=pid, organization_id=current_org.get().id).first()
            if product and product.omie_id:
                try:
                    saldo, local_id = await asyncio.to_thread(omie_products.consultar_posicao_estoque, product.omie_id, data_d1)
                    results[pid] = {"saldo": saldo, "local_id": local_id, "status": "OK"}
                except Exception as e:
                    results[pid] = {"saldo": 0, "local_id": 0, "status": "ERROR", "error": str(e)}
            else:
                results[pid] = {"saldo": 0, "local_id": 0, "status": "NO_OMIE_ID"}
            await asyncio.sleep(0.3)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"stocks": results}

def bg_fix_negative_stocks(task_id: str, req_items: list, req_date: str, org_id: int):
    db = SessionLocal()
    try:
        total_items = len(req_items)
        TaskManager.update_task(task_id, progress=5.0, log=f"Enfileirando correção de {total_items} estoques negativos...")
        
        for item in req_items:
            product = db.query(models.BoningProduct).filter_by(id=item.product_id, organization_id=org_id).first()
            if not product or not product.omie_id:
                continue
                
            payload = {
                "produto_id": product.omie_id,
                "nome_produto": product.name,
                "local_id": item.local_id,
                "data": req_date,
                "saldo_negativo": item.saldo_negativo,
                "unit_cost": max(getattr(item, 'unit_cost', 0) or 0.0, 0.01)
            }
            job = models.OmieJobQueue(
                organization_id=org_id,
                task_id=task_id,
                action_type="ZERO_STOCK",
                payload=payload
            )
            db.add(job)
            
        db.commit()
        TaskManager.update_task(task_id, progress=10.0, log=f"{total_items} itens inseridos na fila do Worker. Aguardando processamento...")
        
    except Exception as e:
        import traceback
        TaskManager.update_task(task_id, log=f"Erro ao enfileirar: {str(e)}", status="error")
    finally:
        db.close()

@router.post("/fix-negative-stocks")
async def fix_negative_stocks(
    req: FixStocksRequest,
    user: models.User = Depends(get_current_user_and_set_org)
):
    action_id = "fix_negative_stocks"
    active_id = TaskManager.get_active_task_id(action_id)
    if active_id:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=409, content={"detail": "Esta ação já está em andamento.", "task_id": active_id})
        
    org_id = current_org.get().id
    task_id = TaskManager.create_task(action_id)
    await TaskQueue.enqueue(bg_fix_negative_stocks, task_id, req.items, req.date, org_id)
    return {"task_id": task_id, "message": "Correção de estoques iniciada na fila."}

@router.post("/reprocess-fix-negative-stocks")
async def reprocess_fix_negative_stocks(
    req: FixStocksRequest,
    user: models.User = Depends(get_current_user_and_set_org)
):
    action_id = "reprocess_fix_negative_stocks"
    active_id = TaskManager.get_active_task_id(action_id)
    if active_id:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=409, content={"detail": "Esta ação já está em andamento.", "task_id": active_id})
        
    org_id = current_org.get().id
    task_id = TaskManager.create_task(action_id)
    await TaskQueue.enqueue(bg_fix_negative_stocks, task_id, req.items, req.date, org_id)
    return {"task_id": task_id, "message": "Reprocessamento iniciado na fila."}

@router.get("/snapshots/historico")
async def get_historico_snapshots(
    user: models.User = Depends(get_current_user_and_set_org),
    db: Session = Depends(get_db)
):
    snaps = db.query(models.SyncSnapshot).filter(
        models.SyncSnapshot.organization_id == current_org.get().id,
        models.SyncSnapshot.tipo_relatorio.in_(["RATEIO_CUSTEIO", "ESTOQUES_NEGATIVOS"])
    ).order_by(models.SyncSnapshot.created_at.desc()).all()
    
    return [{
        "id": s.id,
        "tipo": "Lançamento de Rateio" if s.tipo_relatorio == "RATEIO_CUSTEIO" else "Correção de Estoque Negativo",
        "data_referencia": s.data_referencia,
        "created_at": s.created_at.strftime("%d/%m/%Y %H:%M:%S") if s.created_at else "",
        "quantidade_lancamentos": len(s.dados.get("ajustes_ids", [])) if isinstance(s.dados, dict) else (len(s.dados) if isinstance(s.dados, list) else 0)
    } for s in snaps]

def bg_revert_snapshot(task_id: str, snapshot_id: int, org_id: int):
    db = SessionLocal()
    try:
        snap = db.query(models.SyncSnapshot).filter_by(id=snapshot_id, organization_id=org_id).first()
        if not snap:
            TaskManager.update_task(task_id, log="Snapshot não encontrado.", status="error")
            return
            
        ajustes_ids = snap.dados.get("ajustes_ids", []) if isinstance(snap.dados, dict) else (snap.dados if isinstance(snap.dados, list) else [])
        detalhes = snap.dados.get("detalhes", []) if isinstance(snap.dados, dict) else []
        mapa_nomes = {d.get("id_ajuste"): d.get("nome_produto") for d in detalhes}

        total_items = len(ajustes_ids)
        TaskManager.update_task(task_id, progress=5.0, log=f"Enfileirando reversão de {total_items} lançamentos...")
        
        for aid in ajustes_ids:
            nome = mapa_nomes.get(aid, f"Ajuste {aid}")
            job = models.OmieJobQueue(
                organization_id=org_id,
                task_id=task_id,
                action_type="REVERT_ADJUST",
                payload={"id_ajuste": aid, "snapshot_id": snapshot_id, "nome_produto": nome}
            )
            db.add(job)
            
        db.commit()
        TaskManager.update_task(task_id, progress=10.0, log=f"{total_items} itens de exclusão inseridos na fila do Worker. Aguardando processamento...")
            
    except Exception as e:
        import traceback
        TaskManager.update_task(task_id, log=f"Erro ao enfileirar reversão: {str(e)}", status="error")
    finally:
        db.close()

@router.delete("/revert-snapshot/{snapshot_id}")
async def revert_snapshot(
    snapshot_id: int,
    user: models.User = Depends(get_current_user_and_set_org)
):
    action_id = f"revert_{snapshot_id}"
    active_id = TaskManager.get_active_task_id(action_id)
    if active_id:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=409, content={"detail": "Esta ação já está em andamento. Cancele-a antes de iniciar uma nova.", "task_id": active_id})
        
    org_id = current_org.get().id
    task_id = TaskManager.create_task(action_id)
    await TaskQueue.enqueue(bg_revert_snapshot, task_id, snapshot_id, org_id)
    return {"task_id": task_id, "message": "Reversão iniciada na fila."}
