import React, { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useAuth } from '../../context/AuthContext';
import { useTaskSync } from '../../context/TaskSyncContext';

import { Settings } from '../../views/Settings/Settings';
import RateioECusteio from '../../views/RateioCusteio/RateioCusteioView';
import { DreGerencial } from '../../views/DreGerencial/DreGerencialView';
import FinancialReportsView from '../../views/Relatorios/FinancialReportsView';
import RHEscalasView from '../../views/RH/RHEscalasView';
import EstoqueView from '../../views/Estoque/EstoqueView';

export default function AppLayout() {
  // --- [BLOCO: Estado de Navegação e Layout Base] ---
  const [menuAtivo, setMenuAtivo] = useState('dashboard');
  const [settingsTab, setSettingsTab] = useState(null); // aba inicial ao abrir Configurações por atalho
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

  // --- [BLOCO: Renderização Condicional de Vistas] ---
  const renderCurrentView = () => {
    switch (menuAtivo) {
      case 'configuracoes':
        return <Settings token={token} initialTab={settingsTab} />;
      case 'desossa':
        return (
          <RateioECusteio
            token={token}
            onTaskStart={handleGlobalTaskStart}
            refreshCounter={globalRefreshCounter}
          />
        );
      case 'dre-gerencial':
        return (
          <DreGerencial
            token={token}
            onTaskStart={handleGlobalTaskStart}
            refreshCounter={globalRefreshCounter}
          />
        );
      case 'estoque':
        return (
          <EstoqueView
            token={token}
            onTaskStart={handleGlobalTaskStart}
            refreshCounter={globalRefreshCounter}
          />
        );
      case 'rh-escalas':
        return (
          <RHEscalasView
            token={token}
            onOpenCompanySettings={() => {
              setSettingsTab('company');
              setMenuAtivo('configuracoes');
            }}
          />
        );
      default:
        return (
          <FinancialReportsView
            menuAtivo={menuAtivo}
            onMenuChange={setMenuAtivo}
          />
        );
    }
  };

  return (
    <div className="flex h-screen bg-slate-950 font-sans overflow-hidden print:!block print:bg-white print:text-slate-900 print:!h-auto print:!overflow-visible">
      {/* Barra Lateral de Navegação */}
      <Sidebar
        menuAtivo={menuAtivo}
        collapsed={sidebarCollapsed}
        setCollapsed={handleToggleSidebar}
        setMenuAtivo={(id) => {
          setSettingsTab(null);
          setMenuAtivo(id);
        }}
      />

      {/* Área de Conteúdo Principal */}
      <main className="flex-1 flex flex-col relative overflow-y-auto overflow-x-hidden bg-slate-950 print:!block print:!h-auto print:!overflow-visible">

        {/* Barra Superior */}
        <Topbar
          menuAtivo={menuAtivo}
          setMenuAtivo={setMenuAtivo}
          userName={userName}
          handleLogout={handleLogout}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => handleToggleSidebar(!sidebarCollapsed)}
        />

        {/* View Ativa */}
        {renderCurrentView()}
      </main>
    </div>
  );
}
