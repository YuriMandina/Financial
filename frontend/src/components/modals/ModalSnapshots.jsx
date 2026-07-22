import React from 'react';
import { X, Database, CalendarDays, Trash2, RefreshCw, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react';
import DateRangePicker from '../common/DateRangePicker';

export default function ModalSnapshots({ modalSnapshotsAberto, setModalSnapshotsAberto, paginaSnapshots, setPaginaSnapshots, registrosPorPaginaSnapshots, setRegistrosPorPaginaSnapshots, modalDataInicial, setModalDataInicial, modalDataFinal, setModalDataFinal, handleDeletarSnapshot, handleResincronizarSnapshot, snapshotsPaginados, totalPaginasSnapshots, totalSnapshots }) {
  return (
    <>
{/* MODAL SNAPSHOTS */}
        {modalSnapshotsAberto && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
              <div className="p-6 border-b border-slate-800 flex flex-col sm:flex-row sm:justify-between sm:items-center bg-slate-900 gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-white">Base de Dados Sincronizada</h2>
                  <p className="text-sm text-slate-400 font-medium">Gerencie o histórico de dados já importados por dia</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="bg-slate-800/50 border border-white/[0.05] rounded-xl p-1 shadow-sm">
                    <DateRangePicker
                      startValue={modalDataInicial}
                      endValue={modalDataFinal}
                      onStartChange={(val) => { setModalDataInicial(val); setPaginaSnapshots(1); }}
                      onEndChange={(val) => { setModalDataFinal(val); setPaginaSnapshots(1); }}
                    />
                  </div>
                  <button onClick={() => setModalSnapshotsAberto(false)} className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400">
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
                        <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase">Relatório</th>
                        <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase">Data Ref.</th>
                        <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase">Sincronizado Em</th>
                        <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshotsPaginados.map(snap => (
                        <tr key={snap.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                          <td className="px-4 py-3 text-sm text-slate-400 font-medium">{snap.id}</td>
                          <td className="px-4 py-3 text-sm text-slate-300 font-bold">{snap.tipo_relatorio}</td>
                          <td className="px-4 py-3 text-sm text-indigo-400 font-bold">{snap.data_referencia}</td>
                          <td className="px-4 py-3 text-sm text-slate-500">{snap.created_at}</td>
                          <td className="px-4 py-3 text-sm text-right flex justify-end gap-2">
                            <button onClick={() => handleDeletarSnapshot(snap.id)} className="bg-red-500/10 text-red-400 hover:bg-red-500/20 px-3 py-1.5 rounded font-bold text-xs transition-colors">Excluir</button>
                            <button onClick={() => handleResincronizarSnapshot(snap)} className="bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 px-3 py-1.5 rounded font-bold text-xs transition-colors flex items-center gap-1">
                              <RotateCcw size={14} /> Resincronizar
                            </button>
                          </td>
                        </tr>
                      ))}
                      {snapshotsPaginados.length === 0 && (
                        <tr>
                          <td colSpan="5" className="px-4 py-8 text-center text-slate-400 font-medium">Nenhum dado sincronizado encontrado para este relatório.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {totalSnapshots > 0 && (
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-4 bg-slate-900 p-4 rounded-xl shadow-lg border border-slate-800">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-400">Mostrar</span>
                      <select 
                        className="border border-slate-700 rounded p-1 text-sm text-slate-300 bg-slate-800 outline-none"
                        value={registrosPorPaginaSnapshots}
                        onChange={(e) => {
                          setRegistrosPorPaginaSnapshots(Number(e.target.value));
                          setPaginaSnapshots(1);
                        }}
                      >
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                      </select>
                      <span className="text-sm text-slate-400">por página</span>
                    </div>

                    <div className="flex items-center gap-4">
                      <span className="text-sm font-medium text-slate-400">
                        Página {paginaSnapshots} de {totalPaginasSnapshots}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setPaginaSnapshots(p => Math.max(1, p - 1))}
                          disabled={paginaSnapshots === 1}
                          className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <button
                          onClick={() => setPaginaSnapshots(p => Math.min(totalPaginasSnapshots, p + 1))}
                          disabled={paginaSnapshots === totalPaginasSnapshots}
                          className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
    </>
  );
}
