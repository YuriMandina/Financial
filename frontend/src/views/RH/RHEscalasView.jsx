import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, Bus, Utensils, AlertTriangle, Calendar, Printer, 
  Save, RefreshCw, Plus, Trash2, Edit2, CheckCircle2, Clock, 
  ChevronLeft, ChevronRight, ShieldAlert, Sparkles, FileSpreadsheet,
  UserPlus, AlertCircle, Briefcase, Settings2, HelpCircle, CalendarDays, Wallet, TrendingUp
} from 'lucide-react';
import Skeleton from '../../components/common/Skeleton';
import RHShiftModal from './components/RHShiftModal';
import RHJornadasTab from './components/RHJornadasTab';
import RHJornadaGrid from './components/RHJornadaGrid';
import RHBeneficiosGrid from './components/RHBeneficiosGrid';
import RHFeriadosView from './components/RHFeriadosView';
import RHFolhaPagamento from './components/RHFolhaPagamento';
import RHSalaryModal from './components/RHSalaryModal';
import RHBancoHorasView from './components/RHBancoHorasView';
import RHEmployeeProfileForm from './components/RHEmployeeProfileForm';
import RHFichaCadastral from './components/RHFichaCadastral';
import { PROFILE_TABS, profileCompleteness } from './components/employeeProfileSchema';
import StyledCheckbox from '../../components/common/StyledCheckbox';
import SelectDropdown from '../../components/common/SelectDropdown';

const API_BASE = 'http://localhost:8000';

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
    desc: 'Folga compensatória de banco de horas'
  },
  F: {
    label: 'Feriado',
    short: 'F',
    bg: 'bg-sky-500/20 text-sky-300 border-sky-500/40 hover:bg-sky-500/30',
    printClass: 'bg-blue-100 text-blue-800 font-bold',
    badge: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
    desc: 'Feriado'
  },
  FE: {
    label: 'Férias',
    short: 'FE',
    bg: 'bg-purple-500/20 text-purple-300 border-purple-500/40 hover:bg-purple-500/30',
    printClass: 'bg-purple-100 text-purple-800 font-bold',
    badge: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    desc: 'Período de férias'
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

export default function RHEscalasView({ token }) {
  // ==============================================================================
  // --- [BLOCO: ESTADOS PRINCIPAIS] ---
  // ==============================================================================

  const today = new Date();
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1);
  const [activeTab, setActiveTab] = useState('jornada'); // 'jornada', 'transporte', 'alimentacao', 'resumo', 'folha_ponto', 'mural', 'equipe'
  
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [scheduleData, setScheduleData] = useState(null);
  const [localGrid, setLocalGrid] = useState({});
  const [workDays, setWorkDays] = useState({});
  const [benefitAdjustments, setBenefitAdjustments] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState('');

  // Modais de Cadastro
  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [employeeFormData, setEmployeeFormData] = useState({
    name: '',
    role_id: '',
    default_shift_id: '',
    default_daily_transport_tickets: 2,
    daily_meal_cost: 25.00,
    weekly_contract_hours: 44.0,
    weekly_actual_hours: 44.0,
    base_salary: '0,00',
    dependents: 0,
    admission_date: '',
    overtime_policy: '',
    profile: {},
    work_days_per_week: 6,
    active: true
  });

  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [salaryModalTarget, setSalaryModalTarget] = useState(null); // id do cargo ou 'ALL'
  const [employeeTab, setEmployeeTab] = useState('contrato'); // aba do cadastro do colaborador
  const [fichaEmployeeId, setFichaEmployeeId] = useState(null); // ficha cadastral para impressão
  const [roleFormData, setRoleFormData] = useState({ name: '', description: '', base_salary: '' });

  const [shiftModalOpen, setShiftModalOpen] = useState(false);

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
    overtime_fixed_value: '0,00'
  });

  // Modal para Ajuste Rápido de Célula (Turno do Dia e Quantidade de Vales)
  const [cellEditModalOpen, setCellEditModalOpen] = useState(false);
  const [editingCellTarget, setEditingCellTarget] = useState(null); // { empId, empName, day, type }

  // ==============================================================================
  // --- [BLOCO: CARREGAMENTO DE DADOS (FETCH SEGURO)] ---
  // ==============================================================================

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
      setLocalGrid(data.grid || {});
      setWorkDays(data.work_days || {});
      setBenefitAdjustments(data.benefit_adjustments || []);
      setDirty(false);
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
  // --- [BLOCO: MANIPULAÇÃO DA MATRIZ DE DIAS & TICKETS] ---
  // ==============================================================================

  const handleCellClick = (empId, day, type) => {
    setLocalGrid((prev) => {
      const empData = prev[empId] || { TRANSPORTE: {}, ALIMENTACAO: {} };
      const defaultShift = shifts.find((s) => s.is_default) || shifts[0];
      const empObj = employees.find((e) => e.id === empId);
      const currentEntry = empData[type]?.[day] || { 
        status: 'OFF', 
        shift: defaultShift?.code || null, 
        shift_id: defaultShift?.id || null,
        tickets_count: empObj?.default_daily_transport_tickets ?? 2, 
        daily_hours: defaultShift?.net_hours || 8.0 
      };
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

  // Alterna rapidamente a quantidade de passagens (2 vs 4) com clique duplo ou botão secundário
  const handleToggleTickets = (e, empId, day) => {
    e.preventDefault();
    e.stopPropagation();
    setLocalGrid((prev) => {
      const empData = prev[empId] || { TRANSPORTE: {}, ALIMENTACAO: {} };
      const currentEntry = empData.TRANSPORTE?.[day] || { status: 'X', tickets_count: 2 };
      const currentTickets = currentEntry.tickets_count || 2;
      const nextTickets = currentTickets === 2 ? 4 : 2;

      const updatedEmpData = {
        ...empData,
        TRANSPORTE: {
          ...(empData.TRANSPORTE || {}),
          [day]: {
            ...currentEntry,
            status: 'X',
            tickets_count: nextTickets
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

  const handleShiftChange = (empId, day, type, newShiftCode, newShiftId) => {
    setLocalGrid((prev) => {
      const empData = prev[empId] || { TRANSPORTE: {}, ALIMENTACAO: {} };
      const currentEntry = empData[type]?.[day] || { status: 'X', shift: newShiftCode, daily_hours: 8.0 };
      const shiftObj = shifts.find((s) => s.id === newShiftId || s.code === newShiftCode);

      const updatedEmpData = {
        ...empData,
        [type]: {
          ...(empData[type] || {}),
          [day]: {
            ...currentEntry,
            shift: newShiftCode || null,
            shift_id: newShiftId || null,
            daily_hours: shiftObj?.net_hours || currentEntry.daily_hours || 8.0
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
              shift_id: dayVal.shift_id,
              shift: dayVal.shift,
              tickets_count: dayVal.tickets_count || 2,
              daily_hours: dayVal.daily_hours || 8.0
            });
          });
        });
      });

      const res = await fetch(`${API_BASE}/api/rh/schedules/batch-save`, {
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
      const res = await fetch(`${API_BASE}/api/rh/schedules/auto-fill-standard?year=${selectedYear}&month=${selectedMonth}`, {
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
  // --- [BLOCO: GESTÃO DE COLABORADORES, CARGOS & TURNOS] ---
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
        default_shift_id: employeeFormData.default_shift_id ? parseInt(employeeFormData.default_shift_id, 10) : null,
        default_daily_transport_tickets: Number.isNaN(parseInt(employeeFormData.default_daily_transport_tickets, 10)) ? 2 : parseInt(employeeFormData.default_daily_transport_tickets, 10),
        daily_meal_cost: parseFloat(String(employeeFormData.daily_meal_cost).replace(',', '.')) || 25.00,
        weekly_contract_hours: parseFloat(employeeFormData.weekly_contract_hours) || 44.0,
        weekly_actual_hours: parseFloat(employeeFormData.weekly_actual_hours) || parseFloat(employeeFormData.weekly_contract_hours) || 44.0,
        work_days_per_week: parseInt(employeeFormData.work_days_per_week, 10) || 6,
        dependents: parseInt(employeeFormData.dependents, 10) || 0,
        admission_date: employeeFormData.admission_date || null,
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



  const handleDeleteShift = async (shiftId) => {
    if (!window.confirm('Excluir este template de turno?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/rh/shifts/${shiftId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Erro ao excluir turno');
      await fetchSchedule();
    } catch (err) {
      console.error(err);
      alert('Erro ao excluir turno.');
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
        overtime_fixed_value: parseMoney(settingsFormData.overtime_fixed_value)
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
  const shifts = scheduleData?.shifts || [];
  const ticketUnitPrice = scheduleData?.settings?.transport_ticket_unit_price || 4.70;

  const handlePrint = () => {
    window.print();
  };

  // ==============================================================================
  // --- [BLOCO: RENDERIZAÇÃO DA TABELA DE ESCALA MATRIZ (VT OU VA)] ---
  // ==============================================================================

  const renderScheduleGrid = (scheduleType) => {
    const isTransport = scheduleType === 'TRANSPORTE';
    const typeLabel = isTransport ? 'Vale Transporte (VT)' : 'Vale Alimentação (VA)';

    if (employees.length === 0) {
      return (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-indigo-600/20 text-indigo-400 mx-auto flex items-center justify-center">
            <Users size={24} />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">Nenhum colaborador cadastrado</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
              Para montar a grade de {typeLabel}, cadastre a equipe na aba "Equipe & Parâmetros".
            </p>
          </div>
          <button
            onClick={() => {
              setEditingEmployee(null);
              setEmployeeFormData({
                name: '',
                role_id: '',
                default_shift_id: '',
                default_daily_transport_tickets: 2,
                daily_meal_cost: '25,00',
                weekly_contract_hours: 44.0,
                weekly_actual_hours: 44.0,
                base_salary: '0,00',
                dependents: 0,
                admission_date: '',
                overtime_policy: '',
                profile: {},
                active: true
              });
              setEmployeeTab('contrato');
              setEmployeeModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            <UserPlus size={15} />
            Cadastrar Primeiro Colaborador
          </button>
        </div>
      );
    }

    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        {/* Cabeçalho da Grade */}
        <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 print:border-b-2 print:border-slate-400">
          <div>
            <div className="flex items-center gap-2">
              {isTransport ? <Bus className="text-indigo-400 print:text-black" size={20} /> : <Utensils className="text-emerald-400 print:text-black" size={20} />}
              <h2 className="text-base font-semibold text-white print:text-black">
                Grade Mensal de {typeLabel}
              </h2>
              {isTransport && (
                <span className="text-[11px] bg-indigo-950 text-indigo-300 border border-indigo-800 px-2 py-0.5 rounded-full font-medium">
                  Tarifa Universal: R$ {ticketUnitPrice.toFixed(2)}/passagem
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 print:text-slate-600 mt-1">
              {isTransport 
                ? 'Clique para alternar o status. Clique direito ou duplo clique no X para alternar entre 2 e 4 passagens no dia.'
                : 'Concedido 1 benefício por dia para jornadas acima de 6 horas.'
              }
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

        {/* Tabela de Matriz com Rolagem Horizontal */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse print:text-[10px]">
            <thead>
              <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider print:bg-slate-100 print:text-black">
                <th className="py-2.5 px-3 min-w-[170px] sticky left-0 bg-slate-950 z-10 border-r border-slate-800 print:bg-white print:border-r print:border-slate-300">
                  Colaborador
                </th>
                {daysList.map((day) => {
                  const isSunday = sundays.includes(day);
                  const isHoliday = !!holidays[day];
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
                      title={isHoliday ? holidays[day] : isSunday ? 'Domingo' : `Dia ${day}`}
                    >
                      <div>{day}</div>
                      <div className="text-[9px] font-normal lowercase opacity-70">
                        {isSunday ? 'dom' : isHoliday ? 'fer' : ''}
                      </div>
                    </th>
                  );
                })}
                <th className="py-2.5 px-3 text-center min-w-[70px] bg-slate-950 border-l border-slate-800 print:bg-slate-100 print:text-black">
                  {isTransport ? 'Vales' : 'Dias'}
                </th>
                <th className="py-2.5 px-3 text-right min-w-[90px] bg-slate-950 border-l border-slate-800 print:bg-slate-100 print:text-black">
                  {isTransport ? 'Total VT' : 'Total VA'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 print:divide-slate-300">
              {employees.map((emp) => {
                const empGrid = localGrid[emp.id]?.[scheduleType] || {};
                const summary = summaries.find((s) => s.employee_id === emp.id) || {};
                const totalAmount = isTransport ? (summary.total_vt_amount || 0) : (summary.total_va_amount || 0);

                return (
                  <tr key={emp.id} className="hover:bg-slate-800/30 transition-colors print:hover:bg-transparent">
                    <td className="py-2 px-3 font-medium text-slate-200 sticky left-0 bg-slate-900 border-r border-slate-800 z-10 print:bg-white print:text-black print:border-r print:border-slate-300">
                      <div className="truncate max-w-[150px] font-semibold">{emp.name}</div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {emp.role} • {emp.weekly_contract_hours}h sem.
                      </div>
                      <div className="text-[10px] text-indigo-400">
                        {isTransport ? (emp.default_daily_transport_tickets === 0 ? 'Sem vale transporte' : `Padrão: ${emp.default_daily_transport_tickets} passagens/dia`) : `VA: R$ ${(emp.daily_meal_cost || 25).toFixed(2)}/dia`}
                      </div>
                    </td>

                    {daysList.map((day) => {
                      const entry = empGrid[day] || { status: 'OFF', tickets_count: emp.default_daily_transport_tickets ?? 2 };
                      const status = entry.status || 'OFF';
                      const ticketsCount = entry.tickets_count || emp.default_daily_transport_tickets || 2;
                      const conf = STATUS_CONFIG[status] || STATUS_CONFIG.OFF;
                      const isSunday = sundays.includes(day);

                      return (
                        <td
                          key={day}
                          onClick={() => handleCellClick(emp.id, day, scheduleType)}
                          onContextMenu={(e) => isTransport && handleToggleTickets(e, emp.id, day)}
                          onDoubleClick={(e) => isTransport && handleToggleTickets(e, emp.id, day)}
                          className={`py-1 px-0.5 text-center cursor-pointer select-none transition-colors border-r border-slate-800/50 print:border-r print:border-slate-300 ${
                            isSunday ? 'bg-red-950/10' : ''
                          }`}
                          title={
                            isTransport 
                              ? `${emp.name} - Dia ${day}: ${conf.label} (${ticketsCount} vales). Clique direito p/ alternar 2/4 passagens.` 
                              : `${emp.name} - Dia ${day}: ${conf.label}`
                          }
                        >
                          <div 
                            className={`w-7 h-7 mx-auto rounded flex flex-col items-center justify-center font-bold text-[11px] border transition-transform active:scale-95 relative ${conf.bg} print:border-0 print:${conf.printClass}`}
                          >
                            <span>{conf.short}</span>
                            {isTransport && status === 'X' && (
                              <span className={`text-[8px] leading-none font-normal -mt-0.5 ${ticketsCount > 2 ? 'text-amber-300 font-bold' : 'opacity-80'}`}>
                                {ticketsCount}
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}

                    <td className="py-2 px-2 text-center font-bold text-slate-300 border-l border-slate-800 print:text-black print:border-l print:border-slate-300">
                      {isTransport ? `${summary.total_vt_tickets || 0}` : `${summary.va_worked_days || 0}`}
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

  const renderSundayScheduleWall = () => (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <Clock className="text-indigo-400" size={20} />
              Mural Operacional de Horários & Turnos
            </h3>
            <p className="text-xs text-slate-400">
              Programação com horários de entrada, almoço e saída para exibição no mural da empresa.
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

        {sundays.length === 0 ? (
          <div className="text-center py-6 text-slate-500 italic">Nenhum domingo neste mês.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {sundays.map((sunDay) => {
              const holidayName = holidays[sunDay];
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

                  <div className="space-y-2.5">
                    {employees.length === 0 ? (
                      <div className="text-[11px] text-slate-600 italic">Sem colaboradores</div>
                    ) : (
                      employees.map((emp) => {
                        const empDayInfo = localGrid[emp.id]?.TRANSPORTE?.[sunDay] || { status: 'OFF', shift: null };
                        const isWorking = empDayInfo.status === 'X';
                        const currentShift = shifts.find((s) => s.code === empDayInfo.shift) || shifts.find((s) => s.is_default) || shifts[0];

                        return (
                          <div key={emp.id} className="p-2 rounded bg-slate-900/60 border border-slate-800/80 text-xs space-y-1">
                            <div className="flex items-center justify-between">
                              <span className={`font-semibold ${isWorking ? 'text-white' : 'text-slate-500'}`}>
                                {emp.name}
                              </span>
                              {isWorking ? (
                                shifts.length === 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => setShiftModalOpen(true)}
                                    className="text-[10px] text-amber-400 hover:text-amber-300 bg-amber-950/60 border border-amber-800/80 px-2 py-0.5 rounded font-medium transition"
                                  >
                                    + Cadastrar Turno
                                  </button>
                                ) : (
                                  <select
                                    value={empDayInfo.shift || currentShift?.code || ''}
                                    onChange={(e) => {
                                      const sObj = shifts.find((s) => s.code === e.target.value);
                                      handleShiftChange(emp.id, sunDay, 'TRANSPORTE', e.target.value, sObj?.id);
                                      handleShiftChange(emp.id, sunDay, 'ALIMENTACAO', e.target.value, sObj?.id);
                                    }}
                                    className="bg-slate-800 border border-slate-700 rounded text-[11px] text-slate-200 px-1.5 py-0.5 focus:outline-none focus:border-indigo-500 font-medium"
                                  >
                                    {shifts.map((s) => (
                                      <option key={s.id} value={s.code}>
                                        {s.code}: {s.name}
                                      </option>
                                    ))}
                                  </select>
                                )
                              ) : (
                                <span className="text-[11px] text-slate-500 font-medium italic">Folga</span>
                              )}
                            </div>

                            {isWorking && currentShift && (
                              <div className="text-[10px] text-indigo-300 font-mono bg-indigo-950/40 px-1.5 py-0.5 rounded border border-indigo-900/40">
                                ⏰ {currentShift.start_time} às {currentShift.end_time}
                                {currentShift.lunch_start && (
                                  <span className="text-slate-400"> (alm: {currentShift.lunch_start}-{currentShift.lunch_end})</span>
                                )}
                              </div>
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
      </div>
    </div>
  );

  // ==============================================================================
  // --- [BLOCO: RENDERIZAÇÃO DA ABA EQUIPE, CARGOS & PARÂMETROS] ---
  // ==============================================================================

  const renderTeamAndSettings = () => (
    <div className="space-y-6">
      {/* Cabeçalho da Equipe */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-white">Quadro de Colaboradores de RH</h3>
          <p className="text-xs text-slate-400">Gerenciamento de contratos, turnos padrão, VT e VA individual</p>
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
            onClick={() => setShiftModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
          >
            <Clock size={14} />
            + Turno/Horário
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
                default_shift_id: shifts[0]?.id || '',
                default_daily_transport_tickets: 2,
                daily_meal_cost: '25,00',
                weekly_contract_hours: 44.0,
                weekly_actual_hours: 44.0,
                base_salary: '0,00',
                dependents: 0,
                admission_date: '',
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
              <th className="py-3 px-4">Contrato Semanal</th>
              <th className="py-3 px-4 text-right">Salário</th>
              <th className="py-3 px-4">Turno Padrão</th>
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
                const shiftObj = shifts.find((s) => s.id === emp.default_shift_id);
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
                    <td className="py-3 px-4 text-slate-400">
                      {emp.weekly_contract_hours}h semanais
                    </td>
                    <td className="py-3 px-4 text-right text-slate-200 font-medium whitespace-nowrap">
                      {Number(emp.base_salary || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </td>
                    <td className="py-3 px-4 text-slate-300">
                      {shiftObj ? `${shiftObj.code} (${shiftObj.net_hours}h)` : 'Padrão (8h)'}
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
                            default_shift_id: emp.default_shift_id || '',
                            default_daily_transport_tickets: emp.default_daily_transport_tickets ?? 2,
                            daily_meal_cost: Number(emp.daily_meal_cost ?? 25.00).toFixed(2).replace('.', ','),
                            weekly_contract_hours: emp.weekly_contract_hours || 44.0,
                            weekly_actual_hours: emp.weekly_actual_hours || emp.weekly_contract_hours || 44.0,
                            base_salary: Number(emp.base_salary || 0).toFixed(2).replace('.', ','),
                            dependents: emp.dependents || 0,
                            admission_date: emp.admission_date || '',
                            overtime_policy: emp.overtime_policy || '',
                            profile: emp.profile || {},
                            work_days_per_week: emp.work_days_per_week || 6,
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

      {/* Grid com Cargos e Turnos Cadastrados */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

        {/* Card de Turnos */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h4 className="text-sm font-semibold text-white flex items-center gap-2">
              <Clock size={16} className="text-emerald-400" />
              Templates de Turnos e Horários ({shifts.length})
            </h4>
            <button
              onClick={() => setShiftModalOpen(true)}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold"
            >
              + Novo Turno
            </button>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {shifts.length === 0 ? (
              <div className="text-center py-4 text-xs text-slate-500">
                Nenhum turno cadastrado.{' '}
                <button
                  type="button"
                  onClick={() => setShiftModalOpen(true)}
                  className="text-emerald-400 hover:underline font-medium"
                >
                  Cadastrar agora
                </button>
              </div>
            ) : (
              shifts.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-1.5 px-2 rounded bg-slate-950 text-xs">
                  <div>
                    <span className="font-semibold text-slate-200">
                      [{s.code}] {s.name} ({s.net_hours}h)
                    </span>
                    <span className="text-slate-500 text-[11px] block">
                      {s.start_time} às {s.end_time} {s.lunch_start && `(almoço: ${s.lunch_start}-${s.lunch_end})`}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDeleteShift(s.id)}
                    className="text-slate-500 hover:text-red-400 p-1"
                    title="Remover turno"
                  >
                    <Trash2 size={13} />
                  </button>
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

  const warnings = scheduleData?.warnings || [];

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
            onClick={handleAutoFillStandard}
            disabled={saving || employees.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors disabled:opacity-50"
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
      {warnings.length > 0 && (
        <div className="space-y-2 print:hidden">
          {warnings.map((warn, idx) => (
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
      </div>

      {/* Renderização do Conteúdo da Aba */}
      {activeTab === 'jornada' && (
        <RHJornadaGrid
          key={`${selectedYear}-${selectedMonth}`}
          onDirtyChange={setJornadaDirty}
          absenceDsrMode={scheduleData?.settings?.absence_dsr_mode || 'ONE'}
          employees={employees}
          shifts={shifts}
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
          shifts={shifts}
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          numDays={scheduleData?.num_days || 31}
          sundays={sundays}
          holidays={holidays}
          grid={localGrid}
          workDays={workDays}
          onEditEmployee={(emp) => {
            setEditingEmployee(emp);
            setEmployeeFormData({
              name: emp.name,
              role_id: emp.role_id || '',
              default_shift_id: emp.default_shift_id || '',
              default_daily_transport_tickets: emp.default_daily_transport_tickets ?? 2,
              daily_meal_cost: Number(emp.daily_meal_cost ?? 25.00).toFixed(2),
              weekly_contract_hours: emp.weekly_contract_hours || 44.0,
              weekly_actual_hours: emp.weekly_actual_hours || emp.weekly_contract_hours || 44.0,
              base_salary: Number(emp.base_salary || 0).toFixed(2).replace('.', ','),
              dependents: emp.dependents || 0,
              admission_date: emp.admission_date || '',
              overtime_policy: emp.overtime_policy || '',
              profile: emp.profile || {},
              work_days_per_week: emp.work_days_per_week || 6,
              active: true
            });
            setEmployeeTab('contrato');
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
            shift={shifts.find((sh) => sh.id === emp?.default_shift_id)}
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
              {PROFILE_TABS.map((t) => (
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
              {employeeTab !== 'contrato' && (
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
                  <label className="block text-slate-400 mb-1">Turno Padrão Contratual</label>
                  <SelectDropdown
                    value={employeeFormData.default_shift_id}
                    onChange={(val) => setEmployeeFormData({ ...employeeFormData, default_shift_id: val })}
                    options={[
                      { value: '', label: 'Padrão (8h)' },
                      ...shifts.map((s) => ({ value: s.id, label: `${s.code}: ${s.name}`, subtitle: `${s.net_hours}h líquidas` }))
                    ]}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1 whitespace-nowrap" title="Jornada semanal contratual">Jornada Contratual</label>
                  <SelectDropdown
                    value={employeeFormData.weekly_contract_hours}
                    onChange={(val) => {
                      const newContract = parseFloat(val);
                      const wasEqual = employeeFormData.weekly_actual_hours === employeeFormData.weekly_contract_hours;
                      setEmployeeFormData({
                        ...employeeFormData,
                        weekly_contract_hours: newContract,
                        weekly_actual_hours: wasEqual ? newContract : employeeFormData.weekly_actual_hours
                      });
                    }}
                    options={[44, 40, 36, 30, 20].map((h) => ({ value: h, label: `${h}h semanais` }))}
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 whitespace-nowrap" title="Jornada semanal praticada">Jornada Praticada</label>
                  <SelectDropdown
                    value={employeeFormData.weekly_actual_hours}
                    onChange={(val) => setEmployeeFormData({ ...employeeFormData, weekly_actual_hours: parseFloat(val) })}
                    options={[
                      { value: 44, label: '44h semanais' },
                      { value: 48, label: '48h semanais' },
                      ...[40, 36, 30, 20].map((h) => ({ value: h, label: `${h}h semanais` }))
                    ]}
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 whitespace-nowrap">Dias por Semana</label>
                  <SelectDropdown
                    value={employeeFormData.work_days_per_week || 6}
                    onChange={(val) => setEmployeeFormData({ ...employeeFormData, work_days_per_week: parseInt(val, 10) || 6 })}
                    options={[
                      { value: 6, label: '6 dias (6x1)' },
                      { value: 5, label: '5 dias (5x2)' }
                    ]}
                  />
                </div>
              </div>

              {/* Indicador Reativo de Saldo de Horas */}
              <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-2.5 text-xs">
                {Number(employeeFormData.weekly_actual_hours) === Number(employeeFormData.weekly_contract_hours) ? (
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 size={13} />
                    <span>Jornada regular: Praticada igual à contratual (sem geração de banco de horas).</span>
                  </div>
                ) : Number(employeeFormData.weekly_actual_hours) > Number(employeeFormData.weekly_contract_hours) ? (
                  <div className="flex items-center gap-1.5 text-amber-300">
                    <Clock size={13} />
                    <span>
                      +{(Number(employeeFormData.weekly_actual_hours) - Number(employeeFormData.weekly_contract_hours)).toFixed(0)}h/semana excedentes 
                      (gera saldo em Banco de Horas e meta de folgas compensatórias).
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-sky-300">
                    <AlertCircle size={13} />
                    <span>
                      {(Number(employeeFormData.weekly_actual_hours) - Number(employeeFormData.weekly_contract_hours)).toFixed(0)}h/semana (regime com jornada reduzida).
                    </span>
                  </div>
                )}
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

      {/* Modal de Gestão e Criação de Turnos */}
      <RHShiftModal
        isOpen={shiftModalOpen}
        onClose={() => setShiftModalOpen(false)}
        shifts={shifts}
        token={token}
        onShiftCreated={fetchSchedule}
        onShiftDeleted={fetchSchedule}
      />

      {/* Modal de Configurações de RH */}
      {settingsModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
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
                    description="Variações de até 10 minutos diários não são computadas como horas extras ou faltas"
                  />
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
