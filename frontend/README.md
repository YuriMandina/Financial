# Financial - Inteligência Financeira

Projeto Front-end em React + Vite.

## Arquitetura Modular

O projeto segue um padrão modular focado em coesão e responsabilidade, para facilitar a manutenção sem causar super-fragmentação:

- **`src/App.jsx`**: Arquivo raiz contendo roteamento, gerenciamento global de estado e requisições HTTP (`fetchWithAuth`). Atua como "Controller" principal da aplicação.
- **`src/components/common`**: Componentes reutilizáveis em múltiplas telas (ex: `CartaoCliente.jsx`).
- **`src/views/`**: Componentes de visualização agrupados por domínio de negócio:
  - `Dashboard/DashboardView.jsx`: Tela principal de indicadores financeiros.
  - `Contas/ContasView.jsx`: Tabela genérica compartilhada para Contas a Pagar, Contas Pagas e Recebimentos (Convênios).
  - `CurvaABC/CurvaABCView.jsx`: Tela complexa de relatório Curva ABC e Lucratividade.
- **`src/utils/`**: Funções puras utilitárias (ex: `formatters.js` para manipulação de data/moeda).

## Execução Local

```bash
npm install
npm run dev
```

## Diretrizes de Contribuição

Seguimos a diretriz "No Yapping" do projeto. Novos componentes de tela devem ser isolados em `src/views`, utilizando `props` para consumir estados globais oriundos do `App.jsx`, a fim de evitar loops de re-renderização não previstos. Componentes pequenos que são úteis apenas para uma tela específica devem ser mantidos junto ao arquivo principal da view.
