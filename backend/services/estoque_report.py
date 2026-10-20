"""
Relatório de inventário e perdas de estoque (PDF, fpdf2).

Documento para assinatura da gerência: identifica a empresa e o inventário, lista faltas e
sobras com motivos e custos, totais por motivo, ajustes lançados na Omie, justificativas,
hash de integridade da aprovação e campos de assinatura.
"""
from datetime import datetime
from typing import Any, Dict, List, Optional

from fpdf import FPDF
from fpdf.enums import XPos, YPos
from fpdf.fonts import FontFace

import models.models as models
from services import estoque_engine as engine
from services import estoque_service as service

REASON_LABELS = {**engine.FALTA_REASONS, **engine.SOBRA_REASONS, "SEM_MOTIVO": "Sem motivo"}
STATUS_LABELS = {
    "RASCUNHO": "Rascunho", "EM_CONTAGEM": "Em contagem", "CONFERENCIA": "Conferência",
    "AGUARDANDO_APROVACAO": "Aguardando aprovação", "APROVADO": "Aprovado", "EFETIVANDO": "Efetivando",
    "EFETIVANDO_COM_ERRO": "Erro na efetivação", "EFETIVADO": "Efetivado", "REVERTENDO": "Revertendo",
    "REVERSAO_COM_ERRO": "Erro na reversão", "CONCLUIDO": "Concluído", "CANCELADO": "Cancelado",
}
# Status em que o conteúdo está congelado pela aprovação (relatório oficial, sem marca de prévia)
OFFICIAL_STATUSES = {engine.APROVADO, engine.EFETIVANDO, engine.EFETIVANDO_COM_ERRO, engine.EFETIVADO,
                     engine.REVERTENDO, engine.REVERSAO_COM_ERRO, engine.CONCLUIDO}

HEAD_STYLE = FontFace(emphasis="BOLD", color=(255, 255, 255), fill_color=(51, 65, 85))
ZEBRA = (241, 245, 249)


# ==============================================================================
# --- [BLOCO: Formatação] ---
# ==============================================================================

_REPLACEMENTS = {"−": "-", "–": "-", "—": "-", "‘": "'", "’": "'",
                 "“": '"', "”": '"', "•": "-", "×": "x", "…": "..."}


def _t(value: Any) -> str:
    """Texto compatível com as fontes padrão do PDF (latin-1)."""
    text = "" if value is None else str(value)
    for src, dst in _REPLACEMENTS.items():
        text = text.replace(src, dst)
    return text.encode("latin-1", "replace").decode("latin-1")


def _money(value: Optional[float]) -> str:
    if value is None:
        return "-"
    txt = f"{abs(value):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{'-' if value < 0 else ''}R$ {txt}"


def _qty(value: Optional[float]) -> str:
    if value is None:
        return "-"
    txt = f"{value:,.4f}".rstrip("0").rstrip(".")
    return txt.replace(",", "X").replace(".", ",").replace("X", ".")


def _date(value) -> str:
    if not value:
        return "-"
    if isinstance(value, datetime):
        return value.strftime("%d/%m/%Y %H:%M")
    return value.strftime("%d/%m/%Y")


# ==============================================================================
# --- [BLOCO: Documento PDF] ---
# ==============================================================================

class _ReportPDF(FPDF):
    def __init__(self, title: str, footer_note: str, draft: bool):
        super().__init__(orientation="L", unit="mm", format="A4")
        self.report_title = title
        self.footer_note = footer_note
        self.draft = draft
        self.set_auto_page_break(auto=True, margin=16)
        self.set_margins(12, 12, 12)
        self.alias_nb_pages()

    def header(self):
        if self.draft:
            # Faixa de prévia: conteúdo ainda não aprovado, não deve ser assinado
            self.set_font("Helvetica", "B", 8)
            self.set_fill_color(254, 226, 226)
            self.set_text_color(185, 28, 28)
            self.cell(0, 5, _t("PRÉVIA - inventário ainda não aprovado. Não assinar."), align="C", fill=True,
                      new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            self.ln(1)
        if self.page_no() > 1:
            self.set_font("Helvetica", "B", 9)
            self.set_text_color(100, 116, 139)
            self.cell(0, 6, _t(self.report_title), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            self.ln(1)
        self.set_text_color(15, 23, 42)

    def footer(self):
        if self.draft:
            # Marca d'água desenhada por último para ficar visível sobre as tabelas
            with self.local_context(text_color=(100, 116, 139), fill_opacity=0.12):
                self.set_font("Helvetica", "B", 48)
                mark = _t("PRÉVIA - NÃO APROVADO")
                with self.rotation(20, self.w / 2, self.h / 2):
                    self.text(self.w / 2 - self.get_string_width(mark) / 2, self.h / 2, mark)
        self.set_y(-12)
        self.set_font("Helvetica", "", 7)
        self.set_text_color(100, 116, 139)
        self.cell(0, 4, _t(self.footer_note), new_x=XPos.RIGHT, new_y=YPos.TOP)
        self.set_x(-40)
        self.cell(28, 4, f"Página {self.page_no()}/{{nb}}", align="R")
        self.set_text_color(15, 23, 42)

    # --- Helpers de layout ---
    def section(self, title: str):
        if self.get_y() > self.h - 40:
            self.add_page()
        self.ln(3)
        self.set_font("Helvetica", "B", 11)
        self.set_fill_color(226, 232, 240)
        self.cell(0, 7, _t(title), fill=True, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.ln(1.5)

    def info_grid(self, pairs, columns: int, value_size: float = 8.5):
        """Caixas rótulo/valor em grade (rótulo pequeno em cima, valor em negrito embaixo)."""
        box_w = (self.w - self.l_margin - self.r_margin) / columns
        row_h = 5 + value_size * 0.55
        for start in range(0, len(pairs), columns):
            y = self.get_y()
            for idx, (label, value) in enumerate(pairs[start:start + columns]):
                x = self.l_margin + idx * box_w
                self.set_xy(x, y)
                self.set_font("Helvetica", "", 7)
                self.set_text_color(100, 116, 139)
                self.cell(box_w - 2, 4, _t(label), border="LTR")
                self.set_xy(x, y + 4)
                self.set_text_color(15, 23, 42)
                self.set_font("Helvetica", "B", value_size)
                self.cell(box_w - 2, row_h - 4, _t(value), border="LBR")
            self.set_xy(self.l_margin, y + row_h + 1.5)

    def note(self, text: str, size: float = 8):
        self.set_font("Helvetica", "", size)
        self.multi_cell(0, 4.2, _t(text), new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    def table_rows(self, headings: List[str], rows: List[List[str]], widths: List[float],
                   align: List[str], font_size: float = 7.5):
        self.set_font("Helvetica", "", font_size)
        with self.table(col_widths=widths, text_align=align, headings_style=HEAD_STYLE, line_height=4.6,
                        cell_fill_color=ZEBRA, cell_fill_mode="ROWS", borders_layout="HORIZONTAL_LINES",
                        padding=1) as table:
            head = table.row()
            for h in headings:
                head.cell(_t(h))
            for row in rows:
                r = table.row()
                for value in row:
                    r.cell(_t(value))


# ==============================================================================
# --- [BLOCO: Montagem do Relatório] ---
# ==============================================================================

def _reasons_text(item: models.InventoryCountItem) -> str:
    return "; ".join(f"{_qty(r.quantity)} {REASON_LABELS.get(r.reason, r.reason)}" for r in item.reasons) or "-"


def _adjustment_text(item: models.InventoryCountItem) -> str:
    adj = item.adjustment
    if not adj:
        return "-"
    ident = f" #{adj.omie_ajuste_id}" if adj.omie_ajuste_id else ""
    return f"{adj.tipo}/{adj.motivo} {_qty(adj.quantity)} @ {_money(adj.unit_value)}{ident} ({adj.status})"


def _company_lines(company: Dict[str, Any], org_name: str) -> List[str]:
    name = company.get("razao_social") or company.get("nome_fantasia") or org_name
    docs = " | ".join(x for x in [
        f"CNPJ {company['cnpj']}" if company.get("cnpj") else "",
        f"IE {company['inscricao_estadual']}" if company.get("inscricao_estadual") else "",
    ] if x)
    address = ", ".join(x for x in [company.get("endereco"), company.get("cidade"),
                                     company.get("uf"), company.get("cep")] if x)
    return [x for x in [name, company.get("nome_fantasia") if company.get("razao_social") else None, docs, address] if x]


def build_report(count: models.InventoryCount, company: Optional[Dict[str, Any]], org_name: str,
                 generated_by: Optional[str] = None) -> bytes:
    """Gera o PDF do inventário. Antes da aprovação, o documento sai marcado como prévia."""
    company = company or {}
    draft = count.status not in OFFICIAL_STATUSES
    family = count.family.name if count.family else "-"
    title = f"Inventário #{count.id} - {family} - corte {_date(count.cutoff_date)}"
    generated_at = datetime.now()
    footer = (f"Gerado em {generated_at.strftime('%d/%m/%Y %H:%M')}"
              f"{' por ' + generated_by if generated_by else ''}"
              f" | Hash de integridade: {count.snapshot_hash or 'não aprovado'}")
    pdf = _ReportPDF(title, footer, draft)
    pdf.add_page()

    engine_items = [service.item_to_engine(i) for i in count.items]
    summary = engine.summarize(engine_items)

    # --- Cabeçalho: empresa e identificação do inventário ---
    pdf.set_font("Helvetica", "B", 13)
    lines = _company_lines(company, org_name)
    pdf.cell(0, 7, _t(lines[0] if lines else org_name), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_font("Helvetica", "", 8.5)
    for line in lines[1:]:
        pdf.cell(0, 4.5, _t(line), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(2)
    pdf.set_font("Helvetica", "B", 15)
    pdf.cell(0, 8, _t("RELATÓRIO DE INVENTÁRIO E PERDAS DE ESTOQUE"), new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    info = [
        ("Inventário", f"#{count.id}"), ("Família", family), ("Data de corte", _date(count.cutoff_date)),
        ("Situação", STATUS_LABELS.get(count.status, count.status)),
        ("Criado por", f"{count.created_by.name if count.created_by else '-'} em {_date(count.created_at)}"),
        ("Saldo do sistema capturado", _date(count.snapshot_at)),
        ("Aprovado por", f"{count.approved_by.name} em {_date(count.approved_at)}" if count.approved_by else "-"),
        ("Efetivado na Omie", _date(count.effective_at)),
    ]
    pdf.ln(1)
    pdf.info_grid(info, columns=4)
    if count.notes:
        pdf.note(f"Observações: {count.notes}")

    # --- Resumo ---
    pdf.section("Resumo")
    totals = [
        ("Itens no escopo", str(summary["total_items"])), ("Itens contados", str(summary["counted_items"])),
        ("Perdas", _money(summary["perdas_value"])), ("Quebra técnica", _money(summary["quebra_tecnica_value"])),
        ("Sobras", _money(summary["sobras_value"])), ("Resultado líquido", _money(summary["net_value"])),
    ]
    pdf.info_grid(totals, columns=len(totals), value_size=11)
    pdf.note("Valores a custo (CMC na data de corte; custo da última compra quando o CMC não é aplicável). "
             "Quebra técnica (desidratação, aparas) é perda normal do processo e está separada das perdas.", 7.5)

    # --- Faltas e sobras ---
    def impact(item):  # maior valor absoluto primeiro
        diff = engine.compute_difference(item.counted_qty, item.system_qty) or 0
        return -abs(diff * engine.unit_cost_for_valuation(item.cmc, item.reference_cost))

    faltas = sorted((i for i in count.items if (engine.compute_difference(i.counted_qty, i.system_qty) or 0) < 0), key=impact)
    sobras = sorted((i for i in count.items if (engine.compute_difference(i.counted_qty, i.system_qty) or 0) > 0), key=impact)
    headings = ["Código", "Produto", "Un", "Sistema", "Contado", "Diferença", "Custo unit.", "Total", "Motivos", "Ajuste na Omie"]
    widths = [20, 62, 10, 18, 18, 18, 20, 22, 45, 40]
    align = ["LEFT", "LEFT", "CENTER", "RIGHT", "RIGHT", "RIGHT", "RIGHT", "RIGHT", "LEFT", "LEFT"]

    def diff_rows(items):
        rows = []
        for i in items:
            diff = engine.compute_difference(i.counted_qty, i.system_qty)
            cost = engine.unit_cost_for_valuation(i.cmc, i.reference_cost)
            rows.append([str(i.omie_id), i.product_name, i.unit or "-", _qty(i.system_qty), _qty(i.counted_qty),
                         _qty(diff), _money(cost), _money(diff * cost), _reasons_text(i), _adjustment_text(i)])
        return rows

    pdf.section(f"Faltas ({len(faltas)} itens)")
    if faltas:
        pdf.table_rows(headings, diff_rows(faltas), widths, align)
    else:
        pdf.note("Nenhuma falta.")
    pdf.section(f"Sobras ({len(sobras)} itens)")
    if sobras:
        pdf.table_rows(headings, diff_rows(sobras), widths, align)
    else:
        pdf.note("Nenhuma sobra.")

    # --- Totais por motivo ---
    pdf.section("Totais por motivo")
    reason_rows = [[REASON_LABELS.get(k, k), str(v["qty_items"]), _qty(v.get("quantity")), _money(v["value"])]
                   for k, v in sorted(summary["by_reason"].items(), key=lambda kv: kv[1]["value"])]
    if reason_rows:
        pdf.table_rows(["Motivo", "Itens", "Quantidade", "Valor"], reason_rows, [110, 30, 40, 50],
                       ["LEFT", "RIGHT", "RIGHT", "RIGHT"], font_size=8)
    else:
        pdf.note("Sem divergências.")

    # --- Justificativas e pares ---
    by_id = {i.id: i for i in count.items}
    justified = [i for i in count.items if i.justification or i.pair_item_id]
    if justified:
        pdf.section("Justificativas e pares (troca de produto)")
        rows = [[i.product_name,
                 by_id[i.pair_item_id].product_name if i.pair_item_id in by_id else "-",
                 i.justification or "-"] for i in justified]
        pdf.table_rows(["Produto", "Par", "Justificativa"], rows, [80, 70, 123], ["LEFT", "LEFT", "LEFT"])

    # --- Itens sem divergência ---
    equal = [i for i in count.items if i.system_qty is not None and not engine.compute_difference(i.counted_qty, i.system_qty)]
    pdf.section(f"Itens conferidos sem divergência ({len(equal)})")
    if equal:
        rows = [[str(i.omie_id), i.product_name, i.unit or "-", _qty(i.counted_qty)] for i in equal]
        pdf.table_rows(["Código", "Produto", "Un", "Quantidade"], rows, [30, 170, 20, 53],
                       ["LEFT", "LEFT", "CENTER", "RIGHT"])

    # --- Declaração e assinaturas ---
    if pdf.get_y() > pdf.h - 75:
        pdf.add_page()
    pdf.section("Declaração e assinaturas")
    pdf.note("Declaramos que as quantidades acima foram apuradas por contagem física na data de corte indicada e que as "
             "divergências e seus motivos foram conferidos pela gerência. Este relatório fundamenta os ajustes de "
             "estoque lançados na Omie e, para as perdas, o estorno do crédito de ICMS (art. 312, IV, RICMS-BA).", 8)
    pdf.ln(12)
    sig_w = (pdf.w - pdf.l_margin - pdf.r_margin - 20) / 3
    y = pdf.get_y()
    for idx, role in enumerate(["Gerente", "Responsável pela contagem", "Conferente"]):
        x = pdf.l_margin + idx * (sig_w + 10)
        pdf.line(x, y, x + sig_w, y)
        pdf.set_xy(x, y + 1)
        pdf.set_font("Helvetica", "B", 8.5)
        pdf.cell(sig_w, 4.5, _t(role), align="C")
        for offset, label in enumerate(["Nome:", "CPF:", "Data:      /      /"]):
            pdf.set_xy(x, y + 7 + offset * 6)
            pdf.set_font("Helvetica", "", 8)
            pdf.cell(sig_w, 4.5, _t(label))
    pdf.set_y(y + 26)

    return bytes(pdf.output())


def report_filename(count: models.InventoryCount) -> str:
    family = (count.family.name if count.family else "familia").replace(" ", "_")
    return f"inventario_{count.id}_{family}_{count.cutoff_date.strftime('%Y%m%d')}.pdf"
