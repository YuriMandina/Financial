import React, { useState, useEffect, useMemo } from 'react';
import { 
  CalendarDays, Plus, Trash2, ShieldCheck, MapPin, 
  Sparkles, AlertCircle, RefreshCw, X, CheckCircle2, RotateCw
} from 'lucide-react';

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

export default function RHFeriadosView({ token, apiBase, onRefreshSchedule }) {
  // ==============================================================================
  // --- [BLOCO: ESTADOS PRINCIPAIS] ---
  // ==============================================================================

  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [feedbackMsg, setFeedbackMsg] = useState('');

  // Modal de Cadastro de Feriado Recorrente (Dia e Mês)
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    month: 1,
    day: 1,
    name: '',
    category: 'MUNICIPAL'
  });

  // ==============================================================================
  // --- [BLOCO: CARREGAMENTO DE DADOS (FETCH)] ---
  // ==============================================================================

  const fetchHolidays = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${apiBase}/api/rh/holidays`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Falha ao carregar feriados');
      const data = await res.json();
      setHolidays(data || []);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Erro de comunicação');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHolidays();
  }, []);

  // ==============================================================================
  // --- [BLOCO: CADASTRO E EXCLUSÃO DE FERIADOS] ---
  // ==============================================================================

  const handleOpenAddModal = (defaultMonth = 1) => {
    setFormData({
      month: defaultMonth,
      day: 1,
      name: '',
      category: 'MUNICIPAL'
    });
    setModalOpen(true);
  };

  const handleCreateHoliday = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      alert('Preencha o nome do feriado.');
      return;
    }

    const mm = String(formData.month).padStart(2, '0');
    const dd = String(formData.day).padStart(2, '0');
    const dateStr = `${mm}-${dd}`;

    try {
      setSubmitting(true);
      const categoryLabel = formData.category === 'MUNICIPAL' 
        ? 'Municipal' 
        : formData.category === 'ESTADUAL' 
        ? 'Estadual' 
        : 'Facultativo';

      const displayName = formData.category !== 'NACIONAL' 
        ? `${formData.name.trim()} (${categoryLabel})`
        : formData.name.trim();

      const res = await fetch(`${apiBase}/api/rh/holidays`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          date: dateStr,
          name: displayName
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Erro ao cadastrar feriado');
      }

      setModalOpen(false);
      setFeedbackMsg('Feriado recorrente cadastrado com sucesso!');
      setTimeout(() => setFeedbackMsg(''), 4000);
      await fetchHolidays();
      if (onRefreshSchedule) onRefreshSchedule();
    } catch (err) {
      alert('Falha ao salvar feriado: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteHoliday = async (h) => {
    if (!h.db_id) return;
    if (!confirm(`Deseja realmente excluir o feriado "${h.name}"?`)) return;

    try {
      const res = await fetch(`${apiBase}/api/rh/holidays/${h.db_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Erro ao excluir feriado');

      setFeedbackMsg('Feriado removido com sucesso!');
      setTimeout(() => setFeedbackMsg(''), 4000);
      await fetchHolidays();
      if (onRefreshSchedule) onRefreshSchedule();
    } catch (err) {
      alert('Falha ao excluir feriado: ' + err.message);
    }
  };

  // ==============================================================================
  // --- [BLOCO: AGRUPAMENTO POR MÊS] ---
  // ==============================================================================

  const holidaysByMonth = useMemo(() => {
    const map = {};
    for (let m = 1; m <= 12; m++) {
      map[m] = [];
    }
    holidays.forEach((h) => {
      const m = Number(h.month);
      if (map[m]) {
        map[m].push(h);
      }
    });
    return map;
  }, [holidays]);

  const totalNationals = useMemo(() => holidays.filter((h) => h.is_national).length, [holidays]);
  const totalCustom = useMemo(() => holidays.filter((h) => !h.is_national).length, [holidays]);

  // ==============================================================================
  // --- [BLOCO: RENDERIZAÇÃO DA INTERFACE] ---
  // ==============================================================================

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Barra de Topo: Informações e Ações */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <CalendarDays className="text-indigo-400" size={20} />
            Feriados & Folgas Recorrentes
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Calendário permanente: todos os feriados nacionais, estaduais e municipais repetem-se automaticamente em qualquer ano da escala.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-300">
            <RotateCw size={13} className="text-emerald-400 animate-spin" style={{ animationDuration: '8s' }} />
            <span>Validade: <strong>Perpétua / Todos os Anos</strong></span>
          </div>

          <button
            onClick={() => handleOpenAddModal(new Date().getMonth() + 1)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 transition-all"
          >
            <Plus size={15} />
            Novo Feriado Local
          </button>
        </div>
      </div>

      {/* Cartões Informativos de Resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-400 uppercase font-semibold tracking-wider">Total de Feriados Anuais</span>
            <p className="text-2xl font-black text-white mt-0.5">{holidays.length}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <CalendarDays size={20} />
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-400 uppercase font-semibold tracking-wider">Nacionais Federais</span>
            <p className="text-2xl font-black text-sky-400 mt-0.5">{totalNationals}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
            <ShieldCheck size={20} />
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-400 uppercase font-semibold tracking-wider">Locais / Cadastrados</span>
            <p className="text-2xl font-black text-emerald-400 mt-0.5">{totalCustom}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <MapPin size={20} />
          </div>
        </div>
      </div>

      {feedbackMsg && (
        <div className="bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs px-4 py-2.5 rounded-xl flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 size={16} />
          {feedbackMsg}
        </div>
      )}

      {/* Grid dos 12 Meses Perenes */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3 animate-pulse">
              <div className="h-4 bg-slate-800 rounded w-1/3"></div>
              <div className="h-10 bg-slate-800/60 rounded"></div>
              <div className="h-10 bg-slate-800/60 rounded"></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {MONTH_NAMES.map((monthName, idx) => {
            const mNum = idx + 1;
            const mHolidays = holidaysByMonth[mNum] || [];

            return (
              <div
                key={mNum}
                className={`bg-slate-900/80 border rounded-xl overflow-hidden transition-all ${
                  mHolidays.length > 0
                    ? 'border-slate-800 hover:border-slate-700 shadow-sm'
                    : 'border-slate-850 opacity-70 hover:opacity-100'
                }`}
              >
                {/* Cabeçalho do Mês */}
                <div className="bg-slate-950/70 px-4 py-2.5 border-b border-slate-800/80 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      {monthName}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      (Mês {String(mNum).padStart(2, '0')})
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      mHolidays.length > 0
                        ? 'bg-indigo-950 text-indigo-300 border border-indigo-800/50'
                        : 'bg-slate-800/60 text-slate-500'
                    }`}>
                      {mHolidays.length} {mHolidays.length === 1 ? 'feriado' : 'feriados'}
                    </span>
                    <button
                      onClick={() => handleOpenAddModal(mNum)}
                      className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition-colors"
                      title={`Adicionar feriado recorrente em ${monthName}`}
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                </div>

                {/* Lista de Feriados no Mês */}
                <div className="p-3 space-y-2">
                  {mHolidays.length === 0 ? (
                    <div className="text-center py-4 text-xs text-slate-500 italic">
                      Nenhum feriado neste mês
                    </div>
                  ) : (
                    mHolidays.map((h) => {
                      return (
                        <div
                          key={h.id}
                          className="bg-slate-950/60 border border-slate-800/80 hover:border-slate-700/80 rounded-lg p-2.5 flex items-center justify-between gap-2 transition-all"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {/* Dia em Destaque */}
                            <div className="flex flex-col items-center justify-center w-8 h-8 rounded-lg bg-indigo-950/60 border border-indigo-700/40 text-indigo-300 shrink-0">
                              <span className="text-xs font-bold leading-none">{h.day}</span>
                            </div>

                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-slate-200 truncate" title={h.name}>
                                {h.name}
                              </p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {h.is_national ? (
                                  h.is_movable ? (
                                    <span className="inline-flex items-center gap-1 text-[9px] font-medium text-amber-400 bg-amber-950/60 border border-amber-800/50 px-1.5 py-0.2 rounded">
                                      <ShieldCheck size={10} />
                                      Móvel Federal
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-[9px] font-medium text-sky-400 bg-sky-950/60 border border-sky-800/50 px-1.5 py-0.2 rounded">
                                      <ShieldCheck size={10} />
                                      Nacional Federal
                                    </span>
                                  )
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[9px] font-medium text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 px-1.5 py-0.2 rounded">
                                    <MapPin size={10} />
                                    Local Recorrente
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Ação de Exclusão para Feriados Customizados */}
                          {h.can_delete && h.db_id && (
                            <button
                              onClick={() => handleDeleteHoliday(h)}
                              className="text-slate-500 hover:text-rose-400 p-1 rounded hover:bg-slate-800 transition-colors shrink-0"
                              title="Remover feriado local"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ============================================================================== */}
      {/* --- [MODAL: CADASTRO DE FERIADO RECORRENTE (DIA E MÊS)] --- */}
      {/* ============================================================================== */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-start justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
                <CalendarDays size={18} />
                Cadastrar Feriado Permanente
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              O feriado será cadastrado por <strong>Dia e Mês</strong> e se repetirá automaticamente em todos os anos futuros e passados da escala.
            </p>

            <form onSubmit={handleCreateHoliday} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Nome do Feriado</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: São Sebastião, Aniversário do Município"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Mês</label>
                  <select
                    value={formData.month}
                    onChange={(e) => setFormData({ ...formData, month: parseInt(e.target.value, 10) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                  >
                    {MONTH_NAMES.map((mName, mIdx) => (
                      <option key={mIdx + 1} value={mIdx + 1}>
                        {mName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Dia do Mês</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    required
                    value={formData.day}
                    onChange={(e) => setFormData({ ...formData, day: parseInt(e.target.value, 10) || 1 })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">Âmbito / Categoria</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="MUNICIPAL">Feriado Municipal</option>
                  <option value="ESTADUAL">Feriado Estadual</option>
                  <option value="FACULTATIVO">Ponto Facultativo</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg text-slate-400 hover:text-white bg-slate-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow shadow-indigo-600/30 transition-all disabled:opacity-50"
                >
                  {submitting ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
                  {submitting ? 'Salvando...' : 'Salvar Feriado Permanente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
