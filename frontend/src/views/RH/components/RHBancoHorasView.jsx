import React, { useState, useEffect, useMemo } from 'react';
import {
  Clock, Plus, X, Trash2, ChevronDown, ChevronRight, RefreshCw, Wallet,
  TrendingUp, TrendingDown, Users, AlertCircle
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
  SHORT: 'Saída antecipada / jornada menor',
  FOLGA_BH: 'Folga de banco de horas'
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
    const k = { positive: 0, negative: 0, paid: 0, withBalance: 0 };
    employees.forEach((e) => {
      const b = e.bank.balance_minutes;
      if (b > 0) k.positive += b;
      if (b < 0) k.negative += b;
      if (b !== 0) k.withBalance += 1;
      k.paid += e.bank.paid_minutes;
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
    const line = (key, label, detail, minutes, extra = null, muted = false) => (
      <tr key={key} className="border-t border-slate-800/50">
        <td className={`py-1.5 pl-3 ${muted ? 'text-slate-500' : 'text-slate-300'}`}>{label}</td>
        <td className="py-1.5 text-slate-500">{detail}</td>
        <td className={`py-1.5 pr-3 text-right font-semibold ${balanceTone(minutes)}`}>{fmtHours(minutes)}</td>
        <td className="py-1.5 pr-2 text-right w-10">{extra}</td>
      </tr>
    );

    return (
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
          {b.movements.map((m) => {
            const wd = WEEKDAY_SHORT[new Date(selectedYear, selectedMonth - 1, m.day).getDay()];
            return line(
              `mv-${m.day}`,
              `Dia ${String(m.day).padStart(2, '0')} (${wd})`,
              `Escala • ${MOVEMENT_LABELS[m.kind]}`,
              m.minutes
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
            Horas além ou aquém da jornada entram pela escala, dia a dia. Consuma o saldo com folgas BH, saídas antecipadas,
            pagamento parcial em folha ou ajustes manuais.
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
                  <th className="py-2.5 px-3 text-left min-w-[200px]">Destino do saldo no mês</th>
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
                          <td colSpan={8} className="px-4 py-3">{renderStatement(emp)}</td>
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
