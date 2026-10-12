import calendar
from datetime import date, timedelta
from typing import List, Dict, Any, Optional

# ==============================================================================
# --- [BLOCO: UTILITÁRIOS DE CALENDÁRIO] ---
# ==============================================================================

def get_month_calendar_info(year: int, month: int):
    """
    Retorna o total de dias no mês e a lista de domingos (número do dia).
    """
    num_days = calendar.monthrange(year, month)[1]
    sundays = []
    for day in range(1, num_days + 1):
        d = date(year, month, day)
        if d.weekday() == 6:  # Domingo (0=Segunda, 6=Domingo)
            sundays.append(day)
    return {
        "num_days": num_days,
        "sundays": sundays
    }


# ==============================================================================
# --- [BLOCO: VALIDAÇÃO DE REGRAS DE DOMINGOS CONSECUTIVOS] ---
# ==============================================================================

def check_consecutive_sundays_warnings(
    employee_name: str,
    schedules_by_day: Dict[int, str],
    year: int,
    month: int,
    max_consecutive: int = 2
) -> List[Dict[str, Any]]:
    """
    Regra: Nenhum colaborador deve trabalhar mais de 'max_consecutive' domingos seguidos.
    NÃO BLOQUEIA: Gera apenas alertas / warnings informativos para o operador.
    """
    warnings = []
    month_info = get_month_calendar_info(year, month)
    sundays = month_info["sundays"]

    consecutive_count = 0
    consecutive_streak = []

    for sun_day in sundays:
        status = schedules_by_day.get(sun_day, "OFF")
        # Considera trabalhado se status for 'X'
        if status == "X":
            consecutive_count += 1
            consecutive_streak.append(sun_day)
            if consecutive_count > max_consecutive:
                warnings.append({
                    "employee_name": employee_name,
                    "type": "CONSECUTIVE_SUNDAYS",
                    "severity": "warning",
                    "consecutive_count": consecutive_count,
                    "days": list(consecutive_streak),
                    "message": (
                        f"{employee_name} está escalado(a) em {consecutive_count} domingos seguidos "
                        f"(dias: {', '.join(map(str, consecutive_streak))}). "
                        f"O limite recomendado é de {max_consecutive} domingos seguidos."
                    )
                })
        else:
            consecutive_count = 0
            consecutive_streak = []

    return warnings


# ==============================================================================
# --- [BLOCO: CÁLCULO DE DIAS E BENEFÍCIOS (VT E VA ANTECIPADOS)] ---
# ==============================================================================

def calculate_employee_month_summary(
    employee: Any,
    transport_days_map: Dict[int, Dict[str, Any]],
    meal_days_map: Dict[int, Dict[str, Any]],
    year: int,
    month: int,
    settings: Any
) -> Dict[str, Any]:
    """
    Calcula:
    - Dias e valor de Vale Transporte: tarifa unitária universal x quantidade total de vales (2 ou 4 por dia)
    - Dias e valor de Vale Alimentação: 1 benefício por dia trabalhado (se jornada >= min_daily_hours_for_meal) x valor individual
    - Compensação de Banco de Horas proporcional ao regime semanal do contrato (44h, 40h etc)
    - Férias e domingos trabalhados
    """
    month_info = get_month_calendar_info(year, month)
    num_days = month_info["num_days"]
    sundays = set(month_info["sundays"])

    min_hours_for_meal = getattr(settings, "min_daily_hours_for_meal", 6.0)
    max_consecutive_sundays = getattr(settings, "max_consecutive_sundays", 2)
    ticket_unit_price = getattr(settings, "transport_ticket_unit_price", 4.70) or 4.70

    # Benefícios do Colaborador
    emp_meal_cost = getattr(employee, "daily_meal_cost", 25.00) or 0.0
    default_tickets = getattr(employee, "default_daily_transport_tickets", 2) or 2
    contract_hours = getattr(employee, "weekly_contract_hours", 44.0) or 44.0
    actual_hours = getattr(employee, "weekly_actual_hours", 48.0) or 48.0

    # Meta de folgas de banco de horas baseada na diferença semanal
    weekly_overtime = max(0.0, actual_hours - contract_hours)
    # Ex: 48h - 44h = 4h/semana * 4 semanas = 16h / 8h = 2 folgas. Se 48h - 40h = 8h * 4 = 32h / 8h = 4 folgas.
    target_bh_days = max(0, int(round((weekly_overtime * 4) / 8.0))) if weekly_overtime > 0 else 0

    vt_worked_days = 0
    total_vt_tickets = 0
    va_worked_days = 0
    bh_days = 0
    vacation_days = 0
    sundays_worked = 0

    transport_statuses = {}
    for day in range(1, num_days + 1):
        # Transporte
        t_info = transport_days_map.get(day, {"status": "OFF", "daily_hours": 8.0, "tickets_count": default_tickets})
        t_status = t_info.get("status", "OFF")
        transport_statuses[day] = t_status

        if t_status == "X":
            vt_worked_days += 1
            # Quantidade de vales do dia (ex: 2 ou 4)
            day_tickets = t_info.get("tickets_count")
            if day_tickets is None or day_tickets <= 0:
                day_tickets = default_tickets
            total_vt_tickets += int(day_tickets)

            if day in sundays:
                sundays_worked += 1
        elif t_status == "BH":
            bh_days += 1
        elif t_status == "FE":
            vacation_days += 1

        # Alimentação (1 por dia trabalhado se jornada >= min_hours_for_meal)
        m_info = meal_days_map.get(day, {"status": "OFF", "daily_hours": 8.0})
        m_status = m_info.get("status", "OFF")
        m_hours = m_info.get("daily_hours", 8.0) or 8.0

        if m_status == "X" and m_hours >= min_hours_for_meal:
            va_worked_days += 1

    # Verificação de domingos seguidos
    warnings = check_consecutive_sundays_warnings(
        employee_name=getattr(employee, "name", "Colaborador"),
        schedules_by_day=transport_statuses,
        year=year,
        month=month,
        max_consecutive=max_consecutive_sundays
    )

    # Verificação de folgas compensatórias de banco de horas
    if target_bh_days > 0 and bh_days < target_bh_days and vacation_days < 15:
        warnings.append({
            "employee_name": getattr(employee, "name", "Colaborador"),
            "type": "BANK_HOURS_COMPENSATION",
            "severity": "info",
            "message": (
                f"{getattr(employee, 'name', 'Colaborador')} (regime contratual {contract_hours}h) tem {bh_days} folga(s) "
                f"programada(s) das {target_bh_days} necessárias para compensação de banco de horas no mês."
            )
        })

    total_vt_amount = round(total_vt_tickets * ticket_unit_price, 2)
    total_va_amount = round(va_worked_days * emp_meal_cost, 2)

    role_name = getattr(employee, "role", None)
    if hasattr(employee, "role_obj") and employee.role_obj:
        role_name = employee.role_obj.name

    return {
        "employee_id": employee.id,
        "employee_name": employee.name,
        "employee_role": role_name or "Geral",
        "ticket_unit_price": ticket_unit_price,
        "default_daily_tickets": default_tickets,
        "total_vt_tickets": total_vt_tickets,
        "vt_worked_days": vt_worked_days,
        "va_daily_cost": emp_meal_cost,
        "va_worked_days": va_worked_days,
        "total_vt_amount": total_vt_amount,
        "total_va_amount": total_va_amount,
        "total_benefits_amount": round(total_vt_amount + total_va_amount, 2),
        "weekly_contract_hours": contract_hours,
        "bh_days_used": bh_days,
        "bh_days_target": target_bh_days,
        "vacation_days": vacation_days,
        "sundays_worked": sundays_worked,
        "warnings": warnings
    }
