import React from 'react';
import { Plus, Trash2, Lock, AlertCircle } from 'lucide-react';
import SelectDropdown from '../../../components/common/SelectDropdown';
import StyledCheckbox from '../../../components/common/StyledCheckbox';
import { SECTION_BY_KEY, MASKS, isValidCpf } from './employeeProfileSchema';

const SPAN = { 1: 'col-span-1', 2: 'col-span-2', 3: 'col-span-3', 4: 'col-span-4' };
const inputCls = 'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500';

/**
 * Campos de uma seção da ficha cadastral (ou lista de dependentes).
 * Props: sectionKey, profile, onChange(novoProfile)
 */
export default function RHEmployeeProfileForm({ sectionKey, profile = {}, onChange }) {
  const section = SECTION_BY_KEY[sectionKey];
  if (!section) return null;

  const values = section.list ? (profile[sectionKey] || []) : (profile[sectionKey] || {});

  const setField = (key, value) => {
    onChange({ ...profile, [sectionKey]: { ...values, [key]: value } });
  };

  // Busca o endereço pelo CEP (ViaCEP) e preenche os campos vazios
  const lookupCep = async (cep) => {
    const clean = String(cep || '').replace(/\D/g, '');
    if (clean.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
      const data = await res.json();
      if (data.erro) return;
      onChange({
        ...profile,
        contato: {
          ...values,
          cep: MASKS.cep(clean),
          logradouro: values.logradouro || data.logradouro || '',
          bairro: values.bairro || data.bairro || '',
          cidade: values.cidade || data.localidade || '',
          uf: values.uf || data.uf || ''
        }
      });
    } catch {
      /* sem conexão: preenchimento manual */
    }
  };

  const renderField = (field, value, onValue, keyPrefix = '') => {
    const id = `${keyPrefix}${sectionKey}-${field.key}`;
    const label = (
      <label htmlFor={id} className="block text-slate-400 mb-1 flex items-center gap-1">
        {field.label}
        {field.sensitive && <Lock size={10} className="text-slate-500" title="Dado pessoal sensível (LGPD)" />}
      </label>
    );

    if (field.type === 'checkbox') {
      return (
        <div key={field.key} className={`${SPAN[field.span || 1]} flex items-end pb-2`}>
          <StyledCheckbox checked={!!value} onChange={(c) => onValue(c)} label={field.label} />
        </div>
      );
    }

    let control;
    if (field.type === 'select') {
      control = (
        <SelectDropdown
          value={value || ''}
          onChange={(val) => onValue(val)}
          placeholder="Selecione"
          options={[{ value: '', label: '—' }, ...field.options]}
        />
      );
    } else if (field.type === 'textarea') {
      control = (
        <textarea id={id} rows={2} value={value || ''} onChange={(e) => onValue(e.target.value)} className={`${inputCls} resize-y`} />
      );
    } else {
      const invalidCpf = field.mask === 'cpf' && value && String(value).replace(/\D/g, '').length === 11 && !isValidCpf(value);
      control = (
        <>
          <input
            id={id}
            type={field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : 'text'}
            value={value || ''}
            onChange={(e) => onValue(field.mask ? MASKS[field.mask](e.target.value) : e.target.value)}
            onBlur={sectionKey === 'contato' && field.key === 'cep' ? (e) => lookupCep(e.target.value) : undefined}
            className={`${inputCls} ${field.type === 'date' ? '[color-scheme:dark]' : ''} ${invalidCpf ? 'border-rose-500' : ''}`}
          />
          {invalidCpf && <span className="text-[10px] text-rose-400">CPF inválido</span>}
        </>
      );
    }

    return (
      <div key={field.key} className={SPAN[field.span || 1]}>
        {label}
        {control}
      </div>
    );
  };

  // --- Lista de dependentes ----------------------------------------------------------
  if (section.list) {
    const items = values;
    const setItem = (idx, key, value) => {
      const next = items.map((it, i) => (i === idx ? { ...it, [key]: value } : it));
      onChange({ ...profile, [sectionKey]: next });
    };
    const removeItem = (idx) => onChange({ ...profile, [sectionKey]: items.filter((_, i) => i !== idx) });
    const addItem = () => onChange({ ...profile, [sectionKey]: [...items, { nome: '', irrf: true, salario_familia: false }] });
    const irrfCount = items.filter((d) => d.irrf && (d.nome || '').trim()).length;

    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-[11px] text-slate-400">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          A quantidade de dependentes para o IRRF da folha é calculada a partir desta lista ({irrfCount} marcado(s) como IRRF).
        </div>
        {items.length === 0 && <p className="text-slate-500 text-xs">Nenhum dependente cadastrado.</p>}
        {items.map((item, idx) => (
          <div key={idx} className="bg-slate-950 border border-slate-800 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-slate-300">Dependente {idx + 1}</span>
              <button type="button" onClick={() => removeItem(idx)} className="p-1 text-slate-500 hover:text-rose-400" title="Remover dependente">
                <Trash2 size={13} />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {section.fields.map((f) => renderField(f, item[f.key], (v) => setItem(idx, f.key, v), `dep${idx}-`))}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addItem}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-indigo-300 bg-slate-800 hover:bg-slate-700 border border-slate-700"
        >
          <Plus size={13} /> Adicionar dependente
        </button>
      </div>
    );
  }

  // --- Seção de campos ---------------------------------------------------------------
  return (
    <div className="grid grid-cols-4 gap-3">
      {section.fields
        .filter((f) => !f.showIf || f.showIf(values))
        .map((f) => renderField(f, values[f.key], (v) => setField(f.key, v)))}
    </div>
  );
}
