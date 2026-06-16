# ROADMAP DE DESENVOLVIMENTO: MOTOR DE PRECIFICAÇÃO DINÂMICA (FINANCIAL)

## 📌 Diretrizes Globais do Sistema (System Instructions)

1. **Stack Tecnológica Rigorosa:**
   - **Backend:** Python, FastAPI, Uvicorn, Pandas, Requests, python-dotenv, fpdf2.
   - **Frontend:** React, TailwindCSS, Lucide-React.
2. **Prevenção Absoluta de Alucinações (Omie API):**
   - Antes de implementar *qualquer* função que envolva a API do Omie, você **DEVE OBRIGATORIAMENTE** buscar a documentação oficial.
   - Utilize a internet ou suas ferramentas de navegação para consultar: `https://developer.omie.com.br/`.
   - Verifique especificamente as *calls*, parâmetros obrigatórios e estrutura de retorno para as APIs de: `Finanças (Contas a Pagar/Receber)`, `Movimentos Financeiros (Resumo de Faturamento)` e `Geral (Produtos/AlterarProduto) e Categorias`.
3. **Padrão de Código Backend (`main.py`):**
   - Mantenha o sistema de cache em memória atual (`API_CACHE`) para novas rotas.
   - Utilize a função `safe_float()` já existente para garantir blindagem matemática em todos os cálculos do DRE e de rateio.
   - Defina os schemas de entrada/saída utilizando `Pydantic` (`BaseModel`).
4. **Padrão de Código Frontend (`App.jsx`):**
   - Mantenha a identidade visual (Dark mode slate-900, gradients indigo/purple).
   - Separe a nova tela de precificação em um componente visual limpo, com estado local controlado, e conecte-o à *Sidebar* principal.

---

## 🚀 FASE 1: Backend - Inteligência do DRE Detalhado (Média 12 Meses)

**Objetivo:** Extrair a média real de despesas e faturamento do último ano, com detalhamento obrigatório por categoria para permitir auditoria.

**Ação:**
1. Consulte a doc oficial do Omie para métodos que retornam totais financeiros de contas pagas e faturamento.
2. Crie a rota `GET /api/precificacao/dre-12-meses` no FastAPI.
3. **Regras de Negócio OBRIGATÓRIAS (Auditoria):**
   - Calcule a data D-365 até D-0.
   - Extraia os movimentos pagos e cruze com `extrair_dicionario_categorias()` que já existe no `main.py`.
   - Agrupe os dados via `pandas` pelo nome da Categoria.
   - Classifique as categorias em "Variáveis" (Ex: Impostos, Taxas de Cartão, Comissões) e "Fixas" (Aluguel, Folha, Energia, etc.). *Nota: crie um dicionário ou lista de palavras-chave no código para essa classificação inicial, permitindo fácil manutenção.*
   - **O Retorno JSON deve ter a seguinte estrutura estrita:**
     ```json
     {
       "faturamento_bruto_12m": 0.00,
       "resumo": {
         "total_fixo": 0.00,
         "perc_fixo": 0.00,
         "total_variavel": 0.00,
         "perc_variavel": 0.00
       },
       "auditoria": {
         "despesas_fixas": [
           {"categoria": "Aluguel", "valor_12m": 0.00, "media_mensal": 0.00, "representatividade_perc": 0.00}
         ],
         "despesas_variaveis": [
           {"categoria": "Taxa de Cartão", "valor_12m": 0.00, "media_mensal": 0.00, "representatividade_perc": 0.00}
         ]
       }
     }
     ```

---

## 🚀 FASE 2: Backend - Motor de Rateio e Markup

**Objetivo:** Processar o rateio do Custo da Mercadoria Vendida (CMV) por valor de venda e calcular o Preço Ideal.

**Ação:**
1. Crie os modelos Pydantic: `CorteInput` (nome, peso_kg, preco_praticado) e `LoteInput` (custo_total_carcaca, peso_carcaca, perc_variavel, perc_fixo, perc_lucro, cortes: List[CorteInput]).
2. Crie a rota `POST /api/precificacao/calcular-rateio`.
3. **Matemática do Rateio:**
   - `receita_projetada_corte` = `peso_kg` * `preco_praticado`
   - `%_representatividade` = `receita_projetada_corte` / `receita_total_projetada_lote`
   - `cmv_rateado_total_corte` = `custo_total_carcaca` * `%_representatividade`
   - `cmv_unitario_kg` = `cmv_rateado_total_corte` / `peso_kg` (tratar divisão por zero com fallback para 0)
4. **Matemática do Markup Divisor:**
   - `divisor` = 1 - ((`perc_variavel` + `perc_fixo` + `perc_lucro`) / 100)
   - `preco_ideal_kg` = `cmv_unitario_kg` / `divisor`
   - `margem_contribuicao_r$` = `preco_praticado` - `cmv_unitario_kg` - (`preco_praticado` * (`perc_variavel` / 100))
5. Retorne a lista processada e os totalizadores do lote.

---

## 🚀 FASE 3: Frontend - Tela "Precificação de Lotes" com Painel de Auditoria

**Objetivo:** Criar a interface visual para o usuário interagir com o novo motor financeiro e auditar os dados do ERP.

**Ação:**
1. Adicione um novo item na Sidebar do `App.jsx`: `<SidebarItem id="precificacao-lotes" icone={Target} texto="Motor de Precificação" />`.
2. Desenvolva a renderização para quando `menuAtivo === 'precificacao-lotes'`.
3. **Componentes da Tela:**
   - **Painel de DRE Global:** Campos para Input de % Custos Variáveis, % Custos Fixos e % Lucro Alvo.
   - **Botão Inteligente:** "Sincronizar Histórico Omie (12m)" que consome a API da FASE 1 e preenche o painel de DRE.
   - **Modal/Accordion de Auditoria:** Ao lado dos inputs de DRE, adicione um botão "Ver Detalhamento (Auditoria)". Ao clicar, exiba uma tabela limpa consumindo o nó `auditoria` do JSON retornado na Fase 1. Mostre as colunas: Categoria, Média Mensal e % sobre a Receita, permitindo que o usuário identifique distorções de lançamento no ERP.
   - **Gerenciador da Carcaça:** Campos globais para inserir Peso Total e Valor Pago na carcaça.
   - **Tabela de Desossa:** Formulário iterativo (adicionar/remover linhas) para cadastrar os cortes desossados (Nome, Peso, Preço de Venda Praticado).
   - **Indicadores de Ação:** Ao enviar os dados para a API da FASE 2, atualize a tabela mostrando o **CMV Unitário (Rateado)**, a **Margem de Contribuição** e o **Preço Ideal Sugerido**. Use badges de cor (Verde, Amarelo, Vermelho).

---

## 🚀 FASE 4: Integração Reversa (Sincronização de Preços no Omie)

**Objetivo:** Enviar o preço corrigido e o CMV correto de volta ao cadastro do produto no ERP.

**Ação:**
1. **CONSULTA OBRIGATÓRIA:** Consulte a API do Omie na rota `Geral / Produtos` para a call `AlterarProduto`. Verifique exatamente qual tag atualiza o preço de venda e o custo médio (CMV) do cadastro.
2. Crie a rota `POST /api/precificacao/sincronizar-omie` no `main.py`.
3. Receba um payload contendo uma lista de dicionários com `codigo_produto_omie`, `novo_preco_ideal` e `novo_cmv_rateado`.
4. Faça as requisições para o Omie atualizando o cadastro para refletir a nova matriz de precificação. Adicione `time.sleep(0.3)` entre requisições para respeitar o rate limit.
5. Adicione um botão "Atualizar Preços no ERP" na tela construída na Fase 3 que aciona esta rota.