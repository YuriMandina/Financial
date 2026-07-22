import React from 'react';
import { Settings as SettingsIcon, LogOut, Download, Plus, Search, CalendarDays, Users } from 'lucide-react';

export default function Topbar({ menuAtivo, setMenuAtivo, userName, handleLogout }) {
  return (
<header className="h-20 shrink-0 bg-slate-900/95 border-b border-slate-800 flex items-center justify-end px-8 z-50 sticky top-0 print:hidden">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setMenuAtivo('configuracoes')}
              className={`p-2 rounded-xl transition-all ${menuAtivo === 'configuracoes' ? 'bg-indigo-600/20 text-indigo-400' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
              title="Configurações"
            >
              <SettingsIcon size={20} />
            </button>
            <button
              onClick={handleLogout}
              className="p-2 rounded-xl text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition-all"
              title="Sair da Conta"
            >
              <LogOut size={20} />
            </button>
            <div className="flex items-center gap-3 bg-slate-900 px-4 py-2 rounded-xl border border-slate-800 shadow-inner">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                <Users size={16} className="text-indigo-400" />
              </div>
              <p className="text-sm font-medium text-slate-200 hidden md:block">{userName || 'Carregando...'}</p>
            </div>
          </div>
        </header>
  );
}
