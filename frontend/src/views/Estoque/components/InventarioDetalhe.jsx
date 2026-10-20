import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Ban, CheckCheck, ClipboardCheck, Database, Download, FileUp, Link2, Play, RefreshCw, RotateCcw,
  Search, Send, ShieldCheck, Square, Undo2, Upload, XCircle,
} from 'lucide-react';
import Skeleton from '../../../components/common/Skeleton';
import StyledCheckbox from '../../../components/common/StyledCheckbox';
import { Alert, Button, ConfirmModal, StatCard, StatusBadge, Tabs, inputClass } from './ui';
import { BatchReviewModal, ItemReviewModal } from './ConferenciaModals';
import { formatDate, formatDateTime, formatMoney, formatQty } from '../estoqueApi';

const POLL_STATUSES = ['EFETIVANDO', 'REVERTENDO'];
const ITEM_FILTERS = [
  { key: 'TODOS', label: 'Todos' },
  { key: 'DIVERGENTES', label: 'Divergentes' },
  { key: 'PENDENCIAS', label: 'Com pendência' },
  { key: 'NEGATIVOS', label: 'Saldo negativo' },
  { key: 'RECONTAGEM', label: 'Recontagem' },
];

// Confirmações de ações relevantes (as de Omie alteram o estoque real)
const CONFIRMS = {
  cancelar: { title: 'Cancelar inventário', tone: 'danger', label: 'Cancelar inventário', message: 'O inventário será cancelado e não poderá ser retomado. Nada é enviado à Omie.' },
  aprovar: { title: 'Aprovar inventário', tone: 'success', label: 'Aprovar', message: 'A conferência fica congelada (hash de integridade). Depois disso, a efetivação envia os ajustes à Omie.' },
  desaprovar: { title: 'Desfazer aprovação', tone: 'primary', label: 'Desfazer aprovação', message: 'O inventário volta para conferência para correções.' },
  efetivar: { title: 'Efetivar na Omie', tone: 'success', label: 'Efetivar agora', message: 'Os ajustes de estoque serão lançados na Omie com a data de corte. Antes, o sistema confere se o saldo mudou desde a aprovação.' },
  reverter: { title: 'Reverter efetivação', tone: 'danger', label: 'Reverter', message: 'Todos os ajustes lançados na Omie por este inventário serão excluídos e ele voltará para conferência (exige nova aprovação).' },
  concluir: { title: 'Concluir inventário', tone: 'success', label: 'Concluir', message: 'Encerra o inventário com a via assinada anexada. Após concluir, não é possível reverter.' },
};

function ItemStatus({ item }) {
  const tags = [];
  if (item.count_status === 'RECONTAGEM') tags.push(['Recontagem', 'text-amber-300 border-amber-500/30']);
  else if (item.count_status === 'PENDENTE') tags.push(['Não contado', 'text-slate-400 border-slate-700']);
  if (item.confirmed_zero) tags.push(['Zerado', 'text-slate-300 border-slate-600']);
  if (item.adjustment?.status === 'FAILED') tags.push(['Ajuste falhou', 'text-rose-300 border-rose-500/30']);
  if (item.adjustment?.status === 'DONE') tags.push(['Ajustado', 'text-emerald-300 border-emerald-500/30']);
  if (item.verify_status === 'DIVERGENTE') tags.push(['Divergente na Omie', 'text-rose-300 border-rose-500/30']);
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map(([text, cls]) => <span key={text} className={`text-[11px] px-1.5 py-0.5 rounded border ${cls}`}>{text}</span>)}
    </div>
  );
}

export default function InventarioDetalhe({ api, countId, motivos, onBack, onTaskStart }) {
  // --- [BLOCO: Estado] ---
  const [count, setCount] = useState(null);
  const [error, setError] = useState(null);
  const [issueList, setIssueList] = useState(null);
  const [tab, setTab] = useState('itens');
  const [filter, setFilter] = useState('TODOS');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [reviewItem, setReviewItem] = useState(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(null);
  const [summary, setSummary] = useState(null);
  const [pairs, setPairs] = useState([]);

  const allLabels = useMemo(() => ({ ...motivos.falta, ...motivos.sobra }), [motivos]);

  const load = useCallback(async () => {
    try {
      const data = await api.inventario(countId);
      setCount(data);
      if (data.status === 'CONFERENCIA' && data.snapshot_at) {
        const [iss, sum, pr] = await Promise.all([api.pendenciasAprovacao(countId), api.resumo(countId), api.paresSugeridos(countId)]);
        setIssueList(iss.pendencias);
        setSummary(sum);
        setPairs(pr.pares);
      } else {
        setIssueList(null);
        if (data.snapshot_at) setSummary(await api.resumo(countId));
      }
    } catch (e) {
      setError(e.message);
    }
  }, [api, countId]);

  useEffect(() => { load(); }, [load]);

  // Acompanha efetivação/reversão enquanto a fila da Omie processa
  useEffect(() => {
    if (!count || !(POLL_STATUSES.includes(count.status) || count.omie_task_id)) return undefined;
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [count, load]);

  const issuesByItem = useMemo(() => {
    const map = {};
    (issueList || []).forEach((i) => { (map[i.item_id] = map[i.item_id] || []).push(i.message); });
    return map;
  }, [issueList]);

  // --- [BLOCO: Ações] ---
  const run = async (key, fn) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      const details = Array.isArray(e.details) ? e.details : null;
      setError(details?.length && details[0]?.message
        ? `${e.message} ${details.slice(0, 5).map((d) => `${d.product_name}: ${d.message}`).join(' · ')}${details.length > 5 ? ' …' : ''}`
        : e.message);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const transition = (action, title) => run(action, async () => {
    const res = await api.transicao(countId, action);
    if (res.task_id) onTaskStart?.(res.task_id, `${title} · Inventário #${countId}`, () => load());
    await load();
  });

  const captureSnapshot = () => run('snapshot', async () => {
    const res = await api.snapshot(countId);
    onTaskStart?.(res.task_id, `Saldo do sistema · Inventário #${countId}`, () => load());
    await load();
  });

  const suggestedRecounts = () => run('recount', async () => {
    const res = await api.recontagemSugerida(countId);
    setError(null);
    await load();
    if (!res.total) setError('Nenhum item ultrapassa os limites de recontagem.');
  });

  const linkPair = (pair) => run(`pair-${pair.falta_item_id}`, async () => {
    await api.atualizarConferencia(pair.falta_item_id, { pair_item_id: pair.sobra_item_id });
    await load();
  });

  const uploadSigned = (file) => run('upload', async () => {
    await api.enviarViaAssinada(countId, file);
    await load();
  });

  if (!count) {
    return (
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Skeleton type="card" />
        <Skeleton type="table" rows={8} columns={7} />
      </div>
    );
  }

  const status = count.status;
  const isReview = status === 'CONFERENCIA';
  const hasSnapshot = Boolean(count.snapshot_at);
  const hasSigned = count.documents?.some((d) => d.kind === 'VIA_ASSINADA');

  const visibleItems = count.items.filter((item) => {
    const q = query.trim().toLowerCase();
    if (q && !item.product_name.toLowerCase().includes(q) && !(item.ean || '').includes(q)) return false;
    if (filter === 'DIVERGENTES') return item.difference;
    if (filter === 'PENDENCIAS') return issuesByItem[item.id];
    if (filter === 'NEGATIVOS') return item.system_qty < 0;
    if (filter === 'RECONTAGEM') return item.count_status === 'RECONTAGEM' || item.current_round > 1;
    return true;
  });
  const allSelected = visibleItems.length > 0 && visibleItems.every((i) => selected.has(i.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visibleItems.map((i) => i.id)));
  const toggleOne = (id) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // --- [BLOCO: Barra de Ações por Status] ---
  const actions = {
    RASCUNHO: [
      <Button key="i" tone="primary" icon={Play} loading={busy === 'iniciar'} onClick={() => transition('iniciar', 'Iniciar')}>Iniciar contagem</Button>,
      <Button key="d" icon={XCircle} loading={busy === 'delete'} onClick={() => run('delete', async () => { await api.excluirRascunho(countId); onBack(); })}>Excluir rascunho</Button>,
    ],
    EM_CONTAGEM: [
      <Button key="e" tone="primary" icon={Square} loading={busy === 'encerrar'} onClick={() => transition('encerrar', 'Encerrar')}>Encerrar contagem</Button>,
      <Button key="c" icon={Ban} onClick={() => setConfirm('cancelar')}>Cancelar</Button>,
    ],
    CONFERENCIA: [
      <Button key="s" tone={hasSnapshot ? 'ghost' : 'primary'} icon={Database} loading={busy === 'snapshot'} disabled={Boolean(count.omie_task_id)} onClick={captureSnapshot}>
        {hasSnapshot ? 'Recapturar saldo' : 'Capturar saldo do sistema'}
      </Button>,
      hasSnapshot && <Button key="r" icon={RotateCcw} loading={busy === 'recount'} onClick={suggestedRecounts}>Recontagem sugerida</Button>,
      <Button key="ro" icon={Undo2} loading={busy === 'reabrir_contagem'} onClick={() => transition('reabrir_contagem', 'Reabrir')}>Reabrir contagem</Button>,
      hasSnapshot && <Button key="en" tone="primary" icon={Send} loading={busy === 'enviar'} disabled={issueList?.length > 0} onClick={() => transition('enviar', 'Enviar')}>Enviar para aprovação</Button>,
      <Button key="c" icon={Ban} onClick={() => setConfirm('cancelar')}>Cancelar</Button>,
    ],
    AGUARDANDO_APROVACAO: [
      <Button key="a" tone="success" icon={ShieldCheck} onClick={() => setConfirm('aprovar')}>Aprovar</Button>,
      <Button key="r" icon={Undo2} loading={busy === 'rejeitar'} onClick={() => transition('rejeitar', 'Rejeitar')}>Devolver para conferência</Button>,
    ],
    APROVADO: [
      <Button key="e" tone="success" icon={CheckCheck} onClick={() => setConfirm('efetivar')}>Efetivar na Omie</Button>,
      <Button key="d" icon={Undo2} onClick={() => setConfirm('desaprovar')}>Desfazer aprovação</Button>,
      <Button key="c" icon={Ban} onClick={() => setConfirm('cancelar')}>Cancelar</Button>,
    ],
    EFETIVANDO_COM_ERRO: [
      <Button key="p" tone="primary" icon={RefreshCw} loading={busy === 'reprocessar'} onClick={() => transition('reprocessar', 'Reprocessar')}>Reprocessar falhas</Button>,
      <Button key="r" tone="danger" icon={Undo2} onClick={() => setConfirm('reverter')}>Reverter</Button>,
    ],
    EFETIVADO: [
      <Button key="c" tone="success" icon={ClipboardCheck} disabled={!hasSigned} title={hasSigned ? '' : 'Envie a via assinada'} onClick={() => setConfirm('concluir')}>Concluir</Button>,
      <Button key="r" tone="danger" icon={Undo2} onClick={() => setConfirm('reverter')}>Reverter</Button>,
    ],
    REVERSAO_COM_ERRO: [
      <Button key="r" tone="danger" icon={Undo2} onClick={() => setConfirm('reverter')}>Tentar reverter novamente</Button>,
    ],
  }[status] || [];

  const confirmInfo = confirm && CONFIRMS[confirm];
  const progress = count.item_count ? Math.round((count.counted_items / count.item_count) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* --- [BLOCO: Cabeçalho] --- */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button onClick={onBack} className="mt-1 p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"><ArrowLeft size={18} /></button>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-white">{count.family_name}</h2>
              <StatusBadge status={status} />
            </div>
            <p className="text-sm text-slate-400 mt-1">
              Inventário #{count.id} · corte {formatDate(count.cutoff_date)} · criado por {count.created_by || '—'} em {formatDateTime(count.created_at)}
              {count.approved_by && ` · aprovado por ${count.approved_by}`}
            </p>
            {count.notes && <p className="text-sm text-slate-500 mt-0.5">{count.notes}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">{actions.filter(Boolean)}</div>
      </div>

      {error && <Alert onClose={() => setError(null)}>{error}</Alert>}
      {count.last_error && <Alert tone="warn">{count.last_error}</Alert>}
      {POLL_STATUSES.includes(status) && <Alert tone="info">Processando na Omie… a tela atualiza automaticamente.</Alert>}
      {isReview && !hasSnapshot && <Alert tone="info">Capture o saldo do sistema para ver as divergências. A contagem continua cega para quem conta.</Alert>}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Contados" value={`${count.counted_items}/${count.item_count}`} hint={`${progress}% dos itens`} />
        <StatCard label="Perdas" value={formatMoney(summary?.perdas_value)} tone="text-rose-300" />
        <StatCard label="Quebra técnica" value={formatMoney(summary?.quebra_tecnica_value)} tone="text-amber-300" />
        <StatCard label="Sobras" value={formatMoney(summary?.sobras_value)} tone="text-emerald-300" />
        <StatCard label="Resultado líquido" value={formatMoney(summary?.net_value)}
          tone={(summary?.net_value || 0) < 0 ? 'text-rose-300' : 'text-emerald-300'}
          hint={hasSnapshot ? `Saldo capturado em ${formatDateTime(count.snapshot_at)}` : 'Saldo ainda não capturado'} />
      </div>

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'itens', label: 'Itens', badge: issueList?.length || 0 },
        { key: 'resumo', label: 'Resumo por motivo' },
        { key: 'documentos', label: 'Documentos' },
      ]} />

      {/* --- [BLOCO: Aba Itens] --- */}
      {tab === 'itens' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-72">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input className={`${inputClass} pl-9`} placeholder="Buscar produto ou EAN" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="flex gap-1">
              {ITEM_FILTERS.map((f) => (
                <button key={f.key} onClick={() => setFilter(f.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${filter === f.key
                    ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}>{f.label}</button>
              ))}
            </div>
            {isReview && hasSnapshot && selected.size > 0 && (
              <Button tone="primary" onClick={() => setBatchOpen(true)}>Conferência em lote ({selected.size})</Button>
            )}
          </div>

          {issueList?.length > 0 && filter !== 'PENDENCIAS' && (
            <Alert tone="warn">
              {issueList.length} pendência(s) impedem o envio para aprovação.{' '}
              <button className="underline" onClick={() => setFilter('PENDENCIAS')}>Ver itens</button>
            </Alert>
          )}

          <div className="bg-slate-900/80 border border-white/[0.05] rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-950/50 text-slate-400 text-xs uppercase">
                <tr>
                  {isReview && hasSnapshot && (
                    <th className="px-3 py-3 w-10"><StyledCheckbox checked={allSelected} onChange={toggleAll} size="sm" /></th>
                  )}
                  <th className="px-3 py-3 text-left">Produto</th>
                  <th className="px-3 py-3 text-right">Contado</th>
                  <th className="px-3 py-3 text-right">Sistema</th>
                  <th className="px-3 py-3 text-right">Diferença</th>
                  <th className="px-3 py-3 text-right">Valor</th>
                  <th className="px-3 py-3 text-center">Caso</th>
                  <th className="px-3 py-3 text-left">Motivos</th>
                  <th className="px-3 py-3 text-left">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {visibleItems.map((item) => {
                  const issues = issuesByItem[item.id];
                  const diff = item.difference;
                  return (
                    <tr key={item.id} onClick={() => isReview && hasSnapshot && setReviewItem(item)}
                      className={`${isReview && hasSnapshot ? 'cursor-pointer hover:bg-slate-800/40' : ''} ${issues ? 'bg-amber-500/[0.03]' : ''}`}>
                      {isReview && hasSnapshot && (
                        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <StyledCheckbox checked={selected.has(item.id)} onChange={() => toggleOne(item.id)} size="sm" />
                        </td>
                      )}
                      <td className="px-3 py-2.5">
                        <p className="text-white">{item.product_name}</p>
                        <p className="text-xs text-slate-500">{item.ean || `Cód. ${item.omie_id}`} · {item.unit || '—'}</p>
                        {issues && <p className="text-xs text-amber-300 mt-0.5">{issues.join(' · ')}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{item.count_status === 'PENDENTE' ? '—' : formatQty(item.counted_qty)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${item.system_qty < 0 ? 'text-rose-300' : 'text-slate-300'}`}>{formatQty(item.system_qty)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${diff < 0 ? 'text-rose-300' : diff > 0 ? 'text-emerald-300' : 'text-slate-500'}`}>
                        {diff === null ? '—' : `${diff > 0 ? '+' : ''}${formatQty(diff)}`}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">{formatMoney(item.difference_value)}</td>
                      <td className="px-3 py-2.5 text-center">
                        {item.adjustment_case && (
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${item.adjustment_case === 'A' ? 'bg-slate-800 text-slate-300' : 'bg-amber-500/15 text-amber-300'}`}>
                            {item.adjustment_case}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-300">
                        {item.reasons.map((r) => `${formatQty(r.quantity)} ${allLabels[r.reason] || r.reason}`).join('; ') || '—'}
                        {item.pair_item_id && <span className="ml-1 text-sky-300 inline-flex items-center gap-0.5"><Link2 size={12} />par</span>}
                      </td>
                      <td className="px-3 py-2.5"><ItemStatus item={item} /></td>
                    </tr>
                  );
                })}
                {!visibleItems.length && (
                  <tr><td colSpan={9} className="text-center text-slate-500 py-10">Nenhum item neste filtro.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- [BLOCO: Aba Resumo] --- */}
      {tab === 'resumo' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-slate-900/80 border border-white/[0.05] rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.05] font-semibold text-white">Por motivo</div>
            {summary ? (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-800/60">
                  {Object.entries(summary.by_reason).sort((a, b) => a[1].value - b[1].value).map(([reason, v]) => (
                    <tr key={reason}>
                      <td className="px-4 py-2.5 text-slate-300">{allLabels[reason] || (reason === 'SEM_MOTIVO' ? 'Sem motivo' : reason)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-400">{v.qty_items} item(ns) · {formatQty(v.quantity)}</td>
                      <td className={`px-4 py-2.5 text-right font-semibold ${v.value < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{formatMoney(v.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="p-4 text-sm text-slate-500">Disponível após capturar o saldo do sistema.</p>}
          </div>
          <div className="bg-slate-900/80 border border-white/[0.05] rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.05] font-semibold text-white">Pares sugeridos (troca de produto no PDV)</div>
            <div className="divide-y divide-slate-800/60">
              {pairs.map((p) => (
                <div key={`${p.falta_item_id}-${p.sobra_item_id}`} className="px-4 py-3 flex items-center gap-3 text-sm">
                  <div className="flex-1">
                    <p className="text-rose-300">− {formatQty(p.falta_qty)} {p.falta_product_name}</p>
                    <p className="text-emerald-300">+ {formatQty(p.sobra_qty)} {p.sobra_product_name}</p>
                  </div>
                  {isReview && <Button icon={Link2} loading={busy === `pair-${p.falta_item_id}`} onClick={() => linkPair(p)}>Vincular</Button>}
                </div>
              ))}
              {!pairs.length && <p className="p-4 text-sm text-slate-500">Nenhum par sugerido.</p>}
            </div>
          </div>
        </div>
      )}

      {/* --- [BLOCO: Aba Documentos] --- */}
      {tab === 'documentos' && (
        <div className="bg-slate-900/80 border border-white/[0.05] rounded-2xl p-5 space-y-5">
          <div className="flex flex-wrap gap-3">
            <Button icon={Download} disabled={!hasSnapshot}
              onClick={() => run('csv', () => api.baixar(`/inventarios/${countId}/faltas.csv`, `faltas_inventario_${countId}.csv`))}>
              Planilha de faltas (fiscal)
            </Button>
            {['APROVADO', 'EFETIVANDO', 'EFETIVANDO_COM_ERRO', 'EFETIVADO'].includes(status) && (
              <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer">
                {busy === 'upload' ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
                Enviar via assinada
                <input type="file" accept="application/pdf,image/jpeg,image/png" className="hidden"
                  onChange={(e) => { if (e.target.files?.[0]) uploadSigned(e.target.files[0]); e.target.value = ''; }} />
              </label>
            )}
          </div>
          <div className="divide-y divide-slate-800/60 border border-slate-800 rounded-xl">
            {(count.documents || []).map((d) => (
              <div key={d.id} className="px-4 py-3 flex items-center gap-3 text-sm">
                <FileUp size={16} className="text-slate-400" />
                <div className="flex-1">
                  <p className="text-white">{d.filename}</p>
                  <p className="text-xs text-slate-500">{d.kind === 'VIA_ASSINADA' ? 'Via assinada' : 'Relatório'} · {formatDateTime(d.created_at)}</p>
                </div>
                <Button icon={Download} onClick={() => run('doc', () => api.baixar(`/documentos/${d.id}`, d.filename))}>Baixar</Button>
              </div>
            ))}
            {!count.documents?.length && <p className="p-4 text-sm text-slate-500">Nenhum documento anexado.</p>}
          </div>
        </div>
      )}

      {/* --- [BLOCO: Modais] --- */}
      {reviewItem && (
        <ItemReviewModal api={api} count={count} item={reviewItem} motivos={motivos} onClose={() => setReviewItem(null)}
          onSaved={async () => { setReviewItem(null); await load(); }} />
      )}
      {batchOpen && (
        <BatchReviewModal api={api} count={count} itemIds={[...selected]} motivos={motivos}
          onClose={() => { setBatchOpen(false); setSelected(new Set()); }} onDone={load} />
      )}
      {confirmInfo && (
        <ConfirmModal title={confirmInfo.title} message={<p>{confirmInfo.message}</p>} confirmLabel={confirmInfo.label}
          tone={confirmInfo.tone} loading={busy === confirm} onClose={() => setConfirm(null)}
          onConfirm={() => transition(confirm, confirmInfo.title)} />
      )}
    </div>
  );
}
