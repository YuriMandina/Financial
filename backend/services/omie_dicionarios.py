# --- [BLOCO: Dicionários Omie] ---
import time
import requests
from core.deps import current_org
from core.cache import obter_global_db

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
