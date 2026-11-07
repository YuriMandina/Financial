import React from 'react';
import { Link } from 'react-router';
import {
  TrendingUp, LayoutDashboard, FileText, Database, CreditCard,
  Receipt, Target, PieChart, CalendarDays, Boxes, ChevronLeft, ChevronRight
} from 'lucide-react';
import { MENU_PATHS } from '../../routes';

const MENU_ITEMS = [
  { id: 'dashboard', icone: LayoutDashboard, texto: 'Visão Geral' },
  { id: 'contas-pagar', icone: FileText, texto: 'Contas a Pagar' },
  { id: 'contas-pagas', icone: Database, texto: 'Contas Pagas' },
  { id: 'recebimentos', icone: CreditCard, texto: 'Contas a Receber (Convênios)' },
  { id: 'contas-recebidas', icone: Receipt, texto: 'Contas Recebidas (Convênios)' },
  { id: 'curva-abc', icone: TrendingUp, texto: 'Curva ABC e Lucratividade' },
  { id: 'dre-gerencial', icone: Target, texto: 'DRE Gerencial' },
  { id: 'desossa', icone: PieChart, texto: 'Rateio e Custeio' },
  { id: 'estoque', icone: Boxes, texto: 'Inventário' },
  { id: 'rh-escalas', icone: CalendarDays, texto: 'Departamento Pessoal' },
];

// Link real (não botão): permite abrir em nova aba com Ctrl/botão do meio.
const SidebarItem = ({ id, icone: Icon, texto, menuAtivo, collapsed }) => {
  const isActive = menuAtivo === id;
  return (
    <Link
      to={MENU_PATHS[id]}
      title={collapsed ? texto : undefined}
      aria-current={isActive ? 'page' : undefined}
      className={`w-full flex items-center rounded-lg text-sm font-medium transition-all print:hidden ${
        collapsed ? 'justify-center p-2.5' : 'gap-3 px-3.5 py-2.5'
      } ${
        isActive
          ? 'bg-slate-800 text-white border border-slate-700/70 shadow-sm'
          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
      }`}
    >
      <Icon size={18} className={`shrink-0 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`} />
      {!collapsed && <span className="text-left truncate">{texto}</span>}
    </Link>
  );
};

export default function Sidebar({ menuAtivo, collapsed, setCollapsed }) {
  return (
    <aside
      className={`bg-slate-900 border-r border-slate-800 flex flex-col z-20 print:hidden shrink-0 transition-all duration-200 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      <div className={`h-16 shrink-0 flex items-center border-b border-slate-800 ${
        collapsed ? 'justify-center px-2' : 'justify-between px-4'
      }`}>
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="w-8 h-8 shrink-0 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-sm">
            <TrendingUp size={18} />
          </div>
          {!collapsed && (
            <div className="truncate">
              <h1 className="text-base font-bold text-white tracking-tight leading-none truncate">Financial</h1>
              <span className="text-[10px] text-slate-400 font-medium tracking-wider uppercase">Enterprise BI</span>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setCollapsed?.(!collapsed)}
          className={`p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors ${
            collapsed ? 'hidden' : 'block'
          }`}
          title="Recolher barra lateral"
        >
          <ChevronLeft size={16} />
        </button>
      </div>

      <nav className="flex-1 px-2.5 py-4 space-y-1 overflow-y-auto overflow-x-hidden">
        {MENU_ITEMS.map((item) => (
          <SidebarItem key={item.id} {...item} menuAtivo={menuAtivo} collapsed={collapsed} />
        ))}
      </nav>

      {/* Botão de Expansão no Rodapé quando recolhido */}
      {collapsed && (
        <div className="p-2 border-t border-slate-800 flex justify-center">
          <button
            type="button"
            onClick={() => setCollapsed?.(false)}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Expandir barra lateral"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}
    </aside>
  );
}
