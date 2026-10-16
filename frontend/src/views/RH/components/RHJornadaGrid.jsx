import React, { useState, useMemo } from 'react';
import { 
  Clock, Plus, CheckCircle2, AlertTriangle, Calendar, Save, 
  RefreshCw, ChevronRight, Sliders, Sparkles, Filter, Info, X,
  RotateCcw, Trash2, Undo2, MousePointerSquareDashed
} from 'lucide-react';
import SelectDropdown from '../../../components/common/SelectDropdown';
import StyledCheckbox from '../../../components/common/StyledCheckbox';
import CalendarCheckboxDropdown from '../../../components/common/CalendarCheckboxDropdown';

const STATUS_OPTIONS = [
  { key: 'TRABALHO', label: 'Trabalho', short: 'TRAB', bg: 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-600/30' },
  { key: 'DSR', label: 'DSR (Domingo)', short: 'DSR', bg: 'bg-red-950/30 text-red-400 border-red-500/40 hover:bg-red-950/50' },
  { key: 'FOLGA', label: 'Folga Semanal', short: 'FOLGA', bg: 'bg-slate-800/40 text-slate-400 border-slate-700/50 hover:bg-slate-800/70' },
  { key: 'FERIADO', label: 'Feriado', short: 'FER', bg: 'bg-sky-500/20 text-sky-300 border-sky-500/40 hover:bg-sky-500/30' },
  { key: 'FERIAS', label: 'Férias', short: 'FE', bg: 'bg-purple-500/20 text-purple-300 border-purple-500/40 hover:bg-purple-500/30' },
  { key: 'FOLGA_BH', label: 'Folga Banco Horas', short: 'BH', bg: 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30' },
  { key: 'FALTA', label: 'Falta Injustificada', short: 'FALTA', bg: 'bg-rose-900/40 text-rose-300 border-rose-600/50 hover:bg-rose-900/60' },
  { key: 'ATESTADO', label: 'Atestado Médico', short: 'ATEST', bg: 'bg-cyan-600/20 text-cyan-300 border-cyan-500/40 hover:bg-cyan-600/30' }
];

const UNDO_LIMIT = 50;

const toMinutes = (t) => {
  if (!t) return null;
  const [h, m] = t.split(':').map((v) => parseInt(v, 10));
  return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
};

const spanMinutes = (from, to) => (to < from ? to + 1440 - from : to - from);

// Horas líquidas do dia; mesma regra de compute_raw_minutes no backend
const computeWorkedMinutes = ({ start_time, lunch_start, lunch_end, end_time }) => {
  const start = toMinutes(start_time);
  const end = toMinutes(end_time);
  if (start === null || end === null) return 0;
  const lStart = toMinutes(lunch_start);
  const lEnd = toMinutes(lunch_end);
  const lunch = lStart !== null && lEnd !== null ? spanMinutes(lStart, lEnd) : 0;
  return Math.max(0, spanMinutes(start, end) - lunch);
};

const formatWorked = (mins) => `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`;

const WEEKDAY_SHORT =['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

export default function RHJornadaGrid({
  employees = [],
  shifts = [],
  workDays = {}, // workDays[empId][day]
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
  onDirtyChange
}) {
  const [dirty, setDirty] = useState(false);

  // Informa a tela principal sobre edições pendentes (aviso ao trocar de aba/mês)
  React.useEffect(() => {
    if (onDirtyChange) onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  React.useEffect(() => () => { if (onDirtyChange) onDirtyChange(false); }, [onDirtyChange]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
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

  // Parâmetros do Painel de Preenchimento em Lote
  const [fillShiftId, setFillShiftId] = useState('');
  const [fillTargetEmployees, setFillTargetEmployees] = useState('ALL'); // 'ALL' ou empId
  const [fillDayFrom, setFillDayFrom] = useState(1);
  const [fillDayTo, setFillDayTo] = useState(daysList.length || 31);
  const [fillWeekdays, setFillWeekdays] = useState([0, 1, 2, 3, 4, 5]); // Seg a Sáb por padrão
  const [fillSelectedDays, setFillSelectedDays] = useState(daysList.length ? daysList : Array.from({ length: 31 }, (_, i) => i + 1));
  const [fillOverwriteManual, setFillOverwriteManual] = useState(false);
  const [fillClearUnselected, setFillClearUnselected] = useState(false);
  const [filling, setFilling] = useState(false);

  // Estados do Modal de Limpar / Resetar Escala
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [clearEmployeeId, setClearEmployeeId] = useState('ALL');
  const [clearMode, setClearMode] = useState('CLEAR_OFF'); // 'CLEAR_OFF' ou 'RESET_DEFAULT'
  const [clearing, setClearing] = useState(false);

  // Sincroniza fillSelectedDays caso daysList mude
  React.useEffect(() => {
    if (daysList.length > 0) {
      setFillSelectedDays(daysList);
    }
  }, [daysList]);

  // Mapeamentos
  const shiftMap = useMemo(() => {
    const map = {};
    shifts.forEach((s) => { map[s.id] = s; });
    return map;
  }, [shifts]);

  const summaryMap = useMemo(() => {
    const map = {};
    employees.forEach((emp) => {
      const serverSummary = summaries.find((s) => s.employee_id === emp.id) || {};
      const empDaysObj = localWorkDays[emp.id] || {};

      const contractHours = Number(emp.weekly_contract_hours) || 44.0;
      const workDaysPerWeek = Number(emp.work_days_per_week) || 6;
      const dailyExpectedMin = Math.round((contractHours / workDaysPerWeek) * 60);

      let totalWorkedMin = 0;
      let totalExpectedMin = 0;

      daysList.forEach((day) => {
        const dVal = empDaysObj[day];
        const status = dVal ? dVal.status : (sundays.includes(day) ? 'DSR' : (holidays[day] ? 'FERIADO' : 'TRABALHO'));
        const workedMin = dVal?.worked_minutes !== undefined && dVal?.worked_minutes !== null ? Number(dVal.worked_minutes) : (status === 'TRABALHO' ? 480 : 0);

        if (status === 'TRABALHO') {
          totalWorkedMin += workedMin;
          totalExpectedMin += dailyExpectedMin;
        } else if (status === 'FOLGA_BH' || status === 'FALTA') {
          totalExpectedMin += dailyExpectedMin;
        }
      });

      const balanceMin = totalWorkedMin - totalExpectedMin;

      const formatHours = (mins) => {
        const sign = mins < 0 ? '-' : '';
        const absM = Math.abs(mins);
        const h = Math.floor(absM / 60);
        const m = absM % 60;
        return `${sign}${h}h${String(m).padStart(2, '0')}`;
      };

      map[emp.id] = {
        ...serverSummary,
        total_worked_minutes: totalWorkedMin,
        total_expected_minutes: totalExpectedMin,
        final_balance_minutes: balanceMin,
        worked_hours_formatted: formatHours(totalWorkedMin),
        expected_hours_formatted: formatHours(totalExpectedMin),
        bank_hours_balance_formatted: formatHours(balanceMin)
      };
    });
    return map;
  }, [employees, summaries, localWorkDays, daysList, sundays, holidays]);

  // Totais de colaboradores por turno em cada dia (cobertura diária)
  const dailyShiftTotals = useMemo(() => {
    const rows = {}; // { code: { name, counts: { day: n } } }
    const totals = {};

    employees.forEach((emp) => {
      const empDays = localWorkDays[emp.id] || {};
      const defaultShift = shiftMap[emp.default_shift_id];

      daysList.forEach((day) => {
        const dInfo = empDays[day] || {};
        const status = dInfo.status || (sundays.includes(day) ? 'DSR' : (holidays[day] ? 'FERIADO' : 'TRABALHO'));
        if (status !== 'TRABALHO') return;

        const dayShift = shiftMap[dInfo.shift_id] || shifts.find((s) => s.code === dInfo.shift) || (dInfo.shift ? null : defaultShift);
        const code = dayShift?.code || dInfo.shift || 'Sem turno';
        const role = emp.role || 'Geral';
        if (!rows[code]) rows[code] = { name: dayShift?.name || code, counts: {}, roles: {} };
        if (!rows[code].roles[role]) rows[code].roles[role] = {};
        rows[code].counts[day] = (rows[code].counts[day] || 0) + 1;
        rows[code].roles[role][day] = (rows[code].roles[role][day] || 0) + 1;
        totals[day] = (totals[day] || 0) + 1;
      });
    });

    // Mantém a ordem de cadastro dos turnos; turnos avulsos ao final
    const order = shifts.map((s) => s.code);
    const sortedRows = Object.entries(rows).sort(([a], [b]) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
    });

    return { rows: sortedRows, totals };
  }, [employees, localWorkDays, daysList, sundays, holidays, shifts, shiftMap]);

  // ==============================================================================
  // --- [AÇÕES DE EDIÇÃO DE CÉLULA] ---
  // ==============================================================================

  const getCellData = (empId, day, source = localWorkDays) => source[empId]?.[day] || {
    day,
    status: sundays.includes(day) ? 'DSR' : (holidays[day] ? 'FERIADO' : 'TRABALHO'),
    start_time: '08:00',
    lunch_start: '12:00',
    lunch_end: '13:00',
    end_time: '17:00',
    worked_minutes: 480
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
    const empById = {};
    employees.forEach((emp) => { empById[emp.id] = emp; });

    commitLocalChange((prev) => {
      const next = { ...prev };
      selectedCells.forEach((key) => {
        const [empIdStr, dayStr] = key.split(':');
        const empId = parseInt(empIdStr, 10);
        const day = parseInt(dayStr, 10);
        const current = getCellData(empId, day, prev);
        let entry;

        if (action.type === 'shift') {
          const shiftObj = action.shiftId === 'DEFAULT'
            ? shiftMap[empById[empId]?.default_shift_id]
            : shiftMap[action.shiftId];
          entry = {
            ...current,
            day,
            status: 'TRABALHO',
            shift_id: shiftObj?.id || null,
            shift: shiftObj?.code || null,
            start_time: shiftObj?.start_time || '08:00',
            lunch_start: shiftObj ? (shiftObj.lunch_start || null) : '12:00',
            lunch_end: shiftObj ? (shiftObj.lunch_end || null) : '13:00',
            end_time: shiftObj?.end_time || '17:00',
            worked_minutes: shiftObj ? Math.round(shiftObj.net_hours * 60) : 480
          };
        } else {
          entry = {
            ...current,
            day,
            status: action.status,
            shift_id: null,
            shift: null,
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
  const changedCells = useMemo(() => {
    const changed = new Set();
    const fields = ['status', 'shift_id', 'start_time', 'lunch_start', 'lunch_end', 'end_time', 'worked_minutes', 'notes'];
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

  const handleQuickHourShift = (minutesDiff) => {
    if (!editingCell) return;
    const curEnd = editingCell.data.end_time || '17:00';
    const parts = curEnd.split(':');
    let totalMins = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10) + minutesDiff;
    if (totalMins < 0) totalMins += 1440;
    if (totalMins >= 1440) totalMins -= 1440;

    const newH = String(Math.floor(totalMins / 60)).padStart(2, '0');
    const newM = String(totalMins % 60).padStart(2, '0');
    const newEndTime = `${newH}:${newM}`;

    // Recalcula minutos
    const newWorked = Math.max(0, (editingCell.data.worked_minutes || 480) + minutesDiff);

    setEditingCell({
      ...editingCell,
      data: {
        ...editingCell.data,
        end_time: newEndTime,
        worked_minutes: newWorked,
        worked_hours_formatted: `${Math.floor(newWorked / 60)}h${String(newWorked % 60).padStart(2, '0')}`
      }
    });
  };

  // ==============================================================================
  // --- [SALVAR ALTERAÇÕES EM LOTE] ---
  // ==============================================================================

  const handleSaveBatch = async () => {
    try {
      setSaving(true);
      setSaveMsg('');
      const entries = [];

      Object.entries(localWorkDays).forEach(([empIdStr, daysObj]) => {
        const empId = parseInt(empIdStr, 10);
        Object.entries(daysObj).forEach(([dayStr, dVal]) => {
          entries.push({
            employee_id: empId,
            day: parseInt(dayStr, 10),
            status: dVal.status,
            shift_id: dVal.shift_id,
            shift: dVal.shift,
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
          });
        });
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
  // --- [PREENCHIMENTO INTELIGENTE EM LOTE] ---
  // ==============================================================================

  const handleExecuteFill = async () => {
    try {
      setFilling(true);
      const hasSpecificDays = fillSelectedDays && fillSelectedDays.length > 0;
      const payload = {
        schedule_id: scheduleId,
        employee_ids: fillTargetEmployees === 'ALL' ? null : [parseInt(fillTargetEmployees, 10)],
        shift_id: fillShiftId ? parseInt(fillShiftId, 10) : null,
        status: 'TRABALHO',
        day_from: parseInt(fillDayFrom, 10) || 1,
        day_to: parseInt(fillDayTo, 10) || daysList.length,
        weekdays: hasSpecificDays ? null : fillWeekdays,
        selected_days: fillSelectedDays,
        overwrite_manual: fillOverwriteManual,
        clear_unselected: fillClearUnselected
      };

      const res = await fetch(`${apiBase}/api/rh/schedules/fill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(resData.detail || 'Erro ao preencher escala');
      }

      if (resData.skipped_manual_count > 0 && resData.updated_count === 0) {
        alert(
          `Nenhuma alteração foi realizada porque ${resData.skipped_manual_count} dia(s) já possuem edições manuais registradas.\n\nPara forçar a aplicação neste período, marque a opção "Sobrescrever edições manuais".`
        );
      } else {
        setFillDrawerOpen(false);
        setSaveMsg(resData.message || 'Turnos aplicados com sucesso!');
        setTimeout(() => setSaveMsg(''), 6000);
      }

      setDirty(false);
      setUndoStack([]);
      if (onRefresh) await onRefresh();
    } catch (err) {
      alert('Falha ao aplicar turno em lote: ' + err.message);
    } finally {
      setFilling(false);
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
            Fonte única da verdade: horários e turnos reais dia a dia geram automaticamente o VT, VA e o Banco de Horas.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setFillDrawerOpen(!fillDrawerOpen)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 transition-colors"
          >
            <Sliders size={14} />
            {fillDrawerOpen ? 'Fechar Painel de Turnos' : 'Aplicar Turnos em Lote'}
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

      {/* Gaveta Dobrável: Painel de Aplicação de Turnos com Escopo */}
      {fillDrawerOpen && (
        <div className="bg-slate-950 border border-indigo-500/30 rounded-xl p-4 space-y-4 shadow-lg animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2 text-xs font-bold text-indigo-300">
              <Sparkles size={16} />
              Preenchimento Automatizado de Escala & Turnos
            </div>
            <button
              onClick={() => setFillDrawerOpen(false)}
              className="text-slate-400 hover:text-white p-1 rounded"
            >
              <X size={15} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Turno a Aplicar</label>
              <SelectDropdown
                value={fillShiftId}
                onChange={(val) => setFillShiftId(val)}
                placeholder="Turno Contratual do Colaborador"
                options={[
                  { value: '', label: 'Turno Contratual do Colaborador' },
                  ...shifts.map((s) => ({
                    value: s.id,
                    label: `${s.code}: ${s.name}`,
                    subtitle: `${s.net_hours}h líquidas`
                  }))
                ]}
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Colaborador(es)</label>
              <SelectDropdown
                value={fillTargetEmployees}
                onChange={(val) => setFillTargetEmployees(val)}
                searchable={employees.length > 5}
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
              <label className="block text-slate-400 mb-1">Datas para Aplicação</label>
              <CalendarCheckboxDropdown
                year={selectedYear}
                month={selectedMonth}
                selectedDays={fillSelectedDays}
                onChange={(days) => setFillSelectedDays(days)}
                sundays={sundays}
                holidays={holidays}
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Opções de Aplicação</label>
              <div className="mt-2 space-y-2">
                <StyledCheckbox
                  checked={fillOverwriteManual}
                  onChange={(checked) => setFillOverwriteManual(checked)}
                  label="Sobrescrever edições manuais"
                  description="Aplica novo turno mesmo em dias editados"
                />
                <StyledCheckbox
                  checked={fillClearUnselected}
                  onChange={(checked) => setFillClearUnselected(checked)}
                  label="Substituir escala inteira"
                  description="Define dias não selecionados como folga semanal (sem debitar BH)"
                />
              </div>
            </div>
          </div>

          {/* Barra de Ações Inferior */}
          <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-slate-800/60 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Total a preencher:</span>
              <span className="font-bold text-indigo-300 bg-indigo-950/60 border border-indigo-800/60 px-2.5 py-0.5 rounded-full">
                {fillSelectedDays.length} {fillSelectedDays.length === 1 ? 'dia' : 'dias'}
              </span>
            </div>

            <button
              onClick={handleExecuteFill}
              disabled={filling || fillSelectedDays.length === 0}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {filling ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {filling ? 'Aplicando...' : 'Aplicar na Escala'}
            </button>
          </div>
        </div>
      )}

      {/* Barra de Ações da Seleção Múltipla */}
      {selectedCells.size > 0 ? (
        <div className="sticky top-2 z-30 bg-slate-950/95 backdrop-blur border border-indigo-500/40 rounded-xl px-3 py-2.5 shadow-lg shadow-indigo-900/20 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <span className="font-bold text-indigo-300 bg-indigo-950/60 border border-indigo-800/60 px-2.5 py-0.5 rounded-full">
            {selectedCells.size} {selectedCells.size === 1 ? 'célula' : 'células'}
          </span>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-slate-500 font-medium">Turno:</span>
            <button
              type="button"
              onClick={() => handleBulkApply({ type: 'shift', shiftId: 'DEFAULT' })}
              className="px-2 py-1 rounded-md border border-emerald-500/40 bg-emerald-600/10 text-emerald-300 hover:bg-emerald-600/25 font-semibold"
              title="Aplica o turno contratual de cada colaborador"
            >
              Contratual
            </button>
            {shifts.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleBulkApply({ type: 'shift', shiftId: s.id })}
                className="px-2 py-1 rounded-md border border-emerald-500/40 bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/35 font-bold"
                title={`${s.name} (${s.net_hours}h)`}
              >
                {s.code}
              </button>
            ))}
          </div>

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
          Clique para ajustar um dia. Arraste, use Shift+clique ou Ctrl+clique para selecionar vários e aplicar turno ou status de uma vez.
        </div>
      )}

      {/* Matriz Diária de Horas e Turnos */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-950/90 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                <th className="py-2.5 px-3 min-w-[170px] sticky left-0 bg-slate-950 z-10 border-r border-slate-800">
                  Colaborador & Turno
                </th>
                {daysList.map((day) => {
                  const isSunday = sundays.includes(day);
                  const isHoliday = !!holidays[day];
                  const weekdayLabel = WEEKDAY_SHORT[new Date(selectedYear, selectedMonth - 1, day).getDay()];
                  return (
                    <th
                      key={day}
                      className={`py-2 px-0.5 text-center min-w-[38px] border-r border-slate-800/60 ${
                        isSunday
                          ? 'bg-red-950/20 text-red-400 font-bold'
                          : isHoliday
                            ? 'bg-sky-950/30 text-sky-400 font-bold'
                            : 'text-slate-300'
                      }`}
                      title={isHoliday ? `${holidays[day]} (${weekdayLabel})` : isSunday ? 'Domingo' : `Dia ${day} (${weekdayLabel})`}
                    >
                      <div>{day}</div>
                      <div className="text-[9px] font-normal lowercase opacity-70">
                        {weekdayLabel}
                      </div>
                      {isHoliday && (
                        <div className="text-[8px] font-semibold uppercase leading-none">fer</div>
                      )}
                    </th>
                  );
                })}
                <th className="py-2.5 px-3 text-center min-w-[70px] bg-slate-950 border-l border-slate-800">
                  Trabalhado
                </th>
                <th className="py-2.5 px-3 text-center min-w-[70px] bg-slate-950 border-l border-slate-800">
                  Esperado
                </th>
                <th className="py-2.5 px-3 text-center min-w-[80px] bg-slate-950 border-l border-slate-800">
                  Saldo BH
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/60">
              {employees.map((emp, empIdx) => {
                const empDays = localWorkDays[emp.id] || {};
                const summary = summaryMap[emp.id] || {};
                const shift = shiftMap[emp.default_shift_id];

                return (
                  <tr key={emp.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-2 px-3 font-medium text-slate-200 sticky left-0 bg-slate-900 border-r border-slate-800 z-10">
                      <div className="truncate max-w-[150px] font-semibold text-white">{emp.name}</div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {emp.role || 'Geral'} • {emp.weekly_contract_hours}h/sem ({emp.work_days_per_week || 6}d)
                      </div>
                      <div className="text-[10px] text-indigo-400">
                        Turno: {shift?.code || 'Padrão (8h)'}
                      </div>
                    </td>

                    {daysList.map((day, dayIdx) => {
                      const dInfo = empDays[day] || {};
                      const status = dInfo.status || (sundays.includes(day) ? 'DSR' : (holidays[day] ? 'FERIADO' : 'TRABALHO'));
                      const isSun = sundays.includes(day);
                      const isManual = dInfo.is_manual;
                      const workedMin = dInfo.worked_minutes || 0;
                      const workedH = (workedMin / 60).toFixed(workedMin % 60 === 0 ? 0 : 1);

                      let label = '';
                      let badgeStyle = 'bg-slate-800/40 text-slate-400 border-slate-700/50';

                      if (status === 'TRABALHO') {
                        label = `${dInfo.shift || '8h'}`;
                        badgeStyle = 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-600/30';
                      } else if (status === 'DSR') {
                        label = 'DSR';
                        badgeStyle = 'bg-red-950/30 text-red-400 border-red-500/30';
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
                      const isChanged = changedCells.has(cellKey(emp.id, day));

                      return (
                        <td
                          key={day}
                          onMouseDown={(e) => handleCellMouseDown(e, empIdx, dayIdx)}
                          onMouseEnter={() => handleCellMouseEnter(empIdx, dayIdx)}
                          onMouseUp={() => handleCellMouseUp(emp, day)}
                          className={`py-1 px-0.5 text-center cursor-pointer select-none transition-colors border-r border-slate-800/50 ${
                            isSelected ? 'bg-indigo-500/25' : isSun ? 'bg-red-950/10' : ''
                          }`}
                          title={`Dia ${day}: ${status} (${workedH}h)${isChanged ? ' • alterado, não salvo' : ''}. Clique para ajustar; arraste ou use Shift/Ctrl+clique para selecionar vários.`}
                        >
                          <div
                            className={`w-7 h-7 mx-auto rounded flex flex-col items-center justify-center font-bold text-[10px] border transition-transform active:scale-95 relative ${badgeStyle} ${
                              isSelected
                                ? 'ring-2 ring-indigo-400'
                                : isManual ? 'border-dashed ring-1 ring-indigo-400/30' : ''
                            }`}
                          >
                            {isChanged && (
                              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400 ring-1 ring-slate-900" />
                            )}
                            <span>{label}</span>
                            {status === 'TRABALHO' && workedMin !== 480 && (
                              <span className="text-[8px] font-semibold opacity-90 -mt-1 leading-none">
                                {workedH}h
                              </span>
                            )}
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
                          title={`Dia ${day}: ${n} colaborador(es) no turno ${code}`}
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
                              title={`Dia ${day}: ${n} ${role} no turno ${code}`}
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
                            ? { start_time: '08:00', lunch_start: '12:00', lunch_end: '13:00', end_time: '17:00' }
                            : {}),
                          status: st.key,
                          worked_minutes: st.key === 'TRABALHO' ? (editingCell.data.worked_minutes || 480) : 0
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

              {/* Se for TRABALHO, exibe seleção de turno e horários */}
              {editingCell.data.status === 'TRABALHO' && (
                <>
                  <div>
                    <label className="block text-slate-400 mb-1 font-medium">Turno Base</label>
                    <SelectDropdown
                      value={editingCell.data.shift_id || ''}
                      onChange={(val) => {
                        const sId = val ? parseInt(val, 10) : null;
                        const sObj = shiftMap[sId];
                        setEditingCell({
                          ...editingCell,
                          data: {
                            ...editingCell.data,
                            shift_id: sId,
                            shift: sObj?.code || null,
                            start_time: sObj?.start_time || editingCell.data.start_time || '08:00',
                            lunch_start: sObj ? (sObj.lunch_start || null) : '12:00',
                            lunch_end: sObj ? (sObj.lunch_end || null) : '13:00',
                            end_time: sObj?.end_time || '17:00',
                            worked_minutes: sObj ? Math.round(sObj.net_hours * 60) : 480
                          }
                        });
                      }}
                      placeholder="Personalizado / Sem turno fixo"
                      options={[
                        { value: '', label: 'Personalizado / Sem turno fixo' },
                        ...shifts.map((s) => ({
                          value: s.id,
                          label: `${s.code}: ${s.name}`,
                          subtitle: `${s.net_hours}h`
                        }))
                      ]}
                    />
                  </div>

                  {/* Horários do Dia */}
                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Entrada 1</label>
                      <input
                        type="time"
                        value={editingCell.data.start_time || '08:00'}
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
                        value={editingCell.data.end_time || '17:00'}
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

                  {/* Botões de Ajuste Rápido de Horas */}
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
                    <span className="block text-[10px] text-slate-400 mb-1.5 font-medium">Ajuste rápido de sobrejornada:</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => handleQuickHourShift(-60)}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs border border-slate-700"
                      >
                        -1h
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickHourShift(-30)}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs border border-slate-700"
                      >
                        -30m
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickHourShift(30)}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-indigo-300 font-semibold text-xs border border-slate-700"
                      >
                        +30m
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickHourShift(60)}
                        className="px-2 py-1 rounded bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 font-semibold text-xs border border-indigo-500/50"
                      >
                        +1 hora
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickHourShift(120)}
                        className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/40 text-amber-300 font-semibold text-xs border border-amber-500/40"
                      >
                        +2 horas
                      </button>
                    </div>
                  </div>
                </>
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
                        Remove turnos de trabalho e define dias como folga neutra (não debita banco de horas).
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
                      <span className="font-semibold text-indigo-300 block">Restaurar Turno Contratual</span>
                      <span className="text-[11px] text-slate-400 block mt-0.5">
                        Reaplica os horários e turnos contratuais padrão em dias úteis e DSR aos domingos.
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
