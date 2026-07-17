import requests
from deps import current_org

def sincronizar_produtos_e_familias(db, org_id):
    import models
    url = "https://app.omie.com.br/api/v1/geral/produtos/"
    pagina_atual, total_paginas = 1, 1
    
    familias_dict = {}  # omie_id (codigo_familia) -> db_fam (object)
    produtos_inseridos = 0

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
                    "filtrar_apenas_omiepdv": "N"
                }
            ],
        }
        try:
            res = requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=30).json()
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
        except Exception as e:
            raise Exception(f"Erro no ListarProdutos (Sync): {e}")

        pagina_atual += 1

    return produtos_inseridos

def atualizar_custo_produto(produto_id, novo_custo):
    url = "https://app.omie.com.br/api/v1/geral/produtos/"
    payload = {
        "call": "AlterarProduto",
        "app_key": current_org.get().omie_app_key,
        "app_secret": current_org.get().omie_app_secret,
        "param": [
            {
                "codigo_produto": produto_id,
                "dados_custos": {
                    "valor_custo_medio_contabil": novo_custo
                }
            }
        ]
    }
    
    try:
        res = requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=30).json()
        if "faultstring" in res:
            return False, res["faultstring"]
        return True, "Atualizado com sucesso"
    except Exception as e:
        return False, str(e)

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
        res = requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=30).json()
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
    try:
        res = requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=30).json()
        if "saldo" in res:
            return res["saldo"], res.get("codigo_local_estoque", 0)
    except Exception as e:
        print(f"Erro ao consultar estoque: {e}")
    return 0.0, 0

def zerar_estoque_negativo(produto_id, local_id, data_formatada, saldo_negativo):
    url = "https://app.omie.com.br/api/v1/estoque/ajuste/"
    payload = {
        "call": "IncluirAjusteEstoque",
        "app_key": current_org.get().omie_app_key,
        "app_secret": current_org.get().omie_app_secret,
        "param": [{
            "id_prod": produto_id,
            "data": data_formatada,
            "qtde": abs(saldo_negativo),
            "valor": 0, 
            "motivo": "Ajuste para zerar estoque negativo pre-desossa",
            "codigo_local_estoque": local_id
        }]
    }
    try:
        requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=30)
    except:
        pass

def lancar_entrada_estoque_omie(produto_id, quantidade, custo_unitario, data_processo):
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
    
    saldo_atual, local_id_consulta = consultar_posicao_estoque(produto_id, data_formatada)
    local_id = obter_local_estoque_padrao(org.id)
    
    if local_id == 0 and local_id_consulta != 0:
        local_id = local_id_consulta
    
    if saldo_atual < 0:
        zerar_estoque_negativo(produto_id, local_id, data_formatada, saldo_atual)
        
    valor_total = quantidade * custo_unitario
        
    payload = {
        "call": "IncluirAjusteEstoque",
        "app_key": org.omie_app_key,
        "app_secret": org.omie_app_secret,
        "param": [{
            "id_prod": produto_id,
            "data": data_formatada,
            "qtde": quantidade,
            "valor": valor_total,
            "motivo": "Entrada de Producao - Desossa",
            "codigo_local_estoque": local_id
        }]
    }
    
    try:
        res = requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=30).json()
        if "faultstring" in res:
            return False, res["faultstring"]
        return True, "Entrada registrada com sucesso"
    except Exception as e:
        return False, str(e)
