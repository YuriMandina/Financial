import os
import time  # Para controlar o rate limit
import requests
import traceback
import pandas as pd
from datetime import datetime, timedelta  # Para controlar o tempo do cache
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# --- SETUP DA APLICAÇÃO ---
load_dotenv()
APP_KEY = os.getenv("OMIE_APP_KEY")
APP_SECRET = os.getenv("OMIE_APP_SECRET")

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

def obter_global_db(cache_key, tipo_relatorio, fetch_fn, *args, data_ref="Global", **kwargs):
    db = SessionLocal()
    try:
        snap = db.query(SyncSnapshot).filter(SyncSnapshot.cache_key == cache_key).first()
        if snap:
            return snap.dados
        
        dados = fetch_fn(*args, **kwargs)
        if dados is not None:
            novo_snap = SyncSnapshot(
                cache_key=cache_key,
                tipo_relatorio=tipo_relatorio,
                data_referencia=data_ref,
                dados=dados
            )
            db.add(novo_snap)
            db.commit()
        return dados
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
                    dados=itens
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
            "app_key": APP_KEY,
            "app_secret": APP_SECRET,
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
    url = "https://app.omie.com.br/api/v1/financas/contareceber/"
    pagina_atual, total_paginas = 1, 1
    todas_contas = []

    while pagina_atual <= total_paginas:
        payload = {
            "call": "ListarContasReceber",
            "app_key": APP_KEY,
            "app_secret": APP_SECRET,
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
            todas_contas.extend(res.get("conta_receber_cadastro", []))
        except:
            break

        pagina_atual += 1
        time.sleep(0.3)

    return todas_contas

def extrair_contas_receber_abertas(data_inicio: str, data_fim: str):
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
        "Contas a Receber (Abertas)",
        "contas_receber_abertas",
        _omie_extrair_contas_receber_abertas,
        extract_date
    )


def _omie_extrair_dicionario_fornecedores():
    url = "https://app.omie.com.br/api/v1/geral/clientes/"
    pagina_atual, total_paginas = 1, 1
    dicionario = {}
    while pagina_atual <= total_paginas:
        payload = {
            "call": "ListarClientes",
            "app_key": APP_KEY,
            "app_secret": APP_SECRET,
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
            "app_key": APP_KEY,
            "app_secret": APP_SECRET,
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
            "app_key": APP_KEY,
            "app_secret": APP_SECRET,
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
            "app_key": APP_KEY,
            "app_secret": APP_SECRET,
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
            "app_key": APP_KEY,
            "app_secret": APP_SECRET,
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
            "app_key": APP_KEY,
            "app_secret": APP_SECRET,
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
            "app_key": APP_KEY,
            "app_secret": APP_SECRET,
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
def listar_snapshots():
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
def deletar_snapshot(snap_id: int):
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
def obter_bancos():
    dict_contas = extrair_dicionario_contas_correntes()
    bancos = [{"id": k, "nome": v} for k, v in dict_contas.items()]
    return sorted(bancos, key=lambda x: x["nome"])


@app.get("/api/debug/campos-produto")
def debug_campos_produto():
    """
    Endpoint de diagnóstico: retorna os primeiros 3 produtos do cadastro Omie
    com TODOS os campos da API, para identificar o campo correto de família.
    """
    url = "https://app.omie.com.br/api/v1/geral/produtos/"
    payload = {
        "call": "ListarProdutos",
        "app_key": APP_KEY,
        "app_secret": APP_SECRET,
        "param": [{"pagina": 1, "registros_por_pagina": 3, "apenas_importado_api": "N", "filtrar_apenas_omiepdv": "N"}],
    }
    try:
        res = requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=30).json()
        produtos = res.get("produto_servico_cadastro", [])
        return {"total_paginas": res.get("total_de_paginas"), "amostra": produtos[:3]}
    except Exception as e:
        return {"erro": str(e)}


@app.get("/api/relatorios/curva-abc/dados")
def obter_curva_abc(data_inicio: str, data_fim: str):
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
def obter_dados_tela(data_inicio: str, data_fim: str):
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
def obter_dados_contas_pagas(data_inicio: str, data_fim: str):
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
def obter_recebimentos_abertos(data_inicio: str, data_fim: str):
    try:
        dict_clientes = extrair_dicionario_fornecedores()
        dict_categorias = extrair_dicionario_categorias()
        dict_contas = extrair_dicionario_contas_correntes()

        dict_cli_str = {str(k): v for k, v in dict_clientes.items()}
        dict_cat_str = {str(k): v for k, v in dict_categorias.items()}

        contas_brutas = extrair_contas_receber_abertas(data_inicio, data_fim)
        if not contas_brutas:
            return JSONResponse(content={"total": 0.0, "contas": []})

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
        return JSONResponse(content={"total": total, "contas": contas_lista})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"detail": str(e)})


@app.post("/api/relatorios/recebimentos/baixar")
def baixar_recebimento_lote(req: BaixaLoteRequest):
    url = "https://app.omie.com.br/api/v1/financas/contareceber/"
    erros = []

    for pag in req.pagamentos:
        time.sleep(0.3)

        payload = {
            "call": "LancarRecebimento",
            "app_key": APP_KEY,
            "app_secret": APP_SECRET,
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
        except Exception as e:
            erros.append(f"Erro na comunicação: {str(e)}")

    if erros:
        return JSONResponse(status_code=400, content={"detail": " | ".join(erros)})

    return JSONResponse(
        content={"status": "success", "mensagem": "Recebimentos em lote registrados!"}
    )
