import requests
from core.deps import current_org
from api.tasks import TaskManager

session = requests.Session()

def sincronizar_produtos_e_familias(db, org_id, task_id=None):
    import models.models as models
    url = "https://app.omie.com.br/api/v1/geral/produtos/"
    pagina_atual, total_paginas = 1, 1
    
    familias_dict = {}  # omie_id (codigo_familia) -> db_fam (object)
    produtos_inseridos = 0

    if task_id:
        TaskManager.update_task(task_id, log="Iniciando extração de páginas da Omie...")

    while pagina_atual <= total_paginas:
        if task_id:
            t = TaskManager.get_task(task_id)
            if t and t.get("status") == "canceled":
                break
                
        payload = {
            "call": "ListarProdutos",
            "app_key": current_org.get().omie_app_key,
            "app_secret": current_org.get().omie_app_secret,
            "param": [
                {
                    "pagina": pagina_atual,
                    "registros_por_pagina": 500,
                    "apenas_importado_api": "N",
                    "filtrar_apenas_omiepdv": "N"
                }
            ],
        }
        try:
            res = session.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=30).json()
            if "faultstring" in res:
                raise Exception(f"Omie API Error: {res['faultstring']}")
                
            total_paginas = res.get("total_de_paginas", 1)

            for prod in res.get("produto_servico_cadastro", []):
                cod_familia = prod.get("codigo_familia")
                nome_familia = str(prod.get("descricao_familia", "") or "").strip() or str(prod.get("familia_produto", "") or "").strip()
                
                # Se não tem família configurada, ignora (ou salva como 'Sem Família')
                if not cod_familia:
                    continue
                
                # 1. Garantir que a Família existe no DB
                db_fam = familias_dict.get(cod_familia)
                if not db_fam:
                    db_fam = db.query(models.BoningFamily).filter_by(omie_id=cod_familia, organization_id=org_id).first()
                    if not db_fam:
                        db_fam = models.BoningFamily(omie_id=cod_familia, name=nome_familia or "Sem Nome", organization_id=org_id)
                        db.add(db_fam)
                        db.commit()
                        db.refresh(db_fam)
                    familias_dict[cod_familia] = db_fam
                
                # 2. Garantir o Produto no DB
                prod_omie_id = prod.get("codigo_produto")
                db_prod = db.query(models.BoningProduct).filter_by(omie_id=prod_omie_id, organization_id=org_id).first()
                
                custo = 0.0
                if "dados_custos" in prod:
                    custo = prod["dados_custos"].get("valor_custo_medio_contabil", 0.0)
                    
                nome = prod.get("descricao", "Sem Descrição")
                valor_venda = prod.get("valor_unitario", 0.0)
                
                if not db_prod:
                    db_prod = models.BoningProduct(
                        omie_id=prod_omie_id,
                        name=nome,
                        unit_price=valor_venda,
                        family_id=db_fam.id,
                        organization_id=org_id
                    )
                    db.add(db_prod)
                else:
                    db_prod.name = nome
                    db_prod.unit_price = valor_venda
                    db_prod.family_id = db_fam.id
                
                produtos_inseridos += 1

            db.commit()
            if task_id:
                progress = 10.0 + (90.0 * (pagina_atual / total_paginas))
                TaskManager.update_task(task_id, progress=progress, log=f"Página {pagina_atual} de {total_paginas} processada. {produtos_inseridos} produtos novos/atualizados.")
        except Exception as e:
            raise Exception(f"Erro no ListarProdutos (Sync): {e}")

        pagina_atual += 1

    return produtos_inseridos



from datetime import datetime

_local_estoque_cache = {}

def obter_local_estoque_padrao(org_id):
    if org_id in _local_estoque_cache:
        return _local_estoque_cache[org_id]
        
    url = "https://app.omie.com.br/api/v1/estoque/local/"
    payload = {
        "call": "PesquisarLocaisEstoque",
        "app_key": current_org.get().omie_app_key,
        "app_secret": current_org.get().omie_app_secret,
        "param": [{"pagina": 1, "registros_por_pagina": 100}]
    }
    try:
        res = session.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=30).json()
        for local in res.get("locaisEncontrados", []):
            if "PADRAO" in local.get("descricao", "").upper():
                codigo = local.get("codigo_local_estoque")
                _local_estoque_cache[org_id] = codigo
                return codigo
                
        if res.get("locaisEncontrados"):
            codigo = res["locaisEncontrados"][0].get("codigo_local_estoque")
            _local_estoque_cache[org_id] = codigo
            return codigo
            
    except Exception as e:
        print(f"Erro ao obter local de estoque: {e}")
        
    return 0

def consultar_posicao_estoque(produto_id, data_formatada):
    if isinstance(data_formatada, str) and "-" in data_formatada:
        try:
            from datetime import datetime
            dt = datetime.fromisoformat(data_formatada.replace("Z", "+00:00"))
            data_formatada = dt.strftime("%d/%m/%Y")
        except:
            pass

    url = "https://app.omie.com.br/api/v1/estoque/consulta/"
    payload = {
        "call": "PosicaoEstoque",
        "app_key": current_org.get().omie_app_key,
        "app_secret": current_org.get().omie_app_secret,
        "param": [{
            "id_prod": produto_id,
            "data": data_formatada
        }]
    }
    
    res = session.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=30).json()
    if "faultstring" in res:
        raise Exception(f"Omie recusou consulta de estoque: {res['faultstring']}")
        
    if "produtos" in res and res["produtos"]:
        prod = res["produtos"][0]
        if "saldo" in prod:
            return float(prod["saldo"]), prod.get("codigo_local_estoque", 0)
        if "locais" in prod and prod["locais"]:
            local = prod["locais"][0]
            if "saldo" in local:
                return float(local["saldo"]), local.get("codigo_local_estoque", 0)
    
    if "saldo" in res:
        return float(res["saldo"]), res.get("codigo_local_estoque", 0)
        
    print(f"Aviso: formato desconhecido na resposta (posicao estoque): {res}")
    return 0.0, 0

def obter_cmc_produto_na_data(produto_id, data_formatada):
    if isinstance(data_formatada, str) and "-" in data_formatada:
        try:
            from datetime import datetime
            dt = datetime.fromisoformat(data_formatada.replace("Z", "+00:00"))
            data_formatada = dt.strftime("%d/%m/%Y")
        except:
            pass

    url = "https://app.omie.com.br/api/v1/estoque/consulta/"
    payload = {
        "call": "PosicaoEstoque",
        "app_key": current_org.get().omie_app_key,
        "app_secret": current_org.get().omie_app_secret,
        "param": [{
            "id_prod": produto_id,
            "data": data_formatada
        }]
    }

    res = session.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=30).json()
    if "faultstring" in res:
        raise Exception(f"Omie recusou consulta de CMC: {res['faultstring']}")
        
    if "produtos" in res and res["produtos"]:
        prod = res["produtos"][0]
        cmc = prod.get("cmc") or prod.get("nCMC") or prod.get("custo_medio_contabil")
        if cmc is not None:
            return float(cmc)
        if "locais" in prod and prod["locais"]:
            local = prod["locais"][0]
            cmc_local = local.get("cmc") or local.get("nCMC") or local.get("custo_medio_contabil")
            if cmc_local is not None:
                return float(cmc_local)
    
    cmc_res = res.get("cmc") or res.get("nCMC") or res.get("custo_medio_contabil")
    if cmc_res is not None:
        return float(cmc_res)
        
    return 0.0

def zerar_estoque_negativo(produto_id, local_id, data_formatada, saldo_negativo, unit_cost=0.0):
    if isinstance(data_formatada, str) and "-" in data_formatada:
        try:
            from datetime import datetime
            dt = datetime.fromisoformat(data_formatada.replace("Z", "+00:00"))
            data_formatada = dt.strftime("%d/%m/%Y")
        except:
            pass

    url = "https://app.omie.com.br/api/v1/estoque/ajuste/"
    payload = {
        "call": "IncluirAjusteEstoque",
        "app_key": current_org.get().omie_app_key,
        "app_secret": current_org.get().omie_app_secret,
        "param": [{
            "id_prod": produto_id,
            "data": data_formatada,
            "quan": abs(saldo_negativo),
            "valor": unit_cost, 
            "motivo": "OPE",
            "origem": "AJU",
            "codigo_local_estoque": local_id,
            "tipo": "ENT"
        }]
    }
    try:
        print(f"[OMIE] Zerando estoque do produto {produto_id}. Payload: {payload}")
        res = session.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=30)
        res_data = res.json()
        print(f"[OMIE] Resposta zerar estoque: {res_data}")
        
        if "faultstring" in res_data:
            raise Exception(f"Omie recusou ajuste: {res_data['faultstring']}")
            
        return res_data
    except Exception as e:
        print(f"[OMIE] Erro ao zerar estoque do produto {produto_id}: {str(e)}")
        raise e

def lancar_entrada_estoque_omie(produto_id, quantidade, custo_unitario, data_processo, local_id=0):
    url = "https://app.omie.com.br/api/v1/estoque/ajuste/"
    
    if isinstance(data_processo, str):
        try:
            dt = datetime.fromisoformat(data_processo.replace("Z", "+00:00"))
            data_formatada = dt.strftime("%d/%m/%Y")
        except:
            data_formatada = data_processo 
    else:
        data_formatada = data_processo.strftime("%d/%m/%Y")
        
    org = current_org.get()
    
    # Fallback to local_id_padrao if local_id is 0
    if local_id == 0:
        local_id = obter_local_estoque_padrao(org.id)
        
    payload = {
        "call": "IncluirAjusteEstoque",
        "app_key": org.omie_app_key,
        "app_secret": org.omie_app_secret,
        "param": [{
            "id_prod": produto_id,
            "data": data_formatada,
            "quan": quantidade,
            "valor": custo_unitario,
            "motivo": "OPE",
            "origem": "AJU",
            "codigo_local_estoque": local_id,
            "tipo": "ENT"
        }]
    }
    
    try:
        print(f"[OMIE_ENTRADA] Produto: {produto_id}, Qtd: {quantidade}, Custo_Unit: {custo_unitario}")
        print(f"[OMIE_ENTRADA] Payload: {payload}")
        res = session.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=30)
        res_data = res.json()
        print(f"[OMIE_ENTRADA] Resposta: {res_data}")
        if "faultstring" in res_data:
            return False, res_data["faultstring"]
        return True, res_data.get("id_ajuste", 0)
    except Exception as e:
        print(f"[OMIE_ENTRADA] Erro: {str(e)}")
        return False, str(e)

def excluir_ajuste_estoque(id_ajuste):
    url = "https://app.omie.com.br/api/v1/estoque/ajuste/"
    payload = {
        "call": "ExcluirAjusteEstoque",
        "app_key": current_org.get().omie_app_key,
        "app_secret": current_org.get().omie_app_secret,
        "param": [{
            "id_ajuste": id_ajuste
        }]
    }
    try:
        print(f"[OMIE_EXCLUSAO] Excluindo ajuste ID: {id_ajuste}")
        res = session.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=30)
        res_data = res.json()
        print(f"[OMIE_EXCLUSAO] Resposta: {res_data}")
        if "faultstring" in res_data:
            err_msg = res_data["faultstring"]
            if "106" in err_msg or "ainda não foi processado" in err_msg.lower():
                return False, "Omie ainda está processando esse movimento. Aguarde alguns minutos e tente reverter novamente."
            if "105" in err_msg or "não foi localizado" in err_msg.lower():
                return True, "Movimento não localizado (já excluído ou recusado pela Omie)."
            return False, err_msg
        return True, "Excluído com sucesso"
    except Exception as e:
        print(f"[OMIE_EXCLUSAO] Erro: {str(e)}")
        return False, str(e)
