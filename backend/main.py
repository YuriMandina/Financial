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
from api.rh_payroll import router as rh_payroll_router
from api.estoque_catalogo import router as estoque_catalogo_router
from api.estoque import router as estoque_router

# --- SETUP DA APLICAÇÃO ---
app = FastAPI(title="API Financial", version="5.0")

@app.on_event("startup")
async def startup_event():
    Base.metadata.create_all(bind=engine)
    
    # Auto-migrações seguras e idempotentes para colunas de RH adicionadas
    try:
        from sqlalchemy import text
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE rh_settings ADD COLUMN IF NOT EXISTS transport_ticket_unit_price FLOAT DEFAULT 4.70;"))
            conn.execute(text("ALTER TABLE rh_employees ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES rh_roles(id);"))
            conn.execute(text("ALTER TABLE rh_employees ADD COLUMN IF NOT EXISTS default_daily_transport_tickets INTEGER DEFAULT 2;"))
            conn.execute(text("ALTER TABLE rh_employees ADD COLUMN IF NOT EXISTS work_days_per_week INTEGER DEFAULT 6;"))
            conn.execute(text("ALTER TABLE rh_settings ADD COLUMN IF NOT EXISTS time_rounding_minutes INTEGER DEFAULT 0;"))
            conn.execute(text("ALTER TABLE rh_settings ADD COLUMN IF NOT EXISTS time_rounding_mode VARCHAR DEFAULT 'NEAREST';"))
            conn.execute(text("ALTER TABLE rh_settings ADD COLUMN IF NOT EXISTS clt_tolerance_enabled BOOLEAN DEFAULT TRUE;"))
            conn.execute(text("ALTER TABLE rh_settings ADD COLUMN IF NOT EXISTS hours_display_format VARCHAR DEFAULT 'HHMM';"))
            conn.execute(text("ALTER TABLE rh_employees ADD COLUMN IF NOT EXISTS base_salary FLOAT DEFAULT 0;"))
            conn.execute(text("ALTER TABLE rh_employees ADD COLUMN IF NOT EXISTS dependents INTEGER DEFAULT 0;"))
            conn.execute(text("ALTER TABLE rh_employees ADD COLUMN IF NOT EXISTS admission_date DATE;"))
            conn.execute(text("ALTER TABLE rh_settings ADD COLUMN IF NOT EXISTS absence_dsr_mode VARCHAR DEFAULT 'ONE';"))
            conn.execute(text("ALTER TABLE rh_roles ADD COLUMN IF NOT EXISTS base_salary FLOAT DEFAULT 0;"))
            conn.execute(text("ALTER TABLE rh_employees ADD COLUMN IF NOT EXISTS overtime_policy VARCHAR;"))
            conn.execute(text("ALTER TABLE rh_employees ADD COLUMN IF NOT EXISTS profile JSONB;"))
            conn.execute(text("ALTER TABLE rh_settings ADD COLUMN IF NOT EXISTS overtime_policy VARCHAR DEFAULT 'BANK';"))
            conn.execute(text("ALTER TABLE rh_settings ADD COLUMN IF NOT EXISTS overtime_rate FLOAT DEFAULT 50;"))
            conn.execute(text("ALTER TABLE rh_settings ADD COLUMN IF NOT EXISTS overtime_fixed_value FLOAT DEFAULT 0;"))
            conn.execute(text("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS company JSONB;"))
            conn.execute(text("ALTER TABLE rh_bank_hours ADD COLUMN IF NOT EXISTS adjustments_minutes INTEGER DEFAULT 0;"))
            # Conformidade CLT (docs/conformidade-clt v05): turnos substituídos pelo contrato de jornada
            conn.execute(text("ALTER TABLE rh_employees DROP COLUMN IF EXISTS default_shift_id;"))
            conn.execute(text("ALTER TABLE rh_employees DROP COLUMN IF EXISTS weekly_actual_hours;"))
            conn.execute(text("ALTER TABLE rh_work_days DROP COLUMN IF EXISTS shift_id;"))
            conn.execute(text("ALTER TABLE rh_work_days DROP COLUMN IF EXISTS shift;"))
            conn.execute(text("DROP TABLE IF EXISTS rh_schedule_days;"))
            conn.execute(text("DROP TABLE IF EXISTS rh_work_shifts;"))
            conn.execute(text("ALTER TABLE rh_work_days ADD COLUMN IF NOT EXISTS late_decision VARCHAR;"))
            conn.execute(text("ALTER TABLE rh_work_days ADD COLUMN IF NOT EXISTS is_late_record BOOLEAN DEFAULT FALSE;"))
            conn.execute(text("ALTER TABLE rh_work_days ADD COLUMN IF NOT EXISTS late_decision_note VARCHAR;"))
            conn.execute(text("ALTER TABLE rh_work_days ADD COLUMN IF NOT EXISTS late_decision_by INTEGER REFERENCES users(id);"))
            conn.execute(text("ALTER TABLE rh_work_days ADD COLUMN IF NOT EXISTS late_decision_at TIMESTAMPTZ;"))
            conn.execute(text("ALTER TABLE rh_settings ADD COLUMN IF NOT EXISTS max_daily_overtime_min INTEGER DEFAULT 120;"))
            conn.execute(text("ALTER TABLE rh_settings ADD COLUMN IF NOT EXISTS min_interjornada_min INTEGER DEFAULT 660;"))
            conn.execute(text("ALTER TABLE rh_settings ADD COLUMN IF NOT EXISTS max_consecutive_work_days INTEGER DEFAULT 6;"))
            conn.execute(text("ALTER TABLE rh_settings ADD COLUMN IF NOT EXISTS habitual_overtime_weeks INTEGER DEFAULT 3;"))
            conn.execute(text("ALTER TABLE rh_settings ADD COLUMN IF NOT EXISTS compensation_regime VARCHAR DEFAULT 'MONTHLY';"))
            conn.execute(text("ALTER TABLE rh_settings ADD COLUMN IF NOT EXISTS week_start INTEGER DEFAULT 0;"))
            conn.execute(text("ALTER TABLE rh_settings ADD COLUMN IF NOT EXISTS late_waiver_auto_min INTEGER DEFAULT 0;"))
            conn.execute(text("ALTER TABLE rh_settings ADD COLUMN IF NOT EXISTS late_compensation_mode VARCHAR DEFAULT 'AUTO';"))
            conn.execute(text("ALTER TABLE rh_settings ADD COLUMN IF NOT EXISTS late_compensation_max_min INTEGER DEFAULT 30;"))
            conn.execute(text("ALTER TABLE rh_settings ADD COLUMN IF NOT EXISTS late_compensation_max_per_month INTEGER DEFAULT 4;"))
            # Módulo de Inventário: colunas de cadastro em tabelas existentes
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS inventory_role VARCHAR;"))
            conn.execute(text("ALTER TABLE boning_families ADD COLUMN IF NOT EXISTS is_active_for_inventory BOOLEAN DEFAULT FALSE;"))
            conn.execute(text("ALTER TABLE boning_products ADD COLUMN IF NOT EXISTS ean VARCHAR;"))
            conn.execute(text("ALTER TABLE boning_products ADD COLUMN IF NOT EXISTS unit VARCHAR;"))
            conn.execute(text("ALTER TABLE boning_products ADD COLUMN IF NOT EXISTS ncm VARCHAR;"))
            conn.execute(text("ALTER TABLE boning_products ADD COLUMN IF NOT EXISTS is_inventory_default BOOLEAN DEFAULT TRUE;"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_boning_products_ean ON boning_products (ean);"))
            conn.execute(text("ALTER TABLE inventory_counts ADD COLUMN IF NOT EXISTS omie_task_id VARCHAR;"))
            conn.execute(text("ALTER TABLE inventory_counts ADD COLUMN IF NOT EXISTS last_error TEXT;"))
            conn.execute(text("ALTER TABLE inventory_counts ADD COLUMN IF NOT EXISTS effectivation_seq INTEGER NOT NULL DEFAULT 1;"))
            conn.execute(text("ALTER TABLE inventory_count_items ADD COLUMN IF NOT EXISTS reference_cost_source VARCHAR;"))
            conn.execute(text("ALTER TABLE inventory_count_items ADD COLUMN IF NOT EXISTS verified_qty FLOAT;"))
            conn.execute(text("ALTER TABLE inventory_count_items ADD COLUMN IF NOT EXISTS verified_cmc FLOAT;"))
            conn.execute(text("ALTER TABLE inventory_count_items ADD COLUMN IF NOT EXISTS verify_status VARCHAR;"))
            # Motivo único por item foi substituído pela distribuição em inventory_item_reasons
            conn.execute(text("ALTER TABLE inventory_count_items DROP COLUMN IF EXISTS reason;"))
            # Código do produto exibido na Omie (o omie_id é o ID interno)
            conn.execute(text("ALTER TABLE boning_products ADD COLUMN IF NOT EXISTS code VARCHAR;"))
            conn.execute(text("ALTER TABLE inventory_count_items ADD COLUMN IF NOT EXISTS product_code VARCHAR;"))
            conn.execute(text("""
                UPDATE inventory_count_items i SET product_code = p.code
                FROM boning_products p
                WHERE i.product_id = p.id AND i.product_code IS NULL AND p.code IS NOT NULL;
            """))
            # Salário passa a ser do cargo: herda o maior salário já cadastrado nos colaboradores do cargo
            conn.execute(text("""
                UPDATE rh_roles r SET base_salary = sub.salary
                FROM (
                    SELECT role_id, MAX(base_salary) AS salary FROM rh_employees
                    WHERE role_id IS NOT NULL AND base_salary > 0 GROUP BY role_id
                ) sub
                WHERE r.id = sub.role_id AND COALESCE(r.base_salary, 0) = 0
                  AND NOT EXISTS (SELECT 1 FROM rh_role_salary_changes c WHERE c.role_id = r.id);
            """))
            # Escala-padrão do contrato de jornada (planejamento v06)
            conn.execute(text("ALTER TABLE rh_employee_contracts ADD COLUMN IF NOT EXISTS standard_schedule_id INTEGER REFERENCES rh_standard_schedules(id) ON DELETE SET NULL;"))
    except Exception as e:
        print(f"Warning during auto-migration: {e}")

    # Dados de referência de RH: regimes legais (44h/42h/40h), modelos de contrato e escalas-padrão do sistema
    try:
        from core.database import SessionLocal
        from services.rh_contracts import ensure_rh_reference_data
        with SessionLocal() as db:
            ensure_rh_reference_data(db)
    except Exception as e:
        print(f"Warning during RH reference data seed: {e}")

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
app.include_router(rh_payroll_router)
app.include_router(estoque_catalogo_router)
app.include_router(estoque_router)

