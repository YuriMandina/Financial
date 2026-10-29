import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Sparkles, Sliders, Users, Calendar, Clock, Check, ChevronDown,
  Search, X, RefreshCw, FileText, AlertCircle
} from 'lucide-react';
import StyledCheckbox from '../../../components/common/StyledCheckbox';
import CalendarCheckboxDropdown from '../../../components/common/CalendarCheckboxDropdown';

// ==============================================================================
// --- [BLOCO: CONSTANTES E UTILITÁRIOS DE HORÁRIO] ---
// ==============================================================================

export const STATUS_OPTIONS = [
  { key: 'TRABALHO', label: 'Trabalho', short: 'TRAB', bg: 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-600/30' },
  { key: 'DSR', label: 'DSR (Domingo)', short: 'DSR', bg: 'bg-red-950/30 text-red-400 border-red-500/40 hover:bg-red-950/50' },
  { key: 'FOLGA', label: 'Folga Semanal', short: 'FOLGA', bg: 'bg-slate-800/40 text-slate-400 border-slate-700/50 hover:bg-slate-800/70' },
  { key: 'FERIADO', label: 'Feriado', short: 'FER', bg: 'bg-sky-500/20 text-sky-300 border-sky-500/40 hover:bg-sky-500/30' },
  { key: 'FERIAS', label: 'Férias', short: 'FE', bg: 'bg-purple-500/20 text-purple-300 border-purple-500/40 hover:bg-purple-500/30' },
  { key: 'FOLGA_BH', label: 'Folga Banco Horas', short: 'BH', bg: 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30' },
  { key: 'FALTA', label: 'Falta Injustificada', short: 'FALTA', bg: 'bg-rose-900/40 text-rose-300 border-rose-600/50 hover:bg-rose-900/60' },
  { key: 'ATESTADO', label: 'Atestado Médico', short: 'ATEST', bg: 'bg-cyan-600/20 text-cyan-300 border-cyan-500/40 hover:bg-cyan-600/30' }
];

export const toMinutes = (t) => {
  if (!t) return null;
  const [h, m] = t.split(':').map((v) => parseInt(v, 10));
  return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
};

export const spanMinutes = (from, to) => (to < from ? to + 1440 - from : to - from);

export const computeWorkedMinutes = ({ start_time, lunch_start, lunch_end, end_time }) => {
  const start = toMinutes(start_time);
  const end = toMinutes(end_time);
  if (start === null || end === null) return 0;
  const lStart = toMinutes(lunch_start);
  const lEnd = toMinutes(lunch_end);
  const lunch = lStart !== null && lEnd !== null ? spanMinutes(lStart, lEnd) : 0;
  return Math.max(0, spanMinutes(start, end) - lunch);
};

export const formatWorked = (mins) => `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`;

export const shiftClockTime = (timeStr, minutesDiff, fallback = '07:00') => {
  const base = toMinutes(timeStr || fallback) ?? toMinutes(fallback);
  const total = (base + minutesDiff + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

export const contractTimes = (cd) => (cd && !cd.rest && cd.start_time
  ? { start_time: cd.start_time, lunch_start: cd.lunch_start || null, lunch_end: cd.lunch_end || null, end_time: cd.end_time }
  : null);

// ==============================================================================
// --- [BLOCO: SELETOR MULTI-COLABORADOR COM BUSCA E FILTRO POR CARGO] ---
// ==============================================================================

function MultiEmployeeDropdown({ employees = [], selectedIds = [], onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const allIds = useMemo(() => employees.map((e) => e.id), [employees]);
  const isAllSelected = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id));

  // Agrupamento de cargos únicos para seleção rápida por função
  const roles = useMemo(() => {
    const set = new Set();
    employees.forEach((e) => set.add(e.role || 'Geral'));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    if (!searchTerm.trim()) return employees;
    const term = searchTerm.toLowerCase().trim();
    return employees.filter(
      (e) =>
        (e.name && e.name.toLowerCase().includes(term)) ||
        (e.role && e.role.toLowerCase().includes(term))
    );
  }, [employees, searchTerm]);

  const displayText = useMemo(() => {
    if (selectedIds.length === 0) return 'Selecione os colaboradores...';
    if (isAllSelected) return `Toda a Equipe (${employees.length})`;
    if (selectedIds.length === 1) {
      const emp = employees.find((e) => e.id === selectedIds[0]);
      return emp ? emp.name : '1 colaborador selecionado';
    }
    return `${selectedIds.length} colaboradores selecionados`;
  }, [selectedIds, isAllSelected, employees]);

  const handleToggleEmployee = (id) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((item) => item !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const handleSelectAll = () => {
    if (isAllSelected) {
      onChange([]);
    } else {
      onChange(allIds);
    }
  };

  const handleToggleRole = (roleName) => {
    const roleEmpIds = employees.filter((e) => (e.role || 'Geral') === roleName).map((e) => e.id);
    const allRoleSelected = roleEmpIds.every((id) => selectedIds.includes(id));
    if (allRoleSelected) {
      onChange(selectedIds.filter((id) => !roleEmpIds.includes(id)));
    } else {
      const merged = new Set([...selectedIds, ...roleEmpIds]);
      onChange(Array.from(merged));
    }
  };

  return (
    <div className="relative inline-block w-full" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs min-h-[36px] rounded-lg border transition-all text-left select-none font-medium ${
          isOpen
            ? 'bg-slate-900 border-indigo-500 text-white ring-2 ring-indigo-500/20 shadow-md'
            : 'bg-slate-900 border-slate-700/80 text-slate-200 hover:border-slate-600 hover:bg-slate-850'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1 truncate">
          <Users size={15} className="text-indigo-400 shrink-0" />
          <span className="truncate">{displayText}</span>
          {selectedIds.length > 0 && !isAllSelected && (
            <span className="text-[10px] bg-indigo-950 text-indigo-300 border border-indigo-800/80 px-1.5 py-0.2 rounded-full font-bold shrink-0">
              {selectedIds.length}
            </span>
          )}
        </div>
        <ChevronDown
          size={15}
          className={`shrink-0 text-slate-400 transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-indigo-400' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 z-50 mt-1 w-full min-w-[290px] sm:min-w-[340px] rounded-xl bg-slate-900 border border-slate-700/80 shadow-2xl backdrop-blur-md p-3 space-y-2.5 animate-in fade-in zoom-in-95 duration-150">
          {/* Busca e botão Todos/Limpar */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar colaborador ou cargo..."
                className="w-full bg-slate-950 border border-slate-700/80 rounded-md pl-7 pr-7 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={handleSelectAll}
              className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-semibold whitespace-nowrap transition-colors"
            >
              {isAllSelected ? 'Desmarcar' : 'Todos'}
            </button>
          </div>

          {/* Atalhos rápidos por Cargo/Função */}
          {roles.length > 1 && (
            <div className="flex items-center gap-1 flex-wrap pt-0.5">
              <span className="text-[10px] text-slate-400 mr-1">Cargos:</span>
              {roles.map((role) => {
                const roleEmpIds = employees.filter((e) => (e.role || 'Geral') === role).map((e) => e.id);
                const active = roleEmpIds.length > 0 && roleEmpIds.every((id) => selectedIds.includes(id));
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => handleToggleRole(role)}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                      active
                        ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                    }`}
                  >
                    {role} ({roleEmpIds.length})
                  </button>
                );
              })}
            </div>
          )}

          {/* Lista de Colaboradores com Checkbox */}
          <div className="max-h-[210px] overflow-y-auto divide-y divide-slate-800/40 border-t border-slate-800 pt-1">
            {filteredEmployees.length === 0 ? (
              <div className="p-3 text-center text-xs text-slate-500 italic">
                Nenhum colaborador encontrado.
              </div>
            ) : (
              filteredEmployees.map((emp) => {
                const isSelected = selectedIds.includes(emp.id);
                return (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => handleToggleEmployee(emp.id)}
                    className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors text-left ${
                      isSelected
                        ? 'bg-indigo-600/20 text-white font-semibold'
                        : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                    }`}
                  >
                    <div className="min-w-0 flex-1 truncate">
                      <div className="truncate">{emp.name}</div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {emp.role || 'Geral'}
                        {emp.contract?.summary ? ` • ${emp.contract.summary}` : ''}
                      </div>
                    </div>
                    <div
                      className={`w-4 h-4 rounded flex items-center justify-center shrink-0 transition-all ${
                        isSelected
                          ? 'bg-indigo-600 border border-indigo-400 text-white'
                          : 'border border-slate-700 bg-slate-950 text-transparent'
                      }`}
                    >
                      {isSelected && <Check size={11} strokeWidth={3} className="text-white" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Rodapé */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-[11px]">
            <span className="text-slate-400">
              Selecionados: <strong className="text-white">{selectedIds.length}</strong> de {employees.length}
            </span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-3 py-1 rounded-md font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow"
            >
              Concluir
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ==============================================================================
// --- [BLOCO: PAINEL PRINCIPAL DE PREENCHIMENTO E AJUSTE EM LOTE] ---
// ==============================================================================

export default function RHJornadaBatchPanel({
  employees = [],
  daysList = [],
  sundays = [],
  holidays = {},
  selectedYear,
  selectedMonth,
  scheduleId,
  workDays = {},
  token,
  apiBase,
  onClose,
  onSuccess,
  onViolationsToast
}) {
  // Modo principal: 'CUSTOM' (Ajuste Personalizado em Lote) ou 'CONTRACT' (Semana-Padrão do Contrato)
  const [fillMode, setFillMode] = useState('CUSTOM');

  // Escopo: Colaboradores (array de IDs) e Datas (array de dias do mês)
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState(() => employees.map((e) => e.id));
  const [fillSelectedDays, setFillSelectedDays] = useState(() => (
    daysList.length ? daysList : Array.from({ length: 31 }, (_, i) => i + 1)
  ));

  // Sincroniza colaboradores/dias quando a lista carregar ou mudar de mês
  useEffect(() => {
    setSelectedEmployeeIds(employees.map((e) => e.id));
  }, [employees]);

  useEffect(() => {
    if (daysList.length > 0) {
      setFillSelectedDays(daysList);
    }
  }, [daysList]);

  // Opções gerais de aplicação
  const [fillOverwriteManual, setFillOverwriteManual] = useState(true);
  const [fillClearUnselected, setFillClearUnselected] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Estados do Ajuste Personalizado em Lote
  const [customStatus, setCustomStatus] = useState('TRABALHO');
  // Submodo de horário quando customStatus === 'TRABALHO': 'FIXED' (Horário Fixo) | 'OFFSET' (Variação sobre o Contrato)
  const [workTimeMode, setWorkTimeMode] = useState('FIXED');

  // Horário fixo
  const [fixedTimes, setFixedTimes] = useState({
    start_time: '07:00',
    lunch_start: '12:00',
    lunch_end: '13:00',
    end_time: '16:00'
  });
  const [noLunch, setNoLunch] = useState(false);

  // Variação sobre o contrato (em minutos)
  const [startOffsetMin, setStartOffsetMin] = useState(0);
  const [endOffsetMin, setEndOffsetMin] = useState(60); // Ex: +1h extra na saída por padrão
  const [skipRestOnOffset, setSkipRestOnOffset] = useState(true);

  // Metadados adicionais do lançamento
  const [isLateRecord, setIsLateRecord] = useState(false);
  const [batchNotes, setBatchNotes] = useState('');

  const fixedWorkedMinutes = useMemo(() => {
    return computeWorkedMinutes({
      start_time: fixedTimes.start_time,
      lunch_start: noLunch ? null : fixedTimes.lunch_start,
      lunch_end: noLunch ? null : fixedTimes.lunch_end,
      end_time: fixedTimes.end_time
    });
  }, [fixedTimes, noLunch]);

  const handleShiftFixedTime = (field, diffMin) => {
    const fallback = field === 'start_time' ? '07:00' : '16:00';
    setFixedTimes((prev) => ({
      ...prev,
      [field]: shiftClockTime(prev[field], diffMin, fallback)
    }));
  };

  // Prévia de células impactadas e células manuais protegidas
  const impactStats = useMemo(() => {
    let totalCells = 0;
    let manualLocked = 0;
    let skippedRest = 0;

    selectedEmployeeIds.forEach((empId) => {
      fillSelectedDays.forEach((day) => {
        totalCells += 1;
        const cell = workDays[empId]?.[day];
        if (cell?.is_manual && !fillOverwriteManual) {
          manualLocked += 1;
          return;
        }
        if (
          fillMode === 'CUSTOM' &&
          customStatus === 'TRABALHO' &&
          workTimeMode === 'OFFSET' &&
          skipRestOnOffset
        ) {
          const isHol = Boolean(holidays[day]);
          const times = contractTimes(cell?.contract_day);
          if (isHol || !times) {
            skippedRest += 1;
          }
        }
      });
    });

    const effectiveCells = Math.max(0, totalCells - manualLocked - skippedRest);
    return { totalCells, manualLocked, skippedRest, effectiveCells };
  }, [
    selectedEmployeeIds,
    fillSelectedDays,
    workDays,
    fillOverwriteManual,
    fillMode,
    customStatus,
    workTimeMode,
    skipRestOnOffset,
    holidays
  ]);

  // ==============================================================================
  // --- [BLOCO: EXECUÇÃO DO LOTE (CONTRATO OU AJUSTE PERSONALIZADO)] ---
  // ==============================================================================

  const handleExecuteBatch = async () => {
    if (selectedEmployeeIds.length === 0 || fillSelectedDays.length === 0) return;

    try {
      setSubmitting(true);

      // 1. MODO SEMANA-PADRÃO DO CONTRATO
      if (fillMode === 'CONTRACT') {
        const isAllEmp = selectedEmployeeIds.length === employees.length;
        const payload = {
          schedule_id: scheduleId,
          employee_ids: isAllEmp ? null : selectedEmployeeIds,
          status: 'TRABALHO',
          day_from: 1,
          day_to: daysList.length || 31,
          weekdays: null,
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
          throw new Error(resData.detail || 'Erro ao preencher escala pelo contrato');
        }

        if (resData.skipped_manual_count > 0 && resData.updated_count === 0) {
          alert(
            `Nenhuma alteração foi realizada porque ${resData.skipped_manual_count} dia(s) já possuem edições manuais registradas.\n\nPara forçar a aplicação neste período, marque a opção "Sobrescrever edições manuais".`
          );
        } else if (onSuccess) {
          await onSuccess(resData.message || 'Contrato aplicado em lote com sucesso!');
        }
        return;
      }

      // 2. MODO AJUSTE PERSONALIZADO EM LOTE
      const entries = [];
      let skippedManualCount = 0;
      let skippedRestCount = 0;

      selectedEmployeeIds.forEach((empId) => {
        fillSelectedDays.forEach((day) => {
          const current = workDays[empId]?.[day];
          if (current?.is_manual && !fillOverwriteManual) {
            skippedManualCount += 1;
            return;
          }

          let start_time = null;
          let lunch_start = null;
          let lunch_end = null;
          let end_time = null;
          let worked_minutes = 0;

          if (customStatus === 'TRABALHO') {
            if (workTimeMode === 'FIXED') {
              start_time = fixedTimes.start_time || '07:00';
              lunch_start = noLunch ? null : (fixedTimes.lunch_start || '12:00');
              lunch_end = noLunch ? null : (fixedTimes.lunch_end || '13:00');
              end_time = fixedTimes.end_time || '16:00';
              worked_minutes = computeWorkedMinutes({ start_time, lunch_start, lunch_end, end_time });
            } else {
              // Variação sobre o contrato individual do colaborador no dia
              const isHol = Boolean(holidays[day]);
              const baseContract = contractTimes(current?.contract_day);
              if ((isHol || !baseContract) && skipRestOnOffset) {
                skippedRestCount += 1;
                return;
              }
              const base = baseContract || {
                start_time: '07:00',
                lunch_start: '12:00',
                lunch_end: '13:00',
                end_time: '16:00'
              };
              start_time = shiftClockTime(base.start_time, startOffsetMin, '07:00');
              lunch_start = base.lunch_start || null;
              lunch_end = base.lunch_end || null;
              end_time = shiftClockTime(base.end_time, endOffsetMin, '16:00');
              worked_minutes = computeWorkedMinutes({ start_time, lunch_start, lunch_end, end_time });
            }
          }

          const entry = {
            employee_id: empId,
            day,
            status: customStatus,
            start_time,
            lunch_start,
            lunch_end,
            end_time,
            worked_minutes,
            is_manual: true,
            is_late_record: customStatus === 'TRABALHO' ? Boolean(isLateRecord) : false
          };

          if (batchNotes.trim()) {
            entry.notes = batchNotes.trim();
          }

          entries.push(entry);
        });
      });

      if (entries.length === 0) {
        if (skippedManualCount > 0) {
          alert(
            `Nenhum dia foi atualizado porque os ${skippedManualCount} lançamento(s) selecionados já possuem edição manual.\n\nMarque "Sobrescrever edições manuais" para atualizar mesmo assim.`
          );
        } else if (skippedRestCount > 0) {
          alert(
            'Nenhum dia útil de contrato encontrado nas datas selecionadas (todos os dias selecionados são descanso/feriado ou sem contrato vigente).'
          );
        }
        return;
      }

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

      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(resData.detail || 'Erro ao aplicar ajuste em lote');
      }

      if (resData.new_violations?.length && onViolationsToast) {
        onViolationsToast(resData.new_violations);
      }

      const msgParts = [`Ajuste em lote aplicado (${entries.length} lançamento${entries.length === 1 ? '' : 's'})!`];
      if (skippedManualCount > 0) msgParts.push(`${skippedManualCount} manual(is) preservado(s).`);
      if (skippedRestCount > 0) msgParts.push(`${skippedRestCount} descanso(s) ignorado(s).`);

      if (onSuccess) {
        await onSuccess(msgParts.join(' '));
      }
    } catch (err) {
      alert('Falha ao aplicar preenchimento em lote: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-slate-950 border border-indigo-500/30 rounded-xl p-4 space-y-4 shadow-lg animate-in fade-in duration-200">
      {/* Cabeçalho e Seletor de Modo */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2 text-xs font-bold text-indigo-300">
          <Sparkles size={16} />
          Preenchimento e Ajuste em Lote da Escala
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg bg-slate-900 p-1 border border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => {
                setFillMode('CUSTOM');
                setFillOverwriteManual(true);
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-semibold transition-all ${
                fillMode === 'CUSTOM'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Sliders size={13} />
              Ajuste Personalizado
            </button>
            <button
              type="button"
              onClick={() => {
                setFillMode('CONTRACT');
                setFillOverwriteManual(false);
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-semibold transition-all ${
                fillMode === 'CONTRACT'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Sparkles size={13} />
              Semana-Padrão do Contrato
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded"
            title="Fechar painel"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Descrição contextual do modo */}
      <p className="text-[11px] text-slate-400">
        {fillMode === 'CONTRACT'
          ? 'Cada dia selecionado recebe exatamente o horário do contrato vigente na data (DSR, folgas e feriados incluídos). O preenchimento pelo contrato nunca gera hora extra.'
          : 'Selecione os colaboradores e as datas, e configure o ajuste (status, horário fixo ou hora extra/variação sobre o contrato) para aplicar de uma só vez a todos os selecionados.'}
      </p>

      {/* Linha 1: Escopo (Colaboradores, Datas e Opções Gerais) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div>
          <label className="block text-slate-400 mb-1 font-medium">1. Colaborador(es)</label>
          <MultiEmployeeDropdown
            employees={employees}
            selectedIds={selectedEmployeeIds}
            onChange={setSelectedEmployeeIds}
          />
        </div>

        <div>
          <label className="block text-slate-400 mb-1 font-medium">2. Datas para Aplicação</label>
          <CalendarCheckboxDropdown
            year={selectedYear}
            month={selectedMonth}
            selectedDays={fillSelectedDays}
            onChange={setFillSelectedDays}
            sundays={sundays}
            holidays={holidays}
          />
        </div>

        <div>
          <label className="block text-slate-400 mb-1 font-medium">3. Opções de Proteção</label>
          <div className="mt-1.5 space-y-2">
            <StyledCheckbox
              checked={fillOverwriteManual}
              onChange={(checked) => setFillOverwriteManual(checked)}
              label="Sobrescrever edições manuais"
              description="Atualiza também os dias que já foram editados manualmente"
            />
            {fillMode === 'CONTRACT' && (
              <StyledCheckbox
                checked={fillClearUnselected}
                onChange={(checked) => setFillClearUnselected(checked)}
                label="Substituir escala inteira"
                description="Define dias não selecionados como folga semanal (sem debitar BH)"
              />
            )}
            {fillMode === 'CUSTOM' && customStatus === 'TRABALHO' && (
              <StyledCheckbox
                checked={isLateRecord}
                onChange={(checked) => setIsLateRecord(checked)}
                label="Registrar como atraso (ponto)"
                description="Sem esta marca, a mudança de horário conta como remanejamento"
              />
            )}
          </div>
        </div>
      </div>

      {/* Linha 2: Configuração do Ajuste Personalizado (apenas quando fillMode === 'CUSTOM') */}
      {fillMode === 'CUSTOM' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-4 text-xs">
          {/* Seleção de Status do Dia */}
          <div>
            <label className="block text-slate-400 mb-1.5 font-medium">
              4. Status a Aplicar nos Dias Selecionados
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-1.5">
              {STATUS_OPTIONS.map((st) => {
                const active = customStatus === st.key;
                return (
                  <button
                    key={st.key}
                    type="button"
                    onClick={() => setCustomStatus(st.key)}
                    className={`px-2.5 py-1.5 rounded-lg border text-center font-semibold text-[11px] transition-all ${
                      active
                        ? 'border-indigo-500 bg-indigo-600/30 text-white ring-1 ring-indigo-500/40 shadow-xs'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-white hover:border-slate-700'
                    }`}
                  >
                    {st.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Configurações de Horário quando Status === 'TRABALHO' */}
          {customStatus === 'TRABALHO' && (
            <div className="space-y-3 pt-2 border-t border-slate-800/80">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <label className="text-slate-300 font-semibold flex items-center gap-1.5">
                  <Clock size={14} className="text-indigo-400" />
                  5. Regra de Horário para o Trabalho
                </label>

                <div className="inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setWorkTimeMode('FIXED')}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                      workTimeMode === 'FIXED'
                        ? 'bg-indigo-600/40 text-indigo-200 border border-indigo-500/40'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Horário Fixo para Todos
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkTimeMode('OFFSET')}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                      workTimeMode === 'OFFSET'
                        ? 'bg-indigo-600/40 text-indigo-200 border border-indigo-500/40'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Variação sobre o Contrato Individual
                  </button>
                </div>
              </div>

              {workTimeMode === 'FIXED' ? (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center bg-slate-950/70 border border-slate-800/80 rounded-lg p-3">
                  {/* 4 Inputs de Relógio */}
                  <div className="lg:col-span-5 grid grid-cols-4 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Entrada 1</label>
                      <input
                        type="time"
                        value={fixedTimes.start_time}
                        onChange={(e) => setFixedTimes({ ...fixedTimes, start_time: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-white text-center text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Início Almoço</label>
                      <input
                        type="time"
                        value={noLunch ? '' : fixedTimes.lunch_start}
                        disabled={noLunch}
                        onChange={(e) => setFixedTimes({ ...fixedTimes, lunch_start: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-white text-center text-xs disabled:opacity-30 disabled:cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Fim Almoço</label>
                      <input
                        type="time"
                        value={noLunch ? '' : fixedTimes.lunch_end}
                        disabled={noLunch}
                        onChange={(e) => setFixedTimes({ ...fixedTimes, lunch_end: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-white text-center text-xs disabled:opacity-30 disabled:cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Saída 2</label>
                      <input
                        type="time"
                        value={fixedTimes.end_time}
                        onChange={(e) => setFixedTimes({ ...fixedTimes, end_time: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-white text-center text-xs"
                      />
                    </div>
                  </div>

                  {/* Sem Almoço + Total Líquido */}
                  <div className="lg:col-span-3 flex items-center justify-between lg:justify-center gap-3 border-t lg:border-t-0 lg:border-x border-slate-800 pt-2 lg:pt-0 lg:px-3">
                    <StyledCheckbox
                      checked={noLunch}
                      onChange={(checked) => setNoLunch(checked)}
                      label="Sem almoço"
                      description="Jornada corrida"
                    />
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 block">Jornada líquida</span>
                      <span className="text-sm font-bold text-emerald-300">
                        {formatWorked(fixedWorkedMinutes)}
                      </span>
                    </div>
                  </div>

                  {/* Atalhos rápidos de deslocamento no horário fixo */}
                  <div className="lg:col-span-4 space-y-1.5">
                    <div className="flex items-center justify-between gap-1 flex-wrap">
                      <span className="text-[10px] text-slate-400">Saída (HE / Banco):</span>
                      <div className="flex items-center gap-1">
                        {[-60, -30, 30, 60, 120].map((m) => (
                          <button
                            key={`fix-out-${m}`}
                            type="button"
                            onClick={() => handleShiftFixedTime('end_time', m)}
                            className={`px-1.5 py-0.5 rounded font-semibold text-[10px] border ${
                              m > 0
                                ? 'bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border-amber-500/40'
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                            }`}
                          >
                            {m > 0 ? '+' : '−'}
                            {Math.abs(m) < 60 ? `${Math.abs(m)}m` : `${Math.abs(m) / 60}h`}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-1 flex-wrap">
                      <span className="text-[10px] text-slate-400">Entrada:</span>
                      <div className="flex items-center gap-1">
                        {[-60, -30, 30, 60, 120].map((m) => (
                          <button
                            key={`fix-in-${m}`}
                            type="button"
                            onClick={() => handleShiftFixedTime('start_time', m)}
                            className="px-1.5 py-0.5 rounded font-semibold text-[10px] border bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700"
                          >
                            {m > 0 ? '+' : '−'}
                            {Math.abs(m) < 60 ? `${Math.abs(m)}m` : `${Math.abs(m) / 60}h`}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* Submodo OFFSET: Variação sobre o Contrato Individual de cada colaborador */
                <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-3 space-y-3">
                  <p className="text-[11px] text-slate-400">
                    Mantém o turno contratual de cada colaborador (mesmo que tenham horários diferentes entre si) e soma/subtrai o tempo abaixo na entrada ou na saída:
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
                    {/* Variação na Entrada */}
                    <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-300 font-medium">Variação na Entrada</span>
                        <span className={`text-xs font-bold ${
                          startOffsetMin === 0 ? 'text-slate-400' : startOffsetMin > 0 ? 'text-rose-300' : 'text-amber-300'
                        }`}>
                          {startOffsetMin === 0
                            ? 'Horário normal'
                            : `${startOffsetMin > 0 ? '+ ' : '− '}${formatWorked(Math.abs(startOffsetMin))} (${startOffsetMin > 0 ? 'mais tarde' : 'mais cedo'})`}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 flex-wrap">
                        {[-60, -30, 0, 30, 60, 120].map((m) => (
                          <button
                            key={`off-in-${m}`}
                            type="button"
                            onClick={() => setStartOffsetMin(m)}
                            className={`px-2 py-1 rounded text-[10px] font-semibold border transition-colors ${
                              startOffsetMin === m
                                ? 'bg-indigo-600 text-white border-indigo-400'
                                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                            }`}
                          >
                            {m === 0 ? '0 (Contrato)' : `${m > 0 ? '+' : '−'}${Math.abs(m) < 60 ? `${Math.abs(m)}m` : `${Math.abs(m) / 60}h`}`}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Variação na Saída (Hora Extra / Sair mais cedo) */}
                    <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-300 font-medium">Variação na Saída (HE / Banco)</span>
                        <span className={`text-xs font-bold ${
                          endOffsetMin === 0 ? 'text-slate-400' : endOffsetMin > 0 ? 'text-amber-300' : 'text-rose-300'
                        }`}>
                          {endOffsetMin === 0
                            ? 'Horário normal'
                            : `${endOffsetMin > 0 ? '+ ' : '− '}${formatWorked(Math.abs(endOffsetMin))} (${endOffsetMin > 0 ? 'hora extra' : 'sair antes'})`}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 flex-wrap">
                        {[-120, -60, -30, 0, 30, 60, 120].map((m) => (
                          <button
                            key={`off-out-${m}`}
                            type="button"
                            onClick={() => setEndOffsetMin(m)}
                            className={`px-2 py-1 rounded text-[10px] font-semibold border transition-colors ${
                              endOffsetMin === m
                                ? 'bg-amber-500/30 text-amber-200 border-amber-400'
                                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                            }`}
                          >
                            {m === 0 ? '0 (Contrato)' : `${m > 0 ? '+' : '−'}${Math.abs(m) < 60 ? `${Math.abs(m)}m` : `${Math.abs(m) / 60}h`}`}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Proteção de DSR/Folgas do Contrato */}
                    <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5">
                      <StyledCheckbox
                        checked={skipRestOnOffset}
                        onChange={(checked) => setSkipRestOnOffset(checked)}
                        label="Pular dias de folga/DSR/feriado"
                        description="Aplica a variação apenas nos dias em que o colaborador já trabalha pelo contrato"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Observação / Justificativa em Lote */}
          <div className="pt-2 border-t border-slate-800/80">
            <label className="block text-slate-400 mb-1 font-medium flex items-center gap-1.5">
              <FileText size={13} className="text-slate-400" />
              Observação / Justificativa para o Lote (opcional)
            </label>
            <input
              type="text"
              placeholder="Ex: Hora extra para inventário / Folga compensatória coletiva / Recesso"
              value={batchNotes}
              onChange={(e) => setBatchNotes(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>
      )}

      {/* Barra Inferior: Resumo do Impacto e Botão de Execução */}
      <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-slate-800/60 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-slate-400">Escopo do lote:</span>
          <span className="font-bold text-indigo-300 bg-indigo-950/60 border border-indigo-800/60 px-2.5 py-0.5 rounded-full">
            {selectedEmployeeIds.length} {selectedEmployeeIds.length === 1 ? 'colaborador' : 'colaboradores'}
          </span>
          <span className="text-slate-600">×</span>
          <span className="font-bold text-indigo-300 bg-indigo-950/60 border border-indigo-800/60 px-2.5 py-0.5 rounded-full">
            {fillSelectedDays.length} {fillSelectedDays.length === 1 ? 'dia' : 'dias'}
          </span>
          <span className="text-slate-600">=</span>
          <span className="font-bold text-emerald-300 bg-emerald-950/50 border border-emerald-700/50 px-2.5 py-0.5 rounded-full">
            {impactStats.effectiveCells} {impactStats.effectiveCells === 1 ? 'lançamento efetivo' : 'lançamentos efetivos'}
          </span>

          {impactStats.manualLocked > 0 && (
            <span className="text-[11px] text-amber-300 flex items-center gap-1">
              <AlertCircle size={13} />
              {impactStats.manualLocked} manual(is) será(ão) preservado(s)
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={handleExecuteBatch}
          disabled={
            submitting ||
            selectedEmployeeIds.length === 0 ||
            fillSelectedDays.length === 0
          }
          className="flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {submitting
            ? 'Aplicando em Lote...'
            : fillMode === 'CONTRACT'
              ? 'Aplicar Contrato na Escala'
              : 'Aplicar Ajuste em Lote'}
        </button>
      </div>
    </div>
  );
}

