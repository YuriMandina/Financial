import React, { useState, useEffect } from 'react';
import {
  Mail, Copy, Check, FileDown, Send, RefreshCw, AlertCircle, Lock, CheckCircle2, History,
  ChevronDown, ChevronRight, Settings2, X, FileSpreadsheet
} from 'lucide-react';

// Informe mensal à contabilidade (planejamento docs/conformidade-clt, v08 seção 20):
// texto do e-mail do dia 01 gerado da folha fechada, marcação de envio e retificação.

const STATUS_STYLE = {
  FOLHA_ABERTA: { cls: 'border-amber-500/40 bg-amber-950/20 text-amber-200', Icon: Lock },
  PRONTO: { cls: 'border-indigo-500/40 bg-indigo-950/30 text-indigo-200', Icon: Send },
  ENVIADO: { cls: 'border-emerald-500/40 bg-emerald-950/20 text-emerald-200', Icon: CheckCircle2 },
  DESATUALIZADO: { cls: 'border-rose-500/40 bg-rose-950/20 text-rose-200', Icon: AlertCircle }
};

const CHANGE_STYLE = {
  INCLUIDO: { label: 'Incluir', cls: 'text-emerald-300' },
  REMOVIDO: { label: 'Desconsiderar', cls: 'text-rose-300 line-through decoration-rose-400/60' },
  ALTERADO: { label: 'Alterar', cls: 'text-amber-200' }
};

const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

export default function RHInformeContabilidade({ token, apiBase, selectedYear, selectedMonth }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showFull, setShowFull] = useState(false); // com retificação pendente: alterna para o texto completo
  const [copied, setCopied] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState('');
  const [openVersion, setOpenVersion] = useState(null);
  const [emailModal, setEmailModal] = useState(null); // { settings, accounting_email, accounting_greeting, accounting_signature }

  const authHeaders = { Authorization: `Bearer ${token}` };

  const request = async (path, options = {}) => {
    const res = await fetch(`${apiBase}${path}`, {
      ...options, headers: { 'Content-Type': 'application/json', ...authHeaders }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `Erro ${res.status}`);
    return data;
  };

  const load = async () => {
    setError('');
    try {
      setReport(await request(`/api/rh/payroll/accounting-report?year=${selectedYear}&month=${selectedMonth}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setShowFull(false);
    setOpenVersion(null);
    load();
  }, [selectedYear, selectedMonth]);

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    } catch {
      alert('Não foi possível copiar. Selecione o texto e copie manualmente.');
    }
  };

  const handleExport = async (format, version = null) => {
    const key = `${format}-${version || 'atual'}`;
    setExporting(key);
    try {
      const qs = `year=${selectedYear}&month=${selectedMonth}&format=${format}${version ? `&version=${version}` : ''}`;
      const res = await fetch(`${apiBase}/api/rh/payroll/accounting-report/export?${qs}`, { headers: authHeaders });
      if (!res.ok) throw new Error('Falha ao exportar o informe');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `informe_contabilidade_${selectedYear}-${String(selectedMonth).padStart(2, '0')}${version ? `_v${version}` : ''}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message);
    } finally {
      setExporting('');
    }
  };

  const handleMarkSent = async () => {
    const rectification = report.versions.length > 0;
    if (!window.confirm(rectification
      ? 'Marcar a retificação como enviada à contabilidade? O conteúdo atual passa a ser a referência para as próximas diferenças.'
      : 'Marcar o informe como enviado à contabilidade? Uma cópia do conteúdo fica guardada no histórico.')) return;
    setSaving(true);
    try {
      setReport(await request('/api/rh/payroll/accounting-report/sent', {
        method: 'POST',
        body: JSON.stringify({ year: selectedYear, month: selectedMonth })
      }));
      setShowFull(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Dados do e-mail: salvos nas configurações de RH (envia as configurações completas com os três campos)
  const openEmailSettings = async () => {
    try {
      const settings = await request('/api/rh/settings');
      setEmailModal({
        settings,
        accounting_email: settings.accounting_email || '',
        accounting_greeting: settings.accounting_greeting || '',
        accounting_signature: settings.accounting_signature || ''
      });
    } catch (err) {
      alert('Falha ao carregar as configurações: ' + err.message);
    }
  };

  const saveEmailSettings = async (e) => {
    e.preventDefault();
    const { settings, ...fields } = emailModal;
    try {
      await request('/api/rh/settings', { method: 'POST', body: JSON.stringify({ ...settings, ...fields }) });
      setEmailModal(null);
      await load();
    } catch (err) {
      alert('Falha ao salvar: ' + err.message);
    }
  };

  if (loading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-xs text-slate-400">
        <RefreshCw size={18} className="animate-spin mx-auto mb-2" />
        Montando o informe...
      </div>
    );
  }
  if (error || !report) {
    return (
      <div className="bg-rose-950/20 border border-rose-500/40 rounded-xl p-4 text-xs text-rose-200 flex items-center gap-2">
        <AlertCircle size={14} /> {error || 'Informe indisponível.'}
      </div>
    );
  }

  const { status, versions, changes } = report;
  const lastSent = versions[0];
  const rectifying = Boolean(report.rectification_text) && !showFull;
  const displayedText = rectifying ? report.rectification_text : report.text;
  const employees = report.content.employees;
  const withVariables = employees.length - report.without_variables;
  const style = STATUS_STYLE[status];

  const statusMessage = {
    FOLHA_ABERTA: 'Folha aberta: a prévia abaixo é um rascunho. Feche a folha na aba "Folha do Mês" para enviar o informe.',
    PRONTO: 'Folha fechada e informe pronto. Copie o texto para o e-mail (ou anexe o PDF) e marque como enviado.',
    ENVIADO: `Enviado em ${fmtDateTime(lastSent?.sent_at)}${lastSent?.sent_by ? ` por ${lastSent.sent_by}` : ''}${lastSent?.version > 1 ? ` (retificação ${lastSent.version - 1})` : ''}. O conteúdo atual é igual ao enviado.`,
    DESATUALIZADO: report.payroll_closed
      ? `A folha mudou desde o envio de ${fmtDateTime(lastSent?.sent_at)}. Envie a retificação abaixo, só com as diferenças.`
      : `A folha mudou desde o envio de ${fmtDateTime(lastSent?.sent_at)}. Feche a folha para enviar a retificação.`
  }[status];

  const btn = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border disabled:opacity-50';
  const btnGhost = `${btn} bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700`;
  const inputCls = 'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500';

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border px-4 py-2.5 text-xs flex items-center gap-2 ${style.cls}`}>
        <style.Icon size={14} className="shrink-0" />
        <span className="font-semibold">{report.status_label}:</span>
        <span>{statusMessage}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Texto do e-mail */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-800">
            <div>
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <Mail size={15} className="text-indigo-400" />
                {rectifying ? 'Retificação' : 'Texto do e-mail'}
              </h4>
              <p className="text-[11px] text-slate-400">
                {rectifying
                  ? 'Somente o que mudou desde a última versão enviada.'
                  : 'HE e faltas em quantidade; prêmio e descontos em valor; eventos do mês.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {report.rectification_text && (
                <button onClick={() => setShowFull(!showFull)} className={btnGhost}>
                  {showFull ? 'Ver retificação' : 'Ver texto completo'}
                </button>
              )}
              <button onClick={() => copy(displayedText, 'texto')} className={btnGhost}>
                {copied === 'texto' ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                {copied === 'texto' ? 'Copiado' : 'Copiar texto'}
              </button>
              <button onClick={() => handleExport('pdf')} disabled={!!exporting} className={btnGhost}>
                <FileDown size={13} /> PDF
              </button>
              <button onClick={() => handleExport('csv')} disabled={!!exporting} className={btnGhost}>
                <FileSpreadsheet size={13} /> CSV
              </button>
              <button
                onClick={handleMarkSent}
                disabled={!report.can_send || saving}
                title={!report.payroll_closed ? 'Feche a folha do mês para enviar' : !report.can_send ? 'Nada mudou desde o último envio' : undefined}
                className={`${btn} bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500`}
              >
                <Send size={13} /> {versions.length > 0 ? 'Marcar retificação como enviada' : 'Marcar como enviado'}
              </button>
            </div>
          </div>
          <pre className={`p-4 text-xs leading-relaxed whitespace-pre-wrap break-words font-mono max-h-[560px] overflow-y-auto ${
            status === 'FOLHA_ABERTA' ? 'text-slate-400' : 'text-slate-200'
          }`}>
            {displayedText}
          </pre>
        </div>

        <div className="space-y-4">
          {/* Destinatário e resumo */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] text-slate-400">E-mail da contabilidade</div>
                {report.accounting_email ? (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="font-semibold text-white truncate">{report.accounting_email}</span>
                    <button
                      onClick={() => copy(report.accounting_email, 'email')}
                      className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800"
                      title="Copiar e-mail"
                    >
                      {copied === 'email' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    </button>
                  </div>
                ) : (
                  <div className="text-slate-500 mt-0.5">Não informado</div>
                )}
              </div>
              <button onClick={openEmailSettings} className={btnGhost} title="E-mail, saudação e assinatura">
                <Settings2 size={13} /> Configurar
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-800 text-center">
              <div>
                <div className="text-lg font-bold text-white">{employees.length}</div>
                <div className="text-[10px] text-slate-400">colaboradores</div>
              </div>
              <div>
                <div className="text-lg font-bold text-indigo-300">{withVariables}</div>
                <div className="text-[10px] text-slate-400">com variáveis</div>
              </div>
              <div>
                <div className="text-lg font-bold text-slate-400">{report.without_variables}</div>
                <div className="text-[10px] text-slate-400">sem variáveis</div>
              </div>
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              O que entra no informe é definido em cada rubrica (aba Rubricas → "Informar à contabilidade").
              Adiantamento, salário, DSR e encargos ficam de fora: a contabilidade calcula ou já tem.
            </p>
          </div>

          {/* Diferenças desde o último envio */}
          {changes.length > 0 && (
            <div className="bg-slate-900 border border-rose-500/30 rounded-xl p-4 text-xs space-y-2.5">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <AlertCircle size={15} className="text-rose-400" /> Diferenças desde o envio
              </h4>
              {changes.map((emp) => (
                <div key={emp.employee_id}>
                  <div className="font-semibold text-white">{emp.name}</div>
                  <ul className="mt-0.5 space-y-0.5">
                    {emp.changes.map((c) => (
                      <li key={c.key} className="text-[11px]">
                        <span className="text-slate-500">{CHANGE_STYLE[c.change].label}: </span>
                        {c.label && <span className="text-slate-300">{c.label} — </span>}
                        {c.change === 'ALTERADO' ? (
                          <>
                            <span className="text-slate-500 line-through">{c.before}</span>
                            <span className="text-slate-500"> → </span>
                            <span className={CHANGE_STYLE.ALTERADO.cls}>{c.after}</span>
                          </>
                        ) : (
                          <span className={CHANGE_STYLE[c.change].cls}>{c.after || c.before}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* Histórico de versões enviadas */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs">
            <h4 className="text-sm font-bold text-white flex items-center gap-2 mb-2">
              <History size={15} className="text-slate-400" /> Versões enviadas
            </h4>
            {versions.length === 0 ? (
              <p className="text-slate-500">Nenhuma versão enviada neste mês.</p>
            ) : (
              <ul className="divide-y divide-slate-800">
                {versions.map((v) => {
                  const open = openVersion === v.version;
                  return (
                    <li key={v.version} className="py-2">
                      <button
                        onClick={() => setOpenVersion(open ? null : v.version)}
                        className="w-full flex items-center gap-1.5 text-left"
                      >
                        {open ? <ChevronDown size={13} className="text-slate-500" /> : <ChevronRight size={13} className="text-slate-500" />}
                        <span className="font-semibold text-white">
                          {v.kind === 'ORIGINAL' ? 'Original' : `Retificação ${v.version - 1}`}
                        </span>
                        <span className="text-slate-400">• {fmtDateTime(v.sent_at)}{v.sent_by ? ` • ${v.sent_by}` : ''}</span>
                      </button>
                      {open && (
                        <div className="mt-2 space-y-2">
                          <pre className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-[11px] text-slate-300 whitespace-pre-wrap break-words font-mono max-h-64 overflow-y-auto">
                            {v.text}
                          </pre>
                          <div className="flex gap-2">
                            <button onClick={() => copy(v.text, `v${v.version}`)} className={btnGhost}>
                              {copied === `v${v.version}` ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />} Copiar
                            </button>
                            <button onClick={() => handleExport('pdf', v.version)} disabled={!!exporting} className={btnGhost}>
                              <FileDown size={13} /> PDF desta versão
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {emailModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form onSubmit={saveEmailSettings} className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-5 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="font-bold text-white text-sm">Dados do e-mail à contabilidade</h4>
              <button type="button" onClick={() => setEmailModal(null)} className="text-slate-400 hover:text-white p-1">
                <X size={16} />
              </button>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">E-mail da contabilidade</label>
              <input
                type="email"
                value={emailModal.accounting_email}
                onChange={(e) => setEmailModal({ ...emailModal, accounting_email: e.target.value })}
                className={inputCls}
                placeholder="folha@contabilidade.com.br"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Saudação</label>
              <input
                value={emailModal.accounting_greeting}
                onChange={(e) => setEmailModal({ ...emailModal, accounting_greeting: e.target.value })}
                className={inputCls}
                placeholder="Bom dia,"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Assinatura</label>
              <textarea
                rows={3}
                value={emailModal.accounting_signature}
                onChange={(e) => setEmailModal({ ...emailModal, accounting_signature: e.target.value })}
                className={inputCls}
                placeholder={'Atenciosamente,\nNome — Administrativo'}
              />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button type="button" onClick={() => setEmailModal(null)} className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-800">
                Cancelar
              </button>
              <button type="submit" className="px-4 py-1.5 rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-500 text-white">
                Salvar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
