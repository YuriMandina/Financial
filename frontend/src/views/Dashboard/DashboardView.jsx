import React from 'react';
import { ArrowDownToLine, CheckCircle, TrendingUp, FileText, Database } from 'lucide-react';
import Skeleton from '../../components/common/Skeleton';

export default function DashboardView({ carregandoTela, dashboardData }) {
  if (carregandoTela) {
    return (
      <div className="space-y-8 p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton type="card" />
          <Skeleton type="card" />
          <Skeleton type="card" />
        </div>
        <Skeleton type="table" rows={3} columns={3} />
      </div>
    );
  }
  if (!dashboardData) return null;
  return (
            <div className="animate-[fadeIn_0.5s_ease-out] space-y-8">
              {(() => {
                const totalPagar = dashboardData.pagar.reduce((acc, c) => acc + (c.saldo_devedor || 0), 0);
                const totalPagas = dashboardData.pagas.reduce((acc, c) => acc + (c.valor_pago || 0), 0);
                const totalReceber = dashboardData.receber.reduce((acc, c) => acc + (c.saldo_devedor || 0), 0);
                
                return (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="relative bg-slate-900/80 border border-slate-700/60 rounded-2xl p-6 overflow-hidden group hover:border-rose-500/40 transition-colors shadow-lg">
                        <div className="absolute inset-0 bg-gradient-to-br from-rose-500/5 to-transparent pointer-events-none" />
                        <div className="flex items-center justify-between mb-4">
                           <p className="text-sm font-bold uppercase tracking-widest text-slate-400">Total a Pagar (Previsão)</p>
                           <div className="w-10 h-10 rounded-full bg-rose-500/10 flex items-center justify-center"><ArrowDownToLine size={20} className="text-rose-400" /></div>
                        </div>
                        <p className="text-3xl font-black text-rose-400">R$ {totalPagar.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                        <p className="text-xs text-slate-500 mt-2">No período selecionado</p>
                      </div>

                      <div className="relative bg-slate-900/80 border border-slate-700/60 rounded-2xl p-6 overflow-hidden group hover:border-emerald-500/40 transition-colors shadow-lg">
                        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent pointer-events-none" />
                        <div className="flex items-center justify-between mb-4">
                           <p className="text-sm font-bold uppercase tracking-widest text-slate-400">Total Pago (Realizado)</p>
                           <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center"><CheckCircle size={20} className="text-emerald-400" /></div>
                        </div>
                        <p className="text-3xl font-black text-emerald-400">R$ {totalPagas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                        <p className="text-xs text-slate-500 mt-2">Contas liquidadas no período</p>
                      </div>

                      <div className="relative bg-slate-900/80 border border-slate-700/60 rounded-2xl p-6 overflow-hidden group hover:border-indigo-500/40 transition-colors shadow-lg">
                        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent pointer-events-none" />
                        <div className="flex items-center justify-between mb-4">
                           <p className="text-sm font-bold uppercase tracking-widest text-slate-400">Total a Receber</p>
                           <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center"><TrendingUp size={20} className="text-indigo-400" /></div>
                        </div>
                        <p className="text-3xl font-black text-indigo-400">R$ {totalReceber.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                        <p className="text-xs text-slate-500 mt-2">Em aberto (Convênios)</p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
                       <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-lg">
                          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><FileText className="text-indigo-400" size={20} /> Próximos Vencimentos a Pagar</h3>
                          <div className="space-y-4">
                             {dashboardData.pagar.length === 0 ? (
                                <p className="text-slate-500 text-sm">Nenhum título a pagar no período.</p>
                             ) : dashboardData.pagar.slice(0, 5).map((conta, idx) => (
                                <div key={idx} className="flex justify-between items-center bg-slate-800/40 p-4 rounded-xl border border-slate-700/50">
                                   <div className="overflow-hidden">
                                      <p className="text-slate-300 font-bold text-sm truncate max-w-[200px]" title={conta.nome_fornecedor}>{conta.nome_fornecedor}</p>
                                      <p className="text-slate-500 text-xs">Venc: {conta.data_previsao_br}</p>
                                   </div>
                                   <p className="text-rose-400 font-bold whitespace-nowrap">R$ {conta.saldo_devedor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                                </div>
                             ))}
                          </div>
                       </div>
                       
                       <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-lg">
                          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Database className="text-emerald-400" size={20} /> Últimos Pagamentos Realizados</h3>
                          <div className="space-y-4">
                             {dashboardData.pagas.length === 0 ? (
                                <p className="text-slate-500 text-sm">Nenhum título pago no período.</p>
                             ) : dashboardData.pagas.slice(0, 5).map((conta, idx) => (
                                <div key={idx} className="flex justify-between items-center bg-slate-800/40 p-4 rounded-xl border border-slate-700/50">
                                   <div className="overflow-hidden">
                                      <p className="text-slate-300 font-bold text-sm truncate max-w-[200px]" title={conta.nome_fornecedor}>{conta.nome_fornecedor}</p>
                                      <p className="text-slate-500 text-xs">Pago em: {conta.data_pagamento_br}</p>
                                   </div>
                                   <p className="text-emerald-400 font-bold whitespace-nowrap">R$ {conta.valor_pago.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                                </div>
                             ))}
                          </div>
                       </div>
                    </div>
                  </>
                );
              })()}
            </div>

  );
}
