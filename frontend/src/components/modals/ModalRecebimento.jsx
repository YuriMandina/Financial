import React from 'react';
import { Zap, ArrowDownToLine, Loader2 } from 'lucide-react';
import { converterDataBrParaDate, formatarDataComDia } from '../../utils/formatters';

export default function ModalRecebimento({ modalBaixa, setModalBaixa, calcularTotaisModal, descGlobalTipo, setDescGlobalTipo, descGlobalValor, setDescGlobalValor, jurosGlobalTipo, setJurosGlobalTipo, jurosGlobalValor, setJurosGlobalValor, valorTotalRecebido, setValorTotalRecebido, aplicarRateioGlobal, detalhesPagamento, handleAlterarDetalhe, contaDestino, setContaDestino, listaBancos, dataPagamento, setDataPagamento, processandoBaixa, handleEfetuarBaixaLote }) {
  const getHojeBR = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().split('T')[0];
  };

  return (
    <>
{/* MODAL 1: INFORMADOR DE PAGAMENTO */}
        {modalBaixa.aberto && (
          <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center print:hidden p-4">
            <div className="bg-slate-900 border border-slate-700 p-8 rounded-2xl max-w-5xl w-full shadow-2xl overflow-y-auto max-h-[90vh]">
              <h3 className="text-2xl font-bold text-white mb-1">Confirmação de Recebimento</h3>
              <p className="text-slate-400 mb-6">Ajuste os valores pagos para o cliente <span className="text-indigo-400 font-bold">{modalBaixa.cliente}</span></p>

              {(() => {
                const { totalOriginal, totalPago } = calcularTotaisModal();
                return (
                  <>
                    <div className="grid grid-cols-2 gap-4 mb-6">
                      <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                        <p className="text-sm text-slate-400 font-medium">Qtd. Notas Selecionadas</p>
                        <p className="text-xl font-bold text-white">{modalBaixa.contas.length} nota(s)</p>
                      </div>
                      <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 flex justify-between items-center">
                        <div>
                          <p className="text-sm text-slate-400 font-medium">Subtotal Original</p>
                          <p className="text-xl font-bold text-slate-300">R$ {totalOriginal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-800/80 p-5 rounded-xl border border-slate-600 mb-6">
                      <div className="flex items-center gap-2 mb-4">
                        <Zap size={18} className="text-amber-400" />
                        <h4 className="text-white font-bold text-sm uppercase tracking-wider">Automação de Rateio (Cascata / FIFO)</h4>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                        <div className="col-span-1">
                          <label className="block text-xs font-medium text-slate-400 mb-1">Desc. Taxa Cartão</label>
                          <div className="flex bg-slate-900 border border-slate-600 rounded-lg overflow-hidden focus-within:border-indigo-500">
                            <select value={descGlobalTipo} onChange={e => setDescGlobalTipo(e.target.value)} className="bg-slate-700 text-white px-2 py-2 text-sm focus:outline-none border-none">
                              <option value="VALOR">R$</option>
                              <option value="PERCENTUAL">%</option>
                            </select>
                            <input type="number" min="0" placeholder="Ex: 1.99" value={descGlobalValor} onChange={e => setDescGlobalValor(e.target.value)} className="w-full bg-transparent px-2 py-2 text-white outline-none text-sm" />
                          </div>
                        </div>
                        <div className="col-span-1">
                          <label className="block text-xs font-medium text-slate-400 mb-1">Juros / Multa</label>
                          <div className="flex bg-slate-900 border border-slate-600 rounded-lg overflow-hidden focus-within:border-indigo-500">
                            <select value={jurosGlobalTipo} onChange={e => setJurosGlobalTipo(e.target.value)} className="bg-slate-700 text-white px-2 py-2 text-sm focus:outline-none border-none">
                              <option value="VALOR">R$</option>
                              <option value="PERCENTUAL">%</option>
                            </select>
                            <input type="number" min="0" placeholder="Ex: 5.00" value={jurosGlobalValor} onChange={e => setJurosGlobalValor(e.target.value)} className="w-full bg-transparent px-2 py-2 text-white outline-none text-sm" />
                          </div>
                        </div>
                        <div className="col-span-1">
                          <label className="block text-xs font-medium text-emerald-400 mb-1">Valor Físico Recebido (R$)</label>
                          <div className="flex bg-slate-900 border border-emerald-500/50 rounded-lg overflow-hidden focus-within:border-emerald-500">
                            <span className="bg-emerald-900/30 text-emerald-400 px-3 py-2 text-sm font-bold">R$</span>
                            <input type="number" min="0" placeholder="Ex: 500.00" value={valorTotalRecebido} onChange={e => setValorTotalRecebido(e.target.value)} className="w-full bg-transparent px-2 py-2 text-emerald-400 font-bold outline-none text-sm placeholder-emerald-800" />
                          </div>
                        </div>
                        <div className="col-span-1">
                          <button onClick={aplicarRateioGlobal} className="w-full bg-slate-700 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold transition-colors border border-slate-600 hover:border-indigo-500 h-[38px] text-sm flex justify-center items-center gap-2">
                            <ArrowDownToLine size={16} /> Distribuir
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="mb-6 overflow-x-auto rounded-xl border border-slate-700">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-800 text-slate-300 text-xs font-bold border-b border-slate-700">
                            <th className="py-3 px-4 w-28">Vencimento</th>
                            <th className="py-3 px-4">Nota / Parcela</th>
                            <th className="py-3 px-4 text-right">Saldo Devedor</th>
                            <th className="py-3 px-4 text-right w-28">Desc (R$)</th>
                            <th className="py-3 px-4 text-right w-28">Juros (R$)</th>
                            <th className="py-3 px-4 text-right w-32">A Pagar (R$)</th>
                          </tr>
                        </thead>
                        <tbody className="text-sm">
                          {[...modalBaixa.contas].sort((a, b) => converterDataBrParaDate(a.data_previsao_br) - converterDataBrParaDate(b.data_previsao_br)).map(conta => {
                            const det = detalhesPagamento[conta.codigo_lancamento] || { valor: '', desconto: '', juros: '' };
                            const isZerada = det.valor === 0 || det.valor === '';

                            return (
                              <tr key={conta.codigo_lancamento} className={`border-b border-slate-700/50 hover:bg-slate-800/30 transition-colors ${isZerada ? 'opacity-50' : ''}`}>
                                <td className="py-2 px-4 text-indigo-300 font-mono text-xs">{formatarDataComDia(conta.data_previsao_br)}</td>
                                <td className="py-2 px-4 text-slate-300">{conta.numero_documento_fiscal} - {conta.numero_parcela}</td>
                                <td className="py-2 px-4 text-right text-slate-400">R$ {conta.saldo_devedor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                <td className="py-2 px-4 text-right">
                                  <input
                                    type="number"
                                    min="0" step="0.01"
                                    value={det.desconto}
                                    onChange={(e) => handleAlterarDetalhe(conta.codigo_lancamento, 'desconto', e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-right outline-none focus:border-indigo-500"
                                  />
                                </td>
                                <td className="py-2 px-4 text-right">
                                  <input
                                    type="number"
                                    min="0" step="0.01"
                                    value={det.juros}
                                    onChange={(e) => handleAlterarDetalhe(conta.codigo_lancamento, 'juros', e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-right outline-none focus:border-indigo-500"
                                  />
                                </td>
                                <td className="py-2 px-4 text-right">
                                  <input
                                    type="number"
                                    min="0" step="0.01"
                                    value={det.valor}
                                    onChange={(e) => handleAlterarDetalhe(conta.codigo_lancamento, 'valor', e.target.value)}
                                    className={`w-full border rounded px-2 py-1 font-bold text-right outline-none ${isZerada ? 'bg-slate-900 border-slate-700 text-slate-500' : 'bg-indigo-900/50 border-indigo-500/50 text-emerald-400 focus:border-emerald-500'}`}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="bg-indigo-900/30 p-4 rounded-xl border border-indigo-500/30 mb-6 flex justify-between items-center">
                      <p className="text-indigo-200 font-medium">Total do Recebimento</p>
                      <p className="text-3xl font-black text-emerald-400">R$ {totalPago.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-6 mb-8">
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Conta de Destino</label>
                        <select value={contaDestino} onChange={e => setContaDestino(e.target.value)} className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-white text-sm">
                          <option value="">Selecione...</option>
                          {listaBancos.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Data</label>
                        <input type="date" max={getHojeBR()} value={dataPagamento} onChange={e => setDataPagamento(e.target.value)} className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-white text-sm [color-scheme:dark]" />
                      </div>
                    </div>
                  </>
                )
              })()}

              <div className="flex gap-4">
                <button onClick={() => setModalBaixa({ aberto: false, cliente: '', contas: [] })} className="flex-1 px-4 py-3 rounded-lg font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 transition">Cancelar</button>
                <button onClick={handleEfetuarBaixaLote} disabled={processandoBaixa || !contaDestino || !dataPagamento} className="flex-1 px-4 py-3 rounded-lg font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition disabled:opacity-50 flex justify-center items-center gap-2">
                  {processandoBaixa ? <><Loader2 size={18} className="animate-spin" /> Processando...</> : 'Confirmar Recebimento'}
                </button>
              </div>
            </div>
          </div>
        )}

        
    </>
  );
}
