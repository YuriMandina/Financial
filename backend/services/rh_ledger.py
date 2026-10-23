"""
Apuração Única de Horas (Ledger Diário)
Hora extra = excedente da jornada contratada do dia + excedente do limite semanal, sem dupla contagem;
compensação no período, troca de repouso, tolerância e atrasos. Planejamento: docs/conformidade-clt (v05, seção 6).

Este módulo é puro (sem banco); o bloco final adapta os registros ORM.
"""

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Callable, Dict, Iterable, List, Optional, Set

from services.rh_contracts import ContractDay, Regime, contract_day_on, default_regimes, regime_on
from services.rh_engine import parse_time_to_minutes
from services.rh_holidays_service import get_effective_holidays_map

MAX_COMPENSABLE_DAY_MIN = 600  # Dias acima de 10h não são compensáveis (art. 59, §2º)
REST_SWAP_WINDOW_DAYS = 6
TOLERANCE_PER_MARK_MIN = 5   # CLT art. 58, §1º
TOLERANCE_PER_DAY_MIN = 10

NOT_EXPECTED_STATUSES = ("FERIADO", "FERIAS", "ATESTADO", "FALTA")

# ==============================================================================
# --- [BLOCO: ESTRUTURAS DE ENTRADA E SAÍDA] ---
# ==============================================================================


@dataclass
class DayInput:
    date: date
    status: str
    start_time: Optional[str] = None
    lunch_start: Optional[str] = None
    lunch_end: Optional[str] = None
    end_time: Optional[str] = None
    worked_minutes: int = 0
    late_decision: Optional[str] = None  # ACEITAR_COMPENSACAO | ABONAR | NORMAL
    # Atraso só existe em horário registrado como ponto; remanejamento planejado não é atraso
    track_late: bool = True


@dataclass
class LedgerSettings:
    compensation_regime: str = "MONTHLY"  # WEEKLY | MONTHLY | BANK_6M
    week_start: int = 0  # 0 = segunda
    tolerance_enabled: bool = True
    late_waiver_auto_min: int = 0
    late_compensation_mode: str = "AUTO"  # AUTO | MANUAL | OFF
    late_compensation_max_min: int = 30
    late_compensation_max_per_month: int = 4

    @classmethod
    def from_settings(cls, s) -> "LedgerSettings":
        if s is None:
            return cls()

        def val(name, default):
            v = getattr(s, name, None)
            return default if v is None else v

        return cls(
            compensation_regime=val("compensation_regime", "MONTHLY"),
            week_start=int(val("week_start", 0)),
            tolerance_enabled=bool(val("clt_tolerance_enabled", True)),
            late_waiver_auto_min=int(val("late_waiver_auto_min", 0)),
            late_compensation_mode=val("late_compensation_mode", "AUTO"),
            late_compensation_max_min=int(val("late_compensation_max_min", 30)),
            late_compensation_max_per_month=int(val("late_compensation_max_per_month", 4)),
        )


@dataclass
class DayLedger:
    date: date
    status: str
    is_holiday: bool = False
    contracted_min: int = 0
    worked_min: int = 0
    normal_min: int = 0
    extra_min: int = 0
    extra_daily_min: int = 0
    extra_weekly_min: int = 0
    short_min: int = 0          # Débito do trabalhador (saída antecipada, folga de banco)
    reduction_min: int = 0      # Folga concedida em dia de contrato: só abate excedente, nunca vira débito
    compensated_min: int = 0
    rest_swap_with: Optional[date] = None
    rest_worked_unpaid_double: bool = False
    late_min: int = 0
    late_waived_min: int = 0
    late_compensated_min: int = 0
    late_pending_decision: bool = False
    no_contract: bool = False
    # Uso interno
    _short_late: int = field(default=0, repr=False)
    _contract: Optional[ContractDay] = field(default=None, repr=False)
    _input: Optional[DayInput] = field(default=None, repr=False)

    @property
    def extra_kind(self) -> Optional[str]:
        if self.extra_min <= 0:
            return None
        return "SEMANAL" if self.extra_daily_min <= 0 < self.extra_weekly_min else "DIARIA"

    def to_dict(self) -> Dict:
        return {
            "date": self.date.isoformat(),
            "contracted_min": self.contracted_min,
            "worked_min": self.worked_min,
            "normal_min": self.normal_min,
            "extra_min": self.extra_min,
            "extra_kind": self.extra_kind,
            "short_min": self.short_min,
            "reduction_min": self.reduction_min,
            "compensated_min": self.compensated_min,
            "rest_swap_with": self.rest_swap_with.isoformat() if self.rest_swap_with else None,
            "rest_worked_unpaid_double": self.rest_worked_unpaid_double,
            "late_min": self.late_min,
            "late_waived_min": self.late_waived_min,
            "late_compensated_min": self.late_compensated_min,
            "late_pending_decision": self.late_pending_decision,
            "no_contract": self.no_contract,
        }


# ==============================================================================
# --- [BLOCO: AUXILIARES DE CALENDÁRIO] ---
# ==============================================================================

def week_key(d: date, week_start: int) -> date:
    """Primeiro dia da semana (conforme o início configurado) que contém a data."""
    return d - timedelta(days=(d.weekday() - week_start) % 7)


def _mark_diff(actual: Optional[str], expected: Optional[str]) -> Optional[int]:
    a, e = parse_time_to_minutes(actual), parse_time_to_minutes(expected)
    if a is None or e is None:
        return None
    diff = a - e
    # Marcações próximas da meia-noite: escolhe a menor distância
    if diff > 720:
        diff -= 1440
    elif diff < -720:
        diff += 1440
    return diff


# ==============================================================================
# --- [BLOCO: MOTOR DO LEDGER] ---
# ==============================================================================

def build_ledger(
    days: Iterable[DayInput],
    contract_resolver: Callable[[date], Optional[ContractDay]],
    holidays: Set[date],
    settings: Optional[LedgerSettings] = None,
    regimes: Optional[List[Regime]] = None,
    period: Optional[tuple] = None,
) -> Dict[date, DayLedger]:
    """
    Calcula o ledger diário. `days` pode incluir dias de contexto (semanas que cruzam o mês);
    `period` (início, fim) limita os dias devolvidos.
    """
    settings = settings or LedgerSettings()
    regimes = regimes or default_regimes()
    ordered = sorted(days, key=lambda x: x.date)
    led: Dict[date, DayLedger] = {}

    # 1. Base: jornada contratada do dia, reduções e folgas de banco
    for di in ordered:
        cd = contract_resolver(di.date)
        contract_min = cd.minutes if cd and cd.is_work else 0
        is_holiday = di.date in holidays
        dl = DayLedger(date=di.date, status=di.status, is_holiday=is_holiday, _contract=cd, _input=di)
        dl.no_contract = cd is None
        if di.status == "TRABALHO":
            dl.worked_min = int(di.worked_minutes or 0)
            if cd is None:
                # Sem contrato vigente na data: não há referência para apurar extra ou débito
                dl.contracted_min = dl.worked_min
            else:
                dl.contracted_min = 0 if is_holiday else contract_min
        elif di.status in ("DSR", "FOLGA"):
            dl.reduction_min = 0 if is_holiday else contract_min
        elif di.status == "FOLGA_BH":
            dl.contracted_min = 0 if is_holiday else contract_min
            dl.short_min = dl.contracted_min
        led[di.date] = dl

    # 2. Troca de repouso: repouso/feriado trabalhado ↔ dia de contrato dado como folga (seção 6.6)
    _pair_rest_swaps(led, settings.week_start)

    # 3. Diário: tolerância, atrasos e excedente sobre a jornada do dia
    late_auto_count: Dict[tuple, int] = {}
    for d in sorted(led):
        dl = led[d]
        if dl.status != "TRABALHO":
            continue
        _apply_daily(dl, settings, late_auto_count)

    # 4. Semanal: excedente do limite do regime, lançado no dia em que o limite foi ultrapassado
    weeks: Dict[date, List[DayLedger]] = {}
    for d in sorted(led):
        weeks.setdefault(week_key(d, settings.week_start), []).append(led[d])
    for wk_start, wk_days in weeks.items():
        limit = regime_on(regimes, wk_start + timedelta(days=6)).weekly_limit_min
        acc = 0
        for dl in wk_days:
            if dl.status != "TRABALHO":
                continue
            if acc + dl.normal_min > limit:
                excess = acc + dl.normal_min - limit
                dl.normal_min -= excess
                dl.extra_weekly_min += excess
                dl.extra_min += excess
            acc += dl.normal_min

    # 5. Compensação no período (Súmula 85; art. 59, §6º)
    if settings.compensation_regime in ("WEEKLY", "MONTHLY"):
        periods: Dict[object, List[DayLedger]] = {}
        for d in sorted(led):
            key = week_key(d, settings.week_start) if settings.compensation_regime == "WEEKLY" else (d.year, d.month)
            periods.setdefault(key, []).append(led[d])
        for p_days in periods.values():
            _compensate(p_days)

    if period:
        start, end = period
        return {d: dl for d, dl in led.items() if start <= d <= end}
    return led


def _pair_rest_swaps(led: Dict[date, DayLedger], week_start: int) -> None:
    worked_rest = [
        dl for dl in led.values()
        if dl.status == "TRABALHO" and (dl.is_holiday or (dl._contract is not None and not dl._contract.is_work))
    ]
    given_rest = [dl for dl in led.values() if dl.status in ("DSR", "FOLGA") and dl.reduction_min > 0]
    used: Set[date] = set()
    for wr in sorted(worked_rest, key=lambda x: x.date):
        candidates = [g for g in given_rest if g.date not in used and abs((g.date - wr.date).days) <= REST_SWAP_WINDOW_DAYS]
        if not candidates:
            if wr.is_holiday or (wr._contract is not None and wr._contract.rest == "DSR"):
                wr.rest_worked_unpaid_double = True
            continue
        same_week = [g for g in candidates if week_key(g.date, week_start) == week_key(wr.date, week_start)]
        pool = same_week or candidates
        g = min(pool, key=lambda x: (abs((x.date - wr.date).days), x.date))
        used.add(g.date)
        wr.contracted_min = g.reduction_min
        wr.rest_swap_with, g.rest_swap_with = g.date, wr.date
        g.reduction_min = 0
        # O horário de referência do dia trocado é o do dia de contrato que virou folga
        wr._contract = g._contract


def _apply_daily(dl: DayLedger, s: LedgerSettings, late_auto_count: Dict[tuple, int]) -> None:
    di, cd = dl._input, dl._contract
    worked = dl.worked_min
    contracted = dl.contracted_min

    if dl.no_contract:
        dl.normal_min = worked
        return
    if contracted <= 0:
        # Repouso/feriado trabalhado sem troca: todo o tempo é extra
        dl.extra_daily_min = worked
        dl.extra_min = worked
        return

    start_diff = _mark_diff(di.start_time, cd.start if cd and cd.is_work else None)
    end_diff = _mark_diff(di.end_time, cd.end if cd and cd.is_work else None)

    # Tolerância legal: até 5 min por marcação e 10 min no dia não são computados
    if (
        s.tolerance_enabled and start_diff is not None and end_diff is not None
        and abs(start_diff) <= TOLERANCE_PER_MARK_MIN and abs(end_diff) <= TOLERANCE_PER_MARK_MIN
        and abs(start_diff) + abs(end_diff) <= TOLERANCE_PER_DAY_MIN
        and abs(worked - contracted) <= TOLERANCE_PER_DAY_MIN
    ):
        dl.normal_min = contracted
        return

    late = max(0, start_diff or 0) if di.track_late else 0
    stayed_after = max(0, end_diff or 0) if di.track_late else 0
    waived = min(late, max(0, s.late_waiver_auto_min))
    if di.late_decision == "ABONAR":
        waived = late
    remaining = late - waived
    compensated = 0
    if remaining > 0 and stayed_after > 0:
        if di.late_decision == "ACEITAR_COMPENSACAO":
            compensated = min(remaining, stayed_after)
        elif di.late_decision == "NORMAL":
            compensated = 0
        else:
            month_key = (dl.date.year, dl.date.month)
            within = (
                s.late_compensation_mode == "AUTO"
                and remaining <= s.late_compensation_max_min
                and late_auto_count.get(month_key, 0) < s.late_compensation_max_per_month
            )
            if within:
                compensated = min(remaining, stayed_after)
                late_auto_count[month_key] = late_auto_count.get(month_key, 0) + 1
            else:
                dl.late_pending_decision = True

    dl.late_min, dl.late_waived_min, dl.late_compensated_min = late, waived, compensated
    worked_eff = worked + waived
    u_late, u_after = remaining - compensated, stayed_after - compensated
    base = worked_eff - contracted

    if u_late > 0 and u_after > 0:
        # Atraso não compensado: desconta o atraso e paga a permanência como extra
        other = base - (u_after - u_late)
        extra = u_after + max(0, other)
        short = u_late + max(0, -other)
        dl._short_late = u_late
    else:
        extra = max(0, base)
        short = max(0, -base)
        dl._short_late = min(short, u_late)

    dl.extra_daily_min = extra
    dl.extra_min = extra
    dl.short_min = short
    dl.normal_min = max(0, worked_eff - extra)


def _compensate(p_days: List[DayLedger]) -> None:
    excess = [dl for dl in p_days if dl.extra_min > 0 and dl.worked_min <= MAX_COMPENSABLE_DAY_MIN]
    # Débitos do trabalhador primeiro (exceto atraso não aceito), depois folgas concedidas
    deficits = [(dl, "short") for dl in p_days if dl.short_min - dl._short_late > 0 and dl.status == "TRABALHO"]
    deficits += [(dl, "reduction") for dl in p_days if dl.reduction_min > 0]
    for ex in excess:
        for df, kind in deficits:
            if ex.extra_min <= 0:
                break
            available = (df.short_min - df._short_late) if kind == "short" else df.reduction_min
            if available <= 0:
                continue
            take = min(ex.extra_min, available)
            ex.extra_min -= take
            ex.compensated_min += take
            # Extra compensada vira jornada normal; sai primeiro do excedente semanal
            from_weekly = min(take, ex.extra_weekly_min)
            ex.extra_weekly_min -= from_weekly
            ex.extra_daily_min -= take - from_weekly
            ex.normal_min += take
            if kind == "short":
                df.short_min -= take
            else:
                df.reduction_min -= take
            df.compensated_min += take


# ==============================================================================
# --- [BLOCO: ADAPTADOR ORM] ---
# ==============================================================================

def day_input_from_record(rec, d: date) -> DayInput:
    return DayInput(
        date=d,
        status=rec.status,
        start_time=rec.start_time,
        lunch_start=rec.lunch_start,
        lunch_end=rec.lunch_end,
        end_time=rec.end_time,
        worked_minutes=int(rec.worked_minutes or 0) if rec.status == "TRABALHO" else 0,
        late_decision=getattr(rec, "late_decision", None),
        track_late=bool(getattr(rec, "is_late_record", False)),
    )


def employee_month_ledger(
    employee,
    year: int,
    month: int,
    work_days_by_date: Dict[date, object],
    holidays: Set[date],
    settings=None,
    regimes: Optional[List[Regime]] = None,
) -> Dict[date, DayLedger]:
    """
    Ledger do mês de um colaborador. `work_days_by_date` deve trazer os registros do mês
    e, quando existirem, os do mês anterior (semana que cruza o dia 1).
    """
    import calendar
    num_days = calendar.monthrange(year, month)[1]
    start, end = date(year, month, 1), date(year, month, num_days)
    inputs = [day_input_from_record(rec, d) for d, rec in work_days_by_date.items() if rec is not None]
    contracts = list(getattr(employee, "contracts", None) or [])
    return build_ledger(
        inputs,
        lambda d: contract_day_on(contracts, d),
        holidays,
        LedgerSettings.from_settings(settings),
        regimes,
        period=(start, end),
    )


def _holiday_dates(db, organization_id: int, year: int, month: int) -> Set[date]:
    return {date.fromisoformat(k) for k in get_effective_holidays_map(db, organization_id, year, month).keys()}


def load_month_ledgers(db, organization_id: int, schedule, employees: List, settings=None) -> Dict[int, Dict[date, DayLedger]]:
    """
    Ledgers do mês para vários colaboradores, com o contexto do mês anterior
    (semanas e compensação semanal que cruzam o dia 1) e os feriados efetivos.
    """
    from models import models
    from services.rh_contracts import load_regimes

    year, month = schedule.year, schedule.month
    prev_year, prev_month = (year - 1, 12) if month == 1 else (year, month - 1)
    regimes = load_regimes(db)
    holidays = _holiday_dates(db, organization_id, year, month) | _holiday_dates(db, organization_id, prev_year, prev_month)

    by_emp: Dict[int, Dict[date, object]] = {emp.id: {} for emp in employees}
    for wd in db.query(models.RHWorkDay).filter(models.RHWorkDay.schedule_id == schedule.id).all():
        if wd.employee_id in by_emp:
            by_emp[wd.employee_id][date(year, month, wd.day)] = wd

    prev_schedule = db.query(models.RHMonthlySchedule).filter(
        models.RHMonthlySchedule.organization_id == organization_id,
        models.RHMonthlySchedule.year == prev_year,
        models.RHMonthlySchedule.month == prev_month
    ).first()
    if prev_schedule:
        # Só a última semana do mês anterior importa para o limite semanal
        first = date(year, month, 1)
        for wd in db.query(models.RHWorkDay).filter(
            models.RHWorkDay.schedule_id == prev_schedule.id,
            models.RHWorkDay.day >= (first - timedelta(days=7)).day
        ).all():
            if wd.employee_id in by_emp:
                by_emp[wd.employee_id][date(prev_year, prev_month, wd.day)] = wd

    return {
        emp.id: employee_month_ledger(emp, year, month, by_emp[emp.id], holidays, settings, regimes)
        for emp in employees
    }
