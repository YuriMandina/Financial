import React, { useState, useMemo } from 'react';
import { 
  Clock, Printer, Edit2, Users, AlertCircle, CheckCircle2, 
  HelpCircle, Calendar, FileText, ChevronRight, Sparkles, Filter, Eye
} from 'lucide-react';
import Skeleton from '../../../components/common/Skeleton';

// ==============================================================================
// --- [BLOCO: DIAS DA SEMANA E MESES] ---
// ==============================================================================

const WEEKDAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

export default function RHJornadasTab({
  loading,
  employees = [],
  shifts = [],
  selectedYear,
  selectedMonth,
  numDays = 31,
  sundays = [],
  holidays = {},
  grid = {},
  workDays = {},
  onEditEmployee,
  organizationName = 'EMPRESA'
}) {
  // Estado para modal da folha de ponto
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('ALL'); // 'ALL' ou id do empregado
  const [showShiftGuide, setShowShiftGuide] = useState(false); // pré-preencher marca d'água com horários previstos
  const [filterRole, setFilterRole] = useState('ALL');

  // Mapeamento de turnos por ID e por Code
  const shiftMap = useMemo(() => {
    const map = {};
    shifts.forEach((s) => {
      map[s.id] = s;
      if (s.code) map[s.code] = s;
    });
    return map;
  }, [shifts]);

  // Lista de cargos únicos para filtro
  const rolesList = useMemo(() => {
    const set = new Set();
    employees.forEach((e) => {
      if (e.role) set.add(e.role);
    });
    return Array.from(set);
  }, [employees]);

  // Filtro de colaboradores
  const filteredEmployees = useMemo(() => {
    if (filterRole === 'ALL') return employees;
    return employees.filter((e) => e.role === filterRole);
  }, [employees, filterRole]);

  // KPIs de Jornada
  const kpis = useMemo(() => {
    let totalContratual = 0;
    let totalPraticada = 0;
    let comBancoHoras = 0;
    let jornadaPadrao = 0;

    employees.forEach((emp) => {
      const c = Number(emp.weekly_contract_hours) || 44.0;
      const a = Number(emp.weekly_actual_hours) || c;
      totalContratual += c;
      totalPraticada += a;
      if (a > c) {
        comBancoHoras++;
      } else {
        jornadaPadrao++;
      }
    });

    const mediaContratual = employees.length ? (totalContratual / employees.length).toFixed(1) : '44.0';
    const mediaPraticada = employees.length ? (totalPraticada / employees.length).toFixed(1) : '44.0';

    return {
      totalEmployees: employees.length,
      mediaContratual,
      mediaPraticada,
      comBancoHoras,
      jornadaPadrao
    };
  }, [employees]);

  // Abre visualização individual ou em lote
  const handleOpenTimesheet = (empId = 'ALL') => {
    setSelectedEmployeeId(empId);
    setPrintModalOpen(true);
  };

  // Dispara a impressão do navegador
  const handlePrint = () => {
    window.print();
  };

  // ==============================================================================
  // --- [BLOCO: RENDERIZAÇÃO PRINCIPAL / SKELETON] ---
  // ==============================================================================

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Skeleton type="card" />
          <Skeleton type="card" />
          <Skeleton type="card" />
          <Skeleton type="card" />
        </div>
        <Skeleton type="table" rows={6} columns={6} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ============================================================================== */}
      {/* --- [BLOCO: CABEÇALHO & CARDS KPI] --- */}
      {/* ============================================================================== */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm print:hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4 mb-4">
          <div>
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <Clock className="text-indigo-400" size={20} />
              Controle de Jornadas & Folhas de Ponto Manuais
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Administre a carga horária semanal contratual vs. praticada e gere cartões de ponto físicos para preenchimento e assinatura.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => handleOpenTimesheet('ALL')}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition-colors"
              title="Gerar e imprimir folhas de ponto de toda a equipe para este mês"
            >
              <Printer size={15} />
              Imprimir Folhas em Lote (Todos)
            </button>
          </div>
        </div>

        {/* Métricas Rápidas */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3">
            <span className="text-[11px] font-medium text-slate-400 block mb-1">Total de Colaboradores</span>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold text-white">{kpis.totalEmployees}</span>
              <span className="text-[11px] text-slate-500">ativos</span>
            </div>
          </div>

          <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3">
            <span className="text-[11px] font-medium text-slate-400 block mb-1">Média Carga Contratual</span>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold text-indigo-400">{kpis.mediaContratual}h</span>
              <span className="text-[11px] text-slate-500">semanais</span>
            </div>
          </div>

          <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3">
            <span className="text-[11px] font-medium text-slate-400 block mb-1">Jornada Regular (Sem BH)</span>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold text-emerald-400">{kpis.jornadaPadrao}</span>
              <span className="text-[11px] text-slate-500">praticam = contratual</span>
            </div>
          </div>

          <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3">
            <span className="text-[11px] font-medium text-slate-400 block mb-1">Gera Banco de Horas</span>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold text-amber-400">{kpis.comBancoHoras}</span>
              <span className="text-[11px] text-slate-500">praticam &gt; contratual</span>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================================== */}
      {/* --- [BLOCO: TABELA DE CONTROLE DE HORAS DA EQUIPE] --- */}
      {/* ============================================================================== */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm print:hidden">
        <div className="px-5 py-3 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950/50">
          <div className="flex items-center gap-2">
            <Filter size={15} className="text-slate-400" />
            <span className="text-xs font-semibold text-slate-300">Filtrar por Cargo:</span>
            <select
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1 focus:outline-none focus:border-indigo-500"
            >
              <option value="ALL">Todos os Cargos ({employees.length})</option>
              {rolesList.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <span className="text-[11px] text-slate-500">
            Competência: <strong>{MONTH_NAMES[selectedMonth - 1]}/{selectedYear}</strong> ({numDays} dias)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-950 text-slate-400 border-b border-slate-800 uppercase tracking-wider text-[10px]">
                <th className="py-3 px-4">Colaborador & Cargo</th>
                <th className="py-3 px-4">Turno Base Contratual</th>
                <th className="py-3 px-4 text-center">Carga Contratual</th>
                <th className="py-3 px-4 text-center">Carga Praticada</th>
                <th className="py-3 px-4 text-center">Saldo / Regime</th>
                <th className="py-3 px-4 text-center">Folgas BH Mês</th>
                <th className="py-3 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500 italic">
                    Nenhum colaborador encontrado com os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredEmployees.map((emp) => {
                  const shift = shiftMap[emp.default_shift_id];
                  const contractHours = Number(emp.weekly_contract_hours) || 44.0;
                  const actualHours = Number(emp.weekly_actual_hours) || contractHours;
                  const diffHours = actualHours - contractHours;
                  const targetBhDays = diffHours > 0 ? Math.max(0, Math.round((diffHours * 4) / 8.0)) : 0;

                  return (
                    <tr key={emp.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-white">{emp.name}</div>
                        <div className="text-[11px] text-slate-400">{emp.role || 'Geral'}</div>
                      </td>

                      <td className="py-3 px-4 text-slate-300">
                        {shift ? (
                          <div>
                            <span className="font-medium text-indigo-300">{shift.code}</span> - {shift.name}
                            <div className="text-[10px] text-slate-500">
                              {shift.start_time} às {shift.end_time} ({shift.net_hours}h líquidas)
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-500 italic">Padrão Geral (8h)</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-center font-medium text-slate-200">
                        {contractHours}h <span className="text-[10px] text-slate-500">/sem</span>
                      </td>

                      <td className="py-3 px-4 text-center font-medium text-white">
                        {actualHours}h <span className="text-[10px] text-slate-500">/sem</span>
                      </td>

                      <td className="py-3 px-4 text-center">
                        {diffHours === 0 ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 size={11} />
                            Jornada Regular (0h)
                          </span>
                        ) : diffHours > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/20">
                            <Clock size={11} />
                            +{diffHours}h/sem (Gera BH)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/10 text-sky-300 border border-sky-500/20">
                            {diffHours}h/sem (Subjornada)
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-center text-slate-300 font-medium">
                        {targetBhDays > 0 ? (
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            {targetBhDays} folga{targetBhDays > 1 ? 's' : ''} / mês
                          </span>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleOpenTimesheet(emp.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-medium transition-colors"
                            title="Gerar Folha de Ponto Manual"
                          >
                            <FileText size={13} className="text-indigo-400" />
                            Folha de Ponto
                          </button>

                          {onEditEmployee && (
                            <button
                              onClick={() => onEditEmployee(emp)}
                              className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
                              title="Editar Jornada e Cadastro"
                            >
                              <Edit2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ============================================================================== */}
      {/* --- [BLOCO: MODAL / TELA DE VISUALIZAÇÃO & IMPRESSÃO DA FOLHA DE PONTO] --- */}
      {/* ============================================================================== */}
      {printModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-5xl w-full p-4 sm:p-6 shadow-2xl my-auto text-slate-200 max-h-[92vh] flex flex-col">
            {/* Barra Superior do Modal (não sai na impressão) */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3 mb-4 print:hidden">
              <div className="flex items-center gap-2">
                <FileText className="text-indigo-400" size={22} />
                <div>
                  <h3 className="font-bold text-white text-base">Folha de Ponto Manual (Portaria 671 / CLT)</h3>
                  <p className="text-[11px] text-slate-400">
                    Competência: {MONTH_NAMES[selectedMonth - 1]} de {selectedYear}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 text-xs">
                  <label className="text-slate-400">Exibir:</label>
                  <select
                    value={selectedEmployeeId}
                    onChange={(e) => setSelectedEmployeeId(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
                    className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-white text-xs focus:outline-none focus:border-indigo-500"
                  >
                    <option value="ALL">Todos os Colaboradores ({employees.length})</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>{e.name} ({e.role || 'Geral'})</option>
                    ))}
                  </select>
                </div>

                <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showShiftGuide}
                    onChange={(e) => setShowShiftGuide(e.target.checked)}
                    className="rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0"
                  />
                  <span>Guia pontilhado de turno</span>
                </label>

                <button
                  onClick={handlePrint}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow transition-colors"
                >
                  <Printer size={15} />
                  Imprimir / Gerar PDF
                </button>

                <button
                  onClick={() => setPrintModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  Fechar
                </button>
              </div>
            </div>

            {/* Conteúdo Imprimível */}
            <div className="overflow-y-auto pr-1 flex-1 space-y-8 bg-slate-950/40 p-3 sm:p-5 rounded-lg border border-slate-800/80 timesheets-container">
              {employees
                .filter((e) => selectedEmployeeId === 'ALL' || e.id === Number(selectedEmployeeId))
                .map((emp, empIdx) => {
                  const empShift = shiftMap[emp.default_shift_id];
                  const contractHours = Number(emp.weekly_contract_hours) || 44.0;
                  const actualHours = Number(emp.weekly_actual_hours) || contractHours;
                  const empGridTransport = grid[emp.id]?.TRANSPORTE || {};

                  return (
                    <div
                      key={emp.id}
                      className={`bg-white text-black p-6 rounded shadow-md border border-slate-300 text-xs font-sans print-page ${
                        empIdx > 0 ? 'page-break' : ''
                      }`}
                      style={{ pageBreakAfter: 'always' }}
                    >
                      {/* Cabeçalho da Folha de Ponto */}
                      <div className="border-2 border-black p-3 mb-3">
                        <div className="flex justify-between items-start border-b border-black pb-2 mb-2">
                          <div>
                            <h2 className="text-sm font-black uppercase tracking-wide">
                              FOLHA INDIVIDUAL DE CONTROLE DE PONTO MANUAL
                            </h2>
                            <p className="text-[10px] text-gray-700 font-semibold">
                              Registro manual de jornada de trabalho em conformidade com o Art. 74 da CLT
                            </p>
                          </div>
                          <div className="text-right">
                            <span className="text-xs font-bold block">
                              MÊS: {MONTH_NAMES[selectedMonth - 1].toUpperCase()} / {selectedYear}
                            </span>
                            <span className="text-[10px] text-gray-600">
                              Emissão: {new Date().toLocaleDateString('pt-BR')}
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                          <div>
                            <span className="font-bold text-gray-600 block text-[9px] uppercase">Empregado:</span>
                            <span className="font-bold text-black uppercase">{emp.name}</span>
                          </div>
                          <div>
                            <span className="font-bold text-gray-600 block text-[9px] uppercase">Cargo / Função:</span>
                            <span className="font-semibold text-black uppercase">{emp.role || 'GERAL'}</span>
                          </div>
                          <div>
                            <span className="font-bold text-gray-600 block text-[9px] uppercase">Jornada Semanal:</span>
                            <span className="font-semibold text-black">
                              Contratual: {contractHours}h | Praticada: {actualHours}h
                            </span>
                          </div>
                        </div>

                        <div className="mt-2 pt-2 border-t border-gray-300 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px]">
                          <div>
                            <span className="font-bold text-gray-600 text-[9px] uppercase">Horário Contratual Padrão: </span>
                            <span className="font-medium text-black">
                              {empShift 
                                ? `${empShift.start_time} às ${empShift.lunch_start || '12:00'} e ${empShift.lunch_end || '13:00'} às ${empShift.end_time} (${empShift.net_hours}h líquidas)`
                                : '08:00 às 12:00 e 13:00 às 17:00 (Padrão 8h)'}
                            </span>
                          </div>
                          <div className="text-left sm:text-right">
                            <span className="font-bold text-gray-600 text-[9px] uppercase">Regime de Compensação: </span>
                            <span className="font-medium text-black">
                              {actualHours > contractHours 
                                ? `Acordo de Compensação / Banco de Horas (+${actualHours - contractHours}h/sem)` 
                                : 'Jornada Integral Regular'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Grade Diária de Marcação */}
                      <table className="w-full border-collapse border border-black text-[10px]">
                        <thead>
                          <tr className="bg-gray-200 text-black border-b border-black font-bold text-center">
                            <th className="border border-black p-1 w-8">Dia</th>
                            <th className="border border-black p-1 w-10">Sem</th>
                            <th className="border border-black p-1 w-16">Entrada 1</th>
                            <th className="border border-black p-1 w-16">Saída Int.</th>
                            <th className="border border-black p-1 w-16">Retorno Int.</th>
                            <th className="border border-black p-1 w-16">Saída 2</th>
                            <th className="border border-black p-1 w-24">Rubrica Empregado</th>
                            <th className="border border-black p-1">Ocorrência / Observação</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from({ length: numDays }, (_, i) => i + 1).map((day) => {
                            const dateObj = new Date(selectedYear, selectedMonth - 1, day);
                            const weekdayIdx = dateObj.getDay();
                            const weekdayLabel = WEEKDAY_NAMES[weekdayIdx];
                            const isSunday = weekdayIdx === 0;
                            const isHoliday = !!holidays[day];
                            const holidayName = holidays[day];

                            // Status e horários da escala / jornada para o dia
                            const empWorkDays = workDays[emp.id] || {};
                            const dayWork = empWorkDays[day];
                            const dayInfo = empGridTransport[day] || {};
                            const dayStatus = dayWork ? dayWork.status : (dayInfo.status || 'OFF');

                            // Determinar texto de ocorrência
                            let ocorrencia = '';
                            let isOffDay = false;

                            if (isHoliday) {
                              ocorrencia = `FERIADO (${holidayName})`;
                              isOffDay = true;
                            } else if (dayStatus === 'BH' || dayStatus === 'FOLGA_BH') {
                              ocorrencia = 'FOLGA BANCO DE HORAS';
                              isOffDay = true;
                            } else if (dayStatus === 'FE' || dayStatus === 'FERIAS') {
                              ocorrencia = 'FÉRIAS';
                              isOffDay = true;
                            } else if (dayStatus === 'ATESTADO') {
                              ocorrencia = 'ATESTADO MÉDICO';
                              isOffDay = true;
                            } else if (dayStatus === 'FALTA') {
                              ocorrencia = 'FALTA NÃO JUSTIFICADA';
                              isOffDay = true;
                            } else if (dayStatus === 'DSR' || (isSunday && (dayStatus === 'OFF' || dayStatus === 'DSR'))) {
                              ocorrencia = 'DSR / REPOUSO SEMANAL';
                              isOffDay = true;
                            } else if (dayStatus === 'OFF' || dayStatus === 'FOLGA') {
                              ocorrencia = isSunday ? 'DSR / REPOUSO SEMANAL' : 'FOLGA SEMANAL';
                              isOffDay = true;
                            }

                            // Horários para exibição ou guia
                            const displayShift = dayWork ? {
                              start_time: dayWork.start_time,
                              lunch_start: dayWork.lunch_start,
                              lunch_end: dayWork.lunch_end,
                              end_time: dayWork.end_time
                            } : (shiftMap[dayInfo.shift_id || dayInfo.shift] || empShift);

                            return (
                              <tr
                                key={day}
                                className={`text-center h-6 ${
                                  isOffDay ? 'bg-gray-100 font-semibold text-gray-700' : 'hover:bg-gray-50'
                                }`}
                              >
                                <td className="border border-black font-bold p-0.5">{day}</td>
                                <td className={`border border-black p-0.5 ${isSunday ? 'font-bold text-red-600' : ''}`}>
                                  {weekdayLabel}
                                </td>

                                {isOffDay ? (
                                  <>
                                    <td className="border border-black text-center text-gray-400">-</td>
                                    <td className="border border-black text-center text-gray-400">-</td>
                                    <td className="border border-black text-center text-gray-400">-</td>
                                    <td className="border border-black text-center text-gray-400">-</td>
                                    <td className="border border-black"></td>
                                    <td className="border border-black text-left px-2 font-bold text-[9px] uppercase tracking-wider text-gray-800">
                                      {ocorrencia}
                                    </td>
                                  </>
                                ) : (
                                  <>
                                    <td className="border border-black text-center text-gray-400">
                                      {showShiftGuide && displayShift ? (
                                        <span className="text-gray-400 italic">{displayShift.start_time}</span>
                                      ) : null}
                                    </td>
                                    <td className="border border-black text-center text-gray-400">
                                      {showShiftGuide && displayShift ? (
                                        <span className="text-gray-400 italic">{displayShift.lunch_start || '12:00'}</span>
                                      ) : null}
                                    </td>
                                    <td className="border border-black text-center text-gray-400">
                                      {showShiftGuide && displayShift ? (
                                        <span className="text-gray-400 italic">{displayShift.lunch_end || '13:00'}</span>
                                      ) : null}
                                    </td>
                                    <td className="border border-black text-center text-gray-400">
                                      {showShiftGuide && displayShift ? (
                                        <span className="text-gray-400 italic">{displayShift.end_time}</span>
                                      ) : null}
                                    </td>
                                    <td className="border border-black"></td>
                                    <td className="border border-black text-left px-1 text-[9px]">
                                      {dayWork?.notes || ''}
                                    </td>
                                  </>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>

                      {/* Rodapé e Declaração Legal */}
                      <div className="mt-3 pt-2 border-t border-black text-[9px] space-y-3">
                        <p className="text-gray-700 italic leading-snug">
                          "Reconheço a exatidão das anotações constantes neste cartão-ponto manual, emitido para cumprimento 
                          do Art. 74 da CLT, declarando que não prestei serviços fora dos horários aqui registrados sem a devida anotação."
                        </p>

                        <div className="grid grid-cols-2 gap-8 pt-4">
                          <div className="text-center">
                            <div className="border-b border-black w-3/4 mx-auto mb-1"></div>
                            <span className="font-bold uppercase text-[9px] block">{emp.name}</span>
                            <span className="text-gray-600 text-[8px]">Assinatura do Empregado</span>
                          </div>

                          <div className="text-center">
                            <div className="border-b border-black w-3/4 mx-auto mb-1"></div>
                            <span className="font-bold uppercase text-[9px] block">Responsável / Recursos Humanos</span>
                            <span className="text-gray-600 text-[8px]">Visto da Empresa / Empregador</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================================== */}
      {/* --- [BLOCO: ESTILOS DE IMPRESSÃO VIA CSS EMBUTIDO] --- */}
      {/* ============================================================================== */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body * {
            visibility: hidden;
          }
          .timesheets-container, .timesheets-container * {
            visibility: visible;
          }
          .timesheets-container {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            background: white !important;
            padding: 0 !important;
            margin: 0 !important;
            border: none !important;
          }
          .print-page {
            box-shadow: none !important;
            border: none !important;
            padding: 12mm 15mm !important;
            margin: 0 !important;
            page-break-after: always !important;
            break-after: page !important;
          }
        }
      `}} />
    </div>
  );
}
