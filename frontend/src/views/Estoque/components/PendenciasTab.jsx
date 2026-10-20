import React, { useCallback, useEffect, useState } from 'react';
import { CloudDownload, Check } from 'lucide-react';
import Skeleton from '../../../components/common/Skeleton';
import SelectDropdown from '../../../components/common/SelectDropdown';
import { Alert, Button } from './ui';

const ISSUE_LABEL = { SEM_FAMILIA: 'Sem família', SEM_EAN: 'Sem EAN', SEM_UNIDADE: 'Sem unidade', SEM_NCM: 'Sem NCM' };
const FILTERS = ['SEM_FAMILIA', 'SEM_EAN', 'SEM_UNIDADE', 'SEM_NCM', 'TODOS'];

export default function PendenciasTab({ api, onTaskStart, onCountChange }) {
  const [data, setData] = useState(null);
  const [familias, setFamilias] = useState([]);
  const [filter, setFilter] = useState('SEM_FAMILIA');
  const [choice, setChoice] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);

  // --- [BLOCO: Carregamento] ---
  const load = useCallback(async () => {
    try {
      const d = await api.pendencias();
      setData(d);
      onCountChange?.(d.sem_familia);
    } catch (e) {
      setError(e.message);
    }
  }, [api, onCountChange]);

  useEffect(() => {
    load();
    api.familias().then((d) => setFamilias(d.familias)).catch(() => {});
  }, [api, load]);

  // --- [BLOCO: Ações] ---
  const syncCatalog = async () => {
    setBusy('sync');
    setError(null);
    try {
      const res = await api.sincronizarCatalogo();
      onTaskStart?.(res.task_id, 'Catálogo de produtos (Omie)', () => load());
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const assign = async (product) => {
    setBusy(product.id);
    setError(null);
    try {
      const res = await api.atribuirFamilia(product.id, choice[product.id]);
      setOk(`${product.name}: família "${res.family_name}" gravada na Omie.`);
      await load();
    } catch (e) {
      setError(`${product.name}: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  const rows = (data?.pendencias || []).filter((p) => filter === 'TODOS' || p.issues.includes(filter));
  const countOf = (key) => (data?.pendencias || []).filter((p) => key === 'TODOS' || p.issues.includes(key)).length;
  const familyOptions = familias.map((f) => ({ value: f.id, label: f.name }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {FILTERS.map((key) => (
            <button key={key} onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-lg text-sm border ${filter === key
                ? 'bg-slate-800 border-slate-700 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
              {ISSUE_LABEL[key] || 'Todos'} {data && <span className="text-slate-500">({countOf(key)})</span>}
            </button>
          ))}
        </div>
        <Button icon={CloudDownload} loading={busy === 'sync'} onClick={syncCatalog}>Sincronizar catálogo da Omie</Button>
      </div>

      <Alert tone="info">
        Produtos sem família não podem entrar em inventário. A família escolhida aqui é gravada no cadastro da Omie
        (o sistema confere que nenhum outro campo do produto foi alterado).
      </Alert>
      {error && <Alert onClose={() => setError(null)}>{error}</Alert>}
      {ok && <Alert tone="ok" onClose={() => setOk(null)}>{ok}</Alert>}

      {data === null ? <Skeleton type="table" rows={8} columns={3} /> : (
        <div className="bg-slate-900/80 border border-white/[0.05] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-950/50 text-slate-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Produto</th>
                <th className="px-4 py-3 text-left">Pendências</th>
                <th className="px-4 py-3 text-left w-[420px]">Corrigir</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2.5">
                    <p className="text-white">{p.name}</p>
                    <p className="text-xs text-slate-500">Cód. Omie {p.omie_id}{p.family_name ? ` · ${p.family_name}` : ''}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {p.issues.map((i) => (
                        <span key={i} className={`text-[11px] px-1.5 py-0.5 rounded border ${i === 'SEM_FAMILIA'
                          ? 'text-rose-300 border-rose-500/30' : 'text-amber-300 border-amber-500/30'}`}>{ISSUE_LABEL[i]}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {p.issues.includes('SEM_FAMILIA') ? (
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <SelectDropdown value={choice[p.id] || null} onChange={(v) => setChoice((c) => ({ ...c, [p.id]: v }))}
                            options={familyOptions} searchable size="sm" placeholder="Família" />
                        </div>
                        <Button tone="primary" icon={Check} loading={busy === p.id} disabled={!choice[p.id]} onClick={() => assign(p)}>Gravar</Button>
                      </div>
                    ) : <span className="text-xs text-slate-500">Corrigir no cadastro da Omie e sincronizar</span>}
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={3} className="text-center text-slate-500 py-10">Nenhuma pendência.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
