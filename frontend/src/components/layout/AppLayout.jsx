import React, { useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useAuth } from '../../context/AuthContext';
import { useTaskSync } from '../../context/TaskSyncContext';
import { MENU_PATHS, REPORT_MENUS, DEFAULT_PATH, menuFromPath } from '../../routes';

import { Settings } from '../../views/Settings/Settings';
import RateioECusteio from '../../views/RateioCusteio/RateioCusteioView';
import { DreGerencial } from '../../views/DreGerencial/DreGerencialView';
import FinancialReportsView from '../../views/Relatorios/FinancialReportsView';
import RHEscalasView from '../../views/RH/RHEscalasView';
import EstoqueView from '../../views/Estoque/EstoqueView';

// --- [BLOCO: Rota dos Relatórios Financeiros] ---
// Uma única rota para todos os relatórios: a view permanece montada ao alternar entre eles
// (mantém o período selecionado, como antes do roteamento).
function ReportsRoute() {
  const { pagina } = useParams();
  const menuAtivo = menuFromPath(`/${pagina}`);
  if (!REPORT_MENUS.includes(menuAtivo)) return <Navigate to={DEFAULT_PATH} replace />;
  return <FinancialReportsView menuAtivo={menuAtivo} />;
}

export default function AppLayout() {
  // --- [BLOCO: Estado de Navegação e Layout Base] ---
  const location = useLocation();
  const navigate = useNavigate();
  const menuAtivo = menuFromPath(location.pathname) || 'dashboard';

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('financial_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const { token, userName, handleLogout } = useAuth();
  const { handleGlobalTaskStart, globalRefreshCounter } = useTaskSync();

  const handleToggleSidebar = (val) => {
    setSidebarCollapsed(val);
    try {
      localStorage.setItem('financial_sidebar_collapsed', String(val));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex h-screen bg-slate-950 font-sans overflow-hidden print:!block print:bg-white print:text-slate-900 print:!h-auto print:!overflow-visible">
      {/* Barra Lateral de Navegação */}
      <Sidebar
        menuAtivo={menuAtivo}
        collapsed={sidebarCollapsed}
        setCollapsed={handleToggleSidebar}
      />

      {/* Área de Conteúdo Principal */}
      <main className="flex-1 flex flex-col relative overflow-y-auto overflow-x-hidden bg-slate-950 print:!block print:!h-auto print:!overflow-visible">

        {/* Barra Superior */}
        <Topbar
          menuAtivo={menuAtivo}
          userName={userName}
          handleLogout={handleLogout}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => handleToggleSidebar(!sidebarCollapsed)}
        />

        {/* --- [BLOCO: Rotas das Vistas] --- */}
        <Routes>
          <Route index element={<Navigate to={DEFAULT_PATH} replace />} />
          <Route path={`${MENU_PATHS.configuracoes}/:aba?`} element={<Settings token={token} />} />
          <Route
            path={`${MENU_PATHS.desossa}/:aba?`}
            element={
              <RateioECusteio
                token={token}
                onTaskStart={handleGlobalTaskStart}
                refreshCounter={globalRefreshCounter}
              />
            }
          />
          <Route
            path={MENU_PATHS['dre-gerencial']}
            element={
              <DreGerencial
                token={token}
                onTaskStart={handleGlobalTaskStart}
                refreshCounter={globalRefreshCounter}
              />
            }
          />
          <Route
            path={`${MENU_PATHS.estoque}/*`}
            element={
              <EstoqueView
                token={token}
                onTaskStart={handleGlobalTaskStart}
                refreshCounter={globalRefreshCounter}
              />
            }
          />
          <Route
            path={`${MENU_PATHS['rh-escalas']}/:aba?`}
            element={
              <RHEscalasView
                token={token}
                onOpenCompanySettings={() => navigate(`${MENU_PATHS.configuracoes}/empresa`)}
              />
            }
          />
          <Route path="/:pagina" element={<ReportsRoute />} />
          <Route path="*" element={<Navigate to={DEFAULT_PATH} replace />} />
        </Routes>
      </main>
    </div>
  );
}
