from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from database import get_db
import models
from deps import get_current_user_and_set_org, current_org
from services import omie_products
from pydantic import BaseModel

router = APIRouter(prefix="/api/produtos", tags=["produtos"])

class CmcUpdateRequest(BaseModel):
    produtos: List[Dict[str, Any]]
    # Each item in `produtos` should have: produto_id, codigo_produto, descricao, custo_antigo, custo_novo, quantidade_utilizada, valor_mercado_unitario

@router.get("/familias")
async def get_familias(user: models.User = Depends(get_current_user_and_set_org)):
    familias = omie_products.listar_familias()
    return {"familias": familias}

@router.get("/")
async def get_produtos(familia_id: str = None, user: models.User = Depends(get_current_user_and_set_org)):
    if not familia_id:
        raise HTTPException(status_code=400, detail="familia_id é obrigatório")
    produtos = omie_products.listar_produtos_por_familia(familia_id)
    return {"produtos": produtos}

@router.post("/custeio")
async def salvar_simulacao_custeio(
    request: CmcUpdateRequest, 
    user: models.User = Depends(get_current_user_and_set_org),
    db: Session = Depends(get_db)
):
    # Opção B: Salvar a atualização localmente primeiro. Status "PENDING"
    historicos = []
    for p in request.produtos:
        hist = models.CmcUpdateHistory(
            produto_id=p["produto_id"],
            codigo_produto=p.get("codigo_produto", ""),
            descricao=p["descricao"],
            custo_antigo=p["custo_antigo"],
            custo_novo=p["custo_novo"],
            quantidade_utilizada=p.get("quantidade_utilizada", 0.0),
            valor_mercado_unitario=p.get("valor_mercado_unitario", 0.0),
            organization_id=current_org.get().id,
            status="PENDING"
        )
        db.add(hist)
        historicos.append(hist)
    
    db.commit()
    return {"message": "Simulação salva localmente com sucesso", "count": len(historicos)}

@router.post("/custeio/{hist_id}/exportar")
async def exportar_custeio_omie(
    hist_id: int, 
    user: models.User = Depends(get_current_user_and_set_org),
    db: Session = Depends(get_db)
):
    hist = db.query(models.CmcUpdateHistory).filter(
        models.CmcUpdateHistory.id == hist_id, 
        models.CmcUpdateHistory.organization_id == current_org.get().id
    ).first()

    if not hist:
        raise HTTPException(status_code=404, detail="Histórico não encontrado")
    
    if hist.status == "EXPORTED":
        raise HTTPException(status_code=400, detail="Já foi exportado")

    sucesso, msg = omie_products.atualizar_custo_produto(hist.produto_id, hist.custo_novo)
    
    if sucesso:
        hist.status = "EXPORTED"
        db.commit()
        return {"message": "Exportado com sucesso"}
    else:
        raise HTTPException(status_code=500, detail=f"Erro ao exportar: {msg}")

@router.post("/custeio/{hist_id}/reverter")
async def reverter_custeio_omie(
    hist_id: int, 
    user: models.User = Depends(get_current_user_and_set_org),
    db: Session = Depends(get_db)
):
    hist = db.query(models.CmcUpdateHistory).filter(
        models.CmcUpdateHistory.id == hist_id, 
        models.CmcUpdateHistory.organization_id == current_org.get().id
    ).first()

    if not hist:
        raise HTTPException(status_code=404, detail="Histórico não encontrado")
    
    if hist.status != "EXPORTED":
        raise HTTPException(status_code=400, detail="Apenas itens exportados podem ser revertidos")

    # Atualiza o produto com o custo_antigo
    sucesso, msg = omie_products.atualizar_custo_produto(hist.produto_id, hist.custo_antigo)
    
    if sucesso:
        hist.status = "REVERTED"
        db.commit()
        return {"message": "Revertido com sucesso"}
    else:
        raise HTTPException(status_code=500, detail=f"Erro ao reverter: {msg}")

@router.get("/custeio/historico")
async def get_historico(
    user: models.User = Depends(get_current_user_and_set_org),
    db: Session = Depends(get_db)
):
    historicos = db.query(models.CmcUpdateHistory).filter(
        models.CmcUpdateHistory.organization_id == current_org.get().id
    ).order_by(models.CmcUpdateHistory.created_at.desc()).limit(100).all()
    
    return {"historico": historicos}
