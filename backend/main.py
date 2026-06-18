import os
import time  # Para controlar o rate limit
import requests
import traceback
import pandas as pd
from datetime import datetime, timedelta  # Para controlar o tempo do cache
from dotenv import load_dotenv
import contextvars
from fastapi import Depends, HTTPException
import auth
from api_auth import router as auth_router
from api_invites import router as invites_router
from api_settings import router as settings_router
import models
import concurrent.futures

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# --- SETUP DA APLICAÇÃO ---
load_dotenv()

app = FastAPI(title="API GabaritoBI", version="5.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from database import SessionLocal
from models import SyncSnapshot

app.include_router(auth_router)
app.include_router(invites_router)
app.include_router(settings_router)

current_org = contextvars.ContextVar("current_org")

async def get_current_user_and_set_org(user: models.User = Depends(auth.get_current_user)):
    if not user.organization:
        raise HTTPException(status_code=400, detail="User has no organization")
    current_org.set(user.organization)
    return user



def obter_global_db(cache_key, tipo_relatorio, fetch_fn, *args, data_ref="Global", force_sync=False, return_metadata=False, **kwargs):
    db = SessionLocal()
    try:
        snap = db.query(SyncSnapshot).filter(SyncSnapshot.cache_key == cache_key, SyncSnapshot.organization_id == current_org.get().id).first()
        
        if snap and not force_sync:
            return (snap.dados, snap.created_at) if return_metadata else snap.dados
            
        if snap and force_sync:
            db.delete(snap)
            db.commit()
            
        dados = fetch_fn(*args, **kwargs)
        if dados is not None:
            novo_snap = SyncSnapshot(
                cache_key=cache_key,
                tipo_relatorio=tipo_relatorio,
                data_referencia=data_ref,
                dados=dados,
                organization_id=current_org.get().id
            )
            db.add(novo_snap)
            db.commit()
            db.refresh(novo_snap)
            return (dados, novo_snap.created_at) if return_metadata else dados
        return (None, None) if return_metadata else None
    finally:
        db.close()

def obter_fatiado_db(data_inicio, data_fim, tipo_relatorio, cache_key_prefix, fetch_fn, extract_date_fn):
    db = SessionLocal()
    try:
        dt_inicio = pd.to_datetime(data_inicio)
        dt_fim = pd.to_datetime(data_fim)
        todas_datas = pd.date_range(dt_inicio, dt_fim)
        datas_str = [d.strftime("%Y-%m-%d") for d in todas_datas]
        
        chaves_buscadas = [f"{cache_key_prefix}_{d}" for d in datas_str]
        
        salvos = db.query(SyncSnapshot).filter(
            SyncSnapshot.tipo_relatorio == tipo_relatorio,
            SyncSnapshot.cache_key.in_(chaves_buscadas)
        ).all()
        
        datas_salvas = {snap.data_referencia: snap.dados for snap in salvos}
        datas_faltantes = [d for d in todas_datas if d.strftime("%Y-%m-%d") not in datas_salvas]
        
        todos_dados = []
        for d in datas_salvas.values():
            todos_dados.extend(d)
            
        if datas_faltantes:
            min_f = min(datas_faltantes)
            max_f = max(datas_faltantes)
            
            novos_dados = fetch_fn(min_f.strftime("%Y-%m-%d"), max_f.strftime("%Y-%m-%d"))
            
            dados_por_dia = {d.strftime("%Y-%m-%d"): [] for d in datas_faltantes}
            
            for item in novos_dados:
                item_date = extract_date_fn(item)
                if item_date in dados_por_dia:
                    dados_por_dia[item_date].append(item)
                    
            for dia_str, itens in dados_por_dia.items():
                cache_key = f"{cache_key_prefix}_{dia_str}"
                snap = SyncSnapshot(
                    cache_key=cache_key,
                    tipo_relatorio=tipo_relatorio,
                    data_referencia=dia_str,
                    dados=itens,
                    organization_id=current_org.get().id
                )
                db.add(snap)
                todos_dados.extend(itens)
                
            db.commit()
            
        return todos_dados
    finally:
        db.close()


# --- MODELOS DE DADOS PARA AÇÃO ---
class PagamentoItem(BaseModel):
    codigo_lancamento: int
    valor: float
    desconto: float = 0.0
    juros: float = 0.0


class BaixaLoteRequest(BaseModel):
    id_conta_corrente: int
    data_pagamento: str
    pagamentos: list[PagamentoItem]


# --- FUNÇÕES DE UTILIDADE ---
def tratar_vazio(valor):
    if pd.isna(valor) or str(valor).strip().lower() in ["", "nan", "none", "nat"]:
        return "-"
    return str(valor)


# BLINDAGEM MATEMÁTICA: Converte com segurança qualquer formato que a API devolver
def safe_float(valor):
    try:
        if valor is None or str(valor).strip() == "":
            return 0.0
        return float(valor)
    except (ValueError, TypeError):
        return 0.0


# --- FUNÇÕES DE EXTRAÇÃO DA API OMIE ---
def _omie_extrair_contas_pagar_abertas(min_f_str=None, max_f_str=None):
    # A Omie não tem filtro fácil de data para contas em aberto, então puxamos tudo
    url = "https://app.omie.com.br/api/v1/financas/contapagar/"
    pagina_atual, total_paginas = 1, 1
    todas_contas = []

    while pagina_atual <= total_paginas:
        payload = {
            "call": "ListarContasPagar",
            "app_key": current_org.get().omie_app_key,
            "app_secret": current_org.get().omie_app_secret,
            "param": [
                {
                    "pagina": pagina_atual,
                    "registros_por_pagina": 100,
                    "filtrar_apenas_titulos_em_aberto": "S",
                }
            ],
        }
        try:
            res = requests.post(
                url,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=15,
            ).json()
            if "faultstring" in res:
                break
            total_paginas = res.get("total_de_paginas", 1)
            todas_contas.extend(res.get("conta_pagar_cadastro", []))
        except:
            break

        pagina_atual += 1
        time.sleep(0.3)

    return todas_contas

def extrair_contas_pagar_abertas(data_inicio: str, data_fim: str):
    def extract_date(item):
        d = item.get("data_previsao")
        if not d: return "1970-01-01"
        try:
            return pd.to_datetime(d, format="%d/%m/%Y").strftime("%Y-%m-%d")
        except:
            return "1970-01-01"
            
    return obter_fatiado_db(
        data_inicio,
        data_fim,
        "Contas a Pagar (Abertas)",
        "contas_pagar_abertas",
        _omie_extrair_contas_pagar_abertas,
        extract_date
    )


def _omie_extrair_contas_receber_abertas(min_f_str=None, max_f_str=None):
    import time
    import random

    url = "https://app.omie.com.br/api/v1/financas/contareceber/"
    app_key = current_org.get().omie_app_key
    app_secret = current_org.get().omie_app_secret

    def realizar_requisicao_com_retry(payload, max_retries=5):
        for attempt in range(max_retries):
            try:
                res = requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=30)
                
                # Trata bloqueio severo da Omie (MISUSE_API_PROCESS)
                if res.status_code == 425 and "MISUSE_API_PROCESS" in res.text:
                    print(f"[Omie] HTTP 425 MISUSE_API_PROCESS recebido. Aguardando 305 segundos (5 min)...")
                    if attempt < max_retries - 1:
                        time.sleep(305)
                        continue
                    else:
                        raise Exception("Falha após máximo de tentativas: Bloqueio 425 MISUSE_API_PROCESS persistente.")
                
                # Trata Rate Limit (429) ou instabilidades do lado do servidor (5xx)
                if res.status_code == 429 or res.status_code >= 500:
                    sleep_time = (2 ** attempt) + random.uniform(0, 1)
                    print(f"[Omie] Rate Limit/Erro {res.status_code}. Tentativa {attempt+1}/{max_retries}. Esperando {sleep_time:.2f}s...")
                    if attempt < max_retries - 1:
                        time.sleep(sleep_time)
                        continue
                    else:
                        raise Exception(f"Falha após {max_retries} tentativas. Status code: {res.status_code}.")
                
                # Qualquer outro erro cliente (4xx) que não seja Rate Limit/425 não deve ter retry cego
                if res.status_code != 200:
                    raise Exception(f"Erro HTTP {res.status_code} na Omie: {res.text}")
                
                json_data = res.json()
                if "faultstring" in json_data:
                    raise Exception(f"Erro da API Omie: {json_data['faultstring']}")
                    
                return json_data
                
            except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
                sleep_time = (2 ** attempt) + random.uniform(0, 1)
                print(f"[Omie] Timeout/Falha de Conexão. Tentativa {attempt+1}/{max_retries}. Esperando {sleep_time:.2f}s...")
                if attempt < max_retries - 1:
                    time.sleep(sleep_time)
                    continue
                else:
                    raise Exception(f"Falha de conexão persistente na Omie: {str(e)}")
                    
        raise Exception("Falha na requisição à Omie após máximo de tentativas permitidas.")

    # Primeira página
    payload_inicial = {
        "call": "ListarContasReceber",
        "app_key": app_key,
        "app_secret": app_secret,
        "param": [{"pagina": 1, "registros_por_pagina": 100, "filtrar_apenas_titulos_em_aberto": "S"}],
    }
    
    # Lançará Exception (abortando a sincronização) caso falhe após todos os retries
    data = realizar_requisicao_com_retry(payload_inicial)

    total_paginas = data.get("total_de_paginas", 1)
    todas_contas = list(data.get("conta_receber_cadastro", []))

    if total_paginas <= 1:
        return todas_contas

    # Loop Sequencial Padrão para não engatilhar bloqueios (Max 3 req/seg da Omie)
    for pagina in range(2, total_paginas + 1):
        page_payload = {
            "call": "ListarContasReceber",
            "app_key": app_key,
            "app_secret": app_secret,
            "param": [{"pagina": pagina, "registros_por_pagina": 100, "filtrar_apenas_titulos_em_aberto": "S"}],
        }
        
        json_data = realizar_requisicao_com_retry(page_payload)
        todas_contas.extend(json_data.get("conta_receber_cadastro", []))
        
        # Delay fixo
        time.sleep(0.35)

    return todas_contas


def extrair_contas_receber_abertas(force_sync=False, return_metadata=False):
    return obter_global_db(
        "contas_receber_abertas_global",
        "Contas a Receber (Abertas)",
        _omie_extrair_contas_receber_abertas,
        force_sync=force_sync,
        return_metadata=return_metadata
    )


def _omie_extrair_dicionario_fornecedores():
    url = "https://app.omie.com.br/api/v1/geral/clientes/"
    pagina_atual, total_paginas = 1, 1
    dicionario = {}
    while pagina_atual <= total_paginas:
        payload = {
            "call": "ListarClientes",
            "app_key": current_org.get().omie_app_key,
            "app_secret": current_org.get().omie_app_secret,
            "param": [{"pagina": pagina_atual, "registros_por_pagina": 100}],
        }
        try:
            res = requests.post(
                url,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=15,
            ).json()
            total_paginas = res.get("total_de_paginas", 1)
            for cli in res.get("clientes_cadastro", []):
                dicionario[cli["codigo_cliente_omie"]] = cli.get(
                    "nome_fantasia", cli.get("razao_social", "")
                )
        except:
            break
        pagina_atual += 1
        time.sleep(0.3)

    return dicionario

def extrair_dicionario_fornecedores():
    return obter_global_db(
        "dicionario_fornecedores",
        "Dicionário Fornecedores",
        _omie_extrair_dicionario_fornecedores
    )


def _omie_extrair_dicionario_categorias():
    url = "https://app.omie.com.br/api/v1/geral/categorias/"
    pagina_atual, total_paginas = 1, 1
    dicionario = {}
    while pagina_atual <= total_paginas:
        payload = {
            "call": "ListarCategorias",
            "app_key": current_org.get().omie_app_key,
            "app_secret": current_org.get().omie_app_secret,
            "param": [{"pagina": pagina_atual, "registros_por_pagina": 100}],
        }
        try:
            res = requests.post(
                url,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=15,
            ).json()
            total_paginas = res.get("total_de_paginas", 1)
            for cat in res.get("categoria_cadastro", []):
                dicionario[cat["codigo"]] = cat["descricao"]
        except:
            break
        pagina_atual += 1
        time.sleep(0.3)

    return dicionario

def extrair_dicionario_categorias():
    return obter_global_db(
        "dicionario_categorias",
        "Dicionário Categorias",
        _omie_extrair_dicionario_categorias
    )


def _omie_extrair_dicionario_contas_correntes():
    url = "https://app.omie.com.br/api/v1/geral/contacorrente/"
    pagina_atual, total_paginas = 1, 1
    dicionario = {}
    while pagina_atual <= total_paginas:
        payload = {
            "call": "ListarContasCorrentes",
            "app_key": current_org.get().omie_app_key,
            "app_secret": current_org.get().omie_app_secret,
            "param": [{"pagina": pagina_atual, "registros_por_pagina": 100}],
        }
        try:
            res = requests.post(
                url,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=15,
            ).json()
            total_paginas = res.get("total_de_paginas", 1)
            lista_contas = res.get("ListarContasCorrentes", [])
            for cc in lista_contas:
                id_cc = str(cc.get("nCodCC", ""))
                dicionario[id_cc] = cc.get("descricao", f"Conta {id_cc}")
        except:
            break
        pagina_atual += 1
        time.sleep(0.3)

    return dicionario

def extrair_dicionario_contas_correntes():
    return obter_global_db(
        "dicionario_contas_correntes",
        "Dicionário Contas Correntes",
        _omie_extrair_dicionario_contas_correntes
    )


def _omie_extrair_movimentos_pagos_periodo(data_inicio: str, data_fim: str):
    url = "https://app.omie.com.br/api/v1/financas/mf/"
    dt_inicio_omie = pd.to_datetime(data_inicio).strftime("%d/%m/%Y")
    dt_fim_omie = pd.to_datetime(data_fim).strftime("%d/%m/%Y")
    pagina_atual, total_paginas = 1, 1
    todos_movimentos = []

    while pagina_atual <= total_paginas:
        payload = {
            "call": "ListarMovimentos",
            "app_key": current_org.get().omie_app_key,
            "app_secret": current_org.get().omie_app_secret,
            "param": [
                {
                    "nPagina": pagina_atual,
                    "nRegPorPagina": 100,
                    "dDtPagtoDe": dt_inicio_omie,
                    "dDtPagtoAte": dt_fim_omie,
                    "cTpLancamento": "CP",
                }
            ],
        }
        try:
            res = requests.post(
                url,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=15,
            ).json()
            if "faultstring" in res:
                break
            total_paginas = res.get("nTotPaginas", 1)
            todos_movimentos.extend(res.get("movimentos", []))
        except:
            break

        pagina_atual += 1
        time.sleep(0.3)

    return todos_movimentos

def extrair_movimentos_pagos_periodo(data_inicio: str, data_fim: str):
    return obter_fatiado_db(
        data_inicio,
        data_fim,
        "Contas Pagas",
        "mov_pagos",
        _omie_extrair_movimentos_pagos_periodo,
        lambda mov: pd.to_datetime(mov.get("detalhes", {}).get("dDtPagamento", "01/01/1900"), format="%d/%m/%Y", errors="coerce").strftime("%Y-%m-%d")
    )


def extrair_movimento_vendas(data_inicio: str, data_fim: str):
    """
    Extrai os itens de vendas do PDV (NFC-e / Cupom Fiscal) do Omie para o período.

    Endpoint oficial: /api/v1/produtos/cupomfiscalconsultar/
    Call: CuponsFiscais
    Filtros:
      - dDtEmissaoDe / dDtEmissaoAte → data de emissão no formato DD/MM/YYYY

    Estrutura de resposta:
      cupons[] → cada cupom contém:
        cabecalhoCupom:
          cModeloCupom  → "65" = NFC-e, "59" = CFe-SAT, "00" = ECF
          nValorCupom   → valor total do cupom
          dDtEmissaoCupom
          info.cCupomCancelado  → "S" = cancelado (ignorar)
        itensCupom[] → itens do cupom:
          xProd          → descrição do produto
          nQuant         → quantidade
          vItem          → valor líquido do item (já descontado/acrescido)
          vDesc          → valor do desconto concedido no item (campo NFC-e)
          nCMCTotal      → custo da mercadoria (campo Omie interno)
          cItemCancelado → "S" = item cancelado (ignorar)
          cItemDevolvido → "S" = devolvido (ignorar)
    """
def _omie_extrair_movimento_vendas(data_inicio: str, data_fim: str):
    url = "https://app.omie.com.br/api/v1/produtos/cupomfiscalconsultar/"
    dt_inicio_omie = pd.to_datetime(data_inicio).strftime("%d/%m/%Y")
    dt_fim_omie = pd.to_datetime(data_fim).strftime("%d/%m/%Y")

    pagina_atual, total_paginas = 1, 1
    todos_itens = []

    while pagina_atual <= total_paginas:
        payload = {
            "call": "CuponsFiscais",
            "app_key": current_org.get().omie_app_key,
            "app_secret": current_org.get().omie_app_secret,
            "param": [
                {
                    "nPagina": pagina_atual,
                    "nRegPorPagina": 50,
                    "dDtEmissaoDe": dt_inicio_omie,
                    "dDtEmissaoAte": dt_fim_omie,
                }
            ],
        }
        try:
            res = requests.post(
                url,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=30,
            ).json()

            if "faultstring" in res:
                print(f"[OMIE ERRO] CuponsFiscais: {res['faultstring']}")
                break

            total_paginas = res.get("nTotPaginas", 1)

            for cupom in res.get("cupons", []):
                cab = cupom.get("cabecalhoCupom", {})
                info_cupom = cupom.get("info", {})

                if str(info_cupom.get("cCupomCancelado", "N")).upper() == "S":
                    continue
                if str(info_cupom.get("cCupomDevolvido", "N")).upper() == "S":
                    continue
                    
                data_emissao = str(cab.get("dDtEmissao", cab.get("dDtEmissaoCupom", ""))).strip()

                for item in cupom.get("itensCupom", []):
                    if str(item.get("cItemCancelado", "N")).upper() == "S":
                        continue
                    if str(item.get("cItemDevolvido", "N")).upper() == "S":
                        continue

                    descricao    = str(item.get("xProd", "Produto sem descrição")).strip()
                    quantidade   = safe_float(item.get("nQuant", 0))
                    valor_item   = safe_float(item.get("vItem", 0))
                    desconto_item = safe_float(item.get("vDesc", 0))
                    cmc_total    = safe_float(item.get("nCMCTotal", 0))

                    if quantidade == 0 and valor_item == 0:
                        continue

                    todos_itens.append(
                        {
                            "data_emissao":        data_emissao,
                            "descricao_produto":   descricao,
                            "quantidade":          quantidade,
                            "total_nf":            valor_item,
                            "descontos_item":      desconto_item,
                            "cmc_total_movimento": cmc_total,
                        }
                    )

        except Exception:
            traceback.print_exc()
            break

        pagina_atual += 1
        time.sleep(0.3)

    return todos_itens

def extrair_movimento_vendas(data_inicio: str, data_fim: str):
    return obter_fatiado_db(
        data_inicio,
        data_fim,
        "Vendas PDV",
        "movimento_vendas_pdv",
        _omie_extrair_movimento_vendas,
        lambda item: pd.to_datetime(item.get("data_emissao", "01/01/1900"), format="%d/%m/%Y", errors="coerce").strftime("%Y-%m-%d")
    )


def extrair_dicionario_cmc_e_familia_produtos(data_fim: str):
    """
    Busca o CMC (Custo Médio Contábil) via ListarPosEstoque.
    Busca a Família via ListarProdutos (cadastro de produtos).
    Retorna uma tupla:
      dict_cmc    = { descricao_normalizada_upper: cmc_unitario }
      dict_familia = { descricao_normalizada_upper: nome_familia }
    """
def _omie_extrair_dicionario_cmc_e_familia_produtos(data_fim: str):
    url_estoque = "https://app.omie.com.br/api/v1/estoque/consulta/"
    dt_posicao = pd.to_datetime(data_fim).strftime("%d/%m/%Y")

    pagina_atual, total_paginas = 1, 1
    dict_cmc    = {}
    dict_familia_estoque = {}

    while pagina_atual <= total_paginas:
        payload = {
            "call": "ListarPosEstoque",
            "app_key": current_org.get().omie_app_key,
            "app_secret": current_org.get().omie_app_secret,
            "param": [
                {
                    "nPagina": pagina_atual,
                    "nRegPorPagina": 100,
                    "dDataPosicao": dt_posicao,
                    "cExibeTodos": "S",
                }
            ],
        }
        try:
            res = requests.post(
                url_estoque,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=30,
            ).json()

            if "faultstring" in res:
                print(f"[OMIE ERRO] ListarPosEstoque: {res['faultstring']}")
                break

            total_paginas = res.get("nTotPaginas", 1)

            for prod in res.get("produtos", []):
                descricao = str(prod.get("cDescricao", "")).strip()
                if not descricao:
                    continue

                chave = descricao.upper()
                cmc = safe_float(prod.get("nCMC", 0))

                if chave not in dict_cmc or cmc > 0:
                    dict_cmc[chave] = cmc

                familia = (
                    str(prod.get("cDescricaoFamilia", "") or "").strip()
                    or str(prod.get("xFamilia", "") or "").strip()
                    or str(prod.get("cFamilia", "") or "").strip()
                )
                if familia and chave not in dict_familia_estoque:
                    dict_familia_estoque[chave] = familia

        except Exception:
            traceback.print_exc()
            break

        pagina_atual += 1
        time.sleep(0.3)

    dict_familia_cadastro = extrair_familias_do_cadastro_produtos()
    dict_familia = {**dict_familia_estoque, **dict_familia_cadastro}
    
    # SQLAlchemy JSONB não aceita tuplas como root, vamos converter para dict
    return {"cmc": dict_cmc, "familia": dict_familia}

def extrair_dicionario_cmc_e_familia_produtos(data_fim: str):
    cache_key = f"cmc_familia_produtos_{data_fim}"
    resultado = obter_global_db(
        cache_key,
        "Dicionário CMC (Estoque)",
        _omie_extrair_dicionario_cmc_e_familia_produtos,
        data_fim,
        data_ref=data_fim
    )
    # Reverter para formato de tupla original (dit_cmc, dict_familia)
    return (resultado["cmc"], resultado["familia"])


def _omie_extrair_familias_do_cadastro_produtos():
    url = "https://app.omie.com.br/api/v1/geral/produtos/"
    pagina_atual, total_paginas = 1, 1
    dict_familia = {}

    while pagina_atual <= total_paginas:
        payload = {
            "call": "ListarProdutos",
            "app_key": current_org.get().omie_app_key,
            "app_secret": current_org.get().omie_app_secret,
            "param": [
                {
                    "pagina": pagina_atual,
                    "registros_por_pagina": 500,
                    "apenas_importado_api": "N",
                    "filtrar_apenas_omiepdv": "N",
                }
            ],
        }
        try:
            res = requests.post(
                url,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=30,
            ).json()

            if "faultstring" in res:
                print(f"[OMIE ERRO] ListarProdutos: {res['faultstring']}")
                break

            total_paginas = res.get("total_de_paginas", 1)

            for prod in res.get("produto_servico_cadastro", []):
                descricao = (
                    str(prod.get("descricao", "") or "").strip()
                    or str(prod.get("descricao_complementar", "") or "").strip()
                )
                if not descricao:
                    continue

                chave = descricao.upper()

                familia = (
                    str(prod.get("descricao_familia", "") or "").strip()
                    or str(prod.get("familia_produto", "") or "").strip()
                    or str(prod.get("cDescricaoFamilia", "") or "").strip()
                )

                if familia:
                    dict_familia[chave] = familia

        except Exception:
            traceback.print_exc()
            break

        pagina_atual += 1
        time.sleep(0.3)

    print(f"[OMIE] Famílias do cadastro: {len(dict_familia)} produtos com família mapeada")
    return dict_familia

def extrair_familias_do_cadastro_produtos():
    return obter_global_db(
        "familias_cadastro_produtos",
        "Famílias de Produtos",
        _omie_extrair_familias_do_cadastro_produtos
    )


# --- ENDPOINTS ---

@app.get("/api/snapshots")
def listar_snapshots(current_user: models.User = Depends(get_current_user_and_set_org)):
    db = SessionLocal()
    try:
        snaps = db.query(SyncSnapshot.id, SyncSnapshot.cache_key, SyncSnapshot.tipo_relatorio, SyncSnapshot.data_referencia, SyncSnapshot.created_at).all()
        lista = []
        for s in snaps:
            lista.append({
                "id": s.id,
                "cache_key": s.cache_key,
                "tipo_relatorio": s.tipo_relatorio,
                "data_referencia": s.data_referencia,
                "created_at": s.created_at.strftime("%d/%m/%Y %H:%M:%S")
            })
        return lista
    finally:
        db.close()

@app.delete("/api/snapshots/{snap_id}")
def deletar_snapshot(snap_id: int, current_user: models.User = Depends(get_current_user_and_set_org)):
    current_org.set(current_user.organization)
    db = SessionLocal()
    try:
        snap = db.query(SyncSnapshot).filter(SyncSnapshot.id == snap_id).first()
        if snap:
            db.delete(snap)
            db.commit()
            return {"status": "ok", "mensagem": "Snapshot removido com sucesso"}
        return JSONResponse(status_code=404, content={"detail": "Snapshot não encontrado"})
    finally:
        db.close()

@app.get("/api/geral/bancos")
def obter_bancos(current_user: models.User = Depends(get_current_user_and_set_org)):
    current_org.set(current_user.organization)
    dict_contas = extrair_dicionario_contas_correntes()
    bancos = [{"id": k, "nome": v} for k, v in dict_contas.items()]
    return sorted(bancos, key=lambda x: x["nome"])


@app.get("/api/debug/campos-produto")
def debug_campos_produto(current_user: models.User = Depends(get_current_user_and_set_org)):
    current_org.set(current_user.organization)
    """
    Endpoint de diagnóstico: retorna os primeiros 3 produtos do cadastro Omie
    com TODOS os campos da API, para identificar o campo correto de família.
    """
    url = "https://app.omie.com.br/api/v1/geral/produtos/"
    payload = {
        "call": "ListarProdutos",
        "app_key": current_org.get().omie_app_key,
        "app_secret": current_org.get().omie_app_secret,
        "param": [{"pagina": 1, "registros_por_pagina": 3, "apenas_importado_api": "N", "filtrar_apenas_omiepdv": "N"}],
    }
    try:
        res = requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=30).json()
        produtos = res.get("produto_servico_cadastro", [])
        return {"total_paginas": res.get("total_de_paginas"), "amostra": produtos[:3]}
    except Exception as e:
        return {"erro": str(e)}


@app.get("/api/relatorios/curva-abc/dados")
def obter_curva_abc(data_inicio: str, data_fim: str, current_user: models.User = Depends(get_current_user_and_set_org)):
    current_org.set(current_user.organization)
    """
    Retorna a Curva ABC de lucratividade agrupada por produto para o período.

    Fórmulas aplicadas (com tratamento de divisão por zero e NaN):
      - CMV UNIT.          = CMC unitário do produto (via ListarPosEstoque na data_fim)
      - CMV TOTAL          = Σ(quantidade) * CMV UNIT.
      - Descontos          = Σ(nCMCTotal dos itens do cupom) — custo registrado na venda
      - Média Valor Venda  = Σ(total_nf) / Σ(quantidade)
      - Lucro Bruto        = Σ(total_nf) - CMV TOTAL
      - Margem Bruta (%)   = Lucro Bruto / Σ(total_nf) * 100
      - % Participação     = Σ(total_nf) do item / Σ(total_nf) global * 100
    """
    try:
        itens_brutos = extrair_movimento_vendas(data_inicio, data_fim)

        if not itens_brutos:
            return JSONResponse(
                content={
                    "resumo": {
                        "receita_total": 0.0,
                        "lucro_bruto_total": 0.0,
                        "margem_media_perc": 0.0,
                    },
                    "itens": [],
                }
            )

        # ------------------------------------------------------------------
        # 1. Busca o dicionário de CMC e Família dos produtos via estoque
        # ------------------------------------------------------------------
        dict_cmc, dict_familia = extrair_dicionario_cmc_e_familia_produtos(data_fim)

        # ------------------------------------------------------------------
        # 2. Carrega no Pandas e garante tipos numéricos
        # ------------------------------------------------------------------
        df = pd.DataFrame(itens_brutos)

        for col in ["quantidade", "total_nf", "descontos_item", "cmc_total_movimento"]:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)

        # ------------------------------------------------------------------
        # 3. Agrupa por produto
        # ------------------------------------------------------------------
        grp = (
            df.groupby("descricao_produto", as_index=False)
            .agg(
                qtd_total=("quantidade", "sum"),
                receita_total_item=("total_nf", "sum"),
                descontos_sum=("descontos_item", "sum"),    # vDesc da NFC-e → Descontos
            )
        )

        # Lookup de família via dicionário do estoque (by nome do produto, case-insensitive)
        grp["familia_produto"] = grp["descricao_produto"].apply(
            lambda desc: dict_familia.get(str(desc).strip().upper(), "Sem Família")
        )

        # ------------------------------------------------------------------
        # 4. Total geral da receita (para % Participação)
        # ------------------------------------------------------------------
        receita_global = grp["receita_total_item"].sum()

        # ------------------------------------------------------------------
        # 5. Aplica as fórmulas com proteção contra divisão por zero / NaN
        # ------------------------------------------------------------------

        # CMV UNIT. = CMC do produto cadastrado (via estoque na data_fim)
        # Lookup case-insensitive pelo nome do produto
        grp["cmv_medio"] = grp["descricao_produto"].apply(
            lambda desc: dict_cmc.get(str(desc).strip().upper(), 0.0)
        ).fillna(0.0)

        # CMV TOTAL = Quantidade * CMV UNIT.
        grp["cmv_total"] = (grp["qtd_total"] * grp["cmv_medio"]).fillna(0.0)

        # Média do Valor de Venda = Σ(Total NF) / Σ(Quantidade)
        grp["media_valor_venda"] = grp.apply(
            lambda r: (r["receita_total_item"] / r["qtd_total"])
            if r["qtd_total"] != 0
            else 0.0,
            axis=1,
        ).fillna(0.0)

        # Lucro Bruto = Σ(Total NF) - CMV TOTAL (baseado no CMC dos produtos)
        grp["lucro_bruto"] = (
            grp["receita_total_item"] - grp["cmv_total"]
        ).fillna(0.0)

        # Margem Bruta (%) = Lucro Bruto / Σ(Total NF) * 100
        grp["margem_bruta_perc"] = grp.apply(
            lambda r: (r["lucro_bruto"] / r["receita_total_item"] * 100)
            if r["receita_total_item"] != 0
            else 0.0,
            axis=1,
        ).fillna(0.0)

        # % Participação = Σ(Total NF) do item / Σ(Total NF) global * 100
        grp["participacao_perc"] = grp.apply(
            lambda r: (r["receita_total_item"] / receita_global * 100)
            if receita_global != 0
            else 0.0,
            axis=1,
        ).fillna(0.0)

        # ------------------------------------------------------------------
        # 6. Ordena de forma decrescente pela % Participação
        # ------------------------------------------------------------------
        grp = grp.sort_values(by="participacao_perc", ascending=False).reset_index(
            drop=True
        )

        # ------------------------------------------------------------------
        # 6b. Classificação ABC pela regra 80/20 com participação ACUMULADA
        #   Classe A: acumulado ≤ 20%  (top 20% da receita)
        #   Classe B: acumulado ≤ 50%  (próximos 30%)
        #   Classe C: acumulado > 50%  (restantes 50%)
        # ------------------------------------------------------------------
        grp["participacao_acumulada"] = grp["participacao_perc"].cumsum()
        def classificar_abc(acum):
            if acum <= 21.0:
                return "A"
            elif acum <= 51.0:
                return "B"
            else:
                return "C"
        grp["classe_abc"] = grp["participacao_acumulada"].apply(classificar_abc)

        # ------------------------------------------------------------------
        # 7. Resumo global (Lucro Bruto baseado no CMV dos produtos)
        # ------------------------------------------------------------------
        lucro_bruto_total = float(grp["lucro_bruto"].sum())
        margem_media = (
            float(lucro_bruto_total / receita_global * 100)
            if receita_global != 0
            else 0.0
        )

        # Lista de famílias únicas (ordenadas)
        familias_unicas = sorted(grp["familia_produto"].dropna().unique().tolist())

        # ------------------------------------------------------------------
        # 8. Monta a lista de itens para o JSON
        # ------------------------------------------------------------------
        itens_lista = []
        for _, row in grp.iterrows():
            itens_lista.append(
                {
                    "descricao_produto": str(row["descricao_produto"]),
                    "familia_produto": str(row["familia_produto"]),
                    "classe_abc": str(row["classe_abc"]),
                    "quantidade": round(float(row["qtd_total"]), 4),
                    "receita_total": round(float(row["receita_total_item"]), 2),
                    "descontos": round(float(row["descontos_sum"]), 2),
                    "cmv_medio": round(float(row["cmv_medio"]), 2),       # CMC unitário do produto
                    "cmv_total": round(float(row["cmv_total"]), 2),       # QTD * CMV UNIT.
                    "media_valor_venda": round(float(row["media_valor_venda"]), 2),
                    "lucro_bruto": round(float(row["lucro_bruto"]), 2),
                    "margem_bruta_perc": round(float(row["margem_bruta_perc"]), 2),
                    "participacao_perc": round(float(row["participacao_perc"]), 4),
                    "participacao_acumulada": round(float(row["participacao_acumulada"]), 4),
                }
            )

        return JSONResponse(
            content={
                "resumo": {
                    "receita_total": round(float(receita_global), 2),
                    "lucro_bruto_total": round(lucro_bruto_total, 2),
                    "margem_media_perc": round(margem_media, 2),
                },
                "familias": familias_unicas,
                "itens": itens_lista,
            }
        )

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=500, content={"detail": f"Falha no Backend: {e}"}
        )


@app.get("/api/relatorios/contas-a-pagar/dados")
def obter_dados_tela(data_inicio: str, data_fim: str, current_user: models.User = Depends(get_current_user_and_set_org)):
    current_org.set(current_user.organization)
    try:
        dict_fornecedores = extrair_dicionario_fornecedores()
        dict_categorias = extrair_dicionario_categorias()

        dict_forn_str = {str(k): v for k, v in dict_fornecedores.items()}
        dict_cat_str = {str(k): v for k, v in dict_categorias.items()}

        contas_brutas = extrair_contas_pagar_abertas(data_inicio, data_fim)
        if not contas_brutas:
            return JSONResponse(content={"total": 0.0, "contas": []})

        df_contas = pd.json_normalize(contas_brutas)
        if df_contas.empty:
            return JSONResponse(content={"total": 0.0, "contas": []})

        df_contas["valor_documento"] = pd.to_numeric(
            df_contas.get("valor_documento", pd.Series(dtype=float)), errors="coerce"
        ).fillna(0.0)

        if "valor_pag" in df_contas.columns:
            df_contas["valor_pag"] = pd.to_numeric(
                df_contas["valor_pag"], errors="coerce"
            ).fillna(0.0)
            df_contas["saldo_devedor"] = df_contas.apply(
                lambda row: (
                    row["valor_documento"]
                    if row["valor_pag"] == 0
                    else row["valor_pag"]
                ),
                axis=1,
            )
        else:
            df_contas["saldo_devedor"] = df_contas["valor_documento"]

        if "data_previsao" not in df_contas.columns:
            return JSONResponse(content={"total": 0.0, "contas": []})

        df_contas["data_previsao_dt"] = pd.to_datetime(
            df_contas["data_previsao"], format="%d/%m/%Y", errors="coerce"
        )
        df_contas = df_contas.dropna(subset=["data_previsao_dt"])
        df_contas["data_previsao_br"] = df_contas["data_previsao_dt"].dt.strftime(
            "%d/%m/%Y"
        )

        inicio_dt = pd.to_datetime(data_inicio)
        fim_dt = pd.to_datetime(data_fim)
        mask_periodo = (df_contas["data_previsao_dt"] >= inicio_dt) & (
            df_contas["data_previsao_dt"] <= fim_dt
        )
        df_abertos = df_contas[mask_periodo].copy()

        if df_abertos.empty:
            return JSONResponse(content={"total": 0.0, "contas": []})
        df_abertos = df_abertos.sort_values(by="data_previsao_dt")
        total = float(df_abertos["saldo_devedor"].sum())

        contas_lista = []
        for _, row in df_abertos.iterrows():
            val_forn = row.get("codigo_cliente_fornecedor")
            id_forn = ""
            if pd.notna(val_forn) and str(val_forn).strip() not in ["", "nan", "None"]:
                try:
                    id_forn = str(int(float(val_forn)))
                except:
                    id_forn = str(val_forn).strip()

            val_cat = row.get("codigo_categoria")
            id_cat = str(val_cat).strip() if pd.notna(val_cat) else ""

            contas_lista.append(
                {
                    "data_previsao_br": tratar_vazio(row.get("data_previsao_br")),
                    "data_emissao": tratar_vazio(row.get("data_emissao")),
                    "numero_documento_fiscal": tratar_vazio(
                        row.get("numero_documento_fiscal")
                    ),
                    "numero_parcela": tratar_vazio(row.get("numero_parcela")),
                    "nome_fornecedor": dict_forn_str.get(
                        id_forn, tratar_vazio(val_forn)
                    ),
                    "desc_categoria": dict_cat_str.get(id_cat, tratar_vazio(val_cat)),
                    "saldo_devedor": float(row.get("saldo_devedor", 0.0)),
                }
            )
        return JSONResponse(content={"total": total, "contas": contas_lista})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=500, content={"detail": f"Falha no Backend: {e}"}
        )


@app.get("/api/relatorios/contas-pagas/dados")
def obter_dados_contas_pagas(data_inicio: str, data_fim: str, current_user: models.User = Depends(get_current_user_and_set_org)):
    current_org.set(current_user.organization)
    try:
        dict_fornecedores = extrair_dicionario_fornecedores()
        dict_categorias = extrair_dicionario_categorias()
        dict_contas = extrair_dicionario_contas_correntes()

        dict_forn_str = {str(k): v for k, v in dict_fornecedores.items()}
        dict_cat_str = {str(k): v for k, v in dict_categorias.items()}

        movimentos_brutos = extrair_movimentos_pagos_periodo(data_inicio, data_fim)
        if not movimentos_brutos:
            return JSONResponse(content={"total": 0.0, "contas": []})

        contas_lista = []
        total_pago = 0.0

        # VARIÁVEL DE CONTROLE: Armazena os IDs para evitar apenas a duplicidade de paginação
        movimentos_vistos = set()

        for mov in movimentos_brutos:
            det = mov.get("detalhes", {})
            res = mov.get("resumo", {})

            # Ignora cancelados
            status_mov = str(det.get("cStatus", "")).upper()
            if status_mov in ["CANCELADO", "EXCLUIDO", "ESTORNADO"]:
                continue

            # ATUALIZAÇÃO: Só filtra por nCodMovCC se ele existir. Se não existir, deixa passar!
            id_mov = det.get("nCodMovCC")
            if id_mov:
                if id_mov in movimentos_vistos:
                    continue
                movimentos_vistos.add(id_mov)

            # LÓGICA DE VALOR HÍBRIDA (FALLBACK COM BLINDAGEM SAFE_FLOAT):
            valor_mov = abs(safe_float(det.get("nValorMovCC")))
            valor_pago_resumo = safe_float(res.get("nValPago"))

            valor = valor_mov if valor_mov > 0 else valor_pago_resumo

            if valor <= 0:
                continue

            id_forn_orig = det.get("nCodCliente")
            id_cat_orig = det.get("cCodCateg")
            id_conta_orig = det.get("nCodCC")

            id_fornecedor = str(id_forn_orig) if id_forn_orig else ""
            id_categoria = str(id_cat_orig) if id_cat_orig else ""
            id_conta = str(id_conta_orig) if id_conta_orig else ""

            contas_lista.append(
                {
                    "data_pagamento_br": tratar_vazio(det.get("dDtPagamento")),
                    "data_emissao": tratar_vazio(det.get("dDtEmissao")),
                    "numero_documento_fiscal": tratar_vazio(det.get("cNumDocFiscal")),
                    "numero_parcela": tratar_vazio(det.get("cNumParcela")),
                    "nome_fornecedor": dict_forn_str.get(
                        id_fornecedor, tratar_vazio(id_forn_orig)
                    ),
                    "desc_categoria": dict_cat_str.get(
                        id_categoria, tratar_vazio(id_cat_orig)
                    ),
                    "conta_corrente": dict_contas.get(id_conta, f"Conta {id_conta}"),
                    "valor_pago": valor,
                }
            )
            total_pago += valor

        contas_lista = sorted(
            contas_lista,
            key=lambda x: (
                pd.to_datetime(
                    x["data_pagamento_br"], format="%d/%m/%Y", errors="coerce"
                )
                if x["data_pagamento_br"] != "-"
                else pd.Timestamp.min
            ),
        )
        return JSONResponse(content={"total": total_pago, "contas": contas_lista})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=500, content={"detail": f"Falha no Backend: {e}"}
        )


@app.get("/api/relatorios/recebimentos/dados")
def obter_recebimentos_abertos(data_inicio: str = None, data_fim: str = None, force_sync: bool = False, current_user: models.User = Depends(get_current_user_and_set_org)):
    current_org.set(current_user.organization)
    try:
        dict_clientes = extrair_dicionario_fornecedores()
        dict_categorias = extrair_dicionario_categorias()
        dict_contas = extrair_dicionario_contas_correntes()

        dict_cli_str = {str(k): v for k, v in dict_clientes.items()}
        dict_cat_str = {str(k): v for k, v in dict_categorias.items()}

        contas_brutas, ultima_sync = extrair_contas_receber_abertas(force_sync=force_sync, return_metadata=True)
        ultima_sync_str = ultima_sync.strftime("%d/%m/%Y %H:%M:%S") if ultima_sync else None

        if not contas_brutas:
            return JSONResponse(content={"total": 0.0, "contas": [], "ultima_sincronizacao": ultima_sync_str})

        contas_lista = []
        total = 0.0

        for c in contas_brutas:
            tipo_doc = str(c.get("codigo_tipo_documento", "")).strip().upper()

            if tipo_doc != "CRE":
                continue

            id_cli = str(c.get("codigo_cliente_fornecedor", ""))
            id_cat = str(c.get("codigo_categoria", ""))
            id_conta = str(c.get("id_conta_corrente", ""))

            nome_cli = dict_cli_str.get(id_cli, tratar_vazio(id_cli))
            desc_cat = dict_cat_str.get(id_cat, tratar_vazio(id_cat))
            nome_conta = dict_contas.get(id_conta, f"Conta {id_conta}")

            valor_documento = float(c.get("valor_documento", 0.0))
            valor_pag = float(c.get("valor_pag", 0.0))

            # Se houver pagamento parcial, o saldo real é o que resta
            # Caso contrário, o saldo é o valor total da nota
            if valor_pag > 0 and valor_pag < valor_documento:
                saldo = round(valor_documento - valor_pag, 2)
            else:
                saldo = valor_documento

            info_registro = c.get("info", {})
            hora_exata = info_registro.get("hInc", "00:00:00")

            contas_lista.append(
                {
                    "codigo_lancamento": c.get("codigo_lancamento_omie"),
                    "data_previsao_br": tratar_vazio(c.get("data_previsao") or c.get("data_vencimento")),
                    "data_emissao": tratar_vazio(c.get("data_emissao")),
                    "hora_emissao": hora_exata,
                    "tipo_documento": tipo_doc,
                    "numero_documento_fiscal": tratar_vazio(
                        c.get("numero_documento_fiscal")
                    ),
                    "numero_parcela": tratar_vazio(c.get("numero_parcela")),
                    "nome_cliente": nome_cli,
                    "nome_fornecedor": nome_cli,
                    "desc_categoria": desc_cat,
                    "conta_corrente": nome_conta,
                    "valor_documento": valor_documento,
                    "valor_pag": valor_pag,
                    "saldo_devedor": saldo,
                    "tem_pagamento_parcial": valor_pag > 0 and valor_pag < valor_documento,
                }
            )
            total += saldo


        contas_lista = sorted(
            contas_lista,
            key=lambda x: (
                pd.to_datetime(
                    x["data_previsao_br"], format="%d/%m/%Y", errors="coerce"
                )
                if x["data_previsao_br"] != "-"
                else pd.Timestamp.min
            ),
        )
        return JSONResponse(content={"total": total, "contas": contas_lista, "ultima_sincronizacao": ultima_sync_str})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"detail": str(e)})


@app.post("/api/relatorios/recebimentos/baixar")
def baixar_recebimento_lote(req: BaixaLoteRequest, current_user: models.User = Depends(get_current_user_and_set_org)):
    current_org.set(current_user.organization)
    url = "https://app.omie.com.br/api/v1/financas/contareceber/"
    erros = []
    baixas_sucesso = []

    for pag in req.pagamentos:
        time.sleep(0.3)

        payload = {
            "call": "LancarRecebimento",
            "app_key": current_org.get().omie_app_key,
            "app_secret": current_org.get().omie_app_secret,
            "param": [
                {
                    "codigo_lancamento": pag.codigo_lancamento,
                    "codigo_conta_corrente": req.id_conta_corrente,
                    "valor": pag.valor,
                    "desconto": pag.desconto,
                    "juros": pag.juros,
                    "data": req.data_pagamento,
                    "observacao": "Baixa em Lote c/ Rateio via GabaritoBI",
                }
            ],
        }
        try:
            res = requests.post(
                url, json=payload, headers={"Content-Type": "application/json"}
            ).json()
            if "faultstring" in res:
                erros.append(
                    f"Erro na nota {pag.codigo_lancamento}: {res['faultstring']}"
                )
            else:
                baixas_sucesso.append({
                    "codigo_lancamento": pag.codigo_lancamento,
                    "codigo_baixa": res.get("codigo_baixa")
                })
        except Exception as e:
            erros.append(f"Erro na comunicação: {str(e)}")

    if erros:
        return JSONResponse(status_code=400, content={"detail": " | ".join(erros)})

    return JSONResponse(
        content={
            "status": "success", 
            "mensagem": "Recebimentos em lote registrados!",
            "baixas": baixas_sucesso
        }
    )

class RecebimentoReciboCreate(BaseModel):
    cliente: str
    banco: str | None
    data_pagamento: str
    totalOriginal: float
    totalDesconto: float
    totalJuros: float
    totalPago: float
    notas: list

@app.post("/api/recibos")
def salvar_recibo(req: RecebimentoReciboCreate, current_user: models.User = Depends(get_current_user_and_set_org)):
    current_org.set(current_user.organization)
    db = SessionLocal()
    try:
        novo_recibo = models.PaymentReceipt(
            cliente=req.cliente,
            banco=req.banco,
            data_pagamento=req.data_pagamento,
            total_original=req.totalOriginal,
            total_desconto=req.totalDesconto,
            total_juros=req.totalJuros,
            total_pago=req.totalPago,
            notas=req.notas,
            organization_id=current_org.get().id
        )
        db.add(novo_recibo)
        db.commit()
        db.refresh(novo_recibo)
        return {"status": "success", "id": novo_recibo.id}
    finally:
        db.close()

@app.get("/api/recibos")
def listar_recibos(current_user: models.User = Depends(get_current_user_and_set_org)):
    current_org.set(current_user.organization)
    db = SessionLocal()
    try:
        recibos = db.query(models.PaymentReceipt).filter(models.PaymentReceipt.organization_id == current_org.get().id).order_by(models.PaymentReceipt.id.desc()).all()
        return [
            {
                "id": r.id,
                "cliente": r.cliente,
                "banco": r.banco,
                "data_pagamento": r.data_pagamento,
                "totalOriginal": r.total_original,
                "totalDesconto": r.total_desconto,
                "totalJuros": r.total_juros,
                "totalPago": r.total_pago,
                "notas": r.notas,
                "created_at": r.created_at.strftime("%d/%m/%Y %H:%M:%S")
            }
            for r in recibos
        ]
    finally:
        db.close()

@app.delete("/api/recibos/{id}")
def deletar_recibo(id: int, current_user: models.User = Depends(get_current_user_and_set_org)):
    current_org.set(current_user.organization)
    db = SessionLocal()
    try:
        recibo = db.query(models.PaymentReceipt).filter(models.PaymentReceipt.id == id, models.PaymentReceipt.organization_id == current_org.get().id).first()
        if not recibo:
            return JSONResponse(status_code=404, content={"detail": "Recibo não encontrado"})
        db.delete(recibo)
        db.commit()
        return {"status": "success"}
    finally:
        db.close()

@app.post("/api/recibos/{id}/desfazer")
def desfazer_baixa(id: int, current_user: models.User = Depends(get_current_user_and_set_org)):
    current_org.set(current_user.organization)
    db = SessionLocal()
    try:
        recibo = db.query(models.PaymentReceipt).filter(models.PaymentReceipt.id == id, models.PaymentReceipt.organization_id == current_org.get().id).first()
        if not recibo:
            return JSONResponse(status_code=404, content={"detail": "Recibo não encontrado"})
        
        url = "https://app.omie.com.br/api/v1/financas/contareceber/"
        erros = []
        for nota in recibo.notas:
            codigo_baixa = nota.get("codigo_baixa")
            codigo_lancamento = nota.get("codigo_lancamento")
            if not codigo_baixa:
                continue
                
            payload = {
                "call": "CancelarRecebimento",
                "app_key": current_org.get().omie_app_key,
                "app_secret": current_org.get().omie_app_secret,
                "param": [
                    {
                        "codigo_baixa": codigo_baixa
                    }
                ]
            }
            try:
                res = requests.post(url, json=payload, headers={"Content-Type": "application/json"}).json()
                if "faultstring" in res:
                    erros.append(f"Erro na baixa {codigo_baixa}: {res['faultstring']}")
            except Exception as e:
                erros.append(f"Erro na comunicação: {str(e)}")
            time.sleep(0.3)
            
        if erros:
            return JSONResponse(status_code=400, content={"detail": " | ".join(erros)})
            
        db.delete(recibo)
        db.commit()
        return {"status": "success", "mensagem": "Baixas desfeitas com sucesso no Omie e histórico removido!"}
    finally:
        db.close()


# ==============================================================================
# DRE GERENCIAL (POR DATA DE EMISSAO)
# ==============================================================================

def _omie_fetch_pages_parallel(url, call_name, array_name, d_ini, d_fim):
    app_key = current_org.get().omie_app_key
    app_secret = current_org.get().omie_app_secret
    
    # First request to get total_paginas
    payload = {
        "call": call_name,
        "app_key": app_key,
        "app_secret": app_secret,
        "param": [{
            "pagina": 1,
            "registros_por_pagina": 100,
            "filtrar_por_emissao_de": d_ini,
            "filtrar_por_emissao_ate": d_fim,
        }]
    }
    try:
        res = requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=20)
        if res.status_code != 200:
            return []
        data = res.json()
    except Exception as e:
        print(f"Erro na pagina 1 de {call_name}:", e)
        return []

    total_paginas = data.get("total_de_paginas", 1)
    todas_contas = list(data.get(array_name, []))

    if total_paginas <= 1:
        return todas_contas

    def fetch_page(pagina):
        page_payload = {
            "call": call_name,
            "app_key": app_key,
            "app_secret": app_secret,
            "param": [{
                "pagina": pagina,
                "registros_por_pagina": 100,
                "filtrar_por_emissao_de": d_ini,
                "filtrar_por_emissao_ate": d_fim,
            }]
        }
        try:
            p_res = requests.post(url, json=page_payload, headers={"Content-Type": "application/json"}, timeout=20)
            if p_res.status_code == 200:
                return p_res.json().get(array_name, [])
        except Exception as e:
            print(f"Erro na pagina {pagina} de {call_name}:", e)
        return []

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        results = executor.map(fetch_page, range(2, total_paginas + 1))
        for res_list in results:
            if res_list:
                todas_contas.extend(res_list)
                
    return todas_contas

def _omie_extrair_dre_pagar_emissao(data_ini_str, data_fim_str):
    d_ini = f"{data_ini_str[8:10]}/{data_ini_str[5:7]}/{data_ini_str[0:4]}"
    d_fim = f"{data_fim_str[8:10]}/{data_fim_str[5:7]}/{data_fim_str[0:4]}"
    url = "https://app.omie.com.br/api/v1/financas/contapagar/"
    return _omie_fetch_pages_parallel(url, "ListarContasPagar", "conta_pagar_cadastro", d_ini, d_fim)

def _omie_extrair_dre_receber_emissao(data_ini_str, data_fim_str):
    d_ini = f"{data_ini_str[8:10]}/{data_ini_str[5:7]}/{data_ini_str[0:4]}"
    d_fim = f"{data_fim_str[8:10]}/{data_fim_str[5:7]}/{data_fim_str[0:4]}"
    url = "https://app.omie.com.br/api/v1/financas/contareceber/"
    return _omie_fetch_pages_parallel(url, "ListarContasReceber", "conta_receber_cadastro", d_ini, d_fim)

def _extract_emissao(item):
    d = item.get("data_emissao")
    if d:
        return f"{d[6:10]}-{d[3:5]}-{d[0:2]}"
    return "1900-01-01"

def extrair_dre_pagar(data_inicio, data_fim):
    return obter_fatiado_db(
        data_inicio,
        data_fim,
        "DRE Pagar",
        "dre_pagar",
        _omie_extrair_dre_pagar_emissao,
        _extract_emissao
    )

def extrair_dre_receber(data_inicio, data_fim):
    return obter_fatiado_db(
        data_inicio,
        data_fim,
        "DRE Receber",
        "dre_receber",
        _omie_extrair_dre_receber_emissao,
        _extract_emissao
    )

@app.get("/api/relatorios/dre/dados")
def obter_dados_dre(data_inicio: str, data_fim: str, current_user: models.User = Depends(get_current_user_and_set_org)):
    current_org.set(current_user.organization)
    try:
        dict_categorias = extrair_dicionario_categorias()
        dict_cat_str = {str(k): v for k, v in dict_categorias.items()}
        
        pagar = extrair_dre_pagar(data_inicio, data_fim)
        receber = extrair_dre_receber(data_inicio, data_fim)
        
        agrup_receitas = {}
        agrup_despesas = {}
        
        total_receitas = 0.0
        total_despesas = 0.0
        
        # Agrupar receitas
        for p in receber:
            categorias = p.get("categorias", [])
            if not categorias:
                cat = p.get("codigo_categoria")
                if cat: categorias = [{"codigo_categoria": cat, "valor": p.get("valor_documento", 0)}]
                
            for cat in categorias:
                c_cod = cat.get("codigo_categoria", "")
                val = float(cat.get("valor", 0))
                if c_cod not in agrup_receitas:
                    desc = dict_cat_str.get(str(c_cod), c_cod)
                    agrup_receitas[c_cod] = {"categoria": desc, "codigo": c_cod, "valor": 0.0}
                agrup_receitas[c_cod]["valor"] += val
                total_receitas += val

        # Agrupar despesas
        for p in pagar:
            categorias = p.get("categorias", [])
            if not categorias:
                cat = p.get("codigo_categoria")
                if cat: categorias = [{"codigo_categoria": cat, "valor": p.get("valor_documento", 0)}]
                
            for cat in categorias:
                c_cod = cat.get("codigo_categoria", "")
                val = float(cat.get("valor", 0))
                if c_cod not in agrup_despesas:
                    desc = dict_cat_str.get(str(c_cod), c_cod)
                    agrup_despesas[c_cod] = {"categoria": desc, "codigo": c_cod, "valor": 0.0}
                agrup_despesas[c_cod]["valor"] += val
                total_despesas += val
                
        # Sort values
        lista_receitas = sorted(list(agrup_receitas.values()), key=lambda x: x["valor"], reverse=True)
        lista_despesas = sorted(list(agrup_despesas.values()), key=lambda x: x["valor"], reverse=True)
        
        return {
            "receitas": lista_receitas,
            "despesas": lista_despesas,
            "totais": {
                "receita": total_receitas,
                "despesa": total_despesas,
                "lucro": total_receitas - total_despesas
            }
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
