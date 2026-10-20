// Componentes visuais compartilhados do app de contagem (tema escuro do sistema, alvos de toque grandes).
import React from 'react';
import { ChevronLeft, Cloud, CloudOff, RefreshCw, TriangleAlert, X } from 'lucide-react';

// --- [BLOCO: Cabeçalho e Sincronização] ---
export function Header({ title, subtitle, onBack, right }) {
  return (
    <header className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-3 py-2 flex items-center gap-2 min-h-[56px]">
      {onBack && (
        <button onClick={onBack} className="p-2 -ml-1 rounded-lg active:bg-slate-800" aria-label="Voltar">
          <ChevronLeft size={24} />
        </button>
      )}
      <div className="flex-1 min-w-0">
        <h1 className="text-base font-semibold truncate">{title}</h1>
        {subtitle && <p className="text-xs text-slate-400 truncate">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

export function SyncBadge({ online, pending, rejected, syncing, onSync }) {
  let tone = 'text-emerald-400 border-emerald-900 bg-emerald-950/40';
  let Icon = Cloud;
  let label = 'Sincronizado';
  if (!online) { tone = 'text-amber-300 border-amber-900 bg-amber-950/40'; Icon = CloudOff; label = pending ? `Offline · ${pending}` : 'Offline'; }
  else if (pending) { tone = 'text-sky-300 border-sky-900 bg-sky-950/40'; Icon = RefreshCw; label = `${pending} pendente${pending > 1 ? 's' : ''}`; }
  if (rejected) { tone = 'text-rose-300 border-rose-900 bg-rose-950/40'; Icon = TriangleAlert; label = `${rejected} rejeitado${rejected > 1 ? 's' : ''}`; }
  return (
    <button onClick={onSync} className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border ${tone}`}>
      <Icon size={14} className={syncing ? 'animate-spin' : ''} />
      {label}
    </button>
  );
}

// --- [BLOCO: Elementos Básicos] ---
export function ProgressBar({ value, total }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-slate-400 mb-1">
        <span>{value} de {total} contados</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Banner({ tone = 'info', children, onClose }) {
  const tones = {
    info: 'bg-sky-950/60 border-sky-800 text-sky-200',
    warn: 'bg-amber-950/60 border-amber-800 text-amber-200',
    error: 'bg-rose-950/60 border-rose-800 text-rose-200',
    ok: 'bg-emerald-950/60 border-emerald-800 text-emerald-200',
  };
  return (
    <div className={`mx-3 mt-3 px-3 py-2.5 rounded-xl border text-sm flex items-start gap-2 ${tones[tone]}`}>
      <div className="flex-1">{children}</div>
      {onClose && <button onClick={onClose} aria-label="Fechar"><X size={16} /></button>}
    </div>
  );
}

export function PrimaryButton({ children, className = '', ...props }) {
  return (
    <button
      {...props}
      className={`w-full h-14 rounded-xl bg-emerald-600 active:bg-emerald-700 disabled:bg-slate-700 disabled:text-slate-400 font-semibold text-base flex items-center justify-center gap-2 ${className}`}
    >
      {children}
    </button>
  );
}
