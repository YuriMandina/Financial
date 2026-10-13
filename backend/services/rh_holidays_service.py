"""
Service de Feriados Nacionais e Corporativos do Módulo de RH
Contém feriados nacionais brasileiros oficiais (fixos e móveis) e mesclagem com feriados cadastrados.
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

def get_national_holidays(year: int) -> List[Dict[str, Any]]:
    """
    Retorna a lista completa dos feriados nacionais brasileiros oficiais para o ano especificado.
    Inclui feriados fixos e datas móveis (Carnaval, Paixão de Cristo e Corpus Christi).
    """
    easter = get_easter_date(year)
    carnival = easter - timedelta(days=47)
    good_friday = easter - timedelta(days=2)
    corpus_christi = easter + timedelta(days=60)

    holidays = [
        # Feriados Fixos Nacionais
        {"date": f"{year}-01-01", "name": "Confraternização Universal (Ano Novo)", "type": "NATIONAL"},
        {"date": f"{year}-04-21", "name": "Tiradentes", "type": "NATIONAL"},
        {"date": f"{year}-05-01", "name": "Dia do Trabalhador", "type": "NATIONAL"},
        {"date": f"{year}-09-07", "name": "Independência do Brasil", "type": "NATIONAL"},
        {"date": f"{year}-10-12", "name": "Nossa Senhora Aparecida (Padroeira do Brasil)", "type": "NATIONAL"},
        {"date": f"{year}-11-02", "name": "Finados", "type": "NATIONAL"},
        {"date": f"{year}-11-15", "name": "Proclamação da República", "type": "NATIONAL"},
        {"date": f"{year}-11-20", "name": "Dia Nacional de Zumbi e da Consciência Negra", "type": "NATIONAL"},
        {"date": f"{year}-12-25", "name": "Natal", "type": "NATIONAL"},

        # Feriados / Pontos Facultativos Nacionais Móveis Oficiais
        {"date": carnival.isoformat(), "name": "Carnaval", "type": "NATIONAL"},
        {"date": good_friday.isoformat(), "name": "Sexta-feira Santa (Paixão de Cristo)", "type": "NATIONAL"},
        {"date": easter.isoformat(), "name": "Páscoa", "type": "NATIONAL"},
        {"date": corpus_christi.isoformat(), "name": "Corpus Christi", "type": "NATIONAL"},
    ]

    # Ordenar por data
    holidays.sort(key=lambda x: x["date"])

    # Formatar itens com propriedades enriquecidas
    result = []
    for h in holidays:
        result.append({
            "id": f"national-{h['date']}",
            "date": h["date"],
            "name": h["name"],
            "type": h["type"],
            "is_national": True,
            "can_delete": False
        })
    return result

def get_effective_holidays_map(
    db: Session,
    organization_id: int,
    year: int,
    month: Optional[int] = None
) -> Dict[str, str]:
    """
    Retorna um dicionário { "YYYY-MM-DD": "Nome do Feriado" } unindo feriados nacionais
    hardcoded e feriados customizados gravados no banco de dados para a organização.
    """
    holidays_map: Dict[str, str] = {}

    # 1. Carrega Feriados Nacionais
    nationals = get_national_holidays(year)
    for n in nationals:
        d_str = n["date"]
        if month is not None:
            if int(d_str.split("-")[1]) != month:
                continue
        holidays_map[d_str] = n["name"]

    # 2. Carrega Feriados Customizados do Banco de Dados
    query = db.query(models.RHHoliday).filter(
        models.RHHoliday.organization_id == organization_id
    )
    if month is not None:
        month_prefix = f"{year:04d}-{month:02d}-"
        query = query.filter(models.RHHoliday.date.like(f"{month_prefix}%"))
    else:
        year_prefix = f"{year:04d}-"
        query = query.filter(models.RHHoliday.date.like(f"{year_prefix}%"))

    db_holidays = query.all()
    for db_h in db_holidays:
        holidays_map[db_h.date] = db_h.name

    return holidays_map

def list_all_holidays_for_organization(
    db: Session,
    organization_id: int,
    year: int
) -> List[Dict[str, Any]]:
    """
    Lista todos os feriados do ano (nacionais + cadastrados pela empresa), ordenados cronologicamente.
    """
    # 1. Nacionais
    nationals = get_national_holidays(year)
    national_dates = {n["date"] for n in nationals}

    # 2. Customizados do Banco
    year_prefix = f"{year:04d}-"
    db_holidays = db.query(models.RHHoliday).filter(
        models.RHHoliday.organization_id == organization_id,
        models.RHHoliday.date.like(f"{year_prefix}%")
    ).all()

    combined: List[Dict[str, Any]] = []

    # Adiciona nacionais
    combined.extend(nationals)

    # Adiciona os do banco (se não sobrepuserem exatamente uma data nacional)
    for h in db_holidays:
        if h.date in national_dates:
            # Atualiza o nome se o usuário renomeou o feriado no banco
            for item in combined:
                if item["date"] == h.date:
                    item["name"] = h.name
                    item["db_id"] = h.id
                    break
        else:
            combined.append({
                "id": f"custom-{h.id}",
                "db_id": h.id,
                "date": h.date,
                "name": h.name,
                "type": "CUSTOM",
                "is_national": False,
                "can_delete": True
            })

    # Ordena por data
    combined.sort(key=lambda x: x["date"])
    return combined
