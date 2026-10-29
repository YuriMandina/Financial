import React from 'react';
import { Settings as SettingsIcon, LogOut, Users, PanelLeftOpen, PanelLeftClose } from 'lucide-react';

export default function Topbar({ menuAtivo, setMenuAtivo, userName, handleLogout, sidebarCollapsed, onToggleSidebar }) {
  return (
    <header className="h-16 shrink-0 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4 sm:px-6 z-40 sticky top-0 print:hidden">
      {/* Botão de Toggle da Sidebar na Topbar */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          title={sidebarCollapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={18} className="text-indigo-400" /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button 
          onClick={() => setMenuAtivo('configuracoes')}
          className={`p-2 rounded-lg transition-colors ${
            menuAtivo === 'configuracoes' 
              ? 'bg-slate-800 text-indigo-400 border border-slate-700/60' 
              : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
          }`}
          title="Configurações"
        >
          <SettingsIcon size={18} />
        </button>

        <button
          onClick={handleLogout}
          className="p-2 rounded-lg text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-colors"
          title="Sair da Conta"
        >
          <LogOut size={18} />
        </button>

        <div className="h-5 w-px bg-slate-800 mx-1" />

        <div className="flex items-center gap-2.5 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700/60">
          <div className="w-6 h-6 rounded-md bg-indigo-600/30 text-indigo-400 flex items-center justify-center">
            <Users size={14} />
          </div>
          <span className="text-xs font-semibold text-slate-200 hidden md:inline">
            {userName || 'Usuário'}
          </span>
        </div>
      </div>
    </header>
  );
}
