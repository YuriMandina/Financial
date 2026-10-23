"""
Service de Contratos de Jornada e Regimes Legais
Semana-padrão individual (horários de cada dia), versões com vigência, validação legal
e regimes de duração do trabalho (44h → 42h → 40h). Planejamento: docs/conformidade-clt (v05).
"""

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from models import models
from services.rh_engine import compute_raw_minutes, parse_time_to_minutes

WEEKDAY_LABELS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"]
REST_KINDS = ("DSR", "FOLGA")
CHANGE_REASONS = ("ADMISSAO", "ACORDO", "ADEQUACAO_LEGAL")
MAX_DAILY_TOTAL_MIN = 600  # 8h normais + 2h (art. 59, caput e §2º)

# ==============================================================================
# --- [BLOCO: REGIMES LEGAIS] ---
# Marcos do fim da 6x1 antecipados para a segunda-feira da semana (seção 4.3).
# ==============================================================================

LEGAL_REGIMES = [
    {
        "valid_from": date(2000, 1, 1), "weekly_limit_min": 44 * 60, "min_rest_days": 1,
        "max_daily_normal_min": 480, "label": "44h semanais",
        "legal_basis": "CF art. 7º, XIII; CLT art. 58",
    },
    {
        "valid_from": date(2026, 12, 14), "weekly_limit_min": 42 * 60, "min_rest_days": 2,
        "max_daily_normal_min": 480, "label": "42h semanais — transição do fim da 6x1",
        "legal_basis": "PEC 221/19 (data legal 16/12/2026, antecipada para a segunda-feira)",
    },
    {
        "valid_from": date(2027, 12, 13), "weekly_limit_min": 40 * 60, "min_rest_days": 2,
        "max_daily_normal_min": 480, "label": "40h semanais — fim da 6x1 (5x2)",
        "legal_basis": "PEC 221/19 (data legal 16/12/2027, antecipada para a segunda-feira)",
    },
]


@dataclass(frozen=True)
class Regime:
    valid_from: date
    weekly_limit_min: int
    min_rest_days: int
    max_daily_normal_min: int
    label: str
    legal_basis: Optional[str] = None


def default_regimes() -> List[Regime]:
    return [Regime(**r) for r in LEGAL_REGIMES]


def load_regimes(db: Session) -> List[Regime]:
    rows = db.query(models.RHLegalRegime).order_by(models.RHLegalRegime.valid_from.asc()).all()
    if not rows:
        return default_regimes()
    return [
        Regime(r.valid_from, r.weekly_limit_min, r.min_rest_days, r.max_daily_normal_min or 480, r.label, r.legal_basis)
        for r in rows
    ]


def regime_on(regimes: List[Regime], d: date) -> Regime:
    current = regimes[0]
    for r in regimes:
        if r.valid_from <= d:
            current = r
    return current


# ==============================================================================
# --- [BLOCO: SEMANA-PADRÃO DO CONTRATO] ---
# days = {"0": {"start","lunch_start","lunch_end","end"} | {"rest": "DSR"|"FOLGA"}, ...} (0 = segunda)
# ==============================================================================

@dataclass(frozen=True)
class ContractDay:
    weekday: int
    rest: Optional[str] = None
    start: Optional[str] = None
    lunch_start: Optional[str] = None
    lunch_end: Optional[str] = None
    end: Optional[str] = None

    @property
    def is_work(self) -> bool:
        return self.rest is None

    @property
    def minutes(self) -> int:
        if not self.is_work:
            return 0
        return compute_raw_minutes(self.start, self.lunch_start, self.lunch_end, self.end)

    @property
    def lunch_minutes(self) -> int:
        ls, le = parse_time_to_minutes(self.lunch_start), parse_time_to_minutes(self.lunch_end)
        if ls is None or le is None:
            return 0
        return (le - ls) if le >= ls else (le + 1440 - ls)


def parse_days(days: Dict[str, Any]) -> Dict[int, ContractDay]:
    parsed: Dict[int, ContractDay] = {}
    for wd in range(7):
        raw = (days or {}).get(str(wd)) or (days or {}).get(wd) or {}
        if raw.get("rest"):
            parsed[wd] = ContractDay(weekday=wd, rest=str(raw["rest"]).upper())
        else:
            parsed[wd] = ContractDay(
                weekday=wd,
                start=raw.get("start") or None,
                lunch_start=raw.get("lunch_start") or None,
                lunch_end=raw.get("lunch_end") or None,
                end=raw.get("end") or None,
            )
    return parsed


def normalize_days(days: Dict[str, Any]) -> Dict[str, Any]:
    """Representação canônica salva no banco (chaves "0".."6")."""
    out: Dict[str, Any] = {}
    for wd, cd in parse_days(days).items():
        if cd.rest:
            out[str(wd)] = {"rest": cd.rest}
        else:
            out[str(wd)] = {"start": cd.start, "lunch_start": cd.lunch_start, "lunch_end": cd.lunch_end, "end": cd.end}
    return out


def weekly_minutes(days: Dict[int, ContractDay]) -> int:
    return sum(cd.minutes for cd in days.values())


def work_days_count(days: Dict[int, ContractDay]) -> int:
    return sum(1 for cd in days.values() if cd.is_work)


def _span_end_abs(cd: ContractDay) -> int:
    """Fim da jornada em minutos desde a meia-noite do próprio dia (passa de 1440 se virar a noite)."""
    s, e = parse_time_to_minutes(cd.start), parse_time_to_minutes(cd.end)
    return e if e >= s else e + 1440


# ==============================================================================
# --- [BLOCO: VALIDAÇÃO LEGAL DO CONTRATO] ---
# Contrato acima dos limites legais não pode ser salvo (seção 5.1).
# ==============================================================================

def validate_contract_days(days: Dict[int, ContractDay], regime: Regime, compensation_agreement: bool,
                           min_interjornada_min: int = 660) -> List[str]:
    errors: List[str] = []

    for wd, cd in days.items():
        label = WEEKDAY_LABELS[wd]
        if cd.rest:
            if cd.rest not in REST_KINDS:
                errors.append(f"{label}: tipo de descanso inválido.")
            continue
        times = [cd.start, cd.end]
        if any(parse_time_to_minutes(t) is None for t in times):
            errors.append(f"{label}: informe entrada e saída (HH:MM).")
            continue
        if bool(cd.lunch_start) != bool(cd.lunch_end) or (
            cd.lunch_start and (parse_time_to_minutes(cd.lunch_start) is None or parse_time_to_minutes(cd.lunch_end) is None)
        ):
            errors.append(f"{label}: intervalo incompleto ou inválido.")
            continue
        mins = cd.minutes
        if mins <= 0:
            errors.append(f"{label}: jornada sem horas trabalhadas.")
            continue
        if mins > MAX_DAILY_TOTAL_MIN:
            errors.append(f"{label}: jornada de {mins // 60}h{mins % 60:02d} acima do máximo de 10h (CLT art. 59).")
        elif mins > regime.max_daily_normal_min and not compensation_agreement:
            errors.append(
                f"{label}: jornada acima de 8h exige acordo de compensação (CF art. 7º, XIII; Súmula 85 TST)."
            )
        lunch = cd.lunch_minutes
        if mins > 360 and not (60 <= lunch <= 120):
            errors.append(f"{label}: jornada acima de 6h exige intervalo de 1h a 2h (CLT art. 71).")
        elif 240 < mins <= 360 and lunch < 15:
            errors.append(f"{label}: jornada de 4h a 6h exige intervalo de 15 min (CLT art. 71, §1º).")

    if errors:
        return errors

    total = weekly_minutes(days)
    if total > regime.weekly_limit_min:
        errors.append(
            f"Total semanal de {total // 60}h{total % 60:02d} acima do limite de "
            f"{regime.weekly_limit_min // 60}h do regime vigente ({regime.label})."
        )
    rest_days = [cd for cd in days.values() if cd.rest]
    if len(rest_days) < regime.min_rest_days:
        errors.append(f"O regime vigente exige {regime.min_rest_days} dia(s) de descanso por semana.")
    if not any(cd.rest == "DSR" for cd in rest_days):
        errors.append("Defina o dia do repouso semanal remunerado (DSR) — preferencialmente domingo (Lei 605/49).")

    # Interjornada entre dias de trabalho consecutivos, inclusive domingo → segunda
    for wd in range(7):
        cd, nxt = days[wd], days[(wd + 1) % 7]
        if not (cd.is_work and nxt.is_work):
            continue
        rest = 1440 - _span_end_abs(cd) + parse_time_to_minutes(nxt.start)
        if rest < min_interjornada_min:
            errors.append(
                f"{WEEKDAY_LABELS[wd]} → {WEEKDAY_LABELS[(wd + 1) % 7]}: descanso de {rest // 60}h{rest % 60:02d} "
                f"entre jornadas, mínimo de 11h (CLT art. 66)."
            )
    return errors


# ==============================================================================
# --- [BLOCO: MODELOS PRONTOS] ---
# ==============================================================================

def _work(start: str, end: str, lunch_start: Optional[str] = "12:00", lunch_end: Optional[str] = "13:00") -> Dict[str, Any]:
    return {"start": start, "lunch_start": lunch_start, "lunch_end": lunch_end, "end": end}


def _week(work: Dict[int, Dict[str, Any]], rest: Dict[int, str]) -> Dict[str, Any]:
    return {str(wd): (work[wd] if wd in work else {"rest": rest[wd]}) for wd in range(7)}


_8H = _work("07:00", "16:00")
_4H = _work("07:00", "11:00", None, None)

SYSTEM_TEMPLATES = [
    {
        "code": "44H_6X1_QUA", "name": "44h 6x1 — quarta reduzida",
        "description": "8h em cinco dias + 4h na quarta; DSR no domingo. Vigência útil até 13/12/2026.",
        "days": _week({0: _8H, 1: _8H, 2: _4H, 3: _8H, 4: _8H, 5: _8H}, {6: "DSR"}),
    },
    {
        "code": "44H_5X2_COMP", "name": "44h 5x2 compensado (8h48)",
        "description": "8h48 em cinco dias; folga na quarta e DSR no domingo. Exige acordo de compensação escrito.",
        "days": _week({wd: _work("07:00", "16:48") for wd in (0, 1, 3, 4, 5)}, {2: "FOLGA", 6: "DSR"}),
    },
    {
        "code": "42H_5X2_COMP", "name": "42h 5x2 compensado (8h24) — transição",
        "description": "8h24 em cinco dias; folga na quarta e DSR no domingo. A partir de 14/12/2026; "
                       "jornada diária acima de 8h exige previsão em CCT/ACT.",
        "days": _week({wd: _work("07:00", "16:24") for wd in (0, 1, 3, 4, 5)}, {2: "FOLGA", 6: "DSR"}),
    },
    {
        "code": "40H_5X2", "name": "40h 5x2 — regime final",
        "description": "8h em cinco dias; folga na quarta e DSR no domingo. Obrigatório a partir de 13/12/2027.",
        "days": _week({wd: _8H for wd in (0, 1, 3, 4, 5)}, {2: "FOLGA", 6: "DSR"}),
    },
]


def ensure_rh_reference_data(db: Session) -> None:
    """Cria/atualiza regimes legais e modelos do sistema (idempotente, executado na inicialização)."""
    for r in LEGAL_REGIMES:
        row = db.query(models.RHLegalRegime).filter(models.RHLegalRegime.valid_from == r["valid_from"]).first()
        if not row:
            row = models.RHLegalRegime(valid_from=r["valid_from"])
            db.add(row)
        for k, v in r.items():
            setattr(row, k, v)
    for t in SYSTEM_TEMPLATES:
        row = db.query(models.RHContractTemplate).filter(
            models.RHContractTemplate.organization_id.is_(None),
            models.RHContractTemplate.code == t["code"]
        ).first()
        if not row:
            row = models.RHContractTemplate(organization_id=None, code=t["code"], is_system=True)
            db.add(row)
        row.name, row.description, row.days = t["name"], t["description"], t["days"]
    db.commit()


# ==============================================================================
# --- [BLOCO: RESOLUÇÃO DO CONTRATO POR DATA] ---
# ==============================================================================

def contract_on(contracts: List[Any], d: date) -> Optional[Any]:
    found = None
    for c in contracts or []:
        if c.valid_from <= d and (c.valid_to is None or d <= c.valid_to):
            if found is None or c.valid_from > found.valid_from:
                found = c
    return found


def contract_day_on(contracts: List[Any], d: date) -> Optional[ContractDay]:
    c = contract_on(contracts, d)
    if not c:
        return None
    return parse_days(c.days)[d.weekday()]


def sync_employee_summary(emp: models.RHEmployee, ref_date: Optional[date] = None) -> None:
    """Mantém jornada semanal e dias de trabalho do cadastro iguais aos da versão vigente."""
    ref_date = ref_date or date.today()
    c = contract_on(emp.contracts, ref_date)
    if c is None and emp.contracts:
        future = [x for x in emp.contracts if x.valid_from > ref_date]
        c = min(future, key=lambda x: x.valid_from) if future else max(emp.contracts, key=lambda x: x.valid_from)
    if c is None:
        return
    days = parse_days(c.days)
    emp.weekly_contract_hours = round(weekly_minutes(days) / 60, 2)
    emp.work_days_per_week = work_days_count(days)


# ==============================================================================
# --- [BLOCO: VERSÕES DO CONTRATO] ---
# ==============================================================================

def _validate_or_raise(db: Session, days_json: Dict[str, Any], valid_from: date, compensation_agreement: bool,
                       settings: Optional[models.RHSettings]) -> Dict[int, ContractDay]:
    days = parse_days(days_json)
    regime = regime_on(load_regimes(db), valid_from)
    min_inter = (getattr(settings, "min_interjornada_min", None) or 660) if settings else 660
    errors = validate_contract_days(days, regime, compensation_agreement, min_inter)
    if errors:
        raise ValueError(" ".join(errors))
    return days


def create_contract_version(db: Session, emp: models.RHEmployee, data: Dict[str, Any], user_id: Optional[int],
                            settings: Optional[models.RHSettings] = None) -> models.RHEmployeeContract:
    valid_from: date = data["valid_from"]
    if any(c.valid_from >= valid_from for c in emp.contracts):
        raise ValueError("Já existe versão de contrato com vigência nesta data ou posterior.")
    days = _validate_or_raise(db, data["days"], valid_from, bool(data.get("compensation_agreement")), settings)

    for c in emp.contracts:
        if c.valid_to is None or c.valid_to >= valid_from:
            c.valid_to = valid_from - timedelta(days=1)

    reason = data.get("change_reason") or ("ADMISSAO" if not emp.contracts else "ACORDO")
    version = models.RHEmployeeContract(
        employee_id=emp.id,
        template_id=data.get("template_id"),
        valid_from=valid_from,
        valid_to=None,
        days=normalize_days(data["days"]),
        weekly_min=weekly_minutes(days),
        overtime_agreement=bool(data.get("overtime_agreement")),
        compensation_agreement=bool(data.get("compensation_agreement")),
        amendment_signed=bool(data.get("amendment_signed")),
        amendment_signed_at=data.get("amendment_signed_at"),
        amendment_file=data.get("amendment_file"),
        change_reason=reason if reason in CHANGE_REASONS else "ACORDO",
        notes=data.get("notes"),
        created_by=user_id,
    )
    emp.contracts.append(version)
    db.flush()
    sync_employee_summary(emp)
    return version


def update_contract_version(db: Session, emp: models.RHEmployee, version: models.RHEmployeeContract,
                            data: Dict[str, Any], settings: Optional[models.RHSettings] = None) -> models.RHEmployeeContract:
    compensation = bool(data.get("compensation_agreement", version.compensation_agreement))
    if "days" in data and data["days"] is not None:
        days = _validate_or_raise(db, data["days"], version.valid_from, compensation, settings)
        version.days = normalize_days(data["days"])
        version.weekly_min = weekly_minutes(days)
    elif "compensation_agreement" in data:
        _validate_or_raise(db, version.days, version.valid_from, compensation, settings)
    for field in ("overtime_agreement", "compensation_agreement", "amendment_signed"):
        if field in data and data[field] is not None:
            setattr(version, field, bool(data[field]))
    for field in ("amendment_signed_at", "amendment_file", "notes"):
        if field in data:
            setattr(version, field, data[field])
    if data.get("change_reason") in CHANGE_REASONS:
        version.change_reason = data["change_reason"]
    sync_employee_summary(emp)
    return version


def delete_contract_version(db: Session, emp: models.RHEmployee, version: models.RHEmployeeContract) -> None:
    """Remove a versão; a anterior volta a valer até onde esta valia."""
    previous = [c for c in emp.contracts if c.valid_from < version.valid_from]
    if previous:
        prev = max(previous, key=lambda c: c.valid_from)
        prev.valid_to = version.valid_to
    emp.contracts.remove(version)
    db.delete(version)
    db.flush()
    sync_employee_summary(emp)


# ==============================================================================
# --- [BLOCO: SERIALIZAÇÃO] ---
# ==============================================================================

def days_summary_label(days_json: Dict[str, Any]) -> str:
    """Resumo curto da semana, ex.: '44h (6x1 • qua 4h)'."""
    days = parse_days(days_json)
    total = weekly_minutes(days)
    work = [cd for cd in days.values() if cd.is_work]
    hours = f"{total // 60}h" + (f"{total % 60:02d}" if total % 60 else "")
    if not work:
        return hours
    regime = f"{len(work)}x{7 - len(work)}"
    common = max({cd.minutes for cd in work}, key=lambda m: sum(1 for cd in work if cd.minutes == m))
    odd = [cd for cd in work if cd.minutes != common]
    if len(odd) == 1:
        m = odd[0].minutes
        return f"{hours} ({regime} • {WEEKDAY_LABELS[odd[0].weekday][:3].lower()} {m // 60}h" + (f"{m % 60:02d}" if m % 60 else "") + ")"
    return f"{hours} ({regime})"


def contract_to_dict(c: models.RHEmployeeContract) -> Dict[str, Any]:
    return {
        "id": c.id,
        "employee_id": c.employee_id,
        "template_id": c.template_id,
        "valid_from": c.valid_from.isoformat() if c.valid_from else None,
        "valid_to": c.valid_to.isoformat() if c.valid_to else None,
        "days": normalize_days(c.days),
        "weekly_min": int(c.weekly_min or 0),
        "summary": days_summary_label(c.days),
        "overtime_agreement": bool(c.overtime_agreement),
        "compensation_agreement": bool(c.compensation_agreement),
        "amendment_signed": bool(c.amendment_signed),
        "amendment_signed_at": c.amendment_signed_at.isoformat() if c.amendment_signed_at else None,
        "amendment_file": c.amendment_file,
        "change_reason": c.change_reason,
        "notes": c.notes,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def template_to_dict(t: models.RHContractTemplate) -> Dict[str, Any]:
    return {
        "id": t.id,
        "code": t.code,
        "name": t.name,
        "description": t.description,
        "days": normalize_days(t.days),
        "weekly_min": weekly_minutes(parse_days(t.days)),
        "summary": days_summary_label(t.days),
        "is_system": bool(t.is_system),
    }


def regime_to_dict(r: Regime) -> Dict[str, Any]:
    return {
        "valid_from": r.valid_from.isoformat(),
        "weekly_limit_min": r.weekly_limit_min,
        "min_rest_days": r.min_rest_days,
        "max_daily_normal_min": r.max_daily_normal_min,
        "label": r.label,
        "legal_basis": r.legal_basis,
    }
