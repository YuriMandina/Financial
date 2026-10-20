// Relatório de inventário e perdas para impressão pelo navegador (Ctrl+P / "Salvar como PDF").
// Renderizado fora do #root (portal) para fluir por várias páginas sem cortes.
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { formatDate, formatDateTime, formatMoney, formatQty, STATUS_INFO } from '../estoqueApi';

const SIGNERS = ['Gerente', 'Responsável pela contagem', 'Conferente'];

const unitCost = (item) => (item.cmc > 0 ? item.cmc : item.reference_cost || 0);
const reasonsText = (item, labels) =>
  item.reasons.map((r) => `${formatQty(r.quantity)} ${labels[r.reason] || r.reason}`).join('; ') || '—';
const adjustmentText = (adj) => (adj
  ? `${adj.tipo}/${adj.motivo} ${formatQty(adj.quantity)} a ${formatMoney(adj.unit_value)}${adj.omie_ajuste_id ? ` (#${adj.omie_ajuste_id})` : ''}`
  : '—');

// --- [BLOCO: Elementos da Folha] ---
function Section({ title, children }) {
  return (
    <section className="mt-5">
      <h3 className="text-[11pt] font-bold bg-gray-200 px-2 py-1 mb-2" style={{ breakAfter: 'avoid' }}>{title}</h3>
      {children}
    </section>
  );
}

function InfoBox({ label, value, big }) {
  return (
    <div className="border border-gray-400 px-2 py-1">
      <div className="text-[7pt] text-gray-500">{label}</div>
      <div className={`font-bold ${big ? 'text-[12pt]' : 'text-[9pt]'}`}>{value}</div>
    </div>
  );
}

function DiffTable({ items, labels }) {
  if (!items.length) return <p className="text-[9pt] text-gray-600">Nenhum item.</p>;
  return (
    <table className="w-full text-[8pt] border-collapse">
      <thead>
        <tr className="bg-gray-700 text-white">
          {['Código', 'Produto', 'Un', 'Sistema', 'Contado', 'Diferença', 'Custo unit.', 'Total', 'Motivos', 'Ajuste na Omie'].map((h) => (
            <th key={h} className="px-1.5 py-1 text-left font-semibold">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((i) => (
          <tr key={i.id} className="odd:bg-gray-50">
            <td className="px-1.5 py-1">{i.omie_id}</td>
            <td className="px-1.5 py-1">{i.product_name}</td>
            <td className="px-1.5 py-1">{i.unit || '—'}</td>
            <td className="px-1.5 py-1 text-right">{formatQty(i.system_qty)}</td>
            <td className="px-1.5 py-1 text-right">{formatQty(i.counted_qty)}</td>
            <td className="px-1.5 py-1 text-right font-semibold">{formatQty(i.difference)}</td>
            <td className="px-1.5 py-1 text-right">{formatMoney(unitCost(i))}</td>
            <td className="px-1.5 py-1 text-right font-semibold">{formatMoney(i.difference_value)}</td>
            <td className="px-1.5 py-1">{reasonsText(i, labels)}</td>
            <td className="px-1.5 py-1">{adjustmentText(i.adjustment)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function RelatorioInventario({ api, count, summary, motivos, generatedBy, onClose }) {
  const [company, setCompany] = useState(null);
  const labels = useMemo(() => ({ ...motivos.falta, ...motivos.sobra, SEM_MOTIVO: 'Sem motivo' }), [motivos]);

  useEffect(() => { api.empresa().then(setCompany).catch(() => setCompany({})); }, [api]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // --- [BLOCO: Dados do Relatório] ---
  const byImpact = (a, b) => Math.abs(b.difference_value || 0) - Math.abs(a.difference_value || 0);
  const faltas = count.items.filter((i) => i.difference < 0).sort(byImpact);
  const sobras = count.items.filter((i) => i.difference > 0).sort(byImpact);
  const semDivergencia = count.items.filter((i) => i.system_qty !== null && !i.difference);
  const justificados = count.items.filter((i) => i.justification || i.pair_item_id);
  const byId = Object.fromEntries(count.items.map((i) => [i.id, i]));
  const c = company || {};
  const companyName = c.razao_social || c.nome_fantasia || '';
  const address = [c.endereco, c.cidade, c.uf, c.cep].filter(Boolean).join(', ');

  const sheet = (
    <div className="inv-print-root fixed inset-0 z-[200] bg-black/80 flex flex-col">
      {/* Barra de ações (não sai na impressão) */}
      <div className="inv-print-ui flex items-center justify-between px-5 py-3 bg-slate-900 border-b border-slate-800">
        <div>
          <p className="font-bold text-white">Relatório de inventário e perdas</p>
          <p className="text-xs text-slate-400">Use "Salvar como PDF" na janela de impressão para gerar o arquivo</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white">
            <Printer size={16} /> Imprimir / Salvar PDF
          </button>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-300 hover:bg-slate-800"><X size={18} /></button>
        </div>
      </div>

      <div className="inv-print-scroll flex-1 overflow-y-auto p-6">
        <div className="inv-print-sheet bg-white text-black mx-auto p-8 shadow-xl" style={{ maxWidth: '297mm', fontFamily: 'Arial, Helvetica, sans-serif' }}>
          {/* --- [BLOCO: Cabeçalho] --- */}
          <div className="flex justify-between items-start gap-4">
            <div>
              <p className="text-[13pt] font-bold">{companyName}</p>
              {c.razao_social && c.nome_fantasia && <p className="text-[9pt]">{c.nome_fantasia}</p>}
              <p className="text-[8.5pt]">{[c.cnpj && `CNPJ ${c.cnpj}`, c.inscricao_estadual && `IE ${c.inscricao_estadual}`].filter(Boolean).join(' | ')}</p>
              {address && <p className="text-[8.5pt]">{address}</p>}
            </div>
            <p className="text-[8pt] text-gray-500 text-right">Impresso em {new Date().toLocaleString('pt-BR')}<br />{generatedBy ? `por ${generatedBy}` : ''}</p>
          </div>
          <h2 className="text-[15pt] font-bold mt-3 mb-2">RELATÓRIO DE INVENTÁRIO E PERDAS DE ESTOQUE</h2>

          <div className="grid grid-cols-4 gap-1">
            <InfoBox label="Inventário" value={`#${count.id}`} />
            <InfoBox label="Família" value={count.family_name} />
            <InfoBox label="Data de corte" value={formatDate(count.cutoff_date)} />
            <InfoBox label="Situação" value={STATUS_INFO[count.status]?.label || count.status} />
            <InfoBox label="Criado por" value={`${count.created_by || '—'} em ${formatDateTime(count.created_at)}`} />
            <InfoBox label="Saldo do sistema capturado" value={formatDateTime(count.snapshot_at)} />
            <InfoBox label="Aprovado por" value={count.approved_by ? `${count.approved_by} em ${formatDateTime(count.approved_at)}` : '—'} />
            <InfoBox label="Efetivado na Omie" value={formatDateTime(count.effective_at)} />
          </div>
          {count.notes && <p className="text-[8.5pt] mt-1">Observações: {count.notes}</p>}

          {/* --- [BLOCO: Resumo] --- */}
          <Section title="Resumo">
            <div className="grid grid-cols-6 gap-1">
              <InfoBox label="Itens no escopo" value={count.item_count} big />
              <InfoBox label="Itens contados" value={count.counted_items} big />
              <InfoBox label="Perdas" value={formatMoney(summary?.perdas_value)} big />
              <InfoBox label="Quebra técnica" value={formatMoney(summary?.quebra_tecnica_value)} big />
              <InfoBox label="Sobras" value={formatMoney(summary?.sobras_value)} big />
              <InfoBox label="Resultado líquido" value={formatMoney(summary?.net_value)} big />
            </div>
            <p className="text-[7.5pt] text-gray-600 mt-1">
              Valores a custo (CMC na data de corte; custo da última compra quando o CMC não é aplicável).
              Quebra técnica (desidratação, aparas) é perda normal do processo e está separada das perdas.
            </p>
          </Section>

          <Section title={`Faltas (${faltas.length} itens)`}><DiffTable items={faltas} labels={labels} /></Section>
          <Section title={`Sobras (${sobras.length} itens)`}><DiffTable items={sobras} labels={labels} /></Section>

          {/* --- [BLOCO: Totais por Motivo] --- */}
          <Section title="Totais por motivo">
            {summary && Object.keys(summary.by_reason).length ? (
              <table className="w-full text-[8.5pt] border-collapse">
                <thead><tr className="bg-gray-700 text-white">
                  {['Motivo', 'Itens', 'Quantidade', 'Valor'].map((h) => <th key={h} className="px-1.5 py-1 text-left">{h}</th>)}
                </tr></thead>
                <tbody>
                  {Object.entries(summary.by_reason).sort((a, b) => a[1].value - b[1].value).map(([reason, v]) => (
                    <tr key={reason}>
                      <td className="px-1.5 py-1">{labels[reason] || reason}</td>
                      <td className="px-1.5 py-1 text-right">{v.qty_items}</td>
                      <td className="px-1.5 py-1 text-right">{formatQty(v.quantity)}</td>
                      <td className="px-1.5 py-1 text-right font-semibold">{formatMoney(v.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="text-[9pt] text-gray-600">Sem divergências.</p>}
          </Section>

          {justificados.length > 0 && (
            <Section title="Justificativas e pares (troca de produto)">
              <table className="w-full text-[8.5pt] border-collapse">
                <thead><tr className="bg-gray-700 text-white">
                  {['Produto', 'Par', 'Justificativa'].map((h) => <th key={h} className="px-1.5 py-1 text-left">{h}</th>)}
                </tr></thead>
                <tbody>
                  {justificados.map((i) => (
                    <tr key={i.id}>
                      <td className="px-1.5 py-1">{i.product_name}</td>
                      <td className="px-1.5 py-1">{byId[i.pair_item_id]?.product_name || '—'}</td>
                      <td className="px-1.5 py-1">{i.justification || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          <Section title={`Itens conferidos sem divergência (${semDivergencia.length})`}>
            {semDivergencia.length > 0 && (
              <table className="w-full text-[8pt] border-collapse">
                <thead><tr className="bg-gray-700 text-white">
                  {['Código', 'Produto', 'Un', 'Quantidade'].map((h) => <th key={h} className="px-1.5 py-1 text-left">{h}</th>)}
                </tr></thead>
                <tbody>
                  {semDivergencia.map((i) => (
                    <tr key={i.id}>
                      <td className="px-1.5 py-1">{i.omie_id}</td>
                      <td className="px-1.5 py-1">{i.product_name}</td>
                      <td className="px-1.5 py-1">{i.unit || '—'}</td>
                      <td className="px-1.5 py-1 text-right">{formatQty(i.counted_qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {/* --- [BLOCO: Declaração e Assinaturas] --- */}
          <section className="mt-6" style={{ breakInside: 'avoid' }}>
            <h3 className="text-[11pt] font-bold bg-gray-200 px-2 py-1 mb-2">Declaração e assinaturas</h3>
            <p className="text-[8.5pt]">
              Declaramos que as quantidades acima foram apuradas por contagem física na data de corte indicada e que as
              divergências e seus motivos foram conferidos pela gerência. Este relatório fundamenta os ajustes de estoque
              lançados na Omie e, para as perdas, o estorno do crédito de ICMS (art. 312, IV, RICMS-BA).
            </p>
            <div className="grid grid-cols-3 gap-10 mt-14">
              {SIGNERS.map((role) => (
                <div key={role} className="text-[8.5pt]">
                  <div className="border-t border-black pt-1 text-center font-bold">{role}</div>
                  <p className="mt-3">Nome:</p>
                  <p className="mt-2">CPF:</p>
                  <p className="mt-2">Data: ____/____/______</p>
                </div>
              ))}
            </div>
            <p className="text-[7pt] text-gray-500 mt-6 break-all">
              Hash de integridade da aprovação: {count.snapshot_hash || 'inventário ainda não aprovado'}
            </p>
          </section>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          #root { display: none !important; }
          .inv-print-ui { display: none !important; }
          .inv-print-root, .inv-print-scroll { position: static !important; overflow: visible !important; background: white !important; padding: 0 !important; display: block !important; }
          .inv-print-sheet { max-width: none !important; box-shadow: none !important; padding: 0 !important; margin: 0 !important; }
          .inv-print-sheet table, .inv-print-sheet th, .inv-print-sheet td { border-color: #9ca3af !important; }
          @page { size: A4 landscape; margin: 10mm; }
        }
      `}} />
    </div>
  );

  return createPortal(sheet, document.body);
}
