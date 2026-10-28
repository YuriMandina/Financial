import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, FileSignature, Pencil, Plus, RefreshCw, Trash2, X, AlertTriangle, Undo2 } from 'lucide-react';
import Skeleton from '../../../components/common/Skeleton';
import SelectDropdown from '../../../components/common/SelectDropdown';
import StyledCheckbox from '../../../components/common/StyledCheckbox';

// ==============================================================================
// --- [BLOCO: CONSTANTES E UTILITÁRIOS DE HORÁRIO] ---
// ==============================================================================

const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']; // 0 = segunda (igual ao backend)

const DAY_KINDS = [
  { key: 'WORK', label: 'Trab.' },
  { key: 'DSR', label: 'DSR' },
  { key: 'FOLGA', label: 'Folga' }
];

const CHANGE_REASONS = [
  { value: 'ADMISSAO', label: 'Admissão' },
  { value: 'ACORDO', label: 'Acordo com o colaborador' },
  { value: 'ADEQUACAO_LEGAL', label: 'Adequação legal (ex.: fim da 6x1)' }
];

// Definido pelo servidor quando só o horário muda (mesma carga e descansos); não é escolhido
const HORARIO_REASON = { value: 'HORARIO', label: 'Alteração de horário' };

const DEFAULT_WORK = { start: '07:00', lunch_start: '12:00', lunch_end: '13:00', end: '16:00' };

const EMPTY_SCHEDULE = { name: '', start: '09:00', lunch_start: '12:00', lunch_end: '14:00' };

const toMinutes = (t) => {
  if (!t) return null;
  const [h, m] = String(t).split(':').map((v) => parseInt(v, 10));
  return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
};

const spanMinutes = (from, to) => (to < from ? to + 1440 - from : to - from);

// Mesma regra de compute_raw_minutes no backend
const contractDayMinutes = (d) => {
  if (!d || d.rest) return 0;
  const start = toMinutes(d.start);
  const end = toMinutes(d.end);
  if (start === null || end === null) return 0;
  const ls = toMinutes(d.lunch_start);
  const le = toMinutes(d.lunch_end);
  const lunch = ls !== null && le !== null ? spanMinutes(ls, le) : 0;
  return Math.max(0, spanMinutes(start, end) - lunch);
};

const fmtHours = (mins) => {
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  return `${mins < 0 ? '−' : ''}${h}h${m ? String(m).padStart(2, '0') : ''}`;
};

const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

const todayIso = () => new Date().toISOString().slice(0, 10);

const orderedWeekdays = (weekStart) => Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);

const sameDay = (a, b) => {
  if (!a || !b) return false;
  if (a.rest || b.rest) return a.rest === b.rest;
  return ['start', 'lunch_start', 'lunch_end', 'end'].every((k) => (a[k] || null) === (b[k] || null));
};

// Mesma carga em cada dia e mesmos descansos: o servidor classifica como alteração de horário
const sameWorkload = (a, b) => Array.from({ length: 7 }, (_, wd) => wd).every((wd) => {
  const x = a?.[wd] || {};
  const y = b?.[wd] || {};
  return (x.rest || null) === (y.rest || null) && contractDayMinutes(x) === contractDayMinutes(y);
});

const scheduleLabel = (s) => {
  const ex = s.example || {};
  return `${ex.start}–${ex.lunch_start} / ${ex.lunch_end}–${ex.end} em dia de 8h`;
};

// ==============================================================================
// --- [BLOCO: COMPONENTE PRINCIPAL] ---
// ==============================================================================

export default function RHContratoJornada({ token, apiBase, employee, weekStart = 0, onChanged }) {
  const [loading, setLoading] = useState(true);
  const [versions, setVersions] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [regimes, setRegimes] = useState([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);
  // Semana gerada pela escala-padrão escolhida: referência para marcar os dias ajustados
  const [baseDays, setBaseDays] = useState(null);
  const [scheduleForm, setScheduleForm] = useState(null);

  const headers = { Authorization: `Bearer ${token}` };

  const load = async () => {
    setLoading(true);
    try {
      const [v, t, s, r] = await Promise.all([
        fetch(`${apiBase}/api/rh/employees/${employee.id}/contracts`, { headers }).then((res) => res.json()),
        fetch(`${apiBase}/api/rh/contract-templates`, { headers }).then((res) => res.json()),
        fetch(`${apiBase}/api/rh/standard-schedules`, { headers }).then((res) => res.json()),
        fetch(`${apiBase}/api/rh/legal-regimes`, { headers }).then((res) => res.json())
      ]);
      setVersions(Array.isArray(v) ? v : []);
      setTemplates(Array.isArray(t) ? t : []);
      setSchedules(Array.isArray(s) ? s : []);
      setRegimes(Array.isArray(r) ? r : []);
    } catch {
      setError('Falha ao carregar o contrato de jornada.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [employee.id]);

  const current = versions.find((v) => !v.valid_to) || versions[0] || null;

  const regimeOn = (iso) => {
    let found = regimes[0];
    regimes.forEach((r) => { if (r.valid_from <= iso) found = r; });
    return found;
  };

  // ==============================================================================
  // --- [BLOCO: EDITOR DA NOVA VERSÃO] ---
  // ==============================================================================

  // Horários da semana pela escala-padrão, mantendo a carga e os descansos (cálculo no servidor)
  const buildDays = async (days, scheduleId) => {
    const res = await fetch(`${apiBase}/api/rh/standard-schedules/apply`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ standard_schedule_id: scheduleId, days })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Falha ao aplicar a escala-padrão');
    return data.days;
  };

  const openEditor = async () => {
    const base = current?.days || templates.find((t) => t.code === '44H_6X1_QUA')?.days || {};
    const scheduleId = current?.standard_schedule_id || null;
    setForm({
      valid_from: current ? todayIso() : (employee.admission_date || todayIso()),
      days: JSON.parse(JSON.stringify(base)),
      template_id: null,
      standard_schedule_id: scheduleId,
      overtime_agreement: current?.overtime_agreement ?? false,
      compensation_agreement: current?.compensation_agreement ?? false,
      amendment_signed: false,
      change_reason: current ? 'ACORDO' : 'ADMISSAO',
      notes: ''
    });
    setBaseDays(null);
    setScheduleForm(null);
    setError('');
    setEditorOpen(true);
    if (scheduleId) {
      try { setBaseDays(await buildDays(base, scheduleId)); } catch { /* sem marcação de ajuste */ }
    }
  };

  // Troca a semana mantendo a escala-padrão escolhida (se houver)
  const replaceDays = async (days, patch = {}) => {
    const scheduleId = patch.standard_schedule_id !== undefined ? patch.standard_schedule_id : form.standard_schedule_id;
    let next = JSON.parse(JSON.stringify(days));
    setError('');
    if (scheduleId) {
      try {
        next = await buildDays(days, scheduleId);
      } catch (err) {
        setError(err.message);
        return;
      }
    }
    setBaseDays(scheduleId ? next : null);
    setForm((f) => ({ ...f, ...patch, days: next }));
  };

  const applySchedule = (id) => replaceDays(form.days, { standard_schedule_id: id ? Number(id) : null });

  const resetDay = (wd) => setDay(wd, JSON.parse(JSON.stringify(baseDays[wd])));

  const sortSchedules = (list) => [...list].sort((x, y) => x.start.localeCompare(y.start) || x.name.localeCompare(y.name));

  // Editor da escala-padrão (nova ou existente), descrita pelo horário de um dia de 8h
  const editSchedule = (id) => {
    const sc = schedules.find((s) => s.id === id);
    if (!sc) return;
    setScheduleForm({
      id: sc.id,
      name: sc.name,
      start: sc.example.start,
      lunch_start: sc.example.lunch_start,
      lunch_end: sc.example.lunch_end,
      is_system: sc.is_system,
      customizes_system: sc.customizes_system
    });
  };

  const saveSchedule = async () => {
    const start = toMinutes(scheduleForm.start);
    const ls = toMinutes(scheduleForm.lunch_start);
    const le = toMinutes(scheduleForm.lunch_end);
    if (start === null || ls === null || le === null) {
      setError('Informe entrada e intervalo da escala-padrão.');
      return;
    }
    try {
      const res = await fetch(`${apiBase}/api/rh/standard-schedules${scheduleForm.id ? `/${scheduleForm.id}` : ''}`, {
        method: scheduleForm.id ? 'PUT' : 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: scheduleForm.name,
          start: scheduleForm.start,
          lunch_minutes: spanMinutes(ls, le),
          lunch_after_min: spanMinutes(start, ls)
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Escala-padrão inválida');
      // Editar uma escala do sistema cria a versão da empresa, que a substitui na lista
      setSchedules((list) => sortSchedules([...list.filter((s) => s.id !== scheduleForm.id && s.id !== data.id), data]));
      setScheduleForm(null);
      await replaceDays(form.days, { standard_schedule_id: data.id });
    } catch (err) {
      setError(err.message);
    }
  };

  const removeSchedule = async () => {
    const question = scheduleForm.customizes_system
      ? `Restaurar a escala "${scheduleForm.name}" do sistema? A versão da empresa será descartada.`
      : `Excluir a escala "${scheduleForm.name}"?`;
    if (!window.confirm(`${question} Contratos já salvos não mudam.`)) return;
    const res = await fetch(`${apiBase}/api/rh/standard-schedules/${scheduleForm.id}`, { method: 'DELETE', headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof data.detail === 'string' ? data.detail : 'Falha ao excluir a escala-padrão');
      return;
    }
    const removedId = scheduleForm.id;
    setSchedules((list) => sortSchedules([...list.filter((s) => s.id !== removedId), ...(data.restored ? [data.restored] : [])]));
    setScheduleForm(null);
    if (form.standard_schedule_id === removedId) {
      await replaceDays(form.days, { standard_schedule_id: data.restored ? data.restored.id : null });
    }
  };

  const setDay = (wd, patch) => setForm((f) => ({ ...f, days: { ...f.days, [wd]: patch } }));

  const setDayKind = (wd, kind) => {
    if (kind === 'WORK') {
      const prev = form.days[wd];
      setDay(wd, prev && !prev.rest ? prev : { ...DEFAULT_WORK });
    } else {
      setDay(wd, { rest: kind });
    }
  };

  const applyTemplate = (id) => {
    const tpl = templates.find((t) => String(t.id) === String(id));
    if (!tpl) return;
    replaceDays(tpl.days, {
      template_id: tpl.id,
      compensation_agreement: form.compensation_agreement || Object.values(tpl.days).some((d) => contractDayMinutes(d) > 480)
    });
  };

  const horarioOnly = Boolean(current && form && sameWorkload(current.days, form.days));

  // Prévia das regras validadas no servidor (o backend é a fonte da verdade)
  const preview = useMemo(() => {
    if (!form) return null;
    const regime = regimeOn(form.valid_from);
    const days = Object.values(form.days);
    const total = days.reduce((acc, d) => acc + contractDayMinutes(d), 0);
    const rest = days.filter((d) => d.rest).length;
    const issues = [];
    if (regime && total > regime.weekly_limit_min) issues.push(`Total acima do limite de ${fmtHours(regime.weekly_limit_min)} do regime vigente.`);
    if (regime && rest < regime.min_rest_days) issues.push(`O regime vigente exige ${regime.min_rest_days} dia(s) de descanso.`);
    if (!days.some((d) => d.rest === 'DSR')) issues.push('Defina o DSR (preferencialmente no domingo).');
    if (days.some((d) => contractDayMinutes(d) > 480) && !form.compensation_agreement) {
      issues.push('Dias acima de 8h exigem acordo de compensação.');
    }
    return { regime, total, rest, issues };
  }, [form, regimes]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${apiBase}/api/rh/employees/${employee.id}/contracts`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          amendment_signed: horarioOnly ? false : form.amendment_signed,
          amendment_signed_at: form.amendment_signed && !horarioOnly ? todayIso() : null
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Contrato inválido');
      setEditorOpen(false);
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // ==============================================================================
  // --- [BLOCO: AÇÕES NAS VERSÕES] ---
  // ==============================================================================

  const markAmendmentSigned = async (version) => {
    const res = await fetch(`${apiBase}/api/rh/employees/${employee.id}/contracts/${version.id}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amendment_signed: true, amendment_signed_at: todayIso() })
    });
    if (res.ok) {
      await load();
      if (onChanged) onChanged();
    }
  };

  const deleteVersion = async (version) => {
    if (!window.confirm(`Excluir a versão com vigência a partir de ${fmtDate(version.valid_from)}? A versão anterior volta a valer.`)) return;
    const res = await fetch(`${apiBase}/api/rh/employees/${employee.id}/contracts/${version.id}`, { method: 'DELETE', headers });
    if (res.ok) {
      await load();
      if (onChanged) onChanged();
    }
  };

  // ==============================================================================
  // --- [BLOCO: RENDERIZAÇÃO] ---
  // ==============================================================================

  const renderWeekReadOnly = (days) => (
    <div className="grid grid-cols-7 gap-1">
      {orderedWeekdays(weekStart).map((wd) => {
        const d = days?.[wd] || {};
        const mins = contractDayMinutes(d);
        return (
          <div key={wd} className="text-center">
            <div className="text-[10px] text-slate-500 mb-0.5">{WEEKDAYS[wd]}</div>
            <div className={`rounded border px-1 py-1.5 text-[10px] font-bold ${
              d.rest === 'DSR' ? 'bg-red-950/30 text-red-400 border-red-500/30'
                : d.rest ? 'bg-slate-800/40 text-slate-500 border-slate-700/40'
                  : 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40'
            }`}>
              {d.rest ? d.rest : `${d.start}–${d.end}`}
              {!d.rest && <div className="text-[9px] font-medium text-emerald-200/70">{fmtHours(mins)}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );

  if (loading) {
    return <Skeleton type="list" rows={3} />;
  }

  return (
    <div className="space-y-4">
      {/* Contrato vigente */}
      <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-slate-200 font-semibold">
            <CalendarClock size={15} className="text-indigo-400" />
            {current
              ? `Contrato de jornada: ${current.summary}${current.standard_schedule_name ? ` • ${current.standard_schedule_name}` : ''}`
              : 'Sem contrato de jornada'}
          </div>
          {!editorOpen && (
            <button
              type="button"
              onClick={openEditor}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              <Plus size={13} /> {current ? 'Nova versão a partir de…' : 'Definir contrato'}
            </button>
          )}
        </div>
        {current ? (
          <>
            {renderWeekReadOnly(current.days)}
            <p className="text-[10px] text-slate-500">
              Vigente desde {fmtDate(current.valid_from)}{current.valid_to ? ` até ${fmtDate(current.valid_to)}` : ''}.
              A escala do mês é gerada a partir desta semana; variações são feitas na Grade de Jornada.
            </p>
          </>
        ) : (
          <p className="text-[11px] text-amber-300 flex items-center gap-1.5">
            <AlertTriangle size={13} />
            Sem contrato, o preenchimento em lote não gera a escala deste colaborador e as horas extras não são apuradas.
          </p>
        )}
      </div>

      {/* Editor da nova versão */}
      {editorOpen && form && (
        <div className="border border-indigo-500/30 rounded-lg p-3 space-y-3 bg-slate-950">
          <div className="flex items-center justify-between">
            <span className="text-indigo-300 font-semibold">{current ? 'Nova versão do contrato' : 'Contrato de jornada'}</span>
            <button type="button" onClick={() => setEditorOpen(false)} className="text-slate-400 hover:text-white p-1">
              <X size={14} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-slate-400 mb-1">Jornada</label>
              <SelectDropdown
                value={form.template_id || ''}
                onChange={applyTemplate}
                placeholder="Escolher modelo…"
                options={templates.map((t) => ({ value: t.id, label: t.name, subtitle: t.summary }))}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-400">Escala-padrão</label>
                <div className="flex items-center gap-2">
                  {form.standard_schedule_id && (
                    <button
                      type="button"
                      onClick={() => editSchedule(form.standard_schedule_id)}
                      className="flex items-center gap-0.5 text-[10px] text-indigo-300 hover:text-indigo-200"
                    >
                      <Pencil size={10} /> Editar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setScheduleForm({ ...EMPTY_SCHEDULE })}
                    className="flex items-center gap-0.5 text-[10px] text-indigo-300 hover:text-indigo-200"
                  >
                    <Plus size={11} /> Nova
                  </button>
                </div>
              </div>
              <SelectDropdown
                value={form.standard_schedule_id || ''}
                onChange={applySchedule}
                placeholder="Horários manuais"
                options={[
                  { value: '', label: 'Horários manuais', subtitle: 'Sem escala-padrão' },
                  ...schedules.map((s) => ({ value: s.id, label: s.name, subtitle: scheduleLabel(s) }))
                ]}
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Vigência a partir de</label>
              <input
                type="date"
                value={form.valid_from}
                onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white [color-scheme:dark]"
              />
            </div>
          </div>

          {/* Escala-padrão (nova ou em edição): definida pelo horário de um dia de 8h; a saída é sempre calculada */}
          {scheduleForm && (() => {
            const start = toMinutes(scheduleForm.start);
            const ls = toMinutes(scheduleForm.lunch_start);
            const le = toMinutes(scheduleForm.lunch_end);
            const valid = start !== null && ls !== null && le !== null;
            const end = valid ? (start + 480 + spanMinutes(ls, le)) % 1440 : null;
            const fmtClock = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
            return (
              <div className="rounded-lg border border-indigo-500/30 bg-indigo-950/20 p-2 space-y-2">
                <div className="text-[11px] font-semibold text-indigo-300">
                  {scheduleForm.id ? `Editar escala-padrão "${schedules.find((x) => x.id === scheduleForm.id)?.name || scheduleForm.name}"` : 'Nova escala-padrão'}
                  {scheduleForm.is_system && (
                    <span className="ml-1.5 font-normal text-slate-400">— escala do sistema: a alteração vale só para a sua empresa</span>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-[10px] text-slate-400 mb-0.5">Nome</label>
                    <input
                      type="text"
                      value={scheduleForm.name}
                      placeholder="Ex.: Tarde 09h"
                      onChange={(e) => setScheduleForm({ ...scheduleForm, name: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-[11px]"
                    />
                  </div>
                  {[
                    ['start', 'Entrada'],
                    ['lunch_start', 'Intervalo'],
                    ['lunch_end', 'Retorno']
                  ].map(([field, label]) => (
                    <div key={field}>
                      <label className="block text-[10px] text-slate-400 mb-0.5">{label}</label>
                      <input
                        type="time"
                        value={scheduleForm[field]}
                        onChange={(e) => setScheduleForm({ ...scheduleForm, [field]: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-1 py-1 text-white text-[11px] text-center [color-scheme:dark]"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[10px] text-slate-400">
                    {valid
                      ? `Dia de 8h: ${scheduleForm.start}–${scheduleForm.lunch_start} / ${scheduleForm.lunch_end}–${fmtClock(end)}. A saída de cada dia é calculada pela carga da jornada; contratos já salvos não mudam.`
                      : 'Informe entrada e intervalo.'}
                  </span>
                  <div className="flex gap-1.5">
                    {scheduleForm.id && !scheduleForm.is_system && (
                      <button
                        type="button"
                        onClick={removeSchedule}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-slate-400 hover:text-red-400 bg-slate-800"
                      >
                        {scheduleForm.customizes_system ? <><Undo2 size={11} /> Restaurar padrão</> : <><Trash2 size={11} /> Excluir</>}
                      </button>
                    )}
                    <button type="button" onClick={() => setScheduleForm(null)} className="px-2 py-1 rounded text-[11px] text-slate-400 hover:text-white bg-slate-800">
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={saveSchedule}
                      disabled={!valid || !scheduleForm.name.trim()}
                      className="px-2 py-1 rounded text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
                    >
                      {scheduleForm.id ? 'Salvar alterações' : 'Salvar escala-padrão'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Semana-padrão: mesma lógica visual da grade da escala */}
          <div className="overflow-x-auto">
            <div className="grid grid-cols-7 gap-1.5 min-w-[640px]">
              {orderedWeekdays(weekStart).map((wd) => {
                const d = form.days[wd] || { rest: 'FOLGA' };
                const kind = d.rest || 'WORK';
                const mins = contractDayMinutes(d);
                const noLunch = !d.rest && !d.lunch_start && !d.lunch_end;
                const adjusted = Boolean(baseDays?.[wd]) && !sameDay(d, baseDays[wd]);
                return (
                  <div key={wd} className={`rounded-lg border p-1.5 space-y-1 ${
                    kind === 'DSR' ? 'border-red-500/30 bg-red-950/20' : kind === 'FOLGA' ? 'border-slate-700 bg-slate-900' : 'border-emerald-500/30 bg-emerald-950/10'
                  }`}>
                    <div className="text-center text-[11px] font-bold text-slate-200">{WEEKDAYS[wd]}</div>
                    {adjusted && (
                      <button
                        type="button"
                        onClick={() => resetDay(wd)}
                        className="w-full flex items-center justify-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 text-[9px] py-0.5 hover:bg-amber-500/20"
                        title="Dia diferente da escala-padrão. Clique para voltar à escala."
                      >
                        ajustado <Undo2 size={10} />
                      </button>
                    )}
                    <div className="flex gap-0.5">
                      {DAY_KINDS.map((k) => (
                        <button
                          key={k.key}
                          type="button"
                          onClick={() => setDayKind(wd, k.key)}
                          className={`flex-1 rounded text-[9px] font-semibold py-0.5 border ${
                            kind === k.key ? 'bg-indigo-600/40 border-indigo-500 text-white' : 'border-slate-700 text-slate-400 hover:text-white'
                          }`}
                        >
                          {k.label}
                        </button>
                      ))}
                    </div>
                    {kind === 'WORK' ? (
                      <div className="space-y-0.5">
                        {[
                          ['start', 'Entrada'],
                          ['lunch_start', 'Intervalo'],
                          ['lunch_end', 'Retorno'],
                          ['end', 'Saída']
                        ].map(([field, label]) => (
                          <div key={field}>
                            <div className="text-[9px] text-slate-500">{label}</div>
                            <input
                              type="time"
                              value={d[field] || ''}
                              disabled={noLunch && field.startsWith('lunch')}
                              onChange={(e) => setDay(wd, { ...d, [field]: e.target.value || null })}
                              className="w-full bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-white text-[11px] text-center [color-scheme:dark] disabled:opacity-30"
                            />
                          </div>
                        ))}
                        <label className="flex items-center gap-1 text-[9px] text-slate-400 pt-0.5">
                          <input
                            type="checkbox"
                            checked={noLunch}
                            onChange={(e) => setDay(wd, e.target.checked
                              ? { ...d, lunch_start: null, lunch_end: null }
                              : { ...d, lunch_start: '12:00', lunch_end: '13:00' })}
                          />
                          sem intervalo
                        </label>
                        <div className="text-center text-[11px] font-bold text-emerald-300">{fmtHours(mins)}</div>
                      </div>
                    ) : (
                      <div className="text-center text-[10px] text-slate-500 py-6">{kind === 'DSR' ? 'Repouso semanal' : 'Folga'}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {preview && (
            <div className={`rounded-lg border p-2 text-[11px] ${preview.issues.length ? 'border-amber-500/40 bg-amber-950/20 text-amber-200' : 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300'}`}>
              <div className="font-semibold">
                Total semanal: {fmtHours(preview.total)}
                {preview.regime && ` / limite ${fmtHours(preview.regime.weekly_limit_min)} (${preview.regime.label})`}
                {` • ${7 - preview.rest} dia(s) de trabalho`}
              </div>
              {preview.issues.map((i) => <div key={i}>• {i}</div>)}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <StyledCheckbox
              checked={form.compensation_agreement}
              onChange={(c) => setForm({ ...form, compensation_agreement: c })}
              label="Acordo de compensação por escrito"
              description="Necessário para dias acima de 8h e banco de horas de 6 meses"
            />
            <StyledCheckbox
              checked={form.overtime_agreement}
              onChange={(c) => setForm({ ...form, overtime_agreement: c })}
              label="Acordo de prorrogação de jornada"
              description="Autoriza horas extras (CLT art. 59)"
            />
            {horarioOnly ? (
              <div className="sm:col-span-2 rounded-lg border border-sky-500/30 bg-sky-950/20 p-2 text-[11px] text-sky-200">
                <span className="font-semibold">Alteração de horário.</span> A carga de cada dia e os descansos não mudam, só os horários:
                não exige aditivo (poder de direção do empregador) e não aparece no relatório de irregularidades.
              </div>
            ) : (
              <>
                <StyledCheckbox
                  checked={form.amendment_signed}
                  onChange={(c) => setForm({ ...form, amendment_signed: c })}
                  label="Aditivo assinado pelo colaborador"
                  description="Sem aditivo a versão vale, mas aparece no relatório de irregularidades (art. 468)"
                />
                <div>
                  <label className="block text-slate-400 mb-1">Motivo</label>
                  <SelectDropdown
                    value={form.change_reason}
                    onChange={(val) => setForm({ ...form, change_reason: val })}
                    options={CHANGE_REASONS}
                  />
                </div>
              </>
            )}
          </div>

          {error && <div className="text-[11px] text-rose-300 bg-rose-950/30 border border-rose-700/50 rounded p-2">{error}</div>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditorOpen(false)} className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-800">
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
            >
              {saving ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              Salvar contrato
            </button>
          </div>
        </div>
      )}

      {/* Histórico de versões */}
      {versions.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-slate-400 font-semibold text-[11px] uppercase tracking-wider">Versões do contrato</div>
          {versions.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2">
              <div className="min-w-0">
                <div className="text-slate-200 font-medium truncate">
                  {v.summary}{v.standard_schedule_name ? ` • ${v.standard_schedule_name}` : ''}
                </div>
                <div className="text-[10px] text-slate-500">
                  {fmtDate(v.valid_from)} → {v.valid_to ? fmtDate(v.valid_to) : 'atual'} • {[...CHANGE_REASONS, HORARIO_REASON].find((r) => r.value === v.change_reason)?.label || v.change_reason}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {v.change_reason === 'HORARIO' && !v.amendment_signed ? (
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full border border-sky-500/40 text-sky-300 bg-sky-500/10"
                    title="Só o horário mudou: não exige aditivo"
                  >
                    Sem aditivo (horário)
                  </span>
                ) : v.amendment_signed ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/40 text-emerald-300 bg-emerald-500/10">Aditivo assinado</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => markAmendmentSigned(v)}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-amber-500/40 text-amber-300 bg-amber-500/10 hover:bg-amber-500/20"
                    title="Aditivo pendente (CLT art. 468). Clique para marcar como assinado."
                  >
                    <FileSignature size={11} /> Aditivo pendente
                  </button>
                )}
                <button type="button" onClick={() => deleteVersion(v)} className="p-1 text-slate-500 hover:text-red-400" title="Excluir versão">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
