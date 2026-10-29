"""
Informe mensal à contabilidade (planejamento docs/conformidade-clt, v08 seção 20).
Gera, a partir da folha do mês, as variáveis de cada colaborador (HE e faltas em quantidade,
prêmio e descontos em valor) e os eventos do mês (admissão, desligamento, férias, atestado);
guarda as versões enviadas e monta a retificação só com as diferenças.
"""

import csv
import io
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from models import models
from services.rh_compliance_report import MONTH_NAMES, _ReportPDF, _paragraph, _pdf_text, _section, _table
from services.rh_engine import get_month_calendar_info
from services.rh_payroll_service import ensure_system_items, payroll_employees

TERMINATION_REASONS = {
    "PEDIDO": "pedido de demissão",
    "SEM_JUSTA_CAUSA": "dispensa sem justa causa",
    "JUSTA_CAUSA": "dispensa por justa causa",
    "FIM_EXPERIENCIA": "término do contrato de experiência",
    "FIM_PRAZO": "término do contrato por prazo determinado",
    "ACORDO": "acordo (art. 484-A)",
    "FALECIMENTO": "falecimento",
}

STATUS_LABELS = {
    "FOLHA_ABERTA": "Folha aberta",
    "PRONTO": "Pronto para enviar",
    "ENVIADO": "Enviado",
    "DESATUALIZADO": "Desatualizado",
}

# Períodos de férias e atestado contam dias corridos: repousos no meio do período não o interrompem
EVENT_STATUSES = {"FERIAS": "Férias", "ATESTADO": "Atestado"}
REST_STATUSES = {"DSR", "FOLGA", "FERIADO"}
# A partir do 16º dia de afastamento o pagamento é do INSS (Lei 8.213/91, art. 60)
INSS_LEAVE_DAYS = 15

DEFAULT_GREETING = "Bom dia,"

# ==============================================================================
# --- [BLOCO: FORMATAÇÃO] ---
# ==============================================================================


def _fmt_money(value: float) -> str:
    return "R$ " + f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _fmt_minutes(minutes: float) -> str:
    minutes = int(round(minutes))
    return f"{minutes // 60}h{minutes % 60:02d}"


def _fmt_day(iso: str) -> str:
    return f"{iso[8:10]}/{iso[5:7]}"


def _fmt_full_date(iso: str) -> str:
    return f"{iso[8:10]}/{iso[5:7]}/{iso[:4]}"


def _plural_days(n: int) -> str:
    return f"{n} dia" if n == 1 else f"{n} dias"


def _item_label(item: models.RHPayrollItem, overtime_rate: float) -> str:
    labels = {
        "HE50": f"HE {overtime_rate:g}%",
        "HE100": "HE 100%",
        "HE_NORMAL": "Horas normais pagas",
        "HE_FIXO": "Valor fixo HE",
        "FALTAS": "Faltas",
    }
    return labels.get(item.system_key, item.name)


def item_value_text(line: Dict[str, Any]) -> str:
    """Parte do item depois do rótulo: '12h30 (05/10, 12/10)', '1 dia (14/10)' ou 'R$ 150,00 (motivo)'."""
    if line["mode"] == "QUANTIDADE" and line.get("quantity") is not None:
        qty = _fmt_minutes(line["quantity"]) if line["unit"] == "MIN" else _plural_days(int(line["quantity"]))
    else:
        qty = _fmt_money(line["amount"])
    extras = []
    if line.get("dates"):
        extras.append(", ".join(_fmt_day(d) for d in line["dates"]))
    if line.get("notes"):
        extras.append(line["notes"])
    return qty + (f" ({'; '.join(extras)})" if extras else "")


def event_text(ev: Dict[str, Any]) -> str:
    if ev["type"] == "ADMISSAO":
        return f"Admissão em {_fmt_full_date(ev['start'])}"
    if ev["type"] == "DESLIGAMENTO":
        reason = TERMINATION_REASONS.get(ev.get("reason") or "")
        return f"Desligamento em {_fmt_full_date(ev['start'])}" + (f" — {reason}" if reason else "")
    label = EVENT_STATUSES[ev["type"]]
    if ev["start"] == ev["end"]:
        text = f"{label} em {_fmt_day(ev['start'])} (1 dia)"
    else:
        text = f"{label} de {_fmt_day(ev['start'])} a {_fmt_day(ev['end'])} ({_plural_days(ev['days'])})"
    if ev["type"] == "ATESTADO" and ev["days"] > INSS_LEAVE_DAYS:
        text += f" — afastamento pelo INSS a partir do {INSS_LEAVE_DAYS + 1}º dia"
    return text

# ==============================================================================
# --- [BLOCO: CONTEÚDO DO INFORME] ---
# ==============================================================================


def _leave_periods(work_days: Dict[int, models.RHWorkDay], status: str) -> List[Tuple[int, int]]:
    """Períodos contínuos com o status, atravessando repousos (DSR, folga, feriado) entre dias do mesmo status."""
    days = sorted(d for d, wd in work_days.items() if wd.status == status)
    periods: List[List[int]] = []
    for d in days:
        if periods:
            last = periods[-1][1]
            gap = range(last + 1, d)
            if all(g in work_days and work_days[g].status in REST_STATUSES for g in gap):
                periods[-1][1] = d
                continue
        periods.append([d, d])
    return [(a, b) for a, b in periods]


def build_content(db: Session, organization_id: int, schedule: models.RHMonthlySchedule) -> Dict[str, Any]:
    """Conteúdo do informe a partir dos lançamentos da folha e da escala do mês (é o que vai no snapshot)."""
    ensure_system_items(db, organization_id)
    settings = db.query(models.RHSettings).filter(models.RHSettings.organization_id == organization_id).first()
    overtime_rate = float(settings.overtime_rate) if settings and settings.overtime_rate is not None else 50.0
    num_days = get_month_calendar_info(schedule.year, schedule.month)["num_days"]
    month_start, month_end = date(schedule.year, schedule.month, 1), date(schedule.year, schedule.month, num_days)

    entries_by_emp: Dict[int, List[models.RHPayrollEntry]] = {}
    for e in db.query(models.RHPayrollEntry).filter(models.RHPayrollEntry.schedule_id == schedule.id).all():
        entries_by_emp.setdefault(e.employee_id, []).append(e)
    days_by_emp: Dict[int, Dict[int, models.RHWorkDay]] = {}
    for wd in db.query(models.RHWorkDay).filter(models.RHWorkDay.schedule_id == schedule.id).all():
        days_by_emp.setdefault(wd.employee_id, {})[wd.day] = wd

    employees = []
    for emp in payroll_employees(db, organization_id, schedule):
        # Itens: um por rubrica (lançamentos repetidos da mesma rubrica são somados)
        lines: Dict[int, Dict[str, Any]] = {}
        for e in entries_by_emp.get(emp.id, []):
            item = e.item
            if not item.report_to_accounting or not item.active or (e.amount or 0) <= 0:
                continue
            line = lines.setdefault(item.id, {
                "key": f"item:{item.id}", "item_id": item.id, "label": _item_label(item, overtime_rate),
                "kind": item.kind, "code": item.code, "mode": item.report_mode or "VALOR",
                "quantity": None, "unit": None, "amount": 0.0, "dates": [], "notes": None,
            })
            line["amount"] = round(line["amount"] + (e.amount or 0.0), 2)
            if e.quantity is not None:
                line["quantity"] = (line["quantity"] or 0) + e.quantity
                line["unit"] = e.quantity_unit or "MIN"
            line["dates"] = sorted(set(line["dates"]) | set(e.dates or []))
            if e.notes:
                line["notes"] = "; ".join(filter(None, [line["notes"], e.notes.strip()]))
        items = sorted(lines.values(), key=lambda l: (l["kind"] != "RECEITA", l["code"]))
        for line in items:
            line.pop("code")

        events = []
        if emp.admission_date and month_start <= emp.admission_date <= month_end:
            iso = emp.admission_date.isoformat()
            events.append({"key": f"ADMISSAO:{iso}", "type": "ADMISSAO", "start": iso, "end": iso})
        if emp.termination_date and month_start <= emp.termination_date <= month_end:
            iso = emp.termination_date.isoformat()
            events.append({"key": f"DESLIGAMENTO:{iso}", "type": "DESLIGAMENTO", "start": iso, "end": iso,
                           "reason": emp.termination_reason})
        work_days = days_by_emp.get(emp.id, {})
        for status in EVENT_STATUSES:
            for a, b in _leave_periods(work_days, status):
                start = date(schedule.year, schedule.month, a).isoformat()
                events.append({"key": f"{status}:{start}", "type": status, "start": start,
                               "end": date(schedule.year, schedule.month, b).isoformat(), "days": b - a + 1})
        events.sort(key=lambda ev: (ev["start"], ev["type"]))

        matricula = ((emp.profile or {}).get("contrato") or {}).get("matricula")
        employees.append({
            "employee_id": emp.id, "name": (emp.name or "").strip().upper(), "matricula": matricula,
            "items": items, "events": events,
        })
    employees.sort(key=lambda r: r["name"])
    return {"year": schedule.year, "month": schedule.month, "employees": employees}

# ==============================================================================
# --- [BLOCO: TEXTO DO E-MAIL] ---
# ==============================================================================


def _month_label(content: Dict[str, Any]) -> str:
    return f"{MONTH_NAMES[content['month'] - 1].lower()}/{content['year']}"


def _company_name(org: Optional[models.Organization]) -> str:
    if not org:
        return ""
    company = org.company or {}
    return company.get("nome_fantasia") or company.get("razao_social") or org.name or ""


def _employee_header(emp: Dict[str, Any]) -> str:
    return emp["name"] + (f" (matr. {emp['matricula']})" if emp.get("matricula") else "")


def _closing(settings: Optional[models.RHSettings]) -> List[str]:
    signature = (settings.accounting_signature or "").strip() if settings else ""
    return ["", signature] if signature else []


def render_text(content: Dict[str, Any], company: str, settings: Optional[models.RHSettings]) -> str:
    month = _month_label(content)
    greeting = ((settings.accounting_greeting or "").strip() if settings else "") or DEFAULT_GREETING
    out = [f"Assunto: Variáveis da folha — {month.capitalize()}" + (f" — {company}" if company else ""), "",
           greeting, "", f"Seguem os lançamentos da folha de {month}:"]
    without = []
    for emp in content["employees"]:
        if not emp["items"] and not emp["events"]:
            without.append(emp["name"])
            continue
        out += ["", _employee_header(emp)]
        for kind, label in (("RECEITA", "Proventos"), ("DESPESA", "Descontos")):
            parts = [f"{l['label']} — {item_value_text(l)}" for l in emp["items"] if l["kind"] == kind]
            if parts:
                out.append(f"  {label}: " + " | ".join(parts))
        if emp["events"]:
            out.append("  Eventos: " + " | ".join(event_text(ev) for ev in emp["events"]))
    if without:
        out += ["", "Sem variáveis no mês: " + ", ".join(without) + "."]
    out += _closing(settings)
    return "\n".join(out)


def diff_content(previous: Dict[str, Any], current: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Diferenças por colaborador × item/evento entre a última versão enviada e o conteúdo atual."""
    def index(content):
        result = {}
        for emp in content["employees"]:
            entries = {l["key"]: (l["label"], item_value_text(l)) for l in emp["items"]}
            entries.update({ev["key"]: (None, event_text(ev)) for ev in emp["events"]})
            result[emp["employee_id"]] = (emp, entries)
        return result

    prev, curr = index(previous), index(current)
    changes = []
    for emp_id in sorted(set(prev) | set(curr), key=lambda i: (curr.get(i) or prev.get(i))[0]["name"]):
        emp = (curr.get(emp_id) or prev.get(emp_id))[0]
        before = prev.get(emp_id, (None, {}))[1]
        after = curr.get(emp_id, (None, {}))[1]
        emp_changes = []
        for key in list(before) + [k for k in after if k not in before]:
            b, a = before.get(key), after.get(key)
            if b == a:
                continue
            label = (a or b)[0]
            if b is None:
                emp_changes.append({"key": key, "change": "INCLUIDO", "label": label, "before": None, "after": a[1]})
            elif a is None:
                emp_changes.append({"key": key, "change": "REMOVIDO", "label": label, "before": b[1], "after": None})
            else:
                emp_changes.append({"key": key, "change": "ALTERADO", "label": label, "before": b[1], "after": a[1]})
        if emp_changes:
            changes.append({"employee_id": emp_id, "name": emp["name"], "matricula": emp.get("matricula"),
                            "changes": emp_changes})
    return changes


def _change_line(c: Dict[str, Any]) -> str:
    def full(value):
        return f"{c['label']} — {value}" if c["label"] else value
    if c["change"] == "INCLUIDO":
        return f"  Incluir: {full(c['after'])}"
    if c["change"] == "REMOVIDO":
        return f"  Desconsiderar: {full(c['before'])}"
    if c["label"]:
        return f"  {c['label']}: de {c['before']} para {c['after']}"
    return f"  Corrigir: {c['before']} → {c['after']}"


def render_rectification(changes: List[Dict[str, Any]], content: Dict[str, Any], last_sent_at: Optional[datetime],
                         company: str, settings: Optional[models.RHSettings]) -> str:
    month = _month_label(content)
    greeting = ((settings.accounting_greeting or "").strip() if settings else "") or DEFAULT_GREETING
    sent = f" enviado em {last_sent_at.strftime('%d/%m/%Y')}" if last_sent_at else ""
    out = [f"Assunto: Retificação — Variáveis da folha — {month.capitalize()}" + (f" — {company}" if company else ""),
           "", greeting, "", f"Retificando o informe{sent} da folha de {month}:"]
    for emp in changes:
        out += ["", _employee_header(emp)] + [_change_line(c) for c in emp["changes"]]
    out += _closing(settings)
    return "\n".join(out)

# ==============================================================================
# --- [BLOCO: SITUAÇÃO, VERSÕES E ENVIO] ---
# ==============================================================================


def _versions(db: Session, schedule: models.RHMonthlySchedule) -> List[models.RHAccountingReport]:
    return db.query(models.RHAccountingReport).filter(
        models.RHAccountingReport.schedule_id == schedule.id
    ).order_by(models.RHAccountingReport.version.asc()).all()


def _version_to_dict(db: Session, v: models.RHAccountingReport) -> Dict[str, Any]:
    user = db.get(models.User, v.sent_by) if v.sent_by else None
    return {
        "version": v.version,
        "kind": "ORIGINAL" if v.version == 1 else "RETIFICACAO",
        "sent_at": v.sent_at.isoformat() if v.sent_at else None,
        "sent_by": (user.name or user.email) if user else None,
        "text": v.text,
    }


def get_report(db: Session, organization_id: int, schedule: models.RHMonthlySchedule) -> Dict[str, Any]:
    settings = db.query(models.RHSettings).filter(models.RHSettings.organization_id == organization_id).first()
    company = _company_name(db.get(models.Organization, organization_id))
    content = build_content(db, organization_id, schedule)
    text = render_text(content, company, settings)
    versions = _versions(db, schedule)
    last = versions[-1] if versions else None
    changes = diff_content(last.snapshot, content) if last else []
    closed = schedule.status == "CLOSED"

    if not closed:
        status = "FOLHA_ABERTA"
    elif not last:
        status = "PRONTO"
    else:
        status = "DESATUALIZADO" if changes else "ENVIADO"

    return {
        "year": schedule.year,
        "month": schedule.month,
        "status": status,
        "status_label": STATUS_LABELS[status],
        "payroll_closed": closed,
        "can_send": closed and (not last or bool(changes)),
        "content": content,
        "text": text,
        "changes": changes,
        "rectification_text": render_rectification(changes, content, last.sent_at, company, settings) if changes else None,
        "versions": [_version_to_dict(db, v) for v in reversed(versions)],
        "accounting_email": settings.accounting_email if settings else None,
        "without_variables": sum(1 for e in content["employees"] if not e["items"] and not e["events"]),
    }


def mark_sent(db: Session, organization_id: int, schedule: models.RHMonthlySchedule, user_id: Optional[int]) -> Dict[str, Any]:
    """Grava a nova versão enviada. Exige folha fechada e diferença em relação à última versão."""
    if schedule.status != "CLOSED":
        raise ValueError("Feche a folha do mês antes de enviar o informe à contabilidade.")
    report = get_report(db, organization_id, schedule)
    versions = _versions(db, schedule)
    if versions and not report["changes"]:
        raise ValueError("Nada mudou desde a última versão enviada.")
    text = report["rectification_text"] if versions else report["text"]
    db.add(models.RHAccountingReport(
        schedule_id=schedule.id, version=len(versions) + 1, snapshot=report["content"], text=text,
        sent_by=user_id, sent_at=datetime.now()
    ))
    db.commit()
    return get_report(db, organization_id, schedule)


def content_for_version(db: Session, organization_id: int, schedule: models.RHMonthlySchedule,
                        version: Optional[int]) -> Dict[str, Any]:
    if version is None:
        return build_content(db, organization_id, schedule)
    row = db.query(models.RHAccountingReport).filter(
        models.RHAccountingReport.schedule_id == schedule.id,
        models.RHAccountingReport.version == version
    ).first()
    if not row:
        raise LookupError("Versão do informe não encontrada.")
    return row.snapshot

# ==============================================================================
# --- [BLOCO: EXPORTAÇÃO] ---
# ==============================================================================


def _export_rows(content: Dict[str, Any]) -> List[List[str]]:
    """Uma linha por colaborador × item/evento; colaborador sem variáveis aparece com uma linha vazia."""
    rows = []
    for emp in content["employees"]:
        base = [emp["name"], emp.get("matricula") or ""]
        for l in emp["items"]:
            rows.append(base + ["Provento" if l["kind"] == "RECEITA" else "Desconto", l["label"], item_value_text(l)])
        for ev in emp["events"]:
            rows.append(base + ["Evento", "", event_text(ev)])
        if not emp["items"] and not emp["events"]:
            rows.append(base + ["", "", "Sem variáveis no mês"])
    return rows


EXPORT_HEADERS = ["Colaborador", "Matrícula", "Tipo", "Rubrica", "Quantidade / valor / evento"]


def content_to_csv(content: Dict[str, Any]) -> bytes:
    """CSV com separador ';' e BOM (abre direto no Excel em português)."""
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";", quoting=csv.QUOTE_MINIMAL)
    writer.writerow(EXPORT_HEADERS)
    writer.writerows(_export_rows(content))
    return ("﻿" + buf.getvalue()).encode("utf-8")


def content_to_pdf(content: Dict[str, Any], company: str, version: Optional[int] = None) -> bytes:
    title = "Informe à Contabilidade"
    pdf = _ReportPDF(title)
    pdf.alias_nb_pages()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 8, _pdf_text(f"{title} - Variáveis da folha"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", size=9)
    version_label = f" - Versão {version}" if version else ""
    pdf.cell(0, 5, _pdf_text(f"{company} - Folha de {_month_label(content)}{version_label} - "
                             f"Gerado em {datetime.now().strftime('%d/%m/%Y %H:%M')}"),
             new_x="LMARGIN", new_y="NEXT")
    _section(pdf, "Lançamentos por colaborador")
    rows = _export_rows(content)
    if rows:
        _table(pdf, EXPORT_HEADERS, rows, (52, 16, 18, 32, 68))
    else:
        _paragraph(pdf, "Nenhum colaborador na folha do mês.")
    return bytes(pdf.output())
