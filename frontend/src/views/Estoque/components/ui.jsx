// Componentes visuais compartilhados do painel de Inventário.
import React from 'react';
import { Loader2, X } from 'lucide-react';
import { STATUS_INFO } from '../estoqueApi';

// --- [BLOCO: Badges e Cartões] ---
export function StatusBadge({ status }) {
  const info = STATUS_INFO[status] || { label: status, cls: 'bg-slate-800 text-slate-300 border-slate-700' };
  return <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border whitespace-nowrap ${info.cls}`}>{info.label}</span>;
}

export function StatCard({ label, value, tone = 'text-white', hint }) {
  return (
    <div className="bg-slate-900/80 border border-white/[0.05] p-4 rounded-2xl">
      <p className="text-xs text-slate-400 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone}`}>{value}</p>
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

export function Alert({ tone = 'error', children, onClose }) {
  const tones = {
    error: 'bg-red-500/10 text-red-300 border-red-500/20',
    warn: 'bg-amber-500/10 text-amber-200 border-amber-500/20',
    info: 'bg-sky-500/10 text-sky-200 border-sky-500/20',
    ok: 'bg-emerald-500/10 text-emerald-200 border-emerald-500/20',
  };
  return (
    <div className={`border p-3.5 rounded-xl text-sm flex gap-3 items-start ${tones[tone]}`}>
      <div className="flex-1">{children}</div>
      {onClose && <button onClick={onClose} className="opacity-70 hover:opacity-100"><X size={16} /></button>}
    </div>
  );
}

// --- [BLOCO: Botões] ---
const BUTTON_TONES = {
  primary: 'bg-indigo-600 hover:bg-indigo-500 text-white',
  success: 'bg-emerald-600 hover:bg-emerald-500 text-white',
  danger: 'bg-rose-600/90 hover:bg-rose-500 text-white',
  ghost: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700',
};

export function Button({ tone = 'ghost', loading = false, icon, children, className = '', ...props }) {
  const Icon = icon;
  return (
    <button {...props} disabled={props.disabled || loading}
      className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${BUTTON_TONES[tone]} ${className}`}>
      {loading ? <Loader2 size={16} className="animate-spin" /> : Icon && <Icon size={16} />}
      {children}
    </button>
  );
}

// --- [BLOCO: Modais] ---
export function Modal({ title, subtitle, onClose, children, footer, width = 'max-w-2xl' }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className={`w-full ${width} max-h-[90vh] flex flex-col bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl`}
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 p-5 border-b border-slate-800">
          <div>
            <h3 className="text-lg font-bold text-white">{title}</h3>
            {subtitle && <p className="text-sm text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={20} /></button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="p-4 border-t border-slate-800 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmModal({ title, message, confirmLabel = 'Confirmar', tone = 'primary', loading, onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={onClose} width="max-w-lg"
      footer={(
        <>
          <Button onClick={onClose}>Voltar</Button>
          <Button tone={tone} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      )}>
      <div className="text-sm text-slate-300 space-y-2">{message}</div>
    </Modal>
  );
}

// --- [BLOCO: Abas] ---
export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 bg-slate-900/80 border border-white/[0.05] p-1 rounded-xl w-fit">
      {tabs.map((tab) => (
        <button key={tab.key} onClick={() => onChange(tab.key)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${active === tab.key
            ? 'bg-slate-800 text-white border border-slate-700/70' : 'text-slate-400 hover:text-slate-200'}`}>
          {tab.label}
          {tab.badge ? <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300">{tab.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export const inputClass = 'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-indigo-500';
