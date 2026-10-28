"""
Horas 100%: DSR/feriado trabalhado sem folga compensatória (planejamento v07, seção 6.8).
O administrativo decide, na aba Banco de horas, entre conceder folga de dia inteiro em outro dia
(marcada na escala) ou pagar em dobro na folha do mês. Pendências impedem o fechamento da folha.
"""

from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from models import models
from services.rh_contracts import contract_day_on
from services.rh_engine import compute_raw_minutes
from services.rh_holidays_service import get_effective_holidays_map
from services.rh_ledger import rest_folga_window
from services.rh_schedule_service import record_change, snapshot_day

DECISIONS = ("FOLGA", "PAGAR")
FOLGA_ORIGIN = "FOLGA_COMP"
# Dias que não podem virar folga compensatória (já são ausência por outro motivo)
BLOCKED_STATUSES = ("FERIAS", "ATESTADO", "FALTA", "FOLGA_BH", "FERIADO")


def _is_holiday(db: Session, organization_id: int, d: date) -> bool:
    return d.isoformat() in get_effective_holidays_map(db, organization_id, d.year, d.month)


def _schedule_for(db: Session, organization_id: int, d: date, create: bool) -> Optional[models.RHMonthlySchedule]:
    schedule = db.query(models.RHMonthlySchedule).filter(
        models.RHMonthlySchedule.organization_id == organization_id,
        models.RHMonthlySchedule.year == d.year,
        models.RHMonthlySchedule.month == d.month
    ).first()
    if not schedule and create:
        schedule = models.RHMonthlySchedule(organization_id=organization_id, year=d.year, month=d.month, status="DRAFT")
        db.add(schedule)
        db.flush()
    return schedule


def _work_day(db: Session, schedule: Optional[models.RHMonthlySchedule], employee_id: int, d: date):
    if schedule is None:
        return None
    return db.query(models.RHWorkDay).filter(
        models.RHWorkDay.schedule_id == schedule.id,
        models.RHWorkDay.employee_id == employee_id,
        models.RHWorkDay.day == d.day
    ).first()


def rest_kind_of(db: Session, organization_id: int, emp: models.RHEmployee, d: date) -> Optional[str]:
    if _is_holiday(db, organization_id, d):
        return "FERIADO"
    cd = contract_day_on(emp.contracts, d)
    return "DSR" if cd is not None and cd.rest == "DSR" else None


def _revert_folga(db: Session, organization_id: int, emp: models.RHEmployee, row: models.RHRestWorkDecision,
                  user_id: Optional[int]) -> None:
    """Desfaz a folga marcada pela decisão, se o dia ainda estiver como folga (volta ao horário do contrato)."""
    if not (row.decision == "FOLGA" and row.folga_created and row.folga_date):
        return
    schedule = _schedule_for(db, organization_id, row.folga_date, create=False)
    rec = _work_day(db, schedule, emp.id, row.folga_date)
    if rec is None or rec.status != "FOLGA":
        return
    cd = contract_day_on(emp.contracts, row.folga_date)
    before = snapshot_day(rec)
    if cd is not None and cd.is_work:
        rec.status = "TRABALHO"
        rec.start_time, rec.lunch_start, rec.lunch_end, rec.end_time = cd.start, cd.lunch_start, cd.lunch_end, cd.end
        rec.raw_minutes = rec.worked_minutes = compute_raw_minutes(cd.start, cd.lunch_start, cd.lunch_end, cd.end)
    rec.is_manual = False
    record_change(db, organization_id, schedule, emp.id, rec.day, before, snapshot_day(rec), FOLGA_ORIGIN, user_id)


def _mark_folga(db: Session, organization_id: int, emp: models.RHEmployee, folga_date: date,
                user_id: Optional[int]) -> bool:
    """Marca a folga compensatória na escala; devolve True se o dia foi alterado por esta decisão."""
    schedule = _schedule_for(db, organization_id, folga_date, create=True)
    if schedule.status == "CLOSED":
        raise ValueError(f"A folha de {folga_date.month:02d}/{folga_date.year} está fechada.")
    rec = _work_day(db, schedule, emp.id, folga_date)
    if rec is not None and rec.status in BLOCKED_STATUSES:
        raise ValueError(f"{folga_date.strftime('%d/%m')} já está registrado como {rec.status.lower()} na escala.")
    if rec is not None and rec.status in ("DSR", "FOLGA"):
        return False
    before = snapshot_day(rec)
    if rec is None:
        rec = models.RHWorkDay(schedule_id=schedule.id, employee_id=emp.id, day=folga_date.day)
        db.add(rec)
    rec.status = "FOLGA"
    rec.start_time = rec.lunch_start = rec.lunch_end = rec.end_time = None
    rec.raw_minutes = rec.worked_minutes = 0
    rec.is_manual = True
    record_change(db, organization_id, schedule, emp.id, folga_date.day, before, snapshot_day(rec), FOLGA_ORIGIN, user_id)
    return True


def decide_rest_work(db: Session, organization_id: int, emp: models.RHEmployee, worked_date: date,
                     decision: Optional[str], folga_date: Optional[date], note: Optional[str],
                     user_id: Optional[int]) -> Optional[models.RHRestWorkDecision]:
    """
    Registra (ou desfaz, com decision=None) a decisão sobre o DSR/feriado trabalhado.
    FOLGA exige um dia de trabalho do contrato dentro do prazo (rest_folga_window), que vira folga na escala.
    """
    worked_schedule = _schedule_for(db, organization_id, worked_date, create=False)
    if worked_schedule is not None and worked_schedule.status == "CLOSED":
        raise ValueError(f"A folha de {worked_date.month:02d}/{worked_date.year} está fechada.")
    worked = _work_day(db, worked_schedule, emp.id, worked_date)
    kind = rest_kind_of(db, organization_id, emp, worked_date)
    if worked is None or worked.status != "TRABALHO" or kind is None:
        raise ValueError(f"{worked_date.strftime('%d/%m')} não é DSR nem feriado trabalhado.")
    if decision is not None and decision not in DECISIONS:
        raise ValueError("Decisão inválida.")

    row = db.query(models.RHRestWorkDecision).filter(
        models.RHRestWorkDecision.employee_id == emp.id,
        models.RHRestWorkDecision.worked_date == worked_date
    ).first()

    if decision == "FOLGA":
        if folga_date is None:
            raise ValueError("Escolha o dia da folga compensatória.")
        start, end = rest_folga_window(worked_date, kind)
        if not (start <= folga_date <= end) or folga_date == worked_date:
            raise ValueError(
                f"A folga deve ser entre {start.strftime('%d/%m')} e {end.strftime('%d/%m')}"
                + (" (sem passar de 6 dias seguidos de trabalho)." if kind == "DSR" else ".")
            )
        cd = contract_day_on(emp.contracts, folga_date)
        if cd is None or not cd.is_work or _is_holiday(db, organization_id, folga_date):
            raise ValueError("A folga compensatória deve cair num dia de trabalho do contrato.")
        taken = db.query(models.RHRestWorkDecision).filter(
            models.RHRestWorkDecision.employee_id == emp.id,
            models.RHRestWorkDecision.folga_date == folga_date,
            models.RHRestWorkDecision.decision == "FOLGA",
            models.RHRestWorkDecision.worked_date != worked_date
        ).first()
        if taken:
            raise ValueError(f"{folga_date.strftime('%d/%m')} já é folga compensatória de {taken.worked_date.strftime('%d/%m')}.")

    if row is not None:
        if decision == "FOLGA" and row.decision == "FOLGA" and row.folga_date == folga_date:
            row.note = note
            return row
        _revert_folga(db, organization_id, emp, row, user_id)
        if decision is None:
            db.delete(row)
            db.flush()
            return None
    elif decision is None:
        return None

    if row is None:
        row = models.RHRestWorkDecision(organization_id=organization_id, employee_id=emp.id, worked_date=worked_date)
        db.add(row)
    row.decision = decision
    row.folga_date = folga_date if decision == "FOLGA" else None
    row.folga_created = _mark_folga(db, organization_id, emp, folga_date, user_id) if decision == "FOLGA" else False
    row.note = note
    row.decided_by = user_id
    db.flush()
    return row
