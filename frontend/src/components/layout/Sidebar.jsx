import React from 'react';
import { TrendingUp, LayoutDashboard, FileText, Database, CreditCard, Receipt, Target, PieChart, CalendarDays, Boxes } from 'lucide-react';

const SidebarItem = ({ id, icone: Icon, texto, menuAtivo, setMenuAtivo, setContasBrutas, setSelecionados, setClienteFiltro, setContaFiltro, setPaginaAtual }) => {
  const isActive = menuAtivo === id;
  return (
    <button
      onClick={() => { 
        setMenuAtivo(id); 
        setContasBrutas?.([]); 
        setSelecionados?.([]); 
        setClienteFiltro?.(''); 
        setContaFiltro?.('TODAS'); 
        setPaginaAtual?.(1); 
      }}
      className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors print:hidden ${
        isActive 
          ? 'bg-slate-800 text-white border border-slate-700/70 shadow-sm' 
          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
      }`}
    >
      <Icon size={18} className={isActive ? 'text-indigo-400' : 'text-slate-400'} />
      <span className="text-left">{texto}</span>
    </button>
  );
};

export default function Sidebar({ menuAtivo, setMenuAtivo, setContasBrutas, setSelecionados, setClienteFiltro, setContaFiltro, setPaginaAtual }) {
  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col z-20 print:hidden shrink-0">
      <div className="h-16 shrink-0 flex items-center px-5 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-sm">
            <TrendingUp size={18} />
          </div>
          <div>
            <h1 className="text-base font-bold text-white tracking-tight leading-none">Financial</h1>
            <span className="text-[10px] text-slate-400 font-medium tracking-wider uppercase">Enterprise BI</span>
          </div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <SidebarItem menuAtivo={menuAtivo} setMenuAtivo={setMenuAtivo} setContasBrutas={setContasBrutas} setSelecionados={setSelecionados} setClienteFiltro={setClienteFiltro} setContaFiltro={setContaFiltro} setPaginaAtual={setPaginaAtual} id="dashboard" icone={LayoutDashboard} texto="Visão Geral" />
        <SidebarItem menuAtivo={menuAtivo} setMenuAtivo={setMenuAtivo} setContasBrutas={setContasBrutas} setSelecionados={setSelecionados} setClienteFiltro={setClienteFiltro} setContaFiltro={setContaFiltro} setPaginaAtual={setPaginaAtual} id="contas-pagar" icone={FileText} texto="Contas a Pagar" />
        <SidebarItem menuAtivo={menuAtivo} setMenuAtivo={setMenuAtivo} setContasBrutas={setContasBrutas} setSelecionados={setSelecionados} setClienteFiltro={setClienteFiltro} setContaFiltro={setContaFiltro} setPaginaAtual={setPaginaAtual} id="contas-pagas" icone={Database} texto="Contas Pagas" />
        <SidebarItem menuAtivo={menuAtivo} setMenuAtivo={setMenuAtivo} setContasBrutas={setContasBrutas} setSelecionados={setSelecionados} setClienteFiltro={setClienteFiltro} setContaFiltro={setContaFiltro} setPaginaAtual={setPaginaAtual} id="recebimentos" icone={CreditCard} texto="Contas a Receber (Convênios)" />
        <SidebarItem menuAtivo={menuAtivo} setMenuAtivo={setMenuAtivo} setContasBrutas={setContasBrutas} setSelecionados={setSelecionados} setClienteFiltro={setClienteFiltro} setContaFiltro={setContaFiltro} setPaginaAtual={setPaginaAtual} id="contas-recebidas" icone={Receipt} texto="Contas Recebidas (Convênios)" />
        <SidebarItem menuAtivo={menuAtivo} setMenuAtivo={setMenuAtivo} setContasBrutas={setContasBrutas} setSelecionados={setSelecionados} setClienteFiltro={setClienteFiltro} setContaFiltro={setContaFiltro} setPaginaAtual={setPaginaAtual} id="curva-abc" icone={TrendingUp} texto="Curva ABC e Lucratividade" />
        <SidebarItem menuAtivo={menuAtivo} setMenuAtivo={setMenuAtivo} setContasBrutas={setContasBrutas} setSelecionados={setSelecionados} setClienteFiltro={setClienteFiltro} setContaFiltro={setContaFiltro} setPaginaAtual={setPaginaAtual} id="dre-gerencial" icone={Target} texto="DRE Gerencial" />
        <SidebarItem menuAtivo={menuAtivo} setMenuAtivo={setMenuAtivo} setContasBrutas={setContasBrutas} setSelecionados={setSelecionados} setClienteFiltro={setClienteFiltro} setContaFiltro={setContaFiltro} setPaginaAtual={setPaginaAtual} id="desossa" icone={PieChart} texto="Rateio e Custeio" />
        <SidebarItem menuAtivo={menuAtivo} setMenuAtivo={setMenuAtivo} setContasBrutas={setContasBrutas} setSelecionados={setSelecionados} setClienteFiltro={setClienteFiltro} setContaFiltro={setContaFiltro} setPaginaAtual={setPaginaAtual} id="estoque" icone={Boxes} texto="Inventário" />
        <SidebarItem menuAtivo={menuAtivo} setMenuAtivo={setMenuAtivo} setContasBrutas={setContasBrutas} setSelecionados={setSelecionados} setClienteFiltro={setClienteFiltro} setContaFiltro={setContaFiltro} setPaginaAtual={setPaginaAtual} id="rh-escalas" icone={CalendarDays} texto="Departamento Pessoal" />
      </nav>
    </aside>
  );
}
