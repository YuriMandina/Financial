from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import traceback
import time
import requests
import json
import pandas as pd
from datetime import datetime

import models.models as models
from core.database import SessionLocal
from core.deps import current_org, get_current_user_and_set_org
from core.utils import tratar_vazio
from api.tasks import TaskManager, TaskQueue
from services.omie_dicionarios import (
    extrair_dicionario_contas_correntes, 
    extrair_dicionario_fornecedores, 
    extrair_dicionario_categorias
)
from services.omie_financeiro import (
    extrair_contas_pagar_abertas,
    extrair_movimentos_pagos_periodo,
    extrair_dre_pagar,
    extrair_dre_receber
)
from services.omie_vendas import (
    extrair_movimento_vendas,
    extrair_dicionario_cmc_e_familia_produtos
)

router = APIRouter()

class SyncRequest(BaseModel):
    data_inicio: str = None
    data_fim: str = None

def bg_sync_relatorio(task_id: str, module: str, data_inicio: str, data_fim: str, org_id: int):
    try:
        TaskManager.update_task(task_id, progress=5.0, log=f"Iniciando sincronização de {module}...")
        
        if module == "contas-a-pagar":
            extrair_contas_pagar_abertas(data_inicio, data_fim, task_id=task_id, force_sync=False)
        elif module == "contas-pagas":
            extrair_movimentos_pagos_periodo(data_inicio, data_fim, task_id=task_id, force_sync=False)
        elif module == "curva-abc":
            extrair_movimento_vendas(data_inicio, data_fim, task_id=task_id, force_sync=False)
        elif module == "dre":
            TaskManager.update_task(task_id, log="Extraindo DRE a Pagar...")
            extrair_dre_pagar(data_inicio, data_fim, task_id=task_id, force_sync=False)
            TaskManager.update_task(task_id, log="Extraindo DRE a Receber...")
            extrair_dre_receber(data_inicio, data_fim, task_id=task_id, force_sync=False)
            
        TaskManager.update_task(task_id, progress=100.0, log="Sincronização concluída com sucesso!", status="completed")
    except Exception as e:
        import traceback
        traceback.print_exc()
        TaskManager.update_task(task_id, log=f"Erro durante sincronização: {str(e)}", status="error")

@router.post("/api/relatorios/{module}/sync")
async def sync_module_dados(
    module: str, 
    req: SyncRequest,
    current_user: models.User = Depends(get_current_user_and_set_org)
):
    current_org.set(current_user.organization)
    valid_modules = ["contas-a-pagar", "contas-pagas", "curva-abc", "dre"]
    if module not in valid_modules:
        raise HTTPException(status_code=400, detail="Módulo inválido para sincronização.")
        
    action_id = f"sync_relatorio_{module}"
    active_id = TaskManager.get_active_task_id(action_id)
    if active_id:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=409, content={"detail": "Esta ação já está em andamento. Cancele-a antes de iniciar uma nova.", "task_id": active_id})
        
    task_id = TaskManager.create_task(action_id)
    TaskManager.update_task(task_id, progress=0.0, log="Aguardando na fila de sincronização...")
    org_id = current_org.get().id
    
    await TaskQueue.enqueue(bg_sync_relatorio, task_id, module, req.data_inicio, req.data_fim, org_id)
    return {"task_id": task_id, "message": "Sincronização iniciada na fila."}

@router.get("/api/geral/bancos")
def obter_bancos(current_user: models.User = Depends(get_current_user_and_set_org)):
    current_org.set(current_user.organization)
    dict_contas = extrair_dicionario_contas_correntes()
    bancos = [{"id": k, "nome": v} for k, v in dict_contas.items()]
    return sorted(bancos, key=lambda x: x["nome"])

@router.get("/api/debug/campos-produto")
def debug_campos_produto(current_user: models.User = Depends(get_current_user_and_set_org)):
    current_org.set(current_user.organization)
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

@router.get("/api/relatorios/curva-abc/dados")
def obter_curva_abc(data_inicio: str, data_fim: str, current_user: models.User = Depends(get_current_user_and_set_org)):
    current_org.set(current_user.organization)
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

        dict_cmc, dict_familia = extrair_dicionario_cmc_e_familia_produtos(data_fim)

        df = pd.DataFrame(itens_brutos)
        for col in ["quantidade", "total_nf", "descontos_item", "cmc_total_movimento"]:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)

        grp = (
            df.groupby("descricao_produto", as_index=False)
            .agg(
                qtd_total=("quantidade", "sum"),
                receita_total_item=("total_nf", "sum"),
                descontos_sum=("descontos_item", "sum"),
            )
        )

        grp["familia_produto"] = grp["descricao_produto"].apply(
            lambda desc: dict_familia.get(str(desc).strip().upper(), "Sem Família")
        )

        receita_global = grp["receita_total_item"].sum()

        grp["cmv_medio"] = grp["descricao_produto"].apply(
            lambda desc: dict_cmc.get(str(desc).strip().upper(), 0.0)
        ).fillna(0.0)

        grp["cmv_total"] = (grp["qtd_total"] * grp["cmv_medio"]).fillna(0.0)

        grp["media_valor_venda"] = grp.apply(
            lambda r: (r["receita_total_item"] / r["qtd_total"])
            if r["qtd_total"] != 0
            else 0.0,
            axis=1,
        ).fillna(0.0)

        grp["lucro_bruto"] = (
            grp["receita_total_item"] - grp["cmv_total"]
        ).fillna(0.0)

        grp["margem_bruta_perc"] = grp.apply(
            lambda r: (r["lucro_bruto"] / r["receita_total_item"] * 100)
            if r["receita_total_item"] != 0
            else 0.0,
            axis=1,
        ).fillna(0.0)

        grp["participacao_perc"] = grp.apply(
            lambda r: (r["receita_total_item"] / receita_global * 100)
            if receita_global != 0
            else 0.0,
            axis=1,
        ).fillna(0.0)

        grp = grp.sort_values(by="participacao_perc", ascending=False).reset_index(
            drop=True
        )

        grp["participacao_acumulada"] = grp["participacao_perc"].cumsum()
        def classificar_abc(acum):
            if acum <= 21.0:
                return "A"
            elif acum <= 51.0:
                return "B"
            else:
                return "C"
        grp["classe_abc"] = grp["participacao_acumulada"].apply(classificar_abc)

        lucro_bruto_total = float(grp["lucro_bruto"].sum())
        margem_media = (
            float(lucro_bruto_total / receita_global * 100)
            if receita_global != 0
            else 0.0
        )

        familias_unicas = sorted(grp["familia_produto"].dropna().unique().tolist())

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
                    "cmv_medio": round(float(row["cmv_medio"]), 2),
                    "cmv_total": round(float(row["cmv_total"]), 2),
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

@router.get("/api/relatorios/contas-a-pagar/dados")
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

@router.get("/api/relatorios/contas-pagas/dados")
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

        movimentos_vistos = set()

        for mov in movimentos_brutos:
            det = mov.get("detalhes", {})
            res = mov.get("resumo", {})

            status_mov = str(det.get("cStatus", "")).upper()
            if status_mov in ["CANCELADO", "EXCLUIDO", "ESTORNADO"]:
                continue

            id_mov = det.get("nCodMovCC")
            if id_mov:
                if id_mov in movimentos_vistos:
                    continue
                movimentos_vistos.add(id_mov)

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

@router.get("/api/relatorios/dre/dados")
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
