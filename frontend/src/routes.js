import { useCallback } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';

// --- [BLOCO: Mapa de Rotas do Sistema] ---
// id interno do menu -> caminho base na URL
export const MENU_PATHS = {
  dashboard: '/dashboard',
  'contas-pagar': '/contas-a-pagar',
  'contas-pagas': '/contas-pagas',
  recebimentos: '/contas-a-receber',
  'contas-recebidas': '/contas-recebidas',
  'curva-abc': '/curva-abc',
  'dre-gerencial': '/dre-gerencial',
  desossa: '/rateio-custeio',
  estoque: '/inventario',
  'rh-escalas': '/departamento-pessoal',
  configuracoes: '/configuracoes',
};

// Menus atendidos pela FinancialReportsView (rota única /:pagina)
export const REPORT_MENUS = ['dashboard', 'contas-pagar', 'contas-pagas', 'recebimentos', 'contas-recebidas', 'curva-abc'];

export const DEFAULT_PATH = MENU_PATHS.dashboard;

export function menuFromPath(pathname) {
  const base = `/${(pathname.split('/')[1] || '')}`;
  return Object.keys(MENU_PATHS).find((id) => MENU_PATHS[id] === base) || null;
}

// --- [BLOCO: Aba Ativa Sincronizada com a URL] ---
// Lê a aba do parâmetro `:aba` da rota e navega ao trocar, preservando a query string.
// `slugs` permite expor na URL um nome diferente do id interno ({ id: 'slug' }).
const NO_SLUGS = {};

export function useRouteTab(basePath, tabIds, defaultTab, slugs = NO_SLUGS) {
  const { aba } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const fromSlug = Object.keys(slugs).find((id) => slugs[id] === aba);
  const candidate = fromSlug || aba;
  const activeTab = candidate && tabIds.includes(candidate) ? candidate : defaultTab;

  const setTab = useCallback((id, { replace = false } = {}) => {
    navigate({ pathname: `${basePath}/${slugs[id] || id}`, search: location.search }, { replace });
  }, [navigate, basePath, slugs, location.search]);

  return [activeTab, setTab];
}
