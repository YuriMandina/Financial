from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from core.database import get_db
import models.models as models
from core.deps import get_current_user_and_set_org, current_org
from services import omie_products
from pydantic import BaseModel

router = APIRouter(prefix="/api/produtos", tags=["produtos"])



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


