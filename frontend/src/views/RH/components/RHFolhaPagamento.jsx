import React, { useState, useEffect, useMemo } from 'react';
import {
  Wallet, Calculator, RefreshCw, Plus, Edit2, Trash2, X, ChevronDown, ChevronRight,
  ListChecks, Lock, TrendingUp, TrendingDown, Landmark, Gift, AlertCircle, BarChart3, Building2, Users, HandCoins, Printer
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

const fmtHours = (minutes) => {
  const m = Number(minutes || 0);
  const sign = m < 0 ? '-' : m > 0 ? '+' : '';
  const abs = Math.abs(m);
  return `${sign}${Math.floor(abs / 60)}h${String(abs % 60).padStart(2, '0')}`;
};


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

// Quadro de impressão: o cabeçalho e o rodapé vazios se repetem em cada página e
// garantem a margem vertical mesmo quando o navegador ignora a margem do @page.
const PRINT_FRAME_CSS = `
@media print {
  @page { size: A4 portrait; margin: 0 10mm; }
  table.print-page-frame, table.print-page-frame > * > tr > td { border: none !important; padding: 0 !important; }
  table.print-page-frame > thead { display: table-header-group !important; }
  table.print-page-frame > tfoot { display: table-footer-group !important; }
  table.print-page-frame > tbody > tr { break-inside: auto !important; page-break-inside: auto !important; }
  table.print-page-frame td.print-nowrap, table.print-page-frame th.print-nowrap {
    white-space: nowrap !important; word-break: keep-all !important; overflow-wrap: normal !important;
  }
}`;

const PrintFrame = ({ children }) => (
  <div className="hidden print:block text-black bg-white">
    <style>{PRINT_FRAME_CSS}</style>
    <table className="print-page-frame w-full">
      <thead><tr><td><div style={{ height: '10mm' }} /></td></tr></thead>
      <tfoot><tr><td><div style={{ height: '10mm' }} /></td></tr></tfoot>
      <tbody><tr><td>{children}</td></tr></tbody>
    </table>
  </div>
);

export default function RHFolhaPagamento({ token, apiBase, selectedYear, selectedMonth }) {
  const [view, setView] = useState('folha'); // 'folha' | 'totais' | 'rubricas'
  const [loading, setLoading] = useState(true);
  const [payroll, setPayroll] = useState(null);
  const [items, setItems] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [treeOpen, setTreeOpen] = useState({ RECEITA: true, DESPESA: true, INFO: false }); // grupos e rubricas abertos
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

  // ==============================================================================
  // --- [ADIANTAMENTO SALARIAL] ---
  // ==============================================================================

  const [advanceSaving, setAdvanceSaving] = useState(false);

  // Impressão dos totais: detalhada (com colaboradores) ou resumida (só rubricas)
  const [printDetailed, setPrintDetailed] = useState(true);
  const printTotais = (detailed) => {
    setPrintDetailed(detailed);
    setTimeout(() => window.print(), 50);
  };

  const handleToggleAdvance = async (employeeIds, enabled) => {
    if (employeeIds.length === 0) return;
    setAdvanceSaving(true);
    try {
      await request('/api/rh/payroll/advances', {
        method: 'PUT',
        body: JSON.stringify({ year: selectedYear, month: selectedMonth, employee_ids: employeeIds, enabled })
      });
      await loadAll();
    } catch (err) {
      alert('Falha ao atualizar o adiantamento: ' + err.message);
    } finally {
      setAdvanceSaving(false);
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
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {renderKpi('Proventos', totals.receitas, TrendingUp, 'text-emerald-300')}
        {renderKpi('Descontos', totals.despesas, TrendingDown, 'text-rose-300')}
        {renderKpi('Adiantamento Salarial', totals.adiantamento, HandCoins, 'text-amber-300')}
        {renderKpi('Líquido a Pagar', totals.liquido, Wallet, 'text-white')}
        {renderKpi('FGTS (Encargo)', totals.fgts, Landmark, 'text-sky-300')}
        {renderKpi('Benefícios (VA)', totals.beneficios, Gift, 'text-purple-300')}
      </div>

      {missingSalary.length > 0 && (
        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-xs text-amber-200">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>
            {missingSalary.length} colaborador(es) sem salário (sem cargo ou cargo sem salário): {missingSalary.map((e) => e.employee_name).join(', ')}.
            Defina o cargo e o salário do cargo em "Equipe, Cargos & Parâmetros".
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
                  <th className="py-2.5 px-3 text-right">Proventos</th>
                  <th className="py-2.5 px-3 text-right">Descontos</th>
                  <th className="py-2.5 px-3 text-center">
                    <div className="inline-flex items-center gap-1.5 normal-case tracking-normal">
                      <StyledCheckbox
                        size="sm"
                        checked={employees.length > 0 && employees.every((e) => e.advance?.enabled)}
                        disabled={advanceSaving}
                        onChange={(checked) => handleToggleAdvance(employees.map((e) => e.employee_id), checked)}
                      />
                      <span className="uppercase tracking-wider">Adiantamento</span>
                    </div>
                  </th>
                  <th className="py-2.5 px-3 text-right">Líquido</th>
                  <th className="py-2.5 px-3 text-right">FGTS</th>
                  <th className="py-2.5 px-3 text-right">Banco de Horas</th>
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
                        <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-2">
                            <StyledCheckbox
                              size="sm"
                              checked={!!emp.advance?.enabled}
                              disabled={advanceSaving}
                              onChange={(checked) => handleToggleAdvance([emp.employee_id], checked)}
                            />
                            <span className={`min-w-[72px] text-right ${emp.advance?.enabled ? 'text-amber-300 font-semibold' : 'text-slate-600'}`}>
                              {emp.advance?.enabled ? brl(emp.advance.amount) : 'Não pagar'}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-white">{brl(emp.totals.liquido)}</td>
                        <td className="py-2.5 px-3 text-right text-sky-300">{brl(emp.totals.fgts)}</td>
                        <td className={`py-2.5 px-3 text-right font-semibold ${
                          emp.bank.balance_minutes > 0 ? 'text-amber-300' : emp.bank.balance_minutes < 0 ? 'text-rose-300' : 'text-slate-500'
                        }`}>
                          {fmtHours(emp.bank.balance_minutes)}
                        </td>
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
                          <td colSpan={9} className="px-4 py-3">
                            <table className="w-full text-[11px]">
                              <thead>
                                <tr className="text-slate-500 uppercase tracking-wider text-[9px]">
                                  <th className="py-1 text-left w-14">Cód.</th>
                                  <th className="py-1 text-left">Rubrica</th>
                                  <th className="py-1 text-left">Referência</th>
                                  <th className="py-1 text-right">Provento</th>
                                  <th className="py-1 text-right">Desconto</th>
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
              <tfoot>
                <tr className="border-t-2 border-slate-700 bg-slate-950/70 font-bold">
                  <td className="py-2.5 px-3 text-slate-300 uppercase tracking-wider text-[10px]">
                    Total ({employees.length} colaboradores)
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-300">
                    {brl(employees.reduce((acc, e) => acc + (e.base_salary || 0), 0))}
                  </td>
                  <td className="py-2.5 px-3 text-right text-emerald-300">{brl(totals.receitas)}</td>
                  <td className="py-2.5 px-3 text-right text-rose-300">{brl(totals.despesas)}</td>
                  <td className="py-2.5 px-3 text-right text-amber-300">{brl(totals.adiantamento)}</td>
                  <td className="py-2.5 px-3 text-right text-white">{brl(totals.liquido)}</td>
                  <td className="py-2.5 px-3 text-right text-sky-300">{brl(totals.fgts)}</td>
                  <td className="py-2.5 px-3 text-right text-amber-300">
                    {fmtHours(employees.reduce((acc, e) => acc + (e.bank?.balance_minutes || 0), 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );

  // ==============================================================================
  // --- [TOTAIS DETALHADOS] ---
  // ==============================================================================

  // Árvore: Grupo (Receitas/Despesas/Informativos) > Rubrica > Colaborador, com subtotais
  const renderHierarchy = (receitas, despesas, informativos) => {
    const toggle = (key) => setTreeOpen((prev) => ({ ...prev, [key]: !prev[key] }));
    const groupTotal = (rows) => rows.reduce((acc, r) => acc + r.total, 0);
    const pct = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1).replace('.', ',')}%` : '-');

    const renderGroup = (key, label, rows, tone, sign) => {
      const total = groupTotal(rows);
      const open = !!treeOpen[key];
      return (
        <React.Fragment key={key}>
          <tr className="bg-slate-950/80 border-t border-slate-700 cursor-pointer hover:bg-slate-800/40" onClick={() => toggle(key)}>
            <td className="py-2.5 px-3" colSpan={2}>
              <div className={`flex items-center gap-2 font-bold uppercase tracking-wider text-[11px] ${tone}`}>
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {sign && <span className="w-3 text-center">{sign}</span>}
                {label}
                <span className="text-[10px] font-normal normal-case tracking-normal text-slate-500">
                  {rows.length} rubrica(s)
                </span>
              </div>
            </td>
            <td />
            <td className={`py-2.5 px-3 text-right font-bold ${tone}`}>{brl(total)}</td>
            <td />
          </tr>
          {open && rows.length === 0 && (
            <tr><td colSpan={5} className="py-2 pl-12 text-slate-500">Nenhum lançamento.</td></tr>
          )}
          {open && rows.map((r) => {
            const itemKey = `item-${r.item_id}`;
            const itemOpen = !!treeOpen[itemKey];
            return (
              <React.Fragment key={itemKey}>
                <tr className="border-t border-slate-800/60 cursor-pointer hover:bg-slate-800/30" onClick={() => toggle(itemKey)}>
                  <td className="py-1.5 pl-9 pr-3" colSpan={2}>
                    <div className="flex items-center gap-2">
                      {itemOpen ? <ChevronDown size={12} className="text-slate-500" /> : <ChevronRight size={12} className="text-slate-500" />}
                      <span className="text-slate-500 w-8">{r.code}</span>
                      <span className="font-semibold text-slate-200">{r.name}</span>
                    </div>
                  </td>
                  <td className="py-1.5 px-3 text-center text-slate-400">{r.employees}</td>
                  <td className={`py-1.5 px-3 text-right font-semibold ${tone}`}>{brl(r.total)}</td>
                  <td className="py-1.5 px-3 text-right text-slate-500">{pct(r.total, total)}</td>
                </tr>
                {itemOpen && r.details.map((d) => (
                  <tr key={`${itemKey}-${d.employee_id}`} className="bg-slate-950/40">
                    <td className="py-1 pl-20 pr-3 text-slate-300">
                      {d.employee_name}
                      <span className="ml-1.5 text-[10px] text-slate-500">{d.employee_role}</span>
                      {d.source === 'MANUAL' && (
                        <span className="ml-1.5 px-1 rounded text-[9px] font-bold bg-indigo-600/20 text-indigo-300 border border-indigo-500/40">MANUAL</span>
                      )}
                    </td>
                    <td className="py-1 px-3 text-slate-500">{d.reference || ''}</td>
                    <td />
                    <td className="py-1 px-3 text-right text-slate-300">{brl(d.amount)}</td>
                    <td className="py-1 px-3 text-right text-slate-600">{pct(d.amount, r.total)}</td>
                  </tr>
                ))}
              </React.Fragment>
            );
          })}
        </React.Fragment>
      );
    };

    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800">
          <span className="text-xs font-bold text-white">Totais por Rubrica</span>
          <div className="flex gap-2 text-[11px]">
            <button
              onClick={() => {
                const all = { RECEITA: true, DESPESA: true, INFO: true };
                [...receitas, ...despesas, ...informativos].forEach((r) => { all[`item-${r.item_id}`] = true; });
                setTreeOpen(all);
              }}
              className="text-indigo-300 hover:text-indigo-200"
            >
              Expandir tudo
            </button>
            <span className="text-slate-600">|</span>
            <button
              onClick={() => setTreeOpen({ RECEITA: false, DESPESA: false, INFO: false })}
              className="text-indigo-300 hover:text-indigo-200"
            >
              Recolher tudo
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 uppercase tracking-wider text-[9px]">
                <th className="py-1.5 px-3 text-left">Rubrica / Colaborador</th>
                <th className="py-1.5 px-3 text-left">Referência</th>
                <th className="py-1.5 px-3 text-center">Colab.</th>
                <th className="py-1.5 px-3 text-right">Total</th>
                <th className="py-1.5 px-3 text-right w-16">%</th>
              </tr>
            </thead>
            <tbody>
              {renderGroup('RECEITA', 'Proventos', receitas, 'text-emerald-300', '+')}
              {renderGroup('DESPESA', 'Descontos', despesas, 'text-rose-300', '−')}
              <tr className="border-t-2 border-slate-600 bg-slate-950">
                <td colSpan={3} className="py-3 px-3 font-bold text-white uppercase tracking-wider text-[11px]">
                  <span className="w-3 inline-block text-center mr-2">=</span>Líquido a Pagar
                </td>
                <td className="py-3 px-3 text-right font-bold text-white text-sm">
                  {brl(groupTotal(receitas) - groupTotal(despesas))}
                </td>
                <td />
              </tr>
              {informativos.length > 0 && renderGroup('INFO', 'Informativos (não alteram o líquido)', informativos, 'text-slate-300', '')}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderTotais = () => {
    const itemTotals = payroll?.item_totals || [];
    const roleTotals = payroll?.role_totals || [];
    const receitas = itemTotals.filter((i) => i.affects_net && i.kind === 'RECEITA');
    const despesas = itemTotals.filter((i) => i.affects_net && i.kind === 'DESPESA');
    const informativos = itemTotals.filter((i) => !i.affects_net);

    const summaryLine = (label, value, tone = 'text-slate-200', strong = false) => (
      <div className={`flex items-center justify-between py-1.5 ${strong ? 'border-t border-slate-700 mt-1 pt-2.5' : ''}`}>
        <span className={strong ? 'font-bold text-white' : 'text-slate-400'}>{label}</span>
        <span className={`font-semibold ${tone} ${strong ? 'text-base' : ''}`}>{brl(value)}</span>
      </div>
    );

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Resumo do mês */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs">
            <div className="flex items-center gap-1.5 font-bold text-white mb-2">
              <BarChart3 size={14} className="text-indigo-400" /> Resumo da Folha
            </div>
            <div className="flex items-center gap-1.5 text-slate-400 mb-2">
              <Users size={12} /> {totals.headcount || 0} colaborador(es)
            </div>
            {summaryLine('Total de proventos (bruto)', totals.receitas, 'text-emerald-300')}
            {summaryLine('Total de descontos', totals.despesas, 'text-rose-300')}
            {summaryLine('Líquido a pagar', totals.liquido, 'text-white', true)}
          </div>

          {/* Recolhimentos */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs">
            <div className="flex items-center gap-1.5 font-bold text-white mb-2">
              <Landmark size={14} className="text-sky-400" /> Encargos e Recolhimentos
            </div>
            {summaryLine('INSS descontado dos colaboradores', totals.inss, 'text-rose-300')}
            {summaryLine('IRRF retido', totals.irrf, 'text-rose-300')}
            {summaryLine('FGTS (8% pago pela empresa)', totals.fgts, 'text-sky-300')}
            <p className="text-[10px] text-slate-500 mt-2">
              INSS patronal, RAT e terceiros dependem do regime tributário e não estão incluídos.
            </p>
          </div>

          {/* Custo da empresa */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs">
            <div className="flex items-center gap-1.5 font-bold text-white mb-2">
              <Building2 size={14} className="text-amber-400" /> Custo Total da Empresa
            </div>
            {summaryLine('Proventos dos colaboradores (bruto)', totals.receitas)}
            {summaryLine('FGTS', totals.fgts)}
            {summaryLine('Benefícios (VA)', totals.beneficios)}
            {summaryLine('Custo total do mês', totals.custo_empresa, 'text-amber-300', true)}
            {totals.headcount > 0 && (
              <div className="text-[10px] text-slate-500 mt-1 text-right">
                Média por colaborador: {brl(totals.custo_empresa / totals.headcount)}
              </div>
            )}
          </div>
        </div>

        {renderHierarchy(receitas, despesas, informativos)}

        {/* Totais por cargo */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-800 text-xs font-bold text-white">Totais por Cargo</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 uppercase tracking-wider text-[9px] border-b border-slate-800/60">
                  <th className="py-1.5 px-3 text-left">Cargo</th>
                  <th className="py-1.5 px-3 text-center">Colab.</th>
                  <th className="py-1.5 px-3 text-right">Proventos</th>
                  <th className="py-1.5 px-3 text-right">Descontos</th>
                  <th className="py-1.5 px-3 text-right">Líquido</th>
                  <th className="py-1.5 px-3 text-right">FGTS</th>
                  <th className="py-1.5 px-3 text-right">Custo Empresa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {roleTotals.map((r) => (
                  <tr key={r.role}>
                    <td className="py-1.5 px-3 font-semibold text-slate-200">{r.role}</td>
                    <td className="py-1.5 px-3 text-center text-slate-400">{r.headcount}</td>
                    <td className="py-1.5 px-3 text-right text-emerald-300">{brl(r.receitas)}</td>
                    <td className="py-1.5 px-3 text-right text-rose-300">{brl(r.despesas)}</td>
                    <td className="py-1.5 px-3 text-right font-semibold text-white">{brl(r.liquido)}</td>
                    <td className="py-1.5 px-3 text-right text-sky-300">{brl(r.fgts)}</td>
                    <td className="py-1.5 px-3 text-right text-amber-300">{brl(r.receitas + r.fgts + r.beneficios)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-700 font-bold">
                  <td className="py-2 px-3 text-slate-300 text-[10px] uppercase tracking-wider">Total</td>
                  <td className="py-2 px-3 text-center text-slate-300">{totals.headcount || 0}</td>
                  <td className="py-2 px-3 text-right text-emerald-300">{brl(totals.receitas)}</td>
                  <td className="py-2 px-3 text-right text-rose-300">{brl(totals.despesas)}</td>
                  <td className="py-2 px-3 text-right text-white">{brl(totals.liquido)}</td>
                  <td className="py-2 px-3 text-right text-sky-300">{brl(totals.fgts)}</td>
                  <td className="py-2 px-3 text-right text-amber-300">{brl(totals.custo_empresa)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // ==============================================================================
  // --- [IMPRESSÃO] ---
  // Relatórios em fundo branco, exibidos apenas na impressão (a tela fica oculta).
  // ==============================================================================

  const printTitle = (subtitle) => (
    <div className="mb-3 border-b-2 border-black pb-1.5">
      <h1 className="text-lg font-bold">Folha de Pagamento • {MONTH_NAMES[selectedMonth - 1]}/{selectedYear}</h1>
      <div className="flex justify-between text-[10px] text-slate-700">
        <span>{subtitle}</span>
        <span>Emitido em {new Date().toLocaleString('pt-BR')}</span>
      </div>
    </div>
  );

  const renderPrintFolha = () => {
    const netEntries = (emp) => [
      ...emp.entries.filter((en) => en.affects_net && en.kind === 'RECEITA'),
      ...emp.entries.filter((en) => en.affects_net && en.kind === 'DESPESA')
    ];

    return (
      <PrintFrame>
        {printTitle(`Detalhamento por colaborador • ${employees.length} colaborador(es)`)}
        <div className="space-y-3">
          {employees.map((emp) => {
            const informativos = emp.entries.filter((en) => !en.affects_net);
            return (
              <section key={emp.employee_id} style={{ breakInside: 'avoid' }}>
                <div className="flex justify-between items-end bg-slate-200 border border-slate-400 px-2 py-1">
                  <span className="font-bold text-[11px]">
                    {emp.employee_name} <span className="font-normal text-[10px]">• {emp.employee_role}</span>
                  </span>
                  <span className="text-[10px]">Salário base: {brl(emp.base_salary)}</span>
                </div>
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="text-left w-12">Cód.</th>
                      <th className="text-left">Rubrica</th>
                      <th className="text-left">Referência</th>
                      <th className="text-right print-nowrap w-28">(+) Proventos</th>
                      <th className="text-right print-nowrap w-28">(−) Descontos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {netEntries(emp).length === 0 && (
                      <tr><td colSpan={5}>Nenhum lançamento.</td></tr>
                    )}
                    {netEntries(emp).map((en) => (
                      <tr key={en.id}>
                        <td>{en.code}</td>
                        <td>
                          {en.name}
                          {en.source === 'MANUAL' && ' • manual'}
                        </td>
                        <td>{en.reference || '-'}</td>
                        <td className="text-right print-nowrap">{en.kind === 'RECEITA' ? brl(en.amount) : ''}</td>
                        <td className="text-right print-nowrap">{en.kind === 'DESPESA' ? brl(en.amount) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100 font-semibold">
                      <td />
                      <td />
                      <td className="text-right print-nowrap">Totais</td>
                      <td className="text-right print-nowrap">{brl(emp.totals.receitas)}</td>
                      <td className="text-right print-nowrap">{brl(emp.totals.despesas)}</td>
                    </tr>
                    <tr className="bg-slate-200 font-bold">
                      <td />
                      <td />
                      <td className="text-right print-nowrap">(=) Líquido a receber</td>
                      <td />
                      <td className="text-right print-nowrap">{brl(emp.totals.liquido)}</td>
                    </tr>
                  </tfoot>
                </table>
                {informativos.length > 0 && (
                  <div className="text-[9px] text-slate-700 italic mt-0.5">
                    Informativos (não alteram o líquido):{' '}
                    {informativos.map((en) => `${en.name}: ${brl(en.amount)}${en.reference ? ` (${en.reference})` : ''}`).join(' • ')}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <div style={{ breakBefore: 'page' }}>
          {printTitle(`Resumo por colaborador • ${employees.length} colaborador(es)`)}
          <table className="w-full">
            <thead>
              <tr className="bg-slate-200">
                <th className="text-left">Colaborador</th>
                <th className="text-left">Cargo</th>
                <th className="text-right print-nowrap">Salário Base</th>
                <th className="text-right print-nowrap">(+) Proventos</th>
                <th className="text-right print-nowrap">(−) Descontos</th>
                <th className="text-right print-nowrap">(−) Adiantamento</th>
                <th className="text-right print-nowrap">(=) Líquido</th>
                <th className="text-right print-nowrap">FGTS</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => {
                const adv = emp.advance?.amount || 0;
                return (
                  <tr key={emp.employee_id}>
                    <td className="font-semibold">{emp.employee_name}</td>
                    <td>{emp.employee_role}</td>
                    <td className="text-right print-nowrap">{brl(emp.base_salary)}</td>
                    <td className="text-right print-nowrap">{brl(emp.totals.receitas)}</td>
                    <td className="text-right print-nowrap">{brl(emp.totals.despesas - adv)}</td>
                    <td className="text-right print-nowrap">{adv ? brl(adv) : '-'}</td>
                    <td className="text-right print-nowrap font-bold">{brl(emp.totals.liquido)}</td>
                    <td className="text-right print-nowrap">{brl(emp.totals.fgts)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-bold">
                <td colSpan={2}>Total</td>
                <td className="text-right print-nowrap">{brl(employees.reduce((acc, e) => acc + (e.base_salary || 0), 0))}</td>
                <td className="text-right print-nowrap">{brl(totals.receitas)}</td>
                <td className="text-right print-nowrap">{brl((totals.despesas || 0) - (totals.adiantamento || 0))}</td>
                <td className="text-right print-nowrap">{brl(totals.adiantamento)}</td>
                <td className="text-right print-nowrap">{brl(totals.liquido)}</td>
                <td className="text-right print-nowrap">{brl(totals.fgts)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="text-[9px] text-slate-700 mt-1">
            Líquido = Proventos − Descontos − Adiantamento (saldo a pagar no fechamento do mês). Na coluna Descontos o adiantamento não está incluído.
          </p>
        </div>
      </PrintFrame>
    );
  };

  const renderPrintTotais = () => {
    const itemTotals = payroll?.item_totals || [];
    const roleTotals = payroll?.role_totals || [];
    const groups = [
      { key: 'RECEITA', label: 'Proventos', rows: itemTotals.filter((i) => i.affects_net && i.kind === 'RECEITA') },
      { key: 'DESPESA', label: 'Descontos', rows: itemTotals.filter((i) => i.affects_net && i.kind === 'DESPESA') },
      { key: 'INFO', label: 'Informativos (não alteram o líquido)', rows: itemTotals.filter((i) => !i.affects_net) }
    ];
    const sum = (rows) => rows.reduce((acc, r) => acc + r.total, 0);

    const summaryBox = (title, lines) => (
      <table className="w-full">
        <thead>
          <tr className="bg-slate-200"><th colSpan={2} className="text-left">{title}</th></tr>
        </thead>
        <tbody>
          {lines.map(([label, value, strong]) => (
            <tr key={label} className={strong ? 'font-bold bg-slate-100' : ''}>
              <td>{label}</td>
              <td className="text-right print-nowrap">{brl(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );

    return (
      <PrintFrame>
        {printTitle(`Totais da folha${printDetailed ? ' (detalhado por colaborador)' : ' (resumido)'} • ${totals.headcount || 0} colaborador(es)`)}

        <div className="grid grid-cols-3 gap-3 mb-4" style={{ breakInside: 'avoid' }}>
          {summaryBox('Resumo da Folha', [
            ['Total de proventos (bruto)', totals.receitas],
            ['Total de descontos', totals.despesas],
            ['Adiantamento salarial (incluso nos descontos)', totals.adiantamento],
            ['Líquido a pagar', totals.liquido, true]
          ])}
          {summaryBox('Encargos e Recolhimentos', [
            ['INSS descontado dos colaboradores', totals.inss],
            ['IRRF retido', totals.irrf],
            ['FGTS (8% pago pela empresa)', totals.fgts]
          ])}
          {summaryBox('Custo Total da Empresa', [
            ['Proventos dos colaboradores (bruto)', totals.receitas],
            ['FGTS', totals.fgts],
            ['Benefícios (VA)', totals.beneficios],
            ['Custo total do mês', totals.custo_empresa, true]
          ])}
        </div>

        <h2 className="text-sm font-bold mb-1">Totais por Rubrica</h2>
        <table className="w-full mb-4">
          <thead>
            <tr className="bg-slate-200">
              <th className="text-left">Rubrica / Colaborador</th>
              <th className="text-left">Referência</th>
              <th className="text-center w-14">Colab.</th>
              <th className="text-right print-nowrap w-28">Total</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <React.Fragment key={g.key}>
                {g.key === 'INFO' && (
                  <tr className="font-bold bg-slate-300">
                    <td colSpan={3}>= Líquido a Pagar</td>
                    <td className="text-right print-nowrap">{brl(sum(groups[0].rows) - sum(groups[1].rows))}</td>
                  </tr>
                )}
                {(g.key !== 'INFO' || g.rows.length > 0) && (
                  <tr className="font-bold bg-slate-200 uppercase">
                    <td colSpan={3}>{g.label}</td>
                    <td className="text-right print-nowrap">{brl(sum(g.rows))}</td>
                  </tr>
                )}
                {g.rows.map((r) => (
                  <React.Fragment key={r.item_id}>
                    <tr className="font-semibold bg-slate-50">
                      <td style={{ paddingLeft: '12px' }}>{r.code} • {r.name}</td>
                      <td />
                      <td className="text-center">{r.employees}</td>
                      <td className="text-right print-nowrap">{brl(r.total)}</td>
                    </tr>
                    {printDetailed && r.details.map((d) => (
                      <tr key={`${r.item_id}-${d.employee_id}`}>
                        <td style={{ paddingLeft: '28px' }}>
                          {d.employee_name} <span className="text-slate-600">• {d.employee_role}</span>
                          {d.source === 'MANUAL' && ' • manual'}
                        </td>
                        <td>{d.reference || ''}</td>
                        <td />
                        <td className="text-right print-nowrap">{brl(d.amount)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>

        <h2 className="text-sm font-bold mb-1">Totais por Cargo</h2>
        <table className="w-full">
          <thead>
            <tr className="bg-slate-200">
              <th className="text-left">Cargo</th>
              <th className="text-center">Colab.</th>
              <th className="text-right print-nowrap">Proventos</th>
              <th className="text-right print-nowrap">Descontos</th>
              <th className="text-right print-nowrap">Líquido</th>
              <th className="text-right print-nowrap">FGTS</th>
              <th className="text-right print-nowrap">Custo Empresa</th>
            </tr>
          </thead>
          <tbody>
            {roleTotals.map((r) => (
              <tr key={r.role}>
                <td className="font-semibold">{r.role}</td>
                <td className="text-center">{r.headcount}</td>
                <td className="text-right print-nowrap">{brl(r.receitas)}</td>
                <td className="text-right print-nowrap">{brl(r.despesas)}</td>
                <td className="text-right print-nowrap font-semibold">{brl(r.liquido)}</td>
                <td className="text-right print-nowrap">{brl(r.fgts)}</td>
                <td className="text-right print-nowrap">{brl(r.receitas + r.fgts + r.beneficios)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold bg-slate-100">
              <td>Total</td>
              <td className="text-center">{totals.headcount || 0}</td>
              <td className="text-right print-nowrap">{brl(totals.receitas)}</td>
              <td className="text-right print-nowrap">{brl(totals.despesas)}</td>
              <td className="text-right print-nowrap">{brl(totals.liquido)}</td>
              <td className="text-right print-nowrap">{brl(totals.fgts)}</td>
              <td className="text-right print-nowrap">{brl(totals.custo_empresa)}</td>
            </tr>
          </tfoot>
        </table>
      </PrintFrame>
    );
  };

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
            Proventos somam ao líquido e descontos subtraem. Rubricas em uso ou do sistema não podem ser excluídas.
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
                    {it.kind === 'RECEITA' ? 'Provento' : 'Desconto'}
                  </span>
                  {!it.affects_net && <span className="ml-1 text-[9px] text-slate-500">informativa</span>}
                </td>
                <td className="py-2 px-3 text-slate-300">
                  {it.configurable
                    ? `${Number(it.default_value).toLocaleString('pt-BR')}% ${it.system_key === 'ADIANTAMENTO' ? 'do salário (meses marcados)' : 'por triênio'}`
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
                  { value: 'RECEITA', label: 'Provento (soma ao líquido)' },
                  { value: 'DESPESA', label: 'Desconto (subtrai do líquido)' }
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
                <label className="block text-slate-400 mb-1">
                  {data.system_key === 'ADIANTAMENTO' ? 'Percentual do adiantamento (% do salário base)' : 'Percentual por triênio (% do salário base)'}
                </label>
                <input
                  inputMode="decimal"
                  value={data.default_value}
                  onChange={(e) => set({ default_value: e.target.value.replace(/[^0-9.,]/g, '') })}
                  className={inputCls}
                />
                <span className="text-[10px] text-slate-500">
                  {data.system_key === 'ADIANTAMENTO'
                    ? 'Descontado na folha apenas dos colaboradores marcados para receber o adiantamento no mês.'
                    : 'Acumulativo: aplicado uma vez para cada 3 anos completos desde a admissão (ex: 7 anos = 2 triênios).'}
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
                  subtitle: it.kind === 'RECEITA' ? 'Provento' : 'Desconto'
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
      <div className="print:hidden bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Wallet className="text-indigo-400" size={18} />
            Folha de Pagamento • {MONTH_NAMES[selectedMonth - 1]}/{selectedYear}
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Proventos e descontos por colaborador, com horas extras, faltas e benefícios vindos da jornada.
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
              onClick={() => setView('totais')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold ${
                view === 'totais' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <BarChart3 size={13} /> Totais
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

          {view === 'folha' && !loading && (
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
              title="Imprime o detalhamento por colaborador e o resumo"
            >
              <Printer size={13} /> Imprimir Folha
            </button>
          )}
          {view === 'totais' && !loading && (
            <div className="flex bg-slate-950 border border-slate-800 rounded-lg p-0.5">
              <button
                onClick={() => printTotais(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-slate-200 hover:bg-slate-800"
                title="Rubricas com o valor de cada colaborador"
              >
                <Printer size={13} /> Imprimir Detalhado
              </button>
              <button
                onClick={() => printTotais(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-slate-200 hover:bg-slate-800"
                title="Somente os totais de cada provento e desconto"
              >
                <Printer size={13} /> Imprimir Resumido
              </button>
            </div>
          )}

          {msg && <span className="text-xs font-medium text-emerald-400">{msg}</span>}
        </div>
      </div>

      {loading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-xs text-slate-400">
          <RefreshCw size={18} className="animate-spin mx-auto mb-2" />
          Carregando folha...
        </div>
      ) : (
        <>
          <div className="print:hidden">
            {view === 'folha' ? renderFolha() : view === 'totais' ? renderTotais() : renderRubricas()}
          </div>
          {view === 'folha' && renderPrintFolha()}
          {view === 'totais' && renderPrintTotais()}
        </>
      )}

      {itemModal && renderItemModal()}
      {entryModal && renderEntryModal()}
    </div>
  );
}
