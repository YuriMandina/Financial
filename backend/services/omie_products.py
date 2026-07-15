import requests
from deps import current_org

def listar_familias():
    url = "https://app.omie.com.br/api/v1/geral/familias/"
    payload = {
        "call": "PesquisarFamilias",
        "app_key": current_org.get().omie_app_key,
        "app_secret": current_org.get().omie_app_secret,
        "param": [{"pagina": 1, "registros_por_pagina": 1000}]
    }
    
    try:
        res = requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=30).json()
        if "faultstring" in res:
            return []
        
        familias = []
        for fam in res.get("famCadastro", []):
            familias.append({
                "codigo": fam.get("codigo"),
                "nome": fam.get("nomeFamilia")
            })
        return familias
    except Exception as e:
        print(f"Erro ao listar famílias: {e}")
        return []

def listar_produtos_por_familia(codigo_familia):
    url = "https://app.omie.com.br/api/v1/geral/produtos/"
    pagina_atual, total_paginas = 1, 1
    produtos = []

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
                    "inativo": "N"
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
                # O omie chama de codigo_familia
                if str(prod.get("codigo_familia", "")) == str(codigo_familia):
                    # Recupera o custo médio contábil ou comercial atual, e o valor unitário
                    custo = 0.0
                    if "dados_custos" in prod:
                        custo = prod["dados_custos"].get("valor_custo_medio_contabil", 0.0)
                    
                    produtos.append({
                        "produto_id": prod.get("codigo_produto"),
                        "codigo": prod.get("codigo"),
                        "descricao": prod.get("descricao"),
                        "valor_venda": prod.get("valor_unitario", 0.0),
                        "custo_atual": custo,
                    })

        except Exception as e:
            print(f"Erro no ListarProdutos: {e}")
            break

        pagina_atual += 1

    return produtos

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
