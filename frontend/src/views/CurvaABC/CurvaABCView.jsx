import React, { useMemo } from 'react';
import { TrendingUp, Search, Download, Calculator, X, ChevronDown, CheckSquare, Square, Filter, Printer } from 'lucide-react';
import Skeleton from '../../components/common/Skeleton';

export default function CurvaABCView({ resumoCurvaAbc, dataInicial, dataFinal, isolarABC, setIsolarABC, familiasList, familiasFiltro, setFamiliasFiltro, classeAbcFiltro, setClasseAbcFiltro, dropFamiliaAberto, setDropFamiliaAberto, dropClasseAberto, setDropClasseAberto, menuAtivo, carregandoTela, curvaAbcProcessada, contasBrutas, clienteFiltro, setClienteFiltro, setPaginaAtual, setRegistrosPorPagina }) {
  const fmtQ = (v) => v?.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0,00';
  const fmtR = (v) => 'R$ ' + (v?.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) || '0,00');

  const itensFiltrados = curvaAbcProcessada?.itens || [];

  if (menuAtivo !== 'curva-abc') return null;
  if (carregandoTela) {
    return (
      <div className="p-4 space-y-6">
        <Skeleton type="card" />
        <Skeleton type="table" rows={8} columns={5} />
      </div>
    );
  }
  if (!resumoCurvaAbc) return null;

  const totQtd = itensFiltrados.reduce((acc, i) => acc + i.quantidade, 0);
  const totCmvTotal = itensFiltrados.reduce((acc, i) => acc + i.cmv_total, 0);
  const totDescTotal = itensFiltrados.reduce((acc, i) => acc + i.valor_desconto, 0);
  const totReceitaTotal = itensFiltrados.reduce((acc, i) => acc + i.receita_total, 0);
  const totLucroTotal = itensFiltrados.reduce((acc, i) => acc + i.lucro_bruto, 0);
  const totMargemMedia = totReceitaTotal > 0 ? (totLucroTotal / totReceitaTotal) * 100 : 0;

  const calcSubtotal = (classe) => {
    const itens = itensFiltrados.filter(i => i.classe_abc === classe);
    const qtd = itens.reduce((acc, i) => acc + i.quantidade, 0);
    const cmv = itens.reduce((acc, i) => acc + i.cmv_total, 0);
    const desc = itens.reduce((acc, i) => acc + i.valor_desconto, 0);
    const receita = itens.reduce((acc, i) => acc + i.receita_total, 0);
    const lucro = itens.reduce((acc, i) => acc + i.lucro_bruto, 0);
    const margem = receita > 0 ? (lucro / receita) * 100 : 0;
    const partic = totReceitaTotal > 0 ? (receita / totReceitaTotal) * 100 : 0;
    return { count: itens.length, qtd, cmv, desc, receita, lucro, margem, partic };
  };

  return (
            <div className="animate-[fadeIn_0.5s_ease-out] space-y-8 print:space-y-4">

              {/* ---- CABEÇALHO DE IMPRESSÃO ---- */}
              <div className="hidden print:flex items-center justify-between border-b-2 border-slate-800 pb-4 mb-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
                    <TrendingUp size={18} className="text-white" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold text-slate-900">Financial</h1>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Inteligência Financeira</p>
                  </div>
                </div>
                <div className="text-right">
                  <h2 className="text-lg font-bold text-slate-800 uppercase">Curva ABC e Lucratividade</h2>
                  <p className="text-sm text-slate-600 mt-1">Período: {dataInicial.split('-').reverse().join('/')} a {dataFinal.split('-').reverse().join('/')}</p>
                </div>
              </div>

              {/* ---- SEÇÃO 1: CARDS KPI ---- */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 print:grid print:grid-cols-3 print:gap-3">

                {/* KPI 1 – Faturamento Total */}
                <div className="relative bg-slate-900/80 border border-slate-700/60 rounded-2xl p-6 print:rounded print:border-slate-600 print:bg-slate-800 print:p-3 overflow-hidden group hover:border-indigo-500/40 transition-colors">
                  <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent pointer-events-none" />
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400 print:text-slate-300 mb-3">
                    Faturamento Total
                  </p>
                  <p className="text-3xl font-black text-white print:text-white print:text-xl leading-none">
                    R$ {curvaAbcProcessada.resumoKpi?.receita_total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-slate-500 mt-2 print:hidden">{isolarABC ? curvaAbcProcessada.itens.length : contasBrutas.length} produto(s) no período</p>
                </div>

                {/* KPI 2 – Lucro Bruto Total */}
                <div className="relative bg-slate-900/80 border border-slate-700/60 rounded-2xl p-6 print:rounded print:border-slate-600 print:bg-slate-800 print:p-3 overflow-hidden hover:border-emerald-500/40 transition-colors">
                  <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent pointer-events-none" />
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400 print:text-slate-300 mb-3">
                    Lucro Bruto Total
                  </p>
                  <p className={`text-3xl font-black print:text-xl leading-none ${curvaAbcProcessada.resumoKpi?.lucro_bruto_total >= 0 ? 'text-emerald-400 print:text-emerald-300' : 'text-red-400 print:text-red-300'}`}>
                    R$ {curvaAbcProcessada.resumoKpi?.lucro_bruto_total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-slate-500 mt-2 print:hidden">Receita − CMV consolidado</p>
                </div>

                {/* KPI 3 – Margem Bruta Média */}
                <div className="relative bg-slate-900/80 border border-slate-700/60 rounded-2xl p-6 print:rounded print:border-slate-600 print:bg-slate-800 print:p-3 overflow-hidden hover:border-purple-500/40 transition-colors">
                  <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent pointer-events-none" />
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400 print:text-slate-300 mb-3">
                    Margem Bruta Média
                  </p>
                  <p className={`text-3xl font-black print:text-xl leading-none ${curvaAbcProcessada.resumoKpi?.margem_media_perc >= 0 ? 'text-purple-400 print:text-purple-300' : 'text-red-400 print:text-red-300'}`}>
                    {curvaAbcProcessada.resumoKpi?.margem_media_perc.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                  </p>
                  <p className="text-xs text-slate-500 mt-2 print:hidden">Sobre receita total do período</p>
                </div>
              </div>

              {/* ---- SEÇÃO 2: BARRA DE AÇÕES ---- */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 print:hidden">
                <div className="flex flex-wrap items-center gap-2">

                  {/* Busca por texto */}
                  <div className="flex items-center gap-2 bg-slate-900/50 border border-slate-700/50 rounded-lg px-3 py-2">
                    <Search size={16} className="text-indigo-400" />
                    <input
                      type="text"
                      placeholder="Filtrar produto..."
                      value={clienteFiltro}
                      onChange={(e) => { setClienteFiltro(e.target.value); setPaginaAtual(1); }}
                      className="bg-transparent text-slate-200 text-sm font-medium focus:outline-none placeholder-slate-500 w-44"
                    />
                  </div>

                  {/* ---- FILTRO: FAMÍLIAS ---- */}
                  <div className="relative">
                    <button
                      id="btn-filtro-familias"
                      onClick={() => { setDropFamiliaAberto(p => !p); setDropClasseAberto(false); }}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-semibold transition-all ${familiasFiltro.length > 0
                          ? 'bg-indigo-600/20 border-indigo-500/60 text-indigo-300'
                          : 'bg-slate-900/50 border-slate-700/50 text-slate-300 hover:border-indigo-500/40'
                        }`}
                    >
                      <Filter size={14} />
                      Famílias
                      {familiasFiltro.length > 0 && (
                        <span className="bg-indigo-500 text-white text-xs font-black w-5 h-5 rounded-full flex items-center justify-center">
                          {familiasFiltro.length}
                        </span>
                      )}
                      <span className="text-slate-500 text-xs">{dropFamiliaAberto ? '▲' : '▼'}</span>
                    </button>
                    {dropFamiliaAberto && (
                      <div className="absolute top-full mt-1 left-0 z-50 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl min-w-[220px] max-h-64 overflow-y-auto">
                        <div className="px-3 py-2 border-b border-slate-700/60 flex justify-between items-center">
                          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Famílias</span>
                          <button
                            onClick={() => setFamiliasFiltro([])}
                            className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold"
                          >Limpar</button>
                        </div>
                        {familiasList.length === 0 ? (
                          <p className="px-3 py-3 text-slate-500 text-xs">Nenhuma família encontrada</p>
                        ) : familiasList.map(fam => {
                          const selecionada = familiasFiltro.includes(fam);
                          return (
                            <button
                              key={fam}
                              onClick={() => {
                                setFamiliasFiltro(prev =>
                                  selecionada ? prev.filter(f => f !== fam) : [...prev, fam]
                                );
                              }}
                              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${selecionada
                                  ? 'bg-indigo-500/20 text-indigo-200'
                                  : 'text-slate-300 hover:bg-slate-800'
                                }`}
                            >
                              <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-xs font-black ${selecionada ? 'bg-indigo-500 border-indigo-400 text-white' : 'border-slate-600'
                                }`}>{selecionada ? '✓' : ''}</span>
                              <span className="truncate">{fam}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* ---- FILTRO: CLASSE ABC ---- */}
                  <div className="relative">
                    <button
                      id="btn-filtro-classe-abc"
                      onClick={() => { setDropClasseAberto(p => !p); setDropFamiliaAberto(false); }}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-semibold transition-all ${classeAbcFiltro.length > 0
                          ? 'bg-purple-600/20 border-purple-500/60 text-purple-300'
                          : 'bg-slate-900/50 border-slate-700/50 text-slate-300 hover:border-purple-500/40'
                        }`}
                    >
                      <TrendingUp size={14} />
                      Classe ABC
                      {classeAbcFiltro.length > 0 && (
                        <span className="bg-purple-500 text-white text-xs font-black w-5 h-5 rounded-full flex items-center justify-center">
                          {classeAbcFiltro.length}
                        </span>
                      )}
                      <span className="text-slate-500 text-xs">{dropClasseAberto ? '▲' : '▼'}</span>
                    </button>
                    {dropClasseAberto && (
                      <div className="absolute top-full mt-1 left-0 z-50 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl min-w-[180px]">
                        <div className="px-3 py-2 border-b border-slate-700/60 flex justify-between items-center">
                          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Classe</span>
                          <button
                            onClick={() => setClasseAbcFiltro([])}
                            className="text-xs text-purple-400 hover:text-purple-300 font-semibold"
                          >Limpar</button>
                        </div>
                        {[{ id: 'A', label: 'A — Top 20% Receita', cls: 'text-emerald-300' }, { id: 'B', label: 'B — Próximos 30%', cls: 'text-amber-300' }, { id: 'C', label: 'C — Restantes 50%', cls: 'text-slate-400' }].map(cl => {
                          const sel = classeAbcFiltro.includes(cl.id);
                          return (
                            <button
                              key={cl.id}
                              onClick={() => {
                                setClasseAbcFiltro(prev =>
                                  sel ? prev.filter(c => c !== cl.id) : [...prev, cl.id]
                                );
                              }}
                              className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-3 transition-colors ${sel ? 'bg-purple-500/10' : 'hover:bg-slate-800'
                                }`}
                            >
                              <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-xs font-black ${sel ? 'bg-purple-500 border-purple-400 text-white' : 'border-slate-600'
                                }`}>{sel ? '✓' : ''}</span>
                              <span className={`font-bold ${cl.cls}`}>{cl.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* ---- CHECKBOX ISOLAR ABC ---- */}
                  <label className="flex items-center gap-2 text-sm text-slate-300 font-medium cursor-pointer bg-slate-900/50 border border-slate-700/50 px-3 py-2 rounded-lg hover:bg-slate-800 transition-colors select-none">
                    <input 
                      type="checkbox" 
                      checked={isolarABC} 
                      onChange={e => setIsolarABC(e.target.checked)} 
                      className="w-4 h-4 rounded border-slate-600 text-indigo-500 focus:ring-indigo-500/50 bg-slate-900/50" 
                    />
                    Isolar Curva ABC
                  </label>

                </div>

                <button
                  onClick={() => {
                    // fecha dropdowns antes de imprimir
                    setDropFamiliaAberto(false);
                    setDropClasseAberto(false);
                    setRegistrosPorPagina(contasBrutas.length || 50);
                    setTimeout(() => { window.print(); setRegistrosPorPagina(50); }, 300);
                  }}
                  className="flex items-center gap-2 bg-slate-800 text-slate-300 hover:text-white px-6 py-3 rounded-xl font-bold group border border-slate-700 shadow-lg"
                >
                  <Printer size={18} className="group-hover:scale-110 transition-transform" /> IMPRIMIR
                </button>
              </div>

              {/* ---- SEÇÃO 3: TABELA DE PRODUTOS ---- */}
              {/* fecha dropdowns ao clicar fora */}
              {(dropFamiliaAberto || dropClasseAberto) && (
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => { setDropFamiliaAberto(false); setDropClasseAberto(false); }}
                />
              )}
              {(() => {
                const itensFiltrados = curvaAbcProcessada.itens;

                // Totalizadores do rodapé
                const totQtd = itensFiltrados.reduce((s, p) => s + (p.quantidade || 0), 0);
                const totReceita = itensFiltrados.reduce((s, p) => s + (p.receita_total || 0), 0);
                const totDescontos = itensFiltrados.reduce((s, p) => s + (p.descontos || 0), 0);
                const totCmvTotal = itensFiltrados.reduce((s, p) => s + (p.cmv_total || 0), 0);
                const totLucro = itensFiltrados.reduce((s, p) => s + (p.lucro_bruto || 0), 0);
                const totPartic = itensFiltrados.reduce((s, p) => s + (p.participacao_perc || 0), 0);
                const margemRodape = totReceita !== 0 ? (totLucro / totReceita) * 100 : 0;

                // Badge ABC usa a classe calculada pelo backend
                const badgeAbc = (classe) => {
                  if (classe === 'A') return { label: 'A', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 print:text-emerald-800 print:border-emerald-600' };
                  if (classe === 'B') return { label: 'B', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40 print:text-amber-800 print:border-amber-600' };
                  return { label: 'C', cls: 'bg-slate-600/30 text-slate-400 border-slate-600/50 print:text-slate-600 print:border-slate-400' };
                };

                const fmtR = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
                const fmtQ = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

                // ---- Sub-totais por classe ABC ----
                const calcSubtotal = (classe) => {
                  const grupo = itensFiltrados.filter(p => p.classe_abc === classe);
                  const sub = {
                    qtd: grupo.reduce((s, p) => s + (p.quantidade || 0), 0),
                    receita: grupo.reduce((s, p) => s + (p.receita_total || 0), 0),
                    desc: grupo.reduce((s, p) => s + (p.descontos || 0), 0),
                    cmv: grupo.reduce((s, p) => s + (p.cmv_total || 0), 0),
                    lucro: grupo.reduce((s, p) => s + (p.lucro_bruto || 0), 0),
                    partic: grupo.reduce((s, p) => s + (p.participacao_perc || 0), 0),
                    count: grupo.length,
                  };
                  sub.margem = sub.receita !== 0 ? (sub.lucro / sub.receita) * 100 : 0;
                  return sub;
                };

                // Linha separadora/totalizadora de classe
                const SubtotalRow = ({ classe, label, corBg, corText, corBorder }) => {
                  const sub = calcSubtotal(classe);
                  if (sub.count === 0) return null;
                  return (
                    <tr className={`${corBg} ${corBorder} border-t border-b print:break-inside-avoid`}>
                      <td className="py-2 print:py-1 px-4 print:px-2 text-center">
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full border text-xs font-black ${corText} border-current`}>{classe}</span>
                      </td>
                      <td className={`py-2 print:py-1 px-4 print:px-2 text-xs font-black uppercase tracking-wider ${corText}`}>
                        Subtotal Classe {classe} — {sub.count} produto{sub.count !== 1 ? 's' : ''}
                      </td>
                      <td className={`py-2 print:py-1 px-4 print:px-2 text-right text-xs font-bold ${corText}`}>{fmtQ(sub.qtd)}</td>
                      <td className="py-2 print:py-1 px-4 print:px-2 text-right text-xs text-slate-500 print:text-slate-400">—</td>
                      <td className={`py-2 print:py-1 px-4 print:px-2 text-right text-xs font-bold ${corText}`}>{fmtR(sub.cmv)}</td>
                      <td className={`py-2 print:py-1 px-4 print:px-2 text-right text-xs font-bold ${corText}`}>{fmtR(sub.desc)}</td>
                      <td className={`py-2 print:py-1 px-4 print:px-2 text-right text-xs font-bold ${corText}`}>{fmtR(sub.receita)}</td>
                      <td className="py-2 print:py-1 px-4 print:px-2 text-right text-xs text-slate-500 print:text-slate-400">—</td>
                      <td className={`py-2 print:py-1 px-4 print:px-2 text-right text-xs font-bold ${sub.lucro >= 0 ? corText : 'text-red-400'}`}>{fmtR(sub.lucro)}</td>
                      <td className={`py-2 print:py-1 px-4 print:px-2 text-right text-xs font-bold ${sub.margem >= 0 ? corText : 'text-red-400'}`}>{sub.margem.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</td>
                      <td className={`py-2 print:py-1 px-4 print:px-2 text-right text-xs font-bold ${corText}`}>{sub.partic.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</td>
                    </tr>
                  );
                };

                return (
                  <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl print:rounded-none print:!bg-transparent print:border-slate-300 overflow-hidden shadow-lg">

                    {/* --- cabeçalho --- */}
                    <div className="overflow-x-auto print:overflow-visible print:w-full">
                      <table className="w-full text-left border-collapse whitespace-nowrap">
                        <thead>
                          <tr className="bg-slate-800/60 print:bg-slate-200 text-slate-300 print:text-slate-900 text-xs font-bold border-b border-slate-700/50 print:border-slate-400 uppercase tracking-wider">
                            <th className="py-4 print:py-1 px-4 print:px-2 text-center w-12 print:w-auto">ABC</th>
                            <th className="py-4 print:py-1 px-4 print:px-2 w-full print:w-auto">Produto</th>
                            <th className="py-4 print:py-1 px-4 print:px-2 text-right w-20 print:w-auto print:whitespace-nowrap">Qtd.</th>
                            <th className="py-4 print:py-1 px-4 print:px-2 text-right w-28 print:w-auto print:whitespace-nowrap">CMV Unit.</th>
                            <th className="py-4 print:py-1 px-4 print:px-2 text-right w-28 print:w-auto print:whitespace-nowrap">CMV Total</th>
                            <th className="py-4 print:py-1 px-4 print:px-2 text-right w-28 print:w-auto print:whitespace-nowrap">Descontos</th>
                            <th className="py-4 print:py-1 px-4 print:px-2 text-right w-32 print:w-auto print:whitespace-nowrap">Total NF</th>
                            <th className="py-4 print:py-1 px-4 print:px-2 text-right w-28 print:w-auto print:whitespace-nowrap">Média Venda</th>
                            <th className="py-4 print:py-1 px-4 print:px-2 text-right w-28 print:w-auto print:whitespace-nowrap">Lucro Bruto</th>
                            <th className="py-4 print:py-1 px-4 print:px-2 text-right w-24 print:w-auto print:whitespace-nowrap">Margem Bruta</th>
                            <th className="py-4 print:py-1 px-4 print:px-2 text-right w-20 print:w-auto print:whitespace-nowrap">Partic. %</th>
                          </tr>
                        </thead>
                        <tbody className="text-sm">
                          {itensFiltrados.length === 0 ? (
                            <tr>
                              <td colSpan="11" className="py-12 text-center text-slate-500 font-medium">
                                Nenhum produto encontrado para o filtro atual.
                              </td>
                            </tr>
                          ) : (() => {
                            // Renderiza as linhas de produto agrupadas por classe + subtotais
                            const rows = [];
                            let classeAtual = null;

                            itensFiltrados.forEach((p, idx) => {
                              const badge = badgeAbc(p.classe_abc);
                              const lucroNeg = p.lucro_bruto < 0;
                              const margemNeg = p.margem_bruta_perc < 0;

                              // Se mudou de classe, insere o subtotal da classe anterior
                              if (classeAtual !== null && p.classe_abc !== classeAtual) {
                                if (classeAtual === 'A') rows.push(
                                  <SubtotalRow key={`sub-A`} classe="A" label="A" corBg="bg-emerald-500/10 print:bg-emerald-50" corText="text-emerald-400 print:text-emerald-800" corBorder="border-emerald-500/30 print:border-emerald-600" />
                                ); ""
                                if (classeAtual === 'B') rows.push(
                                  <SubtotalRow key={`sub-B`} classe="B" label="B" corBg="bg-amber-500/10 print:bg-amber-50" corText="text-amber-400 print:text-amber-800" corBorder="border-amber-500/30 print:border-amber-600" />
                                );
                              }
                              classeAtual = p.classe_abc;

                              rows.push(
                                <tr
                                  key={idx}
                                  className={`border-b border-slate-700/30 print:border-slate-300 hover:bg-slate-800/40 print:hover:bg-transparent transition-colors ${idx % 2 === 0 ? 'print:bg-white' : 'print:bg-slate-50 print:!bg-slate-50'}`}
                                >
                                  {/* Badge ABC */}
                                  <td className="py-3 print:py-1 px-4 print:px-2 text-center w-12 print:w-auto">
                                    <span className={`inline-flex items-center justify-center w-6 h-6 print:w-5 print:h-5 rounded-full border text-xs print:text-[10px] font-black ${badge.cls}`}>
                                      {badge.label}
                                    </span>
                                  </td>

                                  {/* Produto */}
                                  <td className="py-3 print:py-1 px-4 print:px-2 font-semibold text-slate-200 print:text-slate-900 max-w-[240px] truncate print:max-w-none">
                                    {p.descricao_produto}
                                  </td>

                                  {/* Quantidade */}
                                  <td className="py-3 print:py-1 px-4 print:px-2 text-right text-slate-300 print:text-slate-800">
                                    {fmtQ(p.quantidade)}
                                  </td>

                                  {/* CMV Unitário */}
                                  <td className="py-3 print:py-1 px-4 print:px-2 text-right text-slate-400 print:text-slate-700">
                                    {fmtR(p.cmv_medio)}
                                  </td>

                                  {/* CMV Total */}
                                  <td className="py-3 print:py-1 px-4 print:px-2 text-right text-slate-400 print:text-slate-700">
                                    {fmtR(p.cmv_total)}
                                  </td>

                                  {/* Descontos */}
                                  <td className="py-3 print:py-1 px-4 print:px-2 text-right text-slate-400 print:text-slate-700">
                                    {fmtR(p.descontos)}
                                  </td>

                                  {/* Total NF */}
                                  <td className="py-3 print:py-1 px-4 print:px-2 text-right font-bold text-slate-200 print:text-slate-900">
                                    {fmtR(p.receita_total)}
                                  </td>

                                  {/* Média Valor Venda */}
                                  <td className="py-3 print:py-1 px-4 print:px-2 text-right text-slate-300 print:text-slate-800">
                                    {fmtR(p.media_valor_venda)}
                                  </td>

                                  {/* Lucro Bruto */}
                                  <td className={`py-3 print:py-1 px-4 print:px-2 text-right font-bold ${lucroNeg ? 'text-red-400' : 'text-emerald-400'} print:text-slate-900`}>
                                    {fmtR(p.lucro_bruto)}
                                  </td>

                                  {/* Margem Bruta % */}
                                  <td className={`py-3 print:py-1 px-4 print:px-2 text-right font-bold ${margemNeg ? 'text-red-400' : 'text-purple-400'} print:text-slate-900`}>
                                    {p.margem_bruta_perc.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                                  </td>

                                  {/* % Participação */}
                                  <td className="py-3 print:py-1 px-4 print:px-2 text-right font-semibold text-indigo-400 print:text-slate-900">
                                    {p.participacao_perc.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                                  </td>
                                </tr>
                              );
                            });

                            // Subtotal da última classe
                            if (classeAtual === 'A') rows.push(
                              <SubtotalRow key="sub-A-last" classe="A" label="A" corBg="bg-emerald-500/10 print:bg-emerald-50" corText="text-emerald-400 print:text-emerald-800" corBorder="border-emerald-500/30 print:border-emerald-600" />
                            );
                            if (classeAtual === 'B') rows.push(
                              <SubtotalRow key="sub-B-last" classe="B" label="B" corBg="bg-amber-500/10 print:bg-amber-50" corText="text-amber-400 print:text-amber-800" corBorder="border-amber-500/30 print:border-amber-600" />
                            );
                            if (classeAtual === 'C') rows.push(
                              <SubtotalRow key="sub-C-last" classe="C" label="C" corBg="bg-slate-700/30 print:bg-slate-100" corText="text-slate-400 print:text-slate-700" corBorder="border-slate-500/30 print:border-slate-500" />
                            );

                            return rows;
                          })()}
                        </tbody>

                        {/* ---- RODAPÉ TOTALIZADOR ---- */}
                        <tfoot>
                          <tr className="bg-slate-800/80 print:bg-slate-200 border-t-2 border-slate-600 print:border-slate-700 text-xs font-black uppercase">
                            <td className="py-4 print:py-2 px-4 print:px-2 text-center text-slate-400 print:text-slate-700">—</td>
                            <td className="py-4 print:py-2 px-4 print:px-2 text-slate-300 print:text-slate-900">
                              TOTAL ({itensFiltrados.length} prod.)
                            </td>
                            <td className="py-4 print:py-2 px-4 print:px-2 text-right text-slate-200 print:text-slate-900">
                              {fmtQ(totQtd)}
                            </td>
                            <td className="py-4 print:py-2 px-4 print:px-2 text-right text-slate-500 print:text-slate-500">—</td>
                            <td className="py-4 print:py-2 px-4 print:px-2 text-right text-slate-400 print:text-slate-800">
                              {fmtR(totCmvTotal)}
                            </td>
                            <td className="py-4 print:py-2 px-4 print:px-2 text-right text-slate-400 print:text-slate-800">
                              {fmtR(totDescontos)}
                            </td>
                            <td className="py-4 print:py-2 px-4 print:px-2 text-right text-white print:text-slate-900">
                              {fmtR(totReceita)}
                            </td>
                            <td className="py-4 print:py-2 px-4 print:px-2 text-right text-slate-500 print:text-slate-500">—</td>
                            <td className={`py-4 print:py-2 px-4 print:px-2 text-right ${totLucro >= 0 ? 'text-emerald-400' : 'text-red-400'} print:text-slate-900`}>
                              {fmtR(totLucro)}
                            </td>
                            <td className={`py-4 print:py-2 px-4 print:px-2 text-right ${margemRodape >= 0 ? 'text-purple-400' : 'text-red-400'} print:text-slate-900`}>
                              {margemRodape.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                            </td>
                            <td className="py-4 print:py-2 px-4 print:px-2 text-right text-indigo-400 print:text-slate-900">
                              {totPartic.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </div>

  );
}
