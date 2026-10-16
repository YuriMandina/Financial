import React, { useState, useMemo, useRef } from 'react';
import { 
  Bus, Utensils, RotateCcw, Plus, Trash2, CheckCircle2, 
  AlertCircle, Edit2, Sparkles, Filter, X, HelpCircle, Zap
} from 'lucide-react';
import SelectDropdown from '../../../components/common/SelectDropdown';

export default function RHBeneficiosGrid({
  type = 'VT', // 'VT' ou 'VA'
  employees = [],
  workDays = {}, // workDays[empId][day]
  benefitAdjustments = [],
  daysList = [],
  sundays = [],
  holidays = {},
  selectedYear,
  selectedMonth,
  scheduleId,
  ticketUnitPrice = 4.70,
  token,
  apiBase,
  onRefresh,
  summaries = []
}) {
  const isVT = type === 'VT';
  const typeLabel = isVT ? 'Vale Transporte (VT)' : 'Vale Alimentação (VA)';
  const TypeIcon = isVT ? Bus : Utensils;

  // Estado do modal de override pontual
  const [overrideModal, setOverrideModal] = useState(null); // { empId, empName, day, data }
  const [overrideVal, setOverrideVal] = useState('');
  const [overrideNote, setOverrideNote] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);

  // Ajuste rápido: clique alterna o benefício do dia e salva na hora
  const [quickMode, setQuickMode] = useState(() => {
    try {
      return localStorage.getItem('rh_benefit_quick_mode') !== 'off';
    } catch {
      return true;
    }
  });
  const [pendingCells, setPendingCells] = useState({}); // { 'empId:day': valor exibido enquanto salva }
  const saveChainRef = useRef(Promise.resolve());
  const refreshTimerRef = useRef(null);

  const toggleQuickMode = () => {
    setQuickMode((prev) => {
      const next = !prev;
      try { localStorage.setItem('rh_benefit_quick_mode', next ? 'on' : 'off'); } catch { /* sem armazenamento */ }
      return next;
    });
  };

  // VT: não recebe -> 2 -> 4 -> não recebe | VA: recebe <-> não recebe
  const nextQuickValue = (current) => {
    if (!isVT) return !current;
    if (current < 2) return 2;
    if (current < 4) return 4;
    return 0;
  };

  const handleQuickToggle = (emp, day, currentValue) => {
    const key = `${emp.id}:${day}`;
    const next = nextQuickValue(currentValue);
    setPendingCells((prev) => ({ ...prev, [key]: next }));

    const payload = {
      schedule_id: scheduleId,
      employee_id: emp.id,
      day,
      ...(isVT ? { vt_tickets_override: next } : { va_override: next })
    };

    // Salva em sequência (cliques rápidos não chegam fora de ordem) e atualiza a tela ao final
    saveChainRef.current = saveChainRef.current.then(async () => {
      try {
        const res = await fetch(`${apiBase}/api/rh/schedules/benefits/override`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Erro ao salvar ajuste');
      } catch (err) {
        setPendingCells((prev) => {
          const copy = { ...prev };
          delete copy[key];
          return copy;
        });
        alert('Erro ao ajustar benefício: ' + err.message);
      }
    });

    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      saveChainRef.current.then(async () => {
        if (onRefresh) await onRefresh();
        setPendingCells({});
      });
    }, 700);
  };

  // Estado do modal de ajuste avulso (D7)
  const [adjModalOpen, setAdjModalOpen] = useState(false);
  const [adjEmpId, setAdjEmpId] = useState('');
  const [adjQty, setAdjQty] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [savingAdj, setSavingAdj] = useState(false);

  const summaryMap = useMemo(() => {
    const map = {};
    summaries.forEach((s) => { map[s.employee_id] = s; });
    return map;
  }, [summaries]);

  // Filtra ajustes avulsos pelo tipo atual
  const filteredAdjustments = useMemo(() => {
    return benefitAdjustments.filter((a) => a.benefit_type === type);
  }, [benefitAdjustments, type]);

  // ==============================================================================
  // --- [AÇÕES DE OVERRIDE EM CÉLULA (D5)] ---
  // ==============================================================================

  const handleOpenOverride = (emp, day) => {
    const dInfo = workDays[emp.id]?.[day] || {};
    const curVal = isVT
      ? (dInfo.vt_tickets_override !== undefined && dInfo.vt_tickets_override !== null ? dInfo.vt_tickets_override : dInfo.vt_final || 2)
      : (dInfo.va_override !== undefined && dInfo.va_override !== null ? dInfo.va_override : dInfo.va_final);

    setOverrideModal({
      empId: emp.id,
      empName: emp.name,
      day,
      curVal,
      dInfo
    });
    setOverrideVal(String(curVal));
    setOverrideNote(dInfo.benefit_note || '');
  };

  const handleSaveOverride = async () => {
    if (!overrideModal) return;
    try {
      setSavingOverride(true);
      const payload = {
        schedule_id: scheduleId,
        employee_id: overrideModal.empId,
        day: overrideModal.day,
        benefit_note: overrideNote || null
      };

      if (isVT) {
        payload.vt_tickets_override = parseInt(overrideVal, 10);
      } else {
        payload.va_override = overrideVal === 'true' || overrideVal === true;
      }

      const res = await fetch(`${apiBase}/api/rh/schedules/benefits/override`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error('Erro ao salvar ajuste');
      setOverrideModal(null);
      if (onRefresh) onRefresh();
    } catch (err) {
      alert('Erro ao ajustar benefício: ' + err.message);
    } finally {
      setSavingOverride(false);
    }
  };

  const handleResetBenefit = async (empId = null, day = null) => {
    try {
      const payload = {
        schedule_id: scheduleId,
        employee_id: empId,
        day: day,
        benefit_type: type
      };

      const res = await fetch(`${apiBase}/api/rh/schedules/benefits/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error('Erro ao restaurar');
      setOverrideModal(null);
      if (onRefresh) onRefresh();
    } catch (err) {
      alert('Falha ao restaurar: ' + err.message);
    }
  };

  // ==============================================================================
  // --- [AÇÕES DE AJUSTES AVULSOS NO MÊS (D7)] ---
  // ==============================================================================

  const handleCreateAdjustment = async (e) => {
    e.preventDefault();
    if (!adjEmpId || !adjQty) return;
    try {
      setSavingAdj(true);
      const res = await fetch(`${apiBase}/api/rh/schedules/benefit-adjustments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          schedule_id: scheduleId,
          employee_id: parseInt(adjEmpId, 10),
          benefit_type: type,
          quantity: parseFloat(adjQty),
          reason: adjReason || null
        })
      });

      if (!res.ok) throw new Error('Erro ao criar ajuste avulso');
      setAdjModalOpen(false);
      setAdjQty('');
      setAdjReason('');
      if (onRefresh) onRefresh();
    } catch (err) {
      alert('Erro: ' + err.message);
    } finally {
      setSavingAdj(false);
    }
  };

  const handleDeleteAdjustment = async (adjId) => {
    if (!confirm('Deseja realmente remover este ajuste avulso?')) return;
    try {
      const res = await fetch(`${apiBase}/api/rh/schedules/benefit-adjustments/${adjId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Erro ao remover');
      if (onRefresh) onRefresh();
    } catch (err) {
      alert('Erro ao excluir: ' + err.message);
    }
  };

  return (
    <div className="space-y-5">
      {/* Barra de Ferramentas da Aba */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-sm">
        <div className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <TypeIcon className={isVT ? 'text-indigo-400' : 'text-emerald-400'} size={18} />
              Controle & Ajustes de {typeLabel}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {isVT
                ? `Calculado a partir dos dias trabalhados (tarifa: R$ ${ticketUnitPrice.toFixed(2)}). Ajuste para mais ou para menos por dia ou no mês.`
                : 'Concedido em dias de trabalho com jornada de 6 horas ou mais. Ajuste por dia ou no mês.'
              }
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => handleResetBenefit(null, null)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors whitespace-nowrap"
              title="Remove todos os ajustes deste benefício e volta aos valores calculados pela jornada"
            >
              <RotateCcw size={14} />
              Restaurar Calculados
            </button>
            <button
              onClick={() => {
                setAdjEmpId(employees[0]?.id || '');
                setAdjModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition-colors whitespace-nowrap"
            >
              <Plus size={14} />
              Ajuste Avulso no Mês
            </button>
          </div>
        </div>

        {/* Modo de edição da grade */}
        <div className="px-4 py-2.5 border-t border-slate-800 bg-slate-950/40 rounded-b-xl flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <button
            type="button"
            role="switch"
            aria-checked={quickMode}
            onClick={toggleQuickMode}
            className="flex items-center gap-2 font-semibold text-slate-200"
          >
            <span className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${quickMode ? 'bg-amber-500' : 'bg-slate-700'}`}>
              <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${quickMode ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
            </span>
            <Zap size={13} className={quickMode ? 'text-amber-300' : 'text-slate-500'} />
            Ajuste rápido
          </button>
          <span className="text-slate-500">
            {quickMode
              ? (isVT
                ? 'Clique na célula: não recebe → 2 → 4 → não recebe. Clique direito: ajuste detalhado.'
                : 'Clique na célula: recebe ↔ não recebe. Clique direito: ajuste detalhado.')
              : 'Clique na célula para abrir o ajuste detalhado.'}
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-slate-500">
            <span className="w-2 h-2 rounded-full bg-amber-400" /> ajustado manualmente
          </span>
        </div>
      </div>

      {/* Grade Diária de Benefícios */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-950/90 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                <th className="py-2.5 px-3 min-w-[170px] sticky left-0 bg-slate-950 z-10 border-r border-slate-800">
                  Colaborador
                </th>
                {daysList.map((day) => {
                  const isSunday = sundays.includes(day);
                  const isHoliday = !!holidays[day];
                  return (
                    <th
                      key={day}
                      className={`py-2 px-0.5 text-center min-w-[36px] border-r border-slate-800/60 ${
                        isSunday ? 'bg-red-950/20 text-red-400 font-bold' : isHoliday ? 'bg-sky-950/30 text-sky-400 font-bold' : 'text-slate-300'
                      }`}
                    >
                      <div>{day}</div>
                      <div className="text-[9px] font-normal lowercase opacity-70">
                        {['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(selectedYear, selectedMonth - 1, day).getDay()]}
                      </div>
                      {isHoliday && <div className="text-[8px] font-semibold uppercase leading-none">fer</div>}
                    </th>
                  );
                })}
                <th className="py-2.5 px-3 text-center min-w-[70px] bg-slate-950 border-l border-slate-800">
                  Calculado
                </th>
                <th className="py-2.5 px-3 text-center min-w-[65px] bg-slate-950 border-l border-slate-800">
                  Ajustes ±
                </th>
                <th className="py-2.5 px-3 text-center min-w-[70px] bg-slate-950 border-l border-slate-800">
                  Final
                </th>
                <th className="py-2.5 px-3 text-right min-w-[85px] bg-slate-950 border-l border-slate-800">
                  Total R$
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/60">
              {employees.map((emp) => {
                const empDays = workDays[emp.id] || {};
                const summary = summaryMap[emp.id] || {};
                const calcQty = isVT ? (summary.total_vt_tickets_calc || 0) : (summary.total_va_count_calc || 0);
                const finalQty = isVT ? (summary.total_vt_tickets_final || 0) : (summary.total_va_count_final || 0);
                const adjQty = finalQty - calcQty;
                const totalAmount = isVT ? (summary.total_vt_amount || 0) : (summary.total_va_amount || 0);

                return (
                  <tr key={emp.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-2 px-3 font-medium text-slate-200 sticky left-0 bg-slate-900 border-r border-slate-800 z-10">
                      <div className="truncate max-w-[150px] font-semibold text-white">{emp.name}</div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {isVT ? (emp.default_daily_transport_tickets === 0 ? 'Sem vale transporte' : `Padrão: ${emp.default_daily_transport_tickets ?? 2} vales/dia`) : `VA: R$ ${(emp.daily_meal_cost || 25).toFixed(2)}/dia`}
                      </div>
                    </td>

                    {daysList.map((day) => {
                      const d = empDays[day] || {};
                      const pendingKey = `${emp.id}:${day}`;
                      const isPending = pendingKey in pendingCells;
                      const isOverridden = isPending || (isVT ? d.vt_is_overridden : d.va_is_overridden);
                      const finalVal = isPending ? pendingCells[pendingKey] : (isVT ? (d.vt_final ?? 0) : d.va_final);
                      const isSun = sundays.includes(day);

                      let badgeText = '';
                      let badgeStyle = 'bg-slate-800/40 text-slate-500 border-slate-700/40';

                      if (isVT) {
                        if (finalVal > 0) {
                          badgeText = String(finalVal);
                          badgeStyle = finalVal > 2
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold'
                            : 'bg-indigo-600/20 text-indigo-300 border-indigo-500/40';
                        } else {
                          badgeText = '-';
                        }
                      } else {
                        if (finalVal) {
                          badgeText = 'VA';
                          badgeStyle = 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40 font-bold';
                        } else {
                          badgeText = '-';
                        }
                      }

                      return (
                        <td
                          key={day}
                          onClick={() => (quickMode ? handleQuickToggle(emp, day, finalVal) : handleOpenOverride(emp, day))}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            handleOpenOverride(emp, day);
                          }}
                          className={`py-1 px-0.5 text-center cursor-pointer select-none transition-colors border-r border-slate-800/50 ${
                            isSun ? 'bg-red-950/10' : ''
                          }`}
                          title={`Dia ${day}: ${isVT ? (finalVal > 0 ? `${finalVal} passagens` : 'não recebe') : (finalVal ? 'Concedido' : 'Não concedido')} ${isOverridden ? '(Ajustado manualmente)' : '(Calculado)'}${quickMode ? ' • clique para alternar, clique direito para detalhar' : ''}`}
                        >
                          <div
                            className={`w-7 h-7 mx-auto rounded flex items-center justify-center font-bold text-[10px] border transition-transform active:scale-95 relative ${badgeStyle} ${
                              isOverridden ? 'border-amber-400 ring-1 ring-amber-400/40 shadow-xs' : ''
                            } ${isPending ? 'opacity-70' : ''}`}
                          >
                            <span>{badgeText}</span>
                            {isOverridden && (
                              <span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-400 rounded-full" />
                            )}
                          </div>
                        </td>
                      );
                    })}

                    <td className="py-2 px-2 text-center text-slate-400 border-l border-slate-800 font-medium">
                      {calcQty}
                    </td>

                    <td className="py-2 px-2 text-center border-l border-slate-800 font-semibold">
                      {adjQty === 0 ? (
                        <span className="text-slate-600">0</span>
                      ) : adjQty > 0 ? (
                        <span className="text-amber-400">+{adjQty}</span>
                      ) : (
                        <span className="text-rose-400">{adjQty}</span>
                      )}
                    </td>

                    <td className="py-2 px-2 text-center font-bold text-white border-l border-slate-800">
                      {finalQty}
                    </td>

                    <td className="py-2 px-3 text-right font-bold text-emerald-400 border-l border-slate-800">
                      R$ {totalAmount.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Seção de Ajustes Avulsos do Mês (D7) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-indigo-400" />
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              Ajustes Avulsos do Mês ({typeLabel})
            </h4>
            <span className="text-[10px] text-slate-500">
              Lançamentos extraordinários que somam ou subtraem do total mensal sem vínculo a um dia específico.
            </span>
          </div>

          <button
            onClick={() => {
              setAdjEmpId(employees[0]?.id || '');
              setAdjModalOpen(true);
            }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700"
          >
            <Plus size={13} />
            Adicionar Ajuste
          </button>
        </div>

        {filteredAdjustments.length === 0 ? (
          <div className="text-center py-4 text-xs text-slate-500 italic bg-slate-950/40 rounded-lg border border-slate-800/60">
            Nenhum ajuste avulso cadastrado para este mês.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60 border border-slate-800/80 rounded-lg overflow-hidden bg-slate-950/40">
            {filteredAdjustments.map((adj) => {
              const emp = employees.find((e) => e.id === adj.employee_id);
              return (
                <div key={adj.id} className="p-3 flex items-center justify-between text-xs hover:bg-slate-800/20">
                  <div className="space-y-0.5">
                    <div className="font-semibold text-white">
                      {emp?.name || 'Colaborador'}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Motivo: {adj.reason || 'Sem justificativa informada'}
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <span className={`font-bold text-sm ${adj.quantity > 0 ? 'text-amber-400' : 'text-rose-400'}`}>
                      {adj.quantity > 0 ? `+${adj.quantity}` : adj.quantity} {isVT ? 'passagens' : 'refeições'}
                    </span>

                    <button
                      onClick={() => handleDeleteAdjustment(adj.id)}
                      className="p-1.5 text-slate-400 hover:text-red-400 rounded hover:bg-slate-800 transition-colors"
                      title="Excluir ajuste avulso"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de Ajuste Pontual em Célula (D5) */}
      {overrideModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-sm w-full p-5 shadow-2xl space-y-4 text-slate-200 text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div>
                <h4 className="font-bold text-white text-sm">
                  Ajustar {typeLabel}: Dia {overrideModal.day}/{selectedMonth}
                </h4>
                <p className="text-xs text-indigo-300">{overrideModal.empName}</p>
              </div>
              <button
                onClick={() => setOverrideModal(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              {isVT ? (
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Quantidade de Passagens</label>
                  <select
                    value={overrideVal}
                    onChange={(e) => setOverrideVal(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-white font-semibold"
                  >
                    <option value="0">0 passagens (Sem vale transporte neste dia)</option>
                    <option value="1">1 passagem</option>
                    <option value="2">2 passagens (Padrão ida e volta)</option>
                    <option value="3">3 passagens</option>
                    <option value="4">4 passagens (Dupla jornada / integração)</option>
                    <option value="6">6 passagens (Deslocamentos extras)</option>
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Concessão de Refeição (VA)</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setOverrideVal('true')}
                      className={`p-2 rounded-lg border text-center font-bold transition-colors ${
                        overrideVal === 'true'
                          ? 'border-emerald-500 bg-emerald-600/30 text-emerald-300'
                          : 'border-slate-800 bg-slate-950 text-slate-400'
                      }`}
                    >
                      Conceder Vale
                    </button>
                    <button
                      type="button"
                      onClick={() => setOverrideVal('false')}
                      className={`p-2 rounded-lg border text-center font-bold transition-colors ${
                        overrideVal === 'false'
                          ? 'border-rose-500 bg-rose-600/30 text-rose-300'
                          : 'border-slate-800 bg-slate-950 text-slate-400'
                      }`}
                    >
                      Não Conceder
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-slate-400 mb-1 font-medium">Motivo do Ajuste (Opcional)</label>
                <input
                  type="text"
                  placeholder="Ex: Treinamento externo / plantão"
                  value={overrideNote}
                  onChange={(e) => setOverrideNote(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => handleResetBenefit(overrideModal.empId, overrideModal.day)}
                className="text-[11px] text-slate-400 hover:text-white underline"
              >
                Restaurar Calculado
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOverrideModal(null)}
                  className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveOverride}
                  disabled={savingOverride}
                  className="px-4 py-1.5 rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow"
                >
                  {savingOverride ? 'Salvando...' : 'Salvar Ajuste'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Criação de Ajuste Avulso no Mês (D7) */}
      {adjModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-sm w-full p-5 shadow-2xl space-y-4 text-slate-200 text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <h4 className="font-bold text-white text-sm">
                Lançar Ajuste Avulso no Mês ({type})
              </h4>
              <button
                onClick={() => setAdjModalOpen(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateAdjustment} className="space-y-3">
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Colaborador</label>
                <SelectDropdown
                  value={adjEmpId}
                  onChange={(val) => setAdjEmpId(val)}
                  searchable={employees.length > 5}
                  placeholder="Selecione o colaborador"
                  options={employees.map((e) => ({
                    value: e.id,
                    label: e.name,
                    subtitle: e.role || 'Geral'
                  }))}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">
                  Quantidade ({isVT ? 'Passagens' : 'Refeições'})
                </label>
                <input
                  type="number"
                  step="1"
                  required
                  placeholder="Ex: +4 ou -2"
                  value={adjQty}
                  onChange={(e) => setAdjQty(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white"
                />
                <span className="text-[10px] text-slate-500">
                  Use números positivos para adicionar ou negativos para descontar.
                </span>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">Justificativa / Motivo</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Compensação de viagem a outra filial"
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setAdjModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingAdj}
                  className="px-4 py-1.5 rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow"
                >
                  {savingAdj ? 'Salvando...' : 'Lançar Ajuste'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
