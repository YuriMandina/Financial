import React from 'react';
import { Printer, X, FileText } from 'lucide-react';
import { PROFILE_SECTIONS, SECTION_BY_KEY, formatDateBR, TERMINATION_REASON_LABELS } from './employeeProfileSchema';

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// --- Blocos da ficha (escopo do módulo para não recriar componentes a cada render) ---
const Cell = ({ label, value, span = 1 }) => (
  <td colSpan={span} className="border border-black px-1.5 pt-0.5 pb-1 align-top">
    <div className="text-[7.5pt] uppercase text-gray-600 leading-tight">{label}</div>
    <div className="text-[9.5pt] font-semibold min-h-[13pt] leading-tight">{value || ' '}</div>
  </td>
);

// Distribui os campos em linhas de 4 colunas respeitando o span
const rowsOf = (cells) => {
  const rows = [];
  let current = [];
  let width = 0;
  cells.forEach((c) => {
    const span = Math.min(c.span || 1, 4);
    if (width + span > 4) {
      rows.push(current);
      current = [];
      width = 0;
    }
    current.push({ ...c, span });
    width += span;
  });
  if (current.length) {
    const rest = 4 - width;
    if (rest > 0) current[current.length - 1] = { ...current[current.length - 1], span: current[current.length - 1].span + rest };
    rows.push(current);
  }
  return rows;
};

const SectionTable = ({ title, cells }) => (
  <div className="mb-2.5 break-inside-avoid">
    <div className="bg-gray-200 border border-black border-b-0 px-1.5 py-0.5 text-[8.5pt] font-bold uppercase">{title}</div>
    <table className="w-full border-collapse table-fixed">
      <tbody>
        {rowsOf(cells).map((row, i) => (
          <tr key={i}>
            {row.map((c) => <Cell key={c.label} label={c.label} value={c.value} span={c.span} />)}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);


/**
 * Ficha Cadastral do Empregado para impressão (pasta física do colaborador).
 * Campos vazios saem em branco com linha, para preenchimento manual.
 */
// Horário contratual da semana agrupando dias iguais (ex.: "Seg, Ter: 07:00 às 16:00 (int. 12:00-13:00)")
const WEEKDAY_SHORT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const describeWorkWeek = (contract) => {
  if (!contract?.days) return '';
  const groups = {};
  Object.entries(contract.days).forEach(([wd, d]) => {
    const key = d.rest
      ? (d.rest === 'DSR' ? 'DSR' : 'Folga')
      : `${d.start} às ${d.end}${d.lunch_start ? ` (int. ${d.lunch_start}-${d.lunch_end})` : ''}`;
    (groups[key] = groups[key] || []).push(WEEKDAY_SHORT[Number(wd)]);
  });
  return Object.entries(groups).map(([key, days]) => `${days.join(', ')}: ${key}`).join(' • ');
};

export default function RHFichaCadastral({ employee, roleName, organizationName, onClose }) {
  React.useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (!employee) return null;
  const profile = employee.profile || {};
  const today = new Date().toLocaleDateString('pt-BR');

  const valueOf = (field, raw) => {
    if (field.type === 'checkbox') return raw ? 'Sim' : 'Não';
    if (field.type === 'date') return formatDateBR(raw);
    return raw || '';
  };

  const sectionCells = (key) => {
    const sec = SECTION_BY_KEY[key];
    const data = profile[key] || {};
    return sec.fields
      .filter((f) => !f.showIf || f.showIf(data))
      .map((f) => ({ label: f.label, value: valueOf(f, data[f.key]), span: f.span }));
  };

  const contrato = profile.contrato || {};
  const contractCells = [
    { label: 'Cargo', value: roleName, span: 2 },
    { label: 'Salário (cargo)', value: brl(employee.base_salary), span: 1 },
    { label: 'Data de Admissão', value: formatDateBR(employee.admission_date), span: 1 },
    ...(employee.termination_date
      ? [{
        label: 'Desligamento',
        value: [formatDateBR(employee.termination_date), TERMINATION_REASON_LABELS[employee.termination_reason]]
          .filter(Boolean).join(' — '),
        span: 2
      }]
      : []),
    { label: 'Matrícula', value: contrato.matricula, span: 1 },
    { label: 'Tipo de Contrato', value: contrato.tipo_contrato, span: 1 },
    { label: 'Fim da Experiência', value: formatDateBR(contrato.experiencia_fim), span: 1 },
    { label: 'Setor', value: contrato.setor, span: 1 },
    { label: 'Jornada Semanal', value: employee.contract?.summary || '', span: 1 },
    { label: 'Horário de Trabalho (CLT art. 74)', value: describeWorkWeek(employee.contract), span: 3 }
  ];

  const deps = profile.dependentes || [];
  const depFields = SECTION_BY_KEY.dependentes.fields;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-4xl w-full p-4 sm:p-6 shadow-2xl text-slate-200 max-h-[94vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3 mb-4 print:hidden">
          <div className="flex items-center gap-2">
            <FileText className="text-indigo-400" size={22} />
            <div>
              <h3 className="font-bold text-white text-base">Ficha Cadastral do Empregado</h3>
              <p className="text-[11px] text-slate-400">{employee.name} • para a pasta do colaborador</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700">
              Fechar
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              <Printer size={15} /> Imprimir / Gerar PDF
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800" title="Fechar (Esc)">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 bg-slate-950/40 p-3 rounded-lg border border-slate-800/80">
          <div className="ficha-print-container bg-white text-black mx-auto p-6 shadow-lg" style={{ maxWidth: '210mm', fontFamily: 'Arial, Helvetica, sans-serif' }}>
            {/* Cabeçalho */}
            <div className="flex items-stretch gap-3 mb-3">
              <div className="flex-1 border border-black p-2">
                <div className="text-[13pt] font-bold uppercase">Ficha Cadastral do Empregado</div>
                <div className="text-[9pt]">Empregador: <strong>{organizationName || '________________________'}</strong></div>
                <div className="text-[9pt] mt-1">
                  Empregado: <strong className="uppercase">{employee.name}</strong>
                  {profile.pessoal?.nome_social && <> • Nome social: <strong>{profile.pessoal.nome_social}</strong></>}
                </div>
                <div className="text-[8pt] text-gray-600 mt-1">Emitida em {today}</div>
              </div>
              <div className="border border-black flex items-center justify-center text-[8pt] text-gray-500 text-center" style={{ width: '30mm', height: '40mm' }}>
                FOTO<br />3x4
              </div>
            </div>

            <SectionTable title="Contrato de Trabalho" cells={contractCells} />
            {['pessoal', 'documentos', 'contato', 'bancarios'].map((key) => (
              <SectionTable key={key} title={SECTION_BY_KEY[key].label} cells={sectionCells(key)} />
            ))}

            {/* Dependentes */}
            <div className="mb-2.5 break-inside-avoid">
              <div className="bg-gray-200 border border-black border-b-0 px-1.5 py-0.5 text-[8.5pt] font-bold uppercase">Dependentes</div>
              <table className="w-full border-collapse text-[8.5pt]">
                <thead>
                  <tr>
                    {depFields.map((f) => (
                      <th key={f.key} className="border border-black px-1.5 py-0.5 text-left text-[7.5pt] uppercase font-normal text-gray-600">{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(deps.length ? deps : [{}, {}, {}]).map((d, i) => (
                    <tr key={i}>
                      {depFields.map((f) => (
                        <td key={f.key} className="border border-black px-1.5 py-0.5 font-semibold h-[15pt]">
                          {deps.length ? valueOf(f, d[f.key]) : ' '}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {['saude', 'uniforme'].map((key) => (
              <SectionTable key={key} title={SECTION_BY_KEY[key].label} cells={sectionCells(key)} />
            ))}

            {contrato.observacoes && (
              <SectionTable title="Observações" cells={[{ label: 'Observações internas', value: contrato.observacoes, span: 4 }]} />
            )}

            {/* Declaração e assinaturas */}
            <div className="mt-4 text-[8.5pt] leading-snug break-inside-avoid">
              <p>
                Declaro que as informações acima são verdadeiras e me comprometo a comunicar ao empregador qualquer alteração
                nos meus dados cadastrais, documentos, endereço e dependentes.
              </p>
              <p className="mt-3">Local e data: ______________________________, ____/____/________</p>
              <div className="grid grid-cols-2 gap-10 mt-10">
                <div className="border-t border-black pt-1 text-center">Assinatura do Empregado</div>
                <div className="border-t border-black pt-1 text-center">Assinatura do Empregador</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body * { visibility: hidden; }
          .ficha-print-container, .ficha-print-container * { visibility: visible; }
          .ficha-print-container {
            position: absolute; left: 0; top: 0; width: 100%; max-width: none !important;
            box-shadow: none !important; padding: 10mm 12mm !important; margin: 0 !important;
          }
          @page { size: A4; margin: 0; }
        }
      `}} />
    </div>
  );
}

export { PROFILE_SECTIONS };
