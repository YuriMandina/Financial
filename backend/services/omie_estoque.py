"""
Cliente Omie do Módulo de Inventário.

Independente do rateio/custeio (services/omie_products.py). Comportamentos validados
em spike real (20/10/2026):
- SLD define o saldo absoluto e redefine o CMC para o valor informado (aceita quan=0).
- cod_int_ajuste repetido é rejeitado com erro 1035 contendo o ID existente (idempotência).
- ObterEstoqueProduto pode devolver saldo defasado: usar ListarPosEstoque para saldo/CMC
  e ObterEstoqueProduto apenas para o preço da última compra (nPrecoUltComp).
- A Omie bloqueia a mesma chamada repetida em menos de 60s ("Consumo redundante").
"""
import re
import time
from datetime import date
from typing import Any, Dict, Iterator, Optional

import requests

from core.deps import current_org

BASE_URL = "https://app.omie.com.br/api/v1/"
session = requests.Session()

# Campos de cadastro conferidos antes/depois do AlterarProduto (nada além da família pode mudar)
PROTECTED_PRODUCT_FIELDS = (
    "descricao", "unidade", "ncm", "ean", "cest", "cfop", "cst_icms", "csosn_icms", "cst_pis", "cst_cofins",
    "aliquota_icms", "red_base_icms", "valor_unitario", "inativo", "bloqueado", "origem_imposto", "codigo",
)


# ==============================================================================
# --- [BLOCO: Erros e Chamada Base] ---
# ==============================================================================

class OmieError(Exception):
    """Falha retornada pela Omie. retry_after > 0 indica bloqueio temporário (aguardar e repetir)."""

    def __init__(self, message: str, code: Optional[str] = None, retry_after: int = 0):
        super().__init__(message)
        self.message = message
        self.code = code
        self.retry_after = retry_after

    @property
    def retryable(self) -> bool:
        return self.retry_after > 0


def _retry_after(message: str) -> int:
    msg = message.lower()
    match = re.search(r"(?:aguarde|tente novamente em)\s+(\d+)\s+segundos", msg)
    if match:
        return int(match.group(1)) + 1
    if "redundant" in msg or "redundante" in msg:
        return 61
    if "bloquead" in msg:
        return 1800
    if "ainda não foi processado" in msg or "106" in msg:
        return 30
    return 0


def _date_br(value) -> str:
    if isinstance(value, date):
        return value.strftime("%d/%m/%Y")
    return str(value)


def _post(path: str, method: str, param: Dict[str, Any], timeout: int = 60) -> Dict[str, Any]:
    org = current_org.get()
    payload = {"call": method, "app_key": org.omie_app_key, "app_secret": org.omie_app_secret, "param": [param]}
    try:
        res = session.post(BASE_URL + path, json=payload, headers={"Content-Type": "application/json"}, timeout=timeout)
        data = res.json()
    except requests.RequestException as exc:
        raise OmieError(f"Falha de comunicação com a Omie: {exc}", retry_after=30)
    except ValueError:
        raise OmieError(f"Resposta inválida da Omie (HTTP {res.status_code}).", retry_after=30)

    if isinstance(data, dict) and "faultstring" in data:
        message = str(data["faultstring"])
        raise OmieError(message, code=str(data.get("faultcode") or ""), retry_after=_retry_after(message))
    if isinstance(data, dict) and data.get("status") == "error":
        raise OmieError(str(data.get("message")))
    return data


def call_with_retry(fn, *args, max_wait: int = 180, **kwargs):
    """Executa uma chamada aguardando bloqueios temporários curtos (consumo redundante etc.)."""
    waited = 0
    while True:
        try:
            return fn(*args, **kwargs)
        except OmieError as exc:
            if not exc.retryable or waited + exc.retry_after > max_wait:
                raise
            time.sleep(exc.retry_after)
            waited += exc.retry_after


# ==============================================================================
# --- [BLOCO: Posição de Estoque e Custos] ---
# ==============================================================================

def listar_posicoes(data_posicao, local_code: Optional[int] = None, page_pause: float = 0.5) -> Dict[int, Dict[str, float]]:
    """Saldo e CMC de todos os produtos (inclusive zerados) na data. Chave: código do produto na Omie."""
    result: Dict[int, Dict[str, float]] = {}
    page, total_pages = 1, 1
    while page <= total_pages:
        param = {"nPagina": page, "nRegPorPagina": 500, "dDataPosicao": _date_br(data_posicao), "cExibeTodos": "S"}
        if local_code:
            param["codigo_local_estoque"] = local_code
        data = call_with_retry(_post, "estoque/consulta/", "ListarPosEstoque", param)
        total_pages = int(data.get("nTotPaginas") or 1)
        for prod in data.get("produtos") or []:
            saldo = float(prod.get("nSaldo") or 0.0)
            cmc = float(prod.get("nCMC") or 0.0)
            result[int(prod["nCodProd"])] = {"saldo": saldo, "cmc": cmc, "valor": saldo * cmc}
        page += 1
        if page <= total_pages:
            time.sleep(page_pause)
    return result


def obter_ultimo_custo(omie_id: int, data_posicao, local_code: Optional[int] = None) -> Optional[float]:
    """Preço unitário da última compra (nPrecoUltComp) no local de estoque."""
    data = call_with_retry(_post, "estoque/resumo/", "ObterEstoqueProduto",
                           {"nIdProduto": omie_id, "dDia": _date_br(data_posicao)})
    locais = data.get("listaEstoque") or []
    if local_code:
        locais = [l for l in locais if int(l.get("nIdlocal") or 0) == int(local_code)] or locais
    if not locais:
        return None
    value = locais[0].get("nPrecoUltComp")
    return float(value) if value not in (None, "") and float(value) > 0 else None


# ==============================================================================
# --- [BLOCO: Ajustes de Estoque] ---
# ==============================================================================

_DUPLICATE_RE = re.compile(r"com o ID \[(\d+)\]")


def incluir_ajuste(omie_id: int, data_ajuste, tipo: str, motivo: str, quantidade: float, valor: float,
                   cod_int_ajuste: str, obs: str, local_code: Optional[int] = None) -> int:
    """Inclui o ajuste e retorna o id_ajuste. Reenvio com o mesmo cod_int_ajuste devolve o ID já existente."""
    param = {
        "id_prod": omie_id,
        "data": _date_br(data_ajuste),
        "quan": quantidade,
        "valor": valor,
        "tipo": tipo,
        "motivo": motivo,
        "origem": "AJU",
        "obs": obs,
        "cod_int_ajuste": cod_int_ajuste,
    }
    if local_code:
        param["codigo_local_estoque"] = local_code
    try:
        data = _post("estoque/ajuste/", "IncluirAjusteEstoque", param)
    except OmieError as exc:
        match = _DUPLICATE_RE.search(exc.message)
        if match and ("1035" in (exc.code or "") or "integra" in exc.message.lower()):
            return int(match.group(1))
        raise
    if not data.get("id_ajuste"):
        raise OmieError(f"Omie não retornou o ID do ajuste: {data}")
    return int(data["id_ajuste"])


def excluir_ajuste(id_ajuste: int) -> bool:
    """Exclui o ajuste. Ajuste já inexistente (erro 105) é considerado sucesso."""
    try:
        _post("estoque/ajuste/", "ExcluirAjusteEstoque", {"id_ajuste": id_ajuste})
        return True
    except OmieError as exc:
        msg = exc.message.lower()
        if "105" in msg or "não foi localizado" in msg or "nao foi localizado" in msg:
            return True
        raise


# ==============================================================================
# --- [BLOCO: Catálogo de Produtos] ---
# ==============================================================================

def listar_produtos(page_pause: float = 0.5) -> Iterator[Dict[str, Any]]:
    """Itera todos os produtos do cadastro (inclusive sem família)."""
    page, total_pages = 1, 1
    while page <= total_pages:
        data = call_with_retry(_post, "geral/produtos/", "ListarProdutos", {
            "pagina": page, "registros_por_pagina": 500,
            "apenas_importado_api": "N", "filtrar_apenas_omiepdv": "N",
        })
        total_pages = int(data.get("total_de_paginas") or 1)
        for prod in data.get("produto_servico_cadastro") or []:
            yield prod
        page += 1
        if page <= total_pages:
            time.sleep(page_pause)


def consultar_produto(omie_id: int) -> Dict[str, Any]:
    return call_with_retry(_post, "geral/produtos/", "ConsultarProduto", {"codigo_produto": omie_id})


def alterar_familia_produto(omie_id: int, codigo_familia: int) -> Dict[str, Any]:
    """Atribui a família ao produto e confere que nenhum outro campo do cadastro foi alterado.

    Se a Omie alterar qualquer campo protegido, restaura o cadastro original e levanta OmieError.
    """
    before = consultar_produto(omie_id)
    _post("geral/produtos/", "AlterarProduto", {"codigo_produto": omie_id, "codigo_familia": codigo_familia})
    time.sleep(1)
    after = call_with_retry(consultar_produto, omie_id)

    changed = [f for f in PROTECTED_PRODUCT_FIELDS if str(before.get(f)) != str(after.get(f))]
    if changed:
        restore = {f: before.get(f) for f in changed if before.get(f) is not None}
        restore["codigo_produto"] = omie_id
        try:
            _post("geral/produtos/", "AlterarProduto", restore)
            status = "Cadastro restaurado"
        except OmieError as exc:
            status = f"FALHA ao restaurar ({exc.message}) - confira o cadastro na Omie"
        raise OmieError(f"A Omie alterou campos além da família ({', '.join(changed)}). "
                        f"{status}; atribua a família manualmente na Omie.")
    if int(after.get("codigo_familia") or 0) != int(codigo_familia):
        raise OmieError("A Omie não aplicou a família ao produto.")
    return after
