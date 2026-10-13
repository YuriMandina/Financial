import os
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import asyncio
from core.database import engine
from models.models import Base
from services.omie_worker import start_omie_queue_worker
from core.http_client import close_async_client

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
from api.rh import router as rh_router

# --- SETUP DA APLICAÇÃO ---
app = FastAPI(title="API GabaritoBI", version="5.0")

@app.on_event("startup")
async def startup_event():
    Base.metadata.create_all(bind=engine)
    
    # Auto-migrações seguras e idempotentes para colunas de RH adicionadas
    try:
        from sqlalchemy import text
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE rh_settings ADD COLUMN IF NOT EXISTS transport_ticket_unit_price FLOAT DEFAULT 4.70;"))
            conn.execute(text("ALTER TABLE rh_employees ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES rh_roles(id);"))
            conn.execute(text("ALTER TABLE rh_employees ADD COLUMN IF NOT EXISTS default_shift_id INTEGER REFERENCES rh_work_shifts(id);"))
            conn.execute(text("ALTER TABLE rh_employees ADD COLUMN IF NOT EXISTS default_daily_transport_tickets INTEGER DEFAULT 2;"))
            conn.execute(text("ALTER TABLE rh_schedule_days ADD COLUMN IF NOT EXISTS shift_id INTEGER REFERENCES rh_work_shifts(id);"))
            conn.execute(text("ALTER TABLE rh_schedule_days ADD COLUMN IF NOT EXISTS tickets_count INTEGER DEFAULT 2;"))
            conn.execute(text("ALTER TABLE rh_employees ADD COLUMN IF NOT EXISTS work_days_per_week INTEGER DEFAULT 6;"))
            conn.execute(text("ALTER TABLE rh_settings ADD COLUMN IF NOT EXISTS time_rounding_minutes INTEGER DEFAULT 0;"))
            conn.execute(text("ALTER TABLE rh_settings ADD COLUMN IF NOT EXISTS time_rounding_mode VARCHAR DEFAULT 'NEAREST';"))
            conn.execute(text("ALTER TABLE rh_settings ADD COLUMN IF NOT EXISTS clt_tolerance_enabled BOOLEAN DEFAULT TRUE;"))
            conn.execute(text("ALTER TABLE rh_settings ADD COLUMN IF NOT EXISTS hours_display_format VARCHAR DEFAULT 'HHMM';"))
    except Exception as e:
        print(f"Warning during auto-migration: {e}")

    asyncio.create_task(start_omie_queue_worker())

@app.on_event("shutdown")
async def shutdown_event():
    await close_async_client()

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
app.include_router(rh_router)

