# --- [BLOCO: Omie Vendas e Estoque] ---
import time
import requests
import traceback
import pandas as pd
from core.deps import current_org
from core.cache import obter_global_db, obter_fatiado_db
from core.utils import safe_float
from api.tasks import TaskManager

def extrair_movimento_vendas(data_inicio: str, data_fim: str, **kwargs):
    return obter_fatiado_db(
        data_inicio,
        data_fim,
        "Vendas PDV",
        "movimento_vendas_pdv",
        _omie_extrair_movimento_vendas,
        lambda item: pd.to_datetime(item.get("data_emissao", "01/01/1900"), format="%d/%m/%Y", errors="coerce").strftime("%Y-%m-%d"),
        task_id=kwargs.get('task_id'),
        force_sync=kwargs.get('force_sync', False)
    )

def _omie_extrair_movimento_vendas(data_inicio: str, data_fim: str, task_id=None):
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
                info_cupom = cab.get("info", {})

                is_cancelado = str(info_cupom.get("cCupomCancelado", "N")).strip().upper()
                is_devolvido = str(info_cupom.get("cCupomDevolvido", "N")).strip().upper()
                status_cab = str(cab.get("cStatus", "")).strip().upper()

                if is_cancelado in ["S", "SIM", "1", "TRUE"] or status_cab == "C":
                    continue
                if is_devolvido in ["S", "SIM", "1", "TRUE"]:
                    continue
                    
                data_emissao = str(cab.get("dDtEmissao", cab.get("dDtEmissaoCupom", ""))).strip()

                for item in cupom.get("itensCupom", []):
                    is_item_cancelado = str(item.get("cItemCancelado", "N")).strip().upper()
                    is_item_devolvido = str(item.get("cItemDevolvido", "N")).strip().upper()

                    if is_item_cancelado in ["S", "SIM", "1", "TRUE"]:
                        continue
                    if is_item_devolvido in ["S", "SIM", "1", "TRUE"]:
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

        if task_id:
            progress = (pagina_atual / total_paginas) * 100
            TaskManager.update_task(task_id, progress=progress, log=f"Extraindo Vendas: Página {pagina_atual} de {total_paginas}")

        pagina_atual += 1
        time.sleep(0.3)

    return todos_itens


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
