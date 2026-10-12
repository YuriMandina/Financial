import React, { useState } from 'react';
import { Clock, Plus, Trash2, Edit2, CheckCircle2, AlertCircle, X, RotateCcw } from 'lucide-react';
import TimePicker from '../../../components/common/TimePicker';

// ==============================================================================
// --- [BLOCO: MODAL DE GESTÃO, EDIÇÃO E CADASTRO DE TURNOS (RHShiftModal)] ---
// ==============================================================================

const INITIAL_FORM = {
  name: '',
  code: '',
  start_time: '08:00',
  lunch_start: '12:00',
  lunch_end: '13:00',
  end_time: '17:00',
  net_hours: 8.0,
  is_default: false,
  description: ''
};

export default function RHShiftModal({
  isOpen,
  onClose,
  shifts = [],
  token,
  onShiftCreated,
  onShiftDeleted
}) {
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [editingShiftId, setEditingShiftId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  if (!isOpen) return null;

  // --- [BLOCO: CÁLCULO DINÂMICO DE HORAS LÍQUIDAS] ---
  const calculateNetHours = (start, lunchS, lunchE, end) => {
    if (!start || !end) return 8.0;
    try {
      const [sh, sm] = start.split(':').map(Number);
      const [eh, em] = end.split(':').map(Number);
      let totalMinutes = (eh * 60 + em) - (sh * 60 + sm);
      if (totalMinutes < 0) totalMinutes += 24 * 60; // Caso vire a noite

      if (lunchS && lunchE) {
        const [lsh, lsm] = lunchS.split(':').map(Number);
        const [leh, lem] = lunchE.split(':').map(Number);
        let lunchMinutes = (leh * 60 + lem) - (lsh * 60 + lsm);
        if (lunchMinutes < 0) lunchMinutes += 24 * 60;
        totalMinutes -= lunchMinutes;
      }
      return Math.max(0, Math.round((totalMinutes / 60) * 10) / 10);
    } catch {
      return 8.0;
    }
  };

  const handleTimeChange = (field, value) => {
    const updated = { ...formData, [field]: value };
    const autoHours = calculateNetHours(
      field === 'start_time' ? value : updated.start_time,
      field === 'lunch_start' ? value : updated.lunch_start,
      field === 'lunch_end' ? value : updated.lunch_end,
      field === 'end_time' ? value : updated.end_time
    );
    updated.net_hours = autoHours;
    setFormData(updated);
  };

  // Iniciar modo de edição
  const handleStartEdit = (shift) => {
    setEditingShiftId(shift.id);
    setFormData({
      name: shift.name || '',
      code: shift.code || '',
      start_time: shift.start_time || '08:00',
      lunch_start: shift.lunch_start || '',
      lunch_end: shift.lunch_end || '',
      end_time: shift.end_time || '17:00',
      net_hours: shift.net_hours || 8.0,
      is_default: Boolean(shift.is_default),
      description: shift.description || ''
    });
    setErrorMessage('');
  };

  // Cancelar edição e voltar ao modo de novo cadastro
  const handleCancelEdit = () => {
    setEditingShiftId(null);
    setFormData(INITIAL_FORM);
    setErrorMessage('');
  };

  // Submissão (POST para criar, PUT para editar)
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrorMessage('');

    try {
      const isEditing = Boolean(editingShiftId);
      const url = isEditing
        ? `http://localhost:8000/api/rh/shifts/${editingShiftId}`
        : 'http://localhost:8000/api/rh/shifts';

      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Erro ao salvar turno (Status: ${res.status})`);
      }

      const resultShift = await res.json();
      setFormData(INITIAL_FORM);
      setEditingShiftId(null);

      if (onShiftCreated) onShiftCreated(resultShift);
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (shiftId) => {
    if (!window.confirm('Deseja realmente remover este turno?')) return;
    try {
      const res = await fetch(`http://localhost:8000/api/rh/shifts/${shiftId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Falha ao remover turno');
      }
      if (editingShiftId === shiftId) {
        handleCancelEdit();
      }
      if (onShiftDeleted) onShiftDeleted(shiftId);
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-2xl w-full p-6 shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto overflow-x-hidden">
        
        {/* Topo do Modal */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Clock size={20} className="text-emerald-400" />
            <h3 className="text-base font-bold text-white">Gestão de Turnos & Horários</h3>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="text-slate-400 hover:text-white text-sm px-2 py-1 rounded transition"
          >
            ✕
          </button>
        </div>

        {errorMessage && (
          <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle size={16} />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* --- [BLOCO: FORMULÁRIO DE TURNO (CRIAÇÃO / EDIÇÃO)] --- */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs bg-slate-950/60 p-4 rounded-xl border border-slate-800/90 shadow-sm">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-slate-200 text-xs flex items-center gap-2">
              {editingShiftId ? (
                <>
                  <Edit2 size={14} className="text-indigo-400" />
                  <span className="text-indigo-200">Editar Turno: <strong className="text-white">{formData.name || 'Em edição'}</strong></span>
                </>
              ) : (
                <>
                  <Plus size={14} className="text-emerald-400" />
                  <span>Novo Turno de Trabalho</span>
                </>
              )}
            </h4>
            {editingShiftId && (
              <button
                type="button"
                onClick={handleCancelEdit}
                className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded transition"
              >
                <X size={12} />
                Cancelar Edição
              </button>
            )}
          </div>

          {/* Nome e Sigla */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-slate-400 mb-1">Nome do Turno *</label>
              <input
                type="text"
                required
                placeholder="Ex: Comercial, Abertura Loja, Fechamento"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Sigla / Código *</label>
              <input
                type="text"
                required
                placeholder="Ex: ABRE, T1"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 uppercase font-mono"
              />
            </div>
          </div>

          {/* Horários em Ordem Cronológica: Entrada ➔ Início Intervalo ➔ Fim Intervalo ➔ Saída */}
          <div>
            <label className="block text-slate-400 mb-1.5 font-medium">
              Jornada & Intervalo de Almoço (Ordem Cronológica)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-slate-900/60 p-3 rounded-lg border border-slate-800/80">
              <div>
                <span className="block text-[11px] text-emerald-400 font-semibold mb-1">
                  1. Entrada *
                </span>
                <TimePicker
                  value={formData.start_time}
                  onChange={(val) => handleTimeChange('start_time', val)}
                />
              </div>

              <div>
                <span className="block text-[11px] text-amber-400 font-semibold mb-1">
                  2. Início Intervalo
                </span>
                <TimePicker
                  value={formData.lunch_start}
                  placeholder="--:--"
                  onChange={(val) => handleTimeChange('lunch_start', val)}
                />
              </div>

              <div>
                <span className="block text-[11px] text-amber-400 font-semibold mb-1">
                  3. Fim Intervalo
                </span>
                <TimePicker
                  value={formData.lunch_end}
                  placeholder="--:--"
                  onChange={(val) => handleTimeChange('lunch_end', val)}
                />
              </div>

              <div>
                <span className="block text-[11px] text-emerald-400 font-semibold mb-1">
                  4. Saída *
                </span>
                <TimePicker
                  value={formData.end_time}
                  onChange={(val) => handleTimeChange('end_time', val)}
                />
              </div>
            </div>
          </div>

          {/* Horas Líquidas e Flag Padrão */}
          <div className="grid grid-cols-2 gap-3 items-center">
            <div>
              <label className="block text-slate-400 mb-1">Horas Líquidas Calculadas</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="24"
                required
                value={formData.net_hours}
                onChange={(e) => setFormData({ ...formData, net_hours: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>
            <div className="pt-4 flex items-center gap-2">
              <input
                type="checkbox"
                id="shift_is_default"
                checked={formData.is_default}
                onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0"
              />
              <label htmlFor="shift_is_default" className="text-slate-300 cursor-pointer select-none">
                Definir como turno padrão geral
              </label>
            </div>
          </div>

          {/* Botões de Ação do Form */}
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            {editingShiftId && (
              <button
                type="button"
                onClick={handleCancelEdit}
                className="px-3.5 py-2 rounded-lg text-slate-400 hover:text-white bg-slate-800 transition font-medium"
              >
                Descartar
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className={`
                px-4 py-2 rounded-lg font-semibold text-white flex items-center gap-1.5 transition disabled:opacity-50
                ${editingShiftId
                  ? 'bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/30'
                  : 'bg-emerald-600 hover:bg-emerald-500 shadow-md shadow-emerald-600/30'}
              `}
            >
              {editingShiftId ? (
                <>
                  <CheckCircle2 size={14} />
                  {saving ? 'Atualizando...' : 'Salvar Alterações'}
                </>
              ) : (
                <>
                  <Plus size={14} />
                  {saving ? 'Cadastrando...' : 'Cadastrar Turno'}
                </>
              )}
            </button>
          </div>
        </form>

        {/* --- [BLOCO: LISTA DE TURNOS CADASTRADOS & AÇÕES] --- */}
        <div className="space-y-2">
          <h4 className="font-semibold text-slate-300 text-xs">
            Turnos Cadastrados ({shifts.length})
          </h4>
          {shifts.length === 0 ? (
            <div className="p-4 rounded-lg bg-slate-950/40 border border-slate-800 text-center text-slate-500 text-xs">
              Nenhum turno cadastrado até o momento. Utilize o formulário acima para adicionar os horários da sua empresa.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
              {shifts.map((s) => {
                const isCurrentEditing = editingShiftId === s.id;
                return (
                  <div
                    key={s.id}
                    className={`
                      flex items-center justify-between p-2.5 rounded-lg text-xs transition border
                      ${isCurrentEditing
                        ? 'bg-indigo-950/40 border-indigo-500/60'
                        : 'bg-slate-950/70 border-slate-800/80 hover:border-slate-700'}
                    `}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded text-[11px]">
                        {s.code}
                      </span>
                      <div>
                        <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                          {s.name}
                          {s.is_default && (
                            <span className="text-[10px] bg-indigo-950 text-indigo-300 border border-indigo-800 px-1.5 py-0.2 rounded flex items-center gap-0.5 font-normal">
                              <CheckCircle2 size={10} /> Padrão
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {s.start_time} às {s.end_time}
                          {s.lunch_start && ` (almoço: ${s.lunch_start} - ${s.lunch_end})`}
                          {' • '}
                          <strong className="text-slate-300">{s.net_hours}h líquidas</strong>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(s)}
                        className={`
                          p-1.5 rounded transition
                          ${isCurrentEditing
                            ? 'bg-indigo-600 text-white'
                            : 'hover:bg-indigo-950/60 text-slate-400 hover:text-indigo-300'}
                        `}
                        title="Editar turno"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(s.id)}
                        className="p-1.5 rounded hover:bg-rose-950/60 text-slate-500 hover:text-rose-400 transition"
                        title="Remover turno"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition font-medium"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
