import React from 'react';
import { Search, CalendarDays, Receipt, CheckSquare, Square, Calculator, Zap, FileText, Database, CreditCard } from 'lucide-react';
import CartaoCliente from '../../components/common/CartaoCliente';

export default function ContasView({ menuAtivo, carregandoTela, contasBrutas, totalGeral, clienteFiltro, setClienteFiltro, contaFiltro, setContaFiltro, listaBancos, isolarABC, paginaAtual, setPaginaAtual, totalItems, indiceInicio, indiceFim, registrosPorPagina, setRegistrosPorPagina, contasFiltradas, gruposRecebimentos, selecionados, toggleSelecao, toggleTodosCliente, abrirModalLote, gerarCobrancaLote, formatarDataComDia, converterDataBrParaDate, setModalBaixa, handleCarregarHistoricoRecibos, setModalHistoricoRecibosAberto, contasCorrentesDisponiveis, handleImprimir, dadosAgrupados, metricsVencimento, resumoCategorias, totalPaginas }) {
  if (menuAtivo === 'curva-abc' || menuAtivo === 'dashboard' || carregandoTela || contasBrutas.length === 0) return null;

  const getBadgeStyle = (status) => {
    switch (status) {
      case 'ABERTO': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      case 'VENCIDO': return 'bg-rose-500/10 text-rose-500 border-rose-500/20';
      case 'LIQUIDADO': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
      case 'PARCIAL': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      default: return 'bg-slate-500/10 text-slate-500 border-slate-500/20';
    }
  };

  const temPagamentoParcial = (conta) => {
    return conta.valor_pago > 0 && conta.valor_pago < conta.valor_documento && conta.saldo_devedor > 0;
  };

  return (
            <div className="animate-[fadeIn_0.5s_ease-out] print:!block">

              <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-10 gap-4 print:hidden">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                    <p className="text-emerald-400 font-bold text-lg xl:text-xl">Global a {menuAtivo === 'recebimentos' ? 'Receber' : 'Pagar'}: R$ {totalGeral.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                  </div>

                  <div className="flex items-center gap-2 bg-slate-900/50 border border-slate-700/50 rounded-lg px-3 py-2">
                    <Search size={16} className="text-indigo-400" />
                    <input
                      type="text"
                      placeholder={menuAtivo === 'recebimentos' ? "Filtrar cliente/nota..." : "Filtrar fornecedor..."}
                      value={clienteFiltro}
                      onChange={(e) => {
                        setClienteFiltro(e.target.value);
                        setPaginaAtual(1);
                      }}
                      className="bg-transparent text-slate-200 text-sm font-medium focus:outline-none placeholder-slate-500 w-40"
                    />
                  </div>

                  {(menuAtivo === 'contas-pagas' || menuAtivo === 'recebimentos') && contasCorrentesDisponiveis.length > 0 && (
                    <div className="flex items-center gap-2 bg-slate-900/50 border border-slate-700/50 rounded-lg px-3 py-2">
                      <Filter size={16} className="text-indigo-400" />
                      <select
                        value={contaFiltro}
                        onChange={(e) => {
                          setContaFiltro(e.target.value);
                          setPaginaAtual(1);
                        }}
                        className="bg-transparent text-slate-200 text-sm font-medium focus:outline-none appearance-none pr-4"
                      >
                        <option value="TODAS">Todas as Contas</option>
                        {contasCorrentesDisponiveis.map(cc => <option key={cc} value={cc}>{cc}</option>)}
                      </select>
                    </div>
                  )}
                </div>

                <button onClick={handleImprimir} className="flex items-center gap-2 bg-slate-800 text-slate-300 hover:text-white px-6 py-3 rounded-xl font-bold group border border-slate-700 shadow-lg">
                  <Printer size={18} className="group-hover:scale-110 transition-transform" /> IMPRIMIR
                </button>
              </div>

              {contasFiltradas.length === 0 ? (
                <div className="text-center py-16 bg-slate-900/30 border border-dashed border-slate-700 rounded-2xl print:hidden">
                  <FileText size={48} className="mx-auto text-slate-600 mb-4" />
                  <p className="text-slate-400 font-medium">Nenhum registo encontrado para o filtro atual.</p>
                </div>
              ) : (
                <>
                  {menuAtivo === 'recebimentos' ? (
                    <div className="space-y-8">
                      {dadosAgrupados.map((grupo, gIdx) => (
                        <CartaoCliente
                          key={gIdx}
                          grupo={grupo}
                          selecionados={selecionados}
                          toggleSelecao={toggleSelecao}
                          toggleTodosCliente={toggleTodosCliente}
                          abrirModalLote={abrirModalLote}
                          gerarCobrancaLote={gerarCobrancaLote}
                        />
                      ))}

                      {/* RODAPÉ DE TOTAL GERAL */}
                      <div className="border-t-2 border-slate-700 print:border-slate-400 pt-4 mt-4">

                        {/* CARDS DE AGING */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3 print:grid print:grid-cols-3 print:gap-2 print:mb-2">
                          <div className="flex flex-col bg-amber-500/10 border border-amber-500/30 rounded-xl print:rounded print:border-amber-400 px-4 py-3 print:px-3 print:py-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 print:text-amber-700">+ 30 dias em aberto</span>
                            <span className="text-xl font-black text-amber-300 print:text-slate-900 print:text-sm mt-1">
                              R$ {metricsVencimento.totalAcima30.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </span>
                            <span className="text-[10px] text-amber-500/70 print:text-slate-500">{metricsVencimento.acima30} título(s)</span>
                          </div>
                          <div className="flex flex-col bg-orange-500/10 border border-orange-500/30 rounded-xl print:rounded print:border-orange-400 px-4 py-3 print:px-3 print:py-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-orange-400 print:text-orange-700">+ 60 dias em aberto</span>
                            <span className="text-xl font-black text-orange-300 print:text-slate-900 print:text-sm mt-1">
                              R$ {metricsVencimento.totalAcima60.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </span>
                            <span className="text-[10px] text-orange-500/70 print:text-slate-500">{metricsVencimento.acima60} título(s)</span>
                          </div>
                          <div className="flex flex-col bg-red-500/10 border border-red-500/30 rounded-xl print:rounded print:border-red-400 px-4 py-3 print:px-3 print:py-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-red-400 print:text-red-700">+ 90 dias em aberto</span>
                            <span className="text-xl font-black text-red-400 print:text-slate-900 print:text-sm mt-1">
                              R$ {metricsVencimento.totalAcima90.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </span>
                            <span className="text-[10px] text-red-500/70 print:text-slate-500">{metricsVencimento.acima90} título(s)</span>
                          </div>
                        </div>

                        {/* TOTAL GERAL */}
                        <div className="flex justify-between items-center bg-slate-900/80 print:bg-transparent border border-slate-700/50 print:border-slate-400 rounded-xl print:rounded-none px-6 py-4 print:px-4 print:py-2">
                          <div>
                            <p className="text-xs uppercase font-bold tracking-wider text-slate-400 print:text-slate-600">
                              Total Geral de Títulos a Receber
                            </p>
                            <p className="text-sm text-slate-500 print:text-slate-500 print:text-[10px]">
                              {gruposRecebimentos.length} cliente(s) &bull; {contasFiltradas.length} título(s)
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-3xl font-black text-emerald-400 print:text-slate-900 print:text-xl">
                              R$ {totalGeral.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                  ) : (
                    /* A MÁGICA DO FUNDO BRANCO: O print:!bg-transparent remove aquele bloco azul escuro inteiro na impressão */
                    <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl print:rounded-none p-8 print:!p-0 print:!bg-transparent print:shadow-none relative z-10 shadow-lg">

                      {/* BLOCO 1: RESUMO POR CATEGORIA */}
                      <div className="mb-12 print:mb-6">
                        <h4 className="text-lg font-bold text-indigo-400 print:text-slate-900 uppercase tracking-wider mb-4 print:mb-2 print:mt-4 print:pl-2">
                          Resumo por Categoria de Despesa
                        </h4>
                        {/* A MÁGICA DA BORDA: Removido o overflow que cortava a borda e tirado os cantos arredondados */}
                        <div className="overflow-x-auto print:overflow-visible rounded-xl print:rounded-none border border-slate-700/50 print:border-slate-300 print:border shadow-lg shadow-black/20 print:shadow-none print:w-full">
                          <table className="w-full text-left border-collapse whitespace-nowrap">
                            <thead>
                              <tr className="bg-slate-900/80 print:bg-slate-200 print:!bg-slate-200 text-slate-300 print:text-slate-900 text-xs font-bold border-b print:border-b-2 border-slate-700/50 print:border-slate-400">
                                <th className="py-4 print:py-1 px-5 print:px-2 uppercase w-3/4 print:w-auto print:min-w-0">Categoria {menuAtivo === 'contas-pagas' && '/ Conta Corrente'}</th>
                                <th className="py-4 print:py-1 px-5 print:px-2 text-right uppercase w-1/4 min-w-[120px] print:w-auto print:min-w-0">Total {menuAtivo === 'contas-pagas' ? 'Pago' : 'a Pagar'}</th>
                              </tr>
                            </thead>
                            <tbody className="text-sm">
                              {resumoCategorias.map((item, idx) => (
                                <React.Fragment key={idx}>
                                  <tr className={`border-b border-slate-700/30 print:border-slate-300 text-slate-300 print:text-slate-800 hover:bg-slate-800/80 print:hover:bg-transparent transition-colors ${idx % 2 === 0 ? 'print:bg-white' : 'print:bg-slate-50 print:!bg-slate-50'}`}>
                                    <td className="py-3 print:py-1 px-5 print:px-2 font-bold">{item.categoria}</td>
                                    <td className="py-3 print:py-1 px-5 print:px-2 text-right font-bold text-slate-200 print:text-slate-900">
                                      R$ {item.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                    </td>
                                  </tr>

                                  {menuAtivo === 'contas-pagas' && item.contasCorrentes.map((ccItem, ccIdx) => (
                                    <tr key={`cc-${idx}-${ccIdx}`} className="border-b border-slate-700/10 print:border-slate-200 bg-slate-900/40 print:bg-transparent">
                                      <td className="py-2 print:py-1 px-5 print:px-2 pl-12 text-slate-400 print:text-slate-600 text-xs flex items-center gap-2 border-l-2 border-indigo-500/30 ml-4">
                                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 print:bg-slate-400"></div> {ccItem.cc}
                                      </td>
                                      <td className="py-2 print:py-1 px-5 print:px-2 text-right text-slate-400 print:text-slate-600 text-xs">
                                        R$ {ccItem.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                      </td>
                                    </tr>
                                  ))}
                                </React.Fragment>
                              ))}
                              <tr className="bg-slate-800/80 print:bg-slate-200 print:!bg-slate-200 border-t-2 border-slate-600 print:border-b-2 print:border-slate-800">
                                <td className="py-4 print:py-2 px-5 print:px-2 text-right font-bold text-slate-300 print:text-slate-900 uppercase text-lg">
                                  Total Geral
                                </td>
                                <td className="py-4 print:py-2 px-5 print:px-2 text-right font-bold text-emerald-400 print:text-slate-900 text-lg">
                                  R$ {totalGeral.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* BLOCO 2: DETALHAMENTO */}
                      <h3 className="text-xl font-bold text-indigo-400 mb-4 print:text-slate-900 uppercase tracking-wider print:mb-2 print:mt-4 print:pl-2">Detalhamento Financeiro (Previsão de Fluxo)</h3>
                      <div className="overflow-x-auto print:overflow-visible rounded-xl print:rounded-none border border-slate-700/50 print:border-slate-300 print:border shadow-lg shadow-black/20 print:shadow-none print:w-full">
                        <table className="w-full text-left border-collapse whitespace-nowrap">
                          <thead>
                            <tr className="bg-slate-900/80 print:bg-slate-200 print:!bg-slate-200 text-slate-300 print:text-slate-900 text-xs font-bold border-b print:border-b-2 border-slate-700/50 print:border-slate-400">
                              {/* A MÁGICA DA LARGURA: O print:w-auto desabilita as larguras de tela, impedindo que a tabela "vaze" para fora da folha A4 e suma a borda */}
                              <th className="py-4 print:py-1 px-5 print:px-2 text-center w-28 print:w-auto print:min-w-0">Data Emissão</th>
                              <th className="py-4 print:py-1 px-5 print:px-2 w-1/4 min-w-[200px] print:w-auto print:min-w-0">Categoria</th>
                              <th className="py-4 print:py-1 px-5 print:px-2 w-1/3 min-w-[250px] print:w-auto print:min-w-0">Fornecedor</th>
                              <th className="py-4 print:py-1 px-5 print:px-2 text-center w-28 print:w-auto print:min-w-0">{menuAtivo === 'contas-pagas' ? 'Data Pagto' : 'Vencimento'}</th>
                              {menuAtivo === 'contas-pagas' && <th className="py-4 print:py-1 px-5 print:px-2 w-1/5 min-w-[150px] print:w-auto print:min-w-0">Conta Corrente</th>}
                              <th className="py-4 print:py-1 px-5 print:px-2 text-center w-24 print:w-auto print:min-w-0">Nº Nota</th>
                              <th className="py-4 print:py-1 px-5 print:px-2 text-center w-20 print:w-auto print:min-w-0">Parcela</th>
                              <th className="py-4 print:py-1 px-5 print:px-2 text-right w-32 print:w-auto print:min-w-0">Valor</th>
                            </tr>
                          </thead>
                          <tbody className="text-sm">
                            {dadosAgrupados.map((grupo, gIdx) => (
                              <React.Fragment key={gIdx}>
                                {grupo.contas.map((conta, cIdx) => (
                                  <tr key={`${gIdx}-${cIdx}`} className={`border-b border-slate-700/30 print:border-slate-300 text-slate-400 print:text-slate-800 text-xs hover:bg-slate-800/80 print:hover:bg-transparent transition-colors ${cIdx % 2 === 0 ? 'print:bg-white' : 'print:bg-slate-50 print:!bg-slate-50'}`}>
                                    <td className="py-3 print:py-1 px-5 print:px-2 text-center">{formatarDataComDia(conta.data_emissao)}</td>
                                    <td className="py-3 print:py-1 px-5 print:px-2 truncate max-w-[200px] print:max-w-none">{conta.desc_categoria}</td>
                                    <td className="py-3 print:py-1 px-5 print:px-2 truncate max-w-[250px] print:max-w-none font-medium text-slate-300 print:text-slate-900">{conta.nome_fornecedor}</td>
                                    <td className="py-3 print:py-1 px-5 print:px-2 text-center font-medium text-slate-300 print:text-slate-800">{menuAtivo === 'contas-pagas' ? formatarDataComDia(conta.data_pagamento_br) : formatarDataComDia(conta.data_previsao_br)}</td>
                                    {menuAtivo === 'contas-pagas' && <td className="py-3 print:py-1 px-5 print:px-2 text-slate-300 truncate max-w-[150px] print:max-w-none">{conta.conta_corrente}</td>}
                                    <td className="py-3 print:py-1 px-5 print:px-2 text-center">{conta.numero_documento_fiscal}</td>
                                    <td className="py-3 print:py-1 px-5 print:px-2 text-center">{conta.numero_parcela}</td>
                                    <td className="py-3 print:py-1 px-5 print:px-2 text-right font-bold text-slate-200 print:text-slate-900">
                                      R$ {(menuAtivo === 'contas-pagas' ? conta.valor_pago : conta.saldo_devedor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                    </td>
                                  </tr>
                                ))}
                                <tr className="bg-slate-800/60 print:bg-slate-100 print:!bg-slate-100 border-b-2 border-slate-600 print:border-slate-400">
                                  <td colSpan={menuAtivo === 'contas-pagas' ? "7" : "6"} className="py-4 print:py-2 px-5 print:px-2 text-right font-bold text-slate-300 print:text-slate-900 text-xs uppercase">
                                    Subtotal de {grupo.dataReferencia}
                                  </td>
                                  <td className="py-4 print:py-2 px-5 print:px-2 text-right font-bold text-emerald-400 print:text-slate-900">
                                    R$ {grupo.subtotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                  </td>
                                </tr>
                              </React.Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {totalPaginas > 1 && (
                    <div className="flex items-center justify-between bg-slate-900/80 border border-slate-700/50 p-4 rounded-xl mt-6 print:hidden">
                      <p className="text-sm text-slate-400">
                        Mostrando <span className="text-white font-bold">{indiceInicio + 1}</span> até <span className="text-white font-bold">{Math.min(indiceFim, totalItems)}</span> de <span className="text-white font-bold">{totalItems}</span> {menuAtivo === 'recebimentos' ? 'clientes' : 'registros'}.
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setPaginaAtual(prev => Math.max(prev - 1, 1))}
                          disabled={paginaAtual === 1}
                          className="p-2 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronLeft size={18} />
                        </button>
                        <span className="text-sm font-medium text-slate-300 px-4">
                          Página {paginaAtual} de {totalPaginas}
                        </span>
                        <button
                          onClick={() => setPaginaAtual(prev => Math.min(prev + 1, totalPaginas))}
                          disabled={paginaAtual === totalPaginas}
                          className="p-2 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronRight size={18} />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

            </div>

  );
}
