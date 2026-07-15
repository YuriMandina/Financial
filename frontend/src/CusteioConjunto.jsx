import React, { useState, useMemo, useEffect } from 'react';
import { Loader2, Calculator, Settings, ArrowDownToLine, Save, RotateCcw, TrendingUp } from 'lucide-react';
import DateRangePicker from './DateRangePicker';

export function CusteioConjunto({ token, currentOrgId }) {
  const [familias, setFamilias] = useState([]);
  const [familiaSelecionada, setFamiliaSelecionada] = useState('');
  const [produtos, setProdutos] = useState([]);
  const [carregandoFamilias, setCarregandoFamilias] = useState(false);
  const [carregandoProdutos, setCarregandoProdutos] = useState(false);

  const [dataInicial, setDataInicial] = useState('');
  const [dataFinal, setDataFinal] = useState('');
  const [carregandoAbc, setCarregandoAbc] = useState(false);
  const [dadosAbc, setDadosAbc] = useState({});

  const [selecionados, setSelecionados] = useState({});
  const [custoTotal, setCustoTotal] = useState(0);

  const [historico, setHistorico] = useState([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);

  useEffect(() => {
    if (!token) return;
    setCarregandoFamilias(true);
    fetch(`http://localhost:8000/api/produtos/familias`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        setFamilias(data.familias || []);
        setCarregandoFamilias(false);
      })
      .catch(err => {
        console.error(err);
        setCarregandoFamilias(false);
      });

    carregarHistorico();
  }, [token]);

  const carregarHistorico = () => {
    setCarregandoHistorico(true);
    fetch(`http://localhost:8000/api/produtos/custeio/historico`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        setHistorico(data.historico || []);
        setCarregandoHistorico(false);
      })
      .catch(err => {
        console.error(err);
        setCarregandoHistorico(false);
      });
  };

  useEffect(() => {
    if (!familiaSelecionada) {
      setProdutos([]);
      return;
    }
    setCarregandoProdutos(true);
    fetch(`http://localhost:8000/api/produtos?familia_id=${familiaSelecionada}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        const prods = data.produtos || [];
        setProdutos(prods);

        if (Object.keys(dadosAbc).length > 0) {
          const novo = {};
          prods.forEach(p => {
            const desc = p.descricao?.trim().toUpperCase();
            if (desc && dadosAbc[desc] && dadosAbc[desc].qtd_total > 0) {
              novo[p.produto_id] = { selecionado: true, qtd_produzida: dadosAbc[desc].qtd_total };
            }
          });
          setSelecionados(novo);
        } else {
          setSelecionados({});
        }
        setCarregandoProdutos(false);
      })
      .catch(err => {
        console.error(err);
        setCarregandoProdutos(false);
      });
  }, [familiaSelecionada, token]);

  const carregarDadosAbc = () => {
    if (!dataInicial || !dataFinal) return alert("Selecione data inicial e final");
    setCarregandoAbc(true);
    fetch(`http://localhost:8000/api/relatorios/curva-abc/dados?data_inicio=${dataInicial}&data_fim=${dataFinal}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        const mapAbc = {};
        if (data.itens) {
          data.itens.forEach(item => {
            mapAbc[item.descricao_produto.trim().toUpperCase()] = {
              qtd_total: item.quantidade,
              media_valor_venda: item.media_valor_venda
            };
          });
        }
        setDadosAbc(mapAbc);

        setSelecionados(prev => {
          const novo = { ...prev };
          produtos.forEach(p => {
            const desc = p.descricao?.trim().toUpperCase();
            if (desc && mapAbc[desc] && mapAbc[desc].qtd_total > 0) {
              novo[p.produto_id] = { selecionado: true, qtd_produzida: mapAbc[desc].qtd_total };
            }
          });
          return novo;
        });
        alert("Quantidades vendidas sincronizadas com sucesso!");
        setCarregandoAbc(false);
      })
      .catch(err => {
        console.error(err);
        setCarregandoAbc(false);
      });
  };

  const handleSelecionar = (prodId) => {
    setSelecionados(prev => {
      if (prev[prodId]) {
        const novo = { ...prev };
        delete novo[prodId];
        return novo;
      } else {
        const prod = produtos.find(p => p.produto_id === prodId);
        const prodDesc = prod?.descricao?.trim().toUpperCase();
        let qtd = 1;
        if (dadosAbc[prodDesc]) qtd = dadosAbc[prodDesc].qtd_total;

        return {
          ...prev,
          [prodId]: {
            selecionado: true,
            qtd_produzida: qtd
          }
        };
      }
    });
  };

  const handleMudarQtd = (prodId, val) => {
    setSelecionados(prev => ({
      ...prev,
      [prodId]: { ...prev[prodId], qtd_produzida: parseFloat(val) || 0 }
    }));
  };

  const produtosComSimulacao = useMemo(() => {
    let valorMercadoTotal = 0;
    produtos.forEach(p => {
      if (selecionados[p.produto_id]) {
        const qtd = selecionados[p.produto_id].qtd_produzida || 0;
        valorMercadoTotal += (p.valor_venda * qtd);
      }
    });

    return produtos.map(p => {
      const isSelected = !!selecionados[p.produto_id];
      const qtd = isSelected ? (selecionados[p.produto_id].qtd_produzida || 0) : 0;
      const valorMercadoItem = p.valor_venda * qtd;
      const proporcao = valorMercadoTotal > 0 ? (valorMercadoItem / valorMercadoTotal) : 0;

      const custoAtribuido = custoTotal * proporcao;
      const novoCustoKg = qtd > 0 ? (custoAtribuido / qtd) : p.custo_atual;

      return {
        ...p,
        isSelected,
        qtd,
        valorMercadoItem,
        proporcao: proporcao * 100,
        novoCustoKg
      };
    });
  }, [produtos, selecionados, custoTotal]);

  const handleSalvar = () => {
    const payload = produtosComSimulacao.filter(p => p.isSelected).map(p => ({
      produto_id: parseInt(p.produto_id),
      codigo_produto: p.codigo,
      descricao: p.descricao,
      custo_antigo: p.custo_atual,
      custo_novo: p.novoCustoKg,
      quantidade_utilizada: p.qtd,
      valor_mercado_unitario: p.valor_venda
    }));

    if (payload.length === 0) return alert("Selecione pelo menos um produto.");

    fetch(`http://localhost:8000/api/produtos/custeio`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ produtos: payload })
    })
      .then(res => res.json())
      .then(data => {
        alert("Simulação salva! Verifique o Histórico para exportar ao Omie.");
        carregarHistorico();
      })
      .catch(console.error);
  };

  const handleExportar = (id) => {
    if (!window.confirm("Isso irá sobrescrever o Custo Médio no Omie. Continuar?")) return;
    fetch(`http://localhost:8000/api/produtos/custeio/${id}/exportar`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        alert("Exportado ao Omie com sucesso!");
        carregarHistorico();
      })
      .catch(err => alert("Erro ao exportar: " + err.message));
  };

  const handleReverter = (id) => {
    if (!window.confirm("Isso retornará o Custo Médio no Omie para o valor anterior. Continuar?")) return;
    fetch(`http://localhost:8000/api/produtos/custeio/${id}/reverter`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        alert("Revertido no Omie com sucesso!");
        carregarHistorico();
      })
      .catch(err => alert("Erro ao reverter: " + err.message));
  };

  return (
    <div className="flex-1 p-8 z-10 overflow-y-auto animate-[fadeIn_0.5s_ease-out]">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center border border-slate-700">
            <Calculator size={24} className="text-slate-300" />
          </div>
          <div>
            <h2 className="text-3xl font-bold text-white mb-1">Custeio Conjunto</h2>
            <p className="text-slate-400">Rateio de custos baseado em Valor de Mercado</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* Painel ABC */}
        <div className="bg-slate-900/80 border border-white/[0.05] rounded-2xl p-6 shadow-sm">
          <label className="block text-sm font-semibold mb-4 text-slate-300">Sincronizar Quantidades</label>
          <div className="flex flex-col gap-4">
            <DateRangePicker
              startValue={dataInicial}
              endValue={dataFinal}
              onStartChange={setDataInicial}
              onEndChange={setDataFinal}
              disabled={carregandoAbc}
            />
            <button
              onClick={carregarDadosAbc}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg flex items-center justify-center gap-2 transition-colors border border-indigo-500/50 font-medium"
              disabled={carregandoAbc}
            >
              {carregandoAbc ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />} Sincronizar
            </button>
          </div>
        </div>

        {/* Painel Família */}
        <div className="bg-slate-900/80 border border-white/[0.05] rounded-2xl p-6 shadow-sm">
          <label className="block text-sm font-semibold mb-4 text-slate-300">Família de Produtos</label>
          {carregandoFamilias ? (
            <div className="text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</div>
          ) : (
            <select
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-slate-300 focus:outline-none focus:border-indigo-500 transition-colors"
              value={familiaSelecionada}
              onChange={(e) => setFamiliaSelecionada(e.target.value)}
            >
              <option value="">-- Selecione uma família --</option>
              {familias.map(f => (
                <option key={f.codigo} value={f.codigo}>{f.nome}</option>
              ))}
            </select>
          )}
        </div>

        {/* Painel Custo */}
        <div className="bg-slate-900/80 border border-white/[0.05] rounded-2xl p-6 shadow-sm">
          <label className="block text-sm font-semibold mb-4 text-slate-300">Custo Conjunto Total (R$)</label>
          <input
            type="number"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-2xl font-bold text-white focus:outline-none focus:border-indigo-500 transition-colors"
            value={custoTotal}
            onChange={(e) => setCustoTotal(parseFloat(e.target.value) || 0)}
            placeholder="0.00"
          />
        </div>
      </div>

      <div className="bg-slate-900/80 border border-white/[0.05] rounded-2xl overflow-hidden mb-8 shadow-sm">
        <div className="p-5 border-b border-white/[0.05]">
          <h2 className="font-bold text-slate-200 text-lg">Produtos para Rateio</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead>
              <tr className="bg-slate-800/30 text-slate-400 text-xs font-bold border-b border-slate-700/50 uppercase tracking-wider">
                <th className="py-4 px-5 w-10">Sel</th>
                <th className="py-4 px-5">Produto</th>
                <th className="py-4 px-5 text-right">Preço Venda (R$)</th>
                <th className="py-4 px-5 text-center">Qtd Vendida</th>
                <th className="py-4 px-5 text-right">CMC Atual</th>
                <th className="py-4 px-5 text-right">Peso %</th>
                <th className="py-4 px-5 text-right text-indigo-400">CMC Simulado</th>
              </tr>
            </thead>
            <tbody>
              {carregandoProdutos && <tr><td colSpan="7" className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-500" /></td></tr>}
              {!carregandoProdutos && produtosComSimulacao.map(p => (
                <tr key={p.produto_id} className={`border-b border-slate-700/30 hover:bg-slate-800/50 transition-colors ${p.isSelected ? 'bg-indigo-900/10' : ''}`}>
                  <td className="py-3 px-5">
                    <input
                      type="checkbox"
                      checked={p.isSelected}
                      onChange={() => handleSelecionar(p.produto_id)}
                      className="w-4 h-4 rounded bg-slate-800 border-slate-600 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-900"
                    />
                  </td>
                  <td className="py-3 px-5">
                    <div className="font-medium text-slate-200">{p.descricao}</div>
                    <div className="text-xs text-slate-500">{p.codigo}</div>
                  </td>
                  <td className="py-3 px-5 text-right text-slate-300">{p.valor_venda.toFixed(2)}</td>
                  <td className="py-3 px-5 text-center">
                    {p.isSelected ? (
                      <input
                        type="number"
                        value={p.qtd}
                        onChange={(e) => handleMudarQtd(p.produto_id, e.target.value)}
                        className="w-24 bg-slate-800 border border-slate-600 rounded p-1 text-center text-slate-200 focus:outline-none focus:border-indigo-500"
                      />
                    ) : <span className="text-slate-600">-</span>}
                  </td>
                  <td className="py-3 px-5 text-right text-slate-400">{p.custo_atual.toFixed(2)}</td>
                  <td className="py-3 px-5 text-right text-slate-300">{p.isSelected ? p.proporcao.toFixed(2) + '%' : <span className="text-slate-600">-</span>}</td>
                  <td className="py-3 px-5 text-right font-bold text-indigo-400">
                    {p.isSelected ? p.novoCustoKg.toFixed(2) : <span className="text-slate-600">-</span>}
                  </td>
                </tr>
              ))}
              {produtos.length === 0 && !carregandoProdutos && (
                <tr><td colSpan="7" className="p-12 text-center text-slate-500">Selecione uma família para carregar os produtos.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="p-5 border-t border-white/[0.05] flex justify-end bg-slate-800/20">
          <button
            onClick={handleSalvar}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-lg font-bold flex items-center gap-2 transition-colors border border-indigo-500/50 shadow-lg shadow-indigo-900/20"
          >
            <Save className="w-4 h-4" /> Salvar Simulação
          </button>
        </div>
      </div>

      <div className="bg-slate-900/80 border border-white/[0.05] rounded-2xl overflow-hidden shadow-sm">
        <div className="p-5 border-b border-white/[0.05] flex justify-between items-center">
          <h2 className="font-bold text-slate-200 text-lg">Histórico de Rateios Salvos</h2>
          <button onClick={carregarHistorico} className="text-slate-400 hover:text-white" title="Atualizar Histórico">
            <RotateCcw className={`w-4 h-4 ${carregandoHistorico ? 'animate-spin text-indigo-400' : ''}`} />
          </button>
        </div>
        <div className="overflow-x-auto p-4">
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead>
              <tr className="text-slate-400 text-xs font-bold border-b border-slate-700/50 uppercase tracking-wider">
                <th className="py-3 px-4">Data</th>
                <th className="py-3 px-4">Produto</th>
                <th className="py-3 px-4">Antigo -&gt; Novo</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Ações Omie</th>
              </tr>
            </thead>
            <tbody>
              {historico.length === 0 && !carregandoHistorico && (
                <tr><td colSpan="5" className="p-8 text-center text-slate-500">Nenhum histórico encontrado.</td></tr>
              )}
              {historico.map(h => (
                <tr key={h.id} className="border-b border-slate-700/30 hover:bg-slate-800/50 transition-colors">
                  <td className="py-3 px-4 text-slate-400 text-sm">{new Date(h.created_at).toLocaleString()}</td>
                  <td className="py-3 px-4 text-slate-200 font-medium">{h.descricao}</td>
                  <td className="py-3 px-4 text-slate-300">R$ {h.custo_antigo.toFixed(2)} <span className="text-slate-500 mx-1">-&gt;</span> <span className="font-bold text-indigo-400">R$ {h.custo_novo.toFixed(2)}</span></td>
                  <td className="py-3 px-4 text-center">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${h.status === 'EXPORTED' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                        h.status === 'REVERTED' ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20' :
                          'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      }`}>
                      {h.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 flex justify-end gap-2">
                    {h.status === 'PENDING' && (
                      <button onClick={() => handleExportar(h.id)} className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors">
                        <ArrowDownToLine className="w-3.5 h-3.5" /> Exportar
                      </button>
                    )}
                    {h.status === 'EXPORTED' && (
                      <button onClick={() => handleReverter(h.id)} className="bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors">
                        <RotateCcw className="w-3.5 h-3.5" /> Reverter
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
