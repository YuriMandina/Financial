import React, { useState, useEffect } from 'react';
import { Loader2, DollarSign, ArrowUpCircle, ArrowDownCircle, Target } from 'lucide-react';
import DateRangePicker from '../../components/common/DateRangePicker';
import ProgressModal from '../../components/common/ProgressModal';

export const DreGerencial = ({ token, onTaskStart, refreshCounter }) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [dataInicio, setDataInicio] = useState(() => sessionStorage.getItem('dre_dataInicio') || '');
  const [dataFim, setDataFim] = useState(() => sessionStorage.getItem('dre_dataFim') || '');

  useEffect(() => {
    if (dataInicio) sessionStorage.setItem('dre_dataInicio', dataInicio);
    if (dataFim) sessionStorage.setItem('dre_dataFim', dataFim);
  }, [dataInicio, dataFim]);

  useEffect(() => {
    if (refreshCounter > 0 && dataInicio && dataFim) {
      fetchDre(false);
    }
  }, [refreshCounter]);

  const fetchDre = async (isSync = false) => {
    setLoading(true);
    setError('');

    if (isSync) {
        try {
            const res = await fetch(`http://localhost:8000/api/relatorios/dre/sync`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ data_inicio: dataInicio, data_fim: dataFim })
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.detail || 'Erro ao sincronizar DRE');
            
            if (onTaskStart) onTaskStart(json.task_id, 'Sincronizando DRE', 'dre-gerencial');
            return;
        } catch (err) {
            if (onTaskStart) {
                onTaskStart(`err-${Date.now()}`, 'Erro na Sincronização', null, 'error', err.message);
            } else {
                alert(`Erro: ${err.message}`);
            }
            setLoading(false);
            return;
        }
    }



    try {
      const res = await fetch(`http://localhost:8000/api/relatorios/dre/dados?data_inicio=${dataInicio}&data_fim=${dataFim}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || 'Erro ao sincronizar DRE');
      setData(json);
    } catch (err) {
      setError(err.message);
      setSyncModalState({ active: true, status: 'error', text: `Erro: ${err.message}`, title: 'Erro ao sincronizar DRE' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (dataInicio && dataFim) {
      fetchDre();
    }
  }, []);

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
  };

  return (
    <div className="flex-1 p-8 z-10 overflow-y-auto">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center border border-slate-700">
            <Target size={24} className="text-slate-300" />
          </div>
          <div>
            <h2 className="text-3xl font-bold text-white mb-1">DRE Gerencial</h2>
            <p className="text-slate-400">Demonstrativo de Resultado do Exercício por Data de Emissão</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4 bg-slate-900/80 border border-white/[0.05] p-3 rounded-2xl">
          <DateRangePicker 
            startValue={dataInicio} 
            endValue={dataFim} 
            onStartChange={setDataInicio} 
            onEndChange={setDataFim} 
          />
          <button 
            onClick={() => fetchDre(true)}
            disabled={loading || !dataInicio || !dataFim}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-6 rounded-xl transition flex items-center gap-2 shadow-lg shadow-indigo-500/20 disabled:opacity-50"
          >
            {loading ? <Loader2 size={20} className="animate-spin" /> : <DollarSign size={20} />}
            Sincronizar DRE
          </button>
        </div>
      </div>

      {error && <div className="bg-red-500/10 text-red-400 border border-red-500/20 p-4 rounded-xl mb-6">{error}</div>}

      {data && !loading && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-slate-900/80 border border-white/[0.05] p-6 rounded-2xl">
              <div className="flex items-center gap-3 text-emerald-400 mb-2">
                <ArrowUpCircle size={20} />
                <h3 className="font-bold">Receitas Totais</h3>
              </div>
              <p className="text-3xl font-bold text-white">{formatCurrency(data.totais.receita)}</p>
            </div>
            
            <div className="bg-slate-900/80 border border-white/[0.05] p-6 rounded-2xl">
              <div className="flex items-center gap-3 text-rose-400 mb-2">
                <ArrowDownCircle size={20} />
                <h3 className="font-bold">Despesas Totais</h3>
              </div>
              <p className="text-3xl font-bold text-white">{formatCurrency(data.totais.despesa)}</p>
            </div>

            <div className="bg-slate-900/80 border border-indigo-500/30 p-6 rounded-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <Target size={64} />
              </div>
              <div className="flex items-center gap-3 text-indigo-400 mb-2">
                <Target size={20} />
                <h3 className="font-bold">Lucro / Prejuízo</h3>
              </div>
              <p className={`text-3xl font-bold ${data.totais.lucro >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {formatCurrency(data.totais.lucro)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Receitas */}
            <div className="bg-slate-900/80 border border-white/[0.05] rounded-2xl overflow-hidden">
              <div className="bg-slate-950/50 p-4 border-b border-white/[0.05]">
                <h3 className="font-bold text-emerald-400 flex items-center gap-2">
                  <ArrowUpCircle size={18} />
                  Receitas por Categoria
                </h3>
              </div>
              <div className="p-4 space-y-2">
                {data.receitas.length === 0 ? (
                  <p className="text-slate-500 text-sm p-4 text-center">Nenhuma receita encontrada no período.</p>
                ) : (
                  data.receitas.map((r, i) => (
                    <div key={i} className="flex justify-between items-center p-3 hover:bg-slate-800/50 rounded-xl transition">
                      <span className="text-slate-300 font-medium text-sm">{r.codigo} - {r.categoria}</span>
                      <span className="text-white font-bold">{formatCurrency(r.valor)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Despesas */}
            <div className="bg-slate-900/80 border border-white/[0.05] rounded-2xl overflow-hidden">
              <div className="bg-slate-950/50 p-4 border-b border-white/[0.05]">
                <h3 className="font-bold text-rose-400 flex items-center gap-2">
                  <ArrowDownCircle size={18} />
                  Despesas por Categoria
                </h3>
              </div>
              <div className="p-4 space-y-2">
                {data.despesas.length === 0 ? (
                  <p className="text-slate-500 text-sm p-4 text-center">Nenhuma despesa encontrada no período.</p>
                ) : (
                  data.despesas.map((r, i) => (
                    <div key={i} className="flex justify-between items-center p-3 hover:bg-slate-800/50 rounded-xl transition">
                      <span className="text-slate-300 font-medium text-sm">{r.codigo} - {r.categoria}</span>
                      <span className="text-white font-bold">{formatCurrency(r.valor)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
