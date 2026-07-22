from pydantic import BaseModel
from typing import List
from sqlalchemy.orm import Session
import models.models as models
from fastapi import HTTPException

class ProcessItemResult(BaseModel):
    product_id: int
    product_name: str
    actual_weight: float
    unit_price: float
    vpl: float
    participation_percentage: float
    allocated_cost: float
    unit_cost: float

class CalculationResult(BaseModel):
    process_id: int
    total_carcass_weight: float
    total_carcass_cost: float
    total_vpl: float
    total_allocated_cost: float
    loss_weight: float
    items: List[ProcessItemResult]

def calculate_boning_process(req, db: Session, org_id: int) -> dict:
    total_cost = req.carcass.weight * req.carcass.cost_per_kg
    
    cuts = []
    if req.mode == "TEMPLATE":
        if not req.template_id:
            raise HTTPException(400, "template_id required for TEMPLATE mode")
        template = db.query(models.BoningTemplate).filter_by(id=req.template_id, organization_id=org_id).first()
        if not template:
            raise HTTPException(404, "Template not found")
        for item in template.items:
            weight = req.carcass.weight * (item.expected_yield_percentage / 100.0)
            cuts.append({"product_id": item.product_id, "weight": weight})
    else:
        if not req.cuts:
            raise HTTPException(400, "cuts required for MANUAL mode")
        for item in req.cuts:
            cuts.append({"product_id": item.product_id, "weight": item.actual_weight})
            
    # Passo 1: Calcular VPL_i
    vpl_list = []
    total_vpl = 0.0
    for cut in cuts:
        prod = db.query(models.BoningProduct).filter_by(id=cut["product_id"], organization_id=org_id).first()
        if not prod:
            raise HTTPException(404, f"Produto {cut['product_id']} não encontrado")
        vpl = cut["weight"] * prod.unit_price
        total_vpl += vpl
        vpl_list.append({
            "product_id": prod.id,
            "product_name": prod.name,
            "weight": cut["weight"],
            "unit_price": prod.unit_price,
            "vpl": vpl
        })
        
    if total_vpl == 0:
        raise HTTPException(400, "VPL Total é zero, não é possível ratear.")
        
    # Salvar processo no banco
    process = models.BoningProcess(
        organization_id=org_id,
        carcass_weight=req.carcass.weight,
        carcass_cost_per_kg=req.carcass.cost_per_kg,
        total_cost=total_cost,
        mode=req.mode,
        template_id=req.template_id
    )
    db.add(process)
    db.commit()
    db.refresh(process)
    
    items_result = []
    total_allocated = 0.0
    total_weight_cuts = 0.0
    
    for data in vpl_list:
        # Passo 3: Participacao
        participacao = data["vpl"] / total_vpl
        # Passo 4: Custo Rateado
        allocated_cost = total_cost * participacao
        # Passo 5: Custo Unitario
        unit_cost = allocated_cost / data["weight"] if data["weight"] > 0 else 0.0
        
        pi = models.BoningProcessItem(
            process_id=process.id,
            product_id=data["product_id"],
            actual_weight=data["weight"],
            unit_price=data["unit_price"],
            vpl=data["vpl"],
            participation_percentage=participacao * 100,
            allocated_cost=allocated_cost,
            unit_cost=unit_cost
        )
        db.add(pi)
        
        items_result.append(ProcessItemResult(
            product_id=data["product_id"],
            product_name=data["product_name"],
            actual_weight=data["weight"],
            unit_price=data["unit_price"],
            vpl=data["vpl"],
            participation_percentage=participacao * 100,
            allocated_cost=allocated_cost,
            unit_cost=unit_cost
        ))
        
        total_allocated += allocated_cost
        total_weight_cuts += data["weight"]
        
    db.commit()
    
    # A perda não recebe custo
    loss_weight = req.carcass.weight - total_weight_cuts
    
    res = CalculationResult(
        process_id=process.id,
        total_carcass_weight=req.carcass.weight,
        total_carcass_cost=total_cost,
        total_vpl=total_vpl,
        total_allocated_cost=total_allocated,
        loss_weight=loss_weight,
        items=items_result
    )
    
    return res.model_dump()
