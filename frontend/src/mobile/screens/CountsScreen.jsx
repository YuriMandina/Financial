import React from 'react';
import { ChevronRight, LogOut } from 'lucide-react';
import Skeleton from '../../components/common/Skeleton';
import { Banner, Header, ProgressBar } from '../components';

const STATUS_LABEL = {
  EM_CONTAGEM: { text: 'Em contagem', cls: 'text-emerald-300 bg-emerald-950/50 border-emerald-900' },
  CONFERENCIA: { text: 'Recontagem', cls: 'text-amber-300 bg-amber-950/50 border-amber-900' },
};

const formatDate = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : '');

export default function CountsScreen({ user, counts, loading, fromCache, syncBadge, onOpen, onRefresh, onLogout }) {
  return (
    <div className="min-h-screen pb-6">
      <Header
        title="Inventários"
        subtitle={user ? `Olá, ${user.name}` : undefined}
        right={(
          <div className="flex items-center gap-1">
            {syncBadge}
            <button onClick={onLogout} className="p-2 rounded-lg active:bg-slate-800" aria-label="Sair"><LogOut size={20} /></button>
          </div>
        )}
      />
      {fromCache && <Banner tone="warn">Sem conexão: mostrando a última lista salva no aparelho.</Banner>}

      {loading && !counts.length ? (
        <Skeleton type="list" rows={4} className="p-3" />
      ) : (
        <div className="p-3 space-y-3">
          {!counts.length && (
            <div className="text-center text-slate-400 py-16">
              <p>Nenhum inventário em contagem.</p>
              <button onClick={onRefresh} className="mt-4 text-emerald-400 underline">Atualizar</button>
            </div>
          )}
          {counts.map((count) => {
            const status = STATUS_LABEL[count.status] || { text: count.status, cls: 'text-slate-300 border-slate-700' };
            return (
              <button key={count.id} onClick={() => onOpen(count.id)}
                className="w-full text-left bg-slate-900 border border-slate-800 rounded-xl p-4 active:bg-slate-800">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold truncate">{count.family_name}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full border ${status.cls}`}>{status.text}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">Inventário #{count.id} · corte {formatDate(count.cutoff_date)}</p>
                  </div>
                  <ChevronRight size={20} className="text-slate-500 mt-1" />
                </div>
                <div className="mt-3"><ProgressBar value={count.counted_items} total={count.item_count} /></div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
