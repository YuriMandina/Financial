import contextvars
from fastapi import Depends, HTTPException
from core import auth
import models.models as models

current_org = contextvars.ContextVar("current_org")

async def get_current_user_and_set_org(user: models.User = Depends(auth.get_current_user)):
    if not user.organization:
        raise HTTPException(status_code=400, detail="User has no organization")
    current_org.set(user.organization)
    return user
