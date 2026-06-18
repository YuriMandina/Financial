from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
import jwt
from datetime import timedelta
from typing import Optional
import models, auth, mailer
from database import get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])

class UserCreate(BaseModel):
    name: str
    email: str
    password: str
    password_confirm: str
    invite_token: Optional[str] = None

class UserLogin(BaseModel):
    email: str
    password: str

@router.post("/register")
def register_user(user: UserCreate, db: Session = Depends(get_db)):
    if user.password != user.password_confirm:
        raise HTTPException(status_code=400, detail="As senhas não coincidem")
        
    db_user = db.query(models.User).filter(models.User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email já cadastrado")

    # Se possui invite_token, criamos a conta imediatamente
    if user.invite_token:
        invite = db.query(models.Invitation).filter(
            models.Invitation.token == user.invite_token,
            models.Invitation.status == "PENDING"
        ).first()
        
        if not invite:
            raise HTTPException(status_code=400, detail="Convite inválido ou expirado.")
        if invite.email != user.email:
            raise HTTPException(status_code=400, detail="O email não corresponde ao convite.")

        hashed_password = auth.get_password_hash(user.password)
        new_user = models.User(name=user.name, email=user.email, password_hash=hashed_password, organization_id=invite.organization_id)
        db.add(new_user)
        
        invite.status = "ACCEPTED"
        db.commit()
        db.refresh(new_user)
        return {"message": "Conta criada e ativada com sucesso via convite", "user_id": new_user.id}

    # Registro orgânico: Stateless. Não insere no banco, envia token via e-mail.
    hashed_password = auth.get_password_hash(user.password)
    token_data = {
        "name": user.name,
        "email": user.email,
        "password_hash": hashed_password
    }
    
    # Gera um token válido por 24 horas
    verification_token = auth.create_access_token(data=token_data, expires_delta=timedelta(hours=24))
    link = f"http://localhost:5173/verify-email?token={verification_token}"
    
    # Busca o primeiro usuário (admin) para usar o email dele como remetente (fallback) caso BREVO_SENDER_EMAIL não esteja configurado
    admin_user = db.query(models.User).first()
    admin_email = admin_user.email if admin_user else "no-reply@financial-app.com"
    
    sucesso = mailer.enviar_email_confirmacao(user.email, link, admin_email)
    if not sucesso:
        raise HTTPException(status_code=500, detail="Falha ao enviar e-mail de confirmação.")

    return {"message": "Verifique seu e-mail para confirmar a criação da conta."}

class VerifyEmailPayload(BaseModel):
    token: str

@router.post("/verify-email")
def verify_email(payload: VerifyEmailPayload, db: Session = Depends(get_db)):
    try:
        data = jwt.decode(payload.token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        email = data.get("email")
        if not email:
            raise HTTPException(status_code=400, detail="Token inválido")
    except jwt.PyJWTError:
        raise HTTPException(status_code=400, detail="Token de verificação inválido ou expirado.")

    db_user = db.query(models.User).filter(models.User.email == email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Esta conta já foi confirmada e criada.")

    # Create a default organization for the new user
    new_org = models.Organization(name=f"Org {email}")
    db.add(new_org)
    db.commit()
    db.refresh(new_org)

    new_user = models.User(name=data.get("name"), email=email, password_hash=data.get("password_hash"), organization_id=new_org.id)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    access_token = auth.create_access_token(data={"sub": str(new_user.id)})
    return {"message": "Conta criada com sucesso", "access_token": access_token}

@router.post("/login")
def login_user(user: UserLogin, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.email == user.email).first()
    if not db_user or not auth.verify_password(user.password, db_user.password_hash):
        raise HTTPException(status_code=401, detail="Credenciais inválidas")
    
    if getattr(db_user, 'is_active', None) is False:
        raise HTTPException(status_code=401, detail="Esta conta foi inativada.")
    
    access_token = auth.create_access_token(data={"sub": str(db_user.id)})
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me")
def get_me(current_user: models.User = Depends(auth.get_current_user)):
    return {
        "id": current_user.id,
        "name": current_user.name,
        "email": current_user.email,
        "organization_id": current_user.organization_id,
        "organization_name": current_user.organization.name
    }
