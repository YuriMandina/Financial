from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
import models
from database import get_db
from deps import get_current_user_and_set_org, current_org
from services import omie_products
from services.boning_engine import calculate_boning_process

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
@router.post("/sync-omie")
async def sync_omie(
    background_tasks: BackgroundTasks,
    user: models.User = Depends(get_current_user_and_set_org),
    db: Session = Depends(get_db)
):
    try:
        org_id = current_org.get().id
        inseridos = omie_products.sincronizar_produtos_e_familias(db, org_id)
        
        if inseridos == 0:
            return {"status": "success", "message": "Sincronização concluída, mas nenhum produto encontrado."}
            
        return {"status": "success", "message": f"{inseridos} produtos sincronizados com sucesso."}
    except Exception as e:
        import traceback
        return {"status": "error", "detail": traceback.format_exc()}

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

@router.post("/process/{process_id}/export-cmc")
async def export_cmc(
    process_id: int,
    user: models.User = Depends(get_current_user_and_set_org),
    db: Session = Depends(get_db)
):
    process = db.query(models.BoningProcess).filter_by(id=process_id, organization_id=current_org.get().id).first()
    if not process:
        raise HTTPException(status_code=404, detail="Processo não encontrado")
    
    erros = []
    for item in process.items:
        omie_prod_id = item.product.omie_id
        novo_cmc = item.unit_cost
        sucesso, msg = omie_products.atualizar_custo_produto(omie_prod_id, novo_cmc)
        if not sucesso:
            erros.append(f"Produto {item.product.name}: {msg}")
            
    if erros:
        raise HTTPException(status_code=500, detail={"erros": erros})
        
    return {"message": "Exportado com sucesso para a Omie"}
