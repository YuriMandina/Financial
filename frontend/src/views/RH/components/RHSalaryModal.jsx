import React, { useState, useEffect, useMemo } from 'react';
import { TrendingUp, X, Trash2, RefreshCw, History, Edit2, Check, Wallet } from 'lucide-react';
import SelectDropdown from '../../../components/common/SelectDropdown';

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Aceita "3.000,50", "3000,50" e "3000.50"
const parseMoney = (value) => {
  const str = String(value ?? '').trim();
  if (!str) return 0;
  const normalized = str.includes(',') ? str.replace(/\./g, '').replace(',', '.') : str;
  return parseFloat(normalized) || 0;
};

const formatDate = (iso) => {
  if (!iso) return 'Inicial';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

/**
 * Aumento salarial do cargo com data de vigência (um cargo ou todos) e histórico do cargo.
 * O salário é definido pelo cargo: todos os colaboradores do mesmo cargo recebem o mesmo valor.
 * Props:
 * - target: id do cargo ou 'ALL' (todos os cargos)
 */
export default function RHSalaryModal({ token, apiBase, roles = [], target, onClose, onSaved }) {
  const [selected, setSelected] = useState(target);
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null); // { key, id, is_initial, effective_date, salary, reason }
  const [form, setForm] = useState({
    effective_date: new Date().toISOString().slice(0, 10),
    mode: 'PERCENT', // PERCENT | VALUE
    value: '',
    reason: ''
  });

  const isBulk = selected === 'ALL';
  const role = useMemo(() => roles.find((r) => r.id === Number(selected)), [roles, selected]);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const loadHistory = async () => {
    if (isBulk || !role) {
      setHistory([]);
      return;
    }
    try {
      setLoadingHistory(true);
      const res = await fetch(`${apiBase}/api/rh/roles/${role.id}/salary-history`, { headers });
      setHistory(res.ok ? await res.json() : []);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [selected]);

  // Salário vigente na data informada, para prévia do novo valor
  const salaryAtDate = useMemo(() => {
    if (!role) return 0;
    let current = history.length ? history[0].salary : role.base_salary;
    history.forEach((h) => {
      if (!h.effective_date || h.effective_date <= form.effective_date) current = h.salary;
    });
    return Number(current || 0);
  }, [history, role, form.effective_date]);

  const today = new Date().toISOString().slice(0, 10);
  const currentKey = useMemo(() => {
    let key = null;
    history.forEach((h) => {
      if (!h.effective_date || h.effective_date <= today) key = h.id ?? 'initial';
    });
    return key;
  }, [history, today]);

  const value = parseMoney(form.value);
  const preview = form.mode === 'PERCENT' ? salaryAtDate * (1 + value / 100) : value;
  const previewPct = salaryAtDate > 0 ? ((preview / salaryAtDate) - 1) * 100 : 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.effective_date || !value) {
      alert('Informe a data de vigência e o valor do aumento.');
      return;
    }
    try {
      setSaving(true);
      const url = isBulk
        ? `${apiBase}/api/rh/salary-changes/bulk`
        : `${apiBase}/api/rh/roles/${role.id}/salary-changes`;
      const body = isBulk
        ? { effective_date: form.effective_date, percent: value, reason: form.reason || null }
        : {
          effective_date: form.effective_date,
          ...(form.mode === 'PERCENT' ? { percent: value } : { new_salary: value }),
          reason: form.reason || null
        };
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Erro ao registrar lançamento salarial');
      if (onSaved) await onSaved(data.message || 'Lançamento salarial registrado.');
      if (isBulk) {
        onClose();
      } else {
        setForm({ ...form, value: '', reason: '' });
        await loadHistory();
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (h) => setEditing({
    key: h.id ?? 'initial',
    id: h.id,
    is_initial: h.is_initial,
    effective_date: h.effective_date || '',
    salary: Number(h.salary || 0).toFixed(2).replace('.', ','),
    reason: h.reason || ''
  });

  const handleSaveEdit = async () => {
    const salary = parseMoney(editing.salary);
    if (!editing.is_initial && !editing.effective_date) {
      alert('Informe a data de vigência.');
      return;
    }
    try {
      // Salário inicial ainda sem histórico: é o próprio salário do cargo
      const res = editing.id === null
        ? await fetch(`${apiBase}/api/rh/roles/${role.id}`, {
          method: 'PUT', headers, body: JSON.stringify({ base_salary: salary })
        })
        : await fetch(`${apiBase}/api/rh/salary-changes/${editing.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            effective_date: editing.effective_date || today,
            new_salary: salary,
            reason: editing.reason
          })
        });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Erro ao salvar');
      setEditing(null);
      await loadHistory();
      if (onSaved) await onSaved('Lançamento salarial atualizado.');
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Excluir o lançamento vigente a partir de ${formatDate(item.effective_date)}?`)) return;
    const res = await fetch(`${apiBase}/api/rh/salary-changes/${item.id}`, { method: 'DELETE', headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.detail || 'Erro ao excluir');
      return;
    }
    await loadHistory();
    if (onSaved) await onSaved('Lançamento salarial excluído.');
  };

  const inputCls = 'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500';

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-5 shadow-2xl space-y-4 text-xs max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h4 className="font-bold text-white text-sm flex items-center gap-2">
            <Wallet size={16} className="text-emerald-400" />
            Salário do Cargo
          </h4>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-slate-400 mb-1">Cargo</label>
            <SelectDropdown
              value={selected}
              onChange={(val) => {
                setSelected(val === 'ALL' ? 'ALL' : Number(val));
                if (val === 'ALL') setForm((f) => ({ ...f, mode: 'PERCENT' }));
              }}
              searchable={roles.length > 6}
              options={[
                { value: 'ALL', label: `Todos os cargos (${roles.length})`, subtitle: 'Aumento coletivo em %' },
                ...roles.map((r) => ({
                  value: r.id,
                  label: r.name,
                  subtitle: `${brl(r.base_salary)} • ${r.employee_count || 0} colab.`
                }))
              ]}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Vigente a partir de</label>
              <input
                type="date"
                required
                value={form.effective_date}
                onChange={(e) => setForm({ ...form, effective_date: e.target.value })}
                className={`${inputCls} [color-scheme:dark]`}
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Tipo de Lançamento</label>
              <SelectDropdown
                value={form.mode}
                disabled={isBulk}
                onChange={(val) => setForm({ ...form, mode: val, value: '' })}
                options={[
                  { value: 'PERCENT', label: 'Reajuste em %' },
                  { value: 'VALUE', label: 'Novo salário (R$)' }
                ]}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">{form.mode === 'PERCENT' ? 'Percentual de reajuste' : 'Novo salário mensal'}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-semibold">
                  {form.mode === 'PERCENT' ? '%' : 'R$'}
                </span>
                <input
                  inputMode="decimal"
                  placeholder={form.mode === 'PERCENT' ? '5,00' : '0,00'}
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value.replace(/[^0-9.,]/g, '') })}
                  className={`${inputCls} pl-9`}
                />
              </div>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Motivo</label>
              <input
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="Ex: Dissídio 2026, Promoção"
                className={inputCls}
              />
            </div>
          </div>

          {!isBulk && role && value > 0 && (
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 flex items-center justify-between">
              <span className="text-slate-400">
                {brl(salaryAtDate)} → <span className="font-bold text-white">{brl(preview)}</span>
              </span>
              <span className={`font-bold ${previewPct >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {previewPct >= 0 ? '+' : ''}{previewPct.toFixed(2).replace('.', ',')}%
              </span>
            </div>
          )}

          <p className="text-[11px] text-slate-500">
            Vale para todos os colaboradores do cargo a partir da data de vigência. Se a data cair no meio do mês, o salário daquele
            mês é proporcional; meses anteriores mantêm o salário antigo.
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-800">
              Fechar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
            >
              {saving ? <RefreshCw size={13} className="animate-spin" /> : <TrendingUp size={13} />}
              {isBulk ? 'Aplicar a Todos os Cargos' : 'Registrar Lançamento'}
            </button>
          </div>
        </form>

        {!isBulk && role && (
          <div className="border-t border-slate-800 pt-3">
            <div className="flex items-center gap-1.5 text-slate-300 font-semibold mb-2">
              <History size={13} /> Histórico salarial do cargo {role.name}
            </div>
            {loadingHistory ? (
              <div className="text-slate-500">Carregando...</div>
            ) : (
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-slate-500 uppercase tracking-wider text-[9px]">
                    <th className="py-1 text-left">Vigência</th>
                    <th className="py-1 text-right">Salário</th>
                    <th className="py-1 text-right">Variação</th>
                    <th className="py-1 text-left pl-3">Motivo</th>
                    <th className="py-1 w-14" />
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, idx) => ({ h, prev: idx > 0 ? history[idx - 1].salary : null })).reverse().map(({ h, prev }) => {
                    const key = h.id ?? 'initial';
                    const pct = prev ? ((h.salary / prev) - 1) * 100 : null;
                    const isCurrent = key === currentKey;
                    const isFuture = h.effective_date && h.effective_date > today;

                    if (editing && editing.key === key) {
                      return (
                        <tr key={key} className="border-t border-slate-800/50 bg-slate-950/60">
                          <td className="py-1.5 pr-1">
                            {editing.is_initial ? (
                              <span className="text-slate-400">Inicial</span>
                            ) : (
                              <input
                                type="date"
                                value={editing.effective_date}
                                onChange={(e) => setEditing({ ...editing, effective_date: e.target.value })}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-white [color-scheme:dark]"
                              />
                            )}
                          </td>
                          <td className="py-1.5 px-1">
                            <input
                              inputMode="decimal"
                              value={editing.salary}
                              onChange={(e) => setEditing({ ...editing, salary: e.target.value.replace(/[^0-9.,]/g, '') })}
                              className="w-full bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-white text-right"
                            />
                          </td>
                          <td />
                          <td className="py-1.5 pl-3 pr-1">
                            <input
                              value={editing.reason}
                              disabled={editing.id === null}
                              onChange={(e) => setEditing({ ...editing, reason: e.target.value })}
                              className="w-full bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-white disabled:opacity-50"
                            />
                          </td>
                          <td className="py-1.5 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={handleSaveEdit}
                              className="p-1 text-emerald-400 hover:text-emerald-300 rounded hover:bg-slate-800"
                              title="Salvar"
                            >
                              <Check size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditing(null)}
                              className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800"
                              title="Cancelar"
                            >
                              <X size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={key} className={`border-t border-slate-800/50 ${isCurrent ? 'bg-emerald-500/5' : ''}`}>
                        <td className="py-1.5 text-slate-300 whitespace-nowrap">
                          {formatDate(h.effective_date)}
                          {isCurrent && (
                            <span className="ml-1.5 px-1 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              VIGENTE
                            </span>
                          )}
                          {isFuture && (
                            <span className="ml-1.5 px-1 py-0.5 rounded text-[9px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                              AGENDADO
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 text-right font-semibold text-white">{brl(h.salary)}</td>
                        <td className={`py-1.5 text-right ${pct !== null && pct < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                          {pct !== null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2).replace('.', ',')}%` : '-'}
                        </td>
                        <td className="py-1.5 pl-3 text-slate-400">{h.reason || '-'}</td>
                        <td className="py-1.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => startEdit(h)}
                            className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800"
                            title={h.is_initial ? 'Editar salário inicial' : 'Editar lançamento'}
                          >
                            <Edit2 size={12} />
                          </button>
                          {!h.is_initial && (
                            <button
                              type="button"
                              onClick={() => handleDelete(h)}
                              className="p-1 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-800"
                              title="Excluir lançamento"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
