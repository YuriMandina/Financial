"""
Motor de Regras Trabalhistas (R01–R14)
Funções puras sobre o ledger diário e a escala: cada regra devolve irregularidades com causa,
evidências, base legal e consequências financeira e administrativa.
Planejamento: docs/conformidade-clt (v05, seções 7 e 8).
"""

import calendar
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from services.rh_contracts import Regime, contract_on, days_summary_label, parse_days, regime_on, weekly_minutes
from services.rh_engine import parse_time_to_minutes
from services.rh_ledger import DayLedger, week_key

SEVERITY_ORDER = {"CRITICA": 0, "ALERTA": 1, "INFO": 2}
WEEKDAY_NAMES = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo"]
REST_STATUSES = ("DSR", "FOLGA", "FERIADO", "FOLGA_BH")
MIN_REST_35H = 35 * 60

# ==============================================================================
# --- [BLOCO: TEXTOS LEGAIS E CONSEQUÊNCIAS] ---
# Pagar não regulariza: a consequência administrativa permanece (seção 8).
# ==============================================================================

ADMIN_FOOTER = "A multa do art. 75 da CLT é aplicada em dobro em caso de reincidência. Pagar o valor devido não afasta a infração administrativa."

RULES_TEXT: Dict[str, Dict[str, str]] = {
    "R01": {
        "title": "Hora extra acima do limite diário",
        "legal_basis": "CF art. 7º, XIII — duração normal não superior a 8h diárias e 44h semanais. "
                       "CLT art. 59, caput — a duração diária pode ser acrescida de no máximo 2 horas extras. "
                       "CLT art. 59, §2º — com compensação, o dia não pode passar de 10h. "
                       "CLT art. 61 — o limite só pode ser excedido por força maior ou serviço inadiável. "
                       "Súmula 376, I, TST — a limitação não exime o pagamento de todas as horas trabalhadas.",
        "financial": "Todas as horas trabalhadas além da jornada são pagas como extra, com adicional, "
                     "mais reflexos em DSR, férias + 1/3, 13º e FGTS (Súmula 376, I, TST).",
        "administrative": "Infração ao capítulo de duração do trabalho, sujeita a auto de infração com a multa do art. 75 da CLT.",
    },
    "R02": {
        "title": "Hora extra semanal",
        "legal_basis": "CF art. 7º, XIII e XVI — limite semanal e adicional mínimo de 50%. "
                       "CLT arts. 58 e 59 — hora extra depende de acordo de prorrogação. "
                       "Emenda do fim da 6x1 — limite de 42h a partir de 14/12/2026 e 40h a partir de 13/12/2027.",
        "financial": "Horas acima do limite semanal pagas com adicional mínimo de 50% e reflexos.",
        "administrative": "Sem acordo de prorrogação, a hora extra é irregular e sujeita à multa do art. 75 da CLT.",
    },
    "R03": {
        "title": "Hora extra habitual",
        "legal_basis": "Súmula 172 TST — horas extras habituais refletem no DSR. "
                       "Súmula 291 TST — a supressão de horas extras habituais gera indenização. "
                       "CLT art. 59-B, parágrafo único — HE habituais não descaracterizam o acordo de compensação.",
        "financial": "Reflexos em DSR, férias + 1/3, 13º, FGTS e aviso prévio; indenização se as horas forem suprimidas (Súmula 291).",
        "administrative": "Não é infração por si só, mas indica risco de irregularidades de jornada (R01/R02).",
    },
    "R04": {
        "title": "Contrato de jornada acima do regime legal",
        "legal_basis": "CF art. 7º, XIII — limite semanal de duração do trabalho. "
                       "Emenda do fim da 6x1 — 42h e 2 dias de descanso a partir de 14/12/2026; 40h a partir de 13/12/2027.",
        "financial": "Toda hora acima do novo limite é hora extra, com adicional e reflexos.",
        "administrative": "Jornada contratual acima do limite legal, sujeita à multa do art. 75 da CLT.",
    },
    "R05": {
        "title": "Trabalho no 7º dia consecutivo",
        "legal_basis": "CF art. 7º, XV — repouso semanal remunerado. CLT art. 67 e Lei 605/49 art. 1º — 24h de descanso a cada semana. "
                       "OJ 410 SDI-1 TST — repouso concedido após o 7º dia consecutivo de trabalho viola a lei e é pago em dobro.",
        "financial": "Repouso pago em dobro (OJ 410 SDI-1 TST).",
        "administrative": "Infração ao repouso semanal, sujeita à multa do art. 12 da Lei 605/49.",
    },
    "R06": {
        "title": "Descanso semanal abaixo do mínimo do regime",
        "legal_basis": "CLT art. 67 e Lei 605/49 — repouso semanal. "
                       "Emenda do fim da 6x1 — 2 dias de descanso por semana a partir de 14/12/2026.",
        "financial": "Repouso não concedido pago em dobro.",
        "administrative": "Multa do art. 12 da Lei 605/49 e do art. 75 da CLT.",
    },
    "R07": {
        "title": "Domingos consecutivos trabalhados",
        "legal_basis": "Lei 10.101/2000 art. 6º, parágrafo único — no comércio, o repouso semanal deve coincidir "
                       "com o domingo pelo menos uma vez a cada três semanas.",
        "financial": "Repouso não concedido no domingo pago em dobro.",
        "administrative": "Multa do art. 75 da CLT, por força do art. 6º-B da Lei 10.101/2000.",
    },
    "R08": {
        "title": "Descanso entre jornadas inferior a 11h",
        "legal_basis": "CLT art. 66 — mínimo de 11 horas consecutivas entre duas jornadas. "
                       "OJ 355 SDI-1 TST — horas suprimidas são pagas como extras.",
        "financial": "Horas suprimidas do intervalo pagas como extras, com adicional (OJ 355 SDI-1 TST).",
        "administrative": "Infração ao capítulo de duração do trabalho, sujeita à multa do art. 75 da CLT.",
    },
    "R09": {
        "title": "Descanso de 35h (DSR + interjornada) não respeitado",
        "legal_basis": "CLT arts. 66 e 67 — 11h entre jornadas somadas às 24h do repouso semanal. "
                       "Súmula 110 TST — horas suprimidas do total de 35h são pagas como extras.",
        "financial": "Horas suprimidas pagas como extras, com adicional (Súmula 110 TST).",
        "administrative": "Infração ao capítulo de duração do trabalho, sujeita à multa do art. 75 da CLT.",
    },
    "R10": {
        "title": "Intervalo para refeição irregular",
        "legal_basis": "CLT art. 71, caput — jornada acima de 6h exige intervalo de 1h a 2h. "
                       "CLT art. 71, §1º — jornada de 4h a 6h exige 15 minutos. "
                       "CLT art. 71, §4º — período suprimido é indenizado com 50%. "
                       "Súmula 118 TST — intervalo acima do legal é computado na jornada.",
        "financial": "Período suprimido indenizado com acréscimo de 50% (art. 71, §4º); intervalo excedente computado como jornada (Súmula 118).",
        "administrative": "Infração ao capítulo de duração do trabalho, sujeita à multa do art. 75 da CLT.",
    },
    "R11": {
        "title": "Repouso ou feriado trabalhado sem folga compensatória",
        "legal_basis": "Lei 605/49 art. 9º — trabalho em repouso ou feriado sem folga compensatória é pago em dobro. "
                       "Súmula 146 TST — pagamento em dobro, sem prejuízo da remuneração do repouso. "
                       "Lei 10.101/2000 art. 6º-A — no comércio, trabalho em feriado depende de autorização em convenção coletiva.",
        "financial": "Pagamento em dobro das horas trabalhadas no dia (Súmula 146 TST).",
        "administrative": "Multa do art. 12 da Lei 605/49; no feriado, também exige autorização em convenção coletiva (Lei 10.101, art. 6º-A).",
    },
    "R12": {
        "title": "Banco de horas vencido sem compensação",
        "legal_basis": "CLT art. 59, §2º e §3º — horas não compensadas no prazo são pagas como extras. "
                       "CLT art. 59, §5º — banco de horas por acordo individual escrito, compensação em até 6 meses. "
                       "CLT art. 59, §6º — compensação no mesmo mês por acordo individual tácito ou escrito.",
        "financial": "Saldo não compensado no prazo pago como hora extra, com adicional (art. 59, §3º).",
        "administrative": "Manter horas em banco além do prazo legal sujeita a multa do art. 75 da CLT.",
    },
    "R13": {
        "title": "Falta injustificada registrada",
        "legal_basis": "Lei 605/49 art. 6º — a falta injustificada na semana pode acarretar a perda do DSR.",
        "financial": "Desconto do dia e, conforme a política da empresa, do DSR da semana.",
        "administrative": "Não é infração do empregador.",
    },
    "R14": {
        "title": "Alteração contratual de jornada sem aditivo",
        "legal_basis": "CLT art. 468 — alteração contratual só por mútuo consentimento e sem prejuízo ao empregado. "
                       "CLT art. 41, parágrafo único — o registro do empregado deve conter a duração do trabalho. "
                       "CLT art. 47-A — multa por empregado sem os dados do art. 41 atualizados. "
                       "eSocial S-2206 — a alteração contratual deve ser informada.",
        "financial": "Se a alteração for considerada lesiva, ela é nula e as diferenças da jornada anterior são devidas.",
        "administrative": "Registro desatualizado sujeito à multa do art. 47-A da CLT por empregado; informar a alteração no eSocial (S-2206).",
    },
}

# ==============================================================================
# --- [BLOCO: ESTRUTURAS] ---
# ==============================================================================


@dataclass
class Evidence:
    date: Optional[date]
    description: str
    value: Optional[str] = None
    change_id: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "date": self.date.isoformat() if self.date else None,
            "description": self.description,
            "value": self.value,
            "change_id": self.change_id,
        }


@dataclass
class Violation:
    code: str
    severity: str
    employee_id: int
    dates: List[date]
    ref_date: date  # Data em que a irregularidade se completa (define o mês da auditoria)
    message: str
    cause: str
    suggestion: str
    evidence: List[Evidence]
    fingerprint: str
    title: Optional[str] = None
    estimate_minutes: int = 0
    estimate_kind: Optional[str] = None  # HE | DOBRO | INDENIZACAO
    financial_estimate: Optional[float] = None

    def __post_init__(self):
        self.title = self.title or RULES_TEXT[self.code]["title"]

    def to_dict(self) -> Dict[str, Any]:
        text = RULES_TEXT[self.code]
        return {
            "code": self.code,
            "severity": self.severity,
            "employee_id": self.employee_id,
            "dates": [d.isoformat() for d in self.dates],
            "ref_date": self.ref_date.isoformat(),
            "title": self.title,
            "message": self.message,
            "cause": self.cause,
            "suggestion": self.suggestion,
            "evidence": [e.to_dict() for e in self.evidence],
            "legal_basis": text["legal_basis"],
            "financial_consequence": text["financial"],
            "administrative_consequence": text["administrative"],
            "administrative_footer": ADMIN_FOOTER if self.severity == "CRITICA" else None,
            "financial_estimate": self.financial_estimate,
            "fingerprint": self.fingerprint,
        }


@dataclass
class RuleDay:
    date: date
    status: str
    start_time: Optional[str] = None
    lunch_start: Optional[str] = None
    lunch_end: Optional[str] = None
    end_time: Optional[str] = None
    worked_minutes: int = 0


@dataclass
class BankLot:
    """Crédito do banco de horas por mês de origem, consumido do mais antigo para o mais novo."""
    origin: date  # Primeiro dia do mês de origem
    amount: int
    remaining: int
    expiry: date


def _add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    return date(d.year + y, m + 1, 1)


def bank_lots(monthly_net: List[tuple], validity_months: int) -> List[BankLot]:
    """
    Lotes do banco a partir do saldo líquido de cada mês [(primeiro_dia_do_mês, minutos)].
    Saldo positivo cria um lote; negativo consome os lotes mais antigos.
    Prazo: até o último dia do mês de origem (compensação mensal) ou do 6º mês (banco de 6 meses).
    """
    lots: List[BankLot] = []
    debt = 0  # Débito sem crédito anterior a consumir: abate os próximos créditos
    for origin, net in sorted(monthly_net, key=lambda x: x[0]):
        if net > 0:
            credit = net - min(debt, net)
            debt -= net - credit
            last = _add_months(origin, max(validity_months, 1) - 1)
            expiry = date(last.year, last.month, calendar.monthrange(last.year, last.month)[1])
            lots.append(BankLot(origin, net, credit, expiry))
            continue
        debt += -net
        for lot in lots:
            if debt <= 0:
                break
            take = min(lot.remaining, debt)
            lot.remaining -= take
            debt -= take
    return lots


@dataclass
class RulePolicy:
    max_daily_overtime_min: int = 120
    min_interjornada_min: int = 660
    max_consecutive_work_days: int = 6
    max_consecutive_sundays: int = 2
    habitual_overtime_weeks: int = 3
    week_start: int = 0

    @classmethod
    def from_settings(cls, s) -> "RulePolicy":
        if s is None:
            return cls()

        def val(name, default):
            v = getattr(s, name, None)
            return default if v is None else int(v)

        return cls(
            max_daily_overtime_min=val("max_daily_overtime_min", 120),
            min_interjornada_min=val("min_interjornada_min", 660),
            max_consecutive_work_days=val("max_consecutive_work_days", 6),
            max_consecutive_sundays=val("max_consecutive_sundays", 2),
            habitual_overtime_weeks=val("habitual_overtime_weeks", 3),
            week_start=val("week_start", 0),
        )


@dataclass
class RuleContext:
    employee_id: int
    employee_name: str
    days: Dict[date, RuleDay]  # Janela: semanas anteriores ao mês + o mês avaliado
    ledger: Dict[date, DayLedger]
    contracts: List[Any]
    regimes: List[Regime]
    holidays: Dict[date, str]
    period: tuple  # (início, fim) do mês avaliado
    policy: RulePolicy = field(default_factory=RulePolicy)
    bank_lots: List[BankLot] = field(default_factory=list)
    bank_validity_months: int = 1

    def in_period(self, d: date) -> bool:
        return self.period[0] <= d <= self.period[1]

    def worked(self, d: date) -> bool:
        day = self.days.get(d)
        return bool(day and day.status == "TRABALHO")


# ==============================================================================
# --- [BLOCO: FORMATAÇÃO] ---
# ==============================================================================

def fd(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def fds(d: date) -> str:
    return d.strftime("%d/%m")


def fh(mins: int) -> str:
    mins = int(mins or 0)
    sign = "-" if mins < 0 else ""
    return f"{sign}{abs(mins) // 60}h{abs(mins) % 60:02d}"


def day_range(day: RuleDay) -> str:
    if not day.start_time:
        return "sem horário"
    if day.lunch_start and day.lunch_end:
        return f"{day.start_time}–{day.lunch_start} / {day.lunch_end}–{day.end_time}"
    return f"{day.start_time}–{day.end_time}"


def _end_abs(day: RuleDay) -> Optional[int]:
    s, e = parse_time_to_minutes(day.start_time), parse_time_to_minutes(day.end_time)
    if s is None or e is None:
        return None
    return e if e >= s else e + 1440


def _lunch_minutes(day: RuleDay) -> int:
    ls, le = parse_time_to_minutes(day.lunch_start), parse_time_to_minutes(day.lunch_end)
    if ls is None or le is None:
        return 0
    return (le - ls) if le >= ls else (le + 1440 - ls)


def _contract_label(ctx: RuleContext, d: date) -> str:
    c = contract_on(ctx.contracts, d)
    if not c:
        return "sem contrato vigente"
    cd = parse_days(c.days)[d.weekday()]
    if cd.rest:
        return "descanso no contrato (DSR)" if cd.rest == "DSR" else "folga no contrato"
    return f"{cd.start}–{cd.end} ({fh(cd.minutes)})"


# ==============================================================================
# --- [BLOCO: REGRAS DE JORNADA DIÁRIA] ---
# ==============================================================================

def r01_daily_overtime(ctx: RuleContext) -> List[Violation]:
    out = []
    limit = ctx.policy.max_daily_overtime_min
    for d in sorted(ctx.days):
        day, dl = ctx.days[d], ctx.ledger.get(d)
        if day.status != "TRABALHO" or dl is None or not ctx.in_period(d):
            continue
        worked = dl.worked_min
        over_total = worked > 600
        over_extra = dl.contracted_min > 0 and dl.extra_daily_min > limit
        if not (over_total or over_extra):
            continue
        if over_total and not over_extra:
            cause = (f"Dia {fds(d)} ({WEEKDAY_NAMES[d.weekday()]}) escalado {day_range(day)} = {fh(worked)}, "
                     f"acima do máximo de 10h00 no dia, mesmo com compensação.")
        else:
            cause = (f"Dia {fds(d)} ({WEEKDAY_NAMES[d.weekday()]}) escalado {day_range(day)} = {fh(worked)}, contra jornada "
                     f"contratada de {fh(dl.contracted_min)}: {fh(dl.extra_daily_min)} de hora extra não compensada — "
                     f"o limite é {fh(limit)}.")
        evidence = [
            Evidence(d, "Jornada contratada no dia", f"{_contract_label(ctx, d)}"),
            Evidence(d, "Horário escalado", f"{day_range(day)} = {fh(worked)}"),
            Evidence(d, "Hora extra apurada (não compensada)", f"{fh(dl.extra_daily_min)} (limite {fh(limit)})"),
        ]
        if dl.compensated_min:
            evidence.append(Evidence(d, "Horas compensadas no período", fh(dl.compensated_min)))
        max_end = (parse_time_to_minutes(day.start_time) or 0) + (dl.contracted_min + limit) + _lunch_minutes(day)
        out.append(Violation(
            code="R01", severity="CRITICA", employee_id=ctx.employee_id, dates=[d], ref_date=d,
            message=f"{ctx.employee_name}: {fh(dl.extra_daily_min or worked - 600)} acima do limite em {fds(d)}.",
            cause=cause,
            suggestion=(f"Encerrar a jornada até {max_end // 60 % 24:02d}:{max_end % 60:02d} (máximo de {fh(limit)} extras) "
                        f"ou reduzir outro dia do período para compensar, ou escalar outro colaborador."),
            evidence=evidence, fingerprint=f"R01:{ctx.employee_id}:{d.isoformat()}",
            estimate_minutes=dl.extra_daily_min, estimate_kind="HE",
        ))
    return out


def r10_intrajornada(ctx: RuleContext) -> List[Violation]:
    out = []
    for d in sorted(ctx.days):
        day = ctx.days[d]
        if day.status != "TRABALHO" or not day.start_time or not ctx.in_period(d):
            continue
        worked = day.worked_minutes
        lunch = _lunch_minutes(day)
        problem = None
        if worked > 360 and lunch < 60:
            problem, required, missing, kind = "inferior a 1h", "1h a 2h", 60 - lunch, "INDENIZACAO"
        elif worked > 360 and lunch > 120:
            problem, required, missing, kind = "superior a 2h", "1h a 2h", lunch - 120, "HE"
        elif 240 < worked <= 360 and lunch < 15:
            problem, required, missing, kind = "inferior a 15 min", "15 min", 15 - lunch, "INDENIZACAO"
        if not problem:
            continue
        out.append(Violation(
            code="R10", severity="CRITICA", employee_id=ctx.employee_id, dates=[d], ref_date=d,
            message=f"{ctx.employee_name}: intervalo de {lunch} min em {fds(d)}.",
            cause=(f"Dia {fds(d)}: jornada de {fh(worked)} com intervalo de {lunch} min ({problem}); "
                   f"o exigido é {required}."),
            suggestion=f"Ajustar o intervalo do dia para {required}.",
            evidence=[
                Evidence(d, "Horário escalado", day_range(day)),
                Evidence(d, "Duração do intervalo", f"{lunch} min (exigido {required})"),
                Evidence(d, "Jornada do dia", fh(worked)),
            ],
            fingerprint=f"R10:{ctx.employee_id}:{d.isoformat()}",
            estimate_minutes=missing, estimate_kind=kind,
        ))
    return out


def r08_interjornada(ctx: RuleContext) -> List[Violation]:
    out = []
    minimum = ctx.policy.min_interjornada_min
    for d in sorted(ctx.days):
        nxt = d + timedelta(days=1)
        a, b = ctx.days.get(d), ctx.days.get(nxt)
        if not (a and b and a.status == "TRABALHO" and b.status == "TRABALHO" and ctx.in_period(nxt)):
            continue
        end_a, start_b = _end_abs(a), parse_time_to_minutes(b.start_time)
        if end_a is None or start_b is None:
            continue
        gap = 1440 - end_a + start_b
        if gap >= minimum:
            continue
        out.append(Violation(
            code="R08", severity="CRITICA", employee_id=ctx.employee_id, dates=[d, nxt], ref_date=nxt,
            message=f"{ctx.employee_name}: {fh(gap)} de descanso entre {fds(d)} e {fds(nxt)}.",
            cause=(f"Saída às {a.end_time} em {fds(d)} e entrada às {b.start_time} em {fds(nxt)}: "
                   f"{fh(gap)} de descanso, abaixo do mínimo de {fh(minimum)}."),
            suggestion=f"Atrasar a entrada de {fds(nxt)} ou antecipar a saída de {fds(d)} em {fh(minimum - gap)}.",
            evidence=[
                Evidence(d, "Fim da jornada", a.end_time),
                Evidence(nxt, "Início da jornada seguinte", b.start_time),
                Evidence(nxt, "Descanso apurado", f"{fh(gap)} (mínimo {fh(minimum)})"),
            ],
            fingerprint=f"R08:{ctx.employee_id}:{d.isoformat()}",
            estimate_minutes=minimum - gap, estimate_kind="HE",
        ))
    return out


# ==============================================================================
# --- [BLOCO: REGRAS DE REPOUSO] ---
# ==============================================================================

def r05_seventh_day(ctx: RuleContext) -> List[Violation]:
    out = []
    limit = ctx.policy.max_consecutive_work_days
    streak: List[date] = []
    for d in sorted(ctx.days) + [None]:
        if d is not None and ctx.worked(d) and (not streak or (d - streak[-1]).days == 1):
            streak.append(d)
            continue
        if len(streak) > limit:
            seventh = streak[limit]
            if ctx.in_period(seventh):
                dl = ctx.ledger.get(seventh)
                out.append(Violation(
                    code="R05", severity="CRITICA", employee_id=ctx.employee_id, dates=list(streak), ref_date=seventh,
                    message=f"{ctx.employee_name}: {len(streak)} dias seguidos de trabalho ({fds(streak[0])} a {fds(streak[-1])}).",
                    cause=(f"{len(streak)} dias consecutivos de trabalho, de {fd(streak[0])} a {fd(streak[-1])}, "
                           f"sem o repouso semanal: o {limit + 1}º dia foi {fd(seventh)}."),
                    suggestion=f"Conceder folga em um dos dias entre {fds(streak[1])} e {fds(seventh)}.",
                    evidence=[Evidence(x, "Dia trabalhado", day_range(ctx.days[x])) for x in streak],
                    fingerprint=f"R05:{ctx.employee_id}:{streak[0].isoformat()}",
                    estimate_minutes=dl.worked_min if dl else 0, estimate_kind="DOBRO",
                ))
        streak = [d] if (d is not None and ctx.worked(d)) else []
    return out


def r06_min_rest_days(ctx: RuleContext) -> List[Violation]:
    out = []
    weeks: Dict[date, List[date]] = {}
    for d in sorted(ctx.days):
        weeks.setdefault(week_key(d, ctx.policy.week_start), []).append(d)
    for wk_start, wk_days in weeks.items():
        wk_end = wk_start + timedelta(days=6)
        regime = regime_on(ctx.regimes, wk_end)
        # Com 1 dia mínimo, a semana sem descanso já é o 7º dia consecutivo (R05)
        if regime.min_rest_days < 2 or len(wk_days) < 7 or not ctx.in_period(wk_end):
            continue
        statuses = [ctx.days[d].status for d in wk_days]
        if any(s in ("FERIAS", "ATESTADO", "FALTA") for s in statuses):
            continue
        rest = [d for d in wk_days if ctx.days[d].status in REST_STATUSES]
        if len(rest) >= regime.min_rest_days:
            continue
        out.append(Violation(
            code="R06", severity="CRITICA", employee_id=ctx.employee_id, dates=wk_days, ref_date=wk_end,
            message=f"{ctx.employee_name}: {len(rest)} dia(s) de descanso na semana de {fds(wk_start)}.",
            cause=(f"Semana de {fd(wk_start)} a {fd(wk_end)} com {len(rest)} dia(s) de descanso; "
                   f"o regime vigente ({regime.label}) exige {regime.min_rest_days}."),
            suggestion="Conceder folga em um dos dias trabalhados da semana.",
            evidence=[Evidence(d, ctx.days[d].status, day_range(ctx.days[d]) if ctx.days[d].status == "TRABALHO" else None)
                      for d in wk_days],
            fingerprint=f"R06:{ctx.employee_id}:{wk_start.isoformat()}",
        ))
    return out


def r07_consecutive_sundays(ctx: RuleContext) -> List[Violation]:
    out = []
    limit = ctx.policy.max_consecutive_sundays
    sundays = sorted(d for d in ctx.days if d.weekday() == 6)
    streak: List[date] = []
    for d in sundays + [None]:
        if d is not None and ctx.worked(d) and (not streak or (d - streak[-1]).days == 7):
            streak.append(d)
            continue
        if len(streak) > limit and ctx.in_period(streak[limit]):
            out.append(Violation(
                code="R07", severity="CRITICA", employee_id=ctx.employee_id, dates=list(streak), ref_date=streak[limit],
                message=f"{ctx.employee_name}: {len(streak)} domingos seguidos trabalhados.",
                cause=(f"{len(streak)} domingos consecutivos trabalhados ({', '.join(fds(x) for x in streak)}); "
                       f"o repouso deve coincidir com o domingo ao menos 1 vez a cada {limit + 1} semanas."),
                suggestion=f"Conceder o DSR no domingo {fds(streak[limit])}.",
                evidence=[Evidence(x, "Domingo trabalhado", day_range(ctx.days[x])) for x in streak],
                fingerprint=f"R07:{ctx.employee_id}:{streak[0].isoformat()}",
            ))
        streak = [d] if (d is not None and ctx.worked(d)) else []
    return out


def r09_rest_35h(ctx: RuleContext) -> List[Violation]:
    out = []
    for r in sorted(ctx.days):
        rest_day = ctx.days[r]
        before, after = r - timedelta(days=1), r + timedelta(days=1)
        a, b = ctx.days.get(before), ctx.days.get(after)
        if rest_day.status != "DSR" or not (a and b and a.status == "TRABALHO" and b.status == "TRABALHO"):
            continue
        if not ctx.in_period(after):
            continue
        end_a, start_b = _end_abs(a), parse_time_to_minutes(b.start_time)
        if end_a is None or start_b is None:
            continue
        gap = (1440 - end_a) + 1440 + start_b
        if gap >= MIN_REST_35H:
            continue
        out.append(Violation(
            code="R09", severity="CRITICA", employee_id=ctx.employee_id, dates=[before, r, after], ref_date=after,
            message=f"{ctx.employee_name}: {fh(gap)} de descanso em torno do DSR de {fds(r)}.",
            cause=(f"Saída às {a.end_time} em {fds(before)}, DSR em {fds(r)} e entrada às {b.start_time} em {fds(after)}: "
                   f"{fh(gap)} de descanso contínuo, abaixo de 35h00."),
            suggestion=f"Antecipar a saída de {fds(before)} ou atrasar a entrada de {fds(after)} em {fh(MIN_REST_35H - gap)}.",
            evidence=[
                Evidence(before, "Fim da jornada antes do DSR", a.end_time),
                Evidence(after, "Início da jornada após o DSR", b.start_time),
                Evidence(after, "Descanso apurado", f"{fh(gap)} (mínimo 35h00)"),
            ],
            fingerprint=f"R09:{ctx.employee_id}:{r.isoformat()}",
            estimate_minutes=MIN_REST_35H - gap, estimate_kind="HE",
        ))
    return out


def r11_rest_worked(ctx: RuleContext) -> List[Violation]:
    out = []
    for d in sorted(ctx.ledger):
        dl = ctx.ledger[d]
        if not dl.rest_worked_unpaid_double or not ctx.in_period(d):
            continue
        day = ctx.days.get(d)
        holiday = ctx.holidays.get(d)
        what = f"Feriado ({holiday})" if dl.is_holiday else "Repouso semanal (DSR)"
        out.append(Violation(
            code="R11", severity="ALERTA", employee_id=ctx.employee_id, dates=[d], ref_date=d,
            title="Feriado trabalhado sem folga compensatória" if dl.is_holiday else "DSR trabalhado sem folga compensatória",
            message=f"{ctx.employee_name}: {what.lower()} trabalhado em {fds(d)}.",
            cause=(f"{what} em {fd(d)} trabalhado ({day_range(day) if day else ''}, {fh(dl.worked_min)}) "
                   f"sem folga compensatória na mesma sequência de dias."),
            suggestion="Conceder folga compensatória antes do 7º dia consecutivo, ou pagar o dia em dobro.",
            evidence=[
                Evidence(d, what, holiday),
                Evidence(d, "Horário trabalhado", f"{day_range(day) if day else ''} = {fh(dl.worked_min)}"),
                Evidence(d, "Folga compensatória", "não encontrada"),
            ],
            fingerprint=f"R11:{ctx.employee_id}:{d.isoformat()}",
            estimate_minutes=dl.worked_min, estimate_kind="DOBRO",
        ))
    return out


def r12_bank_expiry(ctx: RuleContext) -> List[Violation]:
    out = []
    start, end = ctx.period
    alert_until = end + timedelta(days=31)
    prazo = "no mesmo mês (art. 59, §6º)" if ctx.bank_validity_months <= 1 else f"em até {ctx.bank_validity_months} meses (art. 59, §5º)"
    for lot in ctx.bank_lots:
        if lot.remaining <= 0:
            continue
        origin_label = lot.origin.strftime("%m/%Y")
        evidence = [
            Evidence(lot.origin, "Mês de origem do crédito", origin_label),
            Evidence(None, "Crédito gerado", fh(lot.amount)),
            Evidence(None, "Saldo ainda não compensado", fh(lot.remaining)),
            Evidence(lot.expiry, "Prazo de compensação", f"{fd(lot.expiry)} ({prazo})"),
        ]
        if start <= lot.expiry <= end:
            out.append(Violation(
                code="R12", severity="CRITICA", employee_id=ctx.employee_id, dates=[lot.expiry], ref_date=lot.expiry,
                message=f"{ctx.employee_name}: {fh(lot.remaining)} do banco de {origin_label} venceram em {fds(lot.expiry)}.",
                cause=(f"{fh(lot.remaining)} de crédito gerado em {origin_label} não foram compensados até {fd(lot.expiry)}; "
                       f"a compensação deve ocorrer {prazo}."),
                suggestion="Pagar o saldo vencido como hora extra na folha (destino 'Pagar com acréscimo').",
                evidence=evidence, fingerprint=f"R12:{ctx.employee_id}:{lot.origin.isoformat()}",
                estimate_minutes=lot.remaining, estimate_kind="HE",
            ))
        elif end < lot.expiry <= alert_until:
            out.append(Violation(
                code="R12", severity="ALERTA", employee_id=ctx.employee_id, dates=[lot.expiry], ref_date=end,
                title="Banco de horas próximo do vencimento",
                message=f"{ctx.employee_name}: {fh(lot.remaining)} do banco vencem em {fds(lot.expiry)}.",
                cause=(f"{fh(lot.remaining)} de crédito gerado em {origin_label} vencem em {fd(lot.expiry)} "
                       f"se não forem compensados ou pagos."),
                suggestion=f"Programar folgas de banco de horas até {fd(lot.expiry)} ou pagar o saldo.",
                evidence=evidence, fingerprint=f"R12A:{ctx.employee_id}:{lot.origin.isoformat()}",
                estimate_minutes=lot.remaining, estimate_kind="HE",
            ))
    return out


def r13_absence(ctx: RuleContext) -> List[Violation]:
    return [
        Violation(
            code="R13", severity="INFO", employee_id=ctx.employee_id, dates=[d], ref_date=d,
            message=f"{ctx.employee_name}: falta em {fds(d)}.",
            cause=f"Falta injustificada registrada em {fd(d)}.",
            suggestion="Verificar a perda do DSR da semana na folha.",
            evidence=[Evidence(d, "Falta registrada")],
            fingerprint=f"R13:{ctx.employee_id}:{d.isoformat()}",
        )
        for d in sorted(ctx.days) if ctx.days[d].status == "FALTA" and ctx.in_period(d)
    ]


# ==============================================================================
# --- [BLOCO: REGRAS SEMANAIS E HABITUALIDADE] ---
# ==============================================================================

def _week_overtime(ctx: RuleContext) -> Dict[date, int]:
    """Hora extra não compensada por semana (chave = início da semana)."""
    weeks: Dict[date, int] = {}
    for d, dl in ctx.ledger.items():
        wk = week_key(d, ctx.policy.week_start)
        weeks[wk] = weeks.get(wk, 0) + dl.extra_min
    return weeks


def r02_weekly_limit(ctx: RuleContext) -> List[Violation]:
    out = []
    weeks: Dict[date, List[date]] = {}
    for d in sorted(ctx.days):
        weeks.setdefault(week_key(d, ctx.policy.week_start), []).append(d)
    window_start = min(ctx.days) if ctx.days else None
    for wk_start, wk_days in weeks.items():
        wk_end = wk_start + timedelta(days=6)
        if not ctx.in_period(wk_end) or (window_start and wk_start < window_start):
            continue
        limit = regime_on(ctx.regimes, wk_end).weekly_limit_min
        worked = sum(ctx.ledger[d].worked_min for d in wk_days if d in ctx.ledger and ctx.days[d].status == "TRABALHO")
        uncompensated = sum(ctx.ledger[d].extra_min for d in wk_days if d in ctx.ledger)
        if worked <= limit or uncompensated <= 0:
            continue
        contract = contract_on(ctx.contracts, wk_end)
        agreement = bool(contract and contract.overtime_agreement)
        out.append(Violation(
            code="R02", severity="ALERTA" if agreement else "CRITICA", employee_id=ctx.employee_id,
            dates=[d for d in wk_days if ctx.days[d].status == "TRABALHO"], ref_date=wk_end,
            title="Hora extra semanal" if agreement else "Hora extra semanal sem acordo de prorrogação",
            message=f"{ctx.employee_name}: {fh(worked)} na semana de {fds(wk_start)} (limite {fh(limit)}).",
            cause=(f"Semana de {fd(wk_start)} a {fd(wk_end)} com {fh(worked)} trabalhadas, acima do limite de {fh(limit)}; "
                   f"{fh(uncompensated)} de hora extra não compensada"
                   + ("." if agreement else ", sem acordo de prorrogação de jornada no contrato.")),
            suggestion="Compensar as horas no período ou registrar o acordo de prorrogação no contrato de jornada.",
            evidence=[Evidence(d, "Horas do dia", fh(ctx.ledger[d].worked_min)) for d in wk_days
                      if d in ctx.ledger and ctx.days[d].status == "TRABALHO"]
                     + [Evidence(wk_end, "Total da semana", f"{fh(worked)} (limite {fh(limit)})")],
            fingerprint=f"R02:{ctx.employee_id}:{wk_start.isoformat()}",
            estimate_minutes=uncompensated, estimate_kind="HE",
        ))
    return out


def r03_habitual_overtime(ctx: RuleContext) -> List[Violation]:
    threshold = ctx.policy.habitual_overtime_weeks
    weeks = _week_overtime(ctx)
    ordered = sorted(weeks)
    hits: List[date] = []
    for i, wk in enumerate(ordered):
        wk_end = wk + timedelta(days=6)
        if not ctx.in_period(wk_end):
            continue
        last4 = [w for w in ordered[max(0, i - 3):i + 1] if (wk - w).days <= 21]
        with_he = [w for w in last4 if weeks[w] > 0]
        if len(with_he) >= threshold:
            hits = with_he
    if not hits:
        return []
    ref = min(max(hits) + timedelta(days=6), ctx.period[1])
    return [Violation(
        code="R03", severity="ALERTA", employee_id=ctx.employee_id, dates=hits, ref_date=ref,
        message=f"{ctx.employee_name}: hora extra em {len(hits)} das últimas 4 semanas.",
        cause=(f"Hora extra não compensada em {len(hits)} das últimas 4 semanas "
               f"({', '.join(f'semana de {fds(w)}: {fh(weeks[w])}' for w in hits)})."),
        suggestion="Rever a escala para reduzir a hora extra recorrente ou ajustar o contrato de jornada.",
        evidence=[Evidence(w, f"Semana de {fds(w)}", f"{fh(weeks[w])} de hora extra") for w in hits],
        fingerprint=f"R03:{ctx.employee_id}:{ctx.period[0].isoformat()}",
    )]


# ==============================================================================
# --- [BLOCO: REGRAS DO CONTRATO] ---
# ==============================================================================

def _contracts_in_period(ctx: RuleContext) -> List[Any]:
    start, end = ctx.period
    return [c for c in ctx.contracts if c.valid_from <= end and (c.valid_to is None or c.valid_to >= start)]


def r04_contract_over_regime(ctx: RuleContext) -> List[Violation]:
    out = []
    start, end = ctx.period
    for c in _contracts_in_period(ctx):
        days = parse_days(c.days)
        weekly, rest = weekly_minutes(days), sum(1 for x in days.values() if x.rest)
        c_start, c_end = max(start, c.valid_from), min(end, c.valid_to or end)
        for i, r in enumerate(ctx.regimes):
            r_end = ctx.regimes[i + 1].valid_from - timedelta(days=1) if i + 1 < len(ctx.regimes) else date.max
            o_start, o_end = max(c_start, r.valid_from), min(c_end, r_end)
            if o_start > o_end or (weekly <= r.weekly_limit_min and rest >= r.min_rest_days):
                continue
            problems = []
            if weekly > r.weekly_limit_min:
                problems.append(f"{fh(weekly)} semanais (limite {fh(r.weekly_limit_min)})")
            if rest < r.min_rest_days:
                problems.append(f"{rest} dia(s) de descanso (mínimo {r.min_rest_days})")
            out.append(Violation(
                code="R04", severity="CRITICA", employee_id=ctx.employee_id, dates=[o_start], ref_date=o_start,
                message=f"{ctx.employee_name}: contrato {days_summary_label(c.days)} incompatível com {r.label}.",
                cause=(f"Contrato vigente desde {fd(c.valid_from)} ({days_summary_label(c.days)}) com "
                       f"{' e '.join(problems)} a partir de {fd(o_start)} ({r.label})."),
                suggestion=f"Criar nova versão do contrato com vigência em {fd(o_start)} compatível com o regime (ex.: modelo 40h 5x2).",
                evidence=[
                    Evidence(c.valid_from, "Versão do contrato", f"{days_summary_label(c.days)} desde {fd(c.valid_from)}"),
                    Evidence(o_start, "Regime vigente", f"{r.label} desde {fd(r.valid_from)}"),
                    Evidence(o_start, "Total semanal e descanso", f"{fh(weekly)} • {rest} dia(s) de descanso"),
                ],
                fingerprint=f"R04:{ctx.employee_id}:{c.id}:{r.valid_from.isoformat()}",
            ))
    return out


def r14_contract_without_amendment(ctx: RuleContext) -> List[Violation]:
    out = []
    start, end = ctx.period
    ordered = sorted(ctx.contracts, key=lambda c: c.valid_from)
    for c in _contracts_in_period(ctx):
        if c.amendment_signed or c.change_reason == "ADMISSAO":
            continue
        ref = max(start, c.valid_from)
        previous = [p for p in ordered if p.valid_from < c.valid_from]
        prev_label = days_summary_label(previous[-1].days) if previous else "sem versão anterior"
        legal = c.change_reason == "ADEQUACAO_LEGAL"
        days_pending = (end - c.valid_from).days + 1
        out.append(Violation(
            code="R14", severity="ALERTA" if legal else "CRITICA", employee_id=ctx.employee_id, dates=[ref], ref_date=ref,
            message=f"{ctx.employee_name}: versão do contrato de {fd(c.valid_from)} sem aditivo assinado.",
            cause=(f"A jornada mudou de {prev_label} para {days_summary_label(c.days)} em {fd(c.valid_from)} "
                   f"sem aditivo contratual assinado" + (" (adequação legal)." if legal else ".")),
            suggestion="Colher a assinatura do aditivo e marcá-lo na versão do contrato.",
            evidence=[
                Evidence(c.valid_from, "Versão do contrato", f"{days_summary_label(c.days)} desde {fd(c.valid_from)}"),
                Evidence(c.valid_from, "Jornada anterior × nova", f"{prev_label} → {days_summary_label(c.days)}"),
                Evidence(None, "Motivo", c.change_reason),
                Evidence(None, "Dias sem aditivo", str(max(0, days_pending))),
            ],
            fingerprint=f"R14:{ctx.employee_id}:{c.id}",
        ))
    return out


# ==============================================================================
# --- [BLOCO: AVALIAÇÃO] ---
# ==============================================================================

RULES = [
    r01_daily_overtime, r02_weekly_limit, r03_habitual_overtime, r04_contract_over_regime,
    r05_seventh_day, r06_min_rest_days, r07_consecutive_sundays, r08_interjornada,
    r09_rest_35h, r10_intrajornada, r11_rest_worked, r12_bank_expiry, r13_absence, r14_contract_without_amendment,
]


def evaluate(ctx: RuleContext) -> List[Violation]:
    """Irregularidades que se completam no mês avaliado, das mais graves para as mais leves."""
    found: List[Violation] = []
    for rule in RULES:
        found.extend(v for v in rule(ctx) if ctx.in_period(v.ref_date))
    return sorted(found, key=lambda v: (SEVERITY_ORDER[v.severity], v.ref_date, v.code))
