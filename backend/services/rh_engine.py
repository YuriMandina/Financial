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
    - Dias e valor de Vale Transporte antecipado (Opção B)
    - Dias e valor de Vale Alimentação antecipado (Opção B: apenas se jornada >= min_daily_hours_for_meal)
    - Compensação de Banco de Horas (dias 'BH' usufruídos vs meta do mês)
    - Férias e domingos trabalhados
    """
    month_info = get_month_calendar_info(year, month)
    num_days = month_info["num_days"]
    sundays = set(month_info["sundays"])

    min_hours_for_meal = getattr(settings, "min_daily_hours_for_meal", 6.0)
    target_bh_days = getattr(settings, "compensatory_days_per_month", 2)
    max_consecutive_sundays = getattr(settings, "max_consecutive_sundays", 2)

    emp_transport_cost = getattr(employee, "daily_transport_cost", 9.40) or 0.0
    emp_meal_cost = getattr(employee, "daily_meal_cost", 25.00) or 0.0

    vt_worked_days = 0
    va_worked_days = 0
    bh_days = 0
    vacation_days = 0
    sundays_worked = 0

    transport_statuses = {}
    for day in range(1, num_days + 1):
        # Transporte
        t_info = transport_days_map.get(day, {"status": "OFF", "daily_hours": 8.0})
        t_status = t_info.get("status", "OFF")
        transport_statuses[day] = t_status

        if t_status == "X":
            vt_worked_days += 1
            if day in sundays:
                sundays_worked += 1
        elif t_status == "BH":
            bh_days += 1
        elif t_status == "FE":
            vacation_days += 1

        # Alimentação (independente, com regra de horas)
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
    if bh_days < target_bh_days and vacation_days < 15:
        warnings.append({
            "employee_name": getattr(employee, "name", "Colaborador"),
            "type": "BANK_HOURS_COMPENSATION",
            "severity": "info",
            "message": (
                f"{getattr(employee, 'name', 'Colaborador')} tem {bh_days} folga(s) compensatória(s) "
                f"programada(s) das {target_bh_days} necessárias pelo regime 48h semanais (16h banco de horas/mês)."
            )
        })

    total_vt_amount = round(vt_worked_days * emp_transport_cost, 2)
    total_va_amount = round(va_worked_days * emp_meal_cost, 2)

    return {
        "employee_id": employee.id,
        "employee_name": employee.name,
        "employee_role": employee.role,
        "vt_daily_cost": emp_transport_cost,
        "va_daily_cost": emp_meal_cost,
        "vt_worked_days": vt_worked_days,
        "va_worked_days": va_worked_days,
        "total_vt_amount": total_vt_amount,
        "total_va_amount": total_va_amount,
        "total_benefits_amount": round(total_vt_amount + total_va_amount, 2),
        "bh_days_used": bh_days,
        "bh_days_target": target_bh_days,
        "vacation_days": vacation_days,
        "sundays_worked": sundays_worked,
        "warnings": warnings
    }
