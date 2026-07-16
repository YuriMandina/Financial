import React, { useState, useEffect, useMemo } from 'react';
import { Download, Calculator, FileText, CheckCircle2, Settings, List, Plus, Trash2, Edit2 } from 'lucide-react';

export default function RateioECusteio({ token }) {
  const [activeTab, setActiveTab] = useState('sync');
  
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
      </div>

      {activeTab === 'sync' && <SyncTab token={token} />}
      {activeTab === 'templates' && <TemplatesTab token={token} />}
      {activeTab === 'operacao' && <OperationTab token={token} />}
    </div>
  );
}

// --- [BLOCO: Sincronização Omie] ---
function SyncTab({ token }) {
  const [products, setProducts] = useState([]);
  const [families, setFamilies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedFamily, setSelectedFamily] = useState('');
  const [activeView, setActiveView] = useState('families');

  useEffect(() => { loadData(); }, []);

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
    setLoading(true);
    try {
      const res = await fetch('http://localhost:8000/api/boning/sync-omie', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Erro interno no servidor');
      }
      await loadData();
      alert('Sincronização concluída!');
    } catch (e) { 
      console.error(e);
      alert('Falha ao sincronizar: ' + e.message);
    }
    setLoading(false);
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
            <button onClick={handleSync} disabled={loading} className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2">
              {loading ? 'Sincronizando...' : <><Download size={18}/> Sincronizar Omie</>}
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
                  <th className="p-4 font-semibold">Produto</th>
                  <th className="p-4 font-semibold">Família</th>
                  <th className="p-4 font-semibold">Preço Venda Atual</th>
                  <th className="p-4 font-semibold text-center w-48">Corte Padrão?</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {filteredProducts.map(p => (
                  <tr key={p.id} className="hover:bg-slate-700/50 transition-colors">
                    <td className="p-4 font-medium">{p.name}</td>
                    <td className="p-4 text-slate-300">{p.family_name}</td>
                    <td className="p-4 text-emerald-400">R$ {p.unit_price.toFixed(2)}</td>
                    <td className="p-4 text-center">
                      <input type="checkbox" checked={p.is_standard_cut} onChange={() => toggleStandard(p.id)} className="w-5 h-5 accent-indigo-500 cursor-pointer" />
                    </td>
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
  const [newTemplateItems, setNewTemplateItems] = useState([]);

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

  const addItem = () => {
    setNewTemplateItems([...newTemplateItems, { product_id: '', expected_yield_percentage: '' }]);
  };

  const updateItem = (index, field, value) => {
    const updated = [...newTemplateItems];
    updated[index][field] = value;
    setNewTemplateItems(updated);
  };

  const removeItem = (index) => {
    const updated = [...newTemplateItems];
    updated.splice(index, 1);
    setNewTemplateItems(updated);
  };

  const handleSave = async () => {
    const totalYield = newTemplateItems.reduce((acc, curr) => acc + Number(curr.expected_yield_percentage), 0);
    if (totalYield > 100) return alert('A soma dos rendimentos não pode ser maior que 100%');
    if (!newTemplateName) return alert('Dê um nome ao padrão de rendimento');
    if (!newTemplateFamily) return alert('Selecione uma família para o padrão');
    if (newTemplateItems.length === 0) return alert('Adicione pelo menos um corte');

    const schema = {
      name: newTemplateName,
      family_id: Number(newTemplateFamily),
      items: newTemplateItems.map(i => ({ product_id: Number(i.product_id), expected_yield_percentage: Number(i.expected_yield_percentage) }))
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
    setNewTemplateItems(template.items.map(i => ({
      product_id: i.product_id.toString(),
      expected_yield_percentage: i.expected_yield_percentage.toString()
    })));
    setCreating(true);
  };

  const cancelForm = () => {
    setCreating(false);
    setEditingTemplateId(null);
    setNewTemplateName('');
    setNewTemplateFamily('');
    setNewTemplateItems([]);
  };

  const deleteTemplate = async (id) => {
    if (!confirm('Excluir padrão de rendimento?')) return;
    try {
      await fetch(`http://localhost:8000/api/boning/templates/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
      loadData();
    } catch (e) { console.error(e); }
  };

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
          <div className="space-y-3 mb-4">
            {newTemplateItems.map((item, idx) => (
              <div key={idx} className="flex gap-4 items-center">
                <select value={item.product_id} onChange={e => updateItem(idx, 'product_id', e.target.value)} className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white">
                  <option value="">Selecione o Corte Padrão...</option>
                  {products.filter(p => !newTemplateFamily || p.family_id === Number(newTemplateFamily)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input type="number" step="0.01" placeholder="Rendimento (%)" value={item.expected_yield_percentage} onChange={e => updateItem(idx, 'expected_yield_percentage', e.target.value)} className="w-40 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white" />
                <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-300"><Trash2 size={18}/></button>
              </div>
            ))}
          </div>
          <div className="flex justify-between items-center border-t border-slate-700 pt-4 mt-6">
             <button onClick={addItem} className="text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1"><Plus size={18}/> Adicionar Corte</button>
             <div className="text-right">
                <p className="text-sm text-slate-400">Total Alocado</p>
                <p className={`text-xl font-bold ${newTemplateItems.reduce((a,c) => a + Number(c.expected_yield_percentage), 0) > 100 ? 'text-red-400' : 'text-emerald-400'}`}>
                   {newTemplateItems.reduce((a,c) => a + Number(c.expected_yield_percentage), 0).toFixed(2)}%
                </p>
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
            <div className="mt-4 pt-3 border-t border-slate-700 text-right font-bold text-slate-400 text-sm">
              Total do Padrão: {t.items.reduce((a,c) => a + c.expected_yield_percentage, 0).toFixed(2)}%
            </div>
          </div>
        ))}
        {templates.length === 0 && !creating && <p className="text-slate-500 col-span-full py-8 text-center">Nenhum template cadastrado.</p>}
      </div>
    </div>
  );
}

// --- [BLOCO: ABA 3 - Novo Rateio] ---
function OperationTab({ token }) {
  const [mode, setMode] = useState('TEMPLATE'); // 'MANUAL' or 'TEMPLATE'
  const [carcassWeight, setCarcassWeight] = useState('');
  const [carcassCost, setCarcassCost] = useState('');
  
  const [templates, setTemplates] = useState([]);
  const [products, setProducts] = useState([]);
  
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [manualCuts, setManualCuts] = useState([]);

  const [calculationResult, setCalculationResult] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { loadData(); }, []);

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

  const activeTemplate = useMemo(() => templates.find(t => t.id === Number(selectedTemplate)), [templates, selectedTemplate]);

  // Se for modo padrão, recálculo visual das estimativas baseado no peso da carcaça preenchido
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

  const handleExport = async () => {
    if (!calculationResult) return;
    setExporting(true);
    try {
      const res = await fetch(`http://localhost:8000/api/boning/process/${calculationResult.process_id}/export-cmc`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        alert('Custo Médio (CMC) atualizado com sucesso no cadastro dos produtos no Omie!');
      } else {
        const err = await res.json();
        alert('Erros ao exportar: ' + JSON.stringify(err.detail));
      }
    } catch(e) { console.error(e); }
    setExporting(false);
  };

  return (
    <div className="flex flex-col xl:flex-row gap-6">
      {/* PAINEL DE INPUT E SELEÇÃO DE MODO */}
      <div className="w-full xl:w-1/3 bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-xl flex flex-col">
        <h3 className="text-xl font-bold mb-4 text-white">Configuração do Rateio</h3>
        <div className="flex bg-slate-900 rounded-lg p-1 mb-6">
          <button 
            onClick={() => {setMode('TEMPLATE'); setCalculationResult(null);}} 
            className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${mode === 'TEMPLATE' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Modo Padrão (Template)
          </button>
          <button 
            onClick={() => {setMode('MANUAL'); setCalculationResult(null);}} 
            className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${mode === 'MANUAL' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Modo Manual
          </button>
        </div>

        <div className="space-y-4 flex-1">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Peso Total da Carcaça (Kg)</label>
            <input type="number" step="0.01" value={carcassWeight} onChange={e => setCarcassWeight(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white font-mono text-lg focus:border-indigo-500" placeholder="Ex: 300.00" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Valor de Compra por Quilo (R$/Kg)</label>
            <input type="number" step="0.01" value={carcassCost} onChange={e => setCarcassCost(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white font-mono text-lg text-emerald-400 focus:border-indigo-500" placeholder="Ex: 10.00" />
            {(carcassWeight && carcassCost) && (
              <p className="text-right text-xs mt-1 text-slate-500">Custo Total da Carcaça: <span className="font-bold text-emerald-400">R$ {(Number(carcassWeight)*Number(carcassCost)).toFixed(2)}</span></p>
            )}
          </div>

          <div className="pt-4 border-t border-slate-700 mt-6">
            {mode === 'TEMPLATE' ? (
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Template de Rendimento</label>
                <select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)} className="w-full bg-slate-900 border border-indigo-500/30 rounded-lg px-4 py-3 text-indigo-300 font-bold focus:border-indigo-500">
                  <option value="">Selecione...</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                
                {/* LÓGICA REATIVA: GRID PREENCHIDA AUTOMATICAMENTE SE MODO PADRÃO E PESO PREENCHIDO */}
                {derivedCuts.length > 0 && (
                  <div className="mt-4 bg-slate-900/50 p-4 rounded-lg border border-slate-700/50">
                    <p className="text-xs font-semibold text-slate-500 mb-2 uppercase">Preenchimento Automático (Pesos Calculados):</p>
                    {derivedCuts.map((dc, idx) => (
                      <div key={idx} className="flex justify-between text-sm mb-1 bg-slate-900 p-2 rounded">
                        <span className="text-slate-300">{dc.name}</span>
                        <span className="font-mono text-indigo-300 font-bold">{dc.expected_weight} Kg</span>
                      </div>
                    ))}
                  </div>
                )}
                {activeTemplate && !carcassWeight && (
                  <p className="text-xs text-orange-400 mt-2">Informe o Peso da Carcaça para ver o preenchimento automático.</p>
                )}
              </div>
            ) : (
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-medium text-slate-400">Cortes Gerados (Lançamento Manual)</label>
                  <button onClick={addManualCut} className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-white font-bold">+ Adicionar</button>
                </div>
                {/* LÓGICA REATIVA: INPUTS LIVRES PARA DIGITAÇÃO NO MODO MANUAL */}
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {manualCuts.map((mc, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <select value={mc.product_id} onChange={e => updateManualCut(idx, 'product_id', e.target.value)} className="flex-1 bg-slate-900 border border-slate-700 rounded-md px-2 py-2 text-sm text-white focus:border-indigo-500">
                        <option value="">Selecione o Corte...</option>
                        {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <input type="number" step="0.01" placeholder="Peso (Kg)" value={mc.actual_weight} onChange={e => updateManualCut(idx, 'actual_weight', e.target.value)} className="w-24 bg-slate-900 border border-slate-700 rounded-md px-2 py-2 text-sm font-mono text-white focus:border-indigo-500" />
                      <button onClick={() => removeManualCut(idx)} className="text-red-400 hover:text-red-300"><Trash2 size={16}/></button>
                    </div>
                  ))}
                  {manualCuts.length === 0 && <p className="text-xs text-slate-500 italic text-center py-4">Nenhum corte adicionado manualmente.</p>}
                </div>
              </div>
            )}
          </div>
        </div>
        
        <button onClick={handleCalculate} className="mt-6 w-full bg-indigo-600 hover:bg-indigo-500 text-white py-4 rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2 transition-all">
          <Calculator size={20} /> Executar Motor de Cálculo
        </button>
      </div>

      {/* PAINEL DE RESULTADOS (MOTOR MATEMÁTICO) */}
      <div className="w-full xl:w-2/3 bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-xl flex flex-col">
        <h3 className="text-xl font-bold mb-6 text-white flex items-center gap-2"><CheckCircle2 className="text-emerald-500" /> Painel de Resultados (Custeio Conjunto)</h3>
        
        {!calculationResult ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 opacity-50">
            <Calculator size={64} className="mb-4" />
            <p className="text-lg font-medium text-center">Preencha a configuração e execute o cálculo<br/>para visualizar o rateio por preço de venda.</p>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
               <div className="bg-slate-900 p-4 rounded-lg border border-slate-700">
                 <p className="text-xs text-slate-400">Total Desossado (Carcaça)</p>
                 <p className="text-xl font-mono text-white">{calculationResult.total_carcass_weight.toFixed(2)} Kg</p>
               </div>
               <div className="bg-slate-900 p-4 rounded-lg border border-slate-700">
                 <p className="text-xs text-slate-400">Custo Total Alocado</p>
                 <p className="text-xl font-mono text-red-400">R$ {calculationResult.total_carcass_cost.toFixed(2)}</p>
               </div>
               <div className="bg-slate-900 p-4 rounded-lg border border-slate-700">
                 <p className="text-xs text-slate-400">VPL Total (Desossa)</p>
                 <p className="text-xl font-mono text-indigo-400">R$ {calculationResult.total_vpl.toFixed(2)}</p>
               </div>
               <div className="bg-slate-900 p-4 rounded-lg border border-slate-700">
                 <p className="text-xs text-slate-400">Quebra (Não Rateada)</p>
                 <p className="text-xl font-mono text-orange-400">{calculationResult.loss_weight.toFixed(2)} Kg</p>
               </div>
            </div>

            <div className="overflow-x-auto flex-1 border border-slate-700 rounded-lg max-h-[50vh]">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-900 text-slate-400 sticky top-0 shadow">
                  <tr>
                    <th className="p-3">Corte Gerado</th>
                    <th className="p-3 text-right">Peso Real (Kg)</th>
                    <th className="p-3 text-right">Preço de Venda</th>
                    <th className="p-3 text-right">VPL (Potencial)</th>
                    <th className="p-3 text-right">Participação no Faturamento</th>
                    <th className="p-3 text-right">Custo Rateado</th>
                    <th className="p-3 text-right bg-emerald-900/20 text-emerald-400">Custo Unitário Final (CMC)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {calculationResult.items.map(i => (
                    <tr key={i.product_id} className="hover:bg-slate-700/30">
                      <td className="p-3 font-medium text-white">{i.product_name}</td>
                      <td className="p-3 text-right font-mono text-slate-300">{i.actual_weight.toFixed(2)}</td>
                      <td className="p-3 text-right font-mono text-slate-400">R$ {i.unit_price.toFixed(2)}</td>
                      <td className="p-3 text-right font-mono text-indigo-300 font-medium">R$ {i.vpl.toFixed(2)}</td>
                      <td className="p-3 text-right font-mono text-amber-300 font-medium">{i.participation_percentage.toFixed(2)}%</td>
                      <td className="p-3 text-right font-mono text-red-300">R$ {i.allocated_cost.toFixed(2)}</td>
                      <td className="p-3 text-right font-mono text-emerald-400 bg-emerald-900/10 font-bold text-base">R$ {i.unit_cost.toFixed(2)} / Kg</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="mt-6 flex justify-end">
              <button 
                onClick={handleExport}
                disabled={exporting}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-bold flex items-center gap-2 shadow-lg transition-all"
              >
                {exporting ? 'Comunicando Omie...' : 'Atualizar Custo (CMC) no ERP Omie'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
