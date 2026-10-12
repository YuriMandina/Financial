import React, { useState } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useAuth } from '../../context/AuthContext';
import { useTaskSync } from '../../context/TaskSyncContext';

import { Settings } from '../../views/Settings/Settings';
import RateioECusteio from '../../views/RateioCusteio/RateioCusteioView';
import { DreGerencial } from '../../views/DreGerencial/DreGerencialView';
import FinancialReportsView from '../../views/Relatorios/FinancialReportsView';

export default function AppLayout() {
  // --- [BLOCO: Estado de Navegação e Layout Base] ---
  const [menuAtivo, setMenuAtivo] = useState('dashboard');
  const { token, userName, handleLogout } = useAuth();
  const { handleGlobalTaskStart, globalRefreshCounter } = useTaskSync();

  // --- [BLOCO: Renderização Condicional de Vistas] ---
  const renderCurrentView = () => {
    switch (menuAtivo) {
      case 'configuracoes':
        return <Settings token={token} />;
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
      <Sidebar menuAtivo={menuAtivo} setMenuAtivo={setMenuAtivo} />

      {/* Área de Conteúdo Principal */}
      <main className="flex-1 flex flex-col relative overflow-y-auto overflow-x-hidden bg-slate-950 print:!block print:!h-auto print:!overflow-visible">

        {/* Barra Superior */}
        <Topbar
          menuAtivo={menuAtivo}
          setMenuAtivo={setMenuAtivo}
          userName={userName}
          handleLogout={handleLogout}
        />

        {/* View Ativa */}
        {renderCurrentView()}
      </main>
    </div>
  );
}
