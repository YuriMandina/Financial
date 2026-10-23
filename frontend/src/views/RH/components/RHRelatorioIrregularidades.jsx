import React, { useEffect, useState } from 'react';
import { AlertTriangle, Download, FileText, RefreshCw } from 'lucide-react';
import Skeleton from '../../../components/common/Skeleton';
import SelectDropdown from '../../../components/common/SelectDropdown';
import RHFichaIrregularidade from './RHFichaIrregularidade';
import { brl } from './complianceFormat';

// ==============================================================================
// --- [BLOCO: CONSTANTES E UTILITÁRIOS] ---
// ==============================================================================

const RULES = [
  ['R01', 'Hora extra acima do limite diário'], ['R02', 'Hora extra semanal'], ['R03', 'Hora extra habitual'],
  ['R04', 'Contrato acima do regime legal'], ['R05', '7º dia consecutivo'], ['R06', 'Descanso semanal abaixo do mínimo'],
  ['R07', 'Domingos consecutivos'], ['R08', 'Interjornada inferior a 11h'], ['R09', 'Descanso de 35h'],
  ['R10', 'Intervalo para refeição'], ['R11', 'Repouso ou feriado trabalhado'], ['R12', 'Banco de horas vencido'],
  ['R14', 'Alteração contratual sem aditivo']
];

const monthValue = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

const shiftMonth = (value, delta) => {
  const [y, m] = value.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthValue(d.getFullYear(), d.getMonth() + 1);
};

function BreakdownTable({ title, rows }) {
  if (!rows?.length) return null;
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
      <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-800">{title}</div>
      <table className="w-full text-left">
        <thead className="text-[10px] text-slate-500">
          <tr>
            <th className="px-3 py-1.5 font-semibold" />
            <th className="px-2 py-1.5 text-center font-semibold">Total</th>
            <th className="px-2 py-1.5 text-center font-semibold">Críticas</th>
            <th className="px-2 py-1.5 text-center font-semibold">Alertas</th>
            <th className="px-2 py-1.5 text-center font-semibold">Reincid.</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60">
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="px-3 py-1.5 text-slate-200">{r.label}</td>
              <td className="px-2 py-1.5 text-center font-semibold">{r.total}</td>
              <td className="px-2 py-1.5 text-center text-rose-300">{r.critical}</td>
              <td className="px-2 py-1.5 text-center text-amber-300">{r.alert}</td>
              <td className={`px-2 py-1.5 text-center ${r.reincidences ? 'text-rose-300 font-semibold' : 'text-slate-500'}`}>{r.reincidences}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ==============================================================================
// --- [BLOCO: RELATÓRIO DE IRREGULARIDADES DO PERÍODO] ---
// ==============================================================================

export default function RHRelatorioIrregularidades({ token, apiBase, selectedYear, selectedMonth, employees = [] }) {
  const current = monthValue(selectedYear, selectedMonth);
  const [filters, setFilters] = useState({ date_from: shiftMonth(current, -2), date_to: current, employee_id: '', rule: '', severity: '', status: '' });
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [openIds, setOpenIds] = useState(() => new Set());
  const [exporting, setExporting] = useState('');

  const query = (format) => {
    const params = new URLSearchParams({ format });
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
    return `${apiBase}/api/rh/compliance/report?${params.toString()}`;
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(query('json'), { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.detail || 'Falha ao gerar o relatório');
        return json;
      })
      .then((json) => { if (!cancelled) setReport(json); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters]);

  const handleExport = async (format) => {
    setExporting(format);
    try {
      const res = await fetch(query(format), { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Falha ao exportar');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `irregularidades_${filters.date_from}_a_${filters.date_to}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting('');
    }
  };

  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  const toggle = (id) => setOpenIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const totals = report?.totals;

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 grid grid-cols-2 md:grid-cols-6 gap-2">
        <div>
          <label className="block text-slate-400 mb-1">De</label>
          <input
            type="month"
            value={filters.date_from}
            max={filters.date_to}
            onChange={(e) => e.target.value && setFilter('date_from', e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-white [color-scheme:dark]"
          />
        </div>
        <div>
          <label className="block text-slate-400 mb-1">Até</label>
          <input
            type="month"
            value={filters.date_to}
            min={filters.date_from}
            onChange={(e) => e.target.value && setFilter('date_to', e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-white [color-scheme:dark]"
          />
        </div>
        <div>
          <label className="block text-slate-400 mb-1">Colaborador</label>
          <SelectDropdown
            size="sm"
            value={filters.employee_id}
            onChange={(v) => setFilter('employee_id', v)}
            searchable={employees.length > 6}
            options={[{ value: '', label: 'Todos' }, ...employees.map((e) => ({ value: e.id, label: e.name }))]}
          />
        </div>
        <div>
          <label className="block text-slate-400 mb-1">Regra</label>
          <SelectDropdown
            size="sm"
            value={filters.rule}
            onChange={(v) => setFilter('rule', v)}
            options={[{ value: '', label: 'Todas' }, ...RULES.map(([code, label]) => ({ value: code, label: `${code} ${label}` }))]}
          />
        </div>
        <div>
          <label className="block text-slate-400 mb-1">Gravidade</label>
          <SelectDropdown
            size="sm"
            value={filters.severity}
            onChange={(v) => setFilter('severity', v)}
            options={[{ value: '', label: 'Todas' }, { value: 'CRITICA', label: 'Crítica' }, { value: 'ALERTA', label: 'Alerta' }]}
          />
        </div>
        <div>
          <label className="block text-slate-400 mb-1">Situação</label>
          <SelectDropdown
            size="sm"
            value={filters.status}
            onChange={(v) => setFilter('status', v)}
            options={[{ value: '', label: 'Todas' }, { value: 'PENDENTE', label: 'Pendente' }, { value: 'APROVADA', label: 'Aprovada' }]}
          />
        </div>
      </div>

      {/* Exportação */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-slate-400 flex items-center gap-1.5">
          <AlertTriangle size={13} className="text-rose-400" />
          {report?.disclaimer || 'Pagar quita apenas a obrigação financeira; a infração administrativa permanece.'}
        </p>
        <div className="flex gap-2">
          {['csv', 'pdf'].map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => handleExport(fmt)}
              disabled={!!exporting || loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-50"
            >
              {exporting === fmt ? <RefreshCw size={13} className="animate-spin" /> : fmt === 'pdf' ? <FileText size={13} /> : <Download size={13} />}
              Exportar {fmt.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="text-rose-300 bg-rose-950/30 border border-rose-800/50 rounded-lg p-2">{error}</div>}

      {loading ? (
        <div className="space-y-3">
          <Skeleton type="card" />
          <Skeleton type="list" rows={5} />
        </div>
      ) : report && (
        <>
          {/* Totalizadores */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            {[
              ['Irregularidades', totals.total, 'text-white'],
              ['Críticas', totals.critical, 'text-rose-300'],
              ['Alertas', totals.alert, 'text-amber-300'],
              ['Pendentes', totals.pending, 'text-orange-300'],
              ['Reincidências (12 meses)', totals.reincidences, totals.reincidences ? 'text-rose-300' : 'text-slate-400'],
              ['Estimativa financeira', brl(totals.financial_estimate), 'text-amber-200']
            ].map(([label, value, cls]) => (
              <div key={label} className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
                <div className="text-[10px] text-slate-500">{label}</div>
                <div className={`text-lg font-bold ${cls}`}>{value}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
            <BreakdownTable title="Por regra" rows={report.by_rule} />
            <BreakdownTable title="Por colaborador" rows={report.by_employee} />
            <BreakdownTable title="Por mês" rows={report.by_month} />
          </div>

          {/* Lista com ficha completa */}
          <div className="space-y-2">
            {report.items.length === 0 ? (
              <p className="text-slate-500 italic">Nenhuma irregularidade no período com os filtros aplicados.</p>
            ) : (
              report.items.map((item) => (
                <RHFichaIrregularidade
                  key={item.id}
                  item={item}
                  open={openIds.has(item.id)}
                  onToggle={() => toggle(item.id)}
                  token={token}
                  apiBase={apiBase}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
