import React, { useState, useEffect, useMemo } from 'react';
const formatWeight = (val) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(Number(val) || 0);
const formatPerc = (val) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(val) || 0);
const formatMoney = (val) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(val) || 0);

import { Download, Calculator, FileText, CheckCircle2, Settings, List, Plus, Trash2, Edit2, CalendarDays, Database, AlertTriangle, Loader2 } from 'lucide-react';
import { NumericFormat } from 'react-number-format';
import DatePicker from '../../components/common/DatePicker';
import ProgressModal from '../../components/common/ProgressModal';

export default function RateioECusteio({ token, onTaskStart, refreshCounter }) {
  const [activeTab, setActiveTab] = useState(() => sessionStorage.getItem('desossa_activeTab') || 'sync');

  useEffect(() => {
    sessionStorage.setItem('desossa_activeTab', activeTab);
  }, [activeTab]);
  
  return (
    <div className="p-6 text-slate-200">
      <div className="flex gap-4 mb-6 border-b border-slate-700 pb-2">
        <button 
          onClick={() => setActiveTab('sync')}
          className={`flex items-center gap-2 px-4 py-2 rounded-t-lg transition-all ${activeTab === 'sync' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
        >
          <Download size={18} /> Sincronização Omie
        </button>
        <button 
          onClick={() => setActiveTab('templates')}
          className={`flex items-center gap-2 px-4 py-2 rounded-t-lg transition-all ${activeTab === 'templates' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
        >
          <List size={18} /> Templates de Rendimento
        </button>
        <button 
          onClick={() => setActiveTab('operacao')}
          className={`flex items-center gap-2 px-4 py-2 rounded-t-lg transition-all ${activeTab === 'operacao' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
        >
          <Calculator size={18} /> Novo Rateio
        </button>
        <button 
          onClick={() => setActiveTab('historico')}
          className={`flex items-center gap-2 px-4 py-2 rounded-t-lg transition-all ${activeTab === 'historico' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
        >
          <Database size={18} /> Histórico e Reversão
        </button>
      </div>

      {activeTab === 'sync' && <SyncTab token={token} onTaskStart={onTaskStart} refreshCounter={refreshCounter} />}
      {activeTab === 'templates' && <TemplatesTab token={token} />}
      {activeTab === 'operacao' && <OperationTab token={token} onTaskStart={onTaskStart} refreshCounter={refreshCounter} />}
      {activeTab === 'historico' && <HistoryTab token={token} onTaskStart={onTaskStart} refreshCounter={refreshCounter} />}
    </div>
  );
}

// --- [BLOCO: Sincronização Omie] ---
function SyncTab({ token, onTaskStart, refreshCounter }) {
  const [products, setProducts] = useState([]);
  const [families, setFamilies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedFamily, setSelectedFamily] = useState('');
  const [activeView, setActiveView] = useState('families');

  useEffect(() => { loadData(); }, [refreshCounter]);

  const loadData = async () => {
    try {
      const resF = await fetch('http://localhost:8000/api/boning/families', { headers: { 'Authorization': `Bearer ${token}` }, cache: 'no-store' });
      const dataF = await resF.json();
      setFamilies(dataF.families || []);

      const resP = await fetch('http://localhost:8000/api/boning/products', { headers: { 'Authorization': `Bearer ${token}` }, cache: 'no-store' });
      const dataP = await resP.json();
      setProducts(dataP.products || []);
    } catch (e) { console.error(e); }
  };

  const handleSync = async () => {
    try {
      const res = await fetch('http://localhost:8000/api/boning/sync-omie', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok && data.task_id) {
        onTaskStart(data.task_id, 'Sincronizando Famílias e Produtos', 'desossa');
      } else if (res.status === 409 && data.task_id) {
        onTaskStart(data.task_id, 'Sincronizando Famílias e Produtos', 'desossa', 'duplicate', data.detail || "Ação em andamento");
      } else {
        onTaskStart(`err-${Date.now()}`, 'Erro ao iniciar sincronização', null, 'error', data.detail || data.message);
      }
    } catch (err) {
      onTaskStart(`err-${Date.now()}`, 'Erro na requisição', null, 'error', err.message);
    }
  };

  const toggleStandard = async (id) => {
    try {
      await fetch(`http://localhost:8000/api/boning/products/${id}/toggle-standard`, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` } });
      await loadData();
    } catch (e) { console.error(e); }
  };

  const toggleFamilyActive = async (id) => {
    try {
      await fetch(`http://localhost:8000/api/boning/families/${id}/toggle-active`, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` } });
      await loadData();
    } catch (e) { console.error(e); }
  };

  let filteredProducts = selectedFamily ? products.filter(p => p.family_name === selectedFamily) : [];

  return (
    <div>
      <div className="flex gap-4 mb-6 border-b border-slate-700 pb-4">
        <button 
          onClick={() => setActiveView('families')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${activeView === 'families' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
        >
          Selecionar famílias para rateio
        </button>
        <button 
          onClick={() => setActiveView('products')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${activeView === 'products' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
        >
          Definição de produtos da desossa
        </button>
      </div>

      {activeView === 'families' && (
        <div className="mb-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold">Selecionar famílias para rateio e custeio</h3>
            <button onClick={handleSync} disabled={loading} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-lg font-bold transition-all disabled:opacity-50">
              {loading ? <Loader2 className="animate-spin" size={16} /> : <Database size={16} />}
              SINCRONIZAR DADOS
            </button>
          </div>
          <div className="bg-slate-800 rounded-xl overflow-hidden shadow-lg border border-slate-700">
            <table className="w-full text-left">
              <thead className="bg-slate-900 border-b border-slate-700 text-slate-400 sticky top-0">
                <tr>
                  <th className="p-4 font-semibold">Família</th>
                  <th className="p-4 font-semibold text-center w-48">Ativa para Rateio?</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {families.map(f => (
                  <tr key={f.id} className="hover:bg-slate-700/50 transition-colors">
                    <td className="p-4 font-medium">{f.name}</td>
                    <td className="p-4 text-center">
                      <input type="checkbox" checked={f.is_active_for_boning} onChange={() => toggleFamilyActive(f.id)} className="w-5 h-5 accent-indigo-500 cursor-pointer" />
                    </td>
                  </tr>
                ))}
                {families.length === 0 && <tr><td colSpan="2" className="p-8 text-center text-slate-500">Nenhuma família encontrada. Sincronize com a Omie.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeView === 'products' && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold">Definição de produtos da desossa</h3>
            <div className="flex gap-4">
              <select value={selectedFamily} onChange={e => setSelectedFamily(e.target.value)} className="bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 outline-none focus:border-indigo-500 transition-colors">
                <option value="">Selecione uma família...</option>
                {families.filter(f => f.is_active_for_boning).map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
              </select>
            </div>
          </div>
          <div className="bg-slate-800 rounded-xl overflow-hidden shadow-lg border border-slate-700">
            <table className="w-full text-left">
              <thead className="bg-slate-900 border-b border-slate-700 text-slate-400 sticky top-0">
                <tr>
                  <th className="p-4 font-semibold text-center w-48">Corte Padrão?</th>
                  <th className="p-4 font-semibold">Produto</th>
                  <th className="p-4 font-semibold">Família</th>
                  <th className="p-4 font-semibold">Preço Venda Atual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {filteredProducts.map(p => (
                  <tr key={p.id} className="hover:bg-slate-700/50 transition-colors">
                    <td className="p-4 text-center w-48">
                      <input type="checkbox" checked={p.is_standard_cut} onChange={() => toggleStandard(p.id)} className="w-5 h-5 accent-indigo-500 cursor-pointer" />
                    </td>
                    <td className="p-4 font-medium">{p.name}</td>
                    <td className="p-4 text-slate-300">{p.family_name}</td>
                    <td className="p-4 text-emerald-400">R$ {formatMoney(p.unit_price)}</td>
                  </tr>
                ))}
                {filteredProducts.length === 0 && <tr><td colSpan="4" className="p-8 text-center text-slate-500">{selectedFamily ? "Nenhum produto listado." : "Selecione uma família acima para visualizar os produtos."}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// --- [BLOCO: ABA 2 - Templates] ---
function TemplatesTab({ token }) {
  const [templates, setTemplates] = useState([]);
  const [products, setProducts] = useState([]);
  const [families, setFamilies] = useState([]);
  const [creating, setCreating] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState(null);
  
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateFamily, setNewTemplateFamily] = useState('');
  const [newTemplateSamples, setNewTemplateSamples] = useState([]);

  const calculatedItems = useMemo(() => {
    const activeSamples = newTemplateSamples.filter(s => s.is_active);
    if (activeSamples.length === 0 || activeSamples[0].items.length === 0) return [];
    
    const numItems = activeSamples[0].items.length;
    const result = [];
    for (let i = 0; i < numItems; i++) {
      const product_id = activeSamples[0].items[i].product_id;
      let sumPerc = 0;
      activeSamples.forEach(s => {
        sumPerc += Number(s.items[i].percentage || 0);
      });
      result.push({
        product_id,
        expected_yield_percentage: (sumPerc / activeSamples.length).toFixed(3)
      });
    }
    return result;
  }, [newTemplateSamples]);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const resT = await fetch('http://localhost:8000/api/boning/templates', { headers: { 'Authorization': `Bearer ${token}` } });
      const dataT = await resT.json();
      setTemplates(dataT.templates || []);

      const resP = await fetch('http://localhost:8000/api/boning/products', { headers: { 'Authorization': `Bearer ${token}` } });
      const dataP = await resP.json();
      setProducts(dataP.products?.filter(p => p.is_standard_cut) || []);

      const resF = await fetch('http://localhost:8000/api/boning/families', { headers: { 'Authorization': `Bearer ${token}` } });
      const dataF = await resF.json();
      setFamilies(dataF.families || []);
    } catch (e) { console.error(e); }
  };

  const addSample = () => {
    const baseItems = newTemplateSamples.length > 0 
      ? newTemplateSamples[0].items.map(i => ({ product_id: i.product_id, weight: '', percentage: '' })) 
      : [];
    setNewTemplateSamples([...newTemplateSamples, { id: Date.now(), date: new Date().toISOString().split('T')[0], carcass_weight: '', is_active: true, items: baseItems }]);
  };

  const removeSample = (index) => {
    const updated = [...newTemplateSamples];
    updated.splice(index, 1);
    setNewTemplateSamples(updated);
  };

  const toggleSampleActive = (index) => {
    const updated = [...newTemplateSamples];
    updated[index].is_active = !updated[index].is_active;
    setNewTemplateSamples(updated);
  };

  const updateSampleField = (index, field, value) => {
    const updated = [...newTemplateSamples];
    updated[index][field] = value;
    if (field === 'carcass_weight') {
      const cw = Number(value);
      if (cw > 0) {
        updated[index].items = updated[index].items.map(it => {
          if (it.percentage) return { ...it, weight: ((Number(it.percentage) / 100) * cw).toFixed(3) };
          return it;
        });
      }
    }
    setNewTemplateSamples(updated);
  };

  const addCut = () => {
    const updatedSamples = newTemplateSamples.map(s => ({
      ...s,
      items: [...s.items, { product_id: '', weight: '', percentage: '' }]
    }));
    setNewTemplateSamples(updatedSamples);
  };

  const updateCutProduct = (itemIndex, productId) => {
    const updatedSamples = newTemplateSamples.map(s => {
      const newItems = [...s.items];
      newItems[itemIndex] = { ...newItems[itemIndex], product_id: productId };
      return { ...s, items: newItems };
    });
    setNewTemplateSamples(updatedSamples);
  };

  const updateCutValue = (sampleIndex, itemIndex, field, value) => {
    const updatedSamples = [...newTemplateSamples];
    const sample = { ...updatedSamples[sampleIndex] };
    const items = [...sample.items];
    const item = { ...items[itemIndex] };
    
    if (field === 'weight') {
      item.weight = value;
      if (sample.carcass_weight && Number(sample.carcass_weight) > 0) {
        item.percentage = ((Number(value) / Number(sample.carcass_weight)) * 100).toFixed(3);
      }
    } else if (field === 'percentage') {
      item.percentage = value;
      if (sample.carcass_weight && Number(sample.carcass_weight) > 0) {
        item.weight = ((Number(value) / 100) * Number(sample.carcass_weight)).toFixed(3);
      }
    }
    
    items[itemIndex] = item;
    sample.items = items;
    updatedSamples[sampleIndex] = sample;
    setNewTemplateSamples(updatedSamples);
  };

  const removeCut = (itemIndex) => {
    const updatedSamples = newTemplateSamples.map(s => {
      const newItems = [...s.items];
      newItems.splice(itemIndex, 1);
      return { ...s, items: newItems };
    });
    setNewTemplateSamples(updatedSamples);
  };

  const handleSave = async () => {
    const totalYield = calculatedItems.reduce((acc, curr) => acc + Number(curr.expected_yield_percentage), 0);
    if (totalYield > 100) return alert('A média dos rendimentos não pode ser maior que 100%');
    if (!newTemplateName) return alert('Dê um nome ao padrão de rendimento');
    if (!newTemplateFamily) return alert('Selecione uma família para o padrão');
    if (newTemplateSamples.length === 0 || newTemplateSamples[0].items.length === 0) return alert('Adicione pelo menos uma carcaça com um corte');

    const schema = {
      name: newTemplateName,
      family_id: Number(newTemplateFamily),
      items: calculatedItems.map(i => ({ product_id: Number(i.product_id), expected_yield_percentage: Number(i.expected_yield_percentage) })),
      samples: newTemplateSamples.map(s => ({
          date: s.date,
          carcass_weight: Number(s.carcass_weight || 0),
          is_active: s.is_active,
          items: s.items.map(i => ({
              product_id: Number(i.product_id),
              weight: Number(i.weight || 0),
              percentage: Number(i.percentage || 0)
          }))
      }))
    };

    const url = editingTemplateId 
      ? `http://localhost:8000/api/boning/templates/${editingTemplateId}` 
      : 'http://localhost:8000/api/boning/templates';
    const method = editingTemplateId ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(schema)
      });
      if (res.ok) {
        cancelForm();
        loadData();
      } else {
        const error = await res.json();
        alert(error.detail);
      }
    } catch (e) { console.error(e); }
  };

  const handleEdit = (template) => {
    setEditingTemplateId(template.id);
    setNewTemplateName(template.name);
    setNewTemplateFamily(template.family_id.toString());
    
    if (template.samples && template.samples.length > 0) {
        setNewTemplateSamples(template.samples.map(s => ({
            id: s.id,
            date: s.date,
            carcass_weight: s.carcass_weight.toString(),
            is_active: s.is_active,
            items: s.items.map(i => ({
                product_id: i.product_id.toString(),
                weight: i.weight.toString(),
                percentage: i.percentage.toString()
            }))
        })));
    } else {
        setNewTemplateSamples([{
            id: Date.now(),
            date: new Date().toISOString().split('T')[0],
            carcass_weight: '0',
            is_active: true,
            items: template.items.map(i => ({
                product_id: i.product_id.toString(),
                weight: '0',
                percentage: i.expected_yield_percentage.toString()
            }))
        }]);
    }
    setCreating(true);
  };

  const cancelForm = () => {
    setCreating(false);
    setEditingTemplateId(null);
    setNewTemplateName('');
    setNewTemplateFamily('');
    setNewTemplateSamples([]);
  };

  const deleteTemplate = async (id) => {
    if (!confirm('Excluir padrão de rendimento?')) return;
    try {
      await fetch(`http://localhost:8000/api/boning/templates/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
      loadData();
    } catch (e) { console.error(e); }
  };

  const avgCarcassWeight = useMemo(() => {
    const active = newTemplateSamples.filter(s => s.is_active);
    if (active.length === 0) return 0;
    const sum = active.reduce((acc, curr) => acc + Number(curr.carcass_weight || 0), 0);
    return sum / active.length;
  }, [newTemplateSamples]);

  const totalAllocatedPerc = calculatedItems.reduce((a,c) => a + Number(c.expected_yield_percentage), 0);
  const totalAllocatedKg = (totalAllocatedPerc / 100) * avgCarcassWeight;
  const expectedLossPerc = 100 - totalAllocatedPerc;
  const expectedLossKg = avgCarcassWeight - totalAllocatedKg;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-bold">Padrões de Rendimento (Templates)</h3>
        <button onClick={() => creating ? cancelForm() : setCreating(true)} className={`${creating ? 'bg-slate-600 hover:bg-slate-500' : 'bg-indigo-600 hover:bg-indigo-500'} text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2`}>
          {creating ? 'Cancelar' : <><Plus size={18}/> Novo Padrão</>}
        </button>
      </div>

      {creating && (
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 mb-6 shadow-xl">
          <div className="mb-4">
            <h4 className="text-lg font-bold text-white mb-4">{editingTemplateId ? 'Editar Padrão de Rendimento' : 'Novo Padrão de Rendimento'}</h4>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Família Base</label>
              <select value={newTemplateFamily} onChange={e => setNewTemplateFamily(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white outline-none focus:border-indigo-500">
                <option value="">Selecione uma família ativa...</option>
                {families.filter(f => f.is_active_for_boning).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Nome do Padrão (Ex: Gado Gordo)</label>
              <input type="text" value={newTemplateName} onChange={e => setNewTemplateName(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white outline-none focus:border-indigo-500" />
            </div>
          </div>
          <div className="mb-4">
            <h5 className="font-bold text-slate-300 mb-2">Amostras (Carcaças)</h5>
            {newTemplateSamples.length === 0 && <button onClick={addSample} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-medium text-sm">Adicionar Primeira Carcaça</button>}
            
            {newTemplateSamples.length > 0 && (
              <div className="flex gap-4 overflow-x-auto pb-4 mb-4 snap-x">
                {newTemplateSamples.map((s, idx) => (
                  <div key={s.id} className={`snap-center flex-shrink-0 w-[22rem] bg-slate-900 border rounded-xl p-4 ${s.is_active ? 'border-indigo-500/50 shadow-[0_0_20px_rgba(99,102,241,0.15)]' : 'border-slate-700 opacity-50 bg-slate-900/50'}`}>
                    <div className="flex justify-between items-center mb-4">
                      <div className="flex items-center gap-3">
                        <input type="checkbox" checked={s.is_active} onChange={() => toggleSampleActive(idx)} className="rounded bg-slate-800 border-slate-600 text-indigo-500 focus:ring-0 w-5 h-5 cursor-pointer" title="Incluir na média?" />
                        <span className="font-bold text-lg text-indigo-300">Carcaça {idx + 1}</span>
                      </div>
                      <button onClick={() => removeSample(idx)} className="text-red-400/80 hover:text-red-400 bg-red-400/10 p-1.5 rounded-lg"><Trash2 size={16}/></button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div>
                        <label className="text-xs font-semibold text-slate-400 mb-1 block">Data</label>
                        <input type="date" value={s.date} onChange={e => updateSampleField(idx, 'date', e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white focus:border-indigo-500 outline-none" />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-400 mb-1 block">Peso Total (Kg)</label>
                        <NumericFormat
                          thousandSeparator="."
                          decimalSeparator=","
                          decimalScale={3}
                          value={s.carcass_weight}
                          onValueChange={(values) => updateSampleField(idx, 'carcass_weight', values.floatValue)}
                          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white focus:border-indigo-500 outline-none font-mono"
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-3">
                      {s.items.map((it, itemIdx) => (
                        <div key={itemIdx} className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/50 relative">
                          {idx === 0 ? (
                             <div className="flex justify-between items-center mb-2 h-[28px]">
                               <select value={it.product_id} onChange={e => updateCutProduct(itemIdx, e.target.value)} className="w-full h-full bg-slate-900 border border-slate-700 rounded px-2 py-0 text-xs text-white focus:border-indigo-500 outline-none">
                                 <option value="">Selecione o Corte...</option>
                                 {products.filter(p => !newTemplateFamily || p.family_id === Number(newTemplateFamily)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                               </select>
                               <button onClick={() => removeCut(itemIdx)} className="text-red-400 hover:text-red-300 ml-2 flex-shrink-0"><Trash2 size={14}/></button>
                             </div>
                          ) : (
                             <div className="flex justify-between items-center mb-2 h-[28px]">
                               <div className="w-full h-full flex items-center border border-transparent rounded px-2 py-0 text-xs text-slate-200 font-bold truncate uppercase tracking-wider">
                                 {products.find(p => p.id === Number(it.product_id))?.name || 'Corte Padrão'}
                               </div>
                               <div className="ml-2 w-[14px] flex-shrink-0"></div>
                             </div>
                          )}
                          <div className="grid grid-cols-2 gap-3">
                            <div className="relative">
                               <NumericFormat
                                 thousandSeparator="."
                                 decimalSeparator=","
                                 decimalScale={3}
                                 placeholder="Kg"
                                 value={it.weight}
                                 onValueChange={(values) => updateCutValue(idx, itemIdx, 'weight', values.floatValue)}
                                 className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs text-white focus:border-indigo-500 outline-none font-mono pl-7"
                               />
                               <span className="absolute left-2 top-1.5 text-xs text-slate-500 font-mono">KG</span>
                            </div>
                            <div className="relative">
                               <NumericFormat
                                 thousandSeparator="."
                                 decimalSeparator=","
                                 decimalScale={3}
                                 placeholder="%"
                                 value={it.percentage}
                                 onValueChange={(values) => updateCutValue(idx, itemIdx, 'percentage', values.floatValue)}
                                 className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs text-white focus:border-indigo-500 outline-none font-mono pl-6"
                               />
                               <span className="absolute left-2 top-1.5 text-xs text-slate-500 font-mono">%</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {idx === 0 && (
                      <button onClick={addCut} className="mt-3 w-full border border-dashed border-indigo-500/50 text-indigo-400 hover:bg-indigo-500/10 text-xs py-2 rounded-lg flex items-center justify-center gap-1 font-bold transition-colors"><Plus size={16}/> Adicionar Corte à Grade</button>
                    )}
                  </div>
                ))}
                
                <div className="flex-shrink-0 w-32 border-2 border-dashed border-slate-700 rounded-xl flex items-center justify-center cursor-pointer hover:border-indigo-500 hover:text-indigo-400 hover:bg-indigo-500/5 transition-colors group" onClick={addSample}>
                   <div className="text-center">
                     <Plus size={32} className="mx-auto mb-2 text-slate-500 group-hover:text-indigo-400" />
                     <span className="text-sm font-bold text-slate-400 group-hover:text-indigo-400">Nova<br/>Carcaça</span>
                   </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end items-end border-t border-slate-700 pt-5 mt-6">
             <div className="flex gap-4 text-left flex-wrap justify-end">
                <div className={`bg-slate-900/80 border rounded-xl p-4 flex flex-col justify-center relative overflow-hidden w-44 ${totalAllocatedPerc > 100 ? 'border-red-500/40' : 'border-emerald-500/40'}`}>
                  <div className={`absolute top-0 right-0 w-24 h-24 blur-2xl rounded-full translate-x-1/2 -translate-y-1/2 ${totalAllocatedPerc > 100 ? 'bg-red-500/20' : 'bg-emerald-500/20'}`}></div>
                  <p className="text-xs text-slate-400 font-bold z-10 uppercase tracking-wider mb-1">Alocado (%)</p>
                  <p className={`text-2xl font-mono font-bold truncate ${totalAllocatedPerc > 100 ? 'text-red-400' : 'text-emerald-400'}`}>
                     {formatPerc(totalAllocatedPerc)}%
                  </p>
                </div>
                <div className={`bg-slate-900/80 border rounded-xl p-4 flex flex-col justify-center relative overflow-hidden w-44 ${totalAllocatedPerc > 100 ? 'border-red-500/40' : 'border-emerald-500/40'}`}>
                  <div className={`absolute top-0 right-0 w-24 h-24 blur-2xl rounded-full translate-x-1/2 -translate-y-1/2 ${totalAllocatedPerc > 100 ? 'bg-red-500/20' : 'bg-emerald-500/20'}`}></div>
                  <p className="text-xs text-slate-400 font-bold z-10 uppercase tracking-wider mb-1">Alocado (Kg)</p>
                  <p className={`text-2xl font-mono font-bold truncate ${totalAllocatedPerc > 100 ? 'text-red-400' : 'text-emerald-400'}`}>
                     {formatWeight(totalAllocatedKg)}kg
                  </p>
                </div>
                <div className="bg-slate-900/80 border border-red-500/40 rounded-xl p-4 flex flex-col justify-center relative overflow-hidden w-44">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/20 blur-2xl rounded-full translate-x-1/2 -translate-y-1/2"></div>
                  <p className="text-xs text-slate-400 font-bold z-10 uppercase tracking-wider mb-1">Perda (%)</p>
                  <p className="text-2xl font-mono font-bold text-red-400 truncate">
                     {formatPerc(expectedLossPerc)}%
                  </p>
                </div>
                <div className="bg-slate-900/80 border border-red-500/40 rounded-xl p-4 flex flex-col justify-center relative overflow-hidden w-44">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/20 blur-2xl rounded-full translate-x-1/2 -translate-y-1/2"></div>
                  <p className="text-xs text-slate-400 font-bold z-10 uppercase tracking-wider mb-1">Perda (Kg)</p>
                  <p className="text-2xl font-mono font-bold text-red-400 truncate">
                     {formatWeight(expectedLossKg)}kg
                  </p>
                </div>
             </div>
          </div>
          <div className="mt-6 flex justify-end">
            <button onClick={handleSave} className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2 rounded-lg font-bold">{editingTemplateId ? 'Salvar Alterações' : 'Criar Padrão'}</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {templates.map(t => (
          <div key={t.id} className="bg-slate-800 rounded-xl p-5 border border-slate-700 shadow-lg flex flex-col h-full">
            <div className="flex justify-between items-start mb-4">
              <h4 className="font-bold text-lg text-indigo-300">{t.name}</h4>
              <div className="flex gap-2 justify-end">
                <button onClick={() => handleEdit(t)} className="p-2 text-indigo-400 hover:bg-indigo-400/10 rounded-lg transition-colors"><Edit2 size={18}/></button>
                <button onClick={() => deleteTemplate(t.id)} className="p-2 text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"><Trash2 size={18}/></button>
              </div>
            </div>
            <div className="flex-1 space-y-2">
              {t.items.map((i, idx) => (
                <div key={idx} className="flex justify-between text-sm border-b border-slate-700/50 pb-1">
                  <span className="text-slate-300">{i.name}</span>
                  <span className="font-mono text-emerald-400">{i.expected_yield_percentage}%</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-slate-700 grid grid-cols-2 gap-4">
              <div className={`bg-slate-900/80 border rounded-lg p-3 flex flex-col justify-center relative overflow-hidden ${t.items.reduce((a,c) => a + c.expected_yield_percentage, 0) > 100 ? 'border-red-500/30' : 'border-emerald-500/30'}`}>
                <div className={`absolute top-0 right-0 w-16 h-16 blur-xl rounded-full translate-x-1/2 -translate-y-1/2 ${t.items.reduce((a,c) => a + c.expected_yield_percentage, 0) > 100 ? 'bg-red-500/10' : 'bg-emerald-500/10'}`}></div>
                <p className="text-xs text-slate-400 font-medium z-10">Total Alocado</p>
                <p className={`text-xl font-mono font-bold z-10 truncate ${t.items.reduce((a,c) => a + c.expected_yield_percentage, 0) > 100 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {formatPerc(t.items.reduce((a,c) => a + c.expected_yield_percentage, 0))}%
                </p>
              </div>
              <div className="bg-slate-900/80 border border-red-500/30 rounded-lg p-3 flex flex-col justify-center relative overflow-hidden">
                <div className="absolute top-0 right-0 w-16 h-16 bg-red-500/10 blur-xl rounded-full translate-x-1/2 -translate-y-1/2"></div>
                <p className="text-xs text-slate-400 font-medium z-10">Perda Estimada</p>
                <p className="text-xl font-mono font-bold text-red-400 z-10 truncate">
                  {formatPerc(100 - t.items.reduce((a,c) => a + c.expected_yield_percentage, 0))}%
                </p>
              </div>
            </div>
          </div>
        ))}
        {templates.length === 0 && !creating && <p className="text-slate-500 col-span-full py-8 text-center">Nenhum template cadastrado.</p>}
      </div>
    </div>
  );
}

// --- [BLOCO: Operação de Rateio e Custeio] ---
function OperationTab({ token, onTaskStart, refreshCounter }) {
  const [mode, setMode] = useState('TEMPLATE'); // 'MANUAL' or 'TEMPLATE'
  const [carcassWeight, setCarcassWeight] = useState('');
  const [carcassCost, setCarcassCost] = useState('');
  
  const [templates, setTemplates] = useState([]);
  const [products, setProducts] = useState([]);
  
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [manualCuts, setManualCuts] = useState([]);
  const [copyTemplateId, setCopyTemplateId] = useState('');

  const [calculationResult, setCalculationResult] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportDate, setExportDate] = useState(new Date().toISOString().split('T')[0]);

  const [checkingStocks, setCheckingStocks] = useState(false);
  const [fixingStocks, setFixingStocks] = useState(false);
  const [stocksData, setStocksData] = useState(null); 
  const [stocksVerified, setStocksVerified] = useState(false);
  const [hasNegativeStocks, setHasNegativeStocks] = useState(false);

  useEffect(() => {
    setStocksData(null);
    setStocksVerified(false);
    setHasNegativeStocks(false);
  }, [exportDate, calculationResult]);

  useEffect(() => { loadData(); }, [refreshCounter]);

  const loadData = async () => {
    try {
      const resT = await fetch('http://localhost:8000/api/boning/templates', { headers: { 'Authorization': `Bearer ${token}` } });
      const dataT = await resT.json();
      setTemplates(dataT.templates || []);

      const resP = await fetch('http://localhost:8000/api/boning/products', { headers: { 'Authorization': `Bearer ${token}` } });
      const dataP = await resP.json();
      setProducts(dataP.products?.filter(p => p.is_standard_cut) || []);
    } catch (e) { console.error(e); }
  };

  const addManualCut = () => setManualCuts([...manualCuts, { product_id: '', actual_weight: '' }]);
  const updateManualCut = (idx, field, val) => {
    const arr = [...manualCuts];
    arr[idx][field] = val;
    setManualCuts(arr);
  };
  const removeManualCut = (idx) => {
    const arr = [...manualCuts];
    arr.splice(idx, 1);
    setManualCuts(arr);
  };

  const copyFromTemplate = () => {
    if (!copyTemplateId || !carcassWeight) return alert('Informe o Peso da Carcaça e selecione o Padrão para copiar.');
    const t = templates.find(x => x.id === Number(copyTemplateId));
    if (!t) return;
    const copied = t.items.map(i => ({
      product_id: i.product_id.toString(),
      actual_weight: (Number(carcassWeight) * (i.expected_yield_percentage / 100)).toFixed(2)
    }));
    setManualCuts(copied);
  };

  const activeTemplate = useMemo(() => templates.find(t => t.id === Number(selectedTemplate)), [templates, selectedTemplate]);

  const derivedCuts = useMemo(() => {
    if (mode === 'TEMPLATE' && activeTemplate && carcassWeight) {
      return activeTemplate.items.map(i => ({
        name: i.name,
        expected_weight: (Number(carcassWeight) * (i.expected_yield_percentage / 100)).toFixed(2)
      }));
    }
    return [];
  }, [mode, activeTemplate, carcassWeight]);

  const handleCalculate = async () => {
    if (!carcassWeight || !carcassCost) return alert('Informe o Peso Total da Carcaça e o Valor de Compra por Quilo.');
    
    let payload = {
      mode,
      carcass: { weight: Number(carcassWeight), cost_per_kg: Number(carcassCost) },
    };

    if (mode === 'TEMPLATE') {
      if (!selectedTemplate) return alert('Selecione um Template de Rendimento.');
      payload.template_id = Number(selectedTemplate);
    } else {
      if (manualCuts.length === 0) return alert('Adicione cortes gerados manualmente.');
      payload.cuts = manualCuts.map(c => ({ product_id: Number(c.product_id), actual_weight: Number(c.actual_weight) }));
    }

    try {
      const res = await fetch('http://localhost:8000/api/boning/calculate-apportionment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setCalculationResult(await res.json());
      } else {
        const err = await res.json();
        alert(err.detail);
      }
    } catch (e) { console.error(e); }
  };

  const handleCheckStocks = async () => {
    if (!exportDate || !calculationResult) return;
    setCheckingStocks(true);
    try {
      const productIds = calculationResult.items.map(i => i.product_id);
      const res = await fetch('http://localhost:8000/api/boning/check-stocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ date: exportDate, product_ids: productIds })
      });
      if (res.ok) {
        const data = await res.json();
        setStocksData(data.stocks);
        const hasNeg = Object.values(data.stocks).some(s => s.saldo < 0);
        setHasNegativeStocks(hasNeg);
        setStocksVerified(true);
      } else {
        const err = await res.json();
        alert(`Erro ao checar estoques no Omie: ${err.detail || 'Desconhecido'}`);
      }
    } catch (e) {
      alert("Erro de rede ao verificar estoques.");
    } finally {
      setCheckingStocks(false);
    }
  };

  useEffect(() => {
    const handleTaskCompleted = (e) => {
      if (exportDate && calculationResult) {
        handleCheckStocks();
      }
    };
    window.addEventListener('taskCompleted', handleTaskCompleted);
    return () => window.removeEventListener('taskCompleted', handleTaskCompleted);
  }, [exportDate, calculationResult, handleCheckStocks]);

  const handleFixStocks = async () => {
    if (!exportDate || !stocksData) return;
    setFixingStocks(true);
    const itemsToFix = Object.entries(stocksData)
      .filter(([_, info]) => info.saldo < 0)
      .map(([pid, info]) => ({
        product_id: parseInt(pid),
        local_id: info.local_id,
        saldo_negativo: Math.abs(info.saldo),
        unit_cost: calculationResult?.items?.find(i => i.product_id == pid)?.unit_cost || 0
      }));

    if (itemsToFix.length === 0) {
      alert("Não há estoques negativos para ajustar.");
      setFixingStocks(false);
      return;
    }

    try {
      const res = await fetch('http://localhost:8000/api/boning/fix-negative-stocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ date: exportDate, items: itemsToFix })
      });
      const data = await res.json();
      if (res.ok && data.task_id) {
        onTaskStart(data.task_id, 'Zerando Estoques', 'desossa');
      } else if (res.status === 409 && data.task_id) {
        onTaskStart(data.task_id, 'Zerando Estoques', 'desossa', 'duplicate', data.detail || "Ação em andamento");
      } else {
        onTaskStart(`err-${Date.now()}`, 'Erro ao corrigir estoques', null, 'error', data.detail || "Falha desconhecida");
      }
    } catch (e) {
      onTaskStart(`err-${Date.now()}`, 'Falha', null, 'error', e.message);
    } finally {
      setFixingStocks(false);
    }
  };

  const handleExport = async () => {
    if (!calculationResult || !calculationResult.process_id) return;
    setExporting(true);
    try {
      const res = await fetch(`http://localhost:8000/api/boning/process/${calculationResult.process_id}/export-cmc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          date: exportDate,
          items: calculationResult.items.map(i => ({ product_id: i.product_id, local_id: stocksData?.[i.product_id]?.local_id || 0 }))
        })
      });
      const data = await res.json();
      if (res.ok && data.task_id) {
        onTaskStart(data.task_id, 'Lançando Rateio e Custeio', 'desossa');
      } else if (res.status === 409 && data.task_id) {
        onTaskStart(data.task_id, 'Lançando Rateio e Custeio', 'desossa', 'duplicate', data.detail || "Ação em andamento");
      } else {
        onTaskStart(`err-${Date.now()}`, 'Erro ao exportar', null, 'error', data.detail || data.message || JSON.stringify(data));
      }
    } catch (e) {
      onTaskStart(`err-${Date.now()}`, 'Falha na exportação', null, 'error', e.message);
    }
    setExporting(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="w-full bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-xl flex flex-col">
        <h3 className="text-xl font-bold mb-4 text-white">Configuração do Rateio</h3>
        <div className="space-y-4 flex-1">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
            <div className="flex flex-col bg-slate-900/40 p-1 rounded-lg border border-slate-700/50 h-full gap-1">
              <button 
                onClick={() => {setMode('TEMPLATE'); setCalculationResult(null);}} 
                className={`flex-1 text-xs font-bold rounded-md transition-all flex items-center justify-center ${mode === 'TEMPLATE' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.15)]' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 border border-transparent'}`}
              >
                Modo Padrão
              </button>
              <button 
                onClick={() => {setMode('MANUAL'); setCalculationResult(null);}} 
                className={`flex-1 text-xs font-bold rounded-md transition-all flex items-center justify-center ${mode === 'MANUAL' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.15)]' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 border border-transparent'}`}
              >
                Modo Manual
              </button>
            </div>

            {mode === 'TEMPLATE' ? (
              <div className="bg-slate-900/80 border border-indigo-500/30 rounded-lg p-3 flex flex-col justify-center relative overflow-hidden focus-within:border-indigo-500/60 transition-colors">
                <div className="absolute top-0 right-0 w-16 h-16 bg-indigo-500/10 blur-xl rounded-full translate-x-1/2 -translate-y-1/2"></div>
                <label className="text-xs text-slate-400 font-medium z-10 mb-1">Template Base</label>
                <select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)} className="w-full bg-transparent border-none p-0 text-indigo-300 font-bold text-lg focus:ring-0 outline-none z-10">
                  <option value="" className="bg-slate-900 text-slate-300">Selecione...</option>
                  {templates.map(t => <option key={t.id} value={t.id} className="bg-slate-900 text-slate-300">{t.name}</option>)}
                </select>
              </div>
            ) : (
              <div className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-3 flex flex-col justify-center relative overflow-hidden">
                <label className="text-xs text-slate-400 font-medium z-10 mb-1">Copiar de Template</label>
                <div className="flex gap-2 z-10">
                  <select value={copyTemplateId} onChange={e => setCopyTemplateId(e.target.value)} className="flex-1 bg-transparent border-b border-slate-700 p-0 text-sm text-slate-300 outline-none focus:border-indigo-500 transition-colors">
                    <option value="" className="bg-slate-900 text-slate-300">Selecione...</option>
                    {templates.map(t => <option key={t.id} value={t.id} className="bg-slate-900 text-slate-300">{t.name}</option>)}
                  </select>
                  <button onClick={copyFromTemplate} className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 rounded-md text-xs font-bold transition-colors shadow-lg">Ir</button>
                </div>
              </div>
            )}
            
            <div className="bg-slate-900/80 border border-indigo-500/30 rounded-lg p-3 flex flex-col justify-center relative overflow-hidden focus-within:border-indigo-500/60 transition-colors">
              <div className="absolute top-0 right-0 w-16 h-16 bg-indigo-500/10 blur-xl rounded-full translate-x-1/2 -translate-y-1/2"></div>
              <label className="text-xs text-slate-400 font-medium z-10 mb-1">Peso Total (Kg)</label>
              <NumericFormat
                thousandSeparator="."
                decimalSeparator=","
                decimalScale={3}
                value={carcassWeight}
                onValueChange={(values) => setCarcassWeight(values.floatValue)}
                className="w-full bg-transparent border-none p-0 text-white font-mono text-xl focus:ring-0 outline-none z-10 placeholder-slate-600"
                placeholder="Ex: 300,00"
              />
            </div>
            
            <div className="bg-slate-900/80 border border-indigo-500/30 rounded-lg p-3 flex flex-col justify-center relative overflow-hidden focus-within:border-indigo-500/60 transition-colors">
              <div className="absolute top-0 right-0 w-16 h-16 bg-indigo-500/10 blur-xl rounded-full translate-x-1/2 -translate-y-1/2"></div>
              <label className="text-xs text-slate-400 font-medium z-10 mb-1">Preço / Kg (R$)</label>
              <NumericFormat
                thousandSeparator="."
                decimalSeparator=","
                decimalScale={2}
                value={carcassCost}
                onValueChange={(values) => setCarcassCost(values.floatValue)}
                className="w-full bg-transparent border-none p-0 text-white font-mono text-xl focus:ring-0 outline-none z-10 placeholder-slate-600"
                placeholder="Ex: 10,00"
              />
            </div>

            <div className="bg-slate-900/80 border border-emerald-500/30 rounded-lg p-3 flex flex-col justify-center relative overflow-hidden">
              <div className="absolute top-0 right-0 w-16 h-16 bg-emerald-500/10 blur-xl rounded-full translate-x-1/2 -translate-y-1/2"></div>
              <p className="text-xs text-slate-400 font-medium z-10">Custo Total</p>
              <p className="text-2xl font-mono font-bold text-emerald-400 z-10 truncate">
                {(carcassWeight && carcassCost) ? `R$ ${formatMoney(Number(carcassWeight)*Number(carcassCost))}` : '---'}
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-700 mt-6">
            {mode === 'TEMPLATE' ? (
              <div>
                {derivedCuts.length > 0 && (
                  <div className="mt-4 bg-slate-900/50 p-4 rounded-lg border border-slate-700/50">
                    <div className="grid grid-cols-3 text-xs font-bold text-slate-500 mb-2 uppercase px-2">
                      <span>Corte</span>
                      <span className="text-center">Peso Calculado</span>
                      <span className="text-right">Percentual Estimado</span>
                    </div>
                    {derivedCuts.map((dc, idx) => {
                      const pct = carcassWeight ? formatPerc((Number(dc.expected_weight) / Number(carcassWeight)) * 100) : formatPerc(0);
                      return (
                        <div key={idx} className="grid grid-cols-3 gap-4 text-sm mb-1 bg-slate-900 p-2 rounded items-center">
                          <span className="text-slate-300 truncate" title={dc.name}>{dc.name}</span>
                          <span className="font-mono text-indigo-300 font-bold text-center">{formatWeight(dc.expected_weight)} Kg</span>
                          <span className="font-mono text-indigo-400 text-right">{pct}%</span>
                        </div>
                      )
                    })}
                    {carcassWeight && (
                      <div className="grid grid-cols-3 gap-4 text-sm mt-2 bg-orange-500/10 border border-orange-500/30 p-2 rounded items-center">
                        <span className="font-bold text-orange-400 truncate">Quebra / Perda Residual</span>
                        <span className="font-mono text-orange-400 font-bold text-center">
                          {formatWeight(Number(carcassWeight) - derivedCuts.reduce((a,c) => a + Number(c.expected_weight), 0))} Kg
                        </span>
                        <span className="font-mono text-orange-400 text-right">
                          {formatPerc(100 - activeTemplate.items.reduce((a,c) => a + c.expected_yield_percentage, 0))}%
                        </span>
                      </div>
                    )}
                  </div>
                )}
                {activeTemplate && !carcassWeight && (
                  <p className="text-xs text-orange-400 mt-2">Informe o Peso da Carcaça para ver o preenchimento automático.</p>
                )}
              </div>
            ) : (
              <div className="flex flex-col h-full">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-medium text-slate-400">Cortes Gerados (Lançamento Manual)</label>
                  <button onClick={addManualCut} className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-white font-bold flex items-center gap-1"><Plus size={14}/> Adicionar Corte</button>
                </div>
                <div className="space-y-2 pr-1">
                  {manualCuts.map((mc, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <select value={mc.product_id} onChange={e => updateManualCut(idx, 'product_id', e.target.value)} className="flex-1 bg-slate-900 border border-slate-700 rounded-md px-2 py-2 text-sm text-white focus:border-indigo-500 min-w-0">
                        <option value="">Selecione o Corte...</option>
                        {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <NumericFormat
                        thousandSeparator="."
                        decimalSeparator=","
                        decimalScale={3}
                        placeholder="Peso (Kg)"
                        value={mc.actual_weight}
                        onValueChange={(values) => updateManualCut(idx, 'actual_weight', values.floatValue)}
                        className="w-24 bg-slate-900 border border-slate-700 rounded-md px-2 py-2 text-sm font-mono text-white focus:border-indigo-500"
                      />
                      <button onClick={() => removeManualCut(idx)} className="text-red-400 hover:text-red-300 p-1"><Trash2 size={16}/></button>
                    </div>
                  ))}
                  {manualCuts.length === 0 && <p className="text-xs text-slate-500 italic text-center py-4">Nenhum corte adicionado manualmente.</p>}
                  
                  {carcassWeight && manualCuts.length > 0 && (
                    <div className="flex gap-2 items-center bg-orange-500/10 border border-orange-500/30 rounded-md px-3 py-2 mt-2">
                      <div className="flex-1 text-sm font-bold text-orange-400">Quebra / Perda Residual</div>
                      <div className="text-right text-sm font-mono text-orange-400 font-bold">
                        {formatWeight(Number(carcassWeight) - manualCuts.reduce((acc, c) => acc + Number(c.actual_weight || 0), 0))} Kg
                      </div>
                      <div className="w-16 text-right text-xs font-mono text-orange-400/80 font-bold">
                        {formatPerc(((Number(carcassWeight) - manualCuts.reduce((acc, c) => acc + Number(c.actual_weight || 0), 0)) / Number(carcassWeight)) * 100)}%
                      </div>
                      <div className="w-6"></div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        
        <button onClick={handleCalculate} className="mt-6 w-full bg-indigo-600 hover:bg-indigo-500 text-white py-4 rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2 transition-all">
          <Calculator size={20} /> Executar Motor de Cálculo
        </button>
      </div>

      <div className="w-full bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-xl flex flex-col">
        <h3 className="text-xl font-bold mb-6 text-white flex items-center gap-2"><CheckCircle2 className="text-emerald-500" /> Painel de Resultados (Custeio Conjunto)</h3>
        
        {!calculationResult ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 opacity-50">
            <Calculator size={64} className="mb-4" />
            <p className="text-lg font-medium text-center">Preencha a configuração e execute o cálculo<br/>para visualizar o rateio por preço de venda.</p>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
               <div className="bg-slate-900 p-4 rounded-lg border border-slate-700">
                 <p className="text-xs text-slate-400">Total Desossado (Carcaça)</p>
                 <p className="text-xl font-mono text-white">{formatWeight(calculationResult.total_carcass_weight)} Kg</p>
               </div>
               <div className="bg-slate-900 p-4 rounded-lg border border-slate-700">
                 <p className="text-xs text-slate-400">Custo Total Alocado</p>
                 <p className="text-xl font-mono text-red-400">R$ {formatMoney(calculationResult.total_carcass_cost)}</p>
               </div>
               <div className="bg-slate-900 p-4 rounded-lg border border-slate-700">
                 <p className="text-xs text-slate-400">VPL Total (Desossa)</p>
                 <p className="text-xl font-mono text-indigo-400">R$ {formatMoney(calculationResult.total_vpl)}</p>
               </div>
               <div className="bg-slate-900 p-4 rounded-lg border border-slate-700">
                 <p className="text-xs text-slate-400">Lucro Bruto (Carcaça)</p>
                 <p className="text-xl font-mono text-emerald-400 font-bold">R$ {formatMoney(calculationResult.total_vpl - calculationResult.total_carcass_cost)}</p>
               </div>
               <div className="bg-slate-900 p-4 rounded-lg border border-slate-700">
                 <p className="text-xs text-slate-400">Margem Bruta (Carcaça)</p>
                 <p className="text-xl font-mono text-emerald-400 font-bold">{formatPerc(((calculationResult.total_vpl - calculationResult.total_carcass_cost) / calculationResult.total_vpl) * 100)}%</p>
               </div>
               <div className="bg-slate-900 p-4 rounded-lg border border-slate-700">
                 <p className="text-xs text-slate-400">Quebra (Não Rateada)</p>
                 <p className="text-xl font-mono text-orange-400">{formatWeight(calculationResult.loss_weight)} Kg</p>
               </div>
            </div>

            <div className="overflow-x-auto flex-1 border border-slate-700 rounded-lg">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-900 text-slate-400 sticky top-0 shadow">
                  <tr>
                    <th className="p-3">Corte Gerado</th>
                    <th className="p-3 text-right">Peso Real (Kg)</th>
                    <th className="p-3 text-right">Preço de Venda</th>
                    <th className="p-3 text-right">VPL (Potencial)</th>
                    <th className="p-3 text-right">Participação no Faturamento</th>
                    <th className="p-3 text-right">Custo Rateado</th>
                    <th className="p-3 text-right text-emerald-400">Lucro Bruto (R$)</th>
                    <th className="p-3 text-right bg-emerald-900/20 text-emerald-400">Custo Unitário Final (CMC)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {calculationResult.items.map(i => (
                    <tr key={i.product_id} className="hover:bg-slate-700/30">
                      <td className="p-3 font-medium text-white">{i.product_name}</td>
                      <td className="p-3 text-right font-mono text-slate-300">{formatWeight(i.actual_weight)}</td>
                      <td className="p-3 text-right font-mono text-slate-400">R$ {formatMoney(i.unit_price)}</td>
                      <td className="p-3 text-right font-mono text-indigo-300 font-medium">R$ {formatMoney(i.vpl)}</td>
                      <td className="p-3 text-right font-mono text-amber-300 font-medium">{formatPerc(i.participation_percentage)}%</td>
                      <td className="p-3 text-right font-mono text-red-300">R$ {formatMoney(i.allocated_cost)}</td>
                      <td className="p-3 text-right font-mono text-emerald-400 font-medium">R$ {formatMoney(i.vpl - i.allocated_cost)}</td>
                      <td className="p-3 text-right font-mono text-emerald-400 bg-emerald-900/10 font-bold text-base">R$ {formatMoney(i.unit_cost)} / Kg</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="mt-8 bg-slate-900 border border-slate-700/50 rounded-xl p-6 shadow-lg relative z-20">
              <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
                <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 blur-3xl rounded-full"></div>
              </div>
              
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-2 relative z-10">
                <div>
                  <h4 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                    <Database size={20} className="text-indigo-400" />
                    Validação de Estoque (Omie)
                  </h4>
                  <p className="text-sm text-slate-400">Verifique se há estoques negativos na data da desossa antes de lançar a entrada para proteger a margem do CMC.</p>
                </div>
                
                <div className="flex items-end gap-4 shrink-0">
                  <div className="flex flex-col w-[258px]">
                    <label className="text-xs text-slate-400 font-medium mb-1">Data da Produção (ERP)</label>
                    <DatePicker 
                      value={exportDate} 
                      onChange={setExportDate}
                    />
                  </div>
                  <button 
                    onClick={handleCheckStocks}
                    disabled={checkingStocks || fixingStocks}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-5 py-[11px] rounded-xl font-bold transition-all whitespace-nowrap shadow-md"
                  >
                    {checkingStocks ? 'Consultando Omie...' : 'Verificar Estoques'}
                  </button>
                </div>
              </div>

              {stocksVerified && (
                <div className={`p-5 rounded-xl border ${hasNegativeStocks ? 'bg-red-500/10 border-red-500/30' : 'bg-emerald-500/10 border-emerald-500/30'} mt-6 relative z-10 transition-all`}>
                  {hasNegativeStocks ? (
                    <div>
                      <div className="flex items-start gap-4 mb-4">
                        <AlertTriangle size={24} className="text-red-400 shrink-0 mt-0.5" />
                        <div>
                          <h5 className="font-bold text-red-400 text-base">Estoques Negativos Encontrados!</h5>
                          <p className="text-sm text-red-300/80 mt-1">Você precisa ajustar (zerar) os estoques negativos no Omie antes de registrar a entrada, senão o custo médio (CMC) será completamente distorcido.</p>
                        </div>
                        <button 
                          onClick={handleFixStocks}
                          disabled={fixingStocks}
                          className="ml-auto bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-bold shadow-lg shadow-red-500/20 flex items-center gap-2 shrink-0 transition-colors"
                        >
                          <CheckCircle2 size={18} />
                          {fixingStocks ? 'Ajustando no Omie...' : 'Zerar Estoques Negativos'}
                        </button>
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mt-4 pt-4 border-t border-red-500/20">
                        {calculationResult.items.map(i => {
                          const stockData = stocksData[i.product_id] || {};
                          const stock = stockData.saldo || 0;
                          const status = stockData.status || "OK";
                          
                          if (stock >= 0 && status === "OK") return null;
                          
                          return (
                            <div key={i.product_id} className={`p-3 rounded-lg text-sm flex flex-col gap-1 shadow-sm border ${status === "NO_OMIE_ID" ? "bg-orange-900/80 border-orange-500/30" : status === "ERROR" ? "bg-red-900/80 border-red-500/30" : "bg-slate-900/80 border-red-500/30"}`}>
                              <span className="truncate text-slate-300 font-medium" title={i.product_name}>{i.product_name}</span>
                              {status === "NO_OMIE_ID" ? (
                                <span className="font-mono text-orange-400 font-bold text-xs">Sem integração Omie</span>
                              ) : status === "ERROR" ? (
                                <span className="font-mono text-red-400 font-bold text-xs truncate" title={stockData.error}>Erro: {stockData.error}</span>
                              ) : (
                                <span className="font-mono text-red-400 font-bold text-lg">{formatWeight(stock)} Kg</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-emerald-500/20 rounded-full">
                        <CheckCircle2 size={24} className="text-emerald-400" />
                      </div>
                      <div>
                        <p className="font-bold text-emerald-400 text-base">Saldos Validados com Sucesso!</p>
                        <p className="text-sm text-emerald-400/80">Nenhum estoque negativo encontrado. O lançamento de rateio está liberado.</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <div className="mt-8 flex justify-end">
              <button 
                onClick={handleExport}
                disabled={exporting || !stocksVerified || hasNegativeStocks}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-10 py-4 rounded-xl font-bold flex items-center gap-3 shadow-xl shadow-emerald-600/20 transition-all text-lg"
              >
                {exporting ? 'Comunicando Omie...' : 'Lançar Rateio e Custeio'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- [BLOCO: ABA 4 - Histórico e Reversão] ---
function HistoryTab({ token, onTaskStart, refreshCounter }) {
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadHistorico = async () => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:8000/api/boning/snapshots/historico', { headers: { 'Authorization': `Bearer ${token}` } });
      const data = await res.json();
      setSnapshots(Array.isArray(data) ? data : (data.snapshots || []));
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadHistorico();
  }, [refreshCounter]);

  const handleRevert = async (snap) => {
    if (!window.confirm(`Tem certeza que deseja reverter e EXCLUIR TODOS OS LANÇAMENTOS da Omie vinculados ao snapshot ID ${snap.id}?`)) return;

    try {
      const res = await fetch(`http://localhost:8000/api/boning/revert-snapshot/${snap.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && data.task_id) {
        onTaskStart(data.task_id, 'Revertendo Rateio', 'desossa');
      } else if (res.status === 409 && data.task_id) {
        onTaskStart(data.task_id, 'Revertendo Rateio', 'desossa', 'duplicate', data.detail || "Ação em andamento");
      } else {
        onTaskStart(`err-${Date.now()}`, 'Erro ao reverter', null, 'error', data.detail || "Falha desconhecida");
      }
    } catch (e) {
      onTaskStart(`err-${Date.now()}`, 'Erro na comunicação', null, 'error', e.message);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="text-xl font-bold">Histórico de Rateio e Correções</h3>
          <p className="text-sm text-slate-400">Reverta lançamentos importados indevidamente para a Omie.</p>
        </div>
        <button onClick={loadHistorico} disabled={loading} className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg font-medium">
          {loading ? 'Atualizando...' : 'Atualizar Histórico'}
        </button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
        <table className="w-full text-left">
          <thead className="bg-slate-800 text-slate-400 text-sm">
            <tr>
              <th className="px-6 py-4 font-semibold">ID</th>
              <th className="px-6 py-4 font-semibold">Operação</th>
              <th className="px-6 py-4 font-semibold">Data Referência</th>
              <th className="px-6 py-4 font-semibold text-center">Nº Lançamentos</th>
              <th className="px-6 py-4 font-semibold text-right">Gerado Em</th>
              <th className="px-6 py-4 font-semibold text-right">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {snapshots.map(s => (
              <tr key={s.id} className="hover:bg-slate-800/50 transition-colors text-sm">
                <td className="px-6 py-4 text-slate-300 font-bold">#{s.id}</td>
                <td className="px-6 py-4 font-bold text-indigo-400">{s.tipo}</td>
                <td className="px-6 py-4 text-slate-300">{s.data_referencia}</td>
                <td className="px-6 py-4 text-center text-slate-300">
                  <span className="bg-slate-800 px-2 py-1 rounded text-xs font-bold">{s.quantidade_lancamentos} regs</span>
                </td>
                <td className="px-6 py-4 text-slate-500 text-right">{s.created_at}</td>
                <td className="px-6 py-4 text-right">
                  <button 
                    onClick={() => handleRevert(s)}
                    disabled={loading}
                    className="bg-red-500/10 border border-red-500/20 text-red-500 hover:bg-red-500 hover:text-white px-3 py-1.5 rounded font-bold text-xs transition-colors disabled:opacity-50"
                  >
                    Reverter Lançamentos
                  </button>
                </td>
              </tr>
            ))}
            {snapshots.length === 0 && (
              <tr>
                <td colSpan="6" className="px-6 py-10 text-center text-slate-500 font-medium">Nenhum histórico encontrado para este módulo.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
