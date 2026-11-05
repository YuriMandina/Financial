import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plane, Plus, RefreshCw, X, CheckCircle2, AlertTriangle, AlertCircle, CalendarClock, CalendarCheck,
  Printer, Edit2, Trash2, Undo2, Ban, ChevronDown, ChevronRight, History, Users
} from 'lucide-react';
import DateRangePicker from '../../../components/common/DateRangePicker';
import DatePicker from '../../../components/common/DatePicker';

// ==============================================================================
// --- [BLOCO: CONSTANTES & UTILITÁRIOS] ---
// ==============================================================================

const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const PERIOD_STATUS = {
  VENCIDO: { label: 'Vencido (dobra)', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/40' },
  VENCENDO: { label: 'Vencendo', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
  A_PROGRAMAR: { label: 'A programar', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/40' },
  EM_AQUISICAO: { label: 'Em aquisição', cls: 'bg-slate-700/40 text-slate-300 border-slate-600' },
  PROGRAMADO: { label: 'Programado', cls: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40' },
  QUITADO: { label: 'Quitado', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
  SEM_DIREITO: { label: 'Sem direito (faltas)', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
  REGULARIZADO: { label: 'Quitado (regularizado)', cls: 'bg-teal-500/15 text-teal-300 border-teal-500/40' }
};

const PHASE = {
  PROGRAMADA: { label: 'Programada', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/40', bar: 'bg-sky-500/40 border border-dashed border-sky-400' },
  CONFIRMADA: { label: 'Confirmada', cls: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40', bar: 'bg-indigo-500' },
  EM_GOZO: { label: 'Em gozo', cls: 'bg-purple-500/20 text-purple-300 border-purple-500/40', bar: 'bg-purple-500' },
  GOZADA: { label: 'Gozada', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40', bar: 'bg-emerald-600/70' },
  HISTORICO: { label: 'Histórico', cls: 'bg-slate-700/40 text-slate-300 border-slate-600', bar: 'bg-slate-500/60' },
  CANCELADA: { label: 'Cancelada', cls: 'bg-rose-950/40 text-rose-400/80 border-rose-900/60 line-through', bar: '' }
};

// Ordem de prioridade para escolher o período em destaque de cada colaborador
const FOCUS_ORDER = ['VENCIDO', 'VENCENDO', 'A_PROGRAMAR', 'PROGRAMADO', 'EM_AQUISICAO'];

const parseISO = (iso) => {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const toISO = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
const fmtDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const fmtShort = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// Dias corridos entre duas datas ISO (inclusive) e soma de dias a uma data ISO
const spanDays = (a, b) => (a && b ? Math.round((parseISO(b) - parseISO(a)) / 86400000) + 1 : 0);
const addDaysISO = (iso, n) => {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
const GOZO_LENGTHS = [30, 20, 15, 14, 10, 5];
const DEFAULT_SETTLE_NOTE = 'Férias gozadas antes do controle pelo sistema';
const periodKey = (empId, start) => `${empId}|${start}`;

const periodLabel = (p) =>
  `${p.number}º período • ${fmtDate(p.start)} a ${fmtDate(p.end)} • saldo ${p.balance} dia(s) • conceder até ${fmtDate(p.concessive_end)}`;

const emptyForm = {
  employee_id: '',
  acquisition_start: '',
  start_date: '',
  end_date: '',
  abono_start: '',
  abono_end: '',
  advance_13th: false,
  payment_date: '',
  variable_average: '',
  notes: '',
  historical: false
};

function Badge({ meta }) {
  if (!meta) return null;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

export default function RHFeriasView({ token, apiBase, onRefreshSchedule }) {
  // ==============================================================================
  // --- [BLOCO: ESTADOS PRINCIPAIS] ---
  // ==============================================================================

  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null); // { type: 'ok' | 'warn', text, details? }
  const [view, setView] = useState('controle'); // controle | agenda | mapa
  const [expanded, setExpanded] = useState({});
  const [agendaFilter, setAgendaFilter] = useState('proximas');
  const [mapYear, setMapYear] = useState(new Date().getFullYear());
  const [busyId, setBusyId] = useState(null);

  // Modal de programação
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const previewSeq = useRef(0);

  // Aviso e recibo
  const [receipt, setReceipt] = useState(null);

  // Regularização de períodos antigos (quitação sem datas)
  const [settleOpen, setSettleOpen] = useState(false);
  const [settleFilter, setSettleFilter] = useState('vencidos'); // vencidos | todos
  const [settleSelected, setSettleSelected] = useState(() => new Set());
  const [settleNote, setSettleNote] = useState(DEFAULT_SETTLE_NOTE);
  const [settling, setSettling] = useState(false);
  const [settleMode, setSettleMode] = useState('quitar'); // quitar | desfazer
  const [undoSelected, setUndoSelected] = useState(() => new Set());

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // ==============================================================================
  // --- [BLOCO: CARREGAMENTO DE DADOS (FETCH)] ---
  // ==============================================================================

  const fetchOverview = async () => {
    try {
      if (!overview) setLoading(true);
      setError(null);
      const res = await fetch(`${apiBase}/api/rh/vacations/overview`, { headers });
      if (!res.ok) throw new Error('Falha ao carregar o controle de férias');
      setOverview(await res.json());
    } catch (err) {
      console.error(err);
      setError(err.message || 'Erro de comunicação');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  const showFeedback = (type, text, details = []) => {
    setFeedback({ type, text, details });
    setTimeout(() => setFeedback(null), details.length ? 9000 : 4500);
  };

  const employees = useMemo(() => overview?.employees || [], [overview]);
  const vacations = useMemo(() => overview?.vacations || [], [overview]);
  const summary = overview?.summary || {};
  const empById = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])), [employees]);

  // ==============================================================================
  // --- [BLOCO: MODAL DE PROGRAMAÇÃO + PRÉVIA] ---
  // ==============================================================================

  const formEmployee = empById[Number(form.employee_id)];
  const formPeriods = useMemo(() => {
    if (!formEmployee) return [];
    return formEmployee.periods.filter((p) =>
      p.balance > 0 || (editing && p.start === editing.acquisition_start)
    );
  }, [formEmployee, editing]);
  const formPeriod = formPeriods.find((p) => p.start === form.acquisition_start);

  // Saldo disponível no período para esta programação (na edição, devolve os próprios dias)
  const available = formPeriod
    ? formPeriod.balance + (editing && editing.acquisition_start === formPeriod.start ? editing.days + editing.abono_days : 0)
    : 0;
  const abonoRoom = formPeriod
    ? formPeriod.max_abono - formPeriod.abono_days + (editing && editing.acquisition_start === formPeriod.start ? editing.abono_days : 0)
    : 0;
  const gozoDays = spanDays(form.start_date, form.end_date);
  const abonoDays = spanDays(form.abono_start, form.abono_end);

  const firstOpenPeriod = (emp) =>
    emp?.periods.find((x) => x.balance > 0 && x.status !== 'EM_AQUISICAO') || emp?.periods.find((x) => x.balance > 0);

  const openModal = ({ employeeId = '', period = null, vacation = null, historical = false } = {}) => {
    setEditing(vacation);
    setPreview(null);
    if (vacation) {
      // Programações antigas sem a data do abono: abono logo após o gozo
      const abonoStart = vacation.abono_days
        ? (vacation.abono_start_date || addDaysISO(vacation.end_date, 1))
        : '';
      setForm({
        employee_id: vacation.employee_id,
        acquisition_start: vacation.acquisition_start,
        start_date: vacation.start_date,
        end_date: vacation.end_date,
        abono_start: abonoStart,
        abono_end: abonoStart ? addDaysISO(abonoStart, vacation.abono_days - 1) : '',
        advance_13th: vacation.advance_13th,
        payment_date: vacation.payment_date || '',
        variable_average: vacation.variable_average ?? '',
        notes: vacation.notes || '',
        historical: vacation.status === 'HISTORICO'
      });
    } else {
      const p = period || firstOpenPeriod(empById[Number(employeeId)]);
      setForm({ ...emptyForm, employee_id: employeeId, acquisition_start: p?.start || '', historical });
    }
    setModalOpen(true);
  };

  const updateForm = (patch) => setForm((f) => ({ ...f, ...patch }));

  // Troca de colaborador/período: mantém o início escolhido e limpa o restante
  const onEmployeeChange = (id) => {
    const p = firstOpenPeriod(empById[Number(id)]);
    updateForm({ employee_id: id, acquisition_start: p?.start || '', end_date: '', abono_start: '', abono_end: '' });
  };

  const onPeriodChange = (start) => updateForm({ acquisition_start: start, end_date: '', abono_start: '', abono_end: '' });

  // Abono posicionado logo após o fim do gozo
  const abonoAfter = (gozoEnd, n) => (gozoEnd && n > 0
    ? { abono_start: addDaysISO(gozoEnd, 1), abono_end: addDaysISO(gozoEnd, n) }
    : { abono_start: '', abono_end: '' });

  // Atalho de duração do gozo a partir do início escolhido
  const setGozoLength = (n) => {
    if (!form.start_date) return;
    const gozoEnd = addDaysISO(form.start_date, n - 1);
    const abonoFollows = form.abono_start && form.end_date && form.abono_start === addDaysISO(form.end_date, 1);
    updateForm({ end_date: gozoEnd, ...(abonoFollows ? abonoAfter(gozoEnd, abonoDays) : {}) });
  };

  // Vender 1/3: abono no máximo permitido, logo após o gozo (reduzido para caber no saldo)
  const toggleAbono = (checked) => {
    if (!formPeriod) return;
    if (checked) {
      const ab = Math.max(0, Math.min(abonoRoom, available));
      const gozo = Math.max(0, Math.min(gozoDays || available, available - ab));
      const gozoEnd = form.start_date && gozo ? addDaysISO(form.start_date, gozo - 1) : form.end_date;
      updateForm({ end_date: gozoEnd, ...abonoAfter(gozoEnd, ab) });
    } else {
      updateForm({ abono_start: '', abono_end: '' });
    }
  };

  const buildPayload = () => ({
    employee_id: Number(form.employee_id),
    acquisition_start: form.acquisition_start || null,
    start_date: form.start_date || null,
    days: gozoDays,
    abono_days: form.historical ? 0 : abonoDays,
    abono_start_date: !form.historical && abonoDays ? form.abono_start : null,
    advance_13th: !!form.advance_13th,
    payment_date: form.payment_date || null,
    variable_average: form.variable_average === '' || form.variable_average === null
      ? null
      : parseFloat(String(form.variable_average).replace(/\./g, '').replace(',', '.')) || 0,
    notes: form.notes || null,
    historical: !!form.historical
  });

  // Prévia com validação da CLT e valores do recibo (debounce)
  useEffect(() => {
    if (!modalOpen || !form.employee_id || !form.acquisition_start || !form.start_date || !form.end_date) {
      setPreview(null);
      return undefined;
    }
    const seq = ++previewSeq.current;
    const handle = setTimeout(async () => {
      try {
        setPreviewLoading(true);
        const res = await fetch(`${apiBase}/api/rh/vacations/preview`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...buildPayload(), vacation_id: editing?.id || null })
        });
        const data = await res.json();
        if (seq === previewSeq.current) setPreview(res.ok ? data : { errors: [data.detail || 'Falha na prévia'], warnings: [] });
      } catch {
        if (seq === previewSeq.current) setPreview({ errors: ['Erro de comunicação na prévia'], warnings: [] });
      } finally {
        if (seq === previewSeq.current) setPreviewLoading(false);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [modalOpen, form]);

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      const url = editing ? `${apiBase}/api/rh/vacations/${editing.id}` : `${apiBase}/api/rh/vacations`;
      const res = await fetch(url, { method: editing ? 'PUT' : 'POST', headers, body: JSON.stringify(buildPayload()) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Erro ao salvar as férias');
      setModalOpen(false);
      showFeedback(data.warnings?.length ? 'warn' : 'ok', data.message, data.warnings || []);
      await fetchOverview();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  // ==============================================================================
  // --- [BLOCO: AÇÕES DA AGENDA] ---
  // ==============================================================================

  // Períodos que podem ser quitados: completos, com saldo e ainda não regularizados
  const settleCandidates = useMemo(() => employees.flatMap((emp) => emp.periods
    .filter((per) => per.acquired && per.balance > 0 && !per.settlement)
    .map((per) => ({ emp, period: per, key: periodKey(emp.id, per.start) }))), [employees]);
  const visibleCandidates = settleFilter === 'vencidos'
    ? settleCandidates.filter((c) => c.period.status === 'VENCIDO')
    : settleCandidates;

  const selectedVisible = visibleCandidates.filter((c) => settleSelected.has(c.key));

  // Períodos já quitados na regularização (para desfazer)
  const settledPeriods = useMemo(() => employees.flatMap((emp) => emp.periods
    .filter((per) => per.settlement)
    .map((per) => ({ emp, period: per, id: per.settlement.id }))), [employees]);

  const openUndo = () => {
    setSettleMode('desfazer');
    setUndoSelected(new Set());
    setSettleOpen(true);
  };

  const handleUndoMany = async () => {
    const ids = settledPeriods.filter((x) => undoSelected.has(x.id)).map((x) => x.id);
    if (!ids.length) return;
    if (!window.confirm(`Desfazer ${ids.length} quitação(ões)? Os períodos voltam a mostrar o saldo pendente.`)) return;
    try {
      setSettling(true);
      const res = await fetch(`${apiBase}/api/rh/vacations/settlements/undo`, {
        method: 'POST', headers, body: JSON.stringify({ ids })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Falha ao desfazer as quitações');
      setUndoSelected(new Set());
      showFeedback('ok', data.message);
      await fetchOverview();
    } catch (err) {
      alert(err.message);
    } finally {
      setSettling(false);
    }
  };

  const openSettle = (only = null) => {
    setSettleMode('quitar');
    if (only) {
      setSettleFilter('todos');
      setSettleSelected(new Set([periodKey(only.empId, only.start)]));
    } else {
      setSettleFilter('vencidos');
      setSettleSelected(new Set(settleCandidates.filter((c) => c.period.status === 'VENCIDO').map((c) => c.key)));
    }
    setSettleNote(DEFAULT_SETTLE_NOTE);
    setSettleOpen(true);
  };

  const toggleSettle = (key) => setSettleSelected((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const handleSettle = async () => {
    const items = selectedVisible
      .map((c) => ({ employee_id: c.emp.id, acquisition_start: c.period.start }));
    if (!items.length) return;
    try {
      setSettling(true);
      const res = await fetch(`${apiBase}/api/rh/vacations/settlements`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ items, note: settleNote || null })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Falha ao quitar os períodos');
      setSettleOpen(false);
      showFeedback(data.warnings?.length ? 'warn' : 'ok', data.message, data.warnings || []);
      await fetchOverview();
    } catch (err) {
      alert(err.message);
    } finally {
      setSettling(false);
    }
  };

  const undoSettlement = async (emp, per) => {
    if (!window.confirm(`Desfazer a quitação do ${per.number}º período de ${emp.name}? O saldo volta a aparecer como pendente.`)) return;
    try {
      const res = await fetch(`${apiBase}/api/rh/vacations/settlements/${per.settlement.id}`, { method: 'DELETE', headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Falha ao desfazer a quitação');
      showFeedback('ok', data.message);
      await fetchOverview();
    } catch (err) {
      alert(err.message);
    }
  };

  const runAction = async (v, action, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      setBusyId(v.id);
      const isDelete = action === 'delete';
      const res = await fetch(`${apiBase}/api/rh/vacations/${v.id}${isDelete ? '' : `/${action}`}`, {
        method: isDelete ? 'DELETE' : 'POST',
        headers
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Falha na operação');
      showFeedback(data.warnings?.length ? 'warn' : 'ok', data.message, data.warnings || []);
      await fetchOverview();
      if (['confirm', 'unconfirm', 'cancel'].includes(action) && onRefreshSchedule) onRefreshSchedule();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const openReceipt = async (v) => {
    try {
      setBusyId(v.id);
      const res = await fetch(`${apiBase}/api/rh/vacations/${v.id}/receipt`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Falha ao gerar o aviso/recibo');
      setReceipt(data);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  };

  // ==============================================================================
  // --- [BLOCO: DADOS DERIVADOS] ---
  // ==============================================================================

  const focusPeriod = (emp) => {
    for (const st of FOCUS_ORDER) {
      const p = emp.periods.find((x) => x.status === st);
      if (p) return p;
    }
    return emp.periods[emp.periods.length - 1] || null;
  };

  const agenda = useMemo(() => {
    const list = agendaFilter === 'proximas'
      ? vacations.filter((v) => ['PROGRAMADA', 'CONFIRMADA', 'EM_GOZO'].includes(v.phase))
      : vacations;
    return [...list].sort((a, b) => (agendaFilter === 'proximas'
      ? a.start_date.localeCompare(b.start_date)
      : b.start_date.localeCompare(a.start_date)));
  }, [vacations, agendaFilter]);

  // Mapa anual: segmentos de férias por colaborador e mês
  const mapRows = useMemo(() => employees.map((emp) => {
    const months = Array.from({ length: 12 }, () => ({ segments: [], deadline: null }));
    vacations
      .filter((v) => v.employee_id === emp.id && v.phase !== 'CANCELADA')
      .forEach((v) => {
        const start = parseISO(v.start_date);
        const end = parseISO(v.end_date);
        for (let m = 0; m < 12; m++) {
          const mStart = new Date(mapYear, m, 1);
          const mEnd = new Date(mapYear, m + 1, 0);
          if (end < mStart || start > mEnd) continue;
          const a = start > mStart ? start.getDate() : 1;
          const b = end < mEnd ? end.getDate() : mEnd.getDate();
          months[m].segments.push({ v, a, b, n: mEnd.getDate() });
        }
      });
    emp.periods
      .filter((p) => p.balance > 0 && p.entitled > 0)
      .forEach((p) => {
        const d = parseISO(p.concessive_end);
        if (d.getFullYear() === mapYear) months[d.getMonth()].deadline = p;
      });
    return { emp, months };
  }), [employees, vacations, mapYear]);

  // ==============================================================================
  // --- [BLOCO: RENDERIZAÇÃO] ---
  // ==============================================================================

  const tabBtn = (key, label, icon) => (
    <button
      onClick={() => setView(key)}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
        view === key ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  const card = (label, value, tone, icon, hint) => (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
      <div>
        <span className="text-[11px] text-slate-400 uppercase font-semibold tracking-wider">{label}</span>
        <p className={`text-2xl font-black mt-0.5 ${tone}`}>{value ?? 0}</p>
        {hint && <p className="text-[10px] text-slate-500 mt-0.5">{hint}</p>}
      </div>
      <span className={tone}>{icon}</span>
    </div>
  );

  const renderPeriodCells = (p, emp) => (
    <>
      <td className="px-3 py-2.5">
        <div className="text-slate-200 font-medium">{p.number}º • {fmtDate(p.start)} a {fmtDate(p.end)}</div>
      </td>
      <td className="px-3 py-2.5 text-center">
        <div className="text-slate-200 font-semibold">{p.entitled} dias</div>
        {p.absences > 0 && <div className="text-[10px] text-amber-400">{plural(p.absences, 'falta')}</div>}
      </td>
      <td className="px-3 py-2.5 text-center text-slate-300">
        {p.gozo_days > 0 || p.abono_days > 0 ? (
          <>
            {p.gozo_days}d gozo{p.abono_days > 0 && <span className="text-emerald-400"> + {p.abono_days}d abono</span>}
            <div className="text-[10px] text-slate-500">{p.fractions} {p.fractions === 1 ? 'fração' : 'frações'}</div>
          </>
        ) : '—'}
      </td>
      <td className="px-3 py-2.5 text-center font-bold text-white">{p.balance}</td>
      <td className="px-3 py-2.5">
        <div className={p.status === 'VENCIDO' ? 'text-rose-300 font-semibold' : p.status === 'VENCENDO' ? 'text-amber-300 font-semibold' : 'text-slate-300'}>
          {fmtDate(p.concessive_end)}
        </div>
        {p.balance > 0 && p.acquired && (
          <div className="text-[10px] text-slate-500">
            {p.days_to_deadline >= 0 ? `faltam ${p.days_to_deadline} dias • iniciar até ${fmtShort(p.latest_start)}` : `vencido há ${-p.days_to_deadline} dias`}
          </div>
        )}
        {!p.acquired && <div className="text-[10px] text-slate-500">adquire em {fmtShort(p.end)}</div>}
      </td>
      <td className="px-3 py-2.5">
        <Badge meta={PERIOD_STATUS[p.status]} />
        {p.settlement && (
          <div className="mt-1 text-[10px] text-slate-500 max-w-[220px]">
            {p.settlement.note && <div className="truncate" title={p.settlement.note}>{p.settlement.note}</div>}
            <button
              onClick={() => undoSettlement(emp, p)}
              className="mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
            >
              <Undo2 size={10} /> Desfazer quitação
            </button>
          </div>
        )}
      </td>
    </>
  );

  const renderControle = () => (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-slate-950/70 text-slate-400 uppercase text-[10px] tracking-wider">
          <tr>
            <th className="px-3 py-2.5 text-left">Colaborador</th>
            <th className="px-3 py-2.5 text-left">Admissão</th>
            <th className="px-3 py-2.5 text-left">Período aquisitivo</th>
            <th className="px-3 py-2.5 text-center">Direito</th>
            <th className="px-3 py-2.5 text-center">Programado</th>
            <th className="px-3 py-2.5 text-center">Saldo</th>
            <th className="px-3 py-2.5 text-left">Conceder até</th>
            <th className="px-3 py-2.5 text-left">Situação</th>
            <th className="px-3 py-2.5 text-right">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/80">
          {employees.length === 0 && (
            <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-500 italic">Nenhum colaborador ativo.</td></tr>
          )}
          {employees.map((emp) => {
            const p = focusPeriod(emp);
            const isOpen = !!expanded[emp.id];
            const others = emp.periods.filter((x) => x !== p).slice().reverse();
            return (
              <React.Fragment key={emp.id}>
                <tr className="hover:bg-slate-800/30">
                  <td className="px-3 py-2.5">
                    <button
                      onClick={() => setExpanded((s) => ({ ...s, [emp.id]: !s[emp.id] }))}
                      className="flex items-center gap-1.5 text-left"
                      disabled={emp.periods.length <= 1}
                      title={emp.periods.length > 1 ? 'Ver todos os períodos' : undefined}
                    >
                      {emp.periods.length > 1
                        ? (isOpen ? <ChevronDown size={13} className="text-slate-500" /> : <ChevronRight size={13} className="text-slate-500" />)
                        : <span className="w-[13px]" />}
                      <span>
                        <span className="block font-semibold text-slate-100">{emp.name}</span>
                        <span className="block text-[10px] text-slate-500">{[emp.role, emp.team].filter(Boolean).join(' • ')}</span>
                        {emp.periods.some((x) => x.settlement) && (
                          <span className="block text-[10px] text-teal-400">
                            {emp.periods.filter((x) => x.settlement).length} período(s) quitado(s) na regularização {isOpen ? '' : '— clique para ver'}
                          </span>
                        )}
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-slate-300">{fmtDate(emp.admission_date)}</td>
                  {p ? renderPeriodCells(p, emp) : (
                    <td colSpan={6} className="px-3 py-2.5 text-amber-300">
                      <span className="inline-flex items-center gap-1"><AlertTriangle size={13} /> Informe a data de admissão no cadastro para controlar as férias.</span>
                    </td>
                  )}
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {p && p.balance > 0 && (
                      <button
                        onClick={() => openModal({ employeeId: emp.id, period: p })}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-500 text-white"
                      >
                        <Plus size={12} /> Programar
                      </button>
                    )}
                  </td>
                </tr>
                {isOpen && others.map((op) => (
                  <tr key={op.start} className="bg-slate-950/40">
                    <td className="px-3 py-2 text-[10px] text-slate-500 pl-9">outro período</td>
                    <td />
                    {renderPeriodCells(op, emp)}
                    <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                      {op.balance > 0 && op.acquired && (
                        <>
                        <button
                          onClick={() => openSettle({ empId: emp.id, start: op.start })}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-teal-300 bg-teal-950/40 hover:bg-teal-900/50 border border-teal-800/60"
                          title="Férias já tiradas antes do sistema, sem informar as datas: zera o saldo do período"
                        >
                          <CheckCircle2 size={11} /> Quitar
                        </button>
                        <button
                          onClick={() => openModal({ employeeId: emp.id, period: op, historical: true })}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700"
                          title="Férias já gozadas antes do sistema, informando as datas (não altera a escala)"
                        >
                          <History size={11} /> Histórico c/ datas
                        </button>
                        </>
                      )}
                      {op.balance > 0 && (
                        <button
                          onClick={() => openModal({ employeeId: emp.id, period: op })}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-indigo-600/80 hover:bg-indigo-500 text-white"
                        >
                          <Plus size={11} /> Programar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {isOpen && p && p.balance > 0 && p.acquired && (
                  <tr className="bg-slate-950/40">
                    <td colSpan={9} className="px-3 py-1.5 text-right space-x-1">
                      <span className="text-[10px] text-slate-500 mr-1">{p.number}º período já gozado antes do sistema?</span>
                        <button
                          onClick={() => openSettle({ empId: emp.id, start: p.start })}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-teal-300 bg-teal-950/40 hover:bg-teal-900/50 border border-teal-800/60"
                          title="Férias já tiradas antes do sistema, sem informar as datas: zera o saldo do período"
                        >
                          <CheckCircle2 size={11} /> Quitar
                        </button>
                        <button
                          onClick={() => openModal({ employeeId: emp.id, period: p, historical: true })}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700"
                          title="Férias já gozadas antes do sistema, informando as datas (não altera a escala)"
                        >
                          <History size={11} /> Histórico c/ datas
                        </button>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const actionBtn = (v, label, icon, onClick, tone = 'text-slate-300 hover:text-white') => (
    <button
      onClick={onClick}
      disabled={busyId === v.id}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-slate-800/80 hover:bg-slate-700 border border-slate-700 disabled:opacity-40 ${tone}`}
    >
      {icon} {label}
    </button>
  );

  const renderAgenda = () => (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-400">Mostrar:</span>
        {[['proximas', 'Programadas e em gozo'], ['todas', 'Todas (inclui gozadas, histórico e canceladas)']].map(([k, l]) => (
          <button
            key={k}
            onClick={() => setAgendaFilter(k)}
            className={`px-2.5 py-1 rounded-lg border ${agendaFilter === k ? 'border-indigo-500 text-white bg-indigo-600/20' : 'border-slate-700 text-slate-400 hover:text-white'}`}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-950/70 text-slate-400 uppercase text-[10px] tracking-wider">
            <tr>
              <th className="px-3 py-2.5 text-left">Colaborador</th>
              <th className="px-3 py-2.5 text-left">Gozo</th>
              <th className="px-3 py-2.5 text-left">Retorno</th>
              <th className="px-3 py-2.5 text-center">Abono</th>
              <th className="px-3 py-2.5 text-left">Pagar até</th>
              <th className="px-3 py-2.5 text-right">Líquido est.</th>
              <th className="px-3 py-2.5 text-left">Situação</th>
              <th className="px-3 py-2.5 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {agenda.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500 italic">Nenhuma férias {agendaFilter === 'proximas' ? 'programada' : 'registrada'}.</td></tr>
            )}
            {agenda.map((v) => (
              <tr key={v.id} className="hover:bg-slate-800/30 align-top">
                <td className="px-3 py-2.5">
                  <div className="font-semibold text-slate-100">{v.employee_name}</div>
                  <div className="text-[10px] text-slate-500">Período {fmtDate(v.acquisition_start)} a {fmtDate(v.acquisition_end)}</div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="text-slate-200">{fmtDate(v.start_date)} a {fmtDate(v.end_date)}</div>
                  <div className="text-[10px] text-slate-500">{v.days} dias corridos{v.advance_13th ? ' • adiant. 13º' : ''}</div>
                </td>
                <td className="px-3 py-2.5 text-slate-300">{fmtDate(v.return_date)}</td>
                <td className="px-3 py-2.5 text-center">
                  {v.abono_days ? (
                    <>
                      <div className="text-emerald-300 font-semibold">{v.abono_days} dias</div>
                      {v.abono_start_date && <div className="text-[10px] text-slate-500">{fmtShort(v.abono_start_date)} a {fmtShort(v.abono_end_date)}</div>}
                    </>
                  ) : <span className="text-slate-600">—</span>}
                </td>
                <td className="px-3 py-2.5 text-slate-300">{v.status === 'HISTORICO' ? '—' : fmtDate(v.payment_date)}</td>
                <td className="px-3 py-2.5 text-right font-semibold text-slate-100">{v.status === 'HISTORICO' || !v.calc ? '—' : brl(v.calc.net)}</td>
                <td className="px-3 py-2.5">
                  <Badge meta={PHASE[v.phase]} />
                  {v.schedule_missing_days > 0 && (
                    <div className="mt-1 text-[10px] text-amber-300 flex items-center gap-1" title="Dias alterados na escala depois da confirmação">
                      <AlertTriangle size={11} /> {v.schedule_missing_days} dia(s) fora da escala
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap justify-end gap-1">
                    {(v.phase === 'PROGRAMADA' || v.phase === 'HISTORICO') &&
                      actionBtn(v, 'Editar', <Edit2 size={11} />, () => openModal({ vacation: v }))}
                    {v.phase === 'PROGRAMADA' &&
                      actionBtn(v, 'Confirmar', <CalendarCheck size={11} />, () => runAction(v, 'confirm',
                        `Confirmar as férias de ${v.employee_name} (${fmtDate(v.start_date)} a ${fmtDate(v.end_date)})?\n\nOs dias serão marcados como FÉRIAS na escala e o aviso poderá ser impresso.`),
                      'text-indigo-300 hover:text-white')}
                    {v.schedule_missing_days > 0 &&
                      actionBtn(v, 'Remarcar escala', <RefreshCw size={11} />, () => runAction(v, 'confirm'), 'text-amber-300 hover:text-white')}
                    {v.status !== 'HISTORICO' && v.phase !== 'CANCELADA' &&
                      actionBtn(v, 'Aviso/Recibo', <Printer size={11} />, () => openReceipt(v))}
                    {['CONFIRMADA', 'EM_GOZO'].includes(v.phase) &&
                      actionBtn(v, 'Desfazer', <Undo2 size={11} />, () => runAction(v, 'unconfirm',
                        'Desfazer a confirmação? Os dias voltam ao estado anterior na escala e as férias ficam como programadas.'))}
                    {['PROGRAMADA', 'CONFIRMADA', 'EM_GOZO'].includes(v.phase) &&
                      actionBtn(v, 'Cancelar', <Ban size={11} />, () => runAction(v, 'cancel',
                        'Cancelar estas férias? Os dias voltam ao saldo do período (e à escala, se confirmadas).'), 'text-rose-300 hover:text-white')}
                    {['PROGRAMADA', 'HISTORICO', 'CANCELADA'].includes(v.phase) &&
                      actionBtn(v, 'Excluir', <Trash2 size={11} />, () => runAction(v, 'delete', 'Excluir definitivamente este registro de férias?'), 'text-rose-300 hover:text-white')}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderMapa = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button onClick={() => setMapYear((y) => y - 1)} className="px-2 py-1 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-xs">‹</button>
          <span className="text-sm font-bold text-white w-14 text-center">{mapYear}</span>
          <button onClick={() => setMapYear((y) => y + 1)} className="px-2 py-1 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-xs">›</button>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-slate-400 flex-wrap">
          {['PROGRAMADA', 'CONFIRMADA', 'EM_GOZO', 'GOZADA'].map((k) => (
            <span key={k} className="flex items-center gap-1"><span className={`inline-block w-3 h-2 rounded-sm ${PHASE[k].bar}`} /> {PHASE[k].label}</span>
          ))}
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-rose-500" /> Limite do período concessivo (com saldo)</span>
        </div>
      </div>
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-xs table-fixed min-w-[900px]">
          <thead className="bg-slate-950/70 text-slate-400 uppercase text-[10px] tracking-wider">
            <tr>
              <th className="px-3 py-2 text-left w-48">Colaborador</th>
              {MONTH_SHORT.map((m) => <th key={m} className="px-1 py-2 text-center">{m}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {mapRows.map(({ emp, months }) => (
              <tr key={emp.id}>
                <td className="px-3 py-2 truncate text-slate-200 font-medium" title={emp.name}>{emp.name}</td>
                {months.map((cell, m) => (
                  <td key={m} className="px-0.5 py-2 border-l border-slate-800/60">
                    <div className="relative h-5 rounded bg-slate-950/60">
                      {cell.segments.map(({ v, a, b, n }) => (
                        <div
                          key={`${v.id}-${a}`}
                          className={`absolute top-0.5 bottom-0.5 rounded-sm ${PHASE[v.phase]?.bar || 'bg-slate-500'}`}
                          style={{ left: `${((a - 1) / n) * 100}%`, width: `${Math.max(4, ((b - a + 1) / n) * 100)}%` }}
                          title={`${v.employee_name}: ${fmtDate(v.start_date)} a ${fmtDate(v.end_date)} (${v.days} dias) • ${PHASE[v.phase]?.label}`}
                        />
                      ))}
                      {cell.deadline && (
                        <span
                          className="absolute -top-1 right-0.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-slate-900"
                          title={`Limite para conceder o ${cell.deadline.number}º período: ${fmtDate(cell.deadline.concessive_end)} (saldo ${cell.deadline.balance} dias)`}
                        />
                      )}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const errors = preview?.errors || [];
  const warnings = preview?.warnings || [];
  const calc = preview?.calc;
  const canSave = form.employee_id && form.acquisition_start && form.start_date && form.end_date && preview && !previewLoading && errors.length === 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Barra de Topo */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Plane className="text-purple-400" size={20} />
            Férias, Abono Pecuniário & Agendamento
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Períodos aquisitivo e concessivo (CLT arts. 130 a 134), fracionamento em até 3 períodos, abono de até 1/3 (art. 143)
            e aviso/recibo. Ao confirmar, os dias são marcados como Férias na escala.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchOverview}
            className="p-2 rounded-xl text-slate-400 hover:text-white bg-slate-950 border border-slate-800"
            title="Atualizar"
          >
            <RefreshCw size={15} />
          </button>
          <button
            onClick={() => openSettle()}
            disabled={settleCandidates.length === 0}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-teal-300 bg-teal-950/40 hover:bg-teal-900/50 border border-teal-800/60 disabled:opacity-40"
            title="Quitar períodos antigos sem informar as datas das férias"
          >
            <History size={15} />
            Regularizar períodos antigos
          </button>
          {settledPeriods.length > 0 && (
            <button
              onClick={openUndo}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-slate-950 hover:bg-slate-800 border border-slate-700"
              title="Ver e desfazer períodos quitados na regularização"
            >
              <Undo2 size={15} />
              Quitados ({settledPeriods.length})
            </button>
          )}
          <button
            onClick={() => openModal()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30"
          >
            <Plus size={15} />
            Programar Férias
          </button>
        </div>
      </div>

      {/* Cartões de Alerta */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {card('Períodos vencidos', summary.vencidos, 'text-rose-400', <AlertCircle size={20} />, 'saldo após o prazo: dobra')}
        {card('Vencendo em 90 dias', summary.vencendo, 'text-amber-400', <AlertTriangle size={20} />, 'programar com urgência')}
        {card('A programar', summary.a_programar, 'text-sky-400', <CalendarClock size={20} />)}
        {card('Programadas', summary.programadas, 'text-indigo-400', <CalendarCheck size={20} />, 'futuras (programadas ou confirmadas)')}
        {card('Em gozo hoje', summary.em_gozo, 'text-purple-400', <Plane size={20} />)}
      </div>

      {summary.vencidos > 0 && (
        <div className="bg-rose-950/30 border border-rose-500/40 text-rose-200 text-xs px-4 py-2.5 rounded-xl flex items-center gap-2 flex-wrap">
          <AlertCircle size={15} className="text-rose-400" />
          <span className="flex-1">
            {summary.vencidos} período(s) vencido(s). Se essas férias já foram tiradas antes do controle pelo sistema,
            quite-as sem precisar informar as datas.
          </span>
          <button onClick={() => openSettle()} className="font-semibold underline">Regularizar agora</button>
        </div>
      )}

      {summary.sem_admissao > 0 && (
        <div className="bg-amber-950/30 border border-amber-500/40 text-amber-300 text-xs px-4 py-2.5 rounded-xl flex items-center gap-2">
          <AlertTriangle size={15} />
          {summary.sem_admissao} colaborador(es) sem data de admissão: os períodos de férias não podem ser calculados.
        </div>
      )}

      {feedback && (
        <div className={`text-xs px-4 py-2.5 rounded-xl border animate-in fade-in ${
          feedback.type === 'ok' ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300' : 'bg-amber-950/40 border-amber-500/40 text-amber-300'
        }`}>
          <div className="flex items-center gap-2 font-semibold">
            {feedback.type === 'ok' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            {feedback.text}
          </div>
          {feedback.details?.length > 0 && (
            <ul className="mt-1 ml-6 list-disc space-y-0.5">
              {feedback.details.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="flex items-center gap-1 bg-slate-900/60 border border-slate-800 rounded-xl p-1 w-fit">
        {tabBtn('controle', 'Controle por colaborador', <Users size={14} />)}
        {tabBtn('agenda', 'Agenda de férias', <CalendarCheck size={14} />)}
        {tabBtn('mapa', 'Mapa anual', <CalendarClock size={14} />)}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 bg-slate-900/60 border border-slate-800 rounded-xl animate-pulse" />)}
        </div>
      ) : error ? (
        <div className="bg-rose-950/30 border border-rose-500/40 text-rose-300 text-xs px-4 py-3 rounded-xl flex items-center gap-2">
          <AlertCircle size={15} /> {error}
          <button onClick={fetchOverview} className="ml-auto underline">Tentar novamente</button>
        </div>
      ) : (
        <>
          {view === 'controle' && renderControle()}
          {view === 'agenda' && renderAgenda()}
          {view === 'mapa' && renderMapa()}
        </>
      )}

      {/* ============================================================================== */}
      {/* --- [MODAL: PROGRAMAÇÃO DE FÉRIAS] --- */}
      {/* ============================================================================== */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-5xl w-full shadow-2xl animate-in zoom-in-95 duration-200 max-h-[94vh] flex flex-col">
            <div className="flex items-start justify-between border-b border-slate-800 px-6 py-4">
              <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
                {form.historical ? <History size={18} /> : <Plane size={18} />}
                {form.historical
                  ? 'Lançar férias já gozadas (histórico)'
                  : editing ? 'Editar programação de férias' : 'Programar férias'}
              </div>
              <button type="button" onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-white p-1 rounded">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSave} className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-5 gap-0 text-xs">
              {/* Campos */}
              <div className="lg:col-span-3 p-6 space-y-4 lg:border-r border-slate-800">
                {form.historical && (
                  <p className="text-[11px] text-slate-400 bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2">
                    Use para férias gozadas antes do controle pelo sistema: quita o saldo do período sem alterar a escala nem calcular recibo.
                  </p>
                )}
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Colaborador</label>
                  <select
                    value={form.employee_id}
                    disabled={!!editing}
                    onChange={(e) => onEmployeeChange(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                  >
                    <option value="">Selecione...</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id} disabled={!emp.admission_date}>
                        {emp.name}{!emp.admission_date ? ' (sem data de admissão)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Período aquisitivo</label>
                  <select
                    value={form.acquisition_start}
                    onChange={(e) => onPeriodChange(e.target.value)}
                    disabled={!formEmployee}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                  >
                    <option value="">{formEmployee && formPeriods.length === 0 ? 'Nenhum período com saldo' : 'Selecione...'}</option>
                    {formPeriods.map((p) => (
                      <option key={p.start} value={p.start}>{periodLabel(p)}</option>
                    ))}
                  </select>
                  {formPeriod && (
                    <p className="text-[10px] text-slate-500 mt-1">
                      Direito: {formPeriod.entitled} dias ({plural(formPeriod.absences, 'falta')} no período) • abono máximo: {formPeriod.max_abono} dias
                      • disponível agora: {available} dia(s)
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Período de gozo</label>
                  <DateRangePicker
                    startValue={form.start_date}
                    endValue={form.end_date}
                    onStartChange={(v) => updateForm({ start_date: v })}
                    onEndChange={(v) => updateForm({ end_date: v })}
                    presets={[]}
                    openAtStart
                    align="left"
                    compact
                    placeholder="Selecione o início e o fim do gozo"
                    buttonClassName="w-full"
                  />
                  <div className="flex items-center flex-wrap gap-1.5 mt-1.5">
                    {gozoDays > 0 && (
                      <span className="text-[11px] text-slate-300 mr-1">
                        <strong className="text-white">{gozoDays} dias corridos</strong> • retorno em {fmtDate(addDaysISO(form.end_date, 1))}
                      </span>
                    )}
                    {form.start_date && GOZO_LENGTHS.filter((n) => n <= available - abonoDays).map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setGozoLength(n)}
                        className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                          gozoDays === n ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200' : 'border-slate-700 text-slate-400 hover:text-white'
                        }`}
                      >
                        {n} dias
                      </button>
                    ))}
                  </div>
                </div>

                {!form.historical && (
                  <>
                    <div className="bg-emerald-950/20 border border-emerald-800/40 rounded-lg px-3 py-2.5 space-y-2">
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-0.5 accent-emerald-500"
                          checked={abonoDays > 0}
                          disabled={!formPeriod || abonoRoom <= 0}
                          onChange={(e) => toggleAbono(e.target.checked)}
                        />
                        <span>
                          <span className="font-semibold text-emerald-300">Abono pecuniário — vender 1/3 das férias</span>
                          <span className="block text-[10px] text-slate-400 mt-0.5">
                            O colaborador converte até 1/3 do direito ({Math.max(0, abonoRoom)} dias disponíveis) em dinheiro (art. 143): trabalha
                            nesses dias e recebe os dias + 1/3, sem INSS, IRRF nem FGTS. Deve ser requerido até 15 dias antes do fim do período aquisitivo.
                          </span>
                        </span>
                      </label>
                      <div>
                        <label className="block text-slate-400 mb-1 font-medium">Período do abono</label>
                        <DateRangePicker
                          startValue={form.abono_start}
                          endValue={form.abono_end}
                          onStartChange={(v) => updateForm({ abono_start: v })}
                          onEndChange={(v) => updateForm({ abono_end: v })}
                          presets={[]}
                          openAtStart
                          align="left"
                          compact
                          disabled={!formPeriod || abonoRoom <= 0}
                          placeholder="Sem abono"
                          buttonClassName="w-full"
                        />
                        <div className="flex items-center flex-wrap gap-1.5 mt-1.5">
                          {abonoDays > 0 && (
                            <span className="text-[11px] text-emerald-300 mr-1"><strong>{abonoDays} dias</strong> de abono</span>
                          )}
                          {form.end_date && abonoRoom > 0 && (
                            <button
                              type="button"
                              onClick={() => updateForm(abonoAfter(form.end_date, Math.min(abonoRoom, Math.max(0, available - gozoDays))))}
                              disabled={available - gozoDays <= 0}
                              className="px-2 py-0.5 rounded-md text-[10px] font-semibold border border-emerald-800/60 text-emerald-300 hover:text-white disabled:opacity-40"
                            >
                              Logo após o gozo ({Math.min(abonoRoom, Math.max(0, available - gozoDays))} dias)
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-slate-400 mb-1 font-medium">Data do pagamento</label>
                        <DatePicker
                          value={form.payment_date}
                          onChange={(v) => updateForm({ payment_date: v })}
                          align="left"
                          placeholder={preview?.suggested_payment_date
                            ? `Automático: ${fmtDate(preview.suggested_payment_date)}`
                            : 'Automático: 2 dias antes do início'}
                        />
                        <p className="text-[10px] text-slate-500 mt-1">
                          Até 2 dias antes do início do gozo (art. 145).
                          {form.payment_date && (
                            <button type="button" onClick={() => updateForm({ payment_date: '' })} className="ml-1 underline hover:text-slate-300">
                              Usar data automática
                            </button>
                          )}
                        </p>
                      </div>
                      <div>
                        <label className="block text-slate-400 mb-1 font-medium">Médias de variáveis (R$/mês)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={form.variable_average}
                          placeholder={calc ? `Automático: ${brl(calc.variable_average_auto)}` : 'Automático'}
                          onChange={(e) => updateForm({ variable_average: e.target.value })}
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                        />
                        <p className="text-[10px] text-slate-500 mt-1">Média das horas extras das folhas do período aquisitivo; informe para substituir.</p>
                      </div>
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                      <input
                        type="checkbox"
                        className="accent-indigo-500"
                        checked={form.advance_13th}
                        onChange={(e) => updateForm({ advance_13th: e.target.checked })}
                      />
                      Pagar a 1ª parcela do 13º salário com as férias (requerida em janeiro — Lei 4.749/65, art. 2º §2º)
                    </label>
                  </>
                )}

                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Observações</label>
                  <textarea
                    rows={2}
                    value={form.notes}
                    onChange={(e) => updateForm({ notes: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Prévia */}
              <div className="lg:col-span-2 p-6 space-y-3 bg-slate-950/40">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">Prévia</span>
                  {previewLoading && <RefreshCw size={13} className="animate-spin text-slate-500" />}
                </div>
                {!preview ? (
                  <p className="text-slate-500 italic">Escolha o colaborador, o período e a data de início.</p>
                ) : (
                  <>
                    {preview.end_date && (
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
                          <div className="text-[10px] text-slate-500">Término</div>
                          <div className="font-semibold text-white">{fmtDate(preview.end_date)}</div>
                        </div>
                        <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
                          <div className="text-[10px] text-slate-500">Retorno</div>
                          <div className="font-semibold text-white">{fmtDate(preview.return_date)}</div>
                        </div>
                        <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
                          <div className="text-[10px] text-slate-500">Pagamento</div>
                          <div className="font-semibold text-white">{form.historical ? '—' : fmtDate(preview.payment_date)}</div>
                        </div>
                      </div>
                    )}
                    {errors.map((e2, i) => (
                      <div key={`e${i}`} className="flex gap-2 text-rose-300 bg-rose-950/30 border border-rose-800/50 rounded-lg px-2.5 py-2">
                        <AlertCircle size={13} className="shrink-0 mt-0.5" /> <span>{e2}</span>
                      </div>
                    ))}
                    {warnings.map((w, i) => (
                      <div key={`w${i}`} className="flex gap-2 text-amber-300 bg-amber-950/20 border border-amber-800/40 rounded-lg px-2.5 py-2">
                        <AlertTriangle size={13} className="shrink-0 mt-0.5" /> <span>{w}</span>
                      </div>
                    ))}
                    {errors.length === 0 && warnings.length === 0 && (
                      <div className="flex gap-2 text-emerald-300 bg-emerald-950/20 border border-emerald-800/40 rounded-lg px-2.5 py-2">
                        <CheckCircle2 size={13} className="shrink-0 mt-0.5" /> Programação de acordo com as regras da CLT.
                      </div>
                    )}
                    {calc && !form.historical && (
                      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                        <div className="px-3 py-2 border-b border-slate-800 text-[10px] text-slate-400">
                          Remuneração base {brl(calc.remuneration)} (salário {brl(calc.salary)}
                          {calc.triennium > 0 ? ` + triênio ${brl(calc.triennium)}` : ''}
                          {calc.variable_average > 0 ? ` + médias ${brl(calc.variable_average)}` : ''}) • diária {brl(calc.daily_rate)}
                        </div>
                        <table className="w-full">
                          <tbody>
                            {calc.lines.map((l) => (
                              <tr key={l.key} className="border-b border-slate-800/60">
                                <td className="px-3 py-1.5 text-slate-300">{l.code && <span className="font-mono text-slate-500 mr-1.5">{l.code}</span>}{l.label}<span className="text-[10px] text-slate-500 ml-1">{l.reference}</span></td>
                                <td className={`px-3 py-1.5 text-right font-mono ${l.kind === 'DESPESA' ? 'text-rose-300' : 'text-slate-100'}`}>
                                  {l.kind === 'DESPESA' ? '-' : ''}{brl(l.amount)}
                                </td>
                              </tr>
                            ))}
                            <tr className="bg-slate-950/60">
                              <td className="px-3 py-2 font-bold text-white">Líquido a pagar</td>
                              <td className="px-3 py-2 text-right font-mono font-bold text-emerald-300">{brl(calc.net)}</td>
                            </tr>
                          </tbody>
                        </table>
                        <div className="px-3 py-2 text-[10px] text-slate-500">
                          FGTS (empresa): {brl(calc.fgts)} • Estimativa: INSS calculado só sobre as férias; a contabilidade apura o definitivo com o salário da competência.
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="lg:col-span-5 flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-800">
                <button type="button" onClick={() => setModalOpen(false)} className="px-3.5 py-2 rounded-lg text-slate-400 hover:text-white bg-slate-800">
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!canSave || saving}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow shadow-indigo-600/30 disabled:opacity-50"
                >
                  {saving ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  {saving ? 'Salvando...' : form.historical ? 'Registrar histórico' : editing ? 'Salvar alterações' : 'Programar férias'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================================== */}
      {/* --- [MODAL: REGULARIZAÇÃO DE PERÍODOS ANTIGOS] --- */}
      {/* ============================================================================== */}
      {settleOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col text-xs">
            <div className="flex items-start justify-between border-b border-slate-800 px-6 py-4">
              <div>
                <div className="flex items-center gap-2 text-teal-300 font-bold text-sm">
                  <History size={18} /> Regularizar períodos antigos
                </div>
                <div className="flex gap-1 mt-3">
                  {[['quitar', `Quitar pendentes (${settleCandidates.length})`], ['desfazer', `Quitados — desfazer (${settledPeriods.length})`]].map(([k, l]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setSettleMode(k)}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold ${settleMode === k ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Quita o saldo dos períodos selecionados sem informar as datas das férias. Nada é alterado na escala nem na folha;
                  a quitação pode ser desfeita a qualquer momento.
                </p>
              </div>
              <button type="button" onClick={() => setSettleOpen(false)} className="text-slate-400 hover:text-white p-1 rounded">
                <X size={16} />
              </button>
            </div>

            {settleMode === 'desfazer' ? (
              <>
                <div className="px-6 py-3 flex items-center gap-2 border-b border-slate-800">
                  <span className="text-slate-400">Marque as quitações que devem voltar a ficar pendentes.</span>
                  <span className="ml-auto flex gap-2">
                    <button type="button" className="underline text-slate-400 hover:text-white"
                      onClick={() => setUndoSelected(new Set(settledPeriods.map((x) => x.id)))}>
                      Marcar todos
                    </button>
                    <button type="button" className="underline text-slate-400 hover:text-white" onClick={() => setUndoSelected(new Set())}>
                      Desmarcar
                    </button>
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-3 space-y-1">
                  {settledPeriods.length === 0 && (
                    <p className="text-center text-slate-500 italic py-6">Nenhum período quitado na regularização.</p>
                  )}
                  {settledPeriods.map(({ emp, period: per, id }) => (
                    <label key={id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-950/50 border border-slate-800 hover:border-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-rose-500"
                        checked={undoSelected.has(id)}
                        onChange={() => setUndoSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(id)) next.delete(id); else next.add(id);
                          return next;
                        })}
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block font-semibold text-slate-100 truncate">{emp.name}</span>
                        <span className="block text-[10px] text-slate-400">
                          {per.number}º período • {fmtDate(per.start)} a {fmtDate(per.end)}
                          {per.settlement.note ? ` • ${per.settlement.note}` : ''}
                        </span>
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {per.settlement.created_at ? `quitado em ${fmtDate(per.settlement.created_at.slice(0, 10))}` : ''}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-slate-800">
                  <span className="text-slate-400">{undoSelected.size} quitação(ões) selecionada(s)</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setSettleOpen(false)} className="px-3.5 py-2 rounded-lg text-slate-400 hover:text-white bg-slate-800">
                      Fechar
                    </button>
                    <button
                      type="button"
                      onClick={handleUndoMany}
                      disabled={settling || undoSelected.size === 0}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-semibold bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50"
                    >
                      {settling ? <RefreshCw size={14} className="animate-spin" /> : <Undo2 size={14} />}
                      Desfazer selecionadas
                    </button>
                  </div>
                </div>
              </>
            ) : (
            <>
            <div className="px-6 py-3 flex items-center gap-2 flex-wrap border-b border-slate-800">
              <span className="text-slate-400">Mostrar:</span>
              {[['vencidos', 'Somente vencidos'], ['todos', 'Todos os períodos completos com saldo']].map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSettleFilter(k)}
                  className={`px-2.5 py-1 rounded-lg border ${settleFilter === k ? 'border-teal-500 text-white bg-teal-600/20' : 'border-slate-700 text-slate-400 hover:text-white'}`}
                >
                  {l}
                </button>
              ))}
              <span className="ml-auto flex gap-2">
                <button type="button" className="underline text-slate-400 hover:text-white"
                  onClick={() => setSettleSelected((prev) => new Set([...prev, ...visibleCandidates.map((c) => c.key)]))}>
                  Marcar todos
                </button>
                <button type="button" className="underline text-slate-400 hover:text-white" onClick={() => setSettleSelected(new Set())}>
                  Desmarcar
                </button>
              </span>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-3 space-y-1">
              {visibleCandidates.length === 0 && (
                <p className="text-center text-slate-500 italic py-6">Nenhum período pendente {settleFilter === 'vencidos' ? 'vencido' : 'com saldo'}.</p>
              )}
              {visibleCandidates.map(({ emp, period: per, key }) => (
                <label key={key} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-950/50 border border-slate-800 hover:border-slate-700 cursor-pointer">
                  <input type="checkbox" className="accent-teal-500" checked={settleSelected.has(key)} onChange={() => toggleSettle(key)} />
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold text-slate-100 truncate">{emp.name}</span>
                    <span className="block text-[10px] text-slate-400">
                      {per.number}º período • {fmtDate(per.start)} a {fmtDate(per.end)} • conceder até {fmtDate(per.concessive_end)}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block font-bold text-white">{per.balance} dias</span>
                    <Badge meta={PERIOD_STATUS[per.status]} />
                  </span>
                </label>
              ))}
            </div>

            <div className="px-6 py-3 border-t border-slate-800">
              <label className="block text-slate-400 mb-1 font-medium">Observação da quitação</label>
              <input
                type="text"
                value={settleNote}
                onChange={(e) => setSettleNote(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-teal-500"
              />
            </div>

            <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-slate-800">
              <span className="text-slate-400">{selectedVisible.length} período(s) selecionado(s)</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSettleOpen(false)} className="px-3.5 py-2 rounded-lg text-slate-400 hover:text-white bg-slate-800">
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSettle}
                  disabled={settling || selectedVisible.length === 0}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-semibold bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-50"
                >
                  {settling ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  {settling ? 'Quitando...' : 'Quitar selecionados'}
                </button>
              </div>
            </div>
            </>
            )}
          </div>
        </div>
      )}

      {receipt && <RHFeriasRecibo data={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

// ==============================================================================
// --- [AVISO E RECIBO DE FÉRIAS (IMPRESSÃO)] ---
// ==============================================================================

function RHFeriasRecibo({ data, onClose }) {
  const { vacation: v, employee: emp, company } = data;
  const calc = v.calc || { lines: [], gross: 0, discounts: 0, net: 0 };
  const companyName = company.razao_social || company.nome_fantasia || company.name || '________________________';
  const city = company.cidade ? `${company.cidade}${company.uf ? `/${company.uf}` : ''}` : '______________________';
  const noticeDate = v.notice_date || toISO(new Date());
  const proventos = calc.lines.filter((l) => l.kind === 'RECEITA');
  const descontos = calc.lines.filter((l) => l.kind === 'DESPESA');

  const header = (title, subtitle) => (
    <div className="border border-black p-2 mb-2">
      <div className="text-[12pt] font-bold uppercase">{title}</div>
      {subtitle && <div className="text-[8pt] text-gray-600">{subtitle}</div>}
      <div className="grid grid-cols-3 gap-x-3 text-[8.5pt] mt-1">
        <div className="col-span-2">Empregador: <strong>{companyName}</strong></div>
        <div>CNPJ: <strong>{company.cnpj || '—'}</strong></div>
        <div className="col-span-2">Empregado: <strong className="uppercase">{emp.name}</strong></div>
        <div>Matrícula: <strong>{emp.matricula || '—'}</strong></div>
        <div>Cargo: <strong>{emp.role || '—'}</strong></div>
        <div>Admissão: <strong>{fmtDate(emp.admission_date)}</strong></div>
        <div>CTPS: <strong>{emp.ctps || '—'}</strong></div>
      </div>
    </div>
  );

  const signatures = (left, right) => (
    <div className="grid grid-cols-2 gap-10 mt-8 text-[8.5pt]">
      <div className="border-t border-black pt-1 text-center">{left}</div>
      <div className="border-t border-black pt-1 text-center">{right}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-4xl w-full p-4 sm:p-6 shadow-2xl text-slate-200 max-h-[94vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3 mb-4 print:hidden">
          <div>
            <h3 className="font-bold text-white text-base">Aviso e Recibo de Férias</h3>
            <p className="text-[11px] text-slate-400">
              {emp.name} • {fmtDate(v.start_date)} a {fmtDate(v.end_date)}
              {v.status !== 'CONFIRMADA' && ' • prévia (confirme as férias para registrar o aviso)'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700">
              Fechar
            </button>
            <button onClick={() => window.print()} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white">
              <Printer size={15} /> Imprimir / Gerar PDF
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 bg-slate-950/40 p-3 rounded-lg border border-slate-800/80">
          <div className="ferias-print-container bg-white text-black mx-auto p-6 shadow-lg text-[9pt] leading-snug" style={{ maxWidth: '210mm', fontFamily: 'Arial, Helvetica, sans-serif' }}>
            {/* Aviso de férias (art. 135) */}
            {header('Aviso de Férias', 'CLT, art. 135 — comunicação com antecedência mínima de 30 dias')}
            <p className="mt-2">
              Comunicamos que, de acordo com a legislação vigente, suas férias relativas ao período aquisitivo de
              {' '}<strong>{fmtDate(v.acquisition_start)}</strong> a <strong>{fmtDate(v.acquisition_end)}</strong> serão concedidas de
              {' '}<strong>{fmtDate(v.start_date)}</strong> a <strong>{fmtDate(v.end_date)}</strong> ({v.days} dias corridos),
              devendo V.Sa. retornar ao trabalho em <strong>{fmtDate(v.return_date)}</strong>.
              {v.abono_days > 0 && (
                <> Conforme seu requerimento, <strong>{v.abono_days} dias</strong>
                  {v.abono_start_date && <> (de <strong>{fmtDate(v.abono_start_date)}</strong> a <strong>{fmtDate(v.abono_end_date)}</strong>)</>}
                  {' '}serão convertidos em abono pecuniário (art. 143).</>
              )}
              {' '}A remuneração das férias será paga até <strong>{fmtDate(v.payment_date)}</strong> (art. 145).
            </p>
            <p className="mt-3">{city}, {fmtDate(noticeDate)}.</p>
            {signatures('Empregador', 'Ciente — Empregado')}

            {v.abono_days > 0 && (
              <div className="mt-6 break-inside-avoid">
                <div className="border border-black p-2">
                  <div className="text-[11pt] font-bold uppercase">Requerimento de Abono Pecuniário</div>
                  <div className="text-[8pt] text-gray-600">CLT, art. 143</div>
                </div>
                <p className="mt-2">
                  Eu, <strong className="uppercase">{emp.name}</strong>, venho requerer a conversão de <strong>{v.abono_days} dias</strong> das
                  férias relativas ao período aquisitivo de {fmtDate(v.acquisition_start)} a {fmtDate(v.acquisition_end)} em abono pecuniário,
                  nos termos do art. 143 da CLT.
                </p>
                <p className="mt-2">{city}, ____/____/________.</p>
                {signatures('Empregado', 'De acordo — Empregador')}
              </div>
            )}

            {/* Recibo de férias */}
            <div className="mt-8 break-inside-avoid">
              {header('Recibo de Férias', `Gozo de ${fmtDate(v.start_date)} a ${fmtDate(v.end_date)} • período aquisitivo ${fmtDate(v.acquisition_start)} a ${fmtDate(v.acquisition_end)}`)}
              <div className="text-[8pt] mb-1">
                Remuneração base: <strong>{brl(calc.remuneration)}</strong>
                {calc.variable_average > 0 && <> (inclui médias de {brl(calc.variable_average)})</>}
              </div>
              <table className="w-full border-collapse text-[8.5pt]">
                <thead>
                  <tr className="bg-gray-200">
                    <th className="border border-black px-1.5 py-0.5 text-left">Descrição</th>
                    <th className="border border-black px-1.5 py-0.5 text-left w-28">Referência</th>
                    <th className="border border-black px-1.5 py-0.5 text-right w-28">Proventos</th>
                    <th className="border border-black px-1.5 py-0.5 text-right w-28">Descontos</th>
                  </tr>
                </thead>
                <tbody>
                  {[...proventos, ...descontos].map((l) => (
                    <tr key={l.key}>
                      <td className="border border-black px-1.5 py-0.5">{l.code ? `${l.code} ` : ''}{l.label}</td>
                      <td className="border border-black px-1.5 py-0.5">{l.reference}</td>
                      <td className="border border-black px-1.5 py-0.5 text-right">{l.kind === 'RECEITA' ? brl(l.amount) : ''}</td>
                      <td className="border border-black px-1.5 py-0.5 text-right">{l.kind === 'DESPESA' ? brl(l.amount) : ''}</td>
                    </tr>
                  ))}
                  <tr className="font-bold">
                    <td className="border border-black px-1.5 py-0.5" colSpan={2}>Totais</td>
                    <td className="border border-black px-1.5 py-0.5 text-right">{brl(calc.gross)}</td>
                    <td className="border border-black px-1.5 py-0.5 text-right">{brl(calc.discounts)}</td>
                  </tr>
                  <tr className="font-bold bg-gray-100">
                    <td className="border border-black px-1.5 py-0.5" colSpan={3}>Líquido a receber</td>
                    <td className="border border-black px-1.5 py-0.5 text-right">{brl(calc.net)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-3">
                Recebi de <strong>{companyName}</strong> a importância líquida de <strong>{brl(calc.net)}</strong>, referente às férias acima
                discriminadas, da qual dou plena e geral quitação.
              </p>
              <p className="mt-2">{city}, {fmtDate(v.payment_date)}.</p>
              {signatures('Empregador', 'Empregado')}
            </div>
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body * { visibility: hidden; }
          .ferias-print-container, .ferias-print-container * { visibility: visible; }
          .ferias-print-container {
            position: absolute; left: 0; top: 0; width: 100%; max-width: none !important;
            box-shadow: none !important; padding: 10mm 12mm !important; margin: 0 !important;
          }
          @page { size: A4; margin: 0; }
        }
      `}} />
    </div>
  );
}
