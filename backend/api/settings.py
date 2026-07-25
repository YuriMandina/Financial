from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
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
