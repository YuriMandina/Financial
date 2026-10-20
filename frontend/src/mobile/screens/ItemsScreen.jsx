import React, { useMemo, useState } from 'react';
import { CircleCheck, Lock, RotateCcw, ScanBarcode, Search } from 'lucide-react';
import { Banner, Header, ProgressBar } from '../components';
import {
  findByCode, formatQty, itemCountStatus, itemEditable, localItemTotal, searchItems,
} from '../counting';

const FILTERS = [
  { key: 'TODOS', label: 'Todos' },
  { key: 'PENDENTE', label: 'Pendentes' },
  { key: 'CONTADO', label: 'Contados' },
  { key: 'RECONTAGEM', label: 'Recontagem' },
];

function StatusIcon({ status, editable }) {
  if (!editable) return <Lock size={18} className="text-slate-600" />;
  if (status === 'RECONTAGEM') return <RotateCcw size={18} className="text-amber-400" />;
  if (status === 'CONTADO') return <CircleCheck size={18} className="text-emerald-400" />;
  return <span className="w-[18px] h-[18px] rounded-full border-2 border-slate-600 inline-block" />;
}

export default function ItemsScreen({ count, pending, fromCache, syncBadge, scanEnabled, onBack, onOpenItem, onScan }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(count.status === 'CONFERENCIA' ? 'RECONTAGEM' : 'TODOS');
  const [notFound, setNotFound] = useState(null);

  // --- [BLOCO: Lista Filtrada] ---
  const rows = useMemo(() => {
    const decorated = count.items.map((item) => ({
      item,
      total: localItemTotal(item, pending),
      status: itemCountStatus(item, pending),
      editable: itemEditable(count, item),
    }));
    const matches = new Set(searchItems(count.items, query).map((i) => i.id));
    return decorated.filter((r) => matches.has(r.item.id) && (filter === 'TODOS' || r.status === filter));
  }, [count, pending, query, filter]);

  const countedTotal = count.items.filter((i) => itemCountStatus(i, pending) === 'CONTADO').length;

  // Enter no campo de busca: leitor Bluetooth "digita" o código e confirma
  const onSubmit = (event) => {
    event.preventDefault();
    const hit = findByCode(count.items, query);
    if (hit) {
      setQuery('');
      onOpenItem(hit.item.id, hit.packaging);
    } else if (/^\d{8,14}$/.test(query.trim())) {
      setNotFound(query.trim());
    }
  };

  return (
    <div className="min-h-screen pb-6">
      <Header title={count.family_name} subtitle={`Inventário #${count.id}`} onBack={onBack} right={syncBadge} />
      <div className="px-3 pt-3 space-y-3 sticky top-[56px] z-10 bg-slate-950 pb-3 border-b border-slate-900">
        <ProgressBar value={countedTotal} total={count.items.length} />
        <form onSubmit={onSubmit} className="flex gap-2">
          <div className="flex-1 relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input value={query} onChange={(e) => { setQuery(e.target.value); setNotFound(null); }}
              placeholder="Nome, código ou EAN" autoCapitalize="none" autoCorrect="off" enterKeyHint="search"
              className="w-full h-12 pl-10 pr-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-emerald-500 outline-none" />
          </div>
          {scanEnabled && (
            <button type="button" onClick={onScan} aria-label="Ler código de barras"
              className="h-12 w-12 rounded-xl bg-emerald-600 active:bg-emerald-700 flex items-center justify-center">
              <ScanBarcode size={22} />
            </button>
          )}
        </form>
        <div className="flex gap-2 overflow-x-auto -mx-3 px-3">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`shrink-0 px-3 h-8 rounded-full text-sm border ${filter === f.key
                ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-700 text-slate-300'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {fromCache && <Banner tone="warn">Sem conexão: dados salvos no aparelho. Os lançamentos serão enviados ao reconectar.</Banner>}
      {notFound && <Banner tone="error" onClose={() => setNotFound(null)}>Código {notFound} não pertence a este inventário.</Banner>}

      <ul className="divide-y divide-slate-900">
        {rows.map(({ item, total, status, editable }) => (
          <li key={item.id}>
            <button onClick={() => onOpenItem(item.id, null)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-slate-900">
              <StatusIcon status={status} editable={editable} />
              <div className="flex-1 min-w-0">
                <p className="truncate">{item.product_name}</p>
                <p className="text-xs text-slate-500">{[item.product_code && `Cód. ${item.product_code}`, item.ean].filter(Boolean).join(' · ') || 'Sem código'}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold tabular-nums">{status === 'PENDENTE' ? '—' : formatQty(total)}</p>
                <p className="text-[11px] text-slate-500">{item.unit || ''}</p>
              </div>
            </button>
          </li>
        ))}
        {!rows.length && <li className="text-center text-slate-500 py-12">Nenhum item encontrado.</li>}
      </ul>
    </div>
  );
}
