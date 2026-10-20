// Modais da conferência: revisão de um item (motivos, justificativa, custos, par) e conferência em lote.
import React, { useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import SelectDropdown from '../../../components/common/SelectDropdown';
import StyledCheckbox from '../../../components/common/StyledCheckbox';
import { Alert, Button, Modal, inputClass } from './ui';
import { CASE_INFO, formatMoney, formatQty } from '../estoqueApi';

const toNumber = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const round4 = (v) => Math.round(v * 10000) / 10000;

// --- [BLOCO: Revisão do Item] ---
export function ItemReviewModal({ api, count, item, motivos, onClose, onSaved }) {
  const diff = item.difference ?? 0;
  const isFalta = diff < 0;
  const reasonOptions = Object.entries(isFalta ? motivos.falta : motivos.sobra).map(([value, label]) => ({ value, label }));
  const [rows, setRows] = useState(() => item.reasons.map((r) => ({ reason: r.reason, quantity: String(r.quantity), note: r.note || '' })));
  const [justification, setJustification] = useState(item.justification || '');
  const [refCost, setRefCost] = useState(item.reference_cost ?? '');
  const [cmcFix, setCmcFix] = useState(item.cmc_correction_approved);
  const [pairId, setPairId] = useState(item.pair_item_id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const allocated = round4(rows.reduce((s, r) => s + toNumber(r.quantity), 0));
  const remaining = round4(Math.abs(diff) - allocated);
  const needsRef = item.adjustment_case === 'B' || (item.adjustment_case === 'C' && cmcFix);
  const pairOptions = useMemo(() => count.items
    .filter((i) => i.id !== item.id && i.difference && Math.sign(i.difference) === -Math.sign(diff))
    .map((i) => ({ value: i.id, label: i.product_name, subtitle: `${i.difference > 0 ? '+' : ''}${formatQty(i.difference)} ${i.unit || ''}` })),
  [count.items, item.id, diff]);

  const setRow = (idx, patch) => setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const addRow = (reason = null, qty = '') => setRows((prev) => [...prev, { reason: reason || reasonOptions[0]?.value, quantity: String(qty), note: '' }]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (diff) {
        await api.atualizarMotivos(item.id, rows.filter((r) => toNumber(r.quantity) > 0)
          .map((r) => ({ reason: r.reason, quantity: toNumber(r.quantity), note: r.note.trim() || null })));
      }
      const review = { justification: justification.trim() || null, pair_item_id: pairId || null };
      if (refCost !== '' && toNumber(refCost) !== item.reference_cost) review.reference_cost = toNumber(refCost);
      if (item.adjustment_case === 'C') review.cmc_correction_approved = cmcFix;
      onSaved(await api.atualizarConferencia(item.id, review));
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={item.product_name} subtitle={`Caso ${item.adjustment_case || '—'}: ${CASE_INFO[item.adjustment_case] || 'sem saldo capturado'}`}
      onClose={onClose} width="max-w-3xl"
      footer={(
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button tone="primary" icon={Save} loading={saving} onClick={save}>Salvar conferência</Button>
        </>
      )}>
      <div className="space-y-5">
        {error && <Alert onClose={() => setError(null)}>{error}</Alert>}

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          {[
            ['Sistema', `${formatQty(item.system_qty)} ${item.unit || ''}`],
            ['Contado', `${formatQty(item.counted_qty)} ${item.unit || ''}`],
            ['Diferença', `${diff > 0 ? '+' : ''}${formatQty(diff)}`, diff < 0 ? 'text-rose-300' : diff > 0 ? 'text-emerald-300' : ''],
            ['Valor', formatMoney(item.difference_value)],
            ['CMC / Últ. compra', `${formatMoney(item.cmc)} / ${formatMoney(item.reference_cost)}`, item.cmc_suspicious ? 'text-amber-300' : ''],
          ].map(([label, value, cls]) => (
            <div key={label} className="bg-slate-950/60 border border-slate-800 rounded-xl p-3">
              <p className="text-[11px] text-slate-500 uppercase">{label}</p>
              <p className={`font-semibold mt-0.5 ${cls || 'text-white'}`}>{value}</p>
            </div>
          ))}
        </div>

        {diff !== 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-slate-200">Motivos da {isFalta ? 'falta' : 'sobra'}</p>
              <span className={`text-xs ${remaining === 0 ? 'text-emerald-300' : 'text-amber-300'}`}>
                {remaining === 0 ? 'Distribuição completa' : remaining > 0 ? `Falta distribuir ${formatQty(remaining)}` : `Excede em ${formatQty(-remaining)}`}
              </span>
            </div>
            <div className="space-y-2">
              {rows.map((row, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-5">
                    <SelectDropdown value={row.reason} onChange={(v) => setRow(idx, { reason: v })} options={reasonOptions} size="sm" />
                  </div>
                  <input className={`${inputClass} col-span-2`} value={row.quantity} inputMode="decimal"
                    onChange={(e) => setRow(idx, { quantity: e.target.value })} placeholder="Qtd" />
                  <input className={`${inputClass} col-span-4`} value={row.note} onChange={(e) => setRow(idx, { note: e.target.value })} placeholder="Observação" />
                  <button className="col-span-1 text-slate-500 hover:text-rose-300 flex justify-center"
                    onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <Button icon={Plus} onClick={() => addRow()}>Adicionar motivo</Button>
              {remaining > 0 && (
                <Button onClick={() => addRow(reasonOptions[reasonOptions.length - 1]?.value, remaining)}>
                  Restante como "{reasonOptions[reasonOptions.length - 1]?.label}"
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block text-sm text-slate-300">
            Custo de referência (R$){needsRef && <span className="text-amber-300"> *</span>}
            <input className={`${inputClass} mt-1`} value={refCost} inputMode="decimal" onChange={(e) => setRefCost(e.target.value)} />
            <span className="text-xs text-slate-500">
              {item.reference_cost_source === 'MANUAL' ? 'Informado manualmente' : 'Última compra na Omie'} · usado no ajuste de saldo
            </span>
          </label>
          {pairOptions.length > 0 && (
            <div className="text-sm text-slate-300">
              Par (troca de produto no PDV)
              <div className="mt-1">
                <SelectDropdown value={pairId} onChange={setPairId} searchable placeholder="Sem par"
                  options={[{ value: null, label: 'Sem par' }, ...pairOptions]} />
              </div>
            </div>
          )}
        </div>

        {item.adjustment_case === 'C' && (
          <StyledCheckbox checked={cmcFix} onChange={setCmcFix} label="Aprovar correção do CMC"
            description={`O ajuste redefine o CMC de ${formatMoney(item.cmc)} para o custo de referência.`} />
        )}

        <label className="block text-sm text-slate-300">
          Justificativa{['B', 'D'].includes(item.adjustment_case) && <span className="text-amber-300"> * (saldo negativo no sistema)</span>}
          <textarea className={`${inputClass} mt-1 h-20 resize-none`} value={justification} onChange={(e) => setJustification(e.target.value)}
            placeholder="Aparece no relatório de perda" />
        </label>
      </div>
    </Modal>
  );
}

// --- [BLOCO: Conferência em Lote] ---
export function BatchReviewModal({ api, count, itemIds, motivos, onClose, onDone }) {
  const [reason, setReason] = useState(null);
  const [justification, setJustification] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const options = [
    ...Object.entries(motivos.falta).map(([value, label]) => ({ value, label, subtitle: 'Falta' })),
    ...Object.entries(motivos.sobra).map(([value, label]) => ({ value, label, subtitle: 'Sobra' })),
  ];

  const apply = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await api.conferenciaLote(count.id, { item_ids: itemIds, reason, justification: justification.trim() || null });
      setResult(res);
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const names = Object.fromEntries(count.items.map((i) => [i.id, i.product_name]));
  return (
    <Modal title={`Conferência em lote (${itemIds.length} itens)`} subtitle="O motivo é aplicado ao restante ainda não distribuído de cada item"
      onClose={onClose} width="max-w-xl"
      footer={result ? <Button tone="primary" onClick={onClose}>Fechar</Button> : (
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button tone="primary" loading={saving} disabled={!reason && !justification.trim()} onClick={apply}>Aplicar</Button>
        </>
      )}>
      {result ? (
        <div className="space-y-3 text-sm">
          <Alert tone="ok">{result.updated.length} item(ns) atualizado(s).</Alert>
          {result.skipped.length > 0 && (
            <Alert tone="warn">
              <p className="font-semibold mb-1">Ignorados:</p>
              {result.skipped.map((s) => <p key={s.item_id}>{names[s.item_id] || s.item_id}: {s.reason}</p>)}
            </Alert>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {error && <Alert onClose={() => setError(null)}>{error}</Alert>}
          <div className="text-sm text-slate-300">
            Motivo para o restante
            <div className="mt-1"><SelectDropdown value={reason} onChange={setReason} options={options} placeholder="Opcional" /></div>
            <p className="text-xs text-slate-500 mt-1">Itens cuja divergência não combina com o motivo (falta x sobra) são ignorados.</p>
          </div>
          <label className="block text-sm text-slate-300">
            Justificativa única
            <textarea className={`${inputClass} mt-1 h-24 resize-none`} value={justification} onChange={(e) => setJustification(e.target.value)}
              placeholder="Ex: Saneamento inicial: estoque negativo histórico" />
          </label>
        </div>
      )}
    </Modal>
  );
}
