import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, Bus, Utensils, AlertTriangle, Calendar, Printer, 
  Save, RefreshCw, Plus, Trash2, Edit2, CheckCircle2, Clock, 
  ChevronLeft, ChevronRight, ShieldAlert, Sparkles, FileSpreadsheet
} from 'lucide-react';
import Skeleton from '../../components/common/Skeleton';

// ==============================================================================
// --- [BLOCO: CONSTANTES & CONFIGURAÇÕES DE STATUS] ---
// ==============================================================================

const STATUS_CONFIG = {
  X: {
    label: 'Trabalho',
    short: 'X',
    bg: 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-600/30',
    printClass: 'bg-emerald-100 text-emerald-800 font-bold',
    badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    desc: 'Trabalho normal'
  },
  BH: {
    label: 'Banco de Horas',
    short: 'BH',
    bg: 'bg-amber-500/25 text-amber-300 border-amber-500/50 hover:bg-amber-500/35',
    printClass: 'bg-yellow-200 text-amber-900 font-bold',
    badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    desc: 'Folga compensatória de banco de horas (48h/semana)'
  },
  F: {
    label: 'Feriado',
    short: 'F',
    bg: 'bg-sky-500/20 text-sky-300 border-sky-500/40 hover:bg-sky-500/30',
    printClass: 'bg-blue-100 text-blue-800 font-bold',
    badge: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
    desc: 'Feriado municipal ou nacional'
  },
  FE: {
    label: 'Férias',
    short: 'FE',
    bg: 'bg-purple-500/20 text-purple-300 border-purple-500/40 hover:bg-purple-500/30',
    printClass: 'bg-purple-100 text-purple-800 font-bold',
    badge: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    desc: 'Período de férias regulamentares'
  },
  OFF: {
    label: 'Folga',
    short: '-',
    bg: 'bg-slate-800/40 text-slate-500 border-slate-700/40 hover:bg-slate-800/80',
    printClass: 'bg-slate-100 text-slate-500',
    badge: 'bg-slate-800 text-slate-400 border-slate-700',
    desc: 'Folga semanal'
  }
};

const STATUS_KEYS = ['X', 'BH', 'F', 'FE', 'OFF'];

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

export default function RHEscalasView({ token }) {
  // ==============================================================================
  // --- [BLOCO: ESTADOS PRINCIPAIS] ---
  // ==============================================================================

  const today = new Date();
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1);
  const [activeTab, setActiveTab] = useState('transporte'); // 'transporte', 'alimentacao', 'resumo', 'mural', 'equipe'
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scheduleData, setScheduleData] = useState(null);
  const [localGrid, setLocalGrid] = useState({});
  const [dirty, setDirty] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState('');

  // Modais de Gestão de Equipe & Configurações
  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [employeeFormData, setEmployeeFormData] = useState({
    name: '',
    role: '',
    daily_transport_cost: 9.40,
    daily_meal_cost: 25.00,
    weekly_contract_hours: 44.0,
    weekly_actual_hours: 48.0,
    active: true
  });

  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsFormData, setSettingsFormData] = useState({
    max_consecutive_sundays: 2,
    default_transport_cost: 9.40,
    default_meal_cost: 25.00,
    min_daily_hours_for_meal: 6.0,
    weekly_bank_overtime_hours: 4.0,
    compensatory_days_per_month: 2
  });

  // ==============================================================================
  // --- [BLOCO: CARREGAMENTO DE DADOS (FETCH)] ---
  // ==============================================================================

  const fetchSchedule = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/rh/schedules?year=${selectedYear}&month=${selectedMonth}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Erro ao carregar escala mensal de RH');
      const data = await res.json();
      setScheduleData(data);
      setLocalGrid(data.grid || {});
      setDirty(false);
      if (data.settings) {
        setSettingsFormData(data.settings);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSchedule();
  }, [selectedYear, selectedMonth]);

  // ==============================================================================
  // --- [BLOCO: ALTERAÇÃO RÁPIDA DE DIAS NA MATRIZ] ---
  // ==============================================================================

  const handleCellClick = (empId, day, type) => {
    setLocalGrid((prev) => {
      const empData = prev[empId] || { TRANSPORTE: {}, ALIMENTACAO: {} };
      const currentEntry = empData[type]?.[day] || { status: 'OFF', shift: null, daily_hours: 8.0 };
      const currentStatus = currentEntry.status || 'OFF';

      const currentIndex = STATUS_KEYS.indexOf(currentStatus);
      const nextIndex = (currentIndex + 1) % STATUS_KEYS.length;
      const nextStatus = STATUS_KEYS[nextIndex];

      const updatedEmpData = {
        ...empData,
        [type]: {
          ...(empData[type] || {}),
          [day]: {
            ...currentEntry,
            status: nextStatus
          }
        }
      };

      setDirty(true);
      return {
        ...prev,
        [empId]: updatedEmpData
      };
    });
  };

  const handleShiftChange = (empId, day, type, newShift) => {
    setLocalGrid((prev) => {
      const empData = prev[empId] || { TRANSPORTE: {}, ALIMENTACAO: {} };
      const currentEntry = empData[type]?.[day] || { status: 'X', shift: null, daily_hours: 8.0 };

      const updatedEmpData = {
        ...empData,
        [type]: {
          ...(empData[type] || {}),
          [day]: {
            ...currentEntry,
            shift: newShift
          }
        }
      };

      setDirty(true);
      return {
        ...prev,
        [empId]: updatedEmpData
      };
    });
  };

  // ==============================================================================
  // --- [BLOCO: SALVAR ALTERAÇÕES EM LOTE] ---
  // ==============================================================================

  const handleSaveSchedule = async () => {
    try {
      setSaving(true);
      const entries = [];

      Object.entries(localGrid).forEach(([empIdStr, typesObj]) => {
        const empId = parseInt(empIdStr, 10);
        ['TRANSPORTE', 'ALIMENTACAO'].forEach((stype) => {
          const daysObj = typesObj[stype] || {};
          Object.entries(daysObj).forEach(([dayStr, dayVal]) => {
            entries.push({
              employee_id: empId,
              schedule_type: stype,
              day: parseInt(dayStr, 10),
              status: dayVal.status,
              shift: dayVal.shift,
              daily_hours: dayVal.daily_hours || 8.0
            });
          });
        });
      });

      const res = await fetch('/api/rh/schedules/batch-save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          year: selectedYear,
          month: selectedMonth,
          entries
        })
      });

      if (!res.ok) throw new Error('Falha ao salvar a escala');
      setDirty(false);
      setSaveSuccessMsg('Escala salva com sucesso!');
      setTimeout(() => setSaveSuccessMsg(''), 4000);
      await fetchSchedule();
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar alterações da escala.');
    } finally {
      setSaving(false);
    }
  };

  const handleAutoFillStandard = async () => {
    if (!window.confirm('Preencher automaticamente a escala padrão (Seg-Sáb = X, Dom = Folga) para o mês atual?')) return;
    try {
      setSaving(true);
      const res = await fetch(`/api/rh/schedules/auto-fill-standard?year=${selectedYear}&month=${selectedMonth}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Falha ao preencher escala padrão');
      await fetchSchedule();
      setSaveSuccessMsg('Escala padrão aplicada com sucesso!');
      setTimeout(() => setSaveSuccessMsg(''), 4000);
    } catch (err) {
      console.error(err);
      alert('Erro ao aplicar escala padrão.');
    } finally {
      setSaving(false);
    }
  };

  // ==============================================================================
  // --- [BLOCO: GESTÃO DE COLABORADORES & CONFIGURAÇÕES] ---
  // ==============================================================================

  const handleSaveEmployee = async (e) => {
    e.preventDefault();
    try {
      const url = editingEmployee 
        ? `/api/rh/employees/${editingEmployee.id}` 
        : '/api/rh/employees';
      const method = editingEmployee ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(employeeFormData)
      });

      if (!res.ok) throw new Error('Erro ao salvar colaborador');
      setEmployeeModalOpen(false);
      setEditingEmployee(null);
      await fetchSchedule();
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar colaborador.');
    }
  };

  const handleDeleteEmployee = async (empId) => {
    if (!window.confirm('Excluir este colaborador e suas escalas?')) return;
    try {
      const res = await fetch(`/api/rh/employees/${empId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Erro ao excluir colaborador');
      await fetchSchedule();
    } catch (err) {
      console.error(err);
      alert('Erro ao excluir colaborador.');
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/rh/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(settingsFormData)
      });
      if (!res.ok) throw new Error('Erro ao atualizar configurações');
      setSettingsModalOpen(false);
      await fetchSchedule();
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar configurações.');
    }
  };

  // ==============================================================================
  // --- [BLOCO: TOTAIS E CÁLCULOS DINÂMICOS] ---
  // ==============================================================================

  const calculatedTotals = useMemo(() => {
    if (!scheduleData?.summaries) return { vt: 0, va: 0, total: 0 };
    return scheduleData.summaries.reduce(
      (acc, curr) => ({
        vt: acc.vt + curr.total_vt_amount,
        va: acc.va + curr.total_va_amount,
        total: acc.total + curr.total_benefits_amount
      }),
      { vt: 0, va: 0, total: 0 }
    );
  }, [scheduleData]);

  const daysList = useMemo(() => {
    if (!scheduleData?.num_days) return [];
    return Array.from({ length: scheduleData.num_days }, (_, i) => i + 1);
  }, [scheduleData]);

  // Impressão nativa limpa
  const handlePrint = () => {
    window.print();
  };

  // ==============================================================================
  // --- [BLOCO: RENDERIZAÇÃO DA TABELA DE ESCALA MATRIZ (VT OU VA)] ---
  // ==============================================================================

  const renderScheduleGrid = (scheduleType) => {
    const isTransport = scheduleType === 'TRANSPORTE';
    const typeLabel = isTransport ? 'Vale Transporte (VT)' : 'Vale Alimentação (VA)';

    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        {/* Cabeçalho da Grade */}
        <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 print:border-b-2 print:border-slate-400">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2 print:text-black">
              {isTransport ? <Bus className="text-indigo-400 print:text-black" size={20} /> : <Utensils className="text-emerald-400 print:text-black" size={20} />}
              Grade Mensal de {typeLabel}
            </h2>
            <p className="text-xs text-slate-400 print:text-slate-600">
              Clique em qualquer dia para alternar entre as legendas (X = Trabalho, BH = Banco Horas, F = Feriado, FE = Férias, - = Folga)
            </p>
          </div>

          <div className="flex items-center gap-2 print:hidden">
            {STATUS_KEYS.map((k) => (
              <span key={k} className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${STATUS_CONFIG[k].badge}`}>
                {STATUS_CONFIG[k].short}: {STATUS_CONFIG[k].label}
              </span>
            ))}
          </div>
        </div>

        {/* Tabela de Matriz com Rolagem Horizontal Suave */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse print:text-[10px]">
            <thead>
              <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider print:bg-slate-100 print:text-black">
                <th className="py-2.5 px-3 min-w-[160px] sticky left-0 bg-slate-950 z-10 border-r border-slate-800 print:bg-white print:border-r print:border-slate-300">
                  Colaborador
                </th>
                {daysList.map((day) => {
                  const isSunday = scheduleData.sundays.includes(day);
                  const isHoliday = !!scheduleData.holidays[day];
                  return (
                    <th 
                      key={day} 
                      className={`py-2 px-1 text-center min-w-[34px] border-r border-slate-800/60 print:border-r print:border-slate-300 ${
                        isSunday 
                          ? 'bg-red-950/20 text-red-400 font-bold print:bg-red-50 print:text-red-700' 
                          : isHoliday 
                            ? 'bg-sky-950/30 text-sky-400 font-bold print:bg-sky-50 print:text-sky-700' 
                            : 'text-slate-300'
                      }`}
                      title={isHoliday ? scheduleData.holidays[day] : isSunday ? 'Domingo' : `Dia ${day}`}
                    >
                      <div>{day}</div>
                      <div className="text-[9px] font-normal lowercase opacity-70">
                        {isSunday ? 'dom' : isHoliday ? 'fer' : ''}
                      </div>
                    </th>
                  );
                })}
                <th className="py-2.5 px-3 text-center min-w-[70px] bg-slate-950 border-l border-slate-800 print:bg-slate-100 print:text-black">
                  Dias Trab.
                </th>
                <th className="py-2.5 px-3 text-right min-w-[90px] bg-slate-950 border-l border-slate-800 print:bg-slate-100 print:text-black">
                  {isTransport ? 'Total VT' : 'Total VA'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 print:divide-slate-300">
              {scheduleData.employees.map((emp) => {
                const empGrid = localGrid[emp.id]?.[scheduleType] || {};
                const summary = scheduleData.summaries.find((s) => s.employee_id === emp.id) || {};
                const workedDays = isTransport ? (summary.vt_worked_days || 0) : (summary.va_worked_days || 0);
                const totalAmount = isTransport ? (summary.total_vt_amount || 0) : (summary.total_va_amount || 0);

                return (
                  <tr key={emp.id} className="hover:bg-slate-800/30 transition-colors print:hover:bg-transparent">
                    <td className="py-2 px-3 font-medium text-slate-200 sticky left-0 bg-slate-900 border-r border-slate-800 z-10 print:bg-white print:text-black print:border-r print:border-slate-300">
                      <div className="truncate max-w-[150px] font-semibold">{emp.name}</div>
                      <div className="text-[10px] text-slate-500 truncate print:text-slate-600">
                        {isTransport ? `R$ ${(emp.daily_transport_cost || 0).toFixed(2)}/dia` : `R$ ${(emp.daily_meal_cost || 0).toFixed(2)}/dia`}
                      </div>
                    </td>

                    {daysList.map((day) => {
                      const entry = empGrid[day] || { status: 'OFF' };
                      const status = entry.status || 'OFF';
                      const conf = STATUS_CONFIG[status] || STATUS_CONFIG.OFF;
                      const isSunday = scheduleData.sundays.includes(day);

                      return (
                        <td
                          key={day}
                          onClick={() => handleCellClick(emp.id, day, scheduleType)}
                          className={`py-1 px-0.5 text-center cursor-pointer select-none transition-colors border-r border-slate-800/50 print:border-r print:border-slate-300 ${
                            isSunday ? 'bg-red-950/10' : ''
                          }`}
                          title={`${emp.name} - Dia ${day}: ${conf.label}. Clique para alterar.`}
                        >
                          <div 
                            className={`w-7 h-7 mx-auto rounded flex items-center justify-center font-bold text-[11px] border transition-transform active:scale-95 ${conf.bg} print:border-0 print:${conf.printClass}`}
                          >
                            {conf.short}
                          </div>
                        </td>
                      );
                    })}

                    <td className="py-2 px-2 text-center font-bold text-slate-300 border-l border-slate-800 print:text-black print:border-l print:border-slate-300">
                      {workedDays}
                    </td>
                    <td className="py-2 px-3 text-right font-semibold text-emerald-400 border-l border-slate-800 print:text-black print:border-l print:border-slate-300">
                      R$ {totalAmount.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ==============================================================================
  // --- [BLOCO: RENDERIZAÇÃO DA ABA RESUMO FINANCEIRO & RECIBOS] ---
  // ==============================================================================

  const renderFinancialSummary = () => (
    <div className="space-y-6">
      {/* Cards de Resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Vale Transporte (VT)</span>
            <Bus size={18} className="text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-white tracking-tight">
            R$ {calculatedTotals.vt.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <p className="text-xs text-slate-500 mt-1">Depósito antecipado para deslocamento no mês</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Vale Alimentação (VA)</span>
            <Utensils size={18} className="text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white tracking-tight">
            R$ {calculatedTotals.va.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <p className="text-xs text-slate-500 mt-1">Devido apenas em jornadas superiores a 6h/dia</p>
        </div>

        <div className="bg-slate-900 border border-indigo-900/50 rounded-xl p-5 shadow-sm bg-gradient-to-br from-slate-900 to-indigo-950/30">
          <div className="flex items-center justify-between text-indigo-300 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Benefícios a Depositar</span>
            <Sparkles size={18} className="text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400 tracking-tight">
            R$ {calculatedTotals.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <p className="text-xs text-slate-400 mt-1">Valor consolidado antecipado da equipe</p>
        </div>
      </div>

      {/* Tabela de Depósitos por Colaborador */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-white">Relação Individual de Pagamento e Banco de Horas</h3>
            <p className="text-xs text-slate-400">Valores antecipados para depósito bancário ou cartão de benefícios</p>
          </div>
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors print:hidden"
          >
            <Printer size={15} />
            Imprimir Recibos / Relatório
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
                <th className="py-3 px-4">Colaborador</th>
                <th className="py-3 px-4">Função</th>
                <th className="py-3 px-4 text-center">Dias VT</th>
                <th className="py-3 px-4 text-right">Valor VT</th>
                <th className="py-3 px-4 text-center">Dias VA</th>
                <th className="py-3 px-4 text-right">Valor VA</th>
                <th className="py-3 px-4 text-right font-bold text-white">Total a Depositar</th>
                <th className="py-3 px-4 text-center">Banco de Horas (BH)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {scheduleData.summaries.map((s) => (
                <tr key={s.employee_id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="py-3 px-4 font-semibold text-slate-200">{s.employee_name}</td>
                  <td className="py-3 px-4 text-slate-400">{s.employee_role || 'Geral'}</td>
                  <td className="py-3 px-4 text-center text-slate-300">{s.vt_worked_days} dias</td>
                  <td className="py-3 px-4 text-right text-indigo-400 font-medium">R$ {s.total_vt_amount.toFixed(2)}</td>
                  <td className="py-3 px-4 text-center text-slate-300">{s.va_worked_days} dias</td>
                  <td className="py-3 px-4 text-right text-emerald-400 font-medium">R$ {s.total_va_amount.toFixed(2)}</td>
                  <td className="py-3 px-4 text-right font-bold text-white">R$ {s.total_benefits_amount.toFixed(2)}</td>
                  <td className="py-3 px-4 text-center">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                      s.bh_days_used >= s.bh_days_target
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                        : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                    }`}>
                      {s.bh_days_used} de {s.bh_days_target} folgas
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // ==============================================================================
  // --- [BLOCO: RENDERIZAÇÃO DA ABA MURAL DE DOMINGOS & HORÁRIOS] ---
  // ==============================================================================

  const renderSundayScheduleWall = () => {
    return (
      <div className="space-y-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <Clock className="text-indigo-400" size={20} />
                Escala de Domingos e Turnos (Abertura 07h-16h / Fechamento 09h-19h)
              </h3>
              <p className="text-xs text-slate-400">
                Programação para mural interno. Defina os horários de quem abre e quem fecha nos domingos e feriados.
              </p>
            </div>
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors print:hidden"
            >
              <Printer size={15} />
              Imprimir Mural
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {scheduleData.sundays.map((sunDay) => {
              const holidayName = scheduleData.holidays[sunDay];
              return (
                <div key={sunDay} className="bg-slate-950 border border-slate-800 rounded-lg p-4 shadow-sm">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
                    <span className="font-bold text-slate-200 text-sm">Domingo, {sunDay}/{selectedMonth}</span>
                    {holidayName && (
                      <span className="text-[10px] bg-sky-950 text-sky-400 border border-sky-800 px-1.5 py-0.5 rounded">
                        {holidayName}
                      </span>
                    )}
                  </div>

                  <div className="space-y-2">
                    {scheduleData.employees.map((emp) => {
                      const empDayInfo = localGrid[emp.id]?.TRANSPORTE?.[sunDay] || { status: 'OFF', shift: null };
                      const isWorking = empDayInfo.status === 'X';

                      return (
                        <div key={emp.id} className="flex items-center justify-between text-xs py-1 px-1.5 rounded hover:bg-slate-900/60">
                          <span className={`font-medium ${isWorking ? 'text-white' : 'text-slate-500'}`}>
                            {emp.name}
                          </span>

                          {isWorking ? (
                            <select
                              value={empDayInfo.shift || 'ABRE'}
                              onChange={(e) => handleShiftChange(emp.id, sunDay, 'TRANSPORTE', e.target.value)}
                              className="bg-slate-800 border border-slate-700 rounded text-[11px] text-slate-200 px-1.5 py-0.5 focus:outline-none focus:border-indigo-500"
                            >
                              <option value="ABRE">Abre (07h-16h)</option>
                              <option value="FECHA">Fecha (09h-19h)</option>
                              <option value="OUTRO">Outro Turno</option>
                            </select>
                          ) : (
                            <span className="text-[11px] text-slate-600 italic">Folga</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // ==============================================================================
  // --- [BLOCO: RENDERIZAÇÃO DA ABA EQUIPE & CONFIGURAÇÕES] ---
  // ==============================================================================

  const renderTeamAndSettings = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-white">Quadro de Colaboradores de RH</h3>
          <p className="text-xs text-slate-400">Configure as jornadas contratuais e os custos unitários de VT e VA</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setSettingsModalOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
          >
            Regras de RH (Domingos & Horas)
          </button>
          <button
            onClick={() => {
              setEditingEmployee(null);
              setEmployeeFormData({
                name: '',
                role: '',
                daily_transport_cost: settingsFormData.default_transport_cost,
                daily_meal_cost: settingsFormData.default_meal_cost,
                weekly_contract_hours: 44.0,
                weekly_actual_hours: 48.0,
                active: true
              });
              setEmployeeModalOpen(true);
            }}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors shadow-sm"
          >
            <Plus size={15} />
            Novo Colaborador
          </button>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
              <th className="py-3 px-4">Nome</th>
              <th className="py-3 px-4">Cargo / Função</th>
              <th className="py-3 px-4">VT Diário (R$)</th>
              <th className="py-3 px-4">VA Diário (R$)</th>
              <th className="py-3 px-4">Regime Semanal</th>
              <th className="py-3 px-4 text-center">Status</th>
              <th className="py-3 px-4 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {scheduleData.employees.map((emp) => (
              <tr key={emp.id} className="hover:bg-slate-800/30 transition-colors">
                <td className="py-3 px-4 font-semibold text-slate-200">{emp.name}</td>
                <td className="py-3 px-4 text-slate-400">{emp.role || 'Não informado'}</td>
                <td className="py-3 px-4 text-indigo-400 font-medium">R$ {(emp.daily_transport_cost || 0).toFixed(2)}</td>
                <td className="py-3 px-4 text-emerald-400 font-medium">R$ {(emp.daily_meal_cost || 0).toFixed(2)}</td>
                <td className="py-3 px-4 text-slate-400">44h contratual / 48h praticado (6x1)</td>
                <td className="py-3 px-4 text-center">
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    Ativo
                  </span>
                </td>
                <td className="py-3 px-4 text-right space-x-2">
                  <button
                    onClick={() => {
                      setEditingEmployee(emp);
                      setEmployeeFormData({
                        name: emp.name,
                        role: emp.role || '',
                        daily_transport_cost: emp.daily_transport_cost || 9.40,
                        daily_meal_cost: emp.daily_meal_cost || 25.00,
                        weekly_contract_hours: 44.0,
                        weekly_actual_hours: 48.0,
                        active: true
                      });
                      setEmployeeModalOpen(true);
                    }}
                    className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
                    title="Editar Colaborador"
                  >
                    <Edit2 size={15} />
                  </button>
                  <button
                    onClick={() => handleDeleteEmployee(emp.id)}
                    className="p-1.5 text-slate-400 hover:text-red-400 rounded hover:bg-slate-800 transition-colors"
                    title="Excluir Colaborador"
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  // ==============================================================================
  // --- [BLOCO: ESTADO DE CARREGAMENTO (SKELETON COMPLIANT COM AGENTS.MD)] ---
  // ==============================================================================

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton type="text" className="h-8 w-64" />
          <Skeleton type="text" className="h-8 w-40" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Skeleton type="card" />
          <Skeleton type="card" />
          <Skeleton type="card" />
        </div>
        <Skeleton type="table" rows={8} columns={10} />
      </div>
    );
  }

  // ==============================================================================
  // --- [BLOCO: INTERFACE PRINCIPAL] ---
  // ==============================================================================

  return (
    <div className="p-6 space-y-6">
      {/* Barra Superior de Controles de Mês/Ano & Ações */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4 print:hidden">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg p-1">
            <button
              onClick={() => {
                if (selectedMonth === 1) {
                  setSelectedMonth(12);
                  setSelectedYear((y) => y - 1);
                } else {
                  setSelectedMonth((m) => m - 1);
                }
              }}
              className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
              title="Mês Anterior"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="font-semibold text-sm text-slate-200 min-w-[130px] text-center">
              {MONTH_NAMES[selectedMonth - 1]} / {selectedYear}
            </span>
            <button
              onClick={() => {
                if (selectedMonth === 12) {
                  setSelectedMonth(1);
                  setSelectedYear((y) => y + 1);
                } else {
                  setSelectedMonth((m) => m + 1);
                }
              }}
              className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
              title="Próximo Mês"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="text-xs text-slate-400">
            Escala programada antecipadamente para cálculo de benefícios
          </div>
        </div>

        {/* Ações de Gravação e Impressão */}
        <div className="flex items-center gap-2.5">
          {saveSuccessMsg && (
            <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5 animate-fade-in">
              <CheckCircle2 size={16} />
              {saveSuccessMsg}
            </span>
          )}

          <button
            onClick={handleAutoFillStandard}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
            title="Preenche Seg-Sáb como Trabalho e Domingo como Folga"
          >
            <RefreshCw size={14} className={saving ? 'animate-spin' : ''} />
            Preencher Escala Padrão
          </button>

          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
          >
            <Printer size={14} />
            Imprimir
          </button>

          <button
            onClick={handleSaveSchedule}
            disabled={saving || !dirty}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all shadow-sm ${
              dirty 
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white ring-2 ring-indigo-500/30' 
                : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
            }`}
          >
            <Save size={14} />
            {saving ? 'Gravando...' : dirty ? 'Salvar Alterações' : 'Escala Salva'}
          </button>
        </div>
      </div>

      {/* Alertas Visuais de Domingos Consecutivos (Sem Bloqueio, Apenas Aviso) */}
      {scheduleData?.warnings && scheduleData.warnings.length > 0 && (
        <div className="space-y-2 print:hidden">
          {scheduleData.warnings.map((warn, idx) => (
            <div 
              key={idx}
              className={`flex items-start gap-3 p-3.5 rounded-lg border text-xs ${
                warn.type === 'CONSECUTIVE_SUNDAYS'
                  ? 'bg-amber-950/30 border-amber-500/40 text-amber-200'
                  : 'bg-indigo-950/30 border-indigo-500/40 text-indigo-200'
              }`}
            >
              <AlertTriangle size={18} className="shrink-0 mt-0.5 text-amber-400" />
              <div className="flex-1">
                <span className="font-semibold uppercase tracking-wider block text-[10px] text-amber-400 mb-0.5">
                  Aviso de Conformidade de Escala
                </span>
                {warn.message}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Navegação por Abas de Alta Coesão */}
      <div className="flex border-b border-slate-800 space-x-1 print:hidden">
        <button
          onClick={() => setActiveTab('transporte')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'transporte'
              ? 'border-indigo-500 text-white bg-slate-900/60'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
          }`}
        >
          <Bus size={16} />
          Transporte (VT)
        </button>

        <button
          onClick={() => setActiveTab('alimentacao')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'alimentacao'
              ? 'border-emerald-500 text-white bg-slate-900/60'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
          }`}
        >
          <Utensils size={16} />
          Alimentação (VA - Jornada &gt; 6h)
        </button>

        <button
          onClick={() => setActiveTab('resumo')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'resumo'
              ? 'border-indigo-500 text-white bg-slate-900/60'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
          }`}
        >
          <FileSpreadsheet size={16} />
          Resumo de Depósitos & Banco de Horas
        </button>

        <button
          onClick={() => setActiveTab('mural')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'mural'
              ? 'border-indigo-500 text-white bg-slate-900/60'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
          }`}
        >
          <Clock size={16} />
          Mural de Horários & Domingos
        </button>

        <button
          onClick={() => setActiveTab('equipe')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'equipe'
              ? 'border-indigo-500 text-white bg-slate-900/60'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
          }`}
        >
          <Users size={16} />
          Equipe & Parâmetros
        </button>
      </div>

      {/* Renderização do Conteúdo da Aba */}
      {activeTab === 'transporte' && renderScheduleGrid('TRANSPORTE')}
      {activeTab === 'alimentacao' && renderScheduleGrid('ALIMENTACAO')}
      {activeTab === 'resumo' && renderFinancialSummary()}
      {activeTab === 'mural' && renderSundayScheduleWall()}
      {activeTab === 'equipe' && renderTeamAndSettings()}

      {/* ============================================================================== */}
      {/* --- [BLOCO: MODAIS DE EDIÇÃO] --- */}
      {/* ============================================================================== */}

      {/* Modal de Colaborador */}
      {employeeModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-white">
              {editingEmployee ? 'Editar Colaborador' : 'Novo Colaborador'}
            </h3>
            <form onSubmit={handleSaveEmployee} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Nome Completo</label>
                <input
                  type="text"
                  required
                  value={employeeFormData.name}
                  onChange={(e) => setEmployeeFormData({ ...employeeFormData, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Cargo / Função</label>
                <input
                  type="text"
                  value={employeeFormData.role}
                  onChange={(e) => setEmployeeFormData({ ...employeeFormData, role: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Custo Diário VT (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={employeeFormData.daily_transport_cost}
                    onChange={(e) => setEmployeeFormData({ ...employeeFormData, daily_transport_cost: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Custo Diário VA (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={employeeFormData.daily_meal_cost}
                    onChange={(e) => setEmployeeFormData({ ...employeeFormData, daily_meal_cost: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEmployeeModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg text-slate-400 hover:text-white bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-500 text-white"
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Configurações de RH */}
      {settingsModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-white">Parâmetros e Regras de RH</h3>
            <form onSubmit={handleSaveSettings} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Máximo de Domingos Consecutivos (Aviso)</label>
                <input
                  type="number"
                  min="1"
                  max="4"
                  value={settingsFormData.max_consecutive_sundays}
                  onChange={(e) => setSettingsFormData({ ...settingsFormData, max_consecutive_sundays: parseInt(e.target.value, 10) || 2 })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
                <span className="text-[10px] text-slate-500">Emite aviso visual quando atingir este limite (sem bloqueio).</span>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Jornada Mínima para Direito a Refeição/VA (Horas)</label>
                <input
                  type="number"
                  step="0.5"
                  value={settingsFormData.min_daily_hours_for_meal}
                  onChange={(e) => setSettingsFormData({ ...settingsFormData, min_daily_hours_for_meal: parseFloat(e.target.value) || 6.0 })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
                <span className="text-[10px] text-slate-500">Pela CLT, refeição é devida para jornadas acima de 6 horas no dia.</span>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Folgas Compensatórias de Banco de Horas por Mês</label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={settingsFormData.compensatory_days_per_month}
                  onChange={(e) => setSettingsFormData({ ...settingsFormData, compensatory_days_per_month: parseInt(e.target.value, 10) || 2 })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
                <span className="text-[10px] text-slate-500">Meta mensal de dias 'BH' (Compensação 48h vs 44h contratuais = 16h/mês).</span>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setSettingsModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg text-slate-400 hover:text-white bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-500 text-white"
                >
                  Salvar Parâmetros
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
