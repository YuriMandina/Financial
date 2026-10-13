"""
Script de Migração Idempotente: RHScheduleDay -> RHWorkDay
Copia com segurança os registros legados da escala (TRANSPORTE e ALIMENTACAO)
para o novo modelo unificado RHWorkDay sem apagar a tabela legada.
"""

import sys
import os
import argparse

# Adiciona o diretório backend ao sys.path para imports funcionarem
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy.orm import Session
from core.database import engine, SessionLocal
from models import models

def migrate(dry_run: bool = False):
    print("=" * 60)
    print("INICIANDO MIGRAÇÃO: rh_schedule_days -> rh_work_days")
    print(f"Modo: {'DRY RUN (Simulação)' if dry_run else 'EXECUÇÃO REAL'}")
    print("=" * 60)

    # Garante criação das tabelas se ainda não criadas
    if not dry_run:
        models.Base.metadata.create_all(bind=engine)

    db: Session = SessionLocal()
    try:
        schedules = db.query(models.RHMonthlySchedule).all()
        print(f"Total de escalas mensais encontradas: {len(schedules)}")

        shifts = {s.id: s for s in db.query(models.RHWorkShift).all()}
        employees = {e.id: e for e in db.query(models.RHEmployee).all()}

        total_migrated = 0
        total_skipped = 0

        for sched in schedules:
            # Buscar dias do transporte
            transport_days = db.query(models.RHScheduleDay).filter(
                models.RHScheduleDay.schedule_id == sched.id,
                models.RHScheduleDay.schedule_type == "TRANSPORTE"
            ).all()

            # Buscar dias de alimentação para conferir se houve divergência legada
            meal_days = {
                (m.employee_id, m.day): m
                for m in db.query(models.RHScheduleDay).filter(
                    models.RHScheduleDay.schedule_id == sched.id,
                    models.RHScheduleDay.schedule_type == "ALIMENTACAO"
                ).all()
            }

            from services.rh_engine import get_month_calendar_info
            cal_info = get_month_calendar_info(sched.year, sched.month)
            sundays = set(cal_info["sundays"])

            for t in transport_days:
                emp = employees.get(t.employee_id)
                emp_default_tickets = getattr(emp, "default_daily_transport_tickets", 2) or 2

                # Verificar se já existe na nova tabela
                existing = db.query(models.RHWorkDay).filter(
                    models.RHWorkDay.schedule_id == sched.id,
                    models.RHWorkDay.employee_id == t.employee_id,
                    models.RHWorkDay.day == t.day
                ).first()

                if existing:
                    total_skipped += 1
                    continue

                # Mapeamento do status
                legacy_status = t.status or "OFF"
                if legacy_status == "X":
                    new_status = "TRABALHO"
                elif legacy_status == "OFF":
                    new_status = "DSR" if t.day in sundays else "FOLGA"
                elif legacy_status == "F":
                    new_status = "FERIADO"
                elif legacy_status == "FE":
                    new_status = "FERIAS"
                elif legacy_status == "BH":
                    new_status = "FOLGA_BH"
                else:
                    new_status = "TRABALHO"

                shift_obj = shifts.get(t.shift_id)
                start_time = shift_obj.start_time if shift_obj else "08:00"
                lunch_start = shift_obj.lunch_start if shift_obj else "12:00"
                lunch_end = shift_obj.lunch_end if shift_obj else "13:00"
                end_time = shift_obj.end_time if shift_obj else "17:00"

                if new_status == "TRABALHO":
                    daily_h = float(t.daily_hours) if t.daily_hours is not None else (shift_obj.net_hours if shift_obj else 8.0)
                    raw_min = int(round(daily_h * 60))
                else:
                    raw_min = 0

                # Override de VT
                vt_override = None
                if t.tickets_count is not None and t.tickets_count != emp_default_tickets:
                    vt_override = t.tickets_count

                # Override de VA (se o status legado de refeição divergiu do de transporte)
                va_override = None
                meal_item = meal_days.get((t.employee_id, t.day))
                if meal_item:
                    meal_worked = meal_item.status == "X"
                    trans_worked = t.status == "X"
                    if trans_worked and not meal_worked:
                        va_override = False
                    elif not trans_worked and meal_worked:
                        va_override = True

                work_day = models.RHWorkDay(
                    schedule_id=sched.id,
                    employee_id=t.employee_id,
                    day=t.day,
                    status=new_status,
                    shift_id=t.shift_id,
                    shift=t.shift,
                    start_time=start_time,
                    lunch_start=lunch_start,
                    lunch_end=lunch_end,
                    end_time=end_time,
                    raw_minutes=raw_min,
                    worked_minutes=raw_min,
                    vt_tickets_override=vt_override,
                    va_override=va_override,
                    is_manual=False
                )

                if not dry_run:
                    db.add(work_day)
                total_migrated += 1

            if not dry_run:
                db.commit()

        print(f"Migração finalizada! Registros inseridos: {total_migrated}, já existentes (pulados): {total_skipped}")

    except Exception as e:
        db.rollback()
        print(f"Erro durante a migração: {e}")
        raise
    finally:
        db.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migração de RHScheduleDay para RHWorkDay")
    parser.add_argument("--dry-run", action="store_true", help="Simula sem persistir")
    args = parser.parse_args()
    migrate(dry_run=args.dry_run)
