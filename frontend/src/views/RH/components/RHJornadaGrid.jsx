import React, { useState, useMemo } from 'react';
import { 
  Clock, Plus, CheckCircle2, AlertTriangle, Calendar, Save, 
  RefreshCw, ChevronRight, Sliders, Sparkles, Filter, Info, X,
  RotateCcw, Trash2, Undo2, MousePointerSquareDashed
} from 'lucide-react';
import SelectDropdown from '../../../components/common/SelectDropdown';
import StyledCheckbox from '../../../components/common/StyledCheckbox';
import RHJornadaBatchPanel, {
  STATUS_OPTIONS,
  toMinutes,
  computeWorkedMinutes,
  formatWorked,
  contractTimes
} from './RHJornadaBatchPanel';

const UNDO_LIMIT = 50;

// Hora compacta para a célula: "07:00" → "7", "07:30" → "7:30"
const compactTime = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':');
  return `${parseInt(h, 10)}${m && m !== '00' ? `:${m}` : ''}`;
};

const compactRange = (start, end) => (start && end ? `${compactTime(start)}–${compactTime(end)}` : '');

// Saldo curto para o selo: 240 → "4h", 30 → "0h30"
const shortHours = (mins) => {
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${h}h${m ? String(m).padStart(2, '0') : ''}`;
};

const LATE_DECISIONS = [
  { key: 'ACEITAR_COMPENSACAO', label: 'Aceitar compensação' },
  { key: 'ABONAR', label: 'Abonar atraso' },
  { key: 'NORMAL', label: 'Tratar normalmente' }
];

const WEEKDAY_SHORT =['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

export default function RHJornadaGrid({
  employees = [],
  workDays = {}, // workDays[empId][day] (com contract_day e ledger calculados no backend)
  daysList = [],
  sundays = [],
  holidays = {},
  selectedYear,
  selectedMonth,
  scheduleId,
  token,
  apiBase,
  onRefresh,
  summaries = [],
  onDirtyChange,
  onOpenAudit,
  complianceDays = {}, // { empId: { day: ['R01', ...] } } irregularidades da auditoria do mês
  absenceDsrMode = 'ONE'
}) {
  const [dirty, setDirty] = useState(false);

  // Informa a tela principal sobre edições pendentes (aviso ao trocar de aba/mês)
  React.useEffect(() => {
    if (onDirtyChange) onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  React.useEffect(() => () => { if (onDirtyChange) onDirtyChange(false); }, [onDirtyChange]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  // Aviso rápido (toast) com as irregularidades novas causadas pela edição salva
  const [toast, setToast] = useState(null);
  React.useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);
  const [fillDrawerOpen, setFillDrawerOpen] = useState(false);

  // Estado local editável da grade de jornada
  const [localWorkDays, setLocalWorkDays] = useState(workDays);

  // Sincroniza se os dados externos mudarem e não houver dirty
  React.useEffect(() => {
    if (!dirty) {
      setLocalWorkDays(workDays);
    }
  }, [workDays, dirty]);

  // Modal de Ajuste de Célula
  const [editingCell, setEditingCell] = useState(null); // { empId, day, cellData, empName }

  // Seleção múltipla de células ("empId:day") e histórico de desfazer
  const [selectedCells, setSelectedCells] = useState(() => new Set());
  const [undoStack, setUndoStack] = useState([]);
  const dragRef = React.useRef(null);
  const selectionAnchorRef = React.useRef(null);

  // Estados do Modal de Limpar / Resetar Escala
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [clearEmployeeId, setClearEmployeeId] = useState('ALL');
  const [clearMode, setClearMode] = useState('CLEAR_OFF'); // 'CLEAR_OFF' ou 'RESET_DEFAULT'
  const [clearing, setClearing] = useState(false);

  // Resumo do mês vem do backend (ledger): horas extras e débitos só mudam após salvar
  const summaryMap = useMemo(() => {
    const map = {};
    summaries.forEach((s) => { map[s.employee_id] = s; });
    return map;
  }, [summaries]);

  // Colaboradores trabalhando em cada dia, agrupados por horário (cobertura diária)
  const dailyShiftTotals = useMemo(() => {
    const rows = {}; // { "7–16": { counts: { day: n }, roles: { role: { day: n } } } }
    const totals = {};

    employees.forEach((emp) => {
      const empDays = localWorkDays[emp.id] || {};
      daysList.forEach((day) => {
        const dInfo = empDays[day] || {};
        if (dInfo.status !== 'TRABALHO') return;
        const code = compactRange(dInfo.start_time, dInfo.end_time) || 'Sem horário';
        const role = emp.role || 'Geral';
        if (!rows[code]) rows[code] = { name: code, counts: {}, roles: {}, start: dInfo.start_time || '99:99' };
        if (!rows[code].roles[role]) rows[code].roles[role] = {};
        rows[code].counts[day] = (rows[code].counts[day] || 0) + 1;
        rows[code].roles[role][day] = (rows[code].roles[role][day] || 0) + 1;
        totals[day] = (totals[day] || 0) + 1;
      });
    });

    const sortedRows = Object.entries(rows).sort(([, a], [, b]) => a.start.localeCompare(b.start));
    return { rows: sortedRows, totals };
  }, [employees, localWorkDays, daysList]);

  // ==============================================================================
  // --- [AÇÕES DE EDIÇÃO DE CÉLULA] ---
  // ==============================================================================

  const getCellData = (empId, day, source = localWorkDays) => source[empId]?.[day] || {
    day,
    status: sundays.includes(day) ? 'DSR' : (holidays[day] ? 'FERIADO' : 'FOLGA'),
    start_time: null,
    lunch_start: null,
    lunch_end: null,
    end_time: null,
    worked_minutes: 0
  };

  // Dia conforme o contrato: horários contratados ou o descanso do contrato
  const contractEntry = (current) => {
    const cd = current.contract_day;
    if (holidays[current.day]) {
      return { status: 'FERIADO', start_time: null, lunch_start: null, lunch_end: null, end_time: null, worked_minutes: 0 };
    }
    const times = contractTimes(cd);
    if (times) return { status: 'TRABALHO', ...times, worked_minutes: computeWorkedMinutes(times) };
    return { status: cd?.rest || current.status, start_time: null, lunch_start: null, lunch_end: null, end_time: null, worked_minutes: 0 };
  };

  const handleOpenCellEdit = (emp, day) => {
    setEditingCell({
      empId: emp.id,
      empName: emp.name,
      day,
      data: { ...getCellData(emp.id, day) }
    });
  };

  // Toda alteração local passa por aqui para registrar o histórico de desfazer
  const commitLocalChange = (updater) => {
    setUndoStack((stack) => [...stack.slice(-(UNDO_LIMIT - 1)), localWorkDays]);
    setLocalWorkDays(updater);
    setDirty(true);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack(undoStack.slice(0, -1));
    setLocalWorkDays(previous);
    if (undoStack.length === 1) setDirty(false);
  };

  const handleApplyCellEdit = () => {
    if (!editingCell) return;
    const { empId, day, data } = editingCell;

    commitLocalChange((prev) => ({
      ...prev,
      [empId]: {
        ...(prev[empId] || {}),
        [day]: {
          ...data,
          is_manual: true
        }
      }
    }));
    setEditingCell(null);
  };

  // ==============================================================================
  // --- [SELEÇÃO MÚLTIPLA E AÇÕES EM MASSA] ---
  // ==============================================================================

  const cellKey = (empId, day) => `${empId}:${day}`;

  const rectKeys = (from, to) => {
    const keys = [];
    const [e1, e2] = [Math.min(from.empIdx, to.empIdx), Math.max(from.empIdx, to.empIdx)];
    const [d1, d2] = [Math.min(from.dayIdx, to.dayIdx), Math.max(from.dayIdx, to.dayIdx)];
    for (let e = e1; e <= e2; e++) {
      for (let d = d1; d <= d2; d++) {
        keys.push(cellKey(employees[e].id, daysList[d]));
      }
    }
    return keys;
  };

  const handleCellMouseDown = (e, empIdx, dayIdx) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const pos = { empIdx, dayIdx };
    const key = cellKey(employees[empIdx].id, daysList[dayIdx]);
    const additive = e.ctrlKey || e.metaKey;

    if (e.shiftKey && selectionAnchorRef.current) {
      setSelectedCells(new Set(rectKeys(selectionAnchorRef.current, pos)));
      dragRef.current = null;
      return;
    }

    selectionAnchorRef.current = pos;
    if (additive) {
      const next = new Set(selectedCells);
      if (next.has(key)) next.delete(key); else next.add(key);
      setSelectedCells(next);
      dragRef.current = { anchor: pos, base: next, moved: false, additive: true };
      return;
    }
    dragRef.current = { anchor: pos, base: new Set(), moved: false, additive: false };
  };

  const handleCellMouseEnter = (empIdx, dayIdx) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.moved = true;
    const next = new Set(drag.base);
    rectKeys(drag.anchor, { empIdx, dayIdx }).forEach((k) => next.add(k));
    setSelectedCells(next);
  };

  const handleCellMouseUp = (emp, day) => {
    const drag = dragRef.current;
    dragRef.current = null;
    // Clique simples (sem arrastar e sem modificadores) mantém o ajuste fino pelo modal
    if (drag && !drag.moved && !drag.additive) {
      setSelectedCells(new Set());
      handleOpenCellEdit(emp, day);
    }
  };

  React.useEffect(() => {
    const endDrag = () => { dragRef.current = null; };
    window.addEventListener('mouseup', endDrag);
    return () => window.removeEventListener('mouseup', endDrag);
  }, []);

  // Aplica turno ou status a todas as células selecionadas
  const handleBulkApply = (action) => {
    if (selectedCells.size === 0) return;
    commitLocalChange((prev) => {
      const next = { ...prev };
      selectedCells.forEach((key) => {
        const [empIdStr, dayStr] = key.split(':');
        const empId = parseInt(empIdStr, 10);
        const day = parseInt(dayStr, 10);
        const current = getCellData(empId, day, prev);
        let entry;

        if (action.type === 'contract') {
          entry = { ...current, day, ...contractEntry({ ...current, day }) };
        } else {
          entry = {
            ...current,
            day,
            status: action.status,
            start_time: null,
            lunch_start: null,
            lunch_end: null,
            end_time: null,
            worked_minutes: 0
          };
        }

        next[empId] = { ...(next[empId] || {}), [day]: { ...entry, is_manual: true } };
      });
      return next;
    });
  };

  // Atalhos: Ctrl+Z desfaz, Esc limpa a seleção (ignorados com modal aberto ou em campos de texto)
  React.useEffect(() => {
    const onKeyDown = (e) => {
      if (editingCell || clearModalOpen) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      } else if (e.key === 'Escape') {
        setSelectedCells(new Set());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // Células com alteração local ainda não salva
  // DSR perdidos por falta injustificada na semana (mesma regra da folha: absence_dsr_mode)
  const lostDsr = useMemo(() => {
    const result = {}; // { empId: { day: [dias de falta] } }
    if (absenceDsrMode === 'NONE') return result;
    const weekKey = (day) => {
      // Semana de segunda a domingo: identifica pela data da segunda-feira
      const d = new Date(selectedYear, selectedMonth - 1, day);
      const offset = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - offset);
      return d.toISOString().slice(0, 10);
    };
    employees.forEach((emp) => {
      const empDays = localWorkDays[emp.id] || {};
      const statusOf = (day) => empDays[day]?.status || (sundays.includes(day) ? 'DSR' : (holidays[day] ? 'FERIADO' : 'TRABALHO'));
      const weeks = {};
      daysList.forEach((day) => {
        const wk = weekKey(day);
        if (!weeks[wk]) weeks[wk] = { absences: [], dsr: [] };
        const st = statusOf(day);
        if (st === 'FALTA') weeks[wk].absences.push(day);
        if (st === 'DSR') weeks[wk].dsr.push(day);
      });
      Object.values(weeks).forEach(({ absences, dsr }) => {
        if (absences.length === 0 || dsr.length === 0) return;
        let lost;
        if (absenceDsrMode === 'SCHEDULE') {
          lost = dsr;
        } else {
          const sunday = dsr.find((d) => sundays.includes(d));
          lost = [sunday ?? dsr[dsr.length - 1]];
        }
        lost.forEach((day) => {
          if (!result[emp.id]) result[emp.id] = {};
          result[emp.id][day] = absences;
        });
      });
    });
    return result;
  }, [employees, localWorkDays, daysList, sundays, holidays, absenceDsrMode, selectedYear, selectedMonth]);

  const changedCells = useMemo(() => {
    const changed = new Set();
    const fields = ['status', 'start_time', 'lunch_start', 'lunch_end', 'end_time', 'worked_minutes', 'notes', 'late_decision', 'is_late_record'];
    Object.entries(localWorkDays).forEach(([empId, days]) => {
      Object.entries(days || {}).forEach(([day, local]) => {
        const original = workDays[empId]?.[day];
        if (!original || fields.some((f) => (local?.[f] ?? null) !== (original?.[f] ?? null))) {
          changed.add(cellKey(empId, day));
        }
      });
    });
    return changed;
  }, [localWorkDays, workDays]);

  // Atualiza horários do modal recalculando as horas líquidas
  const updateEditingTimes = (patch) => {
    if (!editingCell) return;
    const data = { ...editingCell.data, ...patch };
    const worked = computeWorkedMinutes(data);
    setEditingCell({
      ...editingCell,
      data: { ...data, worked_minutes: worked, worked_hours_formatted: formatWorked(worked) }
    });
  };

  const editingNoLunch = Boolean(editingCell && !editingCell.data.lunch_start && !editingCell.data.lunch_end);

  // Desloca entrada ou saída (HH:MM) e recalcula as horas do dia
  const shiftEditingTime = (field, minutesDiff) => {
    if (!editingCell) return;
    const fallback = field === 'start_time' ? '07:00' : '16:00';
    const total = (toMinutes(editingCell.data[field] || fallback) + minutesDiff + 1440) % 1440;
    updateEditingTimes({ [field]: `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}` });
  };

  // ==============================================================================
  // --- [BANCO DE HORAS NO AJUSTE DO DIA] ---
  // ==============================================================================

  const [bankBase, setBankBase] = useState({}); // { empId: saldo sem o efeito da escala do mês }

  React.useEffect(() => {
    let cancelled = false;
    fetch(`${apiBase}/api/rh/payroll/bank-hours/balances?year=${selectedYear}&month=${selectedMonth}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => {
        if (!cancelled) {
          const map = {};
          Object.entries(data || {}).forEach(([empId, v]) => { map[empId] = v.base_minutes || 0; });
          setBankBase(map);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [apiBase, token, selectedYear, selectedMonth, workDays]);

  // Efeito de um dia no banco: horas a mais/a menos no trabalho ou a jornada inteira na folga BH
  // Feriado ou DSR do contrato: horas trabalhadas são horas 100%, fora do banco comum
  // (quitadas no mês na aba Banco de horas: folga de dia inteiro ou pagamento em dobro)
  const restKindOf = (day, contractDay) => (holidays[day] ? 'FERIADO' : contractDay?.rest === 'DSR' ? 'DSR' : null);

  const bankContribution = (data, expected, restKind) => {
    if (!data) return 0;
    if (data.status === 'TRABALHO') return restKind ? 0 : (data.worked_minutes ?? 480) - expected;
    if (data.status === 'FOLGA_BH') return -expected;
    return 0;
  };

  const editingBank = useMemo(() => {
    if (!editingCell) return null;
    const cd = editingCell.data.contract_day;
    const restKind = restKindOf(editingCell.day, cd);
    const expected = !restKind && cd && !cd.rest ? (cd.minutes || 0) : 0;
    const monthBalance = summaryMap[editingCell.empId]?.final_balance_minutes || 0;
    const original = getCellData(editingCell.empId, editingCell.day);
    const before = (bankBase[editingCell.empId] || 0) + monthBalance - bankContribution(original, expected, restKind);
    const after = before + bankContribution(editingCell.data, expected, restKind);
    const hours100 = restKind && editingCell.data.status === 'TRABALHO' ? (editingCell.data.worked_minutes || 0) : 0;
    return { expected, before, after, restKind, hours100 };
  }, [editingCell, summaryMap, bankBase, holidays]);

  // Mira (linha + coluna) ao passar o mouse, só com CSS (:has), sem re-renderizar a grade
  const crosshairCss = useMemo(() => {
    const tint = 'box-shadow: inset 0 0 0 9999px rgba(129, 140, 248, 0.09);';
    const rules = [`.jornada-grid tbody tr:hover > td { ${tint} }`];
    daysList.forEach((d) => {
      rules.push(`.jornada-grid:has(td[data-day="${d}"]:hover) td[data-day="${d}"] { ${tint} }`);
      rules.push(`.jornada-grid:has(td[data-day="${d}"]:hover) th[data-day="${d}"] > div { background-color: rgba(99, 102, 241, 0.35); color: #e0e7ff; }`);
    });
    // Célula do cruzamento por último (mesma especificidade, vence pela ordem)
    rules.push('.jornada-grid:has(td:hover) td[data-day]:hover { box-shadow: inset 0 0 0 1px rgba(129, 140, 248, 0.45), inset 0 0 0 9999px rgba(129, 140, 248, 0.09); }');
    return rules.join('\n');
  }, [daysList]);

  const fmtBank = (m) => `${m > 0 ? '+' : m < 0 ? '−' : ''}${Math.floor(Math.abs(m) / 60)}h${String(Math.abs(m) % 60).padStart(2, '0')}`;

  // ==============================================================================
  // --- [SALVAR ALTERAÇÕES EM LOTE] ---
  // ==============================================================================

  const handleSaveBatch = async () => {
    try {
      setSaving(true);
      setSaveMsg('');
      const entries = [];

      // Só os dias alterados: cada gravação entra no histórico de alterações da escala
      changedCells.forEach((key) => {
        const [empIdStr, dayStr] = key.split(':');
        const dVal = localWorkDays[empIdStr]?.[dayStr];
        if (!dVal) return;
        const original = workDays[empIdStr]?.[dayStr];
        const entry = {
          employee_id: parseInt(empIdStr, 10),
          day: parseInt(dayStr, 10),
          status: dVal.status,
          start_time: dVal.start_time,
          lunch_start: dVal.lunch_start,
          lunch_end: dVal.lunch_end,
          end_time: dVal.end_time,
          worked_minutes: dVal.worked_minutes,
          vt_tickets_override: dVal.vt_tickets_override,
          va_override: dVal.va_override,
          benefit_note: dVal.benefit_note,
          notes: dVal.notes,
          is_manual: Boolean(dVal.is_manual)
        };
        if ((dVal.late_decision ?? null) !== (original?.late_decision ?? null)) {
          entry.late_decision = dVal.late_decision ?? null;
        }
        if (Boolean(dVal.is_late_record) !== Boolean(original?.is_late_record)) {
          entry.is_late_record = Boolean(dVal.is_late_record);
        }
        entries.push(entry);
      });

      const res = await fetch(`${apiBase}/api/rh/schedules/work-days`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          schedule_id: scheduleId,
          entries
        })
      });

      if (!res.ok) throw new Error('Erro ao salvar jornada');
      const result = await res.json().catch(() => ({}));
      if (result.new_violations?.length) setToast(result.new_violations);
      setDirty(false);
      setUndoStack([]);
      setSaveMsg('Jornada salva com sucesso!');
      setTimeout(() => setSaveMsg(''), 4000);
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error(err);
      alert('Falha ao salvar jornada de trabalho: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ==============================================================================
  // --- [LIMPAR OU RESETAR ESCALA] ---
  // ==============================================================================

  const handleExecuteClear = async () => {
    try {
      setClearing(true);
      const payload = {
        schedule_id: scheduleId,
        employee_id: clearEmployeeId === 'ALL' ? null : parseInt(clearEmployeeId, 10),
        mode: clearMode,
        overwrite_manual: true
      };

      const res = await fetch(`${apiBase}/api/rh/schedules/clear`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(resData.detail || 'Erro ao limpar escala');
      }

      setClearModalOpen(false);
      setDirty(false);
      setUndoStack([]);
      setSaveMsg(resData.message || 'Escala atualizada com sucesso!');
      setTimeout(() => setSaveMsg(''), 4000);
      if (onRefresh) await onRefresh();
    } catch (err) {
      alert('Falha ao limpar escala: ' + err.message);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Barra de Ferramentas Principal da Jornada */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Clock className="text-indigo-400" size={18} />
            Grade de Jornada & Escala de Trabalho
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Horários reais dia a dia. Horas extras e débitos são apurados sobre a jornada do contrato de cada dia.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setFillDrawerOpen(!fillDrawerOpen)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 transition-colors"
          >
            <Sliders size={14} />
            {fillDrawerOpen ? 'Fechar Painel' : 'Preenchimento em Lote'}
          </button>

          <button
            onClick={() => setClearModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-rose-950/40 text-rose-300 border border-slate-700 hover:border-rose-800/50 transition-colors"
            title="Limpar ou restaurar a escala do mês"
          >
            <RotateCcw size={14} />
            Limpar Escala
          </button>

          <button
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Desfazer última alteração (Ctrl+Z)"
          >
            <Undo2 size={14} />
            Desfazer{undoStack.length > 0 ? ` (${undoStack.length})` : ''}
          </button>

          <button
            onClick={handleSaveBatch}
            disabled={saving || !dirty}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold shadow-sm transition-all ${
              dirty
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white animate-pulse'
                : 'bg-slate-800 text-slate-400 cursor-not-allowed'
            }`}
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Salvando...' : dirty ? 'Salvar Jornada *' : 'Jornada Salva'}
          </button>

          {saveMsg && (
            <span className="text-xs font-medium text-emerald-400 flex items-center gap-1">
              <CheckCircle2 size={14} /> {saveMsg}
            </span>
          )}
        </div>
      </div>

      {/* Gaveta Dobrável: Painel Unificado de Preenchimento e Ajuste em Lote */}
      {fillDrawerOpen && (
        <RHJornadaBatchPanel
          employees={employees}
          daysList={daysList}
          sundays={sundays}
          holidays={holidays}
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          scheduleId={scheduleId}
          workDays={localWorkDays}
          token={token}
          apiBase={apiBase}
          onClose={() => setFillDrawerOpen(false)}
          onViolationsToast={(violations) => setToast(violations)}
          onSuccess={async (message) => {
            setFillDrawerOpen(false);
            setDirty(false);
            setUndoStack([]);
            setSaveMsg(message);
            setTimeout(() => setSaveMsg(''), 6000);
            if (onRefresh) await onRefresh();
          }}
        />
      )}

      {/* Barra de Ações da Seleção Múltipla */}
      {selectedCells.size > 0 ? (
        <div className="sticky top-2 z-30 bg-slate-950/95 backdrop-blur border border-indigo-500/40 rounded-xl px-3 py-2.5 shadow-lg shadow-indigo-900/20 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <span className="font-bold text-indigo-300 bg-indigo-950/60 border border-indigo-800/60 px-2.5 py-0.5 rounded-full">
            {selectedCells.size} {selectedCells.size === 1 ? 'célula' : 'células'}
          </span>

          <button
            type="button"
            onClick={() => handleBulkApply({ type: 'contract' })}
            className="px-2 py-1 rounded-md border border-emerald-500/40 bg-emerald-600/10 text-emerald-300 hover:bg-emerald-600/25 font-semibold"
            title="Aplica o horário (ou descanso) do contrato de cada colaborador no dia"
          >
            Horário do contrato
          </button>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-slate-500 font-medium">Status:</span>
            {STATUS_OPTIONS.filter((st) => st.key !== 'TRABALHO').map((st) => (
              <button
                key={st.key}
                type="button"
                onClick={() => handleBulkApply({ type: 'status', status: st.key })}
                className={`px-2 py-1 rounded-md border font-semibold ${st.bg}`}
                title={st.label}
              >
                {st.short}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setSelectedCells(new Set())}
            className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800"
            title="Limpar seleção (Esc)"
          >
            <X size={13} /> Limpar seleção
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 px-1">
          <MousePointerSquareDashed size={13} />
          Clique para ajustar um dia. Arraste, use Shift+clique ou Ctrl+clique para selecionar vários e aplicar o horário do contrato ou um status de uma vez.
        </div>
      )}

      {/* Matriz Diária de Horas e Turnos */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        {/* Rolagem própria (vertical e horizontal) para o cabeçalho das datas ficar ancorado no topo */}
        <div className="overflow-auto max-h-[calc(100vh-11rem)]">
          <style>{crosshairCss}</style>
          <table className="jornada-grid w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-950/90 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                <th className="py-2.5 px-3 min-w-[170px] sticky left-0 top-0 bg-slate-950 z-30 border-r border-slate-800 shadow-[inset_0_-1px_0_#1e293b]">
                  Colaborador & Contrato
                </th>
                {daysList.map((day) => {
                  const isSunday = sundays.includes(day);
                  const isHoliday = !!holidays[day];
                  const weekdayLabel = WEEKDAY_SHORT[new Date(selectedYear, selectedMonth - 1, day).getDay()];
                  return (
                    <th
                      key={day}
                      data-day={day}
                      className="p-0 text-center min-w-[38px] border-r border-slate-800/60 sticky top-0 z-20 bg-slate-950 shadow-[inset_0_-1px_0_#1e293b]"
                      title={isHoliday ? `${holidays[day]} (${weekdayLabel})` : isSunday ? 'Domingo' : `Dia ${day} (${weekdayLabel})`}
                    >
                      {/* Fundo opaco no th (ancorado) e a cor do domingo/feriado por cima */}
                      <div className={`py-2 px-0.5 h-full ${
                        isSunday
                          ? 'bg-red-950/20 text-red-400 font-bold'
                          : isHoliday
                            ? 'bg-sky-950/30 text-sky-400 font-bold'
                            : 'text-slate-300'
                      }`}>
                        <div>{day}</div>
                        <div className="text-[9px] font-normal lowercase opacity-70">
                          {weekdayLabel}
                        </div>
                        {isHoliday && (
                          <div className="text-[8px] font-semibold uppercase leading-none">fer</div>
                        )}
                      </div>
                    </th>
                  );
                })}
                <th className="py-2.5 px-3 text-center min-w-[70px] bg-slate-950 border-l border-slate-800 sticky top-0 z-20 shadow-[inset_0_-1px_0_#1e293b]">
                  Trabalhado
                </th>
                <th className="py-2.5 px-3 text-center min-w-[70px] bg-slate-950 border-l border-slate-800 sticky top-0 z-20 shadow-[inset_0_-1px_0_#1e293b]">
                  Esperado
                </th>
                <th className="py-2.5 px-3 text-center min-w-[80px] bg-slate-950 border-l border-slate-800 sticky top-0 z-20 shadow-[inset_0_-1px_0_#1e293b]">
                  Saldo BH
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/60">
              {employees.map((emp, empIdx) => {
                const empDays = localWorkDays[emp.id] || {};
                const summary = summaryMap[emp.id] || {};

                return (
                  <tr key={emp.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-2 px-3 font-medium text-slate-200 sticky left-0 bg-slate-900 border-r border-slate-800 z-10">
                      <div className="truncate max-w-[150px] font-semibold text-white">{emp.name}</div>
                      <div className="text-[10px] text-slate-400 truncate">{emp.role || 'Geral'}</div>
                      {emp.contract ? (
                        <div className="text-[10px] text-indigo-400 truncate" title="Contrato de jornada vigente">{emp.contract.summary}</div>
                      ) : (
                        <div className="text-[10px] text-amber-400" title="Defina o contrato no cadastro do colaborador">Sem contrato de jornada</div>
                      )}
                    </td>

                    {daysList.map((day, dayIdx) => {
                      const dInfo = empDays[day] || {};
                      const lostDsrBy = lostDsr[emp.id]?.[day]; // dias de falta que causaram a perda deste DSR
                      const status = dInfo.status || (sundays.includes(day) ? 'DSR' : (holidays[day] ? 'FERIADO' : 'TRABALHO'));
                      const isSun = sundays.includes(day);
                      const isManual = dInfo.is_manual;
                      const workedMin = dInfo.worked_minutes || 0;
                      const workedH = (workedMin / 60).toFixed(workedMin % 60 === 0 ? 0 : 1);
                      const isChangedCell = changedCells.has(cellKey(emp.id, day));
                      // Selos: do ledger (backend) quando salvo; prévia sobre a jornada do contrato quando alterado
                      const ledger = !isChangedCell ? dInfo.ledger : null;
                      // Em feriado não há jornada a cumprir: todo o trabalho é hora 100%
                      const contractMin = !holidays[day] && dInfo.contract_day && !dInfo.contract_day.rest ? (dInfo.contract_day.minutes || 0) : 0;
                      const previewDiff = isChangedCell && status === 'TRABALHO' && dInfo.contract_day ? workedMin - contractMin : 0;
                      const extraMin = ledger ? ledger.extra_min : Math.max(0, previewDiff);
                      const shortMin = ledger ? ledger.short_min : Math.max(0, -previewDiff);
                      const extraKind = ledger?.extra_kind;
                      const compensatedMin = ledger?.compensated_min || 0;
                      const paidDouble = Boolean(ledger?.rest_worked_unpaid_double);
                      const latePending = Boolean(ledger?.late_pending_decision);
                      const tipParts = [];
                      if (extraMin) tipParts.push(`+${shortHours(extraMin)} de hora extra${extraKind === 'SEMANAL' ? ' (limite semanal)' : ''}`);
                      if (shortMin) tipParts.push(`−${shortHours(shortMin)} abaixo da jornada do contrato`);
                      if (compensatedMin) tipParts.push(`${shortHours(compensatedMin)} compensadas no período`);
                      if (ledger?.rest_swap_with) tipParts.push(`folga trocada com ${ledger.rest_swap_with.split('-').reverse().slice(0, 2).join('/')}`);
                      if (paidDouble) tipParts.push(ledger?.rest_decision === 'PAGAR'
                        ? 'repouso/feriado trabalhado: pago em dobro + DSR na folha do mês'
                        : 'repouso/feriado trabalhado sem folga compensatória: decidir na aba Banco de horas (folga de dia inteiro ou pagar em dobro)');
                      if (latePending) tipParts.push('atraso fora dos limites: aguarda decisão');
                      if (isChangedCell && previewDiff) tipParts.push('prévia: recalculado ao salvar');

                      let label = '';
                      let badgeStyle = 'bg-slate-800/40 text-slate-400 border-slate-700/50';

                      if (status === 'TRABALHO') {
                        label = compactRange(dInfo.start_time, dInfo.end_time) || `${workedH}h`;
                        badgeStyle = 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-600/30';
                      } else if (status === 'DSR') {
                        label = 'DSR';
                        badgeStyle = lostDsrBy
                          ? 'bg-red-950/60 text-red-300/70 border-red-500/60 line-through'
                          : 'bg-red-950/30 text-red-400 border-red-500/30';
                      } else if (status === 'FOLGA') {
                        label = '-';
                        badgeStyle = 'bg-slate-800/40 text-slate-500 border-slate-700/40';
                      } else if (status === 'FERIADO') {
                        label = 'FER';
                        badgeStyle = 'bg-sky-500/20 text-sky-300 border-sky-500/40';
                      } else if (status === 'FERIAS') {
                        label = 'FE';
                        badgeStyle = 'bg-purple-500/20 text-purple-300 border-purple-500/40';
                      } else if (status === 'FOLGA_BH') {
                        label = 'BH';
                        badgeStyle = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
                      } else if (status === 'FALTA') {
                        label = 'F';
                        badgeStyle = 'bg-rose-950/40 text-rose-300 border-rose-600/50 font-bold';
                      } else if (status === 'ATESTADO') {
                        label = 'AT';
                        badgeStyle = 'bg-cyan-600/20 text-cyan-300 border-cyan-500/40';
                      }

                      const isSelected = selectedCells.has(cellKey(emp.id, day));
                      const isChanged = isChangedCell;
                      const irregularCodes = complianceDays[emp.id]?.[day] || [];
                      if (irregularCodes.length) tipParts.push(`irregularidade na auditoria: ${irregularCodes.join(', ')}`);

                      return (
                        <td
                          key={day}
                          data-day={day}
                          onMouseDown={(e) => handleCellMouseDown(e, empIdx, dayIdx)}
                          onMouseEnter={() => handleCellMouseEnter(empIdx, dayIdx)}
                          onMouseUp={() => handleCellMouseUp(emp, day)}
                          className={`py-1 px-0.5 text-center cursor-pointer select-none transition-colors border-r border-slate-800/50 ${
                            isSelected ? 'bg-indigo-500/25' : isSun ? 'bg-red-950/10' : ''
                          }`}
                          title={`Dia ${day}: ${status}${lostDsrBy ? ` PERDIDO (falta no dia ${lostDsrBy.join(', ')}; remuneração do DSR descontada na folha)` : ''} (${workedH}h trabalhadas${tipParts.length ? `; ${tipParts.join('; ')}` : ''})${isChanged ? ' • alterado, não salvo' : ''}. Clique para ajustar; arraste ou use Shift/Ctrl+clique para selecionar vários.`}
                        >
                          <div
                            className={`min-w-[2.6rem] h-8 px-0.5 mx-auto rounded flex flex-col items-center justify-center font-bold text-[10px] leading-tight border transition-transform active:scale-95 relative ${badgeStyle} ${
                              isSelected
                                ? 'ring-2 ring-indigo-400'
                                : isManual ? 'border-dashed ring-1 ring-indigo-400/30' : ''
                            }`}
                          >
                            {isChanged && (
                              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400 ring-1 ring-slate-900" />
                            )}
                            {lostDsrBy && (
                              <span className="absolute inset-0 flex items-center justify-center text-red-500 text-base font-black leading-none pointer-events-none">
                                ✕
                              </span>
                            )}
                            {paidDouble && (
                              <span
                                className={`absolute -top-1.5 -left-1 px-0.5 rounded text-white text-[7px] leading-none py-0.5 ${
                                  ledger?.rest_decision === 'PAGAR' ? 'bg-red-600' : 'bg-slate-700 ring-1 ring-red-500'
                                }`}
                                title={ledger?.rest_decision === 'PAGAR' ? 'Pago em dobro' : 'Sem folga compensatória: decidir na aba Banco de horas'}
                              >
                                2x
                              </span>
                            )}
                            {irregularCodes.length > 0 && (
                              <span className="absolute -bottom-1 -left-1 w-2 h-2 rounded-full bg-rose-500 ring-1 ring-slate-900" />
                            )}
                            {latePending && (
                              <span className="absolute -bottom-1 -right-1 w-2 h-2 rounded-full bg-orange-400 ring-1 ring-slate-900" />
                            )}
                            <span className="whitespace-nowrap">{label}</span>
                            {extraMin > 0 ? (
                              <span className={`text-[8px] font-bold leading-none ${extraKind === 'SEMANAL' ? 'text-orange-300' : 'text-amber-300'} ${isChangedCell ? 'opacity-70' : ''}`}>
                                +{shortHours(extraMin)}
                              </span>
                            ) : shortMin > 0 ? (
                              <span className={`text-[8px] font-bold leading-none text-rose-300 ${isChangedCell ? 'opacity-70' : ''}`}>
                                −{shortHours(shortMin)}
                              </span>
                            ) : compensatedMin > 0 && status === 'TRABALHO' ? (
                              <span className="text-[8px] font-bold leading-none text-sky-300">⇄</span>
                            ) : null}
                          </div>
                        </td>
                      );
                    })}

                    <td className="py-2 px-2 text-center font-bold text-slate-200 border-l border-slate-800">
                      {summary.worked_hours_formatted || '0h00'}
                    </td>

                    <td className="py-2 px-2 text-center text-slate-400 border-l border-slate-800">
                      {summary.expected_hours_formatted || '0h00'}
                    </td>

                    <td className="py-2 px-3 text-center font-semibold border-l border-slate-800">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-bold border ${
                        (summary.final_balance_minutes || 0) > 0
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                          : (summary.final_balance_minutes || 0) < 0
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                            : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                      }`}>
                        {summary.bank_hours_balance_formatted || '0h00'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {employees.length > 0 && (
              <tfoot className="border-t-2 border-slate-700 bg-slate-950/70">
                {dailyShiftTotals.rows.map(([code, row]) => (
                  <React.Fragment key={code}>
                  <tr className="border-b border-slate-800/60">
                    <td className="py-1.5 px-3 sticky left-0 bg-slate-950 border-r border-slate-800 z-10">
                      <div className="text-[11px] font-semibold text-indigo-300 truncate max-w-[150px]">{code}</div>
                      {row.name !== code && (
                        <div className="text-[10px] text-slate-500 truncate max-w-[150px]">{row.name}</div>
                      )}
                    </td>
                    {daysList.map((day) => {
                      const n = row.counts[day] || 0;
                      return (
                        <td
                          key={day}
                          className={`py-1.5 px-0.5 text-center text-[11px] border-r border-slate-800/50 ${
                            sundays.includes(day) ? 'bg-red-950/10' : ''
                          } ${n > 0 ? 'font-bold text-slate-200' : 'text-slate-600'}`}
                          title={`Dia ${day}: ${n} colaborador(es) no horário ${code}`}
                        >
                          {n > 0 ? n : '·'}
                        </td>
                      );
                    })}
                    <td colSpan={3} className="border-l border-slate-800" />
                  </tr>
                  {Object.entries(row.roles)
                    .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
                    .map(([role, roleCounts]) => (
                      <tr key={`${code}-${role}`} className="border-b border-slate-800/30">
                        <td className="py-1 pl-6 pr-3 sticky left-0 bg-slate-950 border-r border-slate-800 z-10">
                          <div className="text-[10px] text-slate-400 truncate max-w-[140px]" title={role}>↳ {role}</div>
                        </td>
                        {daysList.map((day) => {
                          const n = roleCounts[day] || 0;
                          return (
                            <td
                              key={day}
                              className={`py-1 px-0.5 text-center text-[10px] border-r border-slate-800/50 ${
                                sundays.includes(day) ? 'bg-red-950/10' : ''
                              } ${n > 0 ? 'text-slate-400' : 'text-slate-700'}`}
                              title={`Dia ${day}: ${n} ${role} no horário ${code}`}
                            >
                              {n > 0 ? n : '·'}
                            </td>
                          );
                        })}
                        <td colSpan={3} className="border-l border-slate-800" />
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
                <tr>
                  <td className="py-2 px-3 sticky left-0 bg-slate-950 border-r border-slate-800 z-10 text-[11px] font-bold uppercase tracking-wider text-slate-300">
                    Total no dia
                  </td>
                  {daysList.map((day) => {
                    const n = dailyShiftTotals.totals[day] || 0;
                    return (
                      <td
                        key={day}
                        className={`py-2 px-0.5 text-center text-[11px] font-bold border-r border-slate-800/50 ${
                          sundays.includes(day) ? 'bg-red-950/10' : ''
                        } ${n > 0 ? 'text-emerald-300' : 'text-slate-600'}`}
                        title={`Dia ${day}: ${n} colaborador(es) trabalhando`}
                      >
                        {n}
                      </td>
                    );
                  })}
                  <td colSpan={3} className="border-l border-slate-800" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Aviso rápido de irregularidade (sem bloqueio; o detalhe fica na auditoria do mês) */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm bg-slate-900 border border-amber-500/50 rounded-xl shadow-2xl p-3.5 text-xs text-amber-100 animate-in fade-in duration-200">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 text-amber-400 mt-0.5" />
            <div className="flex-1 space-y-1">
              {toast.length === 1 ? (
                <div>
                  <span className="font-semibold">Irregularidade:</span> {toast[0].title.toLowerCase()}{' '}
                  ({toast[0].employee_name}, {toast[0].dates.map((d) => d.slice(8, 10) + '/' + d.slice(5, 7)).slice(0, 2).join(' e ')}).
                </div>
              ) : (
                <div><span className="font-semibold">{toast.length} irregularidades geradas.</span></div>
              )}
              {onOpenAudit && (
                <button
                  type="button"
                  onClick={() => { onOpenAudit(toast.length === 1 ? toast[0].fingerprint : null); setToast(null); }}
                  className="font-semibold text-amber-300 underline hover:text-amber-200"
                >
                  Ver na auditoria do mês
                </button>
              )}
            </div>
            <button type="button" onClick={() => setToast(null)} className="text-slate-400 hover:text-white">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Modal de Ajuste Fino da Célula de Jornada */}
      {editingCell && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-5 shadow-2xl text-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h4 className="font-bold text-white text-sm">
                  Ajuste de Jornada: Dia {editingCell.day}/{selectedMonth}
                </h4>
                <p className="text-xs text-indigo-300">{editingCell.empName}</p>
              </div>
              <button
                onClick={() => setEditingCell(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              {/* Status do Dia */}
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Status do Dia</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {STATUS_OPTIONS.map((st) => (
                    <button
                      key={st.key}
                      type="button"
                      onClick={() => setEditingCell({
                        ...editingCell,
                        data: {
                          ...editingCell.data,
                          ...(st.key === 'TRABALHO' && !editingCell.data.start_time
                            ? (contractTimes(editingCell.data.contract_day) || { start_time: '07:00', lunch_start: '12:00', lunch_end: '13:00', end_time: '16:00' })
                            : {}),
                          status: st.key,
                          worked_minutes: st.key === 'TRABALHO'
                            ? (editingCell.data.start_time
                              ? computeWorkedMinutes(editingCell.data)
                              : computeWorkedMinutes(contractTimes(editingCell.data.contract_day) || { start_time: '07:00', lunch_start: '12:00', lunch_end: '13:00', end_time: '16:00' }))
                            : 0
                        }
                      })}
                      className={`px-2.5 py-1.5 rounded-lg border text-left font-medium text-[11px] transition-colors ${
                        editingCell.data.status === st.key
                          ? 'border-indigo-500 bg-indigo-600/30 text-white font-bold'
                          : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-white'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Banco de horas do colaborador */}
              {editingBank && (
                <div className="bg-slate-950 border border-amber-500/20 rounded-lg p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-amber-300">Banco de Horas</span>
                    <span className="text-[11px] text-slate-400">
                      Disponível: <span className={`font-bold ${editingBank.before < 0 ? 'text-rose-300' : 'text-amber-300'}`}>{fmtBank(editingBank.before)}</span>
                      <span className="mx-1.5 text-slate-600">→</span>
                      Após este ajuste: <span className={`font-bold ${editingBank.after < 0 ? 'text-rose-300' : 'text-amber-300'}`}>{fmtBank(editingBank.after)}</span>
                    </span>
                  </div>
                  {editingBank.restKind && (
                    <p className="text-[10px] text-sky-200 bg-sky-950/30 border border-sky-500/30 rounded-lg px-2.5 py-1.5">
                      {editingBank.restKind === 'FERIADO' ? `Feriado (${holidays[editingCell.day]})` : 'DSR'}:
                      {editingBank.hours100
                        ? ` as ${fmtBank(editingBank.hours100).replace('+', '')} trabalhadas são horas 100% e não entram no banco comum.`
                        : ' horas trabalhadas neste dia são horas 100% e não entram no banco comum.'}
                      {' '}Quite neste mês na aba Banco de horas: folga de um dia inteiro em outro dia ou pagamento em dobro.
                    </p>
                  )}
                  {editingCell.data.status !== 'FOLGA_BH' && !editingBank.restKind && (
                    <button
                      type="button"
                      onClick={() => setEditingCell({
                        ...editingCell,
                        data: { ...editingCell.data, status: 'FOLGA_BH', worked_minutes: 0 }
                      })}
                      className={`w-full px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors ${
                        editingBank.before >= editingBank.expected
                          ? 'border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
                          : 'border-rose-600/40 bg-rose-950/30 text-rose-200 hover:bg-rose-950/50'
                      }`}
                    >
                      Folgar o dia usando o banco (−{fmtBank(editingBank.expected).replace('+', '')})
                      {editingBank.before < editingBank.expected && ' • saldo insuficiente, ficará negativo'}
                    </button>
                  )}
                  {editingBank.after < 0 && (
                    <p className="text-[10px] text-rose-300">
                      O saldo ficará negativo: o colaborador passará a dever horas, a compensar em dias futuros.
                    </p>
                  )}
                </div>
              )}

              {/* Se for TRABALHO, exibe seleção de turno e horários */}
              {editingCell.data.status === 'TRABALHO' && (
                <>
                  {/* Horário do contrato no dia (referência para hora extra) */}
                  <div className="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2">
                    <span className="text-[11px] text-slate-400">
                      Contrato no dia:{' '}
                      <span className="font-semibold text-slate-200">
                        {(() => {
                          const cd = editingCell.data.contract_day;
                          if (!cd) return 'sem contrato vigente';
                          if (cd.rest) return cd.rest === 'DSR' ? 'DSR (repouso)' : 'Folga';
                          return `${cd.start_time}–${cd.end_time}${cd.lunch_start ? ` (int. ${cd.lunch_start}–${cd.lunch_end})` : ''} • ${formatWorked(cd.minutes || 0)}`;
                        })()}
                      </span>
                    </span>
                    {contractTimes(editingCell.data.contract_day) && (
                      <button
                        type="button"
                        onClick={() => updateEditingTimes(contractTimes(editingCell.data.contract_day))}
                        className="text-[10px] font-semibold text-indigo-300 hover:text-indigo-200 whitespace-nowrap"
                      >
                        Voltar ao horário do contrato
                      </button>
                    )}
                  </div>

                  {/* Horários do Dia */}
                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Entrada 1</label>
                      <input
                        type="time"
                        value={editingCell.data.start_time || ''}
                        onChange={(e) => updateEditingTimes({ start_time: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-white text-center text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Início Almoço</label>
                      <input
                        type="time"
                        value={editingNoLunch ? '' : (editingCell.data.lunch_start || '12:00')}
                        disabled={editingNoLunch}
                        onChange={(e) => updateEditingTimes({ lunch_start: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-white text-center text-xs disabled:opacity-30 disabled:cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Fim Almoço</label>
                      <input
                        type="time"
                        value={editingNoLunch ? '' : (editingCell.data.lunch_end || '13:00')}
                        disabled={editingNoLunch}
                        onChange={(e) => updateEditingTimes({ lunch_end: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-white text-center text-xs disabled:opacity-30 disabled:cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Saída 2</label>
                      <input
                        type="time"
                        value={editingCell.data.end_time || ''}
                        onChange={(e) => updateEditingTimes({ end_time: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-white text-center text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <StyledCheckbox
                      checked={editingNoLunch}
                      onChange={(checked) => updateEditingTimes(
                        checked
                          ? { lunch_start: null, lunch_end: null }
                          : { lunch_start: '12:00', lunch_end: '13:00' }
                      )}
                      label="Sem intervalo de almoço"
                      description="Jornada corrida, sem pausa descontada"
                    />
                    <span className="text-[11px] text-slate-400 whitespace-nowrap">
                      Total: <span className="font-bold text-white">{formatWorked(editingCell.data.worked_minutes || 0)}</span>
                    </span>
                  </div>

                  {/* Ajustes rápidos: horas extras somam ao banco; saída mais cedo e chegada mais tarde consomem */}
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] text-slate-400 font-medium w-32">Hora extra (saída):</span>
                      {[30, 60, 120].map((m) => (
                        <button key={`he-${m}`} type="button" onClick={() => shiftEditingTime('end_time', m)}
                          className="px-2 py-1 rounded font-semibold text-[11px] border bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border-amber-500/40">
                          +{m < 60 ? `${m}m` : `${m / 60}h`}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] text-slate-400 font-medium w-32">Usar banco: sair mais cedo</span>
                      {[30, 60, 120].map((m) => (
                        <button key={`out-${m}`} type="button" onClick={() => shiftEditingTime('end_time', -m)}
                          className="px-2 py-1 rounded font-semibold text-[11px] border bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700">
                          −{m < 60 ? `${m}m` : `${m / 60}h`}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] text-slate-400 font-medium w-32">Chegar mais tarde</span>
                      {[30, 60, 120].map((m) => (
                        <button key={`in-${m}`} type="button" onClick={() => shiftEditingTime('start_time', m)}
                          className="px-2 py-1 rounded font-semibold text-[11px] border bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700">
                          +{m < 60 ? `${m}m` : `${m / 60}h`}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Horário remanejado (planejado) x atraso registrado como ponto */}
              {editingCell.data.status === 'TRABALHO' && contractTimes(editingCell.data.contract_day) && (
                <StyledCheckbox
                  checked={Boolean(editingCell.data.is_late_record)}
                  onChange={(checked) => setEditingCell({ ...editingCell, data: { ...editingCell.data, is_late_record: checked } })}
                  label="Registrar como atraso (ponto)"
                  description="Sem esta marca, a mudança de horário é um remanejamento e não conta como atraso"
                />
              )}

              {/* Atraso fora dos limites de compensação automática: decisão do empregador */}
              {editingCell.data.status === 'TRABALHO' && (editingCell.data.ledger?.late_min > 0 || editingCell.data.late_decision) && (
                <div className="bg-slate-950 border border-orange-500/30 rounded-lg p-2.5 space-y-1.5">
                  <div className="text-[11px] font-semibold text-orange-300">
                    Atraso de {editingCell.data.ledger?.late_min || 0} min
                    {editingCell.data.ledger?.late_compensated_min ? ` • ${editingCell.data.ledger.late_compensated_min} min compensados` : ''}
                    {editingCell.data.ledger?.late_pending_decision ? ' • fora dos limites, aguarda decisão' : ''}
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {LATE_DECISIONS.map((d) => (
                      <button
                        key={d.key}
                        type="button"
                        onClick={() => setEditingCell({
                          ...editingCell,
                          data: { ...editingCell.data, late_decision: editingCell.data.late_decision === d.key ? null : d.key }
                        })}
                        className={`px-2 py-1 rounded border text-[10px] font-semibold ${
                          editingCell.data.late_decision === d.key
                            ? 'border-orange-400 bg-orange-500/20 text-orange-200'
                            : 'border-slate-700 text-slate-400 hover:text-white'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Justificativa / Observação */}
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Observação / Justificativa</label>
                <input
                  type="text"
                  placeholder="Ex: Hora extra para fechamento de balanço"
                  value={editingCell.data.notes || ''}
                  onChange={(e) => setEditingCell({
                    ...editingCell,
                    data: { ...editingCell.data, notes: e.target.value }
                  })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setEditingCell(null)}
                className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleApplyCellEdit}
                className="px-4 py-1.5 rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow"
              >
                Confirmar Ajuste
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================================== */}
      {/* --- [BLOCO: MODAL DE LIMPAR / RESETAR ESCALA] --- */}
      {/* ============================================================================== */}
      {clearModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-start justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
                <RotateCcw size={18} />
                Limpar ou Resetar Escala
              </div>
              <button
                type="button"
                onClick={() => setClearModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Selecione o colaborador e o modo como deseja redefinir os dias do mês:
            </p>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Colaborador(es) Alvo</label>
                <SelectDropdown
                  value={clearEmployeeId}
                  onChange={(val) => setClearEmployeeId(val)}
                  placeholder="Selecione o colaborador"
                  options={[
                    { value: 'ALL', label: `Toda a Equipe (${employees.length})` },
                    ...employees.map((e) => ({
                      value: e.id,
                      label: e.name,
                      subtitle: e.role || 'Geral'
                    }))
                  ]}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1.5 font-medium">Modo de Operação</label>
                <div className="space-y-2">
                  <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                    clearMode === 'CLEAR_OFF'
                      ? 'bg-rose-950/30 border-rose-600/60 text-white shadow-sm'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}>
                    <input
                      type="radio"
                      name="clearMode"
                      value="CLEAR_OFF"
                      checked={clearMode === 'CLEAR_OFF'}
                      onChange={() => setClearMode('CLEAR_OFF')}
                      className="mt-0.5 text-rose-600 focus:ring-rose-500"
                    />
                    <div>
                      <span className="font-semibold text-rose-300 block">Zerar e Definir Folgas Semanais</span>
                      <span className="text-[11px] text-slate-400 block mt-0.5">
                        Remove os horários de trabalho e define os dias como descanso (não debita banco de horas).
                      </span>
                    </div>
                  </label>

                  <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                    clearMode === 'RESET_DEFAULT'
                      ? 'bg-indigo-950/30 border-indigo-600/60 text-white shadow-sm'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}>
                    <input
                      type="radio"
                      name="clearMode"
                      value="RESET_DEFAULT"
                      checked={clearMode === 'RESET_DEFAULT'}
                      onChange={() => setClearMode('RESET_DEFAULT')}
                      className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <span className="font-semibold text-indigo-300 block">Restaurar Contrato de Jornada</span>
                      <span className="text-[11px] text-slate-400 block mt-0.5">
                        Reaplica a semana-padrão do contrato vigente (horários, DSR, folgas e feriados).
                      </span>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setClearModalOpen(false)}
                className="px-3.5 py-2 rounded-lg text-slate-400 hover:text-white bg-slate-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExecuteClear}
                disabled={clearing}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-white shadow-md transition-all ${
                  clearMode === 'CLEAR_OFF'
                    ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/30'
                    : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/30'
                }`}
              >
                {clearing ? <RefreshCw size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                {clearing ? 'Processando...' : 'Confirmar e Aplicar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
