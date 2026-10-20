import React, { useEffect, useState } from 'react';
import { Package, Plus, Trash2, Users } from 'lucide-react';
import Skeleton from '../../../components/common/Skeleton';
import StyledCheckbox from '../../../components/common/StyledCheckbox';
import SelectDropdown from '../../../components/common/SelectDropdown';
import { Alert, Button, Modal, inputClass } from './ui';
import { formatQty } from '../estoqueApi';

const ROLE_OPTIONS = [
  { value: 'GERENTE', label: 'Gerência', subtitle: 'Acesso completo ao inventário' },
  { value: 'CONTADOR', label: 'Contador', subtitle: 'Apenas contagem no app (sem saldos)' },
];
const EMPTY_PACK = { name: 'CX', factor: '', ean: '', tare_kg: '' };
const num = (v) => Number(String(v || '0').replace(',', '.')) || 0;

// --- [BLOCO: Embalagens do Produto] ---
function EmbalagensModal({ api, product, onClose, onChanged }) {
  const [packs, setPacks] = useState(product.packagings);
  const [form, setForm] = useState(EMPTY_PACK);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const add = async () => {
    setSaving(true);
    setError(null);
    try {
      const pack = await api.criarEmbalagem(product.id, {
        name: form.name.trim(), factor: num(form.factor), ean: form.ean.trim() || null, tare_kg: num(form.tare_kg),
      });
      setPacks((prev) => [...prev, pack]);
      setForm(EMPTY_PACK);
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    try {
      await api.removerEmbalagem(id);
      setPacks((prev) => prev.filter((p) => p.id !== id));
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <Modal title={`Embalagens · ${product.name}`} subtitle="Fator = unidades do produto por embalagem; DUN = código da caixa; tara para pesagem"
      onClose={onClose} footer={<Button onClick={onClose}>Fechar</Button>}>
      <div className="space-y-4">
        {error && <Alert onClose={() => setError(null)}>{error}</Alert>}
        <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl">
          {packs.map((p) => (
            <div key={p.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
              <Package size={16} className="text-slate-400" />
              <span className="font-semibold text-white w-20">{p.name}</span>
              <span className="text-slate-300 flex-1">× {formatQty(p.factor)} {product.unit || ''} · tara {formatQty(p.tare_kg)} kg {p.ean ? `· ${p.ean}` : ''}</span>
              <button onClick={() => remove(p.id)} className="text-slate-500 hover:text-rose-300"><Trash2 size={16} /></button>
            </div>
          ))}
          {!packs.length && <p className="p-4 text-sm text-slate-500">Nenhuma embalagem cadastrada.</p>}
        </div>
        <div className="grid grid-cols-12 gap-2 items-end">
          {[
            ['name', 'Nome', 'col-span-2', 'CX'],
            ['factor', 'Fator', 'col-span-2', '12'],
            ['ean', 'DUN / EAN da embalagem', 'col-span-4', 'Opcional'],
            ['tare_kg', 'Tara (kg)', 'col-span-2', '0'],
          ].map(([key, label, span, ph]) => (
            <label key={key} className={`${span} text-xs text-slate-400`}>{label}
              <input className={`${inputClass} mt-1`} value={form[key]} placeholder={ph}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
            </label>
          ))}
          <Button tone="primary" icon={Plus} className="col-span-2 justify-center" loading={saving}
            disabled={!form.name.trim() || num(form.factor) <= 0} onClick={add}>Adicionar</Button>
        </div>
      </div>
    </Modal>
  );
}

export default function CadastroTab({ api }) {
  // --- [BLOCO: Estado] ---
  const [familias, setFamilias] = useState(null);
  const [familyId, setFamilyId] = useState(null);
  const [produtos, setProdutos] = useState(null);
  const [usuarios, setUsuarios] = useState(null);
  const [packProduct, setPackProduct] = useState(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState(null);

  const loadProdutos = (id) => api.produtos(id).then((d) => setProdutos(d.produtos)).catch((e) => setError(e.message));

  useEffect(() => {
    api.familias().then((d) => setFamilias(d.familias)).catch((e) => setError(e.message));
    api.usuarios().then((d) => setUsuarios(d.usuarios)).catch((e) => setError(e.message));
  }, [api]);

  useEffect(() => {
    if (!familyId) return;
    setProdutos(null);
    loadProdutos(familyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId]);

  // --- [BLOCO: Ações] ---
  const safe = (fn) => async (...args) => { setError(null); try { await fn(...args); } catch (e) { setError(e.message); } };

  const toggleFamily = safe(async (fam) => {
    const res = await api.toggleFamilia(fam.id, !fam.is_active_for_inventory);
    setFamilias((prev) => prev.map((f) => (f.id === fam.id ? { ...f, ...res } : f)));
  });
  const toggleProduct = safe(async (prod) => {
    const res = await api.toggleProduto(prod.id, !prod.is_inventory_default);
    setProdutos((prev) => prev.map((p) => (p.id === prod.id ? { ...p, ...res } : p)));
  });
  const toggleAllProducts = safe(async () => {
    const value = !produtos.every((p) => p.is_inventory_default);
    await api.toggleProdutosFamilia(familyId, value);
    setProdutos((prev) => prev.map((p) => ({ ...p, is_inventory_default: value })));
  });
  const changeRole = safe(async (userId, role) => {
    const res = await api.alterarPapel(userId, role);
    setUsuarios((prev) => prev.map((u) => (u.id === userId ? { ...u, ...res } : u)));
  });

  const visibleFamilies = (familias || []).filter((f) => f.name.toLowerCase().includes(filter.toLowerCase()));
  const currentFamily = (familias || []).find((f) => f.id === familyId);

  return (
    <div className="space-y-6">
      {error && <Alert onClose={() => setError(null)}>{error}</Alert>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Famílias */}
        <div className="bg-slate-900/80 border border-white/[0.05] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.05]">
            <p className="font-semibold text-white">Famílias</p>
            <p className="text-xs text-slate-500">Marque as que fazem inventário</p>
            <input className={`${inputClass} mt-2`} placeholder="Filtrar" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          {familias === null ? <Skeleton type="list" rows={6} className="p-4" /> : (
            <div className="max-h-[520px] overflow-y-auto divide-y divide-slate-800/60">
              {visibleFamilies.map((f) => (
                <div key={f.id} className={`px-4 py-2.5 flex items-center gap-3 ${familyId === f.id ? 'bg-slate-800/60' : 'hover:bg-slate-800/30'}`}>
                  <StyledCheckbox checked={f.is_active_for_inventory} onChange={() => toggleFamily(f)} size="sm" />
                  <button className="flex-1 text-left text-sm" onClick={() => setFamilyId(f.id)}>
                    <span className="text-white">{f.name}</span>
                    <span className="text-xs text-slate-500 ml-2">{f.product_count}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Produtos da família */}
        <div className="lg:col-span-2 bg-slate-900/80 border border-white/[0.05] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.05]">
            <p className="font-semibold text-white">{currentFamily ? currentFamily.name : 'Produtos'}</p>
            <p className="text-xs text-slate-500">"Padrão" = produto já vem selecionado ao criar um inventário da família</p>
          </div>
          {!familyId ? <p className="p-6 text-sm text-slate-500">Selecione uma família.</p> : produtos === null ? (
            <Skeleton type="table" rows={6} columns={4} className="m-4" />
          ) : (
            <div className="max-h-[520px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-950/50 text-slate-400 text-xs uppercase sticky top-0">
                  <tr>
                    <th className="px-4 py-2.5 text-left">
                      <div className="flex items-center gap-2">
                        <StyledCheckbox checked={produtos.length > 0 && produtos.every((p) => p.is_inventory_default)}
                          onChange={toggleAllProducts} size="sm" disabled={!produtos.length} />
                        Padrão
                      </div>
                    </th>
                    <th className="px-4 py-2.5 text-left">Produto</th>
                    <th className="px-4 py-2.5 text-left">Embalagens</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {produtos.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-2.5"><StyledCheckbox checked={p.is_inventory_default} onChange={() => toggleProduct(p)} size="sm" /></td>
                      <td className="px-4 py-2.5">
                        <p className="text-white">{p.name}</p>
                        <p className="text-xs text-slate-500">{[p.code && `Cód. ${p.code}`, p.ean || 'sem EAN', p.unit, p.ncm].filter(Boolean).join(' · ')}</p>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-300">
                        {p.packagings.map((pk) => `${pk.name} × ${formatQty(pk.factor)}`).join(', ') || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Button icon={Package} onClick={() => setPackProduct(p)}>Embalagens</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Usuários e papéis */}
      <div className="bg-slate-900/80 border border-white/[0.05] rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.05] flex items-center gap-2">
          <Users size={18} className="text-slate-400" />
          <div>
            <p className="font-semibold text-white">Usuários e papéis no inventário</p>
            <p className="text-xs text-slate-500">Contadores usam só o app de contagem e não veem saldos do sistema</p>
          </div>
        </div>
        {usuarios === null ? <Skeleton type="list" rows={3} className="p-4" /> : (
          <div className="divide-y divide-slate-800/60">
            {usuarios.map((u) => (
              <div key={u.id} className="px-4 py-2.5 flex items-center gap-4">
                <div className="flex-1">
                  <p className="text-sm text-white">{u.name || u.email}</p>
                  <p className="text-xs text-slate-500">{u.email}{u.is_active ? '' : ' · inativo'}</p>
                </div>
                <div className="w-64">
                  <SelectDropdown value={u.inventory_role} onChange={(role) => changeRole(u.id, role)} options={ROLE_OPTIONS} size="sm" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {packProduct && (
        <EmbalagensModal api={api} product={packProduct} onClose={() => setPackProduct(null)} onChanged={() => loadProdutos(familyId)} />
      )}
    </div>
  );
}
