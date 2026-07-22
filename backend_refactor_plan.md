# Plano de Refatoração do Backend (Desmembramento do main.py)

O arquivo `main.py` do backend atualmente possui mais de 1600 linhas. Ele atua como um "God File", concentrando integrações com a API da Omie, lógica de cache no banco de dados e as definições de rotas (`@app.get` etc.).

Para tornar a arquitetura do backend "bem profissional, bem categorizada e classificada", vamos modularizar essas responsabilidades para dentro dos diretórios que já existem (`api/`, `services/`, e `core/`).

## ⚠️ User Review Required
> [!IMPORTANT]
> A refatoração envolverá o deslocamento de rotas e lógicas de negócio. Embora a lógica não seja alterada, as importações serão modificadas. Preciso da sua aprovação para prosseguir com essa reestruturação.

## Proposed Changes

Separaremos as funções por domínio.

---

### 1. `core/` (Lógica central e utilitários)
#### [NEW] `core/cache.py`
- Moveremos as funções genéricas de persistência/cache no banco de dados local:
  - `obter_global_db()`
  - `obter_fatiado_db()`

---

### 2. `services/` (Integrações com Omie e Lógica de Negócio)
Atualmente existem muitos métodos iniciados com `_omie_extrair...` e `extrair...` no `main.py`. Vamos agrupá-los:

#### [NEW] `services/omie_financeiro.py`
- Requisições Omie relacionadas a finanças:
  - `_omie_extrair_contas_pagar_abertas` / `extrair_contas_pagar_abertas`
  - `_omie_extrair_contas_receber_abertas` / `extrair_contas_receber_abertas`
  - `_omie_extrair_movimentos_pagos_periodo` / `extrair_movimentos_pagos_periodo`
  - `_omie_extrair_dre_pagar_emissao` / `extrair_dre_pagar`
  - `_omie_extrair_dre_receber_emissao` / `extrair_dre_receber`

#### [NEW] `services/omie_dicionarios.py`
- Extrações estáticas/dicionários Omie:
  - `extrair_dicionario_fornecedores`
  - `extrair_dicionario_categorias`
  - `extrair_dicionario_contas_correntes`

#### [NEW] `services/omie_vendas.py`
- Operações de faturamento/vendas Omie:
  - `_omie_extrair_movimento_vendas`
  - `_omie_extrair_dicionario_cmc_e_familia_produtos`

---

### 3. `api/` (Endpoints do FastAPI)
Os endpoints serão separados em "routers" específicos e incluídos de forma limpa no `main.py`.

#### [NEW] `api/relatorios.py`
- `GET /api/relatorios/curva-abc/dados`
- `GET /api/relatorios/contas-a-pagar/dados`
- `GET /api/relatorios/contas-pagas/dados`
- `GET /api/relatorios/dre/dados`
- `GET /api/geral/bancos`
- `GET /api/debug/campos-produto`

#### [NEW] `api/recebimentos.py`
- `GET /api/relatorios/recebimentos/dados`
- `POST /api/relatorios/recebimentos/baixar`
- Rotas de **Recibos**:
  - `POST /api/recibos`
  - `GET /api/recibos`
  - `DELETE /api/recibos/{id}`
  - `POST /api/recibos/{id}/desfazer`

#### [NEW] `api/snapshots.py`
- `GET /api/snapshots`
- `DELETE /api/snapshots/{snap_id}`

---

### 4. `main.py` (Entrypoint)
#### [MODIFY] `main.py`
- Ficará enxuto, contendo apenas a inicialização do app (`app = FastAPI()`), configurações de CORS e inclusão das rotas (`app.include_router(relatorios.router)`, etc.).

## Verification Plan

### Manual Verification
- O servidor rodando em `uvicorn main:app --reload` não poderá quebrar.
- Ao final, as rotas do frontend que consomem o backend continuarão funcionando exatamente como antes, pois os caminhos (`/api/relatorios/...`) não serão alterados, apenas redirecionados internamente.

---
**Checklist de Execução Sugerido:**
- [ ] 1. Criar `core/cache.py` e extrair lógica de cache global
- [ ] 2. Criar `services/omie_financeiro.py`, `omie_dicionarios.py` e `omie_vendas.py`
- [ ] 3. Criar routers `api/relatorios.py`, `api/recebimentos.py` e `api/snapshots.py`
- [ ] 4. Limpar o `main.py` e incluir as rotas
- [ ] 5. Validar a inicialização do backend e corrigir eventuais erros de importação (Circular Imports)
