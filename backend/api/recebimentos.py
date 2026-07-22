from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import traceback
import time
import requests
import pandas as pd
import models.models as models
from core.database import SessionLocal
from core.deps import current_org, get_current_user_and_set_org
from core.utils import tratar_vazio
from services.omie_dicionarios import (
    extrair_dicionario_contas_correntes, 
    extrair_dicionario_fornecedores, 
    extrair_dicionario_categorias
)
from services.omie_financeiro import extrair_contas_receber_abertas

router = APIRouter()

class PagamentoItem(BaseModel):
    codigo_lancamento: int
    valor: float
    desconto: float = 0.0
    juros: float = 0.0

class BaixaLoteRequest(BaseModel):
    id_conta_corrente: int
    data_pagamento: str
    pagamentos: list[PagamentoItem]

class RecebimentoReciboCreate(BaseModel):
    cliente: str
    banco: str | None
    data_pagamento: str
    totalOriginal: float
    totalDesconto: float
    totalJuros: float
    totalPago: float
    notas: list

@router.get("/api/relatorios/recebimentos/dados")
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

@router.post("/api/relatorios/recebimentos/baixar")
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

@router.post("/api/recibos")
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

@router.get("/api/recibos")
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

@router.delete("/api/recibos/{id}")
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

@router.post("/api/recibos/{id}/desfazer")
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
