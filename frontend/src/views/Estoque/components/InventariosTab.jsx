import React, { useEffect, useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import Skeleton from '../../../components/common/Skeleton';
import { Alert, Button, StatusBadge } from './ui';
import NovoInventarioModal from './NovoInventarioModal';
import { formatDate, formatDateTime } from '../estoqueApi';

const GROUPS = [
  { key: 'abertos', label: 'Em andamento', match: (s) => !['CONCLUIDO', 'CANCELADO'].includes(s) },
  { key: 'encerrados', label: 'Encerrados', match: (s) => ['CONCLUIDO', 'CANCELADO'].includes(s) },
];

export default function InventariosTab({ api, refreshCounter, onOpen, onOpenCadastro }) {
  const [counts, setCounts] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [group, setGroup] = useState('abertos');

  useEffect(() => {
    api.inventarios().then((d) => setCounts(d.inventarios)).catch((e) => setError(e.message));
  }, [api, refreshCounter]);

  const current = GROUPS.find((g) => g.key === group);
  const rows = (counts || []).filter((c) => current.match(c.status));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {GROUPS.map((g) => (
            <button key={g.key} onClick={() => setGroup(g.key)}
              className={`px-3 py-1.5 rounded-lg text-sm border ${group === g.key
                ? 'bg-slate-800 border-slate-700 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
              {g.label} {counts && <span className="text-slate-500">({counts.filter((c) => g.match(c.status)).length})</span>}
            </button>
          ))}
        </div>
        <Button tone="primary" icon={Plus} onClick={() => setCreating(true)}>Novo inventário</Button>
      </div>

      {error && <Alert onClose={() => setError(null)}>{error}</Alert>}

      {counts === null ? <Skeleton type="table" rows={5} columns={5} /> : (
        <div className="bg-slate-900/80 border border-white/[0.05] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-950/50 text-slate-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Inventário</th>
                <th className="px-4 py-3 text-left">Data de corte</th>
                <th className="px-4 py-3 text-left">Progresso</th>
                <th className="px-4 py-3 text-left">Situação</th>
                <th className="px-4 py-3 text-left">Criado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rows.map((c) => {
                const pct = c.item_count ? Math.round((c.counted_items / c.item_count) * 100) : 0;
                return (
                  <tr key={c.id} onClick={() => onOpen(c.id)} className="cursor-pointer hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <p className="text-white font-medium">{c.family_name}</p>
                      <p className="text-xs text-slate-500">#{c.id}{c.notes ? ` · ${c.notes}` : ''}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{formatDate(c.cutoff_date)}</td>
                    <td className="px-4 py-3 w-56">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-slate-400 w-16 text-right">{c.counted_items}/{c.item_count}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{c.created_by || '—'}<br />{formatDateTime(c.created_at)}</td>
                    <td className="px-4 py-3 text-slate-500"><ChevronRight size={18} /></td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={6} className="text-center text-slate-500 py-12">Nenhum inventário {group === 'abertos' ? 'em andamento' : 'encerrado'}.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <NovoInventarioModal api={api} onClose={() => setCreating(false)} onOpenCadastro={() => { setCreating(false); onOpenCadastro(); }}
          onCreated={(count) => { setCreating(false); onOpen(count.id); }} />
      )}
    </div>
  );
}
