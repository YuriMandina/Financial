# --- [BLOCO: Omie Financeiro] ---
import time
import random
import requests
import pandas as pd
import concurrent.futures
from core.deps import current_org
from core.cache import obter_global_db, obter_fatiado_db
from api.tasks import TaskManager

def _omie_extrair_contas_pagar_abertas(min_f_str=None, max_f_str=None, task_id=None):
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

        if task_id:
            progress = (pagina_atual / total_paginas) * 100
            TaskManager.update_task(task_id, progress=progress, log=f"Extraindo Contas a Pagar: Página {pagina_atual} de {total_paginas}")

        pagina_atual += 1
        time.sleep(0.3)

    return todas_contas

def extrair_contas_pagar_abertas(data_inicio: str, data_fim: str, **kwargs):
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
        extract_date,
        task_id=kwargs.get('task_id'),
        force_sync=kwargs.get('force_sync', False)
    )

def _omie_extrair_contas_receber_abertas(min_f_str=None, max_f_str=None, task_id=None):
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

        if task_id:
            progress = (pagina / total_paginas) * 100
            TaskManager.update_task(task_id, progress=progress, log=f"Extraindo Contas a Receber: Página {pagina} de {total_paginas}")

    return todas_contas

def extrair_contas_receber_abertas(force_sync=False, return_metadata=False, **kwargs):
    return obter_global_db(
        "contas_receber_abertas_global",
        "Contas a Receber (Abertas)",
        _omie_extrair_contas_receber_abertas,
        force_sync=force_sync,
        return_metadata=return_metadata,
        task_id=kwargs.get('task_id')
    )

def _omie_extrair_movimentos_pagos_periodo(data_inicio: str, data_fim: str, task_id=None):
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

        if task_id:
            progress = (pagina_atual / total_paginas) * 100
            TaskManager.update_task(task_id, progress=progress, log=f"Extraindo Movimentos Pagos: Página {pagina_atual} de {total_paginas}")

        pagina_atual += 1
        time.sleep(0.3)

    return todos_movimentos

def extrair_movimentos_pagos_periodo(data_inicio: str, data_fim: str, **kwargs):
    return obter_fatiado_db(
        data_inicio,
        data_fim,
        "Contas Pagas",
        "mov_pagos",
        _omie_extrair_movimentos_pagos_periodo,
        lambda mov: pd.to_datetime(mov.get("detalhes", {}).get("dDtPagamento", "01/01/1900"), format="%d/%m/%Y", errors="coerce").strftime("%Y-%m-%d"),
        task_id=kwargs.get('task_id'),
        force_sync=kwargs.get('force_sync', False)
    )

def _omie_fetch_pages_parallel(url, call_name, array_name, d_ini, d_fim, task_id=None):
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
        futures = {executor.submit(fetch_page, pagina): pagina for pagina in range(2, total_paginas + 1)}
        paginas_completadas = 1 # Primeira página já foi
        
        for future in concurrent.futures.as_completed(futures):
            res_list = future.result()
            if res_list:
                todas_contas.extend(res_list)
                
            paginas_completadas += 1
            if task_id:
                progress = (paginas_completadas / total_paginas) * 100
                TaskManager.update_task(task_id, progress=progress, log=f"Extraindo {call_name}: Página {paginas_completadas} de {total_paginas}")
                
    return todas_contas

def _omie_extrair_dre_pagar_emissao(data_ini_str, data_fim_str, task_id=None):
    d_ini = f"{data_ini_str[8:10]}/{data_ini_str[5:7]}/{data_ini_str[0:4]}"
    d_fim = f"{data_fim_str[8:10]}/{data_fim_str[5:7]}/{data_fim_str[0:4]}"
    url = "https://app.omie.com.br/api/v1/financas/contapagar/"
    return _omie_fetch_pages_parallel(url, "ListarContasPagar", "conta_pagar_cadastro", d_ini, d_fim, task_id=task_id)

def _omie_extrair_dre_receber_emissao(data_ini_str, data_fim_str, task_id=None):
    d_ini = f"{data_ini_str[8:10]}/{data_ini_str[5:7]}/{data_ini_str[0:4]}"
    d_fim = f"{data_fim_str[8:10]}/{data_fim_str[5:7]}/{data_fim_str[0:4]}"
    url = "https://app.omie.com.br/api/v1/financas/contareceber/"
    return _omie_fetch_pages_parallel(url, "ListarContasReceber", "conta_receber_cadastro", d_ini, d_fim, task_id=task_id)

def _extract_emissao(item):
    d = item.get("data_emissao")
    if d:
        return f"{d[6:10]}-{d[3:5]}-{d[0:2]}"
    return "1900-01-01"

def extrair_dre_pagar(data_inicio, data_fim, **kwargs):
    return obter_fatiado_db(
        data_inicio,
        data_fim,
        "DRE Pagar",
        "dre_pagar",
        _omie_extrair_dre_pagar_emissao,
        _extract_emissao,
        task_id=kwargs.get('task_id'),
        force_sync=kwargs.get('force_sync', False)
    )

def extrair_dre_receber(data_inicio, data_fim, **kwargs):
    return obter_fatiado_db(
        data_inicio,
        data_fim,
        "DRE Receber",
        "dre_receber",
        _omie_extrair_dre_receber_emissao,
        _extract_emissao,
        task_id=kwargs.get('task_id'),
        force_sync=kwargs.get('force_sync', False)
    )
