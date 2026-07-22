import React from 'react';
import { X, History, RotateCcw, Loader2, Printer } from 'lucide-react';

export default function ModalHistoricoRecibos({ modalHistoricoRecibosAberto, setModalHistoricoRecibosAberto, historicoRecibos, filtroHistoricoCliente, setFiltroHistoricoCliente, filtroHistoricoData, setFiltroHistoricoData, carregandoHistorico, handleDesfazerBaixa, setReciboGerado }) {
  return (
    <>
{/* MODAL HISTORICO DE RECIBOS */}
        {modalHistoricoRecibosAberto && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
              <div className="p-6 border-b border-slate-800 flex flex-col sm:flex-row sm:justify-between sm:items-center bg-slate-900 gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-white">Histórico de Recibos</h2>
                  <p className="text-sm text-slate-400 font-medium">Consulte, imprima ou desfaça recebimentos anteriores</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex bg-slate-800/50 border border-white/[0.05] rounded-xl p-1 shadow-sm gap-2">
                    <input 
                      type="text" 
                      placeholder="Cliente..." 
                      className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none w-32 md:w-48"
                      value={filtroHistoricoCliente}
                      onChange={(e) => setFiltroHistoricoCliente(e.target.value)}
                    />
                    <input 
                      type="date" 
                      className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none [color-scheme:dark]"
                      value={filtroHistoricoData}
                      onChange={(e) => setFiltroHistoricoData(e.target.value)}
                    />
                  </div>
                  <button onClick={() => setModalHistoricoRecibosAberto(false)} className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400">
                    <X size={24} />
                  </button>
                </div>
              </div>

              <div className="p-6 overflow-y-auto bg-slate-950 flex-1">
                <div className="bg-slate-900 rounded-xl shadow-lg border border-slate-800 overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-800/50 border-b border-slate-800">
                        <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase">ID</th>
                        <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase">Cliente</th>
                        <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase">Data Pgto</th>
                        <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase">Valor Total</th>
                        <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {carregandoHistorico ? (
                        <tr><td colSpan="5" className="text-center py-8 text-slate-400"><Loader2 className="animate-spin mx-auto" /></td></tr>
                      ) : (
                        historicoRecibos.filter(r => {
                          const matchCli = r.cliente.toLowerCase().includes(filtroHistoricoCliente.toLowerCase());
                          const dataFiltroBr = filtroHistoricoData ? filtroHistoricoData.split('-').reverse().join('/') : '';
                          const matchData = dataFiltroBr ? r.data_pagamento === dataFiltroBr : true;
                          return matchCli && matchData;
                        }).map(rec => (
                          <tr key={rec.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                            <td className="px-4 py-3 text-sm text-slate-400 font-medium">#{rec.id}</td>
                            <td className="px-4 py-3 text-sm text-slate-300 font-bold">{rec.cliente}</td>
                            <td className="px-4 py-3 text-sm text-slate-400">{rec.data_pagamento}</td>
                            <td className="px-4 py-3 text-sm text-emerald-400 font-bold">R$ {rec.totalPago.toLocaleString('pt-BR', {minimumFractionDigits:2})}</td>
                            <td className="px-4 py-3 text-sm text-right flex justify-end gap-2">
                              <button onClick={() => handleDesfazerBaixa(rec)} className="bg-red-500/10 text-red-400 hover:bg-red-500/20 px-3 py-1.5 rounded font-bold text-xs transition-colors flex items-center gap-1">
                                <RotateCcw size={14} /> Desfazer
                              </button>
                              <button onClick={() => { setReciboGerado(rec); setModalHistoricoRecibosAberto(false); }} className="bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 px-3 py-1.5 rounded font-bold text-xs transition-colors flex items-center gap-1">
                                <Printer size={14} /> Abrir Recibo
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                      {!carregandoHistorico && historicoRecibos.length === 0 && (
                        <tr>
                          <td colSpan="5" className="px-4 py-8 text-center text-slate-400 font-medium">Nenhum recibo salvo.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        
    </>
  );
}
