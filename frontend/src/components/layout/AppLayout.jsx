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
      <main className="flex-1 flex flex-col relative overflow-y-auto overflow-x-hidden print:!block print:!h-auto print:!overflow-visible">
        {/* Glow Effects Decorativos */}
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-indigo-500/10 rounded-full blur-[100px] transform-gpu pointer-events-none z-0 print:hidden" />
        <div className="absolute bottom-[-10%] right-[-5%] w-96 h-96 bg-purple-500/10 rounded-full blur-[100px] transform-gpu pointer-events-none z-0 print:hidden" />

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
