"""
Service de Feriados Nacionais e Corporativos do Módulo de RH
Gerencia feriados nacionais e municipais de forma perpétua/recorrente por Dia e Mês (MM-DD),
evitando a necessidade de recadastrar feriados anualmente.
"""

from datetime import date, timedelta
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from models import models

def get_easter_date(year: int) -> date:
    """Calcula a data do Domingo de Páscoa pelo algoritmo de Meeus/Jones/Butcher."""
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)

# ==============================================================================
# --- [FERIADOS NACIONAIS FIXOS FEDERAIS (PERENES)] ---
# ==============================================================================

FIXED_NATIONAL_HOLIDAYS = [
    {"mm_dd": "01-01", "month": 1, "day": 1, "name": "Confraternização Universal (Ano Novo)"},
    {"mm_dd": "04-21", "month": 4, "day": 21, "name": "Tiradentes"},
    {"mm_dd": "05-01", "month": 5, "day": 1, "name": "Dia do Trabalhador"},
    {"mm_dd": "09-07", "month": 9, "day": 7, "name": "Independência do Brasil"},
    {"mm_dd": "10-12", "month": 10, "day": 12, "name": "Nossa Senhora Aparecida (Padroeira do Brasil)"},
    {"mm_dd": "11-02", "month": 11, "day": 2, "name": "Finados"},
    {"mm_dd": "11-15", "month": 11, "day": 15, "name": "Proclamação da República"},
    {"mm_dd": "11-20", "month": 11, "day": 20, "name": "Dia Nacional de Zumbi e da Consciência Negra"},
    {"mm_dd": "12-25", "month": 12, "day": 25, "name": "Natal"},
]

def get_movable_national_holidays(year: int) -> List[Dict[str, Any]]:
    """Calcula as datas móveis oficiais para o ano especificado."""
    easter = get_easter_date(year)
    carnival = easter - timedelta(days=47)
    good_friday = easter - timedelta(days=2)
    corpus_christi = easter + timedelta(days=60)

    return [
        {
            "mm_dd": carnival.strftime("%m-%d"),
            "month": carnival.month,
            "day": carnival.day,
            "name": "Carnaval",
            "is_movable": True
        },
        {
            "mm_dd": good_friday.strftime("%m-%d"),
            "month": good_friday.month,
            "day": good_friday.day,
            "name": "Sexta-feira Santa (Paixão de Cristo)",
            "is_movable": True
        },
        {
            "mm_dd": easter.strftime("%m-%d"),
            "month": easter.month,
            "day": easter.day,
            "name": "Páscoa",
            "is_movable": True
        },
        {
            "mm_dd": corpus_christi.strftime("%m-%d"),
            "month": corpus_christi.month,
            "day": corpus_christi.day,
            "name": "Corpus Christi",
            "is_movable": True
        },
    ]

# ==============================================================================
# --- [MAPA EFETIVO PARA ESCALAS MENSAIS (QUALQUER ANO)] ---
# ==============================================================================

def get_effective_holidays_map(
    db: Session,
    organization_id: int,
    year: int,
    month: Optional[int] = None
) -> Dict[str, str]:
    """
    Retorna { 'YYYY-MM-DD': 'Nome' } para o ano e mês solicitados.
    Combina feriados fixos, móveis e os municipais/customizados perenes da organização.
    """
    holidays_map: Dict[str, str] = {}

    # 1. Feriados Nacionais Fixos
    for fix in FIXED_NATIONAL_HOLIDAYS:
        if month is not None and fix["month"] != month:
            continue
        d_str = f"{year:04d}-{fix['mm_dd']}"
        holidays_map[d_str] = fix["name"]

    # 2. Feriados Nacionais Móveis do Ano
    for mov in get_movable_national_holidays(year):
        if month is not None and mov["month"] != month:
            continue
        d_str = f"{year:04d}-{mov['mm_dd']}"
        holidays_map[d_str] = mov["name"]

    # 3. Feriados Municipais / Corporativos Cadastrados (Perenes por MM-DD)
    db_holidays = db.query(models.RHHoliday).filter(
        models.RHHoliday.organization_id == organization_id
    ).all()

    for h in db_holidays:
        # Extrai MM-DD mesmo se o registro antigo contiver YYYY-MM-DD
        raw = h.date.strip()
        mm_dd = raw[-5:] if len(raw) >= 5 else raw
        try:
            m_part, d_part = map(int, mm_dd.split("-"))
            if month is not None and m_part != month:
                continue
            full_date = f"{year:04d}-{m_part:02d}-{d_part:02d}"
            holidays_map[full_date] = h.name
        except Exception:
            continue

    return holidays_map

# ==============================================================================
# --- [LISTAGEM PERPÉTUA ANUAL PARA A INTERFACE] ---
# ==============================================================================

def list_all_holidays_for_organization(
    db: Session,
    organization_id: int,
    reference_year: Optional[int] = None
) -> List[Dict[str, Any]]:
    """
    Lista todos os feriados fixos e customizados em formato perene (anual),
    com datas móveis calculadas com base no ano de referência.
    """
    ref_year = reference_year or date.today().year

    combined: List[Dict[str, Any]] = []

    # 1. Nacionais Fixos
    for fix in FIXED_NATIONAL_HOLIDAYS:
        combined.append({
            "id": f"national-fixed-{fix['mm_dd']}",
            "mm_dd": fix["mm_dd"],
            "month": fix["month"],
            "day": fix["day"],
            "name": fix["name"],
            "type": "NATIONAL",
            "is_national": True,
            "is_movable": False,
            "can_delete": False
        })

    # 2. Nacionais Móveis
    for mov in get_movable_national_holidays(ref_year):
        combined.append({
            "id": f"national-movable-{mov['name'].lower().replace(' ', '-')}",
            "mm_dd": mov["mm_dd"],
            "month": mov["month"],
            "day": mov["day"],
            "name": mov["name"],
            "type": "NATIONAL",
            "is_national": True,
            "is_movable": True,
            "can_delete": False
        })

    # 3. Customizados da Organização
    db_holidays = db.query(models.RHHoliday).filter(
        models.RHHoliday.organization_id == organization_id
    ).all()

    for h in db_holidays:
        raw = h.date.strip()
        mm_dd = raw[-5:] if len(raw) >= 5 else raw
        try:
            m_part, d_part = map(int, mm_dd.split("-"))
            combined.append({
                "id": f"custom-{h.id}",
                "db_id": h.id,
                "mm_dd": f"{m_part:02d}-{d_part:02d}",
                "month": m_part,
                "day": d_part,
                "name": h.name,
                "type": "CUSTOM",
                "is_national": False,
                "is_movable": False,
                "can_delete": True
            })
        except Exception:
            continue

    # Ordena cronologicamente pelo mês e dia
    combined.sort(key=lambda x: (x["month"], x["day"], x["name"]))
    return combined
