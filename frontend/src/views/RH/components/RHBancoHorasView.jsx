import React, { useState, useEffect, useMemo } from 'react';
import {
  Clock, Plus, X, Trash2, ChevronDown, ChevronRight, RefreshCw, Wallet,
  TrendingUp, TrendingDown, Users, AlertCircle, CalendarCheck, Undo2, ShieldAlert, Hourglass, Calendar
} from 'lucide-react';
import SelectDropdown from '../../../components/common/SelectDropdown';

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const fmtHours = (minutes, signed = true) => {
  const m = Number(minutes || 0);
  const sign = !signed ? '' : m < 0 ? '−' : m > 0 ? '+' : '';
  const abs = Math.abs(m);
  return `${sign}${Math.floor(abs / 60)}h${String(abs % 60).padStart(2, '0')}`;
};

const balanceTone = (m) => (m > 0 ? 'text-amber-300' : m < 0 ? 'text-rose-300' : 'text-slate-500');

const POLICY_LABELS = {
  BANK: 'Somente folga (banco)',
  PAY: 'Pagar saldo com acréscimo',
  PAY_NORMAL: 'Pagar saldo valor normal',
  FIXED_PLUS_BANK: 'Valor fixo + folga'
};

const MOVEMENT_LABELS = {
  EXTRA: 'Horas além da jornada',
  EXTRA_100: 'DSR/feriado sem folga compensatória',
  SHORT: 'Saída antecipada / jornada menor',
  FOLGA_BH: 'Folga de banco de horas'
};

const REST_STATUS = {
  PENDENTE: { label: 'Pendente', cls: 'border-rose-500/40 text-rose-300 bg-rose-500/10' },
  FOLGA: { label: 'Folga compensatória', cls: 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10' },
  PAGAR: { label: 'Pagar em dobro', cls: 'border-amber-500/40 text-amber-300 bg-amber-500/10' }
};

const fmtDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')} (${WEEKDAY_SHORT[new Date(y, m - 1, d).getDay()]})`;
};


const CCT_AGING_STATUS = {
  CURRENT: {
    label: 'Mês atual',
    badgeCls: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30',
    dotCls: 'bg-indigo-400',
    desc: 'Acumulado no mês corrente'
  },
  FOLGA_PROXIMO: {
    label: 'Mês 1 • Conceder folgas',
    badgeCls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    dotCls: 'bg-emerald-400',
    desc: 'Prazo prioritário da empresa para folgas'
  },
  WARNING: {
    label: 'Mês 2 • Alerta agendamento',
    badgeCls: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    dotCls: 'bg-amber-400',
    desc: 'Sem folga há 2 meses, agendar compensação'
  },
  EXPIRED: {
    label: 'Mês 3+ • Venceu CCT (Pagar)',
    badgeCls: 'bg-rose-500/10 text-rose-300 border-rose-500/30 animate-pulse',
    dotCls: 'bg-rose-400',
    desc: 'Atingiu o limite de 3 meses da CCT; deve ser quitado na folha'
  }
};

const ENTRY_LABELS = {
  PAYMENT: 'Pagamento em folha',
  CREDIT: 'Crédito manual',
  DEBIT: 'Débito manual'
};

/**
 * Banco de Horas: extrato por colaborador (saldo anterior, escala dia a dia, lançamentos e saldo)
 * e lançamentos de consumo: pagamento parcial em folha, créditos e débitos manuais.
 */
export default function RHBancoHorasView({ token, apiBase, selectedYear, selectedMonth }) {
  const [loading, setLoading] = useState(true);
  const [payroll, setPayroll] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [entryModal, setEntryModal] = useState(null); // { employee, data }
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [folgaPick, setFolgaPick] = useState(null); // { key, date }: escolha do dia da folga compensatória
  const loadedPeriodRef = React.useRef(null);

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const request = async (path, options = {}) => {
    const res = await fetch(`${apiBase}${path}`, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `Erro ${res.status}`);
    return data;
  };

  const flash = (text) => {
    setMsg(text);
    setTimeout(() => setMsg(''), 4000);
  };

  const load = async () => {
    const period = `${selectedYear}-${selectedMonth}`;
    try {
      if (loadedPeriodRef.current !== period) setLoading(true);
      const data = await request(`/api/rh/payroll?year=${selectedYear}&month=${selectedMonth}`);
      loadedPeriodRef.current = period;
      setPayroll(data);
    } catch (err) {
      alert('Falha ao carregar o banco de horas: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [selectedYear, selectedMonth]);

  const employees = payroll?.employees || [];

  const kpis = useMemo(() => {
    const k = { positive: 0, negative: 0, paid: 0, withBalance: 0, folgaProximo: 0, warning: 0, expired: 0 };
    employees.forEach((e) => {
      const b = e.bank.balance_minutes;
      if (b > 0) k.positive += b;
      if (b < 0) k.negative += b;
      if (b !== 0) k.withBalance += 1;
      k.paid += e.bank.paid_minutes;
      const ag = e.bank.aging || {};
      k.folgaProximo += Number(ag.folga_proximo_minutes || 0);
      k.warning += Number(ag.warning_minutes || 0);
      k.expired += Number(ag.expired_minutes || 0);
    });
    return k;
  }, [employees]);

  // ==============================================================================
  // --- [AÇÕES] ---
  // ==============================================================================

  const handlePolicy = async (emp, policy) => {
    try {
      await request('/api/rh/payroll/bank-hours', {
        method: 'PUT',
        body: JSON.stringify({ year: selectedYear, month: selectedMonth, employee_id: emp.employee_id, policy: policy || null })
      });
      await load();
      flash('Destino do saldo atualizado.');
    } catch (err) {
      alert(err.message);
    }
  };

  // Horas 100%: folga de dia inteiro (marcada na escala) ou pagamento em dobro na folha do mês
  const handleRestDecision = async (emp, item, decision, folgaDate = null) => {
    try {
      await request('/api/rh/payroll/bank-hours/rest-work', {
        method: 'PUT',
        body: JSON.stringify({ employee_id: emp.employee_id, worked_date: item.date, decision, folga_date: folgaDate })
      });
      setFolgaPick(null);
      await load();
      flash(decision === 'FOLGA' ? 'Folga compensatória marcada na escala.' : decision === 'PAGAR' ? 'Dia será pago em dobro na folha.' : 'Decisão desfeita.');
    } catch (err) {
      alert(err.message);
    }
  };

  const openEntry = (emp, kind = 'PAYMENT') => setEntryModal({
    employee: emp,
    data: { kind, hours: '', minutes: '', pay_mode: 'PAY', note: '' }
  });

  const handleSaveEntry = async (e) => {
    e.preventDefault();
    const { employee, data } = entryModal;
    const total = (parseInt(data.hours, 10) || 0) * 60 + (parseInt(data.minutes, 10) || 0);
    if (total <= 0) {
      alert('Informe a quantidade de horas.');
      return;
    }
    try {
      setSaving(true);
      await request('/api/rh/payroll/bank-hours/entries', {
        method: 'POST',
        body: JSON.stringify({
          year: selectedYear,
          month: selectedMonth,
          employee_id: employee.employee_id,
          kind: data.kind,
          minutes: total,
          pay_mode: data.kind === 'PAYMENT' ? data.pay_mode : null,
          note: data.note || null
        })
      });
      setEntryModal(null);
      setExpanded((prev) => ({ ...prev, [employee.employee_id]: true }));
      await load();
      flash('Lançamento registrado no banco de horas.');
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEntry = async (entry) => {
    if (!window.confirm(`Excluir o lançamento "${ENTRY_LABELS[entry.kind]}" de ${fmtHours(entry.minutes, false)}?`)) return;
    try {
      await request(`/api/rh/payroll/bank-hours/entries/${entry.id}`, { method: 'DELETE' });
      await load();
      flash('Lançamento excluído.');
    } catch (err) {
      alert(err.message);
    }
  };

  // ==============================================================================
  // --- [RENDERIZAÇÃO] ---
  // ==============================================================================

  const kpi = (label, value, Icon, tone) => (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
      <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-medium">
        <Icon size={14} className={tone} />
        {label}
      </div>
      <div className={`text-lg font-bold mt-1 ${tone}`}>{value}</div>
    </div>
  );

  const renderStatement = (emp) => {
    const b = emp.bank;
    const ag = b.aging || { buckets: [] };
    const line = (key, label, detail, minutes, extra = null, muted = false) => (
      <tr key={key} className="border-t border-slate-800/50">
        <td className={`py-1.5 pl-3 ${muted ? 'text-slate-500' : 'text-slate-300'}`}>{label}</td>
        <td className="py-1.5 text-slate-500">{detail}</td>
        <td className={`py-1.5 pr-3 text-right font-semibold ${balanceTone(minutes)}`}>{fmtHours(minutes)}</td>
        <td className="py-1.5 pr-2 text-right w-10">{extra}</td>
      </tr>
    );

    return (
      <div className="space-y-3">
        {ag.buckets.length > 0 && (
          <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Hourglass size={12} className="text-amber-400" />
                Rastreamento CCT (Aging 3 Meses) • Origem das Horas do Saldo
              </span>
              {ag.expired_minutes > 0 && (
                <button
                  type="button"
                  onClick={() => openEntry(emp, 'PAYMENT')}
                  className="text-[10px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 flex items-center gap-1 font-semibold"
                >
                  <Wallet size={11} /> Pagar {fmtHours(ag.expired_minutes, false)} vencidas na folha
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {ag.buckets.map((bk, i) => {
                const conf = CCT_AGING_STATUS[bk.status] || CCT_AGING_STATUS.CURRENT;
                return (
                  <div key={i} className={`flex items-center gap-2 px-2.5 py-1 rounded-md border text-[11px] ${conf.badgeCls}`} title={conf.desc}>
                    <span className={`w-1.5 h-1.5 rounded-full ${conf.dotCls}`} />
                    <span className="font-semibold">{MONTH_NAMES[bk.month - 1]}/{bk.year}:</span>
                    <span>{fmtHours(bk.remaining_minutes, false)}</span>
                    <span className="text-[10px] opacity-75 font-medium">({conf.label})</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <table className="w-full text-[11px]">
        <thead>
          <tr className="text-slate-500 uppercase tracking-wider text-[9px]">
            <th className="py-1 pl-3 text-left">Movimento</th>
            <th className="py-1 text-left">Detalhe</th>
            <th className="py-1 pr-3 text-right">Horas</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {line('prev', 'Saldo anterior', 'Fim do mês anterior', b.previous_balance_minutes, null, true)}
          {b.movements.map((m, i) => {
            const wd = WEEKDAY_SHORT[new Date(selectedYear, selectedMonth - 1, m.day).getDay()];
            // Fora do saldo: pago na folha do mês a 100% + reflexo no DSR (Súmula 146 TST)
            const outside = m.in_bank === false;
            return line(
              `mv-${m.day}-${m.kind}-${i}`,
              `Dia ${String(m.day).padStart(2, '0')} (${wd})`,
              `Escala • ${MOVEMENT_LABELS[m.kind]}${outside ? ' • pago na folha a 100% + DSR, fora do saldo' : ''}`,
              m.minutes,
              outside ? <span className="text-[9px] font-semibold text-amber-300" title="Não entra no saldo do banco">100%</span> : null,
              outside
            );
          })}
          {b.entries.map((en) => line(
            `en-${en.id}`,
            ENTRY_LABELS[en.kind],
            en.kind === 'PAYMENT'
              ? `${en.pay_mode === 'PAY' ? 'Com acréscimo' : 'Valor normal'}${en.note ? ` • ${en.note}` : ''}`
              : en.note || '',
            en.kind === 'CREDIT' ? en.minutes : -en.minutes,
            <button
              type="button"
              onClick={() => handleDeleteEntry(en)}
              className="p-1 text-slate-500 hover:text-rose-400 rounded hover:bg-slate-800"
              title="Excluir lançamento"
            >
              <Trash2 size={12} />
            </button>
          ))}
          {b.paid_minutes > b.entries.filter((en) => en.kind === 'PAYMENT').reduce((acc, en) => acc + en.minutes, 0) && line(
            'auto-pay',
            'Pagamento automático em folha',
            POLICY_LABELS[b.effective_policy],
            -(b.paid_minutes - b.entries.filter((en) => en.kind === 'PAYMENT').reduce((acc, en) => acc + en.minutes, 0))
          )}
          {b.movements.length === 0 && b.entries.length === 0 && (
            <tr><td colSpan={4} className="py-2 pl-3 text-slate-500">Nenhuma movimentação no mês.</td></tr>
          )}
          <tr className="border-t-2 border-slate-700">
            <td className="py-2 pl-3 font-bold text-white" colSpan={2}>Saldo atual</td>
            <td className={`py-2 pr-3 text-right font-bold text-sm ${balanceTone(b.balance_minutes)}`}>
              {fmtHours(b.balance_minutes)}
            </td>
            <td />
          </tr>
        </tbody>
      </table>
      </div>
    );
  };

  const renderRestWork = () => {
    const rows = employees.flatMap((emp) => (emp.bank.rest_work || []).map((item) => ({ emp, item })));
    if (rows.length === 0) return null;
    const pending = rows.filter((r) => r.item.status === 'PENDENTE').length;
    const btn = 'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border whitespace-nowrap';
    return (
      <div className={`bg-slate-900 border rounded-xl overflow-hidden ${pending ? 'border-rose-500/40' : 'border-slate-800'}`}>
        <div className="px-4 py-3 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-bold text-white">Horas 100% • DSR e feriados trabalhados</h4>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Quitar no próprio mês: folga de um dia inteiro em outro dia (vale para qualquer quantidade de horas)
              ou pagamento em dobro + DSR. Não entram no banco comum.
            </p>
          </div>
          {pending > 0 && (
            <span className="text-[11px] font-semibold text-rose-300 flex items-center gap-1 whitespace-nowrap">
              <AlertCircle size={13} /> {pending} pendente(s): a folha não fecha
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-950/90 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                <th className="py-2 px-3 text-left">Colaborador</th>
                <th className="py-2 px-3 text-left">Dia trabalhado</th>
                <th className="py-2 px-3 text-right">Horas</th>
                <th className="py-2 px-3 text-left">Situação</th>
                <th className="py-2 px-3 text-right">Decisão</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rows.map(({ emp, item }) => {
                const key = `${emp.employee_id}-${item.date}`;
                const st = REST_STATUS[item.status];
                const picking = folgaPick?.key === key;
                const decided = item.status === 'PAGAR' || (item.status === 'FOLGA' && !item.auto);
                return (
                  <tr key={key} className="hover:bg-slate-800/30">
                    <td className="py-2 px-3">
                      <div className="font-semibold text-white">{emp.employee_name}</div>
                      <div className="text-[10px] text-slate-400">{emp.employee_role}</div>
                    </td>
                    <td className="py-2 px-3 text-slate-300">
                      {fmtDay(item.date)} <span className="text-[10px] text-slate-500">• {item.rest_kind === 'FERIADO' ? 'Feriado' : 'DSR'}</span>
                    </td>
                    <td className="py-2 px-3 text-right font-semibold text-amber-300">{fmtHours(item.worked_minutes, false)}</td>
                    <td className="py-2 px-3">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {item.status === 'FOLGA' && `Folga em ${fmtDay(item.folga_date)}${item.auto ? ' (encontrada na escala)' : ''}`}
                        {item.status === 'FOLGA' && item.excess_to_bank_minutes > 0 && ` • ${fmtHours(item.excess_to_bank_minutes)} acima do dia no banco comum`}
                        {item.status === 'PAGAR' && `${fmtHours(item.double_minutes, false)} a 100% + DSR na folha do mês`}
                        {item.status === 'PENDENTE' && `Folga possível entre ${fmtDay(item.window_start)} e ${fmtDay(item.window_end)}`}
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        {picking ? (
                          <>
                            <input
                              type="date"
                              value={folgaPick.date}
                              min={item.window_start}
                              max={item.window_end}
                              onChange={(e) => setFolgaPick({ key, date: e.target.value })}
                              className="bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-white text-[11px] [color-scheme:dark]"
                            />
                            <button
                              type="button"
                              disabled={!folgaPick.date}
                              onClick={() => handleRestDecision(emp, item, 'FOLGA', folgaPick.date)}
                              className={`${btn} border-emerald-500/40 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-40`}
                            >
                              Confirmar
                            </button>
                            <button type="button" onClick={() => setFolgaPick(null)} className="p-1 text-slate-500 hover:text-white">
                              <X size={13} />
                            </button>
                          </>
                        ) : (
                          <>
                            {item.status !== 'FOLGA' && (
                              <button
                                type="button"
                                onClick={() => setFolgaPick({ key, date: '' })}
                                className={`${btn} border-emerald-500/40 text-emerald-300 bg-slate-800 hover:bg-slate-700`}
                              >
                                <CalendarCheck size={12} /> Conceder folga
                              </button>
                            )}
                            {item.status !== 'PAGAR' && (
                              <button
                                type="button"
                                onClick={() => handleRestDecision(emp, item, 'PAGAR')}
                                className={`${btn} border-amber-500/40 text-amber-300 bg-slate-800 hover:bg-slate-700`}
                              >
                                <Wallet size={12} /> Pagar em dobro
                              </button>
                            )}
                            {decided && (
                              <button
                                type="button"
                                onClick={() => handleRestDecision(emp, item, null)}
                                className="p-1 text-slate-500 hover:text-white"
                                title={item.status === 'FOLGA' ? 'Desfazer (o dia volta ao horário do contrato)' : 'Desfazer'}
                              >
                                <Undo2 size={13} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
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

  const renderEntryModal = () => {
    const { employee, data } = entryModal;
    const set = (patch) => setEntryModal({ ...entryModal, data: { ...data, ...patch } });
    const inputCls = 'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500';
    const available = employee.bank.balance_minutes;
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
        <form onSubmit={handleSaveEntry} className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-5 shadow-2xl space-y-4 text-xs">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h4 className="font-bold text-white text-sm">Lançamento no Banco de Horas</h4>
              <p className="text-indigo-300">{employee.employee_name} • {MONTH_NAMES[selectedMonth - 1]}/{selectedYear}</p>
            </div>
            <button type="button" onClick={() => setEntryModal(null)} className="text-slate-400 hover:text-white p-1">
              <X size={16} />
            </button>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 flex items-center justify-between">
            <span className="text-slate-400">Saldo disponível</span>
            <span className={`font-bold ${balanceTone(available)}`}>{fmtHours(available)}</span>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Tipo de lançamento</label>
            <SelectDropdown
              value={data.kind}
              onChange={(val) => set({ kind: val })}
              options={[
                { value: 'PAYMENT', label: 'Pagar horas na folha', subtitle: 'Consome o saldo e vira hora extra na folha' },
                { value: 'DEBIT', label: 'Débito manual', subtitle: 'Consome o saldo (ex: compensação combinada)' },
                { value: 'CREDIT', label: 'Crédito manual', subtitle: 'Soma ao saldo (ex: saldo de implantação)' }
              ]}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Horas</label>
              <input type="number" min="0" value={data.hours} onChange={(e) => set({ hours: e.target.value })} className={inputCls} placeholder="0" />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Minutos</label>
              <input type="number" min="0" max="59" value={data.minutes} onChange={(e) => set({ minutes: e.target.value })} className={inputCls} placeholder="0" />
            </div>
          </div>

          {data.kind === 'PAYMENT' && (
            <div>
              <label className="block text-slate-400 mb-1">Forma de pagamento</label>
              <SelectDropdown
                value={data.pay_mode}
                onChange={(val) => set({ pay_mode: val })}
                options={[
                  { value: 'PAY', label: 'Com acréscimo', subtitle: '% definido nas Regras de RH' },
                  { value: 'PAY_NORMAL', label: 'Valor normal', subtitle: 'Hora simples' }
                ]}
              />
            </div>
          )}

          <div>
            <label className="block text-slate-400 mb-1">
              {data.kind === 'PAYMENT' ? 'Observação (opcional)' : 'Motivo'}
            </label>
            <input
              value={data.note}
              required={data.kind !== 'PAYMENT'}
              onChange={(e) => set({ note: e.target.value })}
              placeholder={data.kind === 'CREDIT' ? 'Ex: Saldo anterior à implantação' : 'Ex: Compensação combinada com o colaborador'}
              className={inputCls}
            />
          </div>

          <p className="text-[11px] text-slate-500">
            Para compensar aos poucos (ex: sair mais cedo durante a semana), ajuste o horário na Grade de Jornada:
            a diferença sai do banco automaticamente, dia a dia.
          </p>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
            <button type="button" onClick={() => setEntryModal(null)} className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-800">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
            >
              {saving && <RefreshCw size={13} className="animate-spin" />}
              Registrar Lançamento
            </button>
          </div>
        </form>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-xs text-slate-400">
        <RefreshCw size={18} className="animate-spin mx-auto mb-2" />
        Carregando banco de horas...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Clock className="text-amber-400" size={18} />
            Banco de Horas • {MONTH_NAMES[selectedMonth - 1]}/{selectedYear}
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Monte a escala do mês e consuma as horas aqui. DSR e feriados trabalhados (100%) são quitados no mês; o banco comum
            acumula entre meses e é consumido com folgas BH, saídas antecipadas, pagamento parcial em folha ou ajustes manuais.
          </p>
        </div>
        {msg && <span className="text-xs font-medium text-emerald-400">{msg}</span>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpi('Saldo a favor dos colaboradores', fmtHours(kpis.positive), TrendingUp, 'text-amber-300')}
        {kpi('Saldo devedor (horas a cumprir)', fmtHours(kpis.negative), TrendingDown, 'text-rose-300')}
        {kpi('Horas pagas em folha no mês', fmtHours(kpis.paid, false), Wallet, 'text-emerald-300')}
        {kpi('Colaboradores com saldo', String(kpis.withBalance), Users, 'text-slate-200')}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-slate-300">
          <Hourglass size={15} className="text-amber-400" />
          <span className="font-semibold text-white">Rastreamento CCT (Prazo Limite de 3 Meses):</span>
          <span className="text-slate-400 text-[11px]">Controle FIFO para concessão de folgas e liquidação de horas</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>Mês 1 (Folgas a conceder): <strong>{fmtHours(kpis.folgaProximo, false)}</strong></span>
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] bg-amber-500/10 text-amber-300 border-amber-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            <span>Mês 2 (Alerta de folga): <strong>{fmtHours(kpis.warning, false)}</strong></span>
          </span>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] ${kpis.expired > 0 ? 'bg-rose-500/20 text-rose-300 border-rose-500/50 font-bold animate-pulse' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${kpis.expired > 0 ? 'bg-rose-400' : 'bg-slate-500'}`} />
            <span>Mês 3+ (Venceu CCT / Pagar): <strong>{fmtHours(kpis.expired, false)}</strong></span>
          </span>
        </div>
      </div>

      {renderRestWork()}

      {employees.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-xs text-slate-400">
          <AlertCircle size={18} className="mx-auto mb-2" />
          Nenhum colaborador ativo.
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-950/90 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                  <th className="py-2.5 px-3 text-left">Colaborador</th>
                  <th className="py-2.5 px-3 text-right">Saldo Anterior</th>
                  <th className="py-2.5 px-3 text-right">Escala do Mês</th>
                  <th className="py-2.5 px-3 text-right">Ajustes</th>
                  <th className="py-2.5 px-3 text-right">Pagas</th>
                  <th className="py-2.5 px-3 text-right">Saldo Atual</th>
                  <th className="py-2.5 px-3 text-left min-w-[200px]">Vencimento CCT / Aging</th>
                  <th className="py-2.5 px-3 text-left min-w-[180px]">Destino do saldo no mês</th>
                  <th className="py-2.5 px-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {employees.map((emp) => {
                  const b = emp.bank;
                  const isOpen = !!expanded[emp.employee_id];
                  return (
                    <React.Fragment key={emp.employee_id}>
                      <tr className="hover:bg-slate-800/30">
                        <td
                          className="py-2.5 px-3 cursor-pointer"
                          onClick={() => setExpanded((prev) => ({ ...prev, [emp.employee_id]: !isOpen }))}
                        >
                          <div className="flex items-center gap-2">
                            {isOpen ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
                            <div>
                              <div className="font-semibold text-white">{emp.employee_name}</div>
                              <div className="text-[10px] text-slate-400">{emp.employee_role}</div>
                            </div>
                          </div>
                        </td>
                        <td className={`py-2.5 px-3 text-right ${balanceTone(b.previous_balance_minutes)}`}>{fmtHours(b.previous_balance_minutes)}</td>
                        <td className={`py-2.5 px-3 text-right ${balanceTone(b.month_balance_minutes)}`}>{fmtHours(b.month_balance_minutes)}</td>
                        <td className={`py-2.5 px-3 text-right ${balanceTone(b.adjustments_minutes)}`}>{fmtHours(b.adjustments_minutes)}</td>
                        <td className="py-2.5 px-3 text-right text-emerald-300">{b.paid_minutes ? fmtHours(b.paid_minutes, false) : '-'}</td>
                        <td className={`py-2.5 px-3 text-right font-bold ${balanceTone(b.balance_minutes)}`}>{fmtHours(b.balance_minutes)}</td>
                        <td className="py-2.5 px-3">
                          {b.balance_minutes <= 0 ? (
                            <span className="text-[10px] text-slate-500">Sem horas a compensar</span>
                          ) : (
                            <div className="flex items-center gap-1 flex-wrap">
                              {(b.aging?.buckets || []).map((bk, i) => {
                                const conf = CCT_AGING_STATUS[bk.status] || CCT_AGING_STATUS.CURRENT;
                                return (
                                  <span
                                    key={i}
                                    title={`${MONTH_NAMES[bk.month - 1]}/${bk.year}: ${fmtHours(bk.remaining_minutes, false)} (${conf.desc})`}
                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${conf.badgeCls}`}
                                  >
                                    <span className={`w-1 h-1 rounded-full ${conf.dotCls}`} />
                                    <span>{String(bk.month).padStart(2, '0')}/{String(bk.year).slice(2)}:</span>
                                    <strong className="font-semibold">{fmtHours(bk.remaining_minutes, false)}</strong>
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <SelectDropdown
                            size="sm"
                            value={b.policy || ''}
                            onChange={(val) => handlePolicy(emp, val)}
                            options={[
                              { value: '', label: 'Padrão', subtitle: POLICY_LABELS[b.employee_policy || b.effective_policy] },
                              ...Object.entries(POLICY_LABELS).map(([value, label]) => ({ value, label }))
                            ]}
                          />
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={() => openEntry(emp)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-indigo-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 whitespace-nowrap"
                          >
                            <Plus size={12} /> Lançamento
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-950/50">
                          <td colSpan={9} className="px-4 py-3">{renderStatement(emp)}</td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {entryModal && renderEntryModal()}
    </div>
  );
}
