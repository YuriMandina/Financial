import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import SelectDropdown from '../../../components/common/SelectDropdown';
import DatePicker from '../../../components/common/DatePicker';
import StyledCheckbox from '../../../components/common/StyledCheckbox';
import Skeleton from '../../../components/common/Skeleton';
import { Alert, Button, Modal, inputClass } from './ui';

// Checklist pré-balanço: evita sobras/faltas falsas por movimentos não lançados até o corte
const CHECKLIST = [
  'Todas as NF de entrada até a data de corte foram lançadas na Omie',
  'As vendas do PDV até a data de corte estão sincronizadas na Omie',
  'Não haverá movimentação dos produtos durante a contagem (loja fechada ou setor isolado)',
];

const today = () => new Date().toISOString().slice(0, 10);

export default function NovoInventarioModal({ api, onClose, onCreated, onOpenCadastro }) {
  // --- [BLOCO: Estado do Assistente] ---
  const [familias, setFamilias] = useState(null);
  const [familyId, setFamilyId] = useState(null);
  const [produtos, setProdutos] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [filter, setFilter] = useState('');
  const [cutoff, setCutoff] = useState(today());
  const [notes, setNotes] = useState('');
  const [checks, setChecks] = useState(CHECKLIST.map(() => false));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.familias().then((d) => setFamilias(d.familias.filter((f) => f.is_active_for_inventory))).catch((e) => setError(e.message));
  }, [api]);

  useEffect(() => {
    if (!familyId) return;
    setProdutos(null);
    api.produtos(familyId).then((d) => {
      setProdutos(d.produtos);
      setSelected(new Set(d.produtos.filter((p) => p.is_inventory_default).map((p) => p.id)));
    }).catch((e) => setError(e.message));
  }, [api, familyId]);

  const visible = useMemo(() => (produtos || []).filter((p) =>
    p.name.toLowerCase().includes(filter.toLowerCase()) || (p.ean || '').includes(filter)), [produtos, filter]);

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // --- [BLOCO: Criação] ---
  const canCreate = familyId && selected.size > 0 && cutoff && checks.every(Boolean);
  // startCounting: já libera para o app de contagem (o rascunho não aparece nos celulares)
  const create = async (startCounting) => {
    setSaving(startCounting ? 'start' : 'draft');
    setError(null);
    try {
      const count = await api.criarInventario({
        family_id: familyId, cutoff_date: cutoff, product_ids: [...selected], notes: notes.trim() || null,
      });
      // Se o início falhar, abre o rascunho criado (lá o botão "Iniciar contagem" continua disponível)
      if (startCounting) await api.transicao(count.id, 'iniciar').catch(() => null);
      onCreated(count);
    } catch (e) {
      setError(e.details ? `${e.message} ${[].concat(e.details).join(' ')}` : e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Novo inventário" subtitle="Balanço de uma família em uma data de corte" onClose={onClose} width="max-w-3xl"
      footer={(
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button loading={saving === 'draft'} disabled={!canCreate || Boolean(saving)} onClick={() => create(false)}>Salvar como rascunho</Button>
          <Button tone="primary" icon={ClipboardList} loading={saving === 'start'} disabled={!canCreate || Boolean(saving)} onClick={() => create(true)}>
            Criar e iniciar contagem
          </Button>
        </>
      )}>
      <div className="space-y-5">
        {error && <Alert onClose={() => setError(null)}>{error}</Alert>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-slate-300 mb-1.5">1. Família</p>
            {familias === null ? <Skeleton className="h-10 rounded-lg" /> : familias.length ? (
              <SelectDropdown value={familyId} onChange={setFamilyId} searchable placeholder="Selecione a família"
                options={familias.map((f) => ({ value: f.id, label: f.name, subtitle: `${f.product_count} produtos` }))} />
            ) : (
              <Alert tone="warn">
                Nenhuma família habilitada para inventário.{' '}
                <button className="underline" onClick={onOpenCadastro}>Habilitar no Cadastro</button>
              </Alert>
            )}
          </div>
          <div>
            <p className="text-sm text-slate-300 mb-1.5">3. Data de corte</p>
            <DatePicker value={cutoff} onChange={setCutoff} max={today()} align="left" />
          </div>
        </div>

        {familyId && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-sm text-slate-300">2. Produtos ({selected.size} selecionados)</p>
              <div className="flex gap-3 text-xs">
                <button className="text-indigo-300 hover:underline" onClick={() => setSelected(new Set((produtos || []).map((p) => p.id)))}>Todos</button>
                <button className="text-slate-400 hover:underline" onClick={() => setSelected(new Set())}>Nenhum</button>
              </div>
            </div>
            <input className={`${inputClass} mb-2`} placeholder="Filtrar por nome ou EAN" value={filter} onChange={(e) => setFilter(e.target.value)} />
            {produtos === null ? <Skeleton type="list" rows={4} /> : (
              <div className="max-h-64 overflow-y-auto border border-slate-800 rounded-xl divide-y divide-slate-800/60">
                {visible.map((p) => (
                  <div key={p.id} className="px-3 py-2 hover:bg-slate-800/40">
                    <StyledCheckbox checked={selected.has(p.id)} onChange={() => toggle(p.id)} size="sm"
                      label={p.name} description={[p.ean, p.unit].filter(Boolean).join(' · ') || 'Sem EAN'} />
                  </div>
                ))}
                {!visible.length && <p className="text-sm text-slate-500 p-4 text-center">Nenhum produto.</p>}
              </div>
            )}
          </div>
        )}

        <div>
          <p className="text-sm text-slate-300 mb-1.5">Observações</p>
          <textarea className={`${inputClass} h-16 resize-none`} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex: balanço mensal, setor câmara fria" />
        </div>

        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-slate-200 mb-1">4. Checklist pré-balanço</p>
          {CHECKLIST.map((text, i) => (
            <StyledCheckbox key={text} checked={checks[i]} label={text} size="sm"
              onChange={() => setChecks((prev) => prev.map((v, j) => (j === i ? !v : v)))} />
          ))}
        </div>
      </div>
    </Modal>
  );
}
