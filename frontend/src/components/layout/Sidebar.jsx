import React from 'react';
import { TrendingUp, LayoutDashboard, FileText, Database, CreditCard, Target, PieChart } from 'lucide-react';

const SidebarItem = ({ id, icone: Icon, texto, menuAtivo, setMenuAtivo, setContasBrutas, setSelecionados, setClienteFiltro, setContaFiltro, setPaginaAtual }) => (
    <button onClick={() => { setMenuAtivo(id); setContasBrutas([]); setSelecionados([]); setClienteFiltro(''); setContaFiltro('TODAS'); setPaginaAtual(1); }}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 print:hidden ${menuAtivo === id ? 'bg-gradient-to-r from-indigo-500/20 to-purple-500/20 text-indigo-400 border border-indigo-500/30 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]' : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
        }`}>
      <Icon size={20} className={menuAtivo === id ? 'text-indigo-400' : ''} />
      <span className="font-medium text-left text-sm">{texto}</span>
    </button>
  );

export default function Sidebar({ menuAtivo, setMenuAtivo, setContasBrutas, setSelecionados, setClienteFiltro, setContaFiltro, setPaginaAtual }) {


  return (
<aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col z-20 print:hidden">
        <div className="h-20 shrink-0 flex items-center px-6 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <TrendingUp size={18} className="text-white" />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">Financial</h1>
          </div>
        </div>
        <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
          <p className="px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Relatórios</p>
          <SidebarItem menuAtivo={menuAtivo} setMenuAtivo={setMenuAtivo} setContasBrutas={setContasBrutas} setSelecionados={setSelecionados} setClienteFiltro={setClienteFiltro} setContaFiltro={setContaFiltro} setPaginaAtual={setPaginaAtual} id="dashboard" icone={LayoutDashboard} texto="Visão Geral" />
          <SidebarItem menuAtivo={menuAtivo} setMenuAtivo={setMenuAtivo} setContasBrutas={setContasBrutas} setSelecionados={setSelecionados} setClienteFiltro={setClienteFiltro} setContaFiltro={setContaFiltro} setPaginaAtual={setPaginaAtual} id="contas-pagar" icone={FileText} texto="Contas a Pagar (Previsão)" />
          <SidebarItem menuAtivo={menuAtivo} setMenuAtivo={setMenuAtivo} setContasBrutas={setContasBrutas} setSelecionados={setSelecionados} setClienteFiltro={setClienteFiltro} setContaFiltro={setContaFiltro} setPaginaAtual={setPaginaAtual} id="contas-pagas" icone={Database} texto="Contas Pagas (Realizado)" />
          <SidebarItem menuAtivo={menuAtivo} setMenuAtivo={setMenuAtivo} setContasBrutas={setContasBrutas} setSelecionados={setSelecionados} setClienteFiltro={setClienteFiltro} setContaFiltro={setContaFiltro} setPaginaAtual={setPaginaAtual} id="recebimentos" icone={CreditCard} texto="Contas a Receber (Convênio)" />
          <SidebarItem menuAtivo={menuAtivo} setMenuAtivo={setMenuAtivo} setContasBrutas={setContasBrutas} setSelecionados={setSelecionados} setClienteFiltro={setClienteFiltro} setContaFiltro={setContaFiltro} setPaginaAtual={setPaginaAtual} id="curva-abc" icone={TrendingUp} texto="Curva ABC e Lucratividade" />
          <SidebarItem menuAtivo={menuAtivo} setMenuAtivo={setMenuAtivo} setContasBrutas={setContasBrutas} setSelecionados={setSelecionados} setClienteFiltro={setClienteFiltro} setContaFiltro={setContaFiltro} setPaginaAtual={setPaginaAtual} id="dre-gerencial" icone={Target} texto="DRE Gerencial" />
          <SidebarItem menuAtivo={menuAtivo} setMenuAtivo={setMenuAtivo} setContasBrutas={setContasBrutas} setSelecionados={setSelecionados} setClienteFiltro={setClienteFiltro} setContaFiltro={setContaFiltro} setPaginaAtual={setPaginaAtual} id="desossa" icone={PieChart} texto="Rateio e Custeio" />
        </nav>
      </aside>
  );
}
