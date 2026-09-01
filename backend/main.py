import os
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import asyncio
from core.database import engine
from models.models import Base
from services.omie_worker import start_omie_queue_worker

# Import dos routers
from api.auth import router as auth_router
from api.invites import router as invites_router
from api.settings import router as settings_router
from api.products import router as products_router
from api.boning import router as boning_router

from api.snapshots import router as snapshots_router
from api.relatorios import router as relatorios_router
from api.recebimentos import router as recebimentos_router
from api.tasks import router as tasks_router

# --- SETUP DA APLICAÇÃO ---
app = FastAPI(title="API GabaritoBI", version="5.0")

@app.on_event("startup")
async def startup_event():
    Base.metadata.create_all(bind=engine)
    asyncio.create_task(start_omie_queue_worker())

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(invites_router)
app.include_router(settings_router)
app.include_router(products_router)
app.include_router(boning_router)

# Rotas extraídas
app.include_router(snapshots_router)
app.include_router(recebimentos_router)
app.include_router(relatorios_router)
app.include_router(tasks_router)
