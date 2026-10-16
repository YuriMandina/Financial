import calendar
import math
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
# --- [BLOCO: CÁLCULO DE MINUTOS E HORÁRIOS] ---
# ==============================================================================

def parse_time_to_minutes(time_str: Optional[str]) -> Optional[int]:
    """Converte 'HH:MM' para minutos desde meia-noite."""
    if not time_str or ":" not in time_str:
        return None
    try:
        parts = time_str.strip().split(":")
        h = int(parts[0])
        m = int(parts[1])
        return h * 60 + m
    except Exception:
        return None


def compute_raw_minutes(
    start_time: Optional[str],
    lunch_start: Optional[str],
    lunch_end: Optional[str],
    end_time: Optional[str]
) -> int:
    """
    Calcula minutos líquidos trabalhados a partir de horários de entrada, almoço e saída.
    Trata corretamente passagem da meia-noite (turnos noturnos).
    """
    start_m = parse_time_to_minutes(start_time)
    end_m = parse_time_to_minutes(end_time)

    if start_m is None or end_m is None:
        return 0

    # Trata virada da meia-noite (ex: 22:00 até 06:00)
    if end_m < start_m:
        total_span = (end_m + 24 * 60) - start_m
    else:
        total_span = end_m - start_m

    # Intervalo de almoço
    l_start_m = parse_time_to_minutes(lunch_start)
    l_end_m = parse_time_to_minutes(lunch_end)
    lunch_span = 0
    if l_start_m is not None and l_end_m is not None:
        if l_end_m < l_start_m:
            lunch_span = (l_end_m + 24 * 60) - l_start_m
        else:
            lunch_span = l_end_m - l_start_m

    net_minutes = max(0, total_span - lunch_span)
    return net_minutes


def apply_month_rounding(total_minutes: int, rounding_minutes: int = 0, rounding_mode: str = "NEAREST") -> int:
    """
    Decisão D6: Arredondamento aplicado EXCLUSIVAMENTE no total do mês para evitar distorções acumuladas.
    - rounding_minutes: 0 (sem arredondar), 5, 10, 15, 30, 60
    - rounding_mode: 'NEAREST', 'DOWN', 'UP'
    """
    if rounding_minutes <= 0:
        return total_minutes

    sign = 1 if total_minutes >= 0 else -1
    abs_min = abs(total_minutes)

    if rounding_mode == "DOWN":
        rounded = (abs_min // rounding_minutes) * rounding_minutes
    elif rounding_mode == "UP":
        rounded = int(math.ceil(abs_min / rounding_minutes)) * rounding_minutes
    else:  # NEAREST
        rounded = int(round(abs_min / rounding_minutes)) * rounding_minutes

    return sign * rounded


def format_minutes_to_hours(minutes: int, format_type: str = "HHMM") -> str:
    """
    Formata minutos em string legível:
    - 'HHMM': ex '7h20' ou '+12h30' ou '-2h15'
    - 'DECIMAL': ex '7.33h' ou '+12.50h'
    """
    sign = "+" if minutes > 0 else ("-" if minutes < 0 else "")
    abs_min = abs(minutes)
    hours = abs_min // 60
    rem_min = abs_min % 60

    if format_type == "DECIMAL":
        dec = abs_min / 60.0
        return f"{sign}{dec:.2f}h"
    return f"{sign}{hours}h{rem_min:02d}"


# ==============================================================================
# --- [BLOCO: REGRAS E DERIVAÇÃO DE BENEFÍCIOS (VT E VA)] ---
# ==============================================================================

def derive_day_benefits(
    work_day: Any,
    default_tickets: int = 2,
    min_daily_hours_for_meal: float = 6.0
) -> Dict[str, Any]:
    """
    Deriva os benefícios do dia a partir da jornada real (D5 e D8):
    - Se TRABALHO:
        * VT calculado = default_tickets
        * VA calculado = True se worked_minutes >= (min_daily_hours_for_meal * 60)
    - Se folga/feriado/atestado:
        * VT calculado = 0
        * VA calculado = False
    - Respeita overrides manuais gravados em vt_tickets_override e va_override.
    """
    status = getattr(work_day, "status", "FOLGA")
    worked_min = getattr(work_day, "worked_minutes", 0) or 0
    is_worked = status == "TRABALHO"

    # Calculado
    vt_calc = default_tickets if is_worked else 0
    min_meal_minutes = int(round(min_daily_hours_for_meal * 60))
    va_calc = is_worked and (worked_min >= min_meal_minutes)

    # Overrides (D5)
    vt_override = getattr(work_day, "vt_tickets_override", None)
    va_override = getattr(work_day, "va_override", None)

    vt_final = vt_override if vt_override is not None else vt_calc
    vt_is_overridden = vt_override is not None

    va_final = va_override if va_override is not None else va_calc
    va_is_overridden = va_override is not None

    return {
        "vt_calc": vt_calc,
        "vt_final": max(0, int(vt_final)),
        "vt_is_overridden": vt_is_overridden,
        "va_calc": bool(va_calc),
        "va_final": bool(va_final),
        "va_is_overridden": va_is_overridden,
        "benefit_note": getattr(work_day, "benefit_note", None)
    }


# ==============================================================================
# --- [BLOCO: VALIDAÇÃO DE CONFORMIDADE TRABALHISTA CLT (ALERTAS)] ---
# ==============================================================================

def check_clt_compliance_warnings(
    employee_name: str,
    work_days_by_day: Dict[int, Any],
    year: int,
    month: int,
    max_consecutive_sundays: int = 2
) -> List[Dict[str, Any]]:
    """
    Gera avisos visuais informativos (sem bloqueio) conforme regras da CLT:
    1. Domingos consecutivos além do limite configurado
    2. Intervalo intrajornada inferior a 1h quando jornada > 6h (Art. 71 CLT)
    3. Carga diária superior a 10h (limite legal de 8h + 2h extras - Art. 59 CLT)
    4. Alerta de falta injustificada no período (impacto potencial em perda do DSR)
    """
    warnings = []
    month_info = get_month_calendar_info(year, month)
    sundays = month_info["sundays"]

    # 1. Domingos consecutivos
    consecutive_count = 0
    consecutive_streak = []
    for sun_day in sundays:
        wd = work_days_by_day.get(sun_day)
        st = getattr(wd, "status", "DSR") if wd else "DSR"
        if st == "TRABALHO":
            consecutive_count += 1
            consecutive_streak.append(sun_day)
            if consecutive_count > max_consecutive_sundays:
                warnings.append({
                    "employee_name": employee_name,
                    "type": "CONSECUTIVE_SUNDAYS",
                    "severity": "warning",
                    "consecutive_count": consecutive_count,
                    "days": list(consecutive_streak),
                    "message": (
                        f"{employee_name} trabalhou em {consecutive_count} domingos consecutivos "
                        f"(dias: {', '.join(map(str, consecutive_streak))}). "
                        f"Limite recomendado: {max_consecutive_sundays} domingos."
                    )
                })
        else:
            consecutive_count = 0
            consecutive_streak = []

    # 2 e 3. Intervalo intrajornada e limite diário de 10h
    for day, wd in work_days_by_day.items():
        if not wd or getattr(wd, "status", "") != "TRABALHO":
            continue

        worked_min = getattr(wd, "worked_minutes", 0) or 0

        # Carga > 10 horas
        if worked_min > 600:
            warnings.append({
                "employee_name": employee_name,
                "type": "DAILY_OVERTIME_LIMIT",
                "severity": "warning",
                "day": day,
                "message": (
                    f"Dia {day}: {employee_name} com jornada de {worked_min // 60}h{worked_min % 60:02d}. "
                    f"A CLT limita a jornada máxima diária a 10 horas (8h normais + 2h extras)."
                )
            })

        # Intervalo < 1h quando jornada > 6h
        if worked_min > 360:
            l_start = getattr(wd, "lunch_start", None)
            l_end = getattr(wd, "lunch_end", None)
            l_start_m = parse_time_to_minutes(l_start)
            l_end_m = parse_time_to_minutes(l_end)
            lunch_span = 0
            if l_start_m is not None and l_end_m is not None:
                lunch_span = (l_end_m - l_start_m) if l_end_m >= l_start_m else (l_end_m + 1440 - l_start_m)

            if lunch_span < 60:
                warnings.append({
                    "employee_name": employee_name,
                    "type": "SHORT_MEAL_INTERVAL",
                    "severity": "info",
                    "day": day,
                    "message": (
                        f"Dia {day}: intervalo de refeição de {lunch_span} min. "
                        f"Jornadas superiores a 6h exigem no mínimo 1h de intervalo (Art. 71 CLT)."
                    )
                })

        # Alerta de Falta
        if getattr(wd, "status", "") == "FALTA":
            warnings.append({
                "employee_name": employee_name,
                "type": "ABSENCE_REGISTERED",
                "severity": "warning",
                "day": day,
                "message": f"Dia {day}: Falta registrada para {employee_name}. Pode acarretar perda do DSR semanal."
            })

    return warnings

# Alias para compatibilidade
check_consecutive_sundays_warnings = check_clt_compliance_warnings


# ==============================================================================
# --- [BLOCO: APURAÇÃO MENSAL UNIFICADA DE JORNADA E BENEFÍCIOS] ---
# ==============================================================================

def calculate_work_days_summary(
    employee: Any,
    work_days_map: Dict[int, Any],
    benefit_adjustments: List[Any],
    year: int,
    month: int,
    settings: Any
) -> Dict[str, Any]:
    """
    Motor central da nova arquitetura:
    Calcula horas reais, banco de horas exato em minutos e benefícios (com overrides e ajustes avulsos).
    """
    month_info = get_month_calendar_info(year, month)
    num_days = month_info["num_days"]
    sundays = set(month_info["sundays"])

    min_hours_for_meal = getattr(settings, "min_daily_hours_for_meal", 6.0) or 6.0
    max_consecutive_sundays = getattr(settings, "max_consecutive_sundays", 2) or 2
    ticket_unit_price = getattr(settings, "transport_ticket_unit_price", 4.70) or 4.70
    rounding_minutes = getattr(settings, "time_rounding_minutes", 0) or 0
    rounding_mode = getattr(settings, "time_rounding_mode", "NEAREST") or "NEAREST"
    hours_format = getattr(settings, "hours_display_format", "HHMM") or "HHMM"

    emp_meal_cost = getattr(employee, "daily_meal_cost", 25.00) or 0.0
    default_tickets = getattr(employee, "default_daily_transport_tickets", 2)
    default_tickets = 2 if default_tickets is None else default_tickets  # 0 = sem vale transporte
    contract_weekly_hours = getattr(employee, "weekly_contract_hours", 44.0) or 44.0
    work_days_per_week = getattr(employee, "work_days_per_week", 6) or 6

    # Minutos diários esperados de trabalho (ex: 44h / 6 dias = 7.333h = 440 minutos = 7h20)
    daily_expected_minutes = int(round((contract_weekly_hours / work_days_per_week) * 60))

    total_worked_minutes = 0
    total_expected_minutes = 0
    total_vt_tickets_calc = 0
    total_vt_tickets_final = 0
    vt_worked_days = 0
    total_va_count_calc = 0
    total_va_count_final = 0
    va_worked_days = 0
    bh_days_used = 0
    vacation_days = 0
    sundays_worked = 0
    absences_count = 0

    for day in range(1, num_days + 1):
        wd = work_days_map.get(day)
        st = getattr(wd, "status", "DSR" if day in sundays else "FOLGA") if wd else ("DSR" if day in sundays else "FOLGA")
        worked_min = getattr(wd, "worked_minutes", 0) or 0

        # Benefícios diários
        ben = derive_day_benefits(wd, default_tickets, min_hours_for_meal) if wd else {
            "vt_calc": 0, "vt_final": 0, "vt_is_overridden": False,
            "va_calc": False, "va_final": False, "va_is_overridden": False
        }

        total_vt_tickets_calc += ben["vt_calc"]
        total_vt_tickets_final += ben["vt_final"]
        if ben["va_calc"]:
            total_va_count_calc += 1
        if ben["va_final"]:
            total_va_count_final += 1

        if st == "TRABALHO":
            total_worked_minutes += worked_min
            total_expected_minutes += daily_expected_minutes
            vt_worked_days += 1
            if worked_min >= int(round(min_hours_for_meal * 60)):
                va_worked_days += 1
            if day in sundays:
                sundays_worked += 1
        elif st == "FOLGA_BH":
            # Folga de banco de horas consome a jornada contratual esperada para abater saldo
            total_expected_minutes += daily_expected_minutes
            bh_days_used += 1
        elif st == "FERIAS":
            vacation_days += 1
        elif st == "FALTA":
            total_expected_minutes += daily_expected_minutes
            absences_count += 1
        # DSR, FOLGA, FERIADO, ATESTADO: expectativa do dia é zero

    # D7: Ajustes avulsos do mês (tabela rh_benefit_adjustments)
    vt_adj_total = 0.0
    va_adj_total = 0.0
    for adj in benefit_adjustments:
        if getattr(adj, "employee_id", None) == employee.id:
            if getattr(adj, "benefit_type", "") == "VT":
                vt_adj_total += float(getattr(adj, "quantity", 0.0) or 0.0)
            elif getattr(adj, "benefit_type", "") == "VA":
                va_adj_total += float(getattr(adj, "quantity", 0.0) or 0.0)

    final_vt_tickets = max(0, int(round(total_vt_tickets_final + vt_adj_total)))
    final_va_count = max(0, int(round(total_va_count_final + va_adj_total)))

    total_vt_amount = round(final_vt_tickets * ticket_unit_price, 2)
    total_va_amount = round(final_va_count * emp_meal_cost, 2)

    # D6: Arredondamento de banco de horas aplicado EXCLUSIVAMENTE no total do mês
    raw_balance_minutes = total_worked_minutes - total_expected_minutes
    final_balance_minutes = apply_month_rounding(raw_balance_minutes, rounding_minutes, rounding_mode)

    # Dias estimados equivalentes de compensação em folgas (8h = 480 min)
    target_bh_days = max(0, int(round(final_balance_minutes / 480.0))) if final_balance_minutes > 0 else 0

    warnings = check_clt_compliance_warnings(
        employee_name=getattr(employee, "name", "Colaborador"),
        work_days_by_day=work_days_map,
        year=year,
        month=month,
        max_consecutive_sundays=max_consecutive_sundays
    )

    role_name = getattr(employee, "role", None)
    if hasattr(employee, "role_obj") and employee.role_obj:
        role_name = employee.role_obj.name

    return {
        "employee_id": employee.id,
        "employee_name": employee.name,
        "employee_role": role_name or "Geral",
        "ticket_unit_price": ticket_unit_price,
        "default_daily_tickets": default_tickets,
        # Minutos e Horas Reais
        "total_worked_minutes": total_worked_minutes,
        "total_expected_minutes": total_expected_minutes,
        "raw_balance_minutes": raw_balance_minutes,
        "final_balance_minutes": final_balance_minutes,
        "worked_hours_formatted": format_minutes_to_hours(total_worked_minutes, hours_format),
        "expected_hours_formatted": format_minutes_to_hours(total_expected_minutes, hours_format),
        "bank_hours_balance_formatted": format_minutes_to_hours(final_balance_minutes, hours_format),
        # Dias e Benefícios
        "vt_worked_days": vt_worked_days,
        "va_worked_days": va_worked_days,
        "total_vt_tickets_calc": total_vt_tickets_calc,
        "total_vt_tickets_final": final_vt_tickets,
        "vt_adjustments_qty": vt_adj_total,
        "total_va_count_calc": total_va_count_calc,
        "total_va_count_final": final_va_count,
        "va_adjustments_qty": va_adj_total,
        "total_vt_amount": total_vt_amount,
        "total_va_amount": total_va_amount,
        "total_benefits_amount": round(total_vt_amount + total_va_amount, 2),
        # Regime e Banco de Horas
        "weekly_contract_hours": contract_weekly_hours,
        "work_days_per_week": work_days_per_week,
        "bh_days_used": bh_days_used,
        "bh_days_target": target_bh_days,
        "vacation_days": vacation_days,
        "absences_count": absences_count,
        "sundays_worked": sundays_worked,
        "warnings": warnings
    }


# Retrocompatibilidade com funções legadas
def calculate_employee_month_summary(
    employee: Any,
    transport_days_map: Dict[int, Dict[str, Any]],
    meal_days_map: Dict[int, Dict[str, Any]],
    year: int,
    month: int,
    settings: Any
) -> Dict[str, Any]:
    """Adaptador de retrocompatibilidade para o motor legado."""
    class DummyWD:
        def __init__(self, t_entry, m_entry):
            self.status = "TRABALHO" if t_entry.get("status") == "X" else t_entry.get("status", "OFF")
            self.worked_minutes = int(round(float(t_entry.get("daily_hours", 8.0) or 8.0) * 60))
            self.vt_tickets_override = t_entry.get("tickets_count")
            self.va_override = (m_entry.get("status") == "X") if m_entry.get("status") != t_entry.get("status") else None
            self.lunch_start = "12:00"
            self.lunch_end = "13:00"
            self.benefit_note = None

    num_days = calendar.monthrange(year, month)[1]
    mapped = {}
    for d in range(1, num_days + 1):
        t_info = transport_days_map.get(d, {})
        m_info = meal_days_map.get(d, {})
        mapped[d] = DummyWD(t_info, m_info)

    return calculate_work_days_summary(employee, mapped, [], year, month, settings)
