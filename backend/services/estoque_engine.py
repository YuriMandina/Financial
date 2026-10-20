"""
Motor de regras do Módulo de Inventário (balanço de estoque por família).

Funções puras, sem acesso a banco ou à Omie, para que todas as regras de
contagem, divergência, classificação de ajuste e aprovação sejam testáveis.
"""
import ast
import hashlib
import json
import operator
from typing import Any, Dict, Iterable, List, Optional

# ==============================================================================
# --- [BLOCO: Constantes de Domínio] ---
# ==============================================================================

QTY_DECIMALS = 4
MONEY_DECIMALS = 2

# --- Status do inventário ---
RASCUNHO = "RASCUNHO"
EM_CONTAGEM = "EM_CONTAGEM"
CONFERENCIA = "CONFERENCIA"
AGUARDANDO_APROVACAO = "AGUARDANDO_APROVACAO"
APROVADO = "APROVADO"
EFETIVANDO = "EFETIVANDO"
EFETIVANDO_COM_ERRO = "EFETIVANDO_COM_ERRO"
EFETIVADO = "EFETIVADO"
REVERTENDO = "REVERTENDO"
REVERSAO_COM_ERRO = "REVERSAO_COM_ERRO"
CONCLUIDO = "CONCLUIDO"
CANCELADO = "CANCELADO"

# Status que impedem abrir outro inventário da mesma família/produto
OPEN_STATUSES = {
    RASCUNHO, EM_CONTAGEM, CONFERENCIA, AGUARDANDO_APROVACAO,
    APROVADO, EFETIVANDO, EFETIVANDO_COM_ERRO, REVERTENDO, REVERSAO_COM_ERRO,
}
# Status em que a Omie já pode ter recebido ajustes deste inventário
OMIE_TOUCHED_STATUSES = {EFETIVANDO, EFETIVANDO_COM_ERRO, EFETIVADO, REVERTENDO, REVERSAO_COM_ERRO}

# Ação -> (status de origem permitidos, status de destino)
TRANSITIONS = {
    "iniciar": ({RASCUNHO}, EM_CONTAGEM),
    "encerrar": ({EM_CONTAGEM}, CONFERENCIA),
    "reabrir_contagem": ({CONFERENCIA}, EM_CONTAGEM),
    "enviar": ({CONFERENCIA}, AGUARDANDO_APROVACAO),
    "rejeitar": ({AGUARDANDO_APROVACAO}, CONFERENCIA),
    "aprovar": ({AGUARDANDO_APROVACAO}, APROVADO),
    "desaprovar": ({APROVADO}, CONFERENCIA),
    "cancelar": ({RASCUNHO, EM_CONTAGEM, CONFERENCIA, AGUARDANDO_APROVACAO, APROVADO}, CANCELADO),
    # --- Integração Omie (efeitos colaterais executados pela fila) ---
    "efetivar": ({APROVADO}, EFETIVANDO),
    "reprocessar": ({EFETIVANDO_COM_ERRO}, EFETIVANDO),
    "reverter": ({EFETIVADO, EFETIVANDO_COM_ERRO, REVERSAO_COM_ERRO}, REVERTENDO),
    "concluir": ({EFETIVADO}, CONCLUIDO),
}
# Ações executadas pela integração Omie (estoque_omie_service), não pela transição genérica
OMIE_ACTIONS = {"efetivar", "reprocessar", "reverter"}

# --- Status de contagem do item ---
ITEM_PENDENTE = "PENDENTE"
ITEM_CONTADO = "CONTADO"
ITEM_RECONTAGEM = "RECONTAGEM"

# --- Modos de lançamento ---
MODE_UNIDADE = "UN"        # quantidade direta (unidades ou kg digitados)
MODE_EMBALAGEM = "EMB"     # n embalagens x fator
MODE_PESO = "PESO"         # peso bruto - tara
ENTRY_MODES = {MODE_UNIDADE, MODE_EMBALAGEM, MODE_PESO}

# --- Motivos de divergência ---
FALTA_REASONS = {
    "QUEBRA_TECNICA": "Quebra técnica (peso/aparas)",
    "AVARIA": "Avaria / Deterioração",
    "VENCIMENTO": "Vencimento",
    "FURTO_ROUBO": "Furto / Roubo",
    "DESAPARECIMENTO": "Desaparecimento (não identificado)",
}
SOBRA_REASONS = {
    "TROCA_PRODUTO": "Troca de produto",
    "ERRO_PDV": "Erro de registro no PDV",
    "NF_ENTRADA_PENDENTE": "NF de entrada pendente",
    "NAO_IDENTIFICADA": "Não identificada",
}
# Motivo que bloqueia o ajuste: a correção é lançar a NF de entrada na Omie
BLOCKING_REASONS = {"NF_ENTRADA_PENDENTE"}

# --- Casos de ajuste (ver classify_case) ---
CASE_A = "A"  # saldo >= 0 e CMC coerente: ajuste simples pela diferença
CASE_B = "B"  # saldo negativo e contado > 0: ajuste de saldo ao custo de referência
CASE_C = "C"  # saldo > 0 com CMC suspeito: correção de CMC (opcional, aprovada)
CASE_D = "D"  # saldo negativo e contado = 0: ajuste de saldo para zero

DEFAULT_RECOUNT_PCT = 5.0
DEFAULT_RECOUNT_VALUE = 50.0
DEFAULT_CMC_TOLERANCE_PCT = 30.0


def round_qty(value: Optional[float]) -> float:
    return round(float(value or 0.0), QTY_DECIMALS)


def round_money(value: Optional[float]) -> float:
    return round(float(value or 0.0), MONEY_DECIMALS)


# ==============================================================================
# --- [BLOCO: Calculadora de Expressões] ---
# ==============================================================================

_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}


def evaluate_expression(expression: str) -> float:
    """Avalia com segurança expressões aritméticas digitadas no app (ex: '12*12+6', '3,5 + 2,25').

    Aceita apenas números, + - * / e parênteses. Vírgula é tratada como separador decimal.
    """
    if expression is None or not str(expression).strip():
        raise ValueError("Expressão vazia.")
    normalized = str(expression).strip().replace(",", ".").replace("x", "*").replace("X", "*")
    try:
        tree = ast.parse(normalized, mode="eval")
    except SyntaxError:
        raise ValueError(f"Expressão inválida: {expression}")

    def _eval(node):
        if isinstance(node, ast.Expression):
            return _eval(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
            return float(node.value)
        if isinstance(node, ast.BinOp) and type(node.op) in _OPERATORS:
            right = _eval(node.right)
            if isinstance(node.op, ast.Div) and right == 0:
                raise ValueError("Divisão por zero.")
            return _OPERATORS[type(node.op)](_eval(node.left), right)
        if isinstance(node, ast.UnaryOp) and type(node.op) in _OPERATORS:
            return _OPERATORS[type(node.op)](_eval(node.operand))
        raise ValueError(f"Expressão inválida: {expression}")

    return round_qty(_eval(tree))


# ==============================================================================
# --- [BLOCO: Lançamentos de Contagem] ---
# ==============================================================================

def compute_entry_quantity(mode: str, raw_qty: float, factor: float = 1.0, tare_total: float = 0.0) -> float:
    """Converte um lançamento do app na quantidade líquida na unidade do produto.

    - UN:   raw_qty já está na unidade do produto.
    - EMB:  raw_qty é o número de embalagens; resultado = raw_qty x factor (ex: 12 CX x 12 un).
    - PESO: raw_qty é o peso bruto; resultado = raw_qty - tare_total.
    """
    if mode not in ENTRY_MODES:
        raise ValueError(f"Modo de lançamento inválido: {mode}")
    raw_qty = float(raw_qty or 0.0)
    if raw_qty <= 0:
        raise ValueError("A quantidade do lançamento deve ser maior que zero.")

    if mode == MODE_UNIDADE:
        return round_qty(raw_qty)
    if mode == MODE_EMBALAGEM:
        factor = float(factor or 0.0)
        if factor <= 0:
            raise ValueError("O fator da embalagem deve ser maior que zero.")
        return round_qty(raw_qty * factor)

    tare_total = float(tare_total or 0.0)
    if tare_total < 0:
        raise ValueError("A tara não pode ser negativa.")
    net = raw_qty - tare_total
    if net <= 0:
        raise ValueError("O peso líquido (bruto - tara) deve ser maior que zero.")
    return round_qty(net)


def sum_entries(entries: Iterable[Dict[str, Any]], count_round: int) -> float:
    """Soma os lançamentos não estornados de uma rodada de contagem."""
    return round_qty(sum(
        float(e.get("quantity") or 0.0)
        for e in entries
        if not e.get("voided") and int(e.get("round") or 1) == int(count_round)
    ))


# ==============================================================================
# --- [BLOCO: Divergência e Recontagem] ---
# ==============================================================================

def compute_difference(counted_qty: float, system_qty: Optional[float]) -> Optional[float]:
    """Diferença = contado - sistema. Negativa = falta; positiva = sobra."""
    if system_qty is None:
        return None
    return round_qty(float(counted_qty or 0.0) - float(system_qty))


def unit_cost_for_valuation(cmc: Optional[float], reference_cost: Optional[float]) -> float:
    """Custo unitário usado para valorizar divergências: CMC quando coerente, senão o custo de referência."""
    cmc = float(cmc or 0.0)
    if cmc > 0:
        return cmc
    return float(reference_cost or 0.0)


def needs_recount(
    difference: Optional[float],
    system_qty: Optional[float],
    unit_cost: float,
    pct_threshold: float = DEFAULT_RECOUNT_PCT,
    value_threshold: float = DEFAULT_RECOUNT_VALUE,
) -> bool:
    """Exige recontagem quando a divergência ultrapassa o % do saldo ou o valor em R$."""
    if difference is None or round_qty(difference) == 0:
        return False
    abs_diff = abs(difference)
    if value_threshold and abs_diff * float(unit_cost or 0.0) > value_threshold:
        return True
    base = abs(float(system_qty or 0.0))
    if base == 0:
        # Sem saldo de referência, qualquer divergência é relevante em %
        return bool(pct_threshold)
    return bool(pct_threshold) and (abs_diff / base) * 100.0 > pct_threshold


# ==============================================================================
# --- [BLOCO: Classificação e Plano de Ajuste na Omie] ---
# ==============================================================================

def is_cmc_suspicious(cmc: Optional[float], reference_cost: Optional[float],
                      tolerance_pct: float = DEFAULT_CMC_TOLERANCE_PCT) -> bool:
    """CMC é suspeito quando <= 0 ou desvia além da tolerância do custo de referência."""
    cmc = float(cmc or 0.0)
    ref = float(reference_cost or 0.0)
    if cmc <= 0:
        return True
    if ref <= 0:
        return False
    return abs(cmc - ref) / ref * 100.0 > tolerance_pct


def classify_case(system_qty: float, counted_qty: float, cmc: Optional[float],
                  reference_cost: Optional[float], tolerance_pct: float = DEFAULT_CMC_TOLERANCE_PCT) -> str:
    """Classifica o item no caso de ajuste (A, B, C ou D)."""
    system_qty = float(system_qty or 0.0)
    counted_qty = float(counted_qty or 0.0)
    if system_qty < 0:
        return CASE_D if round_qty(counted_qty) == 0 else CASE_B
    if system_qty > 0 and is_cmc_suspicious(cmc, reference_cost, tolerance_pct):
        return CASE_C
    return CASE_A


def build_adjustment(system_qty: float, counted_qty: float, cmc: Optional[float],
                     reference_cost: Optional[float], case: str,
                     cmc_correction_approved: bool = False) -> Optional[Dict[str, Any]]:
    """Monta o único ajuste de estoque (IncluirAjusteEstoque) que leva o item ao saldo contado.

    - A: falta -> SAI/PER a CMC; sobra -> ENT/INV a CMC (CMC não se altera).
    - B/D: SLD/INV com quantidade final = contado ao custo de referência (zera distorção do negativo).
    - C: com correção aprovada, SLD/INV (ou SLD/CMC se não houver diferença) ao custo de referência;
         sem aprovação, segue a regra do caso A.
    Retorna None quando não há nada a ajustar.
    """
    system_qty = round_qty(system_qty)
    counted_qty = round_qty(counted_qty)
    diff = round_qty(counted_qty - system_qty)
    ref = float(reference_cost or 0.0)
    cmc_value = float(cmc or 0.0)

    if case in (CASE_B, CASE_D) or (case == CASE_C and cmc_correction_approved):
        if ref <= 0 and counted_qty > 0:
            raise ValueError("Custo de referência obrigatório para ajuste de saldo.")
        if diff == 0:
            return {"tipo": "SLD", "motivo": "CMC", "quan": counted_qty, "valor": ref}
        return {"tipo": "SLD", "motivo": "INV", "quan": counted_qty, "valor": ref}

    if diff == 0:
        return None
    # Mesmo critério do rateio: valor mínimo de 0,01 para a Omie aceitar o movimento
    valor = max(cmc_value if cmc_value > 0 else ref, 0.01)
    if diff < 0:
        return {"tipo": "SAI", "motivo": "PER", "quan": abs(diff), "valor": valor}
    return {"tipo": "ENT", "motivo": "INV", "quan": diff, "valor": valor}


def adjustment_integration_code(count_id: int, item_id: int, seq: int = 1) -> str:
    """Código de integração do ajuste (cod_int_ajuste) usado para idempotência na Omie.

    seq muda a cada reversão do inventário, para que uma nova efetivação não colida com o código anterior.
    """
    return f"INV-{count_id}-{item_id}-{seq}"


# ==============================================================================
# --- [BLOCO: Distribuição da Divergência por Motivo] ---
# ==============================================================================

def reasons_for_sign(diff: Optional[float]) -> Dict[str, str]:
    """Motivos permitidos conforme o sinal da divergência (falta ou sobra)."""
    if not diff:
        return {}
    return FALTA_REASONS if diff < 0 else SOBRA_REASONS


def allocated_qty(reasons: Iterable[Dict[str, Any]]) -> float:
    return round_qty(sum(float(r.get("quantity") or 0.0) for r in reasons or []))


def remaining_to_allocate(diff: Optional[float], reasons: Iterable[Dict[str, Any]]) -> float:
    """Quantidade da divergência ainda sem motivo (negativa = distribuído a mais)."""
    if not diff:
        return round_qty(-allocated_qty(reasons))
    return round_qty(abs(diff) - allocated_qty(reasons))


def allocation_label(reasons: Iterable[Dict[str, Any]], unit: Optional[str] = None) -> str:
    """Texto resumido da distribuição, ex: '2 UN Avaria / Deterioração; 3 UN Desaparecimento'."""
    labels = {**FALTA_REASONS, **SOBRA_REASONS}
    suffix = f" {unit}" if unit else ""
    parts = []
    for r in reasons or []:
        qty = round_qty(r.get("quantity"))
        qty_txt = f"{qty:g}".replace(".", ",")
        parts.append(f"{qty_txt}{suffix} {labels.get(r.get('reason'), r.get('reason'))}")
    return "; ".join(parts)


# ==============================================================================
# --- [BLOCO: Validação para Envio/Aprovação] ---
# ==============================================================================

def validate_items_for_approval(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Retorna a lista de pendências que impedem enviar/aprovar o inventário.

    Cada item: product_name, system_qty, counted_qty, confirmed_zero, count_status,
    reasons [{reason, quantity}], justification, case, has_entries, reference_cost, cmc.
    """
    issues = []

    def add(item, code, message):
        issues.append({"item_id": item.get("id"), "product_name": item.get("product_name"), "code": code, "message": message})

    for item in items:
        if item.get("system_qty") is None:
            add(item, "SEM_SNAPSHOT", "Saldo do sistema ainda não capturado.")
            continue
        if item.get("count_status") == ITEM_RECONTAGEM:
            add(item, "RECONTAGEM_PENDENTE", "Recontagem pendente.")
            continue
        if not item.get("has_entries") and not item.get("confirmed_zero"):
            add(item, "NAO_CONTADO", "Item não contado. Lance a contagem ou confirme como zerado.")
            continue

        diff = compute_difference(item.get("counted_qty"), item.get("system_qty"))
        reasons = item.get("reasons") or []
        allowed = reasons_for_sign(diff)
        used = {r.get("reason") for r in reasons}
        remaining = remaining_to_allocate(diff, reasons)
        kind = "falta" if diff and diff < 0 else "sobra"

        if not diff and reasons:
            add(item, "MOTIVO_SEM_DIVERGENCIA", "Item sem divergência possui motivos lançados. Remova-os.")
        elif diff:
            invalid = [r for r in used if r not in allowed]
            if invalid:
                add(item, "MOTIVO_INVALIDO", f"Motivo(s) incompatível(is) com {kind}: {', '.join(invalid)}.")
            if remaining > 0:
                add(item, "MOTIVO_DISTRIBUICAO", f"Distribua {remaining:g} da {kind} entre os motivos.")
            elif remaining < 0:
                add(item, "MOTIVO_DISTRIBUICAO", f"Motivos somam {abs(remaining):g} a mais que a {kind}.")
        if used & BLOCKING_REASONS:
            add(item, "NF_ENTRADA_PENDENTE", "Lance a NF de entrada na Omie e recapture o saldo antes de aprovar.")
        if "NAO_IDENTIFICADA" in used and not (item.get("justification") or "").strip():
            add(item, "JUSTIFICATIVA_OBRIGATORIA", "Sobra não identificada exige justificativa.")

        case = item.get("case")
        if case in (CASE_B, CASE_D) and not (item.get("justification") or "").strip():
            add(item, "JUSTIFICATIVA_NEGATIVO", "Saldo negativo no sistema exige justificativa (ou lance a entrada pendente).")
        needs_ref = case in (CASE_B,) or (case == CASE_C and item.get("cmc_correction_approved"))
        if needs_ref and float(item.get("reference_cost") or 0.0) <= 0:
            add(item, "CUSTO_REFERENCIA", "Informe o custo de referência para o ajuste de saldo.")
    return issues


# ==============================================================================
# --- [BLOCO: Pares Falta x Sobra] ---
# ==============================================================================

def suggest_pairs(items: List[Dict[str, Any]], price_tolerance_pct: float = 20.0,
                  qty_tolerance_pct: float = 20.0) -> List[Dict[str, Any]]:
    """Sugere pares falta x sobra (troca de produto no PDV) dentro do inventário.

    Critérios: mesma unidade, custo unitário próximo e quantidades que se compensam.
    Cada item participa de no máximo um par; prioriza os pares de menor desvio.
    """
    faltas, sobras = [], []
    for item in items:
        diff = compute_difference(item.get("counted_qty"), item.get("system_qty"))
        if not diff:
            continue
        cost = unit_cost_for_valuation(item.get("cmc"), item.get("reference_cost"))
        entry = {"id": item.get("id"), "unit": (item.get("unit") or "").upper(), "qty": abs(diff), "cost": cost,
                 "product_name": item.get("product_name")}
        (faltas if diff < 0 else sobras).append(entry)

    candidates = []
    for f in faltas:
        for s in sobras:
            if f["unit"] != s["unit"] or f["cost"] <= 0 or s["cost"] <= 0:
                continue
            price_dev = abs(f["cost"] - s["cost"]) / max(f["cost"], s["cost"]) * 100.0
            qty_dev = abs(f["qty"] - s["qty"]) / max(f["qty"], s["qty"]) * 100.0
            if price_dev <= price_tolerance_pct and qty_dev <= qty_tolerance_pct:
                candidates.append((price_dev + qty_dev, f, s))

    candidates.sort(key=lambda c: c[0])
    used, pairs = set(), []
    for score, f, s in candidates:
        if f["id"] in used or s["id"] in used:
            continue
        used.update({f["id"], s["id"]})
        pairs.append({
            "falta_item_id": f["id"], "falta_product_name": f["product_name"], "falta_qty": f["qty"],
            "sobra_item_id": s["id"], "sobra_product_name": s["product_name"], "sobra_qty": s["qty"],
            "score": round(score, 2),
        })
    return pairs


# ==============================================================================
# --- [BLOCO: Resumo e Integridade] ---
# ==============================================================================

def summarize(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Totais do inventário: perdas/sobras por motivo, quebra técnica separada e resultado líquido (a custo)."""
    by_reason: Dict[str, Dict[str, float]] = {}
    perdas = sobras = quebra_tecnica = 0.0
    counted = 0
    for item in items:
        if item.get("has_entries") or item.get("confirmed_zero"):
            counted += 1
        diff = compute_difference(item.get("counted_qty"), item.get("system_qty"))
        if not diff:
            continue
        sign = -1.0 if diff < 0 else 1.0
        cost = unit_cost_for_valuation(item.get("cmc"), item.get("reference_cost"))
        parts = [(r.get("reason"), float(r.get("quantity") or 0.0)) for r in item.get("reasons") or []]
        remaining = remaining_to_allocate(diff, item.get("reasons"))
        if remaining > 0:
            parts.append(("SEM_MOTIVO", remaining))
        for reason, qty in parts:
            value = round_money(sign * qty * cost)
            bucket = by_reason.setdefault(reason, {"qty_items": 0, "quantity": 0.0, "value": 0.0})
            bucket["qty_items"] += 1
            bucket["quantity"] = round_qty(bucket["quantity"] + qty)
            bucket["value"] = round_money(bucket["value"] + value)
            if sign < 0:
                if reason == "QUEBRA_TECNICA":
                    quebra_tecnica += value
                else:
                    perdas += value
            else:
                sobras += value
    return {
        "total_items": len(items),
        "counted_items": counted,
        "perdas_value": round_money(perdas),
        "quebra_tecnica_value": round_money(quebra_tecnica),
        "sobras_value": round_money(sobras),
        "net_value": round_money(perdas + quebra_tecnica + sobras),
        "by_reason": by_reason,
    }


def aggregate_indicators(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Indicadores históricos por produto e família a partir de itens de inventários efetivados.

    Cada linha: product_id, product_name, family_name, unit, system_qty, counted_qty, cost, reasons.
    - quebra_pct: quebra técnica em relação ao saldo do sistema (base para markup).
    - divergencia_pct: soma das divergências absolutas em relação ao saldo do sistema.
    - recorrencia: em quantos inventários o produto divergiu.
    """
    products: Dict[Any, Dict[str, Any]] = {}
    families: Dict[str, Dict[str, Any]] = {}

    def bucket(store, key, **extra):
        if key not in store:
            store[key] = {**extra, "inventarios": 0, "divergentes": 0, "base_qty": 0.0, "abs_diff_qty": 0.0,
                          "quebra_qty": 0.0, "perdas_value": 0.0, "quebra_value": 0.0, "sobras_value": 0.0}
        return store[key]

    for row in rows:
        diff = compute_difference(row.get("counted_qty"), row.get("system_qty")) or 0.0
        cost = float(row.get("cost") or 0.0)
        base = max(float(row.get("system_qty") or 0.0), 0.0)
        quebra_qty = sum(float(r.get("quantity") or 0.0) for r in row.get("reasons") or []
                         if r.get("reason") == "QUEBRA_TECNICA") if diff < 0 else 0.0
        perdas_qty = abs(diff) - quebra_qty if diff < 0 else 0.0
        targets = [
            bucket(products, row.get("product_id"), product_id=row.get("product_id"), product_name=row.get("product_name"),
                   family_name=row.get("family_name"), unit=row.get("unit")),
            bucket(families, row.get("family_name") or "-", family_name=row.get("family_name")),
        ]
        for agg in targets:
            agg["inventarios"] += 1
            agg["divergentes"] += 1 if diff else 0
            agg["base_qty"] += base
            agg["abs_diff_qty"] += abs(diff)
            agg["quebra_qty"] += quebra_qty
            agg["perdas_value"] += -perdas_qty * cost
            agg["quebra_value"] += -quebra_qty * cost
            agg["sobras_value"] += diff * cost if diff > 0 else 0.0

    def finish(agg):
        base = agg["base_qty"]
        agg["quebra_pct"] = round(agg["quebra_qty"] / base * 100.0, 2) if base else None
        agg["divergencia_pct"] = round(agg["abs_diff_qty"] / base * 100.0, 2) if base else None
        for key in ("perdas_value", "quebra_value", "sobras_value"):
            agg[key] = round_money(agg[key])
        for key in ("base_qty", "abs_diff_qty", "quebra_qty"):
            agg[key] = round_qty(agg[key])
        agg["recorrencia_pct"] = round(agg["divergentes"] / agg["inventarios"] * 100.0, 1) if agg["inventarios"] else 0.0
        return agg

    by_loss = lambda a: a["perdas_value"] + a["quebra_value"]
    return {
        "produtos": sorted((finish(a) for a in products.values()), key=by_loss),
        "familias": sorted((finish(a) for a in families.values()), key=by_loss),
    }


def snapshot_hash(items: List[Dict[str, Any]]) -> str:
    """Hash SHA-256 do conteúdo aprovado, impresso no relatório para garantir integridade."""
    canonical = sorted(
        (
            {
                "product_id": i.get("product_id"),
                "system_qty": round_qty(i.get("system_qty")),
                "counted_qty": round_qty(i.get("counted_qty")),
                "cmc": round(float(i.get("cmc") or 0.0), 6),
                "reference_cost": round(float(i.get("reference_cost") or 0.0), 6),
                "reasons": sorted(
                    [[r.get("reason"), round_qty(r.get("quantity"))] for r in i.get("reasons") or []]
                ),
                "case": i.get("case"),
            }
            for i in items
        ),
        key=lambda x: x["product_id"] or 0,
    )
    payload = json.dumps(canonical, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def check_transition(action: str, current_status: str) -> str:
    """Valida a transição e retorna o status de destino."""
    if action not in TRANSITIONS:
        raise ValueError(f"Ação inválida: {action}")
    origins, target = TRANSITIONS[action]
    if current_status not in origins:
        raise ValueError(f"Não é possível '{action}' um inventário com status {current_status}.")
    return target
