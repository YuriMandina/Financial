import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
import models, auth, mailer
from database import get_db

router = APIRouter(prefix="/api/invites", tags=["invites"])

class InviteCreate(BaseModel):
    email: str

class InviteAccept(BaseModel):
    token: str

@router.post("")
def create_invite(invite: InviteCreate, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    if invite.email == current_user.email:
        raise HTTPException(status_code=400, detail="Você não pode convidar a si mesmo.")
        
    # Check if invite already exists and is pending
    existing_invite = db.query(models.Invitation).filter(
        models.Invitation.email == invite.email,
        models.Invitation.organization_id == current_user.organization_id,
        models.Invitation.status == "PENDING"
    ).first()
    
    if existing_invite:
        token = existing_invite.token
    else:
        token = str(uuid.uuid4())
        new_invite = models.Invitation(
            email=invite.email,
            token=token,
            organization_id=current_user.organization_id
        )
        db.add(new_invite)
        db.commit()

    # Link for frontend (assuming frontend runs on localhost:5173 for dev, we can pass it dynamically later, but hardcoding for now or using generic link)
    # The frontend needs to handle this token, perhaps /register?token=XYZ
    link = f"http://localhost:5173/accept-invite?token={token}"
    
    sucesso = mailer.enviar_email_convite(invite.email, link, current_user.email)
    if not sucesso:
        raise HTTPException(status_code=500, detail="Falha ao enviar email pelo Brevo.")

    return {"message": "Convite enviado com sucesso!"}

@router.get("/list")
def list_invites(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    invites = db.query(models.Invitation).filter(models.Invitation.organization_id == current_user.organization_id).all()
    users = db.query(models.User).filter(models.User.organization_id == current_user.organization_id).all()
    
    return {
        "members": [{"id": u.id, "email": u.email, "joined_at": u.created_at} for u in users],
        "pending_invites": [{"id": i.id, "email": i.email, "status": i.status, "created_at": i.created_at} for i in invites if i.status == "PENDING"]
    }

@router.post("/accept")
def accept_invite(payload: InviteAccept, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    # Accepts the invite for the logged in user
    invite = db.query(models.Invitation).filter(models.Invitation.token == payload.token, models.Invitation.status == "PENDING").first()
    if not invite:
        raise HTTPException(status_code=400, detail="Convite inválido ou já expirado/aceito.")
        
    if current_user.email != invite.email:
        raise HTTPException(status_code=400, detail="Este convite foi enviado para outro email.")

    # Convert the user to the inviting organization
    current_user.organization_id = invite.organization_id
    invite.status = "ACCEPTED"
    db.commit()

    return {"message": "Conta migrada para a nova organização com sucesso!"}
