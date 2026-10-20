// Componentes visuais compartilhados do app de contagem (tema escuro do sistema, alvos de toque grandes).
import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft, Cloud, CloudOff, Delete, RefreshCw, TriangleAlert, X,
} from 'lucide-react';

// --- [BLOCO: Cabeçalho e Sincronização] ---
// Cabeçalho fixo que respeita a barra de status; `children` fica no mesmo bloco fixo (busca, filtros).
export function Header({ title, subtitle, onBack, right, children }) {
  return (
    <header className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800 safe-top safe-x">
      <div className="px-3 py-2 flex items-center gap-2 min-h-[56px]">
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
      </div>
      {children}
    </header>
  );
}

export function IconButton({ icon, label, onClick, spinning = false, disabled = false }) {
  const Icon = icon;
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label}
      className="p-2 rounded-lg active:bg-slate-800 disabled:opacity-40">
      <Icon size={20} className={spinning ? 'animate-spin' : ''} />
    </button>
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
    <button onClick={onSync} className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border whitespace-nowrap ${tone}`}>
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

const TONES = {
  info: 'bg-sky-950 border-sky-800 text-sky-100',
  warn: 'bg-amber-950 border-amber-800 text-amber-100',
  error: 'bg-rose-950 border-rose-800 text-rose-100',
  ok: 'bg-emerald-950 border-emerald-800 text-emerald-100',
};

// Aviso dentro do conteúdo (abaixo do cabeçalho)
export function Banner({ tone = 'info', children, onClose }) {
  return (
    <div className={`mx-3 mt-3 px-3 py-2.5 rounded-xl border text-sm flex items-start gap-2 ${TONES[tone]}`}>
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

// Ação destrutiva em dois toques: o primeiro arma, o segundo (em até 3s) confirma
export function ConfirmButton({ icon, label, confirmLabel = 'Confirmar?', onConfirm, disabled }) {
  const Icon = icon;
  const [armed, setArmed] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const press = () => {
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), 3000);
      return;
    }
    clearTimeout(timer.current);
    setArmed(false);
    onConfirm();
  };
  return (
    <button onClick={press} disabled={disabled} aria-label={label}
      className={`h-10 rounded-lg flex items-center gap-1 text-sm disabled:opacity-30 ${armed
        ? 'px-3 bg-rose-600 text-white font-semibold' : 'px-2 text-slate-400 active:bg-slate-800'}`}>
      {armed ? confirmLabel : <Icon size={18} />}
    </button>
  );
}

// --- [BLOCO: Avisos Flutuantes] ---
// Fixos na parte de baixo, acima da barra de gestos. Info/ok somem sozinhos; erros ficam até fechar.
export function Toasts({ toasts, onDismiss }) {
  return (
    <div className="fixed left-3 right-3 bottom-safe-3 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className={`toast-in pointer-events-auto px-4 py-3 rounded-xl border shadow-2xl text-sm flex items-start gap-3 ${TONES[t.tone]}`}>
          <div className="flex-1">
            {t.text}
            {t.action && (
              <a href={t.action.href} target="_blank" rel="noreferrer" className="ml-2 underline font-semibold">{t.action.label}</a>
            )}
          </div>
          <button onClick={() => onDismiss(t.id)} aria-label="Fechar"><X size={16} /></button>
        </div>
      ))}
    </div>
  );
}

// --- [BLOCO: Teclado Numérico] ---
// Teclado próprio da contagem: teclas grandes, sem abrir o teclado do Android.
const KEYS = ['7', '8', '9', 'DEL', '4', '5', '6', '*', '1', '2', '3', '+', ',', '0', '(', ')'];

export function Keypad({ value, onChange }) {
  const press = (key) => {
    if (key === 'DEL') onChange(value.slice(0, -1));
    else onChange(`${value}${key}`);
  };
  return (
    <div className="grid grid-cols-4 gap-2">
      {KEYS.map((key) => {
        const isOp = ['*', '+', '(', ')', 'DEL'].includes(key);
        return (
          <button key={key} type="button" onClick={() => press(key)}
            className={`h-14 rounded-xl text-2xl font-semibold flex items-center justify-center active:scale-95 transition-transform ${isOp
              ? 'bg-slate-800 text-sky-300 active:bg-slate-700' : 'bg-slate-900 border border-slate-700 active:bg-slate-800'}`}>
            {key === 'DEL' ? <Delete size={24} /> : key === '*' ? '×' : key}
          </button>
        );
      })}
    </div>
  );
}
