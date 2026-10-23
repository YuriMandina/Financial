"""
Relatório de Irregularidades Trabalhistas
Período com filtros, totalizadores, reincidências (12 meses), ficha completa com histórico
e exportação em CSV e PDF. Planejamento: docs/conformidade-clt (v05, seção 11).
"""

import csv
import io
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

from fpdf import FPDF
from sqlalchemy.orm import Session

from models import models
from services.rh_compliance_service import NO_DAY_HISTORY_RULES, item_to_dict, refresh_month_audit

MAX_REPORT_MONTHS = 24
REINCIDENCE_MONTHS = 12
DISCLAIMER = ("Pagar o valor devido quita apenas a obrigação financeira com o trabalhador. "
              "A infração administrativa permanece e pode ser autuada pela Auditoria-Fiscal do Trabalho.")
SEVERITY_LABELS = {"CRITICA": "Crítica", "ALERTA": "Alerta"}
STATUS_LABELS = {"PENDENTE": "Pendente", "APROVADA": "Aprovada"}
ORIGIN_LABELS = {"MANUAL": "Manual", "LOTE": "Lote", "RESET": "Restauração"}
MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto",
               "Setembro", "Outubro", "Novembro", "Dezembro"]

# ==============================================================================
# --- [BLOCO: MONTAGEM DO RELATÓRIO] ---
# ==============================================================================

def parse_month(value: str) -> Tuple[int, int]:
    """'2026-10' → (2026, 10)."""
    y, m = value.split("-")[:2]
    year, month = int(y), int(m)
    if not 1 <= month <= 12:
        raise ValueError("Mês inválido")
    return year, month


def month_range(start: Tuple[int, int], end: Tuple[int, int]) -> List[Tuple[int, int]]:
    months, (y, m) = [], start
    while (y, m) <= end:
        months.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return months


def _fmt_date(iso: Optional[str]) -> str:
    return "/".join(reversed(iso[:10].split("-"))) if iso else ""


def _fmt_dates(dates: List[str]) -> str:
    if len(dates) <= 2:
        return " e ".join(_fmt_date(d) for d in dates)
    return f"{_fmt_date(dates[0])} a {_fmt_date(dates[-1])}"


def _describe_day(snap: Optional[Dict[str, Any]]) -> str:
    if not snap:
        return "sem registro"
    if snap.get("status") != "TRABALHO":
        return snap.get("status") or ""
    if snap.get("lunch_start"):
        return f"{snap['start_time']}–{snap['lunch_start']} / {snap['lunch_end']}–{snap['end_time']}"
    return f"{snap.get('start_time')}–{snap.get('end_time')}"


def _reincidence_index(db: Session, organization_id: int) -> Dict[Tuple[int, str], List[int]]:
    """Meses (ano*12+mês) em que cada colaborador teve cada regra, em todas as auditorias gravadas."""
    index: Dict[Tuple[int, str], List[int]] = {}
    rows = db.query(models.RHAuditItem.employee_id, models.RHAuditItem.rule_code,
                    models.RHMonthlyAudit.year, models.RHMonthlyAudit.month).join(models.RHMonthlyAudit).filter(
        models.RHMonthlyAudit.organization_id == organization_id
    ).all()
    for emp_id, code, y, m in rows:
        index.setdefault((emp_id, code), []).append(y * 12 + m)
    return index


def _changes_for(db: Session, items: List[Dict[str, Any]], users: Dict[int, str]) -> Dict[Tuple[int, date], List[Dict]]:
    keys = {(i["employee_id"], date.fromisoformat(d)) for i in items for d in (i.get("dates") or [])}
    if not keys:
        return {}
    employee_ids = {k[0] for k in keys}
    dates = {k[1] for k in keys}
    out: Dict[Tuple[int, date], List[Dict]] = {}
    for c in db.query(models.RHWorkDayChange).filter(
        models.RHWorkDayChange.employee_id.in_(employee_ids),
        models.RHWorkDayChange.work_date.in_(dates)
    ).order_by(models.RHWorkDayChange.created_at.asc(), models.RHWorkDayChange.id.asc()).all():
        if (c.employee_id, c.work_date) not in keys:
            continue
        out.setdefault((c.employee_id, c.work_date), []).append({
            "id": c.id,
            "work_date": c.work_date.isoformat(),
            "origin": c.origin,
            "before": c.before,
            "after": c.after,
            "user": users.get(c.user_id),
            "created_at": c.created_at.isoformat() if c.created_at else None,
        })
    return out


def _bucket(store: Dict, key, label: str, item: Dict[str, Any]) -> None:
    b = store.setdefault(key, {"key": key, "label": label, "total": 0, "critical": 0, "alert": 0,
                               "reincidences": 0, "financial_estimate": 0.0})
    b["total"] += 1
    b["critical"] += item["severity"] == "CRITICA"
    b["alert"] += item["severity"] == "ALERTA"
    b["reincidences"] += item["reincidence_count"] > 0
    b["financial_estimate"] = round(b["financial_estimate"] + (item.get("financial_estimate") or 0.0), 2)


def build_report(db: Session, organization_id: int, start: Tuple[int, int], end: Tuple[int, int],
                 employee_id: Optional[int] = None, rule: Optional[str] = None,
                 severity: Optional[str] = None, status: Optional[str] = None) -> Dict[str, Any]:
    months = month_range(start, end)
    if not months:
        raise ValueError("Período inválido")
    if len(months) > MAX_REPORT_MONTHS:
        raise ValueError(f"Período máximo de {MAX_REPORT_MONTHS} meses")

    with_schedule = {
        (s.year, s.month) for s in db.query(models.RHMonthlySchedule).filter(
            models.RHMonthlySchedule.organization_id == organization_id
        ).all()
    }
    users = {u.id: (u.name or u.email) for u in db.query(models.User).filter(
        models.User.organization_id == organization_id
    ).all()}

    audits, items = [], []
    for y, m in months:
        if (y, m) not in with_schedule:
            continue
        audit, _ = refresh_month_audit(db, organization_id, y, m)
        audits.append({
            "year": y, "month": m, "status": audit.status if audit.items or audit.approved_at else "SEM_IRREGULARIDADES",
            "approved_by": users.get(audit.approved_by_user_id), "general_note": audit.general_note,
            "approved_at": audit.approved_at.isoformat() if audit.approved_at else None,
            "total": len(audit.items), "pending": sum(1 for i in audit.items if i.status == "PENDENTE"),
        })
        for item in audit.items:
            items.append({**item_to_dict(item), "year": y, "month": m,
                          "approved_by": users.get(audit.approved_by_user_id) if item.status == "APROVADA" else None})
    db.commit()

    # Reincidência: mesma regra e colaborador nos 12 meses anteriores (multa do art. 75 em dobro)
    index = _reincidence_index(db, organization_id)
    for it in items:
        key = it["year"] * 12 + it["month"]
        previous = [mk for mk in index.get((it["employee_id"], it["rule_code"]), []) if key - REINCIDENCE_MONTHS <= mk < key]
        it["reincidence_count"] = len(previous)

    if employee_id:
        items = [i for i in items if i["employee_id"] == employee_id]
    if rule:
        items = [i for i in items if i["rule_code"] == rule]
    if severity:
        items = [i for i in items if i["severity"] == severity]
    if status:
        items = [i for i in items if i["status"] == status]
    items.sort(key=lambda i: ((i.get("dates") or [""])[0], i.get("employee_name") or "", i["rule_code"]))

    changes = _changes_for(db, [i for i in items if i["rule_code"] not in NO_DAY_HISTORY_RULES], users)
    for it in items:
        seen, hist = set(), []
        for d in it.get("dates") or []:
            for ch in changes.get((it["employee_id"], date.fromisoformat(d)), []):
                if ch["id"] not in seen:
                    seen.add(ch["id"])
                    hist.append(ch)
        it["changes"] = hist

    by_rule: Dict[str, Dict] = {}
    by_employee: Dict[int, Dict] = {}
    by_month: Dict[str, Dict] = {}
    for it in items:
        _bucket(by_rule, it["rule_code"], f"{it['rule_code']} {it['title']}", it)
        _bucket(by_employee, it["employee_id"], it.get("employee_name") or "", it)
        _bucket(by_month, f"{it['year']}-{it['month']:02d}", f"{MONTH_NAMES[it['month'] - 1]}/{it['year']}", it)

    return {
        "period": {"from": f"{start[0]}-{start[1]:02d}", "to": f"{end[0]}-{end[1]:02d}"},
        "filters": {"employee_id": employee_id, "rule": rule, "severity": severity, "status": status},
        "disclaimer": DISCLAIMER,
        "audits": audits,
        "totals": {
            "total": len(items),
            "critical": sum(1 for i in items if i["severity"] == "CRITICA"),
            "alert": sum(1 for i in items if i["severity"] == "ALERTA"),
            "pending": sum(1 for i in items if i["status"] == "PENDENTE"),
            "approved": sum(1 for i in items if i["status"] == "APROVADA"),
            "reincidences": sum(1 for i in items if i["reincidence_count"] > 0),
            "employees": len({i["employee_id"] for i in items}),
            "financial_estimate": round(sum(i.get("financial_estimate") or 0.0 for i in items), 2),
        },
        "by_rule": sorted(by_rule.values(), key=lambda b: (-b["total"], b["key"])),
        "by_employee": sorted(by_employee.values(), key=lambda b: (-b["total"], b["label"])),
        "by_month": sorted(by_month.values(), key=lambda b: b["key"]),
        "items": items,
    }


# ==============================================================================
# --- [BLOCO: EXPORTAÇÃO CSV] ---
# ==============================================================================

CSV_COLUMNS = [
    ("Mês", lambda i: f"{i['month']:02d}/{i['year']}"),
    ("Data(s)", lambda i: _fmt_dates(i.get("dates") or [])),
    ("Colaborador", lambda i: i.get("employee_name") or ""),
    ("Regra", lambda i: i["rule_code"]),
    ("Irregularidade", lambda i: i.get("title") or ""),
    ("Gravidade", lambda i: SEVERITY_LABELS.get(i["severity"], i["severity"])),
    ("Situação", lambda i: STATUS_LABELS.get(i["status"], i["status"])),
    ("O que causou", lambda i: i.get("cause") or ""),
    ("Evidências", lambda i: " | ".join(
        f"{_fmt_date(e.get('date')) + ' - ' if e.get('date') else ''}{e['description']}{': ' + e['value'] if e.get('value') else ''}"
        for e in i.get("evidence") or [])),
    ("Histórico da alteração", lambda i: " | ".join(
        f"{_fmt_date(c['created_at'])} {c.get('user') or 'sistema'} ({ORIGIN_LABELS.get(c['origin'], c['origin'])}) "
        f"{_fmt_date(c['work_date'])}: {_describe_day(c.get('before'))} -> {_describe_day(c.get('after'))}"
        for c in i.get("changes") or [])),
    ("Base legal", lambda i: i.get("legal_basis") or ""),
    ("Consequência financeira", lambda i: i.get("financial_consequence") or ""),
    ("Estimativa (R$)", lambda i: f"{i['financial_estimate']:.2f}".replace(".", ",") if i.get("financial_estimate") else ""),
    ("Consequência administrativa", lambda i: " ".join(filter(None, [i.get("administrative_consequence"), i.get("administrative_footer")]))),
    ("Sugestão de correção", lambda i: i.get("suggestion") or ""),
    ("Reincidências (12 meses)", lambda i: str(i.get("reincidence_count") or 0)),
    ("Observação", lambda i: i.get("note") or ""),
    ("Força maior (art. 61)", lambda i: "Sim" if i.get("is_force_majeure") else "Não"),
    ("Aprovada em", lambda i: _fmt_date(i.get("approved_at"))),
    ("Aprovada por", lambda i: i.get("approved_by") or ""),
]


def report_to_csv(report: Dict[str, Any]) -> bytes:
    """CSV com separador ';' e BOM (abre direto no Excel em português)."""
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";", quoting=csv.QUOTE_MINIMAL)
    writer.writerow([c[0] for c in CSV_COLUMNS])
    for item in report["items"]:
        writer.writerow([fn(item) for _, fn in CSV_COLUMNS])
    return ("﻿" + buf.getvalue()).encode("utf-8")


# ==============================================================================
# --- [BLOCO: EXPORTAÇÃO PDF] ---
# ==============================================================================

_PDF_REPLACEMENTS = {"–": "-", "—": "-", "•": "-", "→": "->", "“": '"', "”": '"', "‘": "'", "’": "'", "…": "..."}


def _shorten(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0] + "..."


def _pdf_text(value: Any) -> str:
    """Fonte padrão do PDF (Latin-1): mantém acentos e troca símbolos tipográficos."""
    text = str(value if value is not None else "")
    for a, b in _PDF_REPLACEMENTS.items():
        text = text.replace(a, b)
    return text.encode("latin-1", "replace").decode("latin-1")


class _ReportPDF(FPDF):
    def __init__(self, title: str):
        super().__init__(orientation="P", unit="mm", format="A4")
        self.report_title = title
        self.set_auto_page_break(auto=True, margin=15)
        self.set_margins(12, 12, 12)

    def footer(self):
        self.set_y(-10)
        self.set_font("Helvetica", size=7)
        self.set_text_color(120)
        self.cell(0, 5, _pdf_text(f"{self.report_title} - página {self.page_no()}/{{nb}}"), align="C")


def _section(pdf: FPDF, title: str) -> None:
    pdf.ln(2)
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(30)
    pdf.cell(0, 6, _pdf_text(title), new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(180)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
    pdf.ln(1)


def _paragraph(pdf: FPDF, text: str, bold_label: Optional[str] = None, size: float = 8.5) -> None:
    pdf.set_text_color(30)
    if bold_label:
        pdf.set_font("Helvetica", "B", size)
        pdf.multi_cell(0, 4.2, _pdf_text(bold_label), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", size=size)
    pdf.multi_cell(0, 4.2, _pdf_text(text), new_x="LMARGIN", new_y="NEXT")


def _table(pdf: FPDF, headers: List[str], rows: List[List[str]], widths: Tuple[int, ...]) -> None:
    pdf.set_font("Helvetica", size=7.5)
    with pdf.table(col_widths=widths, text_align="LEFT", line_height=4, first_row_as_headings=True) as table:
        table.row([_pdf_text(h) for h in headers])
        for r in rows:
            table.row([_pdf_text(c) for c in r])


def report_to_pdf(report: Dict[str, Any], organization_name: Optional[str]) -> bytes:
    title = "Relatório de Irregularidades Trabalhistas"
    pdf = _ReportPDF(title)
    pdf.alias_nb_pages()
    pdf.add_page()

    # Cabeçalho
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 8, _pdf_text(title), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", size=9)
    period = report["period"]
    pdf.cell(0, 5, _pdf_text(f"{organization_name or ''} - Período: {period['from'][5:]}/{period['from'][:4]} a "
                             f"{period['to'][5:]}/{period['to'][:4]} - Gerado em {datetime.now().strftime('%d/%m/%Y %H:%M')}"),
             new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)
    pdf.set_fill_color(253, 236, 236)
    pdf.set_font("Helvetica", "B", 8.5)
    pdf.multi_cell(0, 4.5, _pdf_text(report["disclaimer"]), fill=True, new_x="LMARGIN", new_y="NEXT")

    # Totalizadores
    t = report["totals"]
    _section(pdf, "Totais do período")
    _paragraph(pdf, (f"{t['total']} irregularidade(s): {t['critical']} crítica(s) e {t['alert']} alerta(s) - "
                     f"{t['employees']} colaborador(es) - {t['pending']} pendente(s), {t['approved']} aprovada(s) - "
                     f"{t['reincidences']} reincidência(s) em 12 meses - estimativa financeira R$ "
                     f"{t['financial_estimate']:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")))
    if report["audits"]:
        _table(pdf, ["Mês", "Situação da auditoria", "Itens", "Pendentes", "Aprovada por / em"],
               [[f"{MONTH_NAMES[a['month'] - 1]}/{a['year']}", a["status"], str(a["total"]), str(a["pending"]),
                 f"{a['approved_by'] or ''} {_fmt_date(a['approved_at'])}".strip()] for a in report["audits"]],
               (30, 40, 15, 20, 81))
    if report["by_rule"]:
        pdf.ln(2)
        _table(pdf, ["Regra", "Total", "Críticas", "Alertas", "Reincid."],
               [[b["label"], str(b["total"]), str(b["critical"]), str(b["alert"]), str(b["reincidences"])] for b in report["by_rule"]],
               (110, 19, 19, 19, 19))
    if report["by_employee"]:
        pdf.ln(2)
        _table(pdf, ["Colaborador", "Total", "Críticas", "Alertas", "Reincid."],
               [[b["label"], str(b["total"]), str(b["critical"]), str(b["alert"]), str(b["reincidences"])] for b in report["by_employee"]],
               (110, 19, 19, 19, 19))

    # Lista resumida
    _section(pdf, "Lista resumida")
    if not report["items"]:
        _paragraph(pdf, "Nenhuma irregularidade no período com os filtros aplicados.")
    else:
        _table(pdf, ["#", "Data(s)", "Colaborador", "Regra", "Causa (resumo)", "Grav.", "Situação"],
               [[str(i["id"]), _fmt_dates(i.get("dates") or []), i.get("employee_name") or "", i["rule_code"],
                 _shorten(i.get("cause") or "", 110), SEVERITY_LABELS.get(i["severity"], i["severity"]),
                 STATUS_LABELS.get(i["status"], i["status"])] for i in report["items"]],
               (10, 24, 30, 12, 76, 14, 20))

    # Fichas completas
    for i in report["items"]:
        pdf.add_page()
        pdf.set_font("Helvetica", "B", 11)
        pdf.multi_cell(0, 6, _pdf_text(f"Irregularidade #{i['id']} - {i['rule_code']} - {i.get('title')}  "
                                       f"[{SEVERITY_LABELS.get(i['severity'], i['severity']).upper()}]"),
                       new_x="LMARGIN", new_y="NEXT")
        _paragraph(pdf, f"{i.get('employee_name')} - Data(s): {_fmt_dates(i.get('dates') or [])} - "
                        f"Auditoria de {MONTH_NAMES[i['month'] - 1]}/{i['year']}")
        _section(pdf, "O que causou")
        _paragraph(pdf, i.get("cause") or "")
        _section(pdf, "Evidências")
        for e in i.get("evidence") or []:
            _paragraph(pdf, f"- {_fmt_date(e.get('date')) + ' - ' if e.get('date') else ''}{e['description']}"
                            f"{': ' + e['value'] if e.get('value') else ''}")
        _section(pdf, "Histórico da alteração")
        if i.get("changes"):
            for c in i["changes"]:
                _paragraph(pdf, f"- {_fmt_date(c['created_at'])} - {c.get('user') or 'sistema'} "
                                f"({ORIGIN_LABELS.get(c['origin'], c['origin'])}), dia {_fmt_date(c['work_date'])}: "
                                f"{_describe_day(c.get('before'))} -> {_describe_day(c.get('after'))}")
        else:
            _paragraph(pdf, "Sem alterações registradas nos dias envolvidos.")
        _section(pdf, "Base legal")
        _paragraph(pdf, i.get("legal_basis") or "")
        _section(pdf, "Consequência financeira (devida ao trabalhador)")
        estimate = f" Estimativa: R$ {i['financial_estimate']:.2f}".replace(".", ",") if i.get("financial_estimate") else ""
        _paragraph(pdf, (i.get("financial_consequence") or "") + estimate)
        _section(pdf, "Consequência administrativa (permanece mesmo após o pagamento)")
        _paragraph(pdf, " ".join(filter(None, [i.get("administrative_consequence"), i.get("administrative_footer")])))
        if i.get("reincidence_count"):
            _paragraph(pdf, f"Reincidência: {i['reincidence_count'] + 1}ª ocorrência desta regra com este colaborador "
                            f"nos últimos {REINCIDENCE_MONTHS} meses.")
        _section(pdf, "Sugestão de correção")
        _paragraph(pdf, i.get("suggestion") or "")
        _section(pdf, "Aprovação")
        if i["status"] == "APROVADA":
            _paragraph(pdf, f"Aprovada na auditoria de {MONTH_NAMES[i['month'] - 1]}/{i['year']}"
                            f"{' por ' + i['approved_by'] if i.get('approved_by') else ''} em {_fmt_date(i.get('approved_at'))}."
                            f"{' Observação: ' + i['note'] + '.' if i.get('note') else ''}"
                            f" Força maior / serviço inadiável (art. 61): {'Sim' if i.get('is_force_majeure') else 'Não'}.")
        else:
            _paragraph(pdf, "Pendente de aprovação na auditoria do mês.")

    return bytes(pdf.output())
