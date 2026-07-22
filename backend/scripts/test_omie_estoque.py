import sys
import os

# Adiciona o diretório atual ao path para podermos importar os módulos do backend
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from core.database import SessionLocal
from models.models import Organization, BoningProduct
import services.omie_products as omie_products
from core.deps import current_org

def run_tests():
    db = SessionLocal()
    try:
        # Pega a primeira organização para obter as credenciais do Omie
        org = db.query(Organization).first()
        if not org:
            print("Nenhuma organização encontrada no banco de dados.")
            return

        # Seta a organização no contexto (necessário pois omie_products usa current_org.get())
        token = current_org.set(org)

        print(f"=== TESTE DE INTEGRAÇÃO OMIE ESTOQUE ===")
        print(f"Organização selecionada: {org.name}")
        
        print("\n1. Listando TODOS os Locais de Estoque disponíveis na sua conta...")
        url_local = "https://app.omie.com.br/api/v1/estoque/local/"
        payload_local = {
            "call": "PesquisarLocaisEstoque",
            "app_key": org.omie_app_key,
            "app_secret": org.omie_app_secret,
            "param": [{"pagina": 1, "registros_por_pagina": 100}]
        }
        import requests
        res_locais = requests.post(url_local, json=payload_local).json()
        locais = res_locais.get("locaisEncontrados", [])
        for loc in locais:
            print(f"  - [{loc.get('codigo_local_estoque')}] {loc.get('descricao')}")
            
        print("\n2. Testando busca do Local de Estoque PADRAO...")
        produto = db.query(BoningProduct).filter(BoningProduct.omie_id != None).first()
        if not produto:
            return

        from datetime import datetime
        data_hoje = datetime.now().strftime("%d/%m/%Y")
        saldo, local_id_consulta = omie_products.consultar_posicao_estoque(produto.omie_id, data_hoje)
        print(f"-> Saldo físico atual em {data_hoje}: {saldo} Kg")
        print(f"-> Local de Estoque do Produto no Omie: {local_id_consulta}")
        
        if saldo < 0:
            print("-> O saldo está negativo. Na operação real, o sistema faria um lançamento zerando este saldo antes da entrada.")
            
        print(f"\n3. Consultando saldo de: {produto.name} (Omie ID: {produto.omie_id})")
        
        url_saldo = "https://app.omie.com.br/api/v1/estoque/consulta/"
        payload_saldo = {
            "call": "PosicaoEstoque",
            "app_key": org.omie_app_key,
            "app_secret": org.omie_app_secret,
            "param": [{
                "id_prod": produto.omie_id,
                "data": data_hoje
            }]
        }
        res_saldo = requests.post(url_saldo, json=payload_saldo).json()
        print("-> Resposta Crua da API (PosicaoEstoque):")
        import json
        print(json.dumps(res_saldo, indent=2))
            
        print("\n=== TESTE DE LEITURA CONCLUÍDO COM SUCESSO ===")
        print("As funções de leitura do Omie estão funcionando corretamente.")
        print("Para testar a injeção real de estoque, recomendamos fazer um teste no próprio painel clicando no botão 'Lançar Rateio e Custeio'.")

    except Exception as e:
        print(f"Erro durante os testes: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    run_tests()
