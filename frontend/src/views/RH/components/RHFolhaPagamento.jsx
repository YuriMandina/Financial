import React, { useState, useEffect, useMemo } from 'react';
import {
  Wallet, Calculator, RefreshCw, Plus, Edit2, Trash2, X, ChevronDown, ChevronRight,
  ListChecks, Lock, TrendingUp, TrendingDown, Landmark, Gift, AlertCircle
} from 'lucide-react';
import SelectDropdown from '../../../components/common/SelectDropdown';
import StyledCheckbox from '../../../components/common/StyledCheckbox';

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Aceita "3.000,50", "3000,50" e "3000.50"
const parseMoney = (value) => {
  const str = String(value ?? '').trim();
  if (!str) return 0;
  const normalized = str.includes(',') ? str.replace(/\./g, '').replace(',', '.') : str;
  return parseFloat(normalized) || 0;
};

const toInputMoney = (v) => Number(v || 0).toFixed(2).replace('.', ',');

const EMPTY_ITEM = {
  code: '',
  name: '',
  kind: 'RECEITA',
  calc_type: 'FIXED',
  default_value: '0,00',
  recurring: false,
  incide_inss: true,
  incide_irrf: true,
  incide_fgts: true,
  active: true
};

export default function RHFolhaPagamento({ token, apiBase, selectedYear, selectedMonth }) {
  const [view, setView] = useState('folha'); // 'folha' | 'rubricas'
  const [loading, setLoading] = useState(true);
  const [payroll, setPayroll] = useState(null);
  const [items, setItems] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [msg, setMsg] = useState('');

  // Modal de rubrica
  const [itemModal, setItemModal] = useState(null); // { id?, data, system }
  // Modal de lançamento
  const [entryModal, setEntryModal] = useState(null); // { employee, entry?, data }

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

  // ==============================================================================
  // --- [CARREGAMENTO] ---
  // ==============================================================================

  // Recargas do mesmo mês (após salvar) não exibem o carregamento, preservando o scroll
  const loadedPeriodRef = React.useRef(null);

  const loadAll = async () => {
    const period = `${selectedYear}-${selectedMonth}`;
    try {
      if (loadedPeriodRef.current !== period) setLoading(true);
      const [p, its] = await Promise.all([
        request(`/api/rh/payroll?year=${selectedYear}&month=${selectedMonth}`),
        request('/api/rh/payroll/items')
      ]);
      loadedPeriodRef.current = period;
      setPayroll(p);
      setItems(its);
    } catch (err) {
      alert('Falha ao carregar a folha: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [selectedYear, selectedMonth]);

  // ==============================================================================
  // --- [RUBRICAS] ---
  // ==============================================================================

  const openNewItem = () => setItemModal({ data: { ...EMPTY_ITEM }, system: false });

  const openEditItem = (item) => setItemModal({
    id: item.id,
    system: Boolean(item.system_key),
    data: { ...item, default_value: toInputMoney(item.default_value) }
  });

  const handleSaveItem = async (e) => {
    e.preventDefault();
    const { id, data, system } = itemModal;
    const payload = !system
      ? { ...data, default_value: parseMoney(data.default_value) }
      : data.configurable
        ? {
          code: data.code,
          name: data.name,
          active: data.active,
          default_value: parseMoney(data.default_value),
          incide_inss: data.incide_inss,
          incide_irrf: data.incide_irrf,
          incide_fgts: data.incide_fgts
        }
        : { code: data.code, name: data.name, active: data.active };
    try {
      await request(id ? `/api/rh/payroll/items/${id}` : '/api/rh/payroll/items', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
      });
      setItemModal(null);
      await loadAll();
      flash(id ? 'Rubrica atualizada.' : 'Rubrica cadastrada.');
    } catch (err) {
      alert('Erro ao salvar rubrica: ' + err.message);
    }
  };

  const handleDeleteItem = async (item) => {
    if (!window.confirm(`Excluir a rubrica "${item.code} - ${item.name}"?`)) return;
    try {
      await request(`/api/rh/payroll/items/${item.id}`, { method: 'DELETE' });
      await loadAll();
      flash('Rubrica excluída.');
    } catch (err) {
      alert(err.message);
    }
  };

  // ==============================================================================
  // --- [LANÇAMENTOS] ---
  // ==============================================================================

  const selectableItems = useMemo(
    () => items.filter((it) => it.active && !['INSS', 'IRRF', 'FGTS'].includes(it.system_key)),
    [items]
  );

  const suggestedAmount = (item, employee) => {
    if (!item) return '';
    if (item.calc_type === 'PERCENT') return toInputMoney((employee.base_salary || 0) * (item.default_value || 0) / 100);
    return item.default_value ? toInputMoney(item.default_value) : '';
  };

  const openNewEntry = (employee) => setEntryModal({
    employee,
    data: { item_id: '', amount: '', reference: '', notes: '' }
  });

  const openEditEntry = (employee, entry) => setEntryModal({
    employee,
    entry,
    data: {
      item_id: entry.item_id,
      amount: toInputMoney(entry.amount),
      reference: entry.reference || '',
      notes: entry.notes || ''
    }
  });

  const handleSaveEntry = async (e) => {
    e.preventDefault();
    const { employee, entry, data } = entryModal;
    if (!entry && !data.item_id) {
      alert('Selecione a rubrica.');
      return;
    }
    const amount = parseMoney(data.amount);
    try {
      if (entry) {
        await request(`/api/rh/payroll/entries/${entry.id}`, {
          method: 'PUT',
          body: JSON.stringify({ amount, reference: data.reference, notes: data.notes })
        });
      } else {
        await request('/api/rh/payroll/entries', {
          method: 'POST',
          body: JSON.stringify({
            year: selectedYear,
            month: selectedMonth,
            employee_id: employee.employee_id,
            item_id: parseInt(data.item_id, 10),
            amount,
            reference: data.reference || null,
            notes: data.notes || null
          })
        });
      }
      setEntryModal(null);
      setExpanded((prev) => ({ ...prev, [employee.employee_id]: true }));
      await loadAll();
      flash('Lançamento salvo e encargos recalculados.');
    } catch (err) {
      alert('Erro ao salvar lançamento: ' + err.message);
    }
  };

  const handleDeleteEntry = async (entry) => {
    if (!window.confirm(`Excluir o lançamento "${entry.name}"?`)) return;
    try {
      await request(`/api/rh/payroll/entries/${entry.id}`, { method: 'DELETE' });
      await loadAll();
      flash('Lançamento excluído e encargos recalculados.');
    } catch (err) {
      alert(err.message);
    }
  };

  // ==============================================================================
  // --- [RENDERIZAÇÃO] ---
  // ==============================================================================

  const totals = payroll?.totals || {};
  const employees = payroll?.employees || [];
  const missingSalary = employees.filter((e) => !e.base_salary);
  const missingAdmission = employees.filter((e) => !e.admission_date);

  const renderKpi = (label, value, Icon, tone) => (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
      <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-medium">
        <Icon size={14} className={tone} />
        {label}
      </div>
      <div className={`text-lg font-bold mt-1 ${tone}`}>{brl(value)}</div>
    </div>
  );

  const renderFolha = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {renderKpi('Receitas (Proventos)', totals.receitas, TrendingUp, 'text-emerald-300')}
        {renderKpi('Despesas (Descontos)', totals.despesas, TrendingDown, 'text-rose-300')}
        {renderKpi('Líquido a Pagar', totals.liquido, Wallet, 'text-white')}
        {renderKpi('FGTS (Encargo)', totals.fgts, Landmark, 'text-sky-300')}
        {renderKpi('Benefícios (VA)', totals.beneficios, Gift, 'text-purple-300')}
      </div>

      {missingSalary.length > 0 && (
        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-xs text-amber-200">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>
            {missingSalary.length} colaborador(es) sem salário base cadastrado: {missingSalary.map((e) => e.employee_name).join(', ')}.
            Cadastre em "Equipe, Cargos & Parâmetros".
          </span>
        </div>
      )}

      {missingAdmission.length > 0 && (
        <div className="flex items-start gap-2 bg-slate-800/40 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-300">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-slate-400" />
          <span>
            {missingAdmission.length} colaborador(es) sem data de admissão (triênio não calculado): {missingAdmission.map((e) => e.employee_name).join(', ')}.
          </span>
        </div>
      )}

      {employees.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-indigo-600/20 text-indigo-400 mx-auto flex items-center justify-center">
            <Calculator size={24} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Nenhum colaborador ativo</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
              Cadastre a equipe em "Equipe, Cargos & Parâmetros". A folha é calculada automaticamente a partir do salário,
              da escala do mês, das rubricas e das configurações.
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-950/90 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                  <th className="py-2.5 px-3 text-left">Colaborador</th>
                  <th className="py-2.5 px-3 text-right">Salário Base</th>
                  <th className="py-2.5 px-3 text-right">Receitas</th>
                  <th className="py-2.5 px-3 text-right">Despesas</th>
                  <th className="py-2.5 px-3 text-right">Líquido</th>
                  <th className="py-2.5 px-3 text-right">FGTS</th>
                  <th className="py-2.5 px-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {employees.map((emp) => {
                  const isOpen = !!expanded[emp.employee_id];
                  return (
                    <React.Fragment key={emp.employee_id}>
                      <tr
                        className="hover:bg-slate-800/30 cursor-pointer"
                        onClick={() => setExpanded((prev) => ({ ...prev, [emp.employee_id]: !isOpen }))}
                      >
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            {isOpen ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
                            <div>
                              <div className="font-semibold text-white">{emp.employee_name}</div>
                              <div className="text-[10px] text-slate-400">{emp.employee_role}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-300">{brl(emp.base_salary)}</td>
                        <td className="py-2.5 px-3 text-right text-emerald-300">{brl(emp.totals.receitas)}</td>
                        <td className="py-2.5 px-3 text-right text-rose-300">{brl(emp.totals.despesas)}</td>
                        <td className="py-2.5 px-3 text-right font-bold text-white">{brl(emp.totals.liquido)}</td>
                        <td className="py-2.5 px-3 text-right text-sky-300">{brl(emp.totals.fgts)}</td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={(e) => { e.stopPropagation(); openNewEntry(emp); }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-indigo-300 bg-slate-800 hover:bg-slate-700 border border-slate-700"
                          >
                            <Plus size={12} /> Lançamento
                          </button>
                        </td>
                      </tr>

                      {isOpen && (
                        <tr className="bg-slate-950/50">
                          <td colSpan={7} className="px-4 py-3">
                            <table className="w-full text-[11px]">
                              <thead>
                                <tr className="text-slate-500 uppercase tracking-wider text-[9px]">
                                  <th className="py-1 text-left w-14">Cód.</th>
                                  <th className="py-1 text-left">Rubrica</th>
                                  <th className="py-1 text-left">Referência</th>
                                  <th className="py-1 text-right">Receita</th>
                                  <th className="py-1 text-right">Despesa</th>
                                  <th className="py-1 text-center">Origem</th>
                                  <th className="py-1 w-16" />
                                </tr>
                              </thead>
                              <tbody>
                                {emp.entries.length === 0 && (
                                  <tr>
                                    <td colSpan={7} className="py-2 text-slate-500">Nenhum lançamento.</td>
                                  </tr>
                                )}
                                {emp.entries.map((en) => {
                                  const informative = !en.affects_net;
                                  return (
                                    <tr key={en.id} className={`border-t border-slate-800/50 ${informative ? 'opacity-60' : ''}`}>
                                      <td className="py-1.5 text-slate-500">{en.code}</td>
                                      <td className="py-1.5 text-slate-200">
                                        {en.name}
                                        {informative && <span className="ml-1.5 text-[9px] text-slate-500">(informativo)</span>}
                                        {en.notes && <div className="text-[10px] text-slate-500">{en.notes}</div>}
                                      </td>
                                      <td className="py-1.5 text-slate-400">{en.reference || '-'}</td>
                                      <td className="py-1.5 text-right text-emerald-300">{en.kind === 'RECEITA' ? brl(en.amount) : ''}</td>
                                      <td className="py-1.5 text-right text-rose-300">{en.kind === 'DESPESA' ? brl(en.amount) : ''}</td>
                                      <td className="py-1.5 text-center">
                                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                                          en.source === 'AUTO'
                                            ? 'bg-slate-800 text-slate-400 border-slate-700'
                                            : 'bg-indigo-600/20 text-indigo-300 border-indigo-500/40'
                                        }`}>
                                          {en.source === 'AUTO' ? 'AUTO' : 'MANUAL'}
                                        </span>
                                      </td>
                                      <td className="py-1.5 text-right whitespace-nowrap">
                                        <button
                                          onClick={() => openEditEntry(emp, en)}
                                          className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800"
                                          title="Editar valor"
                                        >
                                          <Edit2 size={12} />
                                        </button>
                                        <button
                                          onClick={() => handleDeleteEntry(en)}
                                          disabled={en.source === 'AUTO'}
                                          className="p-1 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-800 disabled:opacity-25 disabled:cursor-not-allowed"
                                          title={en.source === 'AUTO' ? 'Lançamento automático: edite o valor para fixá-lo' : 'Excluir lançamento'}
                                        >
                                          <Trash2 size={12} />
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </td>
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
    </div>
  );

  const renderIncidence = (label, on) => (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${
      on ? 'bg-slate-800 text-slate-300 border-slate-700' : 'text-slate-600 border-slate-800 line-through'
    }`}>
      {label}
    </span>
  );

  const renderRubricas = () => (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div>
          <h4 className="text-sm font-bold text-white">Rubricas da Folha</h4>
          <p className="text-[11px] text-slate-400">
            Receitas somam ao líquido e despesas descontam. Rubricas em uso ou do sistema não podem ser excluídas.
          </p>
        </div>
        <button
          onClick={openNewItem}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white"
        >
          <Plus size={14} /> Nova Rubrica
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-950/90 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
              <th className="py-2.5 px-3 text-left">Cód.</th>
              <th className="py-2.5 px-3 text-left">Rubrica</th>
              <th className="py-2.5 px-3 text-left">Tipo</th>
              <th className="py-2.5 px-3 text-left">Cálculo</th>
              <th className="py-2.5 px-3 text-left">Incidências</th>
              <th className="py-2.5 px-3 text-center">Lançamentos</th>
              <th className="py-2.5 px-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {items.map((it) => (
              <tr key={it.id} className={`hover:bg-slate-800/30 ${it.active ? '' : 'opacity-50'}`}>
                <td className="py-2 px-3 text-slate-400">{it.code}</td>
                <td className="py-2 px-3">
                  <div className="font-semibold text-white flex items-center gap-1.5">
                    {it.name}
                    {it.system_key && (
                      <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-slate-400 bg-slate-800 border border-slate-700 px-1 rounded">
                        <Lock size={9} /> SISTEMA
                      </span>
                    )}
                    {!it.active && <span className="text-[9px] text-slate-500">(inativa)</span>}
                  </div>
                  {it.recurring && <div className="text-[10px] text-indigo-300">Recorrente: lançada para todos no cálculo</div>}
                </td>
                <td className="py-2 px-3">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                    it.kind === 'RECEITA'
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                  }`}>
                    {it.kind === 'RECEITA' ? 'Receita' : 'Despesa'}
                  </span>
                  {!it.affects_net && <span className="ml-1 text-[9px] text-slate-500">informativa</span>}
                </td>
                <td className="py-2 px-3 text-slate-300">
                  {it.configurable
                    ? `${Number(it.default_value).toLocaleString('pt-BR')}% por triênio`
                    : it.system_key
                    ? <span className="text-slate-500">Automático</span>
                    : it.calc_type === 'PERCENT'
                      ? `${Number(it.default_value).toLocaleString('pt-BR')}% do salário`
                      : it.default_value ? brl(it.default_value) : 'Valor no lançamento'}
                </td>
                <td className="py-2 px-3">
                  <div className="flex gap-1">
                    {renderIncidence('INSS', it.incide_inss)}
                    {renderIncidence('IRRF', it.incide_irrf)}
                    {renderIncidence('FGTS', it.incide_fgts)}
                  </div>
                </td>
                <td className="py-2 px-3 text-center text-slate-400">{it.usage_count}</td>
                <td className="py-2 px-3 text-right whitespace-nowrap">
                  <button
                    onClick={() => openEditItem(it)}
                    className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800"
                    title="Editar rubrica"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={() => handleDeleteItem(it)}
                    disabled={!it.can_delete}
                    className="p-1.5 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-800 disabled:opacity-25 disabled:cursor-not-allowed"
                    title={
                      it.system_key
                        ? 'Rubrica do sistema não pode ser excluída'
                        : it.usage_count > 0
                          ? `Em uso em ${it.usage_count} lançamento(s): desative em vez de excluir`
                          : 'Excluir rubrica'
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderItemModal = () => {
    const { id, data, system } = itemModal;
    const set = (patch) => setItemModal({ ...itemModal, data: { ...data, ...patch } });
    const inputCls = 'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50';
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
        <form onSubmit={handleSaveItem} className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-5 shadow-2xl space-y-4 text-xs">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h4 className="font-bold text-white text-sm">{id ? 'Editar Rubrica' : 'Nova Rubrica'}</h4>
            <button type="button" onClick={() => setItemModal(null)} className="text-slate-400 hover:text-white p-1">
              <X size={16} />
            </button>
          </div>

          {system && (
            <div className="flex items-start gap-2 bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-400">
              <Lock size={13} className="mt-0.5 shrink-0" />
              {data.configurable
                ? 'Rubrica calculada automaticamente: código, nome, percentual, incidências e situação podem ser alterados.'
                : 'Rubrica calculada automaticamente pelo sistema: apenas código, nome e situação podem ser alterados.'}
            </div>
          )}

          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Código</label>
              <input required value={data.code} onChange={(e) => set({ code: e.target.value })} className={inputCls} />
            </div>
            <div className="col-span-3">
              <label className="block text-slate-400 mb-1">Nome</label>
              <input required value={data.name} onChange={(e) => set({ name: e.target.value })} className={inputCls} placeholder="Ex: Gratificação de Função" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Tipo</label>
              <SelectDropdown
                value={data.kind}
                onChange={(val) => !system && set({ kind: val })}
                disabled={system}
                options={[
                  { value: 'RECEITA', label: 'Receita (provento)' },
                  { value: 'DESPESA', label: 'Despesa (desconto)' }
                ]}
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Forma de Cálculo</label>
              <SelectDropdown
                value={data.calc_type}
                onChange={(val) => !system && set({ calc_type: val })}
                disabled={system}
                options={[
                  { value: 'FIXED', label: 'Valor fixo (R$)' },
                  { value: 'PERCENT', label: '% do salário base' }
                ]}
              />
            </div>
          </div>

          {system && data.configurable && (
            <>
              <div>
                <label className="block text-slate-400 mb-1">Percentual por triênio (% do salário base)</label>
                <input
                  inputMode="decimal"
                  value={data.default_value}
                  onChange={(e) => set({ default_value: e.target.value.replace(/[^0-9.,]/g, '') })}
                  className={inputCls}
                />
                <span className="text-[10px] text-slate-500">
                  Acumulativo: aplicado uma vez para cada 3 anos completos desde a admissão (ex: 7 anos = 2 triênios).
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <StyledCheckbox checked={data.incide_inss} onChange={(c) => set({ incide_inss: c })} label="Incide INSS" />
                <StyledCheckbox checked={data.incide_irrf} onChange={(c) => set({ incide_irrf: c })} label="Incide IRRF" />
                <StyledCheckbox checked={data.incide_fgts} onChange={(c) => set({ incide_fgts: c })} label="Incide FGTS" />
              </div>
            </>
          )}

          {!system && (
            <>
              <div>
                <label className="block text-slate-400 mb-1">
                  {data.calc_type === 'PERCENT' ? 'Percentual sobre o salário (%)' : 'Valor padrão (R$)'}
                </label>
                <input
                  inputMode="decimal"
                  value={data.default_value}
                  onChange={(e) => set({ default_value: e.target.value.replace(/[^0-9.,]/g, '') })}
                  className={inputCls}
                />
                <span className="text-[10px] text-slate-500">Sugerido ao lançar; obrigatório se a rubrica for recorrente.</span>
              </div>

              <div className="space-y-2">
                <StyledCheckbox
                  checked={data.recurring}
                  onChange={(checked) => set({ recurring: checked })}
                  label="Recorrente"
                  description="Lançada automaticamente para todos os colaboradores ao calcular a folha"
                />
                <div className="grid grid-cols-3 gap-2">
                  <StyledCheckbox checked={data.incide_inss} onChange={(c) => set({ incide_inss: c })} label="Incide INSS" />
                  <StyledCheckbox checked={data.incide_irrf} onChange={(c) => set({ incide_irrf: c })} label="Incide IRRF" />
                  <StyledCheckbox checked={data.incide_fgts} onChange={(c) => set({ incide_fgts: c })} label="Incide FGTS" />
                </div>
              </div>
            </>
          )}

          <StyledCheckbox
            checked={data.active}
            onChange={(checked) => set({ active: checked })}
            label="Ativa"
            description="Rubricas inativas não aparecem para novos lançamentos nem entram no cálculo"
          />

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
            <button type="button" onClick={() => setItemModal(null)} className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-800">
              Cancelar
            </button>
            <button type="submit" className="px-4 py-1.5 rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-500 text-white">
              Salvar Rubrica
            </button>
          </div>
        </form>
      </div>
    );
  };

  const renderEntryModal = () => {
    const { employee, entry, data } = entryModal;
    const set = (patch) => setEntryModal({ ...entryModal, data: { ...data, ...patch } });
    const inputCls = 'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500';
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
        <form onSubmit={handleSaveEntry} className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-5 shadow-2xl space-y-4 text-xs">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h4 className="font-bold text-white text-sm">{entry ? 'Editar Lançamento' : 'Novo Lançamento'}</h4>
              <p className="text-indigo-300">{employee.employee_name} • {MONTH_NAMES[selectedMonth - 1]}/{selectedYear}</p>
            </div>
            <button type="button" onClick={() => setEntryModal(null)} className="text-slate-400 hover:text-white p-1">
              <X size={16} />
            </button>
          </div>

          {entry ? (
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
              <div className="font-semibold text-white">{entry.code} • {entry.name}</div>
              {entry.source === 'AUTO' && (
                <div className="text-[11px] text-amber-300 mt-1">
                  Valor calculado automaticamente. Ao salvar, ele passa a ser manual e prevalece nos próximos cálculos.
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-slate-400 mb-1">Rubrica</label>
              <SelectDropdown
                value={data.item_id}
                searchable={selectableItems.length > 6}
                placeholder="Selecione a rubrica"
                onChange={(val) => {
                  const it = items.find((i) => i.id === parseInt(val, 10));
                  set({ item_id: val, amount: suggestedAmount(it, employee) });
                }}
                options={selectableItems.map((it) => ({
                  value: it.id,
                  label: `${it.code} • ${it.name}`,
                  subtitle: it.kind === 'RECEITA' ? 'Receita' : 'Despesa'
                }))}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Valor (R$)</label>
              <input
                required
                inputMode="decimal"
                placeholder="0,00"
                value={data.amount}
                onChange={(e) => set({ amount: e.target.value.replace(/[^0-9.,]/g, '') })}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Referência</label>
              <input
                value={data.reference}
                onChange={(e) => set({ reference: e.target.value })}
                placeholder="Ex: 10h, 2 dias"
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Observação</label>
            <input value={data.notes} onChange={(e) => set({ notes: e.target.value })} className={inputCls} />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
            <button type="button" onClick={() => setEntryModal(null)} className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-800">
              Cancelar
            </button>
            <button type="submit" className="px-4 py-1.5 rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-500 text-white">
              Salvar Lançamento
            </button>
          </div>
        </form>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Barra de Ferramentas */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Wallet className="text-indigo-400" size={18} />
            Folha de Pagamento • {MONTH_NAMES[selectedMonth - 1]}/{selectedYear}
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Receitas e despesas por colaborador, com horas extras, faltas e benefícios vindos da jornada.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-slate-950 border border-slate-800 rounded-lg p-0.5">
            <button
              onClick={() => setView('folha')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold ${
                view === 'folha' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Wallet size={13} /> Folha do Mês
            </button>
            <button
              onClick={() => setView('rubricas')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold ${
                view === 'rubricas' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <ListChecks size={13} /> Rubricas
            </button>
          </div>

          {msg && <span className="text-xs font-medium text-emerald-400">{msg}</span>}
        </div>
      </div>

      {loading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-xs text-slate-400">
          <RefreshCw size={18} className="animate-spin mx-auto mb-2" />
          Carregando folha...
        </div>
      ) : view === 'folha' ? renderFolha() : renderRubricas()}

      {itemModal && renderItemModal()}
      {entryModal && renderEntryModal()}
    </div>
  );
}
