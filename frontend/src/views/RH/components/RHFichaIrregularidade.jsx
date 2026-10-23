import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, History } from 'lucide-react';
import Skeleton from '../../../components/common/Skeleton';
import StyledCheckbox from '../../../components/common/StyledCheckbox';
import { NO_DAY_HISTORY_RULES, ORIGIN_LABELS, SEVERITY, STATUS_LABELS, brl, describeDay, fmtDate, fmtDateTime, fmtDates } from './complianceFormat';

// ==============================================================================
// --- [BLOCO: FICHA DA IRREGULARIDADE] ---
// ==============================================================================

export default function RHFichaIrregularidade({ item, open, onToggle, token, apiBase, draft = {}, onDraft, editable = false }) {
  const [details, setDetails] = useState(item.changes ? { changes: item.changes } : null);

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
            {item.reincidence_count > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-rose-500/40 text-rose-300">reincidência</span>
            )}
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
            {NO_DAY_HISTORY_RULES.includes(item.rule_code) ? (
              <p className="text-slate-500">Irregularidade de semana, contrato ou banco de horas: sem alteração de dia associada.</p>
            ) : !details ? (
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
              {item.reincidence_count > 0 && (
                <p className="mt-1 font-semibold text-rose-300">
                  Reincidência: {item.reincidence_count + 1}ª ocorrência desta regra com o colaborador nos últimos 12 meses.
                </p>
              )}
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
