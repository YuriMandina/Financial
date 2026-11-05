"""
Férias (CLT arts. 129 a 145)
Períodos aquisitivo e concessivo a partir da admissão, direito conforme as faltas injustificadas
(art. 130), programação com fracionamento (art. 134 §1º), início vedado antes de DSR/feriado
(art. 134 §3º; PN 100 TST), abono pecuniário de até 1/3 (art. 143), dobra fora do prazo (art. 137),
marcação dos dias na escala e cálculo do aviso/recibo de férias.
"""

from datetime import date, timedelta
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from sqlalchemy.orm import Session

from models import models
from services.rh_contracts import contract_day_on
from services.rh_holidays_service import get_effective_holidays_map
from services.rh_payroll_service import (
    FGTS_RATE, calc_inss, calc_irrf, completed_triennia, ensure_system_items
)
from services.rh_rest_work_service import _schedule_for, _work_day
from services.rh_salary_service import get_salary_history, salary_on
from services.rh_schedule_service import record_change, snapshot_day

STATUSES = ("PROGRAMADA", "CONFIRMADA", "HISTORICO", "CANCELADA")
# Consomem o saldo do período (HISTORICO: férias anteriores ao sistema, não tocam a escala)
ACTIVE_STATUSES = ("PROGRAMADA", "CONFIRMADA", "HISTORICO")
SCHEDULE_ORIGIN = "FERIAS"

# Art. 130: faltas injustificadas no período aquisitivo -> dias de férias
ABSENCE_TABLE = ((5, 30), (14, 24), (23, 18), (32, 12))
MIN_FRACTION_DAYS = 5  # Art. 134 §1º: nenhuma fração abaixo de 5 dias corridos
MIN_MAIN_FRACTION_DAYS = 14  # Art. 134 §1º: uma das frações com pelo menos 14 dias corridos
MAX_FRACTIONS = 3
NOTICE_DAYS = 30  # Art. 135: aviso com 30 dias de antecedência
PAYMENT_ADVANCE_DAYS = 2  # Art. 145: pagamento até 2 dias antes do início
ABONO_REQUEST_DAYS = 15  # Art. 143 §1º: abono requerido até 15 dias antes do fim do período aquisitivo
EXPIRING_ALERT_DAYS = 90  # Alerta de período concessivo perto de vencer

# Rubricas variáveis que entram na média das férias (art. 142 §§5º e 6º)
VARIABLE_KEYS = ("HE50", "HE_NORMAL", "HE100", "DSR_HE", "HE_FIXO")
# Dias que não podem ser sobrepostos pelas férias na escala
CONFLICT_STATUSES = {"FALTA": "falta", "ATESTADO": "atestado", "FOLGA_BH": "folga de banco de horas"}

PERIOD_STATUS_LABELS = {
    "EM_AQUISICAO": "Em aquisição",
    "A_PROGRAMAR": "A programar",
    "VENCENDO": "Vencendo",
    "VENCIDO": "Vencido",
    "PROGRAMADO": "Programado",
    "QUITADO": "Quitado",
    "REGULARIZADO": "Quitado (regularizado)",
    "SEM_DIREITO": "Sem direito",
}


def _br(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def add_years(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year + years)
    except ValueError:  # 29/02 em ano não bissexto
        return d.replace(year=d.year + years, day=28)


def entitlement_for_absences(absences: int) -> int:
    for limit, days in ABSENCE_TABLE:
        if absences <= limit:
            return days
    return 0


def max_abono_for(entitled: int) -> int:
    return entitled // 3


def acquisition_bounds(admission: date, index: int) -> Tuple[date, date, date]:
    """(início, fim do período aquisitivo, fim do período concessivo) do período de número `index` (0 = 1º ano)."""
    start = add_years(admission, index)
    end = add_years(admission, index + 1) - timedelta(days=1)
    concessive_end = add_years(admission, index + 2) - timedelta(days=1)
    return start, end, concessive_end


def period_index_of(admission: date, acquisition_start: date) -> Optional[int]:
    index = acquisition_start.year - admission.year
    if index >= 0 and acquisition_bounds(admission, index)[0] == acquisition_start:
        return index
    return None


def vacation_end(v: Any) -> date:
    return v.start_date + timedelta(days=max(1, int(v.days or 0)) - 1)


def abono_end(v: Any) -> Optional[date]:
    if not v.abono_start_date or not v.abono_days:
        return None
    return v.abono_start_date + timedelta(days=int(v.abono_days) - 1)


def vacation_dates(v: Any) -> List[date]:
    return [v.start_date + timedelta(days=i) for i in range(int(v.days or 0))]


# ==============================================================================
# --- [BLOCO: FALTAS E PERÍODOS AQUISITIVOS] ---
# ==============================================================================

def absence_dates_by_employee(db: Session, employee_ids: Iterable[int]) -> Dict[int, List[date]]:
    """Datas de FALTA (injustificada) registradas na escala, por colaborador."""
    ids = list(employee_ids)
    out: Dict[int, List[date]] = {i: [] for i in ids}
    if not ids:
        return out
    rows = db.query(models.RHWorkDay.employee_id, models.RHWorkDay.day,
                    models.RHMonthlySchedule.year, models.RHMonthlySchedule.month).join(
        models.RHMonthlySchedule, models.RHWorkDay.schedule_id == models.RHMonthlySchedule.id
    ).filter(models.RHWorkDay.employee_id.in_(ids), models.RHWorkDay.status == "FALTA").all()
    for emp_id, day, year, month in rows:
        out.setdefault(emp_id, []).append(date(year, month, day))
    return out


def build_period(admission: date, index: int, vacations: List[Any], absences: List[date], today: date,
                 settlement: Optional[Any] = None) -> Dict[str, Any]:
    """Situação do período; com `settlement` (quitação sem datas) o saldo restante é zerado."""
    start, end, concessive_end = acquisition_bounds(admission, index)
    period_absences = sum(1 for d in absences if start <= d <= end)
    entitled = entitlement_for_absences(period_absences)
    own = [v for v in vacations if v.acquisition_start == start and v.status in ACTIVE_STATUSES]
    gozo = sum(int(v.days or 0) for v in own)
    abono = sum(int(v.abono_days or 0) for v in own)
    balance = entitled - gozo - abono
    acquired = today > end
    enjoyed_all = all(v.status == "HISTORICO" or (v.status == "CONFIRMADA" and vacation_end(v) < today) for v in own)

    if settlement is not None:
        status = "REGULARIZADO"
        balance = 0
    elif entitled == 0:
        status = "SEM_DIREITO"
    elif balance <= 0:
        status = "QUITADO" if enjoyed_all else "PROGRAMADO"
    elif not acquired:
        status = "EM_AQUISICAO"
    elif today > concessive_end:
        status = "VENCIDO"
    elif (concessive_end - today).days <= EXPIRING_ALERT_DAYS:
        status = "VENCENDO"
    else:
        status = "A_PROGRAMAR"

    # Último dia para iniciar o gozo de todo o saldo restante sem cair na dobra
    latest_start = concessive_end - timedelta(days=balance - 1) if balance > 0 else None
    return {
        "index": index,
        "number": index + 1,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "concessive_end": concessive_end.isoformat(),
        "latest_start": latest_start.isoformat() if latest_start else None,
        "days_to_deadline": (concessive_end - today).days,
        "acquired": acquired,
        "absences": period_absences,
        "entitled": entitled,
        "max_abono": max_abono_for(entitled),
        "gozo_days": gozo,
        "abono_days": abono,
        "fractions": sum(1 for v in own if int(v.days or 0) > 0),
        "balance": max(0, balance),
        "status": status,
        "status_label": PERIOD_STATUS_LABELS[status],
        "vacation_ids": [v.id for v in own],
        "settlement": {
            "id": settlement.id,
            "note": settlement.note,
            "created_at": settlement.created_at.isoformat() if settlement.created_at else None,
        } if settlement is not None else None,
    }


def employee_periods(emp: models.RHEmployee, vacations: List[Any], absences: List[date], today: date,
                     settlements: Optional[Dict[date, Any]] = None) -> List[Dict[str, Any]]:
    """Todos os períodos aquisitivos desde a admissão até o período em aquisição hoje."""
    settlements = settlements or {}
    if not emp.admission_date:
        return []
    periods = []
    index = 0
    limit = emp.termination_date or today
    while acquisition_bounds(emp.admission_date, index)[0] <= limit:
        start = acquisition_bounds(emp.admission_date, index)[0]
        periods.append(build_period(emp.admission_date, index, vacations, absences, today, settlements.get(start)))
        index += 1
    return periods


# ==============================================================================
# --- [BLOCO: DIAS DE REPOUSO (INÍCIO VEDADO)] ---
# ==============================================================================

class _RestCalendar:
    """Feriados (com cache por mês) e DSR do contrato do colaborador."""

    def __init__(self, db: Session, organization_id: int, emp: models.RHEmployee):
        self.db, self.org_id, self.emp = db, organization_id, emp
        self._holidays: Dict[Tuple[int, int], Dict[str, str]] = {}

    def holiday(self, d: date) -> Optional[str]:
        key = (d.year, d.month)
        if key not in self._holidays:
            self._holidays[key] = get_effective_holidays_map(self.db, self.org_id, d.year, d.month)
        return self._holidays[key].get(d.isoformat())

    def contract_rest(self, d: date) -> Optional[str]:
        cd = contract_day_on(self.emp.contracts, d)
        if cd is None:
            return "DSR" if d.weekday() == 6 else None
        return cd.rest

    def rest_label(self, d: date) -> Optional[str]:
        """'feriado (Nome)' ou 'DSR' quando o dia é repouso remunerado."""
        name = self.holiday(d)
        if name:
            return f"feriado ({name})"
        return "DSR" if self.contract_rest(d) == "DSR" else None


# ==============================================================================
# --- [BLOCO: VALIDAÇÃO DA PROGRAMAÇÃO] ---
# ==============================================================================

def validate_vacation(
    db: Session,
    organization_id: int,
    emp: models.RHEmployee,
    acquisition_start: Optional[date],
    start_date: Optional[date],
    days: int,
    abono_days: int,
    payment_date: Optional[date],
    historical: bool = False,
    exclude_id: Optional[int] = None,
    today: Optional[date] = None,
    abono_start: Optional[date] = None,
) -> Dict[str, Any]:
    """
    Regras da CLT para a fração de férias. `errors` impedem salvar; `warnings` são avisos ao operador.
    Devolve também o período aquisitivo, as datas derivadas e os dias que caem na dobra (art. 137).
    """
    today = today or date.today()
    errors: List[str] = []
    warnings: List[str] = []
    result: Dict[str, Any] = {"errors": errors, "warnings": warnings, "period": None, "end_date": None,
                              "return_date": None, "doubled_days": 0,
                              "payment_date": payment_date.isoformat() if payment_date else None}
    days = int(days or 0)
    abono_days = int(abono_days or 0)

    if not emp.admission_date:
        errors.append("Informe a data de admissão do colaborador para calcular os períodos de férias.")
        return result
    if acquisition_start is None:
        errors.append("Escolha o período aquisitivo.")
        return result
    index = period_index_of(emp.admission_date, acquisition_start)
    if index is None:
        errors.append("Período aquisitivo inválido para a data de admissão do colaborador.")
        return result
    if start_date is None:
        errors.append("Informe a data de início das férias.")
        return result
    if days < 0 or abono_days < 0:
        errors.append("Quantidade de dias inválida.")
        return result
    if days == 0:
        errors.append("Informe os dias de gozo (o abono pecuniário acompanha um período de gozo).")
        return result

    others = db.query(models.RHVacation).filter(
        models.RHVacation.employee_id == emp.id,
        models.RHVacation.status.in_(ACTIVE_STATUSES),
        *([models.RHVacation.id != exclude_id] if exclude_id else [])
    ).all()
    absences = absence_dates_by_employee(db, [emp.id])[emp.id]
    settlement = db.query(models.RHVacationSettlement).filter(
        models.RHVacationSettlement.employee_id == emp.id,
        models.RHVacationSettlement.acquisition_start == acquisition_start
    ).first()
    period = build_period(emp.admission_date, index, others, absences, today, settlement)
    result["period"] = period
    if settlement is not None:
        errors.append("Este período foi quitado na regularização de férias antigas: desfaça a quitação para programar férias nele.")
        return result
    acq_end = date.fromisoformat(period["end"])
    concessive_end = date.fromisoformat(period["concessive_end"])
    entitled = period["entitled"]

    end_date = start_date + timedelta(days=days - 1)
    result["end_date"] = end_date.isoformat()
    result["return_date"] = (end_date + timedelta(days=1)).isoformat()
    suggested_payment = start_date - timedelta(days=PAYMENT_ADVANCE_DAYS)
    result["suggested_payment_date"] = suggested_payment.isoformat()
    if payment_date is None:
        payment_date = suggested_payment
        result["payment_date"] = payment_date.isoformat()

    # Saldo e abono do período
    if entitled == 0:
        errors.append(f"Sem direito a férias neste período: {period['absences']} faltas injustificadas (art. 130).")
        return result
    used = period["gozo_days"] + period["abono_days"]
    if used + days + abono_days > entitled:
        errors.append(
            f"O período dá direito a {entitled} dias e já há {used} programado(s): "
            f"restam {max(0, entitled - used)} dia(s) entre gozo e abono."
        )
    abono_room = period["max_abono"] - period["abono_days"]
    if abono_days > abono_room:
        errors.append(
            f"Abono pecuniário limitado a 1/3 do direito ({period['max_abono']} dias; "
            f"disponível: {max(0, abono_room)}) (art. 143)."
        )

    # Sobreposição com outras férias do colaborador (qualquer período)
    for o in others:
        o_end = vacation_end(o)
        if o.start_date <= end_date and start_date <= o_end:
            errors.append(f"Sobrepõe as férias de {_br(o.start_date)} a {_br(o_end)}.")

    # Período do abono: dias trabalhados pagos como abono, fora de qualquer gozo
    if abono_days and abono_start is not None:
        a_end = abono_start + timedelta(days=abono_days - 1)
        result["abono_end_date"] = a_end.isoformat()
        if abono_start <= end_date and start_date <= a_end:
            errors.append("O período do abono não pode coincidir com os dias de gozo.")
        for o in others:
            o_end = vacation_end(o)
            if o.start_date <= a_end and abono_start <= o_end:
                errors.append(f"O abono coincide com as férias de {_br(o.start_date)} a {_br(o_end)}.")

    if emp.termination_date and end_date >= emp.termination_date:
        errors.append(f"O colaborador tem desligamento em {_br(emp.termination_date)}.")

    if historical:
        return result

    # Fracionamento (art. 134 §1º)
    fractions = [int(o.days or 0) for o in others if o.acquisition_start == acquisition_start and int(o.days or 0) > 0] + [days]
    total_abono = period["abono_days"] + abono_days
    remaining = entitled - used - days - abono_days
    remaining_abono_room = abono_room - abono_days
    if days < MIN_FRACTION_DAYS:
        errors.append(f"Cada período de férias deve ter no mínimo {MIN_FRACTION_DAYS} dias corridos (art. 134 §1º).")
    if len(fractions) > MAX_FRACTIONS:
        errors.append(f"As férias podem ser divididas em no máximo {MAX_FRACTIONS} períodos (art. 134 §1º).")
    elif len(fractions) > 1 and entitled - total_abono < MIN_MAIN_FRACTION_DAYS + MIN_FRACTION_DAYS:
        errors.append(f"Com {entitled - total_abono} dias de gozo no período, as férias não podem ser fracionadas.")
    else:
        main_needed = min(MIN_MAIN_FRACTION_DAYS, entitled - total_abono)
        if max(fractions) < main_needed and (len(fractions) >= MAX_FRACTIONS or remaining < main_needed):
            errors.append(
                f"Uma das frações deve ter no mínimo {MIN_MAIN_FRACTION_DAYS} dias corridos "
                f"e as demais no mínimo {MIN_FRACTION_DAYS} (art. 134 §1º)."
            )
        if 0 < remaining and (remaining < MIN_FRACTION_DAYS or len(fractions) >= MAX_FRACTIONS):
            if remaining <= remaining_abono_room:
                warnings.append(
                    f"Sobrariam {remaining} dia(s) no período, que não formam uma fração válida: "
                    f"converta-os em abono pecuniário ou ajuste os dias."
                )
            else:
                errors.append(
                    f"Sobrariam {remaining} dia(s) no período, que não poderiam ser gozados "
                    f"(mínimo de {MIN_FRACTION_DAYS} dias e até {MAX_FRACTIONS} frações)."
                )

    # Período aquisitivo completo antes do gozo
    if start_date <= acq_end:
        errors.append(f"O período aquisitivo só se completa em {_br(acq_end)}; as férias podem começar a partir de {_br(acq_end + timedelta(days=1))}.")

    # Início vedado: no próprio repouso ou nos 2 dias que antecedem feriado/DSR (art. 134 §3º; PN 100 TST)
    cal = _RestCalendar(db, organization_id, emp)
    rest = cal.rest_label(start_date)
    if rest:
        errors.append(f"As férias não podem começar em {rest} ({_br(start_date)}) (PN 100 TST).")
    else:
        for offset in (1, 2):
            d = start_date + timedelta(days=offset)
            rest_ahead = cal.rest_label(d)
            if rest_ahead:
                errors.append(
                    f"É vedado iniciar as férias nos 2 dias que antecedem {rest_ahead} em {_br(d)} (art. 134 §3º)."
                )
                break
        if start_date.weekday() == 5 or cal.contract_rest(start_date) == "FOLGA":
            warnings.append("Início em sábado ou dia de folga do contrato: evite (Precedente Normativo 100 do TST).")

    # Dobra: dias gozados após o fim do período concessivo (art. 137)
    doubled = sum(1 for i in range(days) if start_date + timedelta(days=i) > concessive_end)
    result["doubled_days"] = doubled
    if doubled:
        warnings.append(
            f"{doubled} dia(s) após o fim do período concessivo ({_br(concessive_end)}): "
            f"remuneração em dobro (art. 137)."
        )

    if start_date < today:
        warnings.append("A data de início já passou.")
    elif (start_date - today).days < NOTICE_DAYS:
        warnings.append(f"O aviso de férias deve ser dado com {NOTICE_DAYS} dias de antecedência (art. 135).")
    if abono_days and today > acq_end - timedelta(days=ABONO_REQUEST_DAYS):
        warnings.append(
            f"Abono requerido após {_br(acq_end - timedelta(days=ABONO_REQUEST_DAYS))} "
            f"(15 dias antes do fim do período aquisitivo): depende da concordância do empregador (art. 143 §1º)."
        )
    if payment_date > suggested_payment:
        warnings.append(f"O pagamento deve ser feito até {_br(suggested_payment)}, 2 dias antes do início (art. 145).")
    return result


# ==============================================================================
# --- [BLOCO: CÁLCULO DO RECIBO DE FÉRIAS] ---
# ==============================================================================

def variable_average(db: Session, emp: models.RHEmployee, acq_start: date, acq_end: date) -> float:
    """Média mensal das horas extras e reflexos lançados nas folhas do período aquisitivo (12 meses)."""
    first, last = acq_start.year * 12 + acq_start.month, acq_end.year * 12 + acq_end.month
    rows = db.query(models.RHPayrollEntry.amount).join(
        models.RHPayrollItem, models.RHPayrollEntry.item_id == models.RHPayrollItem.id
    ).join(
        models.RHMonthlySchedule, models.RHPayrollEntry.schedule_id == models.RHMonthlySchedule.id
    ).filter(
        models.RHPayrollEntry.employee_id == emp.id,
        models.RHPayrollItem.system_key.in_(VARIABLE_KEYS),
        (models.RHMonthlySchedule.year * 12 + models.RHMonthlySchedule.month) >= first,
        (models.RHMonthlySchedule.year * 12 + models.RHMonthlySchedule.month) <= last,
    ).all()
    return round(sum(float(r[0] or 0.0) for r in rows) / 12, 2)


def calculate_vacation_pay(
    db: Session,
    organization_id: int,
    emp: models.RHEmployee,
    acquisition_start: date,
    acquisition_end: date,
    start_date: date,
    days: int,
    abono_days: int,
    doubled_days: int = 0,
    advance_13th: bool = False,
    variable_override: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Valores do recibo de férias (estimativa; a contabilidade apura o definitivo):
    férias + 1/3 tributam INSS, IRRF e FGTS; abono pecuniário + 1/3 e a dobra do art. 137 não integram
    a base do INSS/FGTS (Lei 8.212 art. 28 §9º, "d" e "e"); abono e seu 1/3 são isentos de IRRF.
    """
    role = emp.role_obj
    salary = salary_on(role, get_salary_history(db, emp.role_id), start_date) if role else 0.0
    if not salary:
        salary = float(emp.base_salary or 0.0)
    items = ensure_system_items(db, organization_id)
    triennium_item = items["TRIENIO"]
    triennia = completed_triennia(emp.admission_date, start_date)
    triennium = salary * float(triennium_item.default_value or 0.0) / 100 * triennia if triennium_item.active else 0.0
    auto_avg = variable_average(db, emp, acquisition_start, acquisition_end)
    average = float(variable_override) if variable_override is not None else auto_avg
    remuneration = round(salary + triennium + average, 2)
    daily = remuneration / 30
    triennium_pct = float(triennium_item.default_value or 0.0) * triennia

    # Como no recibo da contabilidade: salário, triênio e médias dos dias de gozo em rubricas separadas,
    # cada uma arredondada; o 1/3 incide sobre a soma delas. O abono usa a remuneração inteira.
    ferias = round(salary / 30 * days, 2)
    ferias_trienio = round(triennium / 30 * days, 2)
    ferias_medias = round(average / 30 * days, 2)
    terco = round((ferias + ferias_trienio + ferias_medias) / 3, 2)
    dobra = round(daily * doubled_days, 2)
    terco_dobra = round(dobra / 3, 2)
    abono = round(daily * abono_days, 2)
    terco_abono = round(abono / 3, 2)
    advance = round(remuneration / 2, 2) if advance_13th else 0.0

    inss_base = round(ferias + ferias_trienio + ferias_medias + terco, 2)
    inss = calc_inss(inss_base)
    irrf_base = round(inss_base + dobra + terco_dobra, 2)
    irrf = calc_irrf(irrf_base, inss, int(emp.dependents or 0))
    fgts = round(inss_base * FGTS_RATE, 2)

    # Códigos iguais aos do recibo de férias da contabilidade (009, 046, 597, 598, 716, 999, 902)
    receipts = [
        {"key": "FERIAS", "code": "009", "label": "Férias", "reference": f"{days} dia(s)", "amount": ferias},
        {"key": "FERIAS_TRIENIO", "code": "046", "label": f"Triênio {triennium_pct:g}%", "reference": f"{days} dia(s)", "amount": ferias_trienio},
        {"key": "FERIAS_MEDIAS", "code": None, "label": "Médias de variáveis sobre férias", "reference": f"{days} dia(s)", "amount": ferias_medias},
        {"key": "FERIAS_TERCO", "code": "597", "label": "1/3 Férias", "reference": "1/3", "amount": terco},
        {"key": "FERIAS_DOBRA", "code": None, "label": "Férias em dobro (art. 137)", "reference": f"{doubled_days} dia(s)", "amount": dobra},
        {"key": "FERIAS_DOBRA_TERCO", "code": None, "label": "1/3 sobre a dobra", "reference": "1/3", "amount": terco_dobra},
        {"key": "ABONO", "code": "598", "label": "Abono de Férias", "reference": f"{abono_days} dia(s)", "amount": abono},
        {"key": "ABONO_TERCO", "code": "716", "label": "1/3 sobre Abono de Férias", "reference": "1/3", "amount": terco_abono},
        {"key": "ADIANT_13", "code": None, "label": "Adiantamento 13º salário (1ª parcela)", "reference": "50%", "amount": advance},
    ]
    discounts_lines = [
        {"key": "INSS", "code": "902", "label": "INSS Férias", "reference": f"base {inss_base:.2f}", "amount": inss},
        {"key": "IRRF", "code": None, "label": "IRRF Férias", "reference": f"base {irrf_base:.2f}", "amount": irrf},
    ]
    for line in receipts:
        line["kind"] = "RECEITA"
    for line in discounts_lines:
        line["kind"] = "DESPESA"

    # Arredondamento (999): completa o líquido até o próximo real inteiro (sem incidências)
    raw_cents = round(sum(l["amount"] for l in receipts) * 100) - round(sum(l["amount"] for l in discounts_lines) * 100)
    rounding = ((-raw_cents) % 100) / 100 if raw_cents > 0 else 0.0
    receipts.append({"key": "ARRED", "code": "999", "label": "Arredondamento", "reference": "", "amount": rounding, "kind": "RECEITA"})

    lines = [l for l in receipts + discounts_lines if l["amount"] > 0]
    gross = round(sum(l["amount"] for l in lines if l["kind"] == "RECEITA"), 2)
    discounts = round(sum(l["amount"] for l in lines if l["kind"] == "DESPESA"), 2)
    return {
        "salary": round(salary, 2),
        "triennium": round(triennium, 2),
        "triennia": triennia,
        "variable_average": round(average, 2),
        "variable_average_auto": auto_avg,
        "variable_average_manual": variable_override is not None,
        "remuneration": remuneration,
        "daily_rate": round(daily, 2),
        "lines": lines,
        "gross": gross,
        "discounts": discounts,
        "net": round(gross - discounts, 2),
        "rounding": rounding,
        "fgts": fgts,
    }


# ==============================================================================
# --- [BLOCO: MARCAÇÃO DAS FÉRIAS NA ESCALA] ---
# ==============================================================================

def _day_state(rec: Optional[models.RHWorkDay]) -> Optional[Dict[str, Any]]:
    """Estado completo do dia antes das férias, para restaurá-lo ao desfazer a confirmação."""
    if rec is None:
        return None
    return {
        **snapshot_day(rec),
        "raw_minutes": int(rec.raw_minutes or 0),
        "is_manual": bool(rec.is_manual),
        "vt_tickets_override": rec.vt_tickets_override,
        "va_override": rec.va_override,
        "late_decision": rec.late_decision,
        "is_late_record": bool(rec.is_late_record),
    }


def apply_to_schedule(db: Session, organization_id: int, emp: models.RHEmployee, v: models.RHVacation,
                      user_id: Optional[int]) -> Set[int]:
    """Marca os dias de gozo como FERIAS (dia manual, protegido do lote). Devolve as escalas alteradas."""
    dates = vacation_dates(v)
    for d in dates:
        schedule = _schedule_for(db, organization_id, d, create=False)
        if schedule is not None and schedule.status == "CLOSED":
            raise ValueError(f"A folha de {d.month:02d}/{d.year} está fechada: as férias não podem ser marcadas na escala.")
        rec = _work_day(db, schedule, emp.id, d)
        if rec is not None and rec.status in CONFLICT_STATUSES:
            raise ValueError(f"{d.strftime('%d/%m/%Y')} está registrado como {CONFLICT_STATUSES[rec.status]} na escala.")

    applied = list(v.applied_days or [])
    known = {a["date"] for a in applied}
    touched: Set[int] = set()
    for d in dates:
        schedule = _schedule_for(db, organization_id, d, create=True)
        rec = _work_day(db, schedule, emp.id, d)
        if rec is not None and rec.status == "FERIAS" and d.isoformat() in known:
            continue
        before = snapshot_day(rec)
        if d.isoformat() not in known:
            applied.append({"date": d.isoformat(), "before": _day_state(rec)})
        if rec is None:
            rec = models.RHWorkDay(schedule_id=schedule.id, employee_id=emp.id, day=d.day)
            db.add(rec)
        rec.status = "FERIAS"
        rec.start_time = rec.lunch_start = rec.lunch_end = rec.end_time = None
        rec.raw_minutes = rec.worked_minutes = 0
        rec.vt_tickets_override = None
        rec.va_override = None
        rec.late_decision = None
        rec.is_late_record = False
        rec.is_manual = True
        record_change(db, organization_id, schedule, emp.id, d.day, before, snapshot_day(rec), SCHEDULE_ORIGIN, user_id)
        touched.add(schedule.id)
    v.applied_days = applied
    db.flush()
    return touched


def revert_from_schedule(db: Session, organization_id: int, emp: models.RHEmployee, v: models.RHVacation,
                         user_id: Optional[int]) -> Set[int]:
    """Devolve à escala o estado anterior dos dias que ainda estão como FERIAS por esta programação."""
    applied = list(v.applied_days or [])
    for a in applied:
        d = date.fromisoformat(a["date"])
        schedule = _schedule_for(db, organization_id, d, create=False)
        if schedule is not None and schedule.status == "CLOSED":
            raise ValueError(f"A folha de {d.month:02d}/{d.year} está fechada: as férias não podem ser desfeitas na escala.")

    touched: Set[int] = set()
    for a in applied:
        d = date.fromisoformat(a["date"])
        schedule = _schedule_for(db, organization_id, d, create=False)
        rec = _work_day(db, schedule, emp.id, d)
        if rec is None or rec.status != "FERIAS":
            continue  # Dia alterado depois da confirmação: preserva a alteração
        before = snapshot_day(rec)
        prev = a.get("before")
        if prev is None:
            db.delete(rec)
            after = None
        else:
            rec.status = prev["status"]
            for f in ("start_time", "lunch_start", "lunch_end", "end_time", "vt_tickets_override",
                      "va_override", "late_decision"):
                setattr(rec, f, prev.get(f))
            rec.worked_minutes = prev.get("worked_minutes", 0)
            rec.raw_minutes = prev.get("raw_minutes", rec.worked_minutes)
            rec.is_manual = prev.get("is_manual", False)
            rec.is_late_record = prev.get("is_late_record", False)
            after = snapshot_day(rec)
        record_change(db, organization_id, schedule, emp.id, d.day, before, after, SCHEDULE_ORIGIN, user_id)
        touched.add(schedule.id)
    v.applied_days = None
    db.flush()
    return touched


# ==============================================================================
# --- [BLOCO: SERIALIZAÇÃO] ---
# ==============================================================================

def vacation_phase(v: models.RHVacation, today: date) -> str:
    """Situação exibida: PROGRAMADA, CONFIRMADA, EM_GOZO, GOZADA, HISTORICO ou CANCELADA."""
    if v.status != "CONFIRMADA":
        return v.status
    if vacation_end(v) < today:
        return "GOZADA"
    if v.start_date <= today:
        return "EM_GOZO"
    return "CONFIRMADA"


def vacation_to_dict(v: models.RHVacation, today: date, marked_dates: Optional[Set[date]] = None) -> Dict[str, Any]:
    end = vacation_end(v)
    missing = None
    if v.status == "CONFIRMADA" and marked_dates is not None:
        missing = sum(1 for d in vacation_dates(v) if d not in marked_dates)
    return {
        "id": v.id,
        "employee_id": v.employee_id,
        "employee_name": v.employee.name if v.employee else None,
        "acquisition_start": v.acquisition_start.isoformat(),
        "acquisition_end": v.acquisition_end.isoformat(),
        "start_date": v.start_date.isoformat(),
        "end_date": end.isoformat(),
        "return_date": (end + timedelta(days=1)).isoformat(),
        "days": int(v.days or 0),
        "abono_days": int(v.abono_days or 0),
        "abono_start_date": v.abono_start_date.isoformat() if v.abono_start_date and v.abono_days else None,
        "abono_end_date": abono_end(v).isoformat() if abono_end(v) else None,
        "advance_13th": bool(v.advance_13th),
        "payment_date": v.payment_date.isoformat() if v.payment_date else None,
        "notice_date": v.notice_date.isoformat() if v.notice_date else None,
        "variable_average": v.variable_average,
        "status": v.status,
        "phase": vacation_phase(v, today),
        "schedule_missing_days": missing,
        "calc": v.calc,
        "notes": v.notes,
    }


def marked_vacation_dates(db: Session, employee_ids: Iterable[int]) -> Dict[int, Set[date]]:
    """Dias marcados como FERIAS na escala, por colaborador (para conferir as férias confirmadas)."""
    ids = list(employee_ids)
    out: Dict[int, Set[date]] = {i: set() for i in ids}
    if not ids:
        return out
    rows = db.query(models.RHWorkDay.employee_id, models.RHWorkDay.day,
                    models.RHMonthlySchedule.year, models.RHMonthlySchedule.month).join(
        models.RHMonthlySchedule, models.RHWorkDay.schedule_id == models.RHMonthlySchedule.id
    ).filter(models.RHWorkDay.employee_id.in_(ids), models.RHWorkDay.status == "FERIAS").all()
    for emp_id, day, year, month in rows:
        out.setdefault(emp_id, set()).add(date(year, month, day))
    return out


def build_overview(db: Session, organization_id: int, today: Optional[date] = None) -> Dict[str, Any]:
    """Controle de férias: períodos de cada colaborador ativo, agenda e totais de alerta."""
    today = today or date.today()
    employees = db.query(models.RHEmployee).filter(
        models.RHEmployee.organization_id == organization_id,
        models.RHEmployee.active == True
    ).order_by(models.RHEmployee.name.asc()).all()
    emp_ids = [e.id for e in employees]
    vacations = db.query(models.RHVacation).filter(
        models.RHVacation.organization_id == organization_id
    ).order_by(models.RHVacation.start_date.asc()).all()
    by_emp: Dict[int, List[models.RHVacation]] = {}
    for v in vacations:
        by_emp.setdefault(v.employee_id, []).append(v)
    absences = absence_dates_by_employee(db, emp_ids)
    marked = marked_vacation_dates(db, emp_ids)
    settlements_by_emp: Dict[int, Dict[date, models.RHVacationSettlement]] = {}
    for st in db.query(models.RHVacationSettlement).filter(
        models.RHVacationSettlement.organization_id == organization_id
    ).all():
        settlements_by_emp.setdefault(st.employee_id, {})[st.acquisition_start] = st

    rows = []
    summary = {"vencidos": 0, "vencendo": 0, "a_programar": 0, "programadas": 0, "em_gozo": 0, "sem_admissao": 0}
    for emp in employees:
        periods = employee_periods(emp, by_emp.get(emp.id, []), absences.get(emp.id, []), today,
                                   settlements_by_emp.get(emp.id))
        if not emp.admission_date:
            summary["sem_admissao"] += 1
        for p in periods:
            if p["status"] == "VENCIDO":
                summary["vencidos"] += 1
            elif p["status"] == "VENCENDO":
                summary["vencendo"] += 1
            elif p["status"] == "A_PROGRAMAR":
                summary["a_programar"] += 1
        rows.append({
            "id": emp.id,
            "name": emp.name,
            "role": emp.role_obj.name if emp.role_obj else emp.role,
            "team": emp.team_obj.name if emp.team_obj else emp.team,
            "admission_date": emp.admission_date.isoformat() if emp.admission_date else None,
            "periods": periods,
        })

    active_ids = set(emp_ids)
    agenda = []
    for v in vacations:
        if v.employee_id not in active_ids:
            continue
        item = vacation_to_dict(v, today, marked.get(v.employee_id))
        if item["phase"] in ("PROGRAMADA", "CONFIRMADA"):
            summary["programadas"] += 1
        elif item["phase"] == "EM_GOZO":
            summary["em_gozo"] += 1
        agenda.append(item)
    return {"today": today.isoformat(), "employees": rows, "vacations": agenda, "summary": summary}


# ==============================================================================
# --- [BLOCO: REGULARIZAÇÃO DE PERÍODOS ANTIGOS (QUITAÇÃO SEM DATAS)] ---
# ==============================================================================

def settle_periods(db: Session, organization_id: int, items: List[Tuple[int, date]], note: Optional[str],
                   user_id: Optional[int], today: Optional[date] = None) -> Dict[str, Any]:
    """
    Quita períodos aquisitivos já completos sem informar as datas de gozo (férias anteriores ao sistema).
    Períodos já quitados são ignorados; períodos inválidos ou ainda em aquisição são recusados.
    """
    today = today or date.today()
    created, skipped = 0, 0
    errors: List[str] = []
    employees: Dict[int, models.RHEmployee] = {}
    for employee_id, acquisition_start in items:
        emp = employees.get(employee_id)
        if emp is None:
            emp = db.query(models.RHEmployee).filter(
                models.RHEmployee.id == employee_id,
                models.RHEmployee.organization_id == organization_id
            ).first()
            if emp is None:
                errors.append(f"Colaborador {employee_id} não encontrado.")
                continue
            employees[employee_id] = emp
        if not emp.admission_date or period_index_of(emp.admission_date, acquisition_start) is None:
            errors.append(f"{emp.name}: período aquisitivo {_br(acquisition_start)} inválido.")
            continue
        _, end, _ = acquisition_bounds(emp.admission_date, period_index_of(emp.admission_date, acquisition_start))
        if end >= today:
            errors.append(f"{emp.name}: o período {_br(acquisition_start)} a {_br(end)} ainda está em aquisição.")
            continue
        exists = db.query(models.RHVacationSettlement.id).filter(
            models.RHVacationSettlement.employee_id == emp.id,
            models.RHVacationSettlement.acquisition_start == acquisition_start
        ).first()
        if exists:
            skipped += 1
            continue
        db.add(models.RHVacationSettlement(
            organization_id=organization_id, employee_id=emp.id, acquisition_start=acquisition_start,
            note=(note or "").strip() or None, created_by=user_id
        ))
        created += 1
    db.flush()
    return {"created": created, "skipped": skipped, "errors": errors}
