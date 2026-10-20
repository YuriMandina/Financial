import React, { useEffect, useState } from 'react';
import Skeleton from '../../../components/common/Skeleton';
import SelectDropdown from '../../../components/common/SelectDropdown';
import DatePicker from '../../../components/common/DatePicker';
import { Alert } from './ui';
import { formatMoney, formatQty } from '../estoqueApi';

const pct = (v) => (v === null || v === undefined ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);

function IndicatorTable({ rows, nameKey, showUnit }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-950/50 text-slate-400 text-xs uppercase">
        <tr>
          <th className="px-4 py-3 text-left">{nameKey === 'product_name' ? 'Produto' : 'Família'}</th>
          <th className="px-4 py-3 text-right" title="Inventários com divergência / inventários">Recorrência</th>
          <th className="px-4 py-3 text-right" title="Divergência absoluta / saldo do sistema">Divergência</th>
          <th className="px-4 py-3 text-right" title="Quebra técnica / saldo do sistema (use no markup)">Quebra técnica</th>
          <th className="px-4 py-3 text-right">Perdas</th>
          <th className="px-4 py-3 text-right">Quebra (R$)</th>
          <th className="px-4 py-3 text-right">Sobras</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-800/60">
        {rows.map((r) => (
          <tr key={r.product_id || r.family_name}>
            <td className="px-4 py-2.5">
              <p className="text-white">{r[nameKey] || '—'}</p>
              {showUnit && <p className="text-xs text-slate-500">{r.family_name} · base {formatQty(r.base_qty)} {r.unit || ''}</p>}
            </td>
            <td className="px-4 py-2.5 text-right text-slate-300">{r.divergentes}/{r.inventarios} <span className="text-slate-500">({pct(r.recorrencia_pct)})</span></td>
            <td className="px-4 py-2.5 text-right text-slate-300">{pct(r.divergencia_pct)}</td>
            <td className="px-4 py-2.5 text-right text-amber-300">{pct(r.quebra_pct)}</td>
            <td className="px-4 py-2.5 text-right text-rose-300">{formatMoney(r.perdas_value)}</td>
            <td className="px-4 py-2.5 text-right text-amber-300">{formatMoney(r.quebra_value)}</td>
            <td className="px-4 py-2.5 text-right text-emerald-300">{formatMoney(r.sobras_value)}</td>
          </tr>
        ))}
        {!rows.length && <tr><td colSpan={7} className="text-center text-slate-500 py-10">Sem inventários efetivados no período.</td></tr>}
      </tbody>
    </table>
  );
}

export default function IndicadoresTab({ api }) {
  const [familias, setFamilias] = useState([]);
  const [familyId, setFamilyId] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = (family, from) => api.indicadores({ family_id: family, date_from: from }).then(setData).catch((e) => setError(e.message));

  useEffect(() => {
    api.familias().then((d) => setFamilias(d.familias.filter((f) => f.is_active_for_inventory))).catch(() => {});
    api.indicadores({}).then(setData).catch((e) => setError(e.message));
  }, [api]);

  // Filtros recarregam os indicadores (mostrando o skeleton durante a busca)
  const applyFilters = (family, from) => {
    setFamilyId(family);
    setDateFrom(from);
    setData(null);
    load(family, from);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-64">
          <SelectDropdown value={familyId} onChange={(v) => applyFilters(v, dateFrom)} placeholder="Todas as famílias" searchable
            options={[{ value: null, label: 'Todas as famílias' }, ...familias.map((f) => ({ value: f.id, label: f.name }))]} />
        </div>
        <DatePicker value={dateFrom} onChange={(v) => applyFilters(familyId, v)} placeholder="Corte a partir de" align="left" />
        {dateFrom && <button className="text-xs text-slate-400 underline" onClick={() => applyFilters(familyId, '')}>limpar data</button>}
      </div>
      <Alert tone="info">
        Considera apenas inventários efetivados. Quebra técnica (desidratação, aparas) é perda normal: use o percentual na formação de preço.
        Divergência recorrente costuma indicar erro de cadastro, código de barras ou troca no PDV.
      </Alert>
      {error && <Alert onClose={() => setError(null)}>{error}</Alert>}
      {data === null ? <Skeleton type="table" rows={6} columns={7} /> : (
        <>
          <div className="bg-slate-900/80 border border-white/[0.05] rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.05] font-semibold text-white">Por família</div>
            <IndicatorTable rows={data.familias} nameKey="family_name" />
          </div>
          <div className="bg-slate-900/80 border border-white/[0.05] rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.05] font-semibold text-white">Por produto (maiores perdas primeiro)</div>
            <IndicatorTable rows={data.produtos} nameKey="product_name" showUnit />
          </div>
        </>
      )}
    </div>
  );
}
