import React, { useMemo, useState } from 'react';
import { Delete, LoaderCircle, Package, Plus, Scale, Hash, Trash2, Undo2 } from 'lucide-react';
import { Banner, Header, PrimaryButton } from '../components';
import {
  MODE_EMBALAGEM, MODE_PESO, MODE_UNIDADE, computeEntryQuantity, evaluateExpression, formatQty,
  itemEditable, localItemTotal,
} from '../counting';

const OPERATORS = ['+', '×', '(', ')'];
const isWeightUnit = (unit) => /KG|G$|GR/i.test(unit || '');

// --- [BLOCO: Descrição dos Lançamentos] ---
function describeEntry(entry, packagings, unit) {
  const pack = packagings.find((p) => p.id === entry.packaging_id);
  const raw = entry.expression || formatQty(entry.raw_qty);
  if (entry.mode === MODE_EMBALAGEM) {
    return `${raw} ${pack?.name || 'EMB'} × ${formatQty(entry.factor || pack?.factor || 1)}`;
  }
  if (entry.mode === MODE_PESO) {
    const tare = entry.tare_total ?? (pack ? (pack.tare_kg || 0) * (entry.tare_units || 1) : 0);
    return `${raw} ${unit || 'kg'} bruto − ${formatQty(tare)} tara`;
  }
  return raw;
}

const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');

// --- [BLOCO: Teclado de Expressão] ---
function ExpressionInput({ value, onChange, placeholder, autoFocus }) {
  const append = (token) => onChange(`${value}${token === '×' ? '*' : token}`);
  return (
    <div className="space-y-2">
      <input value={value.replace(/\*/g, '×')} onChange={(e) => onChange(e.target.value.replace(/×/g, '*'))}
        inputMode="decimal" placeholder={placeholder} autoFocus={autoFocus}
        className="w-full h-14 px-4 rounded-xl bg-slate-900 border border-slate-700 focus:border-emerald-500 outline-none text-2xl tabular-nums" />
      <div className="grid grid-cols-6 gap-2">
        {OPERATORS.map((op) => (
          <button key={op} type="button" onClick={() => append(op)}
            className="h-11 rounded-lg bg-slate-800 active:bg-slate-700 text-lg font-semibold">{op}</button>
        ))}
        <button type="button" onClick={() => onChange(value.slice(0, -1))} aria-label="Apagar"
          className="h-11 rounded-lg bg-slate-800 active:bg-slate-700 flex items-center justify-center"><Delete size={20} /></button>
        <button type="button" onClick={() => onChange('')}
          className="h-11 rounded-lg bg-slate-800 active:bg-slate-700 text-sm font-semibold">C</button>
      </div>
    </div>
  );
}

export default function ItemScreen({
  count, item, pending, initialPackaging, online, syncBadge, onBack, onAdd, onVoid, onRemovePending, onConfirmZero,
}) {
  const packagings = item.packagings || [];
  const weighable = isWeightUnit(item.unit) || packagings.some((p) => p.tare_kg > 0);
  const [mode, setMode] = useState(initialPackaging ? MODE_EMBALAGEM : MODE_UNIDADE);
  const [packagingId, setPackagingId] = useState(initialPackaging?.id || packagings[0]?.id || null);
  const [expr, setExpr] = useState('');
  const [tareUnits, setTareUnits] = useState('1');
  const [manualTare, setManualTare] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const editable = itemEditable(count, item);
  const itemPending = pending.filter((e) => e.item_id === item.id);
  const total = localItemTotal(item, pending);
  const pack = packagings.find((p) => p.id === packagingId) || null;
  const activeServerEntries = (item.entries || []).filter((e) => !e.voided);
  const hasAnyEntry = activeServerEntries.length > 0 || itemPending.some((e) => e.status !== 'rejected');

  // --- [BLOCO: Pré-visualização do Lançamento] ---
  const tareTotal = useMemo(() => {
    if (mode !== MODE_PESO) return 0;
    if (manualTare.trim()) return Number(manualTare.replace(',', '.')) || 0;
    return pack ? (pack.tare_kg || 0) * (Number(tareUnits) || 0) : 0;
  }, [mode, manualTare, pack, tareUnits]);

  const preview = useMemo(() => {
    if (!expr.trim()) return null;
    try {
      const raw = evaluateExpression(expr);
      const qty = computeEntryQuantity(mode, raw, pack?.factor || 1, tareTotal);
      return { raw, qty };
    } catch (err) {
      return { error: err.message };
    }
  }, [expr, mode, pack, tareTotal]);

  // --- [BLOCO: Ações] ---
  const submit = async () => {
    if (!preview || preview.error) return;
    if (mode === MODE_EMBALAGEM && !pack) { setError('Selecione a embalagem.'); return; }
    const hasOperator = /[+\-*/()]/.test(expr.replace(/^-/, ''));
    const payload = {
      item_id: item.id,
      mode,
      raw_qty: hasOperator ? null : preview.raw,
      expression: hasOperator ? expr.replace(/,/g, '.') : null,
      packaging_id: mode === MODE_UNIDADE ? null : (pack?.id || null),
      tare_total: mode === MODE_PESO && manualTare.trim() ? tareTotal : null,
      tare_units: mode === MODE_PESO && !manualTare.trim() && pack ? Number(tareUnits) || 1 : null,
      quantity: preview.qty,
    };
    setBusy(true);
    setError(null);
    try {
      await onAdd(payload);
      setExpr('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (fn) => {
    setError(null);
    try { await fn(); } catch (err) { setError(err.offline ? 'Sem conexão: esta ação precisa do servidor.' : err.message); }
  };

  const modes = [
    { key: MODE_UNIDADE, label: 'Unidades', Icon: Hash, show: true },
    { key: MODE_EMBALAGEM, label: 'Embalagem', Icon: Package, show: packagings.length > 0 },
    { key: MODE_PESO, label: 'Peso', Icon: Scale, show: weighable },
  ].filter((m) => m.show);

  return (
    <div className="min-h-screen pb-10">
      <Header title={item.product_name} subtitle={[item.ean, item.unit].filter(Boolean).join(' · ')} onBack={onBack} right={syncBadge} />

      <div className="mx-3 mt-3 p-4 rounded-2xl bg-slate-900 border border-slate-800 text-center">
        <p className="text-xs text-slate-400 uppercase tracking-wide">
          Total contado{item.current_round > 1 ? ` · recontagem ${item.current_round}` : ''}
        </p>
        <p className="text-5xl font-bold tabular-nums mt-1">{formatQty(total)}</p>
        <p className="text-sm text-slate-400">{item.unit || ''}</p>
        {item.confirmed_zero && <p className="mt-2 text-emerald-400 text-sm">Confirmado como zerado</p>}
      </div>

      {!editable && <Banner tone="warn">Contagem encerrada para este item. Peça uma recontagem à gerência se necessário.</Banner>}
      {error && <Banner tone="error" onClose={() => setError(null)}>{error}</Banner>}

      {editable && (
        <section className="px-3 mt-4 space-y-3">
          {modes.length > 1 && (
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${modes.length}, minmax(0, 1fr))` }}>
              {modes.map((option) => {
                const Icon = option.Icon;
                return (
                  <button key={option.key} onClick={() => setMode(option.key)}
                    className={`h-11 rounded-xl border flex items-center justify-center gap-1.5 text-sm ${mode === option.key
                      ? 'bg-emerald-600 border-emerald-600' : 'border-slate-700 text-slate-300'}`}>
                    <Icon size={16} /> {option.label}
                  </button>
                );
              })}
            </div>
          )}

          {mode !== MODE_UNIDADE && packagings.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {packagings.map((p) => (
                <button key={p.id} onClick={() => setPackagingId(p.id)}
                  className={`px-3 h-9 rounded-full border text-sm ${packagingId === p.id
                    ? 'bg-sky-700 border-sky-600' : 'border-slate-700 text-slate-300'}`}>
                  {p.name} {mode === MODE_PESO ? `· tara ${formatQty(p.tare_kg)}` : `× ${formatQty(p.factor)}`}
                </button>
              ))}
            </div>
          )}

          <ExpressionInput value={expr} onChange={setExpr} autoFocus
            placeholder={mode === MODE_EMBALAGEM ? `Qtd. de ${pack?.name || 'embalagens'}` : mode === MODE_PESO ? 'Peso bruto' : 'Quantidade'} />

          {mode === MODE_PESO && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-400">Nº de {pack?.name || 'embalagens'} (tara)
                <input value={tareUnits} onChange={(e) => setTareUnits(e.target.value)} inputMode="numeric"
                  disabled={!pack || !!manualTare.trim()}
                  className="mt-1 w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-700 text-base disabled:opacity-40" />
              </label>
              <label className="text-xs text-slate-400">Tara manual
                <input value={manualTare} onChange={(e) => setManualTare(e.target.value)} inputMode="decimal" placeholder="0,000"
                  className="mt-1 w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-700 text-base" />
              </label>
            </div>
          )}

          <div className="min-h-[24px] text-center text-sm">
            {preview?.error && <span className="text-rose-400">{preview.error}</span>}
            {preview && !preview.error && (
              <span className="text-slate-300">= <b className="text-white text-lg tabular-nums">{formatQty(preview.qty)}</b> {item.unit || ''}</span>
            )}
          </div>

          <PrimaryButton onClick={submit} disabled={busy || !preview || !!preview.error}>
            {busy ? <LoaderCircle size={20} className="animate-spin" /> : <Plus size={20} />} Lançar
          </PrimaryButton>

          {!hasAnyEntry && (
            <button onClick={() => runAction(() => onConfirmZero(!item.confirmed_zero))}
              className="w-full h-12 rounded-xl border border-slate-700 text-slate-200 active:bg-slate-800">
              {item.confirmed_zero ? 'Desfazer "zerado"' : 'Confirmar zerado (nenhuma unidade)'}
            </button>
          )}
        </section>
      )}

      {/* --- [BLOCO: Histórico de Lançamentos] --- */}
      <section className="px-3 mt-6">
        <h2 className="text-sm text-slate-400 mb-2">Lançamentos</h2>
        <ul className="space-y-2">
          {itemPending.map((e) => (
            <li key={e.client_uuid} className={`flex items-center gap-3 p-3 rounded-xl border ${e.status === 'rejected'
              ? 'border-rose-900 bg-rose-950/30' : 'border-sky-900 bg-sky-950/20'}`}>
              <div className="flex-1 min-w-0">
                <p className="tabular-nums">{describeEntry(e, packagings, item.unit)} = <b>{formatQty(e.quantity)}</b></p>
                <p className="text-xs text-slate-400">
                  {e.status === 'rejected' ? `Rejeitado: ${e.reason}` : `Aguardando envio · ${timeOf(e.counted_at)}`}
                </p>
              </div>
              <button onClick={() => runAction(() => onRemovePending(e.client_uuid))} aria-label="Remover"
                className="p-2 rounded-lg active:bg-slate-800 text-slate-400"><Trash2 size={18} /></button>
            </li>
          ))}
          {[...(item.entries || [])].reverse().map((e) => (
            <li key={e.id} className={`flex items-center gap-3 p-3 rounded-xl border border-slate-800 bg-slate-900 ${e.voided ? 'opacity-50' : ''}`}>
              <div className="flex-1 min-w-0">
                <p className={`tabular-nums ${e.voided ? 'line-through' : ''}`}>
                  {describeEntry(e, packagings, item.unit)} = <b>{formatQty(e.quantity)}</b>
                </p>
                <p className="text-xs text-slate-500">{e.user_name || ''} · {timeOf(e.counted_at || e.created_at)}{e.voided ? ' · estornado' : ''}</p>
              </div>
              {editable && !e.voided && (
                <button onClick={() => runAction(() => onVoid(e))} disabled={!online} aria-label="Estornar"
                  className="p-2 rounded-lg active:bg-slate-800 text-slate-400 disabled:opacity-30"><Undo2 size={18} /></button>
              )}
            </li>
          ))}
          {!itemPending.length && !(item.entries || []).length && (
            <li className="text-sm text-slate-500 text-center py-6">Nenhum lançamento ainda.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
