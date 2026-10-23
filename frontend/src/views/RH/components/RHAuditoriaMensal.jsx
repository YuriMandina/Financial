import React, { useEffect, useMemo, useState } from 'react';
import { ShieldAlert, ShieldCheck, AlertTriangle, Info, Clock, CheckCircle2, RefreshCw } from 'lucide-react';
import Skeleton from '../../../components/common/Skeleton';
import StyledCheckbox from '../../../components/common/StyledCheckbox';
import RHFichaIrregularidade from './RHFichaIrregularidade';
import { MONTH_NAMES, STATUS_LABELS, brl, fmtDate, fmtDateTime } from './complianceFormat';
import RHRelatorioIrregularidades from './RHRelatorioIrregularidades';

// ==============================================================================
// --- [BLOCO: CONSTANTES] ---
// ==============================================================================

const LATE_DECISIONS = [
  { key: 'ACEITAR_COMPENSACAO', label: 'Aceitar compensação' },
  { key: 'ABONAR', label: 'Abonar' },
  { key: 'NORMAL', label: 'Tratar normalmente' }
];

// ==============================================================================
// --- [BLOCO: TELA DA AUDITORIA MENSAL] ---
// ==============================================================================

export default function RHAuditoriaMensal({ token, apiBase, selectedYear, selectedMonth, scheduleId, focusFingerprint, onChanged, employees = [] }) {
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
          { key: 'informativos', label: `Informativos (${(data.infos || []).length})` },
          { key: 'relatorio', label: 'Relatório do período' }
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
              <RHFichaIrregularidade
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

      {tab === 'relatorio' && (
        <RHRelatorioIrregularidades
          token={token}
          apiBase={apiBase}
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          employees={employees}
        />
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
