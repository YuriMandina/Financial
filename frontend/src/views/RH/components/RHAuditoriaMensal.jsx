import React, { useEffect, useMemo, useState } from 'react';
import {
  ShieldAlert, ShieldCheck, ChevronDown, ChevronRight, AlertTriangle, Info, Clock, CheckCircle2, RefreshCw, History
} from 'lucide-react';
import Skeleton from '../../../components/common/Skeleton';
import StyledCheckbox from '../../../components/common/StyledCheckbox';

// ==============================================================================
// --- [BLOCO: CONSTANTES E FORMATAÇÃO] ---
// ==============================================================================

const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const STATUS_LABELS = {
  PENDENTE: { label: 'Pendente', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
  APROVADA: { label: 'Aprovada', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
  REABERTA: { label: 'Reaberta', cls: 'bg-orange-500/15 text-orange-300 border-orange-500/40' },
  SEM_IRREGULARIDADES: { label: 'Sem irregularidades', cls: 'bg-slate-800 text-slate-300 border-slate-700' }
};

const SEVERITY = {
  CRITICA: { label: 'Crítica', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/40' },
  ALERTA: { label: 'Alerta', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40' }
};

const ORIGIN_LABELS = { MANUAL: 'Manual', LOTE: 'Lote', RESET: 'Restauração' };

const LATE_DECISIONS = [
  { key: 'ACEITAR_COMPENSACAO', label: 'Aceitar compensação' },
  { key: 'ABONAR', label: 'Abonar' },
  { key: 'NORMAL', label: 'Tratar normalmente' }
];

const fmtDate = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const fmtDates = (dates = []) => {
  if (dates.length <= 2) return dates.map(fmtDate).join(' e ');
  return `${fmtDate(dates[0])} a ${fmtDate(dates[dates.length - 1])}`;
};
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const describeDay = (snap) => {
  if (!snap) return 'sem registro';
  if (snap.status !== 'TRABALHO') return snap.status;
  return snap.lunch_start
    ? `${snap.start_time}–${snap.lunch_start} / ${snap.lunch_end}–${snap.end_time}`
    : `${snap.start_time}–${snap.end_time}`;
};

// ==============================================================================
// --- [BLOCO: FICHA DA IRREGULARIDADE] ---
// ==============================================================================

function IrregularityCard({ item, open, onToggle, token, apiBase, draft, onDraft, editable }) {
  const [details, setDetails] = useState(null);

  useEffect(() => {
    if (!open || details) return;
    fetch(`${apiBase}/api/rh/compliance/items/${item.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then(setDetails)
      .catch(() => {});
  }, [open]);

  const sev = SEVERITY[item.severity] || SEVERITY.ALERTA;
  const st = STATUS_LABELS[item.status] || STATUS_LABELS.PENDENTE;

  return (
    <div id={`irregularidade-${item.fingerprint}`} className="border border-slate-800 rounded-lg bg-slate-950/60">
      <button type="button" onClick={onToggle} className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-slate-900/60">
        {open ? <ChevronDown size={14} className="mt-0.5 text-slate-400" /> : <ChevronRight size={14} className="mt-0.5 text-slate-400" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-slate-400">{fmtDates(item.dates)}</span>
            <span className="font-semibold text-slate-100">{item.employee_name}</span>
            <span className="text-slate-300">• {item.rule_code} {item.title}</span>
          </div>
          <div className="text-[11px] text-slate-400 truncate">{item.cause}</div>
        </div>
        <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full border ${sev.cls}`}>{sev.label}</span>
        <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 text-[12px] text-slate-300 border-t border-slate-800">
          <section>
            <h5 className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">O que causou</h5>
            <p>{item.cause}</p>
          </section>

          <section>
            <h5 className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Evidências</h5>
            <ul className="space-y-0.5">
              {(item.evidence || []).map((ev, idx) => (
                <li key={idx}>
                  • {ev.date ? `${fmtDate(ev.date)} — ` : ''}{ev.description}{ev.value ? `: ${ev.value}` : ''}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h5 className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1 flex items-center gap-1">
              <History size={11} /> Histórico da alteração
            </h5>
            {!details ? (
              <Skeleton type="text" rows={2} />
            ) : details.changes.length === 0 ? (
              <p className="text-slate-500">Sem alterações registradas nos dias envolvidos.</p>
            ) : (
              <ul className="space-y-0.5">
                {details.changes.map((ch) => (
                  <li key={ch.id}>
                    • {fmtDateTime(ch.created_at)} — {ch.user || 'sistema'} ({ORIGIN_LABELS[ch.origin] || ch.origin}), dia {fmtDate(ch.work_date)}:{' '}
                    {describeDay(ch.before)} → {describeDay(ch.after)}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h5 className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Base legal</h5>
            <p className="text-slate-400">{item.legal_basis}</p>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <section className="bg-slate-900 border border-slate-800 rounded-lg p-2.5">
              <h5 className="text-[10px] uppercase tracking-wider text-amber-400 font-bold mb-1">Consequência financeira</h5>
              <p>{item.financial_consequence}</p>
              {item.financial_estimate ? <p className="mt-1 font-semibold text-amber-300">Estimativa: {brl(item.financial_estimate)}</p> : null}
            </section>
            <section className="bg-slate-900 border border-rose-900/50 rounded-lg p-2.5">
              <h5 className="text-[10px] uppercase tracking-wider text-rose-400 font-bold mb-1">Consequência administrativa</h5>
              <p>{item.administrative_consequence}</p>
              {item.administrative_footer && <p className="mt-1 text-rose-300/90">{item.administrative_footer}</p>}
            </section>
          </div>

          <section>
            <h5 className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Sugestão de correção</h5>
            <p>{item.suggestion}</p>
          </section>

          <section className="border-t border-slate-800 pt-2 space-y-2">
            {editable ? (
              <>
                <input
                  type="text"
                  value={draft.note ?? item.note ?? ''}
                  onChange={(e) => onDraft({ ...draft, note: e.target.value })}
                  placeholder="Observação do item (opcional)"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white"
                />
                {item.rule_code === 'R01' && (
                  <StyledCheckbox
                    checked={draft.is_force_majeure ?? item.is_force_majeure}
                    onChange={(c) => onDraft({ ...draft, is_force_majeure: c })}
                    label="Força maior ou serviço inadiável (CLT art. 61)"
                    description="Fica registrado; a irregularidade continua listada"
                  />
                )}
              </>
            ) : (
              <p className="text-slate-400">
                {item.approved_at ? `Aprovada em ${fmtDateTime(item.approved_at)}.` : ''}
                {item.note ? ` Observação: "${item.note}".` : ''}
                {item.is_force_majeure ? ' Marcada como força maior/serviço inadiável (art. 61).' : ''}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

// ==============================================================================
// --- [BLOCO: TELA DA AUDITORIA MENSAL] ---
// ==============================================================================

export default function RHAuditoriaMensal({ token, apiBase, selectedYear, selectedMonth, scheduleId, focusFingerprint, onChanged }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('irregularidades');
  const [openIds, setOpenIds] = useState(() => new Set());
  const [drafts, setDrafts] = useState({});
  const [generalNote, setGeneralNote] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState('');

  const headers = { Authorization: `Bearer ${token}` };

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/rh/compliance?year=${selectedYear}&month=${selectedMonth}`, { headers });
      const json = await res.json();
      setData(json);
      setGeneralNote(json.audit?.general_note || '');
    } catch {
      setError('Falha ao carregar a auditoria do mês.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setAcknowledged(false);
    setDrafts({});
    load();
  }, [selectedYear, selectedMonth]);

  // Aviso rápido da grade: abre a ficha da irregularidade indicada
  useEffect(() => {
    if (!focusFingerprint || !data) return;
    const item = data.audit.items.find((i) => i.fingerprint === focusFingerprint);
    if (item) {
      setTab('irregularidades');
      setOpenIds((prev) => new Set(prev).add(item.id));
      setTimeout(() => document.getElementById(`irregularidade-${focusFingerprint}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }
  }, [focusFingerprint, data]);

  const audit = data?.audit;
  const pendingItems = useMemo(() => (audit?.items || []).filter((i) => i.status === 'PENDENTE'), [audit]);

  const toggle = (id) => setOpenIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleApprove = async () => {
    setApproving(true);
    setError('');
    try {
      const res = await fetch(`${apiBase}/api/rh/compliance/audits/${selectedYear}/${selectedMonth}/approve`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acknowledged,
          general_note: generalNote || null,
          items: Object.entries(drafts).map(([id, d]) => ({ id: Number(id), note: d.note ?? null, is_force_majeure: !!d.is_force_majeure }))
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.detail || 'Falha ao aprovar');
      setAcknowledged(false);
      setDrafts({});
      await load(true);
      if (onChanged) onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setApproving(false);
    }
  };

  const handleDecision = async (occ, decision) => {
    const res = await fetch(`${apiBase}/api/rh/schedules/work-days`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schedule_id: scheduleId,
        entries: [{ employee_id: occ.employee_id, day: occ.day, late_decision: occ.decision === decision ? null : decision, is_manual: true }]
      })
    });
    if (res.ok) {
      await load(true);
      if (onChanged) onChanged();
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton type="card" />
        <Skeleton type="list" rows={5} />
      </div>
    );
  }

  if (!audit) {
    return <div className="text-rose-300 text-sm">{error || 'Auditoria indisponível.'}</div>;
  }

  const status = STATUS_LABELS[audit.status] || STATUS_LABELS.PENDENTE;
  const occurrences = data.occurrences || [];
  const pendingOccurrences = occurrences.filter((o) => o.pending && !o.decision).length;

  return (
    <div className="space-y-4 text-xs">
      {/* Cabeçalho */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              {audit.status === 'APROVADA' ? <ShieldCheck size={18} className="text-emerald-400" /> : <ShieldAlert size={18} className="text-amber-400" />}
              Auditoria — {MONTH_NAMES[selectedMonth - 1]}/{selectedYear}
            </h3>
            <p className="text-slate-400 mt-0.5">
              {audit.total} irregularidade(s) ({audit.critical} crítica(s) · {audit.alert} alerta(s)) · {audit.employees} colaborador(es)
              {audit.financial_estimate ? ` · Estimativa financeira: ${brl(audit.financial_estimate)}` : ''}
            </p>
            {audit.approved_at && (
              <p className="text-slate-500 mt-0.5">Aprovada por {audit.approved_by} em {fmtDateTime(audit.approved_at)}.</p>
            )}
          </div>
          <span className={`text-[11px] px-2.5 py-1 rounded-full border font-semibold ${status.cls}`}>{status.label}</span>
        </div>
        <div className="flex items-start gap-2 bg-rose-950/20 border border-rose-900/50 rounded-lg p-2.5 text-rose-200">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            Pagar o valor devido (ex.: domingo em dobro, horas extras) quita apenas a obrigação com o trabalhador.
            A infração administrativa permanece e pode ser autuada pela Auditoria-Fiscal do Trabalho.
          </span>
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-1 border-b border-slate-800">
        {[
          { key: 'irregularidades', label: `Irregularidades (${audit.total})` },
          { key: 'ocorrencias', label: `Ocorrências de ponto${pendingOccurrences ? ` (${pendingOccurrences} pendente${pendingOccurrences > 1 ? 's' : ''})` : ''}` },
          { key: 'informativos', label: `Informativos (${(data.infos || []).length})` }
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 font-semibold border-b-2 ${tab === t.key ? 'border-indigo-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'irregularidades' && (
        <div className="space-y-2">
          {audit.items.length === 0 ? (
            <div className="flex items-center gap-2 text-emerald-300 bg-emerald-950/20 border border-emerald-800/40 rounded-lg p-3">
              <CheckCircle2 size={15} /> Nenhuma irregularidade trabalhista neste mês.
            </div>
          ) : (
            audit.items.map((item) => (
              <IrregularityCard
                key={item.id}
                item={item}
                open={openIds.has(item.id)}
                onToggle={() => toggle(item.id)}
                token={token}
                apiBase={apiBase}
                editable={item.status === 'PENDENTE'}
                draft={drafts[item.id] || {}}
                onDraft={(d) => setDrafts((prev) => ({ ...prev, [item.id]: d }))}
              />
            ))
          )}

          {pendingItems.length > 0 && (
            <div className="bg-slate-900 border border-indigo-500/30 rounded-xl p-4 space-y-3">
              <div className="font-semibold text-indigo-300">Aprovação da auditoria do mês</div>
              <textarea
                value={generalNote}
                onChange={(e) => setGeneralNote(e.target.value)}
                rows={2}
                placeholder="Observação geral (opcional). Ex.: inventário anual e cobertura de férias."
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white"
              />
              <StyledCheckbox
                checked={acknowledged}
                onChange={setAcknowledged}
                label="Li todas as irregularidades acima, com suas bases legais e consequências financeiras e administrativas, e aprovo a escala do mês ciente delas."
              />
              {error && <div className="text-rose-300">{error}</div>}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={!acknowledged || approving}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {approving ? <RefreshCw size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                  Aprovar auditoria do mês ({pendingItems.length} pendente{pendingItems.length > 1 ? 's' : ''})
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'ocorrencias' && (
        <div className="space-y-2">
          <p className="text-slate-400 flex items-center gap-1.5">
            <Clock size={13} /> Atrasos registrados como ponto, fora dos limites de compensação automática. Ocorrências não são irregularidades: servem ao controle do empregador.
            Enquanto não houver decisão, o dia é tratado normalmente (atraso como débito e permanência como hora extra).
          </p>
          {occurrences.length === 0 ? (
            <p className="text-slate-500 italic">Nenhuma ocorrência de ponto no mês.</p>
          ) : (
            <div className="overflow-x-auto border border-slate-800 rounded-lg">
              <table className="w-full text-left">
                <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase tracking-wider">
                  <tr>
                    <th className="px-3 py-2">Data</th>
                    <th className="px-3 py-2">Colaborador</th>
                    <th className="px-3 py-2">Ocorrência</th>
                    <th className="px-3 py-2">Decisão</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {occurrences.map((o) => (
                    <tr key={`${o.employee_id}-${o.day}`}>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(o.date)}</td>
                      <td className="px-3 py-2">{o.employee_name}</td>
                      <td className="px-3 py-2 text-slate-300">
                        Entrada {o.start_time}, saída {o.end_time} (contrato {o.contract_start}–{o.contract_end}) — atraso de {o.late_min} min
                        {o.late_compensated_min ? `, ${o.late_compensated_min} min compensados` : ''}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1 flex-wrap">
                          {LATE_DECISIONS.map((d) => (
                            <button
                              key={d.key}
                              type="button"
                              onClick={() => handleDecision(o, d.key)}
                              className={`px-2 py-1 rounded border text-[10px] font-semibold ${
                                o.decision === d.key ? 'border-orange-400 bg-orange-500/20 text-orange-200' : 'border-slate-700 text-slate-400 hover:text-white'
                              }`}
                            >
                              {d.label}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'informativos' && (
        <div className="space-y-1.5">
          {(data.infos || []).length === 0 ? (
            <p className="text-slate-500 italic">Nenhum informativo no mês.</p>
          ) : (
            data.infos.map((i) => (
              <div key={i.fingerprint} className="flex items-start gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">
                <Info size={13} className="text-sky-400 mt-0.5" />
                <div>
                  <span className="font-semibold text-slate-200">{i.employee_name}</span> — {i.cause}
                  <div className="text-[11px] text-slate-500">{i.suggestion}</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
