"""
Service de Histórico Salarial
Aumentos salariais com data de vigência: cada mês da folha usa o salário vigente naquele período,
com cálculo proporcional (base 30 dias) quando o aumento começa no meio do mês.
"""

from typing import List, Optional, Tuple
from datetime import date
from sqlalchemy.orm import Session
from models import models


def get_salary_history(db: Session, employee_id: int) -> List[models.RHSalaryChange]:
    """Histórico em ordem cronológica; o registro inicial (sem data) vem primeiro."""
    changes = db.query(models.RHSalaryChange).filter(
        models.RHSalaryChange.employee_id == employee_id
    ).all()
    return sorted(changes, key=lambda c: (c.effective_date is not None, c.effective_date or date.min, c.id))


def salary_on(emp: models.RHEmployee, history: List[models.RHSalaryChange], day: date) -> float:
    """Salário vigente em uma data. Sem histórico, usa o salário do cadastro."""
    current = None
    for change in history:
        if change.effective_date is None or change.effective_date <= day:
            current = change.salary
        else:
            break
    if current is None:
        current = history[0].salary if history else emp.base_salary
    return float(current or 0.0)


def current_salary(db: Session, emp: models.RHEmployee) -> float:
    return salary_on(emp, get_salary_history(db, emp.id), date.today())


def salary_for_month(
    emp: models.RHEmployee,
    history: List[models.RHSalaryChange],
    year: int,
    month: int,
    num_days: int
) -> Tuple[float, Optional[str], float]:
    """
    Salário do mês respeitando aumentos no meio do período (mês comercial de 30 dias).
    Retorna (valor do mês, referência descritiva ou None, salário vigente no fim do mês).
    """
    end_salary = salary_on(emp, history, date(year, month, num_days))
    start_salary = salary_on(emp, history, date(year, month, 1))

    # Aumentos que começam depois do dia 1 dentro do mês
    changes_in_month = [
        c for c in history
        if c.effective_date and c.effective_date.year == year and c.effective_date.month == month
        and c.effective_date.day > 1
    ]
    if not changes_in_month:
        return round(end_salary, 2), None, end_salary

    total = 0.0
    segment_start = 1
    segment_salary = start_salary
    for change in changes_in_month:
        change_day = min(change.effective_date.day, 30)
        total += segment_salary / 30 * (change_day - segment_start)
        segment_start = change_day
        segment_salary = float(change.salary or 0.0)
    total += segment_salary / 30 * (31 - segment_start)

    reference = f"proporcional: {start_salary:.2f} até dia {changes_in_month[0].effective_date.day - 1}, depois {end_salary:.2f}"
    return round(total, 2), reference, end_salary


def ensure_initial_salary(db: Session, emp: models.RHEmployee) -> None:
    """Antes do primeiro aumento, registra o salário atual como salário inicial (vale desde sempre)."""
    has_history = db.query(models.RHSalaryChange.id).filter(
        models.RHSalaryChange.employee_id == emp.id
    ).first() is not None
    if not has_history:
        db.add(models.RHSalaryChange(
            employee_id=emp.id, effective_date=None, salary=round(float(emp.base_salary or 0.0), 2),
            reason="Salário inicial"
        ))
        db.flush()


def apply_salary_change(
    db: Session,
    emp: models.RHEmployee,
    effective_date: date,
    new_salary: Optional[float] = None,
    percent: Optional[float] = None,
    reason: Optional[str] = None
) -> models.RHSalaryChange:
    """Registra um aumento (valor novo ou percentual sobre o salário vigente na data)."""
    ensure_initial_salary(db, emp)
    history = get_salary_history(db, emp.id)

    if new_salary is None:
        if percent is None:
            raise ValueError("Informe o novo salário ou o percentual de aumento")
        new_salary = salary_on(emp, history, effective_date) * (1 + percent / 100)
    if new_salary < 0:
        raise ValueError("Salário não pode ser negativo")

    existing = next((c for c in history if c.effective_date == effective_date), None)
    if existing:
        existing.salary = round(new_salary, 2)
        existing.reason = reason or existing.reason
        change = existing
    else:
        change = models.RHSalaryChange(
            employee_id=emp.id, effective_date=effective_date,
            salary=round(new_salary, 2), reason=reason
        )
        db.add(change)

    db.flush()
    sync_current_salary(db, emp)
    return change


def sync_current_salary(db: Session, emp: models.RHEmployee) -> None:
    """Mantém o campo de cadastro com o salário vigente hoje (exibição e compatibilidade)."""
    emp.base_salary = round(current_salary(db, emp), 2)
