from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import models.models as models
from core import auth
from core.database import get_db

router = APIRouter(prefix="/api/settings", tags=["settings"])

class OmieKeys(BaseModel):
    app_key: str
    app_secret: str

@router.get("/omie")
def get_omie_keys(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    return {
        "app_key": current_user.organization.omie_app_key or "",
        "app_secret": current_user.organization.omie_app_secret or ""
    }

@router.post("/omie")
def save_omie_keys(keys: OmieKeys, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    current_user.organization.omie_app_key = keys.app_key
    current_user.organization.omie_app_secret = keys.app_secret
    db.commit()
    return {"message": "Chaves da Omie atualizadas com sucesso!"}

COMPANY_FIELDS = (
    "razao_social", "nome_fantasia", "cnpj", "inscricao_estadual", "endereco",
    "cidade", "uf", "cep", "telefone", "email", "responsavel",
)

class CompanyData(BaseModel):
    razao_social: Optional[str] = None
    nome_fantasia: Optional[str] = None
    cnpj: Optional[str] = None
    inscricao_estadual: Optional[str] = None
    endereco: Optional[str] = None
    cidade: Optional[str] = None
    uf: Optional[str] = None
    cep: Optional[str] = None
    telefone: Optional[str] = None
    email: Optional[str] = None
    responsavel: Optional[str] = None

@router.get("/company")
def get_company(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    data = current_user.organization.company or {}
    return {field: data.get(field, "") for field in COMPANY_FIELDS}

@router.post("/company")
def save_company(payload: CompanyData, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    current_user.organization.company = {
        field: value.strip() for field, value in payload.model_dump().items()
        if value is not None and value.strip()
    }
    # O nome da organização acompanha a empresa (era criado a partir do e-mail no cadastro)
    display_name = payload.nome_fantasia or payload.razao_social
    if display_name and display_name.strip():
        current_user.organization.name = display_name.strip()
    db.commit()
    return {"message": "Dados da empresa atualizados com sucesso!"}

class Preferences(BaseModel):
    session_timeout_minutes: int

@router.get("/preferences")
def get_preferences(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    return {
        "session_timeout_minutes": getattr(current_user.organization, "session_timeout_minutes", 120)
    }

@router.post("/preferences")
def save_preferences(prefs: Preferences, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    current_user.organization.session_timeout_minutes = prefs.session_timeout_minutes
    db.commit()
    return {"message": "Preferências atualizadas com sucesso!"}
