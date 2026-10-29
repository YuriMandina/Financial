import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Users, Bus, Utensils, AlertTriangle, Calendar, Printer, 
  RefreshCw, Plus, Trash2, Edit2, CheckCircle2, Clock,
  ChevronLeft, ChevronRight, ShieldAlert, Sparkles, CalendarClock,
  UserPlus, AlertCircle, Briefcase, Settings2, HelpCircle, CalendarDays, Wallet, TrendingUp, Filter, Check, Eye, EyeOff
} from 'lucide-react';
import Skeleton from '../../components/common/Skeleton';
import RHJornadasTab from './components/RHJornadasTab';
import RHJornadaGrid from './components/RHJornadaGrid';
import RHBeneficiosGrid from './components/RHBeneficiosGrid';
import RHFeriadosView from './components/RHFeriadosView';
import RHFolhaPagamento from './components/RHFolhaPagamento';
import RHSalaryModal from './components/RHSalaryModal';
import RHBancoHorasView from './components/RHBancoHorasView';
import RHEmployeeProfileForm from './components/RHEmployeeProfileForm';
import RHFichaCadastral from './components/RHFichaCadastral';
import RHContratoJornada from './components/RHContratoJornada';
import RHAuditoriaMensal from './components/RHAuditoriaMensal';
import { PROFILE_TABS, profileCompleteness, TERMINATION_REASON_OPTIONS } from './components/employeeProfileSchema';
import StyledCheckbox from '../../components/common/StyledCheckbox';
import SelectDropdown from '../../components/common/SelectDropdown';
import { API_BASE } from '../../config/api';


// ==============================================================================
// --- [BLOCO: CONSTANTES & UTILITÁRIOS] ---
// ==============================================================================

// Abas do cadastro: a aba "Jornada" (contrato de jornada) fica logo após "Contrato"
const EMPLOYEE_TABS = [PROFILE_TABS[0], { key: 'jornada', label: 'Jornada' }, ...PROFILE_TABS.slice(1)];

// Hora compacta: "07:00" → "7", "07:30" → "7:30"
const compactTime = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':');
  return `${parseInt(h, 10)}${m && m !== '00' ? `:${m}` : ''}`;
};

// Tempo de casa e triênios completos a partir da data de admissão (YYYY-MM-DD)
const describeTenure = (admissionDate) => {
  const [y, m, d] = String(admissionDate).split('-').map(Number);
  if (!y || !m || !d) return '';
  const now = new Date();
  let years = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) years -= 1;
  if (years < 0) return '';
  const triennia = Math.floor(years / 3);
  const tenure = years === 0 ? 'Menos de 1 ano de casa' : `${years} ${years === 1 ? 'ano' : 'anos'} de casa`;
  return triennia > 0 ? `${tenure} • ${triennia} triênio(s)` : tenure;
};

// Aceita "3.000,50", "3000,50" e "3000.50"
const parseMoney = (value) => {
  const str = String(value ?? '').trim();
  if (!str) return 0;
  const normalized = str.includes(',') ? str.replace(/\./g, '').replace(',', '.') : str;
  return parseFloat(normalized) || 0;
};

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

export default function RHEscalasView({ token, onOpenCompanySettings }) {
  // ==============================================================================
  // --- [BLOCO: ESTADOS PRINCIPAIS] ---
  // ==============================================================================

  const today = new Date();
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1);
  const [activeTab, setActiveTab] = useState('jornada'); // 'jornada', 'transporte', 'alimentacao', 'resumo', 'folha_ponto', 'mural', 'equipe'
  
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [scheduleData, setScheduleData] = useState(null);
  const [workDays, setWorkDays] = useState({});
  const [benefitAdjustments, setBenefitAdjustments] = useState([]);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState('');
  const [selectedPrintEmpIds, setSelectedPrintEmpIds] = useState(null); // null = todos visíveis; Set/Array de IDs caso filtrado
  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
  const filterPopoverRef = useRef(null);

  // Modais de Cadastro
  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [employeeFormData, setEmployeeFormData] = useState({
    name: '',
    role_id: '',
    default_daily_transport_tickets: 2,
    daily_meal_cost: 25.00,
    base_salary: '0,00',
    dependents: 0,
    admission_date: '',
    termination_date: '',
    termination_reason: '',
    overtime_policy: '',
    profile: {},
    active: true
  });

  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [salaryModalTarget, setSalaryModalTarget] = useState(null); // id do cargo ou 'ALL'
  const [employeeTab, setEmployeeTab] = useState('contrato'); // aba do cadastro do colaborador
  const [fichaEmployeeId, setFichaEmployeeId] = useState(null); // ficha cadastral para impressão
  const [roleFormData, setRoleFormData] = useState({ name: '', description: '', base_salary: '' });

  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsFormData, setSettingsFormData] = useState({
    max_consecutive_sundays: 2,
    transport_ticket_unit_price: '4,70',
    default_meal_cost: '25,00',
    min_daily_hours_for_meal: 6.0,
    weekly_bank_overtime_hours: 4.0,
    compensatory_days_per_month: 2,
    time_rounding_minutes: 0,
    time_rounding_mode: 'NEAREST',
    clt_tolerance_enabled: true,
    absence_dsr_mode: 'ONE',
    overtime_policy: 'BANK',
    overtime_rate: '50',
    overtime_fixed_value: '0,00',
    compensation_regime: 'MONTHLY',
    week_start: 0,
    late_compensation_mode: 'AUTO',
    late_compensation_max_min: 30,
    late_compensation_max_per_month: 4,
    late_waiver_auto_min: 0
  });

  // ==============================================================================
  // --- [BLOCO: CARREGAMENTO DE DADOS (FETCH SEGURO)] ---
  // ==============================================================================

  // Irregularidade a destacar ao abrir a auditoria pelo aviso rápido da grade
  const [auditFocus, setAuditFocus] = useState(null);

  // Edições da grade de jornada ainda não salvas (evita perdê-las ao trocar de aba ou mês)
  const [jornadaDirty, setJornadaDirty] = useState(false);

  const confirmDiscardJornada = () => {
    if (!jornadaDirty) return true;
    const ok = window.confirm('Há alterações não salvas na Grade de Jornada (ex: faltas ou turnos). Descartar e continuar?');
    if (ok) setJornadaDirty(false);
    return ok;
  };

  const handleTabChange = (tab) => {
    if (tab === activeTab) return;
    if (activeTab === 'jornada' && !confirmDiscardJornada()) return;
    setActiveTab(tab);
  };

  useEffect(() => {
    if (!jornadaDirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [jornadaDirty]);

  // Mês já carregado: recargas (após salvar) acontecem em segundo plano, sem esqueleto,
  // para não desmontar a tela e preservar a posição do scroll
  const loadedPeriodRef = React.useRef(null);

  const fetchSchedule = async () => {
    const period = `${selectedYear}-${selectedMonth}`;
    const silent = loadedPeriodRef.current === period;
    try {
      if (!silent) setLoading(true);
      setFetchError(null);
      const res = await fetch(`${API_BASE}/api/rh/schedules?year=${selectedYear}&month=${selectedMonth}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        let errorDetail = `Status ${res.status}`;
        try {
          const errData = await res.json();
          if (errData && errData.detail) {
            errorDetail = typeof errData.detail === 'string' ? errData.detail : JSON.stringify(errData.detail);
          }
        } catch {
          const txt = await res.text();
          if (txt) errorDetail = txt.slice(0, 200);
        }
        throw new Error(`Erro na API de RH (${errorDetail})`);
      }
      const data = await res.json();
      loadedPeriodRef.current = period;
      setScheduleData(data);
      setWorkDays(data.work_days || {});
      setBenefitAdjustments(data.benefit_adjustments || []);
      if (data.settings) {
        setSettingsFormData({
          ...data.settings,
          transport_ticket_unit_price: Number(data.settings.transport_ticket_unit_price || 4.70).toFixed(2).replace('.', ','),
          default_meal_cost: Number(data.settings.default_meal_cost || 25.00).toFixed(2).replace('.', ','),
          default_transport_cost: Number(data.settings.default_transport_cost || 9.40).toFixed(2).replace('.', ','),
          time_rounding_minutes: data.settings.time_rounding_minutes ?? 0,
          time_rounding_mode: data.settings.time_rounding_mode || 'NEAREST',
          clt_tolerance_enabled: data.settings.clt_tolerance_enabled ?? true,
          absence_dsr_mode: data.settings.absence_dsr_mode || 'ONE',
          overtime_policy: data.settings.overtime_policy || 'BANK',
          overtime_rate: String(data.settings.overtime_rate ?? 50).replace('.', ','),
          overtime_fixed_value: Number(data.settings.overtime_fixed_value || 0).toFixed(2).replace('.', ',')
        });
      }
    } catch (err) {
      console.error('Falha ao carregar escala de RH:', err);
      setFetchError(err.message || 'Falha de comunicação com o servidor');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSchedule();
  }, [selectedYear, selectedMonth]);

  // ==============================================================================
  // --- [BLOCO: GESTÃO DE COLABORADORES E CARGOS] ---
  // ==============================================================================

  const handleSaveEmployee = async (e) => {
    e.preventDefault();
    if (!String(employeeFormData.name || '').trim()) {
      setEmployeeTab('contrato');
      alert('Informe o nome completo do colaborador.');
      return;
    }
    try {
      const url = editingEmployee 
        ? `${API_BASE}/api/rh/employees/${editingEmployee.id}` 
        : `${API_BASE}/api/rh/employees`;
      const method = editingEmployee ? 'PUT' : 'POST';

      const payload = {
        name: employeeFormData.name,
        role_id: employeeFormData.role_id ? parseInt(employeeFormData.role_id, 10) : null,
        default_daily_transport_tickets: Number.isNaN(parseInt(employeeFormData.default_daily_transport_tickets, 10)) ? 2 : parseInt(employeeFormData.default_daily_transport_tickets, 10),
        daily_meal_cost: parseFloat(String(employeeFormData.daily_meal_cost).replace(',', '.')) || 25.00,
        dependents: parseInt(employeeFormData.dependents, 10) || 0,
        admission_date: employeeFormData.admission_date || null,
        termination_date: employeeFormData.termination_date || null,
        termination_reason: (employeeFormData.termination_date && employeeFormData.termination_reason) || null,
        overtime_policy: employeeFormData.overtime_policy || null,
        profile: employeeFormData.profile || {},
        active: employeeFormData.active
      };

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error('Erro ao salvar colaborador');
      const saved = await res.json().catch(() => null);
      await fetchSchedule();
      if (!editingEmployee && saved?.id) {
        // Novo colaborador: segue para a aba de contrato de jornada
        setEditingEmployee(saved);
        setEmployeeTab('jornada');
        return;
      }
      setEmployeeModalOpen(false);
      setEditingEmployee(null);
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar colaborador.');
    }
  };

  const handleDeleteEmployee = async (empId) => {
    if (!window.confirm('Excluir este colaborador e suas escalas?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/rh/employees/${empId}`, {
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

  const handleSaveRole = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/api/rh/roles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ ...roleFormData, base_salary: parseMoney(roleFormData.base_salary) })
      });
      if (!res.ok) throw new Error('Erro ao criar cargo');
      const newRole = await res.json();
      setRoleModalOpen(false);
      setRoleFormData({ name: '', description: '', base_salary: '' });
      await fetchSchedule();
      if (employeeModalOpen) {
        setEmployeeFormData((prev) => ({ ...prev, role_id: newRole.id }));
      }
    } catch (err) {
      console.error(err);
      alert('Erro ao criar cargo.');
    }
  };

  const handleDeleteRole = async (roleId) => {
    if (!window.confirm('Excluir este cargo?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/rh/roles/${roleId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Erro ao excluir cargo');
      await fetchSchedule();
    } catch (err) {
      console.error(err);
      alert(err.message);
    }
  };



  const handleSaveSettings = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...settingsFormData,
        max_consecutive_sundays: parseInt(settingsFormData.max_consecutive_sundays, 10) || 2,
        transport_ticket_unit_price: parseFloat(String(settingsFormData.transport_ticket_unit_price).replace(',', '.')) || 4.70,
        default_meal_cost: parseFloat(String(settingsFormData.default_meal_cost).replace(',', '.')) || 25.00,
        min_daily_hours_for_meal: parseFloat(settingsFormData.min_daily_hours_for_meal) || 6.0,
        weekly_bank_overtime_hours: parseFloat(settingsFormData.weekly_bank_overtime_hours) || 4.0,
        compensatory_days_per_month: parseInt(settingsFormData.compensatory_days_per_month, 10) || 2,
        time_rounding_minutes: parseInt(settingsFormData.time_rounding_minutes, 10) || 0,
        time_rounding_mode: settingsFormData.time_rounding_mode || 'NEAREST',
        clt_tolerance_enabled: !!settingsFormData.clt_tolerance_enabled,
        absence_dsr_mode: settingsFormData.absence_dsr_mode || 'ONE',
        overtime_policy: settingsFormData.overtime_policy || 'BANK',
        overtime_rate: parseMoney(settingsFormData.overtime_rate),
        overtime_fixed_value: parseMoney(settingsFormData.overtime_fixed_value),
        compensation_regime: settingsFormData.compensation_regime || 'MONTHLY',
        week_start: parseInt(settingsFormData.week_start, 10) || 0,
        late_compensation_mode: settingsFormData.late_compensation_mode || 'AUTO',
        late_compensation_max_min: parseInt(settingsFormData.late_compensation_max_min, 10) || 0,
        late_compensation_max_per_month: parseInt(settingsFormData.late_compensation_max_per_month, 10) || 0,
        late_waiver_auto_min: parseInt(settingsFormData.late_waiver_auto_min, 10) || 0
      };
      const res = await fetch(`${API_BASE}/api/rh/settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
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

  const daysList = useMemo(() => {
    const numDays = scheduleData?.num_days || 31;
    return Array.from({ length: numDays }, (_, i) => i + 1);
  }, [scheduleData]);

  const employees = scheduleData?.employees || [];
  const sundays = scheduleData?.sundays || [];
  const holidays = scheduleData?.holidays || {};
  const summaries = scheduleData?.summaries || [];
  const roles = scheduleData?.roles || [];
  const ticketUnitPrice = scheduleData?.settings?.transport_ticket_unit_price || 4.70;

  // Lista de colaboradores filtrados para a visualização/impressão do mural
  const activePrintEmployees = useMemo(() => {
    if (!selectedPrintEmpIds) return employees;
    return employees.filter((e) => selectedPrintEmpIds.includes(e.id));
  }, [employees, selectedPrintEmpIds]);

  const handlePrint = () => {
    window.print();
  };

  // ==============================================================================
  // --- [BLOCO: RENDERIZAÇÃO DA ABA RESUMO FINANCEIRO & RECIBOS] ---
  // ==============================================================================

  const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const MONTH_LABELS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  // Agrupa os dias do mês em semanas (segunda a domingo)
  const monthWeeks = useMemo(() => {
    const weeks = [];
    let current = [];
    daysList.forEach((day) => {
      const weekday = new Date(selectedYear, selectedMonth - 1, day).getDay();
      current.push({ day, weekday });
      if (weekday === 0) {
        weeks.push(current);
        current = [];
      }
    });
    if (current.length) weeks.push(current);
    return weeks;
  }, [daysList, selectedYear, selectedMonth]);

  // Situação do dia para o mural. Faltas e atestados NÃO são expostos: aparecem
  // como dia normal de trabalho no horário do contrato (o mural é público).
  const getMuralDay = (emp, day) => {
    const jd = workDays[emp.id]?.[day];
    const cd = jd?.contract_day;
    const planned = cd && !cd.rest ? cd : null;
    const weekday = new Date(selectedYear, selectedMonth - 1, day).getDay();
    const isHoliday = !!holidays[day];
    const isSunday = weekday === 0;

    const workInfo = (src, special, specialType) => {
      const lunchStart = (src && src.lunch_start !== undefined) ? src.lunch_start : planned?.lunch_start;
      const lunchEnd = (src && src.lunch_end !== undefined) ? src.lunch_end : planned?.lunch_end;
      return {
        kind: 'WORK',
        start: src?.start_time,
        end: src?.end_time,
        lunchStart,
        lunchEnd,
        special,
        specialType
      };
    };

    if (!jd) return { kind: 'OFF', label: isSunday ? 'DSR' : 'Folga Semanal' };
    switch (jd.status) {
      case 'TRABALHO': {
        const timeDiff = !!planned && (jd.start_time !== planned.start_time || jd.end_time !== planned.end_time);
        const special = !planned || isSunday || isHoliday || timeDiff;
        let specialType = null;
        if (special) {
          if (isSunday) specialType = 'Domingo';
          else if (isHoliday) specialType = 'Feriado';
          else if (timeDiff) specialType = 'Horário Especial';
          else specialType = 'Extraordinário';
        }
        return workInfo(jd.start_time ? jd : planned, special, specialType);
      }
      case 'FALTA':
      case 'ATESTADO':
        return planned ? workInfo(planned, false, null) : { kind: 'OFF', label: isSunday ? 'DSR' : 'Folga Semanal' };
      case 'FOLGA_BH':
        return { kind: 'BH', label: 'Folga Banco de Horas' };
      case 'FERIADO':
        return { kind: 'FER', label: `Feriado (${holidays[day] || 'Descanso'})` };
      case 'FERIAS':
        return { kind: 'FE', label: 'Férias' };
      case 'DSR':
        return { kind: 'OFF', label: 'DSR' };
      case 'FOLGA':
        return { kind: 'OFF', label: isSunday ? 'DSR' : 'Folga Semanal' };
      default:
        return { kind: 'OFF', label: isSunday ? 'DSR' : 'Folga Semanal' };
    }
  };

  const MURAL_KIND_LABELS = {
    BH: { short: 'BH', label: 'Folga (banco de horas)' },
    OFF: { short: '-', label: 'Folga' },
    FER: { short: 'F', label: 'Feriado' },
    FE: { short: 'FE', label: 'Férias' }
  };

  const renderSundayScheduleWall = () => {
    const pad = (n) => String(n).padStart(2, '0');
    const mm = pad(selectedMonth);

    const isAllSelected = !selectedPrintEmpIds || selectedPrintEmpIds.length === employees.length;
    const selectedCount = selectedPrintEmpIds ? selectedPrintEmpIds.length : employees.length;

    const toggleEmpPrint = (id) => {
      const currentSelected = selectedPrintEmpIds ? [...selectedPrintEmpIds] : employees.map((e) => e.id);
      if (currentSelected.includes(id)) {
        setSelectedPrintEmpIds(currentSelected.filter((item) => item !== id));
      } else {
        setSelectedPrintEmpIds([...currentSelected, id]);
      }
    };

    const selectAllPrint = () => setSelectedPrintEmpIds(employees.map((e) => e.id));
    const clearAllPrint = () => setSelectedPrintEmpIds([]);

    // Grade do mês já resolvida + lista de horários especiais e folgas por colaborador
    const muralRows = activePrintEmployees.map((emp) => {
      const days = {};
      const specials = [];
      const folgas = [];
      daysList.forEach((day) => {
        const info = getMuralDay(emp, day);
        days[day] = info;
        const weekday = new Date(selectedYear, selectedMonth - 1, day).getDay();
        const isSunday = weekday === 0;

        if (info.kind === 'WORK') {
          if (info.special) {
            specials.push({
              day,
              weekday,
              isSunday,
              isHoliday: info.specialType === 'Feriado',
              tag: info.specialType,
              ...info
            });
          }
        } else if (info.kind === 'BH') {
          folgas.push({
            day,
            weekday,
            isBH: true,
            isSunday,
            label: info.label || 'Folga Banco de Horas'
          });
        } else if (info.kind === 'OFF') {
          folgas.push({
            day,
            weekday,
            isBH: false,
            isSunday,
            label: info.label || (isSunday ? 'DSR' : 'Folga Semanal')
          });
        } else if (info.kind === 'FER') {
          folgas.push({
            day,
            weekday,
            isBH: false,
            isSunday,
            isHoliday: true,
            label: info.label || 'Feriado'
          });
        }
      });
      return { emp, days, specials, folgas };
    });
    const rowsWithCards = muralRows.filter((r) => r.specials.length > 0 || r.folgas.length > 0);

    const formatTimes = (info) => {
      const s = info.start?.slice(0, 5) || '';
      const e = info.end?.slice(0, 5) || '';
      const ls = info.lunchStart?.slice(0, 5);
      const le = info.lunchEnd?.slice(0, 5);
      return `${s}–${e}${ls && le ? ` (alm ${ls}–${le})` : ''}`;
    };

    return (
      <div className="space-y-6">
        <style>{'@media print { @page { size: A4 landscape; margin: 4mm; } }'}</style>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm print:bg-white print:border-0 print:shadow-none print:p-0">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div>
              <h3 className="text-base font-semibold text-white flex items-center gap-2 print:text-black print:text-xl">
                <Clock className="text-indigo-400 print:hidden" size={20} />
                Mural de Horários — {MONTH_LABELS[selectedMonth - 1]} / {selectedYear}
              </h3>
              <p className="text-xs text-slate-400 print:text-slate-700">
                Programação diária de entrada, almoço e saída de todos os colaboradores.
                {!isAllSelected && (
                  <span className="ml-2 font-medium text-amber-400 print:hidden">
                    • Exibindo {selectedCount} de {employees.length} colaboradores
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 print:hidden relative">
              <div className="relative" ref={filterPopoverRef}>
                <button
                  type="button"
                  onClick={() => setFilterPopoverOpen(!filterPopoverOpen)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    isAllSelected
                      ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                      : 'bg-indigo-950/80 hover:bg-indigo-900/80 text-indigo-300 border-indigo-700/60'
                  }`}
                  title="Selecionar quais colaboradores aparecem no mural e na impressão"
                >
                  <Filter size={14} className={isAllSelected ? 'text-slate-400' : 'text-indigo-400'} />
                  <span>Filtrar Colaboradores</span>
                  <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-slate-900 text-slate-300 border border-slate-700">
                    {selectedCount}/{employees.length}
                  </span>
                </button>

                {filterPopoverOpen && (
                  <div className="absolute right-0 top-full mt-2 w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-3 z-50 text-slate-200">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Users size={14} className="text-indigo-400" /> Colaboradores no Mural
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {selectedCount} selecionado(s)
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mb-2">
                      <button
                        type="button"
                        onClick={selectAllPrint}
                        className="flex-1 py-1 px-2 rounded text-[10px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                      >
                        Marcar Todos
                      </button>
                      <button
                        type="button"
                        onClick={clearAllPrint}
                        className="flex-1 py-1 px-2 rounded text-[10px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-red-300 border border-slate-700 transition-colors"
                      >
                        Desmarcar Todos
                      </button>
                    </div>

                    <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
                      {employees.map((emp) => {
                        const checked = !selectedPrintEmpIds || selectedPrintEmpIds.includes(emp.id);
                        return (
                          <label
                            key={emp.id}
                            className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                              checked ? 'bg-slate-800/80 hover:bg-slate-800 text-white' : 'bg-transparent hover:bg-slate-800/40 text-slate-500'
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate pr-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleEmpPrint(emp.id)}
                                className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-0 cursor-pointer"
                              />
                              <span className="truncate text-[11px] font-medium">{emp.name}</span>
                            </div>
                            <span className="text-[9px] text-slate-500 shrink-0">
                              {emp.role || 'Geral'}
                            </span>
                          </label>
                        );
                      })}
                    </div>

                    <div className="pt-2.5 mt-2 border-t border-slate-800 flex justify-end">
                      <button
                        type="button"
                        onClick={() => setFilterPopoverOpen(false)}
                        className="px-3 py-1 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                      >
                        Concluído
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={handlePrint}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
              >
                <Printer size={15} />
                Imprimir Mural
              </button>
            </div>
          </div>

          {employees.length === 0 ? (
            <div className="text-center py-6 text-slate-500 italic">Sem colaboradores cadastrados.</div>
          ) : (
            <>
            {/* Versão compacta para impressão: mês inteiro em uma grade */}
            <table className="mural-print-table hidden print:table w-full border-collapse table-fixed text-[9px] leading-tight text-black">
              <colgroup>
                <col style={{ width: '34mm' }} />
                {daysList.map((day) => <col key={day} />)}
              </colgroup>
              <thead>
                <tr className="bg-slate-200">
                  <th className="text-left px-1.5 py-1 border border-slate-500 whitespace-nowrap">Colaborador</th>
                  {daysList.map((day) => {
                    const weekday = new Date(selectedYear, selectedMonth - 1, day).getDay();
                    const isRed = weekday === 0 || holidays[day];
                    return (
                      <th key={day} className={`px-0.5 py-1 text-center whitespace-nowrap border border-slate-500 font-semibold ${isRed ? 'bg-red-100' : ''}`}>
                        <div>{WEEKDAY_LABELS[weekday].charAt(0)}</div>
                        <div className="text-[9px]">{pad(day)}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {muralRows.map(({ emp, days }, empIdx) => (
                  <tr key={emp.id} className={`break-inside-avoid ${empIdx % 2 === 1 ? 'bg-slate-100' : 'bg-white'}`}>
                    <td className="px-1.5 py-1 border border-slate-500 max-w-[34mm] truncate">
                      <div className="font-bold text-[9.5px] whitespace-nowrap truncate">{emp.name}</div>
                    </td>
                    {daysList.map((day) => {
                      const weekday = new Date(selectedYear, selectedMonth - 1, day).getDay();
                      const info = days[day];
                      const isWork = info.kind === 'WORK';
                      const isBH = info.kind === 'BH';
                      return (
                        <td
                          key={day}
                          className={`px-0 py-1 text-center border border-slate-500 whitespace-nowrap ${
                            isWork ? '' : isBH ? 'font-bold text-slate-800' : 'italic text-slate-500'
                          }`}
                        >
                          {isWork ? (
                            <div className="flex flex-col items-center justify-center leading-tight">
                              <span className="font-bold">
                                {`${compactTime(info.start)}\u2011${compactTime(info.end)}${info.special ? '*' : ''}`}
                              </span>
                              {info.lunchStart && info.lunchEnd ? (
                                <span className="text-[6.5pt] font-normal text-slate-600 block tracking-tight">
                                  {`${compactTime(info.lunchStart)}\u2011${compactTime(info.lunchEnd)}`}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            MURAL_KIND_LABELS[info.kind].short
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Legenda Estruturada em Badges para Impressão */}
            <div className="hidden print:block mt-2.5 text-[8.5px] text-slate-800 space-y-1.5 break-inside-avoid">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-bold text-[8px] uppercase tracking-wider text-slate-600 mr-0.5">Legenda:</span>
                
                {/* Badge Códigos */}
                <div className="border border-slate-400 bg-slate-50 rounded px-1.5 py-0.5 whitespace-nowrap">
                  <span className="font-bold text-slate-900">-</span>
                  <span className="ml-1 text-slate-700">Folga</span>
                </div>

                <div className="border border-slate-500 bg-slate-200 rounded px-1.5 py-0.5 whitespace-nowrap">
                  <span className="font-bold text-slate-900">BH</span>
                  <span className="ml-1 text-slate-700">Folga (banco de horas)</span>
                </div>

                <div className="border border-red-300 bg-red-50 rounded px-1.5 py-0.5 whitespace-nowrap text-red-950">
                  <span className="font-bold text-red-700">F</span>
                  <span className="ml-1">Feriado</span>
                </div>

                <div className="border border-slate-400 bg-slate-50 rounded px-1.5 py-0.5 whitespace-nowrap">
                  <span className="font-bold text-slate-900">FE</span>
                  <span className="ml-1 text-slate-700">Férias</span>
                </div>

                <div className="border border-slate-500 bg-white rounded px-1.5 py-0.5 whitespace-nowrap">
                  <span className="font-bold text-slate-900">*</span>
                  <span className="ml-1 text-slate-700">Horário Especial / Domingo / Feriado (detalhes abaixo)</span>
                </div>

                {/* Badge Leitura da Célula */}
                <div className="border border-indigo-300 bg-indigo-50/70 text-indigo-950 rounded px-1.5 py-0.5 whitespace-nowrap">
                  <span className="font-bold font-mono">7‑16 / alm 12‑13</span>
                  <span className="mx-1 text-slate-400">|</span>
                  <span>Topo: Entrada–Saída · Base: Almoço</span>
                </div>
              </div>

              {/* Badges de Feriados */}
              {Object.keys(holidays).length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="font-bold text-[8px] uppercase tracking-wider text-red-700 mr-0.5">Feriados:</span>
                  {Object.entries(holidays).map(([d, n]) => {
                    const hDay = parseInt(d, 10);
                    const hWeekday = new Date(selectedYear, selectedMonth - 1, hDay).getDay();
                    return (
                      <div key={d} className="border border-red-200 bg-red-50/80 rounded px-1.5 py-0.5 whitespace-nowrap text-red-950">
                        <span className="font-bold text-red-700">{pad(d)}/{mm} {WEEKDAY_LABELS[hWeekday]}</span>
                        <span className="mx-1 text-red-300">|</span>
                        <span>{n}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {rowsWithCards.length > 0 && (
              <div className="hidden print:block mt-3 text-black">
                <div className="font-bold text-[10px] uppercase tracking-wide mb-1.5 border-b border-black pb-0.5 flex items-center justify-between">
                  <span>* Programação de Horários Especiais e Folgas por Colaborador</span>
                  <span className="text-[8px] font-normal normal-case text-slate-600">
                    Mês de {MONTH_LABELS[selectedMonth - 1]} / {selectedYear}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {rowsWithCards.map(({ emp, specials, folgas }) => (
                    <div
                      key={emp.id}
                      className="mural-special-card border border-slate-500 rounded-md p-2 bg-white break-inside-avoid shadow-none"
                    >
                      <div className="font-bold text-[9.5px] text-black border-b border-slate-300 pb-1 mb-1.5 flex items-center justify-between">
                        <span>{emp.name}</span>
                        <span className="text-[7.5px] font-normal text-slate-600">
                          {specials.length} especial(is) · {folgas.length} folga(s)
                        </span>
                      </div>

                      {specials.length > 0 && (
                        <div className="mb-1.5">
                          <div className="text-[7px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">
                            Jornadas Especiais, Domingos e Feriados:
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {specials.map((s) => (
                              <div
                                key={s.day}
                                className={`border rounded px-1.5 py-0.5 text-[8px] whitespace-nowrap leading-tight ${
                                  s.isSunday || s.isHoliday
                                    ? 'border-red-400 bg-red-50 text-red-950 font-semibold'
                                    : 'border-slate-400 bg-white'
                                }`}
                              >
                                <span className="font-bold">{pad(s.day)}/{mm}</span>{' '}
                                {WEEKDAY_LABELS[s.weekday]}
                                <span className="mx-1 text-slate-400">|</span>
                                <span className="font-mono">{formatTimes(s)}</span>
                                {s.tag && (
                                  <span className="ml-1 text-[7px] font-semibold px-1 py-0.2 rounded bg-slate-200 text-slate-800">
                                    {s.tag}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {folgas.length > 0 && (
                        <div>
                          <div className="text-[7px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">
                            Folgas Programadas:
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {folgas.map((f) => (
                              <div
                                key={f.day}
                                className={`border rounded px-1.5 py-0.5 text-[8px] whitespace-nowrap leading-tight ${
                                  f.isBH
                                    ? 'border-slate-500 bg-slate-200 font-semibold text-slate-900'
                                    : f.isSunday
                                      ? 'border-red-300 bg-red-50 text-red-900'
                                      : 'border-slate-300 bg-slate-50 text-slate-800'
                                }`}
                              >
                                <span className="font-bold">{pad(f.day)}/{mm}</span>{' '}
                                {WEEKDAY_LABELS[f.weekday]}
                                <span className="mx-1 text-slate-400">|</span>
                                <span>{f.label}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-6 print:hidden">
              {monthWeeks.map((week, wIdx) => (
                <section key={wIdx}>
                  <h4 className="text-sm font-bold text-slate-200 mb-2">
                    Semana {wIdx + 1}
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      {pad(week[0].day)}/{mm} a {pad(week[week.length - 1].day)}/{mm}
                    </span>
                  </h4>
                  <div className="overflow-x-auto rounded-lg border border-slate-800">
                    <table className="w-full text-xs border-collapse table-fixed">
                      <thead>
                        <tr className="bg-slate-950">
                          <th className="w-40 text-left px-2 py-1.5 text-slate-300 font-semibold border-r border-slate-800">
                            Colaborador
                          </th>
                          {week.map(({ day, weekday }) => {
                            const holidayName = holidays[day];
                            return (
                              <th
                                key={day}
                                className={`px-1 py-1.5 text-center font-semibold border-r border-slate-800 ${
                                  weekday === 0 || holidayName ? 'text-red-300 bg-red-950/20' : 'text-slate-300'
                                }`}
                              >
                                <div>{WEEKDAY_LABELS[weekday]} {pad(day)}/{mm}</div>
                                {holidayName && <div className="text-[9px] font-normal text-sky-400 truncate">{holidayName}</div>}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {muralRows.map(({ emp, days }) => (
                          <tr key={emp.id} className="border-t border-slate-800">
                            <td className="px-2 py-1.5 border-r border-slate-800 align-top">
                              <div className="font-semibold text-white truncate">{emp.name}</div>
                              <div className="text-[10px] text-slate-500 truncate">{emp.role || 'Geral'}</div>
                            </td>
                            {week.map(({ day, weekday }) => {
                              const info = days[day];
                              return (
                                <td
                                  key={day}
                                  className={`px-1 py-1 text-center align-top border-r border-slate-800 ${
                                    info.kind === 'BH' ? 'bg-amber-500/10' : weekday === 0 ? 'bg-red-950/10' : ''
                                  }`}
                                >
                                  {info.kind === 'WORK' ? (
                                    <div className="space-y-0.5">
                                      {info.start && (
                                        <div className={`font-mono text-[10px] leading-tight ${info.special ? 'text-amber-300 font-bold' : 'text-slate-200'}`}>
                                          {info.start}–{info.end}
                                        </div>
                                      )}
                                      {info.lunchStart && (
                                        <div className="font-mono text-[9px] text-slate-400 leading-tight">
                                          alm {info.lunchStart}–{info.lunchEnd}
                                        </div>
                                      )}
                                      {info.special && (
                                        <div className="text-[9px] text-amber-400 font-semibold">horário especial</div>
                                      )}
                                    </div>
                                  ) : (
                                    <span className={`text-[10px] font-medium ${info.kind === 'BH' ? 'text-amber-300 font-bold' : 'italic text-slate-500'}`}>
                                      {MURAL_KIND_LABELS[info.kind].label}
                                    </span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
            </>
          )}
        </div>
      </div>
    );
  };

  // ==============================================================================
  // --- [BLOCO: RENDERIZAÇÃO DA ABA EQUIPE, CARGOS & PARÂMETROS] ---
  // ==============================================================================

  const renderTeamAndSettings = () => (
    <div className="space-y-6">
      {/* Cabeçalho da Equipe */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-white">Quadro de Colaboradores de RH</h3>
          <p className="text-xs text-slate-400">Cadastro, contrato de jornada, VT e VA individual</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setRoleModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
          >
            <Briefcase size={14} />
            + Cargo
          </button>
          <button
            onClick={() => setSettingsModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
          >
            <Settings2 size={14} />
            Regras de RH & VT Universal
          </button>
          <button
            onClick={() => setSalaryModalTarget('ALL')}
            disabled={roles.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 transition-colors disabled:opacity-50"
          >
            <TrendingUp size={14} />
            Salários por Cargo
          </button>
          <button
            onClick={() => {
              setEditingEmployee(null);
              setEmployeeFormData({
                name: '',
                role_id: roles[0]?.id || '',
                default_daily_transport_tickets: 2,
                daily_meal_cost: '25,00',
                base_salary: '0,00',
                dependents: 0,
                admission_date: '',
                termination_date: '',
                termination_reason: '',
                overtime_policy: '',
                profile: {},
                active: true
              });
              setEmployeeTab('contrato');
              setEmployeeModalOpen(true);
            }}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors shadow-sm"
          >
            <Plus size={15} />
            Novo Colaborador
          </button>
        </div>
      </div>

      {/* Tabela de Colaboradores */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
              <th className="py-3 px-4">Nome</th>
              <th className="py-3 px-4">Cargo</th>
              <th className="py-3 px-4">Contrato de Jornada</th>
              <th className="py-3 px-4 text-right">Salário</th>
              <th className="py-3 px-4">Aditivo</th>
              <th className="py-3 px-4 text-center">VT Diário</th>
              <th className="py-3 px-4 text-right">VA Diário</th>
              <th className="py-3 px-4 text-center">Status</th>
              <th className="py-3 px-4 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {employees.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-slate-500">
                  Nenhum colaborador cadastrado. Clique no botão acima para adicionar.
                </td>
              </tr>
            ) : (
              employees.map((emp) => {
                return (
                  <tr key={emp.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4 font-semibold text-slate-200">
                      {emp.name}
                      {(() => {
                        const c = profileCompleteness(emp.profile);
                        return c.filled < c.total ? (
                          <span className="ml-2 text-[10px] font-normal text-amber-300" title="Dados essenciais da ficha cadastral preenchidos">
                            ficha {c.filled}/{c.total}
                          </span>
                        ) : null;
                      })()}
                    </td>
                    <td className="py-3 px-4 text-slate-300">
                      <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 font-medium text-[11px]">
                        {emp.role || 'Geral'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {emp.contract ? (
                        <span className="text-slate-300">{emp.contract.summary}</span>
                      ) : (
                        <span className="text-amber-400 text-[11px]">Sem contrato de jornada</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-200 font-medium whitespace-nowrap">
                      {Number(emp.base_salary || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </td>
                    <td className="py-3 px-4">
                      {!emp.contract ? (
                        <span className="text-slate-600">-</span>
                      ) : emp.contract.amendment_signed ? (
                        <span className="text-[11px] text-emerald-400">Assinado</span>
                      ) : (
                        <span className="text-[11px] text-amber-300" title="Alteração contratual sem aditivo (CLT art. 468)">Pendente</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center text-indigo-400 font-medium">
                      {emp.default_daily_transport_tickets === 0 ? 'Sem vale transporte' : `${emp.default_daily_transport_tickets} passagens (R$ ${(emp.default_daily_transport_tickets * ticketUnitPrice).toFixed(2)})`}
                    </td>
                    <td className="py-3 px-4 text-right text-emerald-400 font-medium">
                      R$ {(emp.daily_meal_cost || 25).toFixed(2)}
                    </td>
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
                            role_id: emp.role_id || '',
                            default_daily_transport_tickets: emp.default_daily_transport_tickets ?? 2,
                            daily_meal_cost: Number(emp.daily_meal_cost ?? 25.00).toFixed(2).replace('.', ','),
                            base_salary: Number(emp.base_salary || 0).toFixed(2).replace('.', ','),
                            dependents: emp.dependents || 0,
                            admission_date: emp.admission_date || '',
                            termination_date: emp.termination_date || '',
                            termination_reason: emp.termination_reason || '',
                            overtime_policy: emp.overtime_policy || '',
                            profile: emp.profile || {},
                            active: true
                          });
                          setEmployeeTab('contrato');
              setEmployeeModalOpen(true);
                        }}
                        className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
                        title="Editar Colaborador"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        onClick={() => {
                          if (!emp.role_id) {
                            alert('Colaborador sem cargo: o salário é definido pelo cargo. Defina o cargo primeiro.');
                            return;
                          }
                          setSalaryModalTarget(emp.role_id);
                        }}
                        className="p-1.5 text-slate-400 hover:text-emerald-400 rounded hover:bg-slate-800 transition-colors"
                        title="Salário do cargo: aumento e histórico"
                      >
                        <TrendingUp size={15} />
                      </button>
                      <button
                        onClick={() => setFichaEmployeeId(emp.id)}
                        className="p-1.5 text-slate-400 hover:text-indigo-300 rounded hover:bg-slate-800 transition-colors"
                        title="Imprimir Ficha Cadastral"
                      >
                        <Printer size={15} />
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
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Cargos Cadastrados */}
      <div className="grid grid-cols-1 gap-4">
        {/* Card de Cargos */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h4 className="text-sm font-semibold text-white flex items-center gap-2">
              <Briefcase size={16} className="text-indigo-400" />
              Cargos Cadastrados ({roles.length})
            </h4>
            <button
              onClick={() => setRoleModalOpen(true)}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold"
            >
              + Novo Cargo
            </button>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {roles.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-2">Nenhum cargo cadastrado ainda.</p>
            ) : (
              roles.map((r) => (
                <div key={r.id} className="flex items-center justify-between py-1.5 px-2 rounded bg-slate-950 text-xs">
                  <div>
                    <span className="font-semibold text-slate-200">{r.name}</span>
                    <span className="text-slate-500 text-[11px] block">
                      {Number(r.base_salary || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} • {r.employee_count || 0} colaborador(es)
                    </span>
                  </div>
                  <div className="flex items-center">
                    <button
                      onClick={() => setSalaryModalTarget(r.id)}
                      className="text-slate-500 hover:text-emerald-400 p-1"
                      title="Salário do cargo: aumento e histórico"
                    >
                      <TrendingUp size={13} />
                    </button>
                    <button
                      onClick={() => handleDeleteRole(r.id)}
                      disabled={r.employee_count > 0}
                      className="text-slate-500 hover:text-red-400 p-1 disabled:opacity-30 disabled:cursor-not-allowed"
                      title={r.employee_count > 0 ? 'Cargo em uso: altere o cargo dos colaboradores antes de excluir' : 'Remover cargo'}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );

  // ==============================================================================
  // --- [BLOCO: ESTADO DE CARREGAMENTO & ERRO] ---
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

  if (fetchError || !scheduleData) {
    return (
      <div className="p-6 max-w-lg mx-auto my-12 text-center bg-slate-900 border border-slate-800 rounded-xl p-8 space-y-4">
        <div className="w-12 h-12 rounded-full bg-red-500/20 text-red-400 mx-auto flex items-center justify-center">
          <AlertCircle size={24} />
        </div>
        <h3 className="text-base font-bold text-white">Falha ao Conectar com o Departamento Pessoal</h3>
        <p className="text-xs text-slate-400">
          {fetchError || 'Não foi possível carregar as informações da escala no momento.'}
        </p>
        <button
          onClick={fetchSchedule}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
        >
          <RefreshCw size={14} />
          Tentar Novamente
        </button>
      </div>
    );
  }

  // ==============================================================================
  // --- [BLOCO: INTERFACE PRINCIPAL] ---
  // ==============================================================================

  const compliance = scheduleData?.compliance || null;
  const COMPLIANCE_STATUS = {
    PENDENTE: 'auditoria PENDENTE',
    REABERTA: 'auditoria REABERTA',
    APROVADA: 'auditoria APROVADA'
  };

  const openAudit = (fingerprint = null) => {
    setAuditFocus(fingerprint);
    handleTabChange('auditoria');
  };

  return (
    <div className="p-6 space-y-6">
      {/* Barra Superior de Controles de Mês/Ano & Ações */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4 print:hidden">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg p-1">
            <button
              onClick={() => {
                if (!confirmDiscardJornada()) return;
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
                if (!confirmDiscardJornada()) return;
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
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
          >
            <Printer size={14} />
            Imprimir
          </button>

        </div>
      </div>

      {/* Faixa curta com a situação da auditoria do mês (o detalhe fica na aba Auditoria) */}
      {compliance && compliance.total > 0 && (
        <button
          type="button"
          onClick={() => openAudit()}
          className={`w-full flex items-center gap-3 p-3 rounded-lg border text-xs text-left print:hidden ${
            compliance.pending > 0
              ? 'bg-amber-950/30 border-amber-500/40 text-amber-200 hover:bg-amber-950/50'
              : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800/60'
          }`}
        >
          <ShieldAlert size={16} className={compliance.pending > 0 ? 'text-amber-400' : 'text-emerald-400'} />
          <span className="flex-1">
            {MONTH_NAMES[selectedMonth - 1]}/{selectedYear}: {compliance.total} irregularidade(s)
            {' '}({compliance.critical} crítica(s) · {compliance.alert} alerta(s)) · {COMPLIANCE_STATUS[compliance.status] || compliance.status}
            {compliance.pending > 0 ? ` · ${compliance.pending} pendente(s)` : ''}
          </span>
          <span className="font-semibold underline">Abrir auditoria</span>
        </button>
      )}

      {/* Navegação por Abas de Alta Coesão */}
      <div className="flex border-b border-slate-800 space-x-1 print:hidden">
        <button
          onClick={() => handleTabChange('jornada')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'jornada'
              ? 'border-indigo-500 text-white bg-slate-900/60'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
          }`}
        >
          <Clock size={16} />
          Escala & Jornada Diária
        </button>

        <button
          onClick={() => handleTabChange('transporte')}
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
          onClick={() => handleTabChange('alimentacao')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'alimentacao'
              ? 'border-emerald-500 text-white bg-slate-900/60'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
          }`}
        >
          <Utensils size={16} />
          Alimentação (VA)
        </button>

        <button
          onClick={() => handleTabChange('resumo')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'resumo'
              ? 'border-indigo-500 text-white bg-slate-900/60'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
          }`}
        >
          <Clock size={16} />
          Banco de Horas
        </button>

        <button
          onClick={() => handleTabChange('folha_ponto')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'folha_ponto'
              ? 'border-indigo-500 text-white bg-slate-900/60'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
          }`}
        >
          <Printer size={16} />
          Folhas de Ponto Físicas
        </button>

        <button
          onClick={() => handleTabChange('mural')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'mural'
              ? 'border-indigo-500 text-white bg-slate-900/60'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
          }`}
        >
          <Clock size={16} />
          Mural de Horários & Turnos
        </button>

        <button
          onClick={() => handleTabChange('equipe')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'equipe'
              ? 'border-indigo-500 text-white bg-slate-900/60'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
          }`}
        >
          <Users size={16} />
          Equipe, Cargos & Parâmetros
        </button>

        <button
          onClick={() => handleTabChange('feriados')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'feriados'
              ? 'border-indigo-500 text-white bg-slate-900/60'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
          }`}
        >
          <CalendarDays size={16} />
          Feriados & Folgas
        </button>

        <button
          onClick={() => handleTabChange('folha')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'folha'
              ? 'border-indigo-500 text-white bg-slate-900/60'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
          }`}
        >
          <Wallet size={16} />
          Folha de Pagamento
        </button>

        <button
          onClick={() => openAudit()}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'auditoria'
              ? 'border-indigo-500 text-white bg-slate-900/60'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
          }`}
        >
          <ShieldAlert size={16} />
          Auditoria
          {compliance?.pending > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40">
              {compliance.pending}
            </span>
          )}
        </button>
      </div>

      {/* Renderização do Conteúdo da Aba */}
      {activeTab === 'jornada' && (
        <RHJornadaGrid
          key={`${selectedYear}-${selectedMonth}`}
          onDirtyChange={setJornadaDirty}
          onOpenAudit={openAudit}
          complianceDays={compliance?.days || {}}
          absenceDsrMode={scheduleData?.settings?.absence_dsr_mode || 'ONE'}
          maxConsecutiveSundays={scheduleData?.settings?.max_consecutive_sundays ?? 2}
          priorSundayDates={scheduleData?.prior_sunday_dates || []}
          employees={employees}
          workDays={workDays}
          daysList={daysList}
          sundays={sundays}
          holidays={holidays}
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          scheduleId={scheduleData?.schedule_id}
          token={token}
          apiBase={API_BASE}
          onRefresh={fetchSchedule}
          summaries={summaries}
        />
      )}
      {activeTab === 'transporte' && (
        <RHBeneficiosGrid
          type="VT"
          employees={employees}
          workDays={workDays}
          benefitAdjustments={benefitAdjustments}
          daysList={daysList}
          sundays={sundays}
          holidays={holidays}
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          scheduleId={scheduleData?.schedule_id}
          ticketUnitPrice={ticketUnitPrice}
          token={token}
          apiBase={API_BASE}
          onRefresh={fetchSchedule}
          summaries={summaries}
        />
      )}
      {activeTab === 'alimentacao' && (
        <RHBeneficiosGrid
          type="VA"
          employees={employees}
          workDays={workDays}
          benefitAdjustments={benefitAdjustments}
          daysList={daysList}
          sundays={sundays}
          holidays={holidays}
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          scheduleId={scheduleData?.schedule_id}
          token={token}
          apiBase={API_BASE}
          onRefresh={fetchSchedule}
          summaries={summaries}
        />
      )}
      {activeTab === 'folha_ponto' && (
        <RHJornadasTab
          loading={loading}
          employees={employees}
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          numDays={scheduleData?.num_days || 31}
          sundays={sundays}
          holidays={holidays}
          workDays={workDays}
          company={scheduleData?.settings?.company || {}}
          onOpenCompanySettings={onOpenCompanySettings}
          onEditEmployee={(emp) => {
            setEditingEmployee(emp);
            setEmployeeFormData({
              name: emp.name,
              role_id: emp.role_id || '',
              default_daily_transport_tickets: emp.default_daily_transport_tickets ?? 2,
              daily_meal_cost: Number(emp.daily_meal_cost ?? 25.00).toFixed(2),
              base_salary: Number(emp.base_salary || 0).toFixed(2).replace('.', ','),
              dependents: emp.dependents || 0,
              admission_date: emp.admission_date || '',
              termination_date: emp.termination_date || '',
              termination_reason: emp.termination_reason || '',
              overtime_policy: emp.overtime_policy || '',
              profile: emp.profile || {},
              active: true
            });
            setEmployeeTab('jornada');
              setEmployeeModalOpen(true);
          }}
        />
      )}
      {activeTab === 'resumo' && (
        <RHBancoHorasView
          token={token}
          apiBase={API_BASE}
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
        />
      )}
      {activeTab === 'mural' && renderSundayScheduleWall()}
      {activeTab === 'equipe' && renderTeamAndSettings()}
      {activeTab === 'folha' && (
        <RHFolhaPagamento
          token={token}
          apiBase={API_BASE}
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
        />
      )}
      {activeTab === 'auditoria' && (
        <RHAuditoriaMensal
          token={token}
          apiBase={API_BASE}
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          scheduleId={scheduleData?.schedule_id}
          focusFingerprint={auditFocus}
          employees={employees}
          onChanged={fetchSchedule}
        />
      )}
      {activeTab === 'feriados' && (
        <RHFeriadosView
          token={token}
          apiBase={API_BASE}
          onRefreshSchedule={fetchSchedule}
        />
      )}

      {/* ============================================================================== */}
      {/* --- [BLOCO: MODAIS DE EDIÇÃO] --- */}
      {/* ============================================================================== */}

      {salaryModalTarget !== null && (
        <RHSalaryModal
          token={token}
          apiBase={API_BASE}
          roles={roles}
          target={salaryModalTarget}
          onClose={() => setSalaryModalTarget(null)}
          onSaved={async (message) => {
            await fetchSchedule();
            setSaveSuccessMsg(message);
            setTimeout(() => setSaveSuccessMsg(''), 4000);
          }}
        />
      )}

      {fichaEmployeeId !== null && (() => {
        const emp = employees.find((e) => e.id === fichaEmployeeId);
        return (
          <RHFichaCadastral
            employee={emp}
            roleName={emp?.role}
            organizationName={scheduleData?.organization_name}
            onClose={() => setFichaEmployeeId(null)}
          />
        );
      })()}

      {/* Modal de Colaborador */}
      {employeeModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-3xl w-full p-6 shadow-xl space-y-4 max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-white">
                {editingEmployee ? `Editar Colaborador • ${editingEmployee.name}` : 'Novo Colaborador'}
              </h3>
              {(() => {
                const c = profileCompleteness(employeeFormData.profile);
                return (
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
                    c.filled === c.total ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' : 'text-amber-300 border-amber-500/40 bg-amber-500/10'
                  }`}>
                    Ficha: {c.filled}/{c.total} dados essenciais
                  </span>
                );
              })()}
            </div>
            <div className="flex gap-1 overflow-x-auto border-b border-slate-800 -mx-1 px-1">
              {EMPLOYEE_TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setEmployeeTab(t.key)}
                  className={`px-3 py-2 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
                    employeeTab === t.key ? 'border-indigo-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <form onSubmit={handleSaveEmployee} className="space-y-3.5 text-xs overflow-y-auto pr-1 flex-1">
              {employeeTab === 'jornada' && (
                editingEmployee ? (
                  <RHContratoJornada
                    token={token}
                    apiBase={API_BASE}
                    employee={editingEmployee}
                    weekStart={scheduleData?.settings?.week_start || 0}
                    onChanged={fetchSchedule}
                  />
                ) : (
                  <p className="text-slate-400">Salve o colaborador para definir o contrato de jornada.</p>
                )
              )}
              {employeeTab !== 'contrato' && employeeTab !== 'jornada' && (
                <RHEmployeeProfileForm
                  sectionKey={employeeTab}
                  profile={employeeFormData.profile || {}}
                  onChange={(profile) => setEmployeeFormData({ ...employeeFormData, profile })}
                />
              )}
              {employeeTab === 'contrato' && (
              <>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
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
                  <label className="block text-slate-400 mb-1">Data de Admissão</label>
                  <input
                    type="date"
                    value={employeeFormData.admission_date || ''}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setEmployeeFormData({ ...employeeFormData, admission_date: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 [color-scheme:dark]"
                  />
                  {employeeFormData.admission_date && (
                    <span className="text-[10px] text-slate-500">{describeTenure(employeeFormData.admission_date)}</span>
                  )}
                </div>
              </div>

              {editingEmployee && (
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-400 mb-1">Data de Desligamento</label>
                    <input
                      type="date"
                      value={employeeFormData.termination_date || ''}
                      min={employeeFormData.admission_date || undefined}
                      onChange={(e) => setEmployeeFormData({ ...employeeFormData, termination_date: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 [color-scheme:dark]"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-slate-400 mb-1">Motivo do Desligamento</label>
                    <SelectDropdown
                      value={employeeFormData.termination_reason}
                      disabled={!employeeFormData.termination_date}
                      onChange={(val) => setEmployeeFormData({ ...employeeFormData, termination_reason: val })}
                      placeholder={employeeFormData.termination_date ? 'Selecione o motivo...' : 'Informe a data primeiro'}
                      options={TERMINATION_REASON_OPTIONS}
                    />
                    {employeeFormData.termination_date && (
                      <span className="text-[10px] text-slate-500">
                        Continua na folha do mês do desligamento e entra no informe à contabilidade.
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-slate-400">Cargo</label>
                    <button
                      type="button"
                      onClick={() => setRoleModalOpen(true)}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold"
                    >
                      + Novo Cargo
                    </button>
                  </div>
                  <SelectDropdown
                    value={employeeFormData.role_id}
                    onChange={(val) => setEmployeeFormData({ ...employeeFormData, role_id: val })}
                    placeholder="Selecione um cargo..."
                    searchable={roles.length > 6}
                    options={roles.map((r) => ({ value: r.id, label: r.name }))}
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Contrato de Jornada</label>
                  {(() => {
                    const current = employees.find((e) => e.id === editingEmployee?.id)?.contract;
                    return (
                      <button
                        type="button"
                        onClick={() => setEmployeeTab('jornada')}
                        className={`w-full flex items-center gap-2 bg-slate-950 border rounded-lg px-3 py-2 text-left ${
                          current ? 'border-slate-700 text-slate-200' : 'border-amber-500/40 text-amber-300'
                        }`}
                      >
                        <CalendarClock size={14} className="shrink-0" />
                        <span className="truncate">{current ? current.summary : 'Definir semana-padrão e horários'}</span>
                      </button>
                    );
                  })()}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Salário (definido pelo cargo)</label>
                  {(() => {
                    const selectedRole = roles.find((r) => String(r.id) === String(employeeFormData.role_id));
                    return (
                      <>
                        <div className="w-full bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-semibold">
                          {selectedRole ? Number(selectedRole.base_salary || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'Selecione o cargo'}
                        </div>
                        {selectedRole && (
                          <button
                            type="button"
                            onClick={() => {
                              setEmployeeModalOpen(false);
                              setSalaryModalTarget(selectedRole.id);
                            }}
                            className="text-[10px] text-emerald-400 hover:text-emerald-300 font-semibold"
                          >
                            Aumento do cargo {selectedRole.name} →
                          </button>
                        )}
                      </>
                    );
                  })()}
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Dependentes (IRRF)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={employeeFormData.dependents ?? 0}
                    onChange={(e) => setEmployeeFormData({ ...employeeFormData, dependents: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                  />
                  <span className="text-[10px] text-slate-500">Dedução de R$ 189,59 por dependente</span>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Destino das horas extras</label>
                <SelectDropdown
                  value={employeeFormData.overtime_policy || ''}
                  onChange={(val) => setEmployeeFormData({ ...employeeFormData, overtime_policy: val })}
                  options={[
                    { value: '', label: 'Padrão da empresa', subtitle: 'Definido nas Regras de RH' },
                    ...[
                      { value: 'PAY', label: 'Pagar com acréscimo', subtitle: 'Hora extra com o % definido + DSR' },
                      { value: 'PAY_NORMAL', label: 'Pagar valor normal', subtitle: 'Hora simples, sem acréscimo' },
                      { value: 'FIXED_PLUS_BANK', label: 'Valor fixo + folga', subtitle: 'Paga valor fixo/hora e acumula no banco' },
                      { value: 'BANK', label: 'Somente folga (banco de horas)', subtitle: 'Acumula para compensar (se a CCT permitir)' }
                    ]
                  ]}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Passagens Padrão de VT por Dia</label>
                  <SelectDropdown
                    value={employeeFormData.default_daily_transport_tickets ?? 2}
                    onChange={(val) => setEmployeeFormData({ ...employeeFormData, default_daily_transport_tickets: parseInt(val, 10) })}
                    options={[
                      { value: 0, label: 'Sem vale transporte', subtitle: 'Não recebe VT nem tem o desconto de 6%' },
                      { value: 2, label: '2 passagens por dia', subtitle: 'Ida e volta' },
                      { value: 4, label: '4 passagens por dia', subtitle: 'Dupla jornada / integração' }
                    ]}
                  />
                  <span className="text-[10px] text-slate-500">Tarifa: R$ {ticketUnitPrice.toFixed(2)} cada</span>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Vale Alimentação (R$/refeição)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-semibold text-xs">R$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0,00"
                      required
                      value={employeeFormData.daily_meal_cost ?? ''}
                      onChange={(e) => {
                        const val = e.target.value.replace('.', ',');
                        if (val === '' || /^\d*(,\d{0,2})?$/.test(val)) {
                          setEmployeeFormData({ ...employeeFormData, daily_meal_cost: val });
                        }
                      }}
                      onBlur={(e) => {
                        const val = parseFloat(e.target.value.replace(',', '.'));
                        setEmployeeFormData({
                          ...employeeFormData,
                          daily_meal_cost: isNaN(val) ? '0,00' : val.toFixed(2).replace('.', ',')
                        });
                      }}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-white font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <span className="text-[10px] text-slate-500">1 benefício pago/dia quando jornada &gt; 6h</span>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800">
                <div className="text-slate-300 font-semibold mb-2">Complemento do Contrato</div>
                <RHEmployeeProfileForm
                  sectionKey="contrato"
                  profile={employeeFormData.profile || {}}
                  onChange={(profile) => setEmployeeFormData({ ...employeeFormData, profile })}
                />
              </div>
              </>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800 sticky bottom-0 bg-slate-900">
                {editingEmployee && (
                  <button
                    type="button"
                    onClick={() => setFichaEmployeeId(editingEmployee.id)}
                    className="mr-auto flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-slate-300 hover:text-white bg-slate-800 border border-slate-700"
                    title="Imprime a ficha com os dados salvos"
                  >
                    <Printer size={14} /> Ficha Cadastral
                  </button>
                )}
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
                  Salvar Colaborador
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Criação de Cargo */}
      {roleModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-sm w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Briefcase size={18} className="text-indigo-400" />
              Cadastrar Cargo
            </h3>
            <form onSubmit={handleSaveRole} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Nome do Cargo</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Operador de Caixa, Repositor, Gerente"
                  value={roleFormData.name}
                  onChange={(e) => setRoleFormData({ ...roleFormData, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Salário do Cargo</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-semibold text-xs">R$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={roleFormData.base_salary ?? ''}
                    onChange={(e) => setRoleFormData({ ...roleFormData, base_salary: e.target.value.replace(/[^0-9.,]/g, '') })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <span className="text-[10px] text-slate-500">Mesmo salário para todos do cargo; aumentos depois, com data de vigência</span>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Descrição / CBO (Opcional)</label>
                <input
                  type="text"
                  placeholder="Ex: Atendimento ao cliente e recebimento"
                  value={roleFormData.description}
                  onChange={(e) => setRoleFormData({ ...roleFormData, description: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setRoleModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg text-slate-400 hover:text-white bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-500 text-white"
                >
                  Salvar Cargo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Configurações de RH */}
      {settingsModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-white">Regras de RH & Parâmetros da Empresa</h3>
            <form onSubmit={handleSaveSettings} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Valor Unitário Universal da Passagem (VT)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-semibold text-xs">R$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    required
                    value={settingsFormData.transport_ticket_unit_price ?? ''}
                    onChange={(e) => {
                      const val = e.target.value.replace('.', ',');
                      if (val === '' || /^\d*(,\d{0,2})?$/.test(val)) {
                        setSettingsFormData({ ...settingsFormData, transport_ticket_unit_price: val });
                      }
                    }}
                    onBlur={(e) => {
                      const val = parseFloat(e.target.value.replace(',', '.'));
                      setSettingsFormData({
                        ...settingsFormData,
                        transport_ticket_unit_price: isNaN(val) ? '4,70' : val.toFixed(2).replace('.', ',')
                      });
                    }}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <span className="text-[10px] text-slate-500">Tarifa única universal aplicada a todas as passagens da empresa.</span>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Máximo de Domingos Consecutivos Trabalhados</label>
                <input
                  type="number"
                  min="1"
                  max="4"
                  value={settingsFormData.max_consecutive_sundays}
                  onChange={(e) => setSettingsFormData({ ...settingsFormData, max_consecutive_sundays: parseInt(e.target.value, 10) || 2 })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
                <span className="text-[10px] text-slate-500">Lei 10.101/2000: o repouso deve coincidir com o domingo ao menos 1 vez a cada 3 semanas.</span>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Hora Extra Habitual (semanas com HE nas últimas 4)</label>
                <input
                  type="number"
                  min="1"
                  max="4"
                  value={settingsFormData.habitual_overtime_weeks ?? 3}
                  onChange={(e) => setSettingsFormData({ ...settingsFormData, habitual_overtime_weeks: parseInt(e.target.value, 10) || 3 })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
                <span className="text-[10px] text-slate-500">Critério do sistema para o alerta R03 (a lei não fixa um número).</span>
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
                <span className="text-[10px] text-slate-500">CLT: refeição devida apenas em jornadas acima de 6 horas no dia.</span>
              </div>

              {/* Parâmetros de Arredondamento de Banco de Horas (D6: só no total do mês) */}
              <div className="border-t border-slate-800 pt-3">
                <span className="font-semibold text-slate-300 block mb-2 text-[11px] uppercase tracking-wider">
                  Arredondamento do Banco de Horas (Total do Mês)
                </span>

                <div className="grid grid-cols-2 gap-3 mb-2">
                  <div>
                    <label className="block text-slate-400 mb-1">Múltiplo de Arredondamento</label>
                    <SelectDropdown
                      value={settingsFormData.time_rounding_minutes ?? 0}
                      onChange={(val) => setSettingsFormData({ ...settingsFormData, time_rounding_minutes: parseInt(val, 10) || 0 })}
                      options={[
                        { value: 0, label: 'Sem arredondamento (exato)' },
                        { value: 5, label: 'A cada 5 minutos' },
                        { value: 10, label: 'A cada 10 minutos' },
                        { value: 15, label: 'A cada 15 minutos (1/4 hora)' },
                        { value: 30, label: 'A cada 30 minutos (1/2 hora)' },
                        { value: 60, label: 'A cada 60 minutos (1 hora inteira)' }
                      ]}
                    />
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-1">Modo de Arredondamento</label>
                    <SelectDropdown
                      value={settingsFormData.time_rounding_mode || 'NEAREST'}
                      onChange={(val) => setSettingsFormData({ ...settingsFormData, time_rounding_mode: val })}
                      options={[
                        { value: 'NEAREST', label: 'Mais Próximo (Padrão)' },
                        { value: 'DOWN', label: 'Truncar para Baixo' },
                        { value: 'UP', label: 'Para Cima' }
                      ]}
                    />
                  </div>
                </div>

                <div className="mt-2.5">
                  <StyledCheckbox
                    checked={settingsFormData.clt_tolerance_enabled ?? true}
                    onChange={(checked) => setSettingsFormData({ ...settingsFormData, clt_tolerance_enabled: checked })}
                    label="Aplicar tolerância legal da CLT"
                    description="Até 5 min por marcação e 10 min no dia não são computados (art. 58, §1º)"
                  />
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800 space-y-2.5">
                  <div className="text-slate-300 font-semibold">Compensação e Atrasos</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-400 mb-1">Período de compensação</label>
                      <SelectDropdown
                        value={settingsFormData.compensation_regime || 'MONTHLY'}
                        onChange={(val) => setSettingsFormData({ ...settingsFormData, compensation_regime: val })}
                        options={[
                          { value: 'MONTHLY', label: 'Mensal', subtitle: 'Art. 59, §6º (acordo tácito ou escrito)' },
                          { value: 'WEEKLY', label: 'Semanal', subtitle: 'Súmula 85 TST' },
                          { value: 'BANK_6M', label: 'Banco de horas (6 meses)', subtitle: 'Art. 59, §5º (acordo escrito)' }
                        ]}
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">Início da semana</label>
                      <SelectDropdown
                        value={settingsFormData.week_start ?? 0}
                        onChange={(val) => setSettingsFormData({ ...settingsFormData, week_start: parseInt(val, 10) || 0 })}
                        options={[
                          { value: 0, label: 'Segunda-feira', subtitle: 'Padrão' },
                          { value: 6, label: 'Domingo' }
                        ]}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Compensação de atraso com saída posterior</label>
                    <SelectDropdown
                      value={settingsFormData.late_compensation_mode || 'AUTO'}
                      onChange={(val) => setSettingsFormData({ ...settingsFormData, late_compensation_mode: val })}
                      options={[
                        { value: 'AUTO', label: 'Automática dentro dos limites', subtitle: 'Acima deles, o empregador decide' },
                        { value: 'MANUAL', label: 'Sempre decidida pelo empregador' },
                        { value: 'OFF', label: 'Não compensar atrasos' }
                      ]}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-slate-400 mb-1">Máx. por atraso (min)</label>
                      <input
                        type="number"
                        min="0"
                        value={settingsFormData.late_compensation_max_min ?? 30}
                        onChange={(e) => setSettingsFormData({ ...settingsFormData, late_compensation_max_min: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">Máx. por mês</label>
                      <input
                        type="number"
                        min="0"
                        value={settingsFormData.late_compensation_max_per_month ?? 4}
                        onChange={(e) => setSettingsFormData({ ...settingsFormData, late_compensation_max_per_month: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">Abono autom. (min)</label>
                      <input
                        type="number"
                        min="0"
                        value={settingsFormData.late_waiver_auto_min ?? 0}
                        onChange={(e) => setSettingsFormData({ ...settingsFormData, late_waiver_auto_min: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-500">
                    Abono: atraso além da tolerância perdoado sem desconto. Horas trabalhadas a mais nunca deixam de ser computadas (Súmula 366).
                  </span>
                </div>

                <div className="mt-3">
                  <label className="block text-slate-400 mb-1">Desconto de DSR por Falta Injustificada</label>
                  <SelectDropdown
                    value={settingsFormData.absence_dsr_mode || 'ONE'}
                    onChange={(val) => setSettingsFormData({ ...settingsFormData, absence_dsr_mode: val })}
                    options={[
                      { value: 'ONE', label: '1 DSR por semana com falta', subtitle: 'Regra atual (Lei 605/1949)' },
                      { value: 'SCHEDULE', label: 'DSRs da escala na semana', subtitle: 'Ex: 5x2 com 2 DSR = desconta 2' },
                      { value: 'NONE', label: 'Não descontar DSR', subtitle: 'Desconta apenas o dia da falta' }
                    ]}
                  />
                  <span className="text-[10px] text-slate-500">Aplicado no cálculo da folha de pagamento.</span>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800 space-y-2.5">
                  <div className="text-slate-300 font-semibold">Horas Extras e Banco de Horas</div>
                  <div>
                    <label className="block text-slate-400 mb-1">Destino padrão das horas extras</label>
                    <SelectDropdown
                      value={settingsFormData.overtime_policy || 'BANK'}
                      onChange={(val) => setSettingsFormData({ ...settingsFormData, overtime_policy: val })}
                      options={[
                      { value: 'PAY', label: 'Pagar com acréscimo', subtitle: 'Hora extra com o % definido + DSR' },
                      { value: 'PAY_NORMAL', label: 'Pagar valor normal', subtitle: 'Hora simples, sem acréscimo' },
                      { value: 'FIXED_PLUS_BANK', label: 'Valor fixo + folga', subtitle: 'Paga valor fixo/hora e acumula no banco' },
                      { value: 'BANK', label: 'Somente folga (banco de horas)', subtitle: 'Acumula para compensar (se a CCT permitir)' }
                    ]}
                    />
                    <span className="text-[10px] text-slate-500">
                      Pode ser alterado por colaborador no cadastro e por mês na folha de pagamento.
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-400 mb-1">Acréscimo da hora extra (%)</label>
                      <input
                        inputMode="decimal"
                        value={settingsFormData.overtime_rate ?? ''}
                        onChange={(e) => setSettingsFormData({ ...settingsFormData, overtime_rate: e.target.value.replace(/[^0-9.,]/g, '') })}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">Valor fixo por hora (R$)</label>
                      <input
                        inputMode="decimal"
                        value={settingsFormData.overtime_fixed_value ?? ''}
                        onChange={(e) => setSettingsFormData({ ...settingsFormData, overtime_fixed_value: e.target.value.replace(/[^0-9.,]/g, '') })}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-indigo-500"
                      />
                      <span className="text-[10px] text-slate-500">Usado em "Valor fixo + folga"</span>
                    </div>
                  </div>
                </div>
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
