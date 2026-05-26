import React, { useState, useMemo, useRef } from 'react';
import html2canvas from 'html2canvas';
import {
  LayoutDashboard, FileText, TrendingUp, Users, Search, CalendarDays,
  Loader2, Database, Printer, Filter, CreditCard, CheckCircle,
  CheckSquare, Square, Calculator, Zap, ArrowDownToLine, ChevronLeft, ChevronRight,
  Receipt, Copy
} from 'lucide-react';

// --- FUNÇÕES GLOBAIS DE FORMATAÇÃO E CÁLCULO ---
const converterDataBrParaDate = (dataStr) => {
  if (!dataStr || dataStr === '-') return new Date(9999, 11, 31);
  const partes = dataStr.split('/');
  return new Date(partes[2], partes[1] - 1, partes[0]);
};

const formatarDataComDia = (dataStr) => {
  if (!dataStr || dataStr === '-') return '-';
  const partes = dataStr.split('/');
  if (partes.length !== 3) return dataStr;
  const d = new Date(partes[2], partes[1] - 1, partes[0]);
  const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  return `${dataStr} - ${dias[d.getDay()]}`;
};

// --- SUBCOMPONENTE: CARD INTELIGENTE DO CLIENTE ---
function CartaoCliente({ grupo, selecionados, toggleSelecao, toggleTodosCliente, abrirModalLote, gerarCobrancaLote }) {
  const [localFiltroInicio, setLocalFiltroInicio] = useState('');
  const [localFiltroFim, setLocalFiltroFim] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'vencimento', direction: 'asc' });

  const contasFiltradas = useMemo(() => {
    let filtradas = grupo.contas;
    if (localFiltroInicio) {
      const inicioDate = new Date(localFiltroInicio + 'T00:00:00');
      filtradas = filtradas.filter(c => converterDataBrParaDate(c.data_previsao_br) >= inicioDate);
    }
    if (localFiltroFim) {
      const fimDate = new Date(localFiltroFim + 'T00:00:00');
      filtradas = filtradas.filter(c => converterDataBrParaDate(c.data_previsao_br) <= fimDate);
    }
    return filtradas;
  }, [grupo.contas, localFiltroInicio, localFiltroFim]);

  const contasOrdenadas = useMemo(() => {
    let ordenadas = [...contasFiltradas];
    ordenadas.sort((a, b) => {
      let aVal, bVal;
      if (sortConfig.key === 'emissao') {
        aVal = converterDataBrParaDate(a.data_emissao).getTime();
        bVal = converterDataBrParaDate(b.data_emissao).getTime();
      } else if (sortConfig.key === 'vencimento') {
        aVal = converterDataBrParaDate(a.data_previsao_br).getTime();
        bVal = converterDataBrParaDate(b.data_previsao_br).getTime();
      } else if (sortConfig.key === 'nota') {
        aVal = a.numero_documento_fiscal || '';
        bVal = b.numero_documento_fiscal || '';
      } else if (sortConfig.key === 'conta') {
        aVal = a.conta_corrente || '';
        bVal = b.conta_corrente || '';
      } else if (sortConfig.key === 'valor') {
        aVal = a.saldo_devedor;
        bVal = b.saldo_devedor;
      }

      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return ordenadas;
  }, [contasFiltradas, sortConfig]);

  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const localSubtotal = contasOrdenadas.reduce((acc, c) => acc + c.saldo_devedor, 0);
  const selecionadasDoCliente = contasOrdenadas.filter(c => selecionados.find(s => s.codigo_lancamento === c.codigo_lancamento));
  const todasSelecionadas = contasOrdenadas.length > 0 && contasOrdenadas.every(c => selecionados.find(s => s.codigo_lancamento === c.codigo_lancamento));
  const valorTotalSelecionado = selecionadasDoCliente.reduce((acc, c) => acc + c.saldo_devedor, 0);

  const HeaderTH = ({ sortKey, label, width, align = "left" }) => (
    <th className={`py-3 px-5 cursor-pointer hover:bg-slate-700/50 transition-colors select-none group ${width} print:w-auto print:min-w-0 text-${align} print:py-1 print:px-2 print:text-[10px]`} onClick={() => handleSort(sortKey)}>
      <div className={`flex items-center gap-2 ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
        <span className="group-hover:text-indigo-300 transition-colors">{label}</span>
        <div className="flex flex-col text-[8px] leading-[8px] mt-0.5">
          <span className={sortConfig.key === sortKey && sortConfig.direction === 'asc' ? 'text-emerald-400 font-black scale-125' : 'text-slate-600'}>▲</span>
          <span className={sortConfig.key === sortKey && sortConfig.direction === 'desc' ? 'text-emerald-400 font-black scale-125' : 'text-slate-600'}>▼</span>
        </div>
      </div>
    </th>
  );

  return (
    <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl print:rounded-none overflow-hidden print:border-slate-300 print:!bg-transparent print:break-inside-avoid shadow-lg relative z-10">
      <div className="bg-slate-900/50 p-6 border-b border-slate-800/80 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 print:bg-slate-100 print:border-slate-300 print:p-2 print:flex-row print:items-center print:gap-2">

        <div className="flex items-center gap-4 print:gap-2 print:flex-1 print:min-w-0">
          <div className="w-12 h-12 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-xl print:border print:border-slate-400 shrink-0 print:w-7 print:h-7 print:text-xs">
            {grupo.dataReferencia.charAt(0)}
          </div>
          <div className="print:min-w-0 print:overflow-hidden">
            <h3 className="text-xl font-bold text-white print:text-slate-900 print:text-sm print:leading-tight print:truncate">{grupo.dataReferencia}</h3>
            <p className="text-slate-400 text-sm font-medium print:text-slate-600 print:text-[10px]">
              {contasOrdenadas.length} títulos listados {grupo.contasOcultas > 0 && `(mais ${grupo.contasOcultas} na busca oculta)`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-slate-950/50 p-1.5 rounded-lg border border-slate-800 print:hidden shrink-0">
          <div className="bg-slate-800/50 px-3 py-2 rounded flex items-center gap-2">
            <CalendarDays size={14} className="text-indigo-400" />
            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Período:</span>
          </div>
          <input type="date" value={localFiltroInicio} onChange={e => setLocalFiltroInicio(e.target.value)} className="bg-transparent text-xs font-medium text-slate-300 outline-none cursor-pointer [color-scheme:dark] px-2" />
          <span className="text-slate-600 text-xs font-black">até</span>
          <input type="date" value={localFiltroFim} onChange={e => setLocalFiltroFim(e.target.value)} className="bg-transparent text-xs font-medium text-slate-300 outline-none cursor-pointer [color-scheme:dark] px-2" />
        </div>

        <div className="text-right shrink-0 print:ml-auto">
          <p className="text-sm text-slate-400 uppercase font-bold print:text-slate-500 print:text-[9px] print:m-0 print:leading-tight">Total Aberto</p>
          <p className="text-2xl font-black text-emerald-400 print:text-slate-900 print:text-sm print:m-0 print:font-bold print:leading-tight">R$ {localSubtotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
        </div>
      </div>

      <div className="overflow-x-auto print:overflow-visible print:w-full">
        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead>
            <tr className="bg-slate-800/30 text-slate-300 print:bg-slate-200 print:text-slate-900 text-xs font-bold border-b border-slate-700/50 print:border-slate-300">
              <th className="py-3 px-5 print:hidden w-10">
                <button onClick={() => toggleTodosCliente(contasOrdenadas)} className="text-slate-400 hover:text-indigo-400" title="Selecionar Todos Visíveis">
                  {todasSelecionadas ? <CheckSquare size={18} className="text-indigo-400" /> : <Square size={18} />}
                </button>
              </th>
              <HeaderTH sortKey="emissao" label="Emissão" width="w-36" />
              <HeaderTH sortKey="vencimento" label="Vencimento" width="w-36" />
              <HeaderTH sortKey="nota" label="Nota / Parcela" width="w-1/4 min-w-[150px]" />
              <HeaderTH sortKey="conta" label="Conta Corrente" width="w-1/3 min-w-[200px]" />
              <HeaderTH sortKey="valor" label="Valor a Receber" width="w-32" align="right" />
            </tr>
          </thead>
          <tbody className="text-sm">
            {contasOrdenadas.length === 0 ? (
              <tr>
                <td colSpan="6" className="py-8 text-center text-slate-500 font-medium bg-slate-900/30">Nenhuma nota atende ao filtro de período atual.</td>
              </tr>
            ) : (
              contasOrdenadas.map((conta, idx) => {
                const taSelecionado = selecionados.find(s => s.codigo_lancamento === conta.codigo_lancamento);
                return (
                  <tr key={conta.codigo_lancamento} className={`border-b border-slate-700/30 print:border-slate-300 ${taSelecionado ? 'bg-indigo-500/5' : 'hover:bg-slate-800/40'} transition-colors ${idx % 2 === 0 ? 'print:bg-white' : 'print:bg-slate-50'}`}>
                    <td className="py-3 px-5 print:hidden cursor-pointer" onClick={() => toggleSelecao(conta)}>
                      {taSelecionado ? <CheckSquare size={18} className="text-indigo-400" /> : <Square size={18} className="text-slate-500" />}
                    </td>
                    <td className="py-3 px-5 text-slate-400 print:text-slate-800 print:py-1 print:px-2 print:text-[10px]">{formatarDataComDia(conta.data_emissao)}</td>
                    <td className="py-3 px-5 font-medium text-slate-300 print:text-slate-800 print:py-1 print:px-2 print:text-[10px]">{formatarDataComDia(conta.data_previsao_br)}</td>
                    <td className="py-3 px-5 text-slate-300 print:text-slate-800 print:py-1 print:px-2 print:text-[10px]">{conta.numero_documento_fiscal} - {conta.numero_parcela}</td>
                    <td className="py-3 px-5 text-slate-400 print:text-slate-600 truncate max-w-[200px] print:max-w-none print:py-1 print:px-2 print:text-[10px]">{conta.conta_corrente}</td>
                    <td className="py-3 px-5 text-right print:py-1 print:px-2 print:text-[10px]">
                      {conta.tem_pagamento_parcial ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-xs text-slate-500 line-through print:text-slate-400">
                            R$ {conta.valor_documento.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </span>
                          <span className="font-bold text-amber-400 print:text-slate-900">
                            R$ {conta.saldo_devedor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </span>
                          <span className="text-[10px] font-semibold text-amber-500/80 bg-amber-500/10 px-1.5 py-0.5 rounded print:hidden">
                            Parcial
                          </span>
                        </div>
                      ) : (
                        <span className="font-bold text-slate-200 print:text-slate-900">
                          R$ {conta.saldo_devedor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="p-4 bg-slate-900/80 border-t border-slate-700/50 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 print:hidden">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-slate-400">
            {selecionadasDoCliente.length} nota(s) selecionada(s)
          </span>
          {selecionadasDoCliente.length > 0 && (
            <span className="text-xl font-black text-indigo-400 mt-1">
              Total Selecionado: R$ {valorTotalSelecionado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-3 w-full lg:w-auto">
          <button
            onClick={() => gerarCobrancaLote(grupo.dataReferencia, contasOrdenadas)}
            disabled={selecionadasDoCliente.length === 0}
            className="flex-1 lg:flex-none bg-slate-800 hover:bg-slate-700 border border-slate-600 disabled:bg-slate-900 disabled:border-slate-800 disabled:text-slate-600 text-slate-200 px-6 py-2.5 rounded-lg font-bold transition-colors flex justify-center items-center gap-2"
          >
            <Receipt size={18} /> GERAR COBRANÇA
          </button>

          <button
            onClick={() => abrirModalLote(grupo.dataReferencia, contasOrdenadas)}
            disabled={selecionadasDoCliente.length === 0}
            className="flex-1 lg:flex-none bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white px-6 py-2.5 rounded-lg font-bold shadow-lg transition-colors flex justify-center items-center gap-2"
          >
            <Calculator size={18} /> INFORMAR PAGAMENTO
          </button>
        </div>
      </div>
    </div>
  );
}

// --- COMPONENTE PRINCIPAL ---
function App() {
  const [dataInicial, setDataInicial] = useState('');
  const [dataFinal, setDataFinal] = useState('');
  const [carregandoTela, setCarregandoTela] = useState(false);
  const [menuAtivo, setMenuAtivo] = useState('contas-pagar');

  const [contasBrutas, setContasBrutas] = useState([]);

  const [contaFiltro, setContaFiltro] = useState('TODAS');
  const [clienteFiltro, setClienteFiltro] = useState('');

  const [paginaAtual, setPaginaAtual] = useState(1);
  const [registrosPorPagina, setRegistrosPorPagina] = useState(50);

  const [listaBancos, setListaBancos] = useState([]);
  const [selecionados, setSelecionados] = useState([]);
  const [modalBaixa, setModalBaixa] = useState({ aberto: false, cliente: '', contas: [] });

  const [reciboCobranca, setReciboCobranca] = useState(null);
  const [gerandoImagem, setGerandoImagem] = useState(false);
  const reciboCobrancaRef = useRef(null);

  const getHojeBR = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().split('T')[0];
  };

  const [contaDestino, setContaDestino] = useState('');
  const [dataPagamento, setDataPagamento] = useState(getHojeBR());

  const [detalhesPagamento, setDetalhesPagamento] = useState({});

  const [descGlobalTipo, setDescGlobalTipo] = useState('PERCENTUAL');
  const [descGlobalValor, setDescGlobalValor] = useState('');
  const [jurosGlobalTipo, setJurosGlobalTipo] = useState('VALOR');
  const [jurosGlobalValor, setJurosGlobalValor] = useState('');

  const [valorTotalRecebido, setValorTotalRecebido] = useState('');

  const [processandoBaixa, setProcessandoBaixa] = useState(false);
  const [reciboGerado, setReciboGerado] = useState(null);

  const agruparDadosPorData = (contas, tipoRelatorio) => {
    const campoData = tipoRelatorio === 'contas-pagas' ? 'data_pagamento_br' : 'data_previsao_br';
    const campoValor = tipoRelatorio === 'contas-pagas' ? 'valor_pago' : 'saldo_devedor';

    const datasUnicas = [...new Set(contas.map(c => c[campoData]))];
    return datasUnicas.map(data => {
      const contasDoDia = contas.filter(c => c[campoData] === data);
      const subtotal = contasDoDia.reduce((acc, c) => acc + c[campoValor], 0);
      return { dataReferencia: data, contas: contasDoDia, subtotal };
    });
  };

  const agruparPorCategoria = (contas, tipoRelatorio) => {
    const campoValor = tipoRelatorio === 'contas-pagas' ? 'valor_pago' : 'saldo_devedor';
    const resumo = contas.reduce((acc, conta) => {
      const cat = conta.desc_categoria || 'Sem Categoria';
      if (!acc[cat]) acc[cat] = { total: 0, contasCorrentes: {} };
      acc[cat].total += conta[campoValor];
      if (tipoRelatorio === 'contas-pagas' || tipoRelatorio === 'recebimentos') {
        const cc = conta.conta_corrente || 'Conta Não Identificada';
        if (!acc[cat].contasCorrentes[cc]) acc[cat].contasCorrentes[cc] = 0;
        acc[cat].contasCorrentes[cc] += conta[campoValor];
      }
      return acc;
    }, {});

    return Object.entries(resumo)
      .map(([categoria, dados]) => ({
        categoria, total: dados.total,
        contasCorrentes: Object.entries(dados.contasCorrentes).map(([cc, valor]) => ({ cc, valor })).sort((a, b) => b.valor - a.valor)
      })).sort((a, b) => b.total - a.total);
  };

  const handleBuscarDados = async () => {
    if (menuAtivo !== 'recebimentos' && (!dataInicial || !dataFinal)) {
      alert("Por favor, selecione a Data Inicial e a Data Final.");
      return;
    }
    setCarregandoTela(true);
    setContaFiltro('TODAS');
    setClienteFiltro('');
    setSelecionados([]);
    setPaginaAtual(1);
    try {
      const endpoint = menuAtivo === 'contas-pagas' ? 'contas-pagas' : menuAtivo === 'recebimentos' ? 'recebimentos' : 'contas-a-pagar';
      const url = menuAtivo === 'recebimentos'
        ? `http://localhost:8000/api/relatorios/recebimentos/dados`
        : `http://localhost:8000/api/relatorios/${endpoint}/dados?data_inicio=${dataInicial}&data_fim=${dataFinal}`;

      const resposta = await fetch(url);
      if (!resposta.ok) throw new Error("Erro de comunicação com o servidor.");
      const dados = await resposta.json();
      setContasBrutas(dados.contas || []);

      if (menuAtivo === 'recebimentos' && listaBancos.length === 0) {
        fetch('http://localhost:8000/api/geral/bancos')
          .then(res => res.json())
          .then(data => setListaBancos(data))
          .catch(e => console.error(e));
      }
    } catch (erro) {
      alert(`Erro: ${erro.message}`);
    } finally {
      setCarregandoTela(false);
    }
  }

  const handleImprimir = () => {
    setRegistrosPorPagina(contasFiltradas.length > 0 ? contasFiltradas.length : 50);
    setTimeout(() => {
      window.print();
      setRegistrosPorPagina(50);
    }, 300);
  };

  const toggleSelecao = (conta) => {
    setSelecionados(prev => {
      const existe = prev.find(c => c.codigo_lancamento === conta.codigo_lancamento);
      if (existe) return prev.filter(c => c.codigo_lancamento !== conta.codigo_lancamento);
      return [...prev, conta];
    });
  };

  const toggleTodosCliente = (contasCliente) => {
    const todosSelecionados = contasCliente.every(c => selecionados.find(s => s.codigo_lancamento === c.codigo_lancamento));
    if (todosSelecionados) {
      setSelecionados(prev => prev.filter(s => !contasCliente.find(c => c.codigo_lancamento === s.codigo_lancamento)));
    } else {
      const novos = contasCliente.filter(c => !selecionados.find(s => s.codigo_lancamento === c.codigo_lancamento));
      setSelecionados(prev => [...prev, ...novos]);
    }
  };

  const abrirModalLote = (cliente, contasAbertasVisiveis) => {
    const selecionadasDoCliente = contasAbertasVisiveis.filter(c => selecionados.find(s => s.codigo_lancamento === c.codigo_lancamento));
    if (selecionadasDoCliente.length === 0) {
      alert("Selecione pelo menos uma nota deste cliente para receber!");
      return;
    }
    setDescGlobalValor('');
    setJurosGlobalValor('');
    setValorTotalRecebido('');
    setDescGlobalTipo('PERCENTUAL');
    setJurosGlobalTipo('VALOR');

    const detalhesIniciais = {};
    selecionadasDoCliente.forEach(conta => {
      detalhesIniciais[conta.codigo_lancamento] = { valor: conta.saldo_devedor, desconto: 0, juros: 0 };
    });
    setDetalhesPagamento(detalhesIniciais);
    setDataPagamento(getHojeBR());
    setModalBaixa({ aberto: true, cliente: cliente, contas: selecionadasDoCliente });
  };

  const gerarCobrancaLote = (cliente, contasAbertasVisiveis) => {
    const selecionadasDoCliente = contasAbertasVisiveis.filter(c => selecionados.find(s => s.codigo_lancamento === c.codigo_lancamento));
    if (selecionadasDoCliente.length === 0) return;
    const totalDevido = selecionadasDoCliente.reduce((acc, c) => acc + c.saldo_devedor, 0);
    const d = new Date();
    const dataHoraEmissao = `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR')}`;
    setReciboCobranca({ cliente, dataHoraEmissao, notas: selecionadasDoCliente, totalDevido });
  };

  const copiarImagemCobranca = async () => {
    if (!reciboCobrancaRef.current) return;
    setGerandoImagem(true);
    try {
      const canvas = await html2canvas(reciboCobrancaRef.current, { backgroundColor: '#0f172a', scale: 2 });
      canvas.toBlob(async (blob) => {
        try {
          const item = new ClipboardItem({ 'image/png': blob });
          await navigator.clipboard.write([item]);
          alert('Cobrança copiada com sucesso! Abra o WhatsApp do cliente e aperte Ctrl+V para colar.');
        } catch (err) {
          alert('Ocorreu um erro ao copiar. Seu navegador pode não suportar a cópia direta de imagens.');
          console.error(err);
        } finally {
          setGerandoImagem(false);
        }
      }, 'image/png');
    } catch (err) {
      alert('Erro interno ao tentar gerar a imagem.');
      console.error(err);
      setGerandoImagem(false);
    }
  };

  const imprimirCobranca = () => {
    if (!reciboCobranca) return;
    const linhas = reciboCobranca.notas.map(n => `
      <tr>
        <td style="padding:6px 10px;border:1px solid #cbd5e1;">${n.data_emissao || '-'}</td>
        <td style="padding:6px 10px;border:1px solid #cbd5e1;">${n.numero_documento_fiscal} - ${n.numero_parcela}</td>
        <td style="padding:6px 10px;text-align:right;font-weight:bold;border:1px solid #cbd5e1;">R$ ${n.saldo_devedor.toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
      </tr>`).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Demonstrativo de Cobrança</title>
      <style>
        @page { size: A4 portrait; margin: 15mm 20mm; }
        body { font-family: Arial, sans-serif; color: #1e293b; background: #fff; margin: 0; }
        h1 { font-size: 20px; font-weight: 900; text-transform: uppercase; margin: 0 0 4px; }
        p.sub { font-size: 12px; color: #64748b; margin: 0 0 24px; }
        .header { text-align: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 20px; }
        .row { display: flex; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding: 8px 0; font-size: 13px; }
        .label { color: #64748b; }
        .value { font-weight: bold; }
        .total-box { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 12px 16px; margin: 12px 0; display: flex; justify-content: space-between; align-items: center; }
        .total-box .label { color: #15803d; font-weight: bold; text-transform: uppercase; font-size: 13px; }
        .total-box .value { color: #166534; font-weight: 900; font-size: 22px; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12px; }
        thead { background: #f1f5f9; }
        th { padding: 8px 10px; border: 1px solid #cbd5e1; text-align: left; font-weight: bold; color: #475569; }
        th:last-child { text-align: right; }
        .footer { text-align: center; margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; }
      </style>
    </head><body>
      <div class="header">
        <h1>Demonstrativo de Cobrança</h1>
        <p class="sub">Financial - Açougue</p>
      </div>
      <div class="row"><span class="label">Sacado / Cliente:</span><span class="value">${reciboCobranca.cliente}</span></div>
      <div class="total-box"><span class="label">Total a Pagar</span><span class="value">R$ ${reciboCobranca.totalDevido.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div>
      <div class="row"><span class="label">Data de Emissão deste Extrato:</span><span class="value">${reciboCobranca.dataHoraEmissao}</span></div>
      <table>
        <thead><tr><th>Emissão</th><th>Nota / Parcela</th><th style="text-align:right">Valor (R$)</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
      <div class="footer">Este documento é apenas demonstrativo e não possui valor fiscal ou de quitação.</div>
    </body></html>`;
    const janela = window.open('', '_blank', 'width=800,height=900');
    janela.document.write(html);
    janela.document.close();
    janela.focus();
    setTimeout(() => { janela.print(); janela.close(); }, 400);
  };

  const imprimirRecibo = () => {
    if (!reciboGerado) return;
    const linhas = reciboGerado.notas.map(n => `
      <tr>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;">${n.contaOriginal.numero_documento_fiscal} - ${n.contaOriginal.numero_parcela}</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;">R$ ${n.contaOriginal.saldo_devedor.toLocaleString('pt-BR', {minimumFractionDigits:2})}</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;">${
          n.desconto > 0 ? `<span style="color:#ef4444;">-R$ ${n.desconto.toLocaleString('pt-BR')}</span>` : ''
        }${n.juros > 0 ? `<span style="color:#f59e0b;"> +R$ ${n.juros.toLocaleString('pt-BR')}</span>` : ''}${n.desconto === 0 && n.juros === 0 ? '-' : ''}</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-weight:bold;color:#059669;">R$ ${n.valor.toLocaleString('pt-BR', {minimumFractionDigits:2})}</td>
      </tr>`).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Recibo de Pagamento</title>
      <style>
        @page { size: A4 portrait; margin: 15mm 20mm; }
        body { font-family: Arial, sans-serif; color: #1e293b; background: #fff; margin: 0; }
        h1 { font-size: 22px; font-weight: 900; text-transform: uppercase; margin: 0 0 4px; }
        p.sub { font-size: 12px; color: #64748b; margin: 0; }
        .header { text-align: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 20px; }
        .row { display: flex; justify-content: space-between; border-bottom: 1px solid #f1f5f9; padding: 8px 4px; font-size: 13px; }
        .label { color: #64748b; }
        .value { font-weight: bold; }
        .total-box { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 12px 16px; margin: 12px 0; display: flex; justify-content: space-between; align-items: center; }
        .total-box .label { color: #15803d; font-weight: bold; text-transform: uppercase; font-size: 13px; }
        .total-box .value { color: #166534; font-weight: 900; font-size: 22px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
        thead { background: #f1f5f9; }
        th { padding: 8px 10px; border: 1px solid #e2e8f0; text-align: left; font-weight: bold; color: #475569; }
        th:not(:first-child) { text-align: right; }
        .section-title { font-size: 11px; font-weight: bold; text-transform: uppercase; color: #475569; margin: 20px 0 6px; letter-spacing: 0.05em; }
        .assinatura { text-align: center; margin-top: 30px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; }
        .assinatura .linha { width: 250px; height: 1px; background: #334155; margin: 12px auto 0; }
      </style>
    </head><body>
      <div class="header">
        <h1>Recibo de Pagamento</h1>
        <p class="sub">Financial - Açougue</p>
      </div>
      <div class="row"><span class="label">Recebemos de:</span><span class="value" style="font-size:15px;">${reciboGerado.cliente}</span></div>
      <div class="total-box"><span class="label">Valor Total Pago</span><span class="value">R$ ${reciboGerado.totalPago.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span></div>
      <div class="row"><span class="label">Data de Pagamento:</span><span class="value">${reciboGerado.data_pagamento}</span></div>
      <div class="row"><span class="label">Conta de Destino:</span><span class="value">${reciboGerado.banco || '-'}</span></div>
      <div class="row"><span class="label">Subtotal Original:</span><span class="value">R$ ${reciboGerado.totalOriginal.toLocaleString('pt-BR')}</span></div>
      <div class="row"><span class="label">Descontos / Juros:</span><span class="value">-R$ ${reciboGerado.totalDesconto.toLocaleString('pt-BR')} / +R$ ${reciboGerado.totalJuros.toLocaleString('pt-BR')}</span></div>
      <p class="section-title">Composição das Notas Recebidas</p>
      <table>
        <thead><tr><th>Nota / Parcela</th><th style="text-align:right">Original</th><th style="text-align:right">Desc/Juros</th><th style="text-align:right">Pago</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
      <div class="assinatura">
        <p>Assinatura do Recebedor / Responsável</p>
        <div class="linha"></div>
      </div>
    </body></html>`;
    const janela = window.open('', '_blank', 'width=800,height=900');
    janela.document.write(html);
    janela.document.close();
    janela.focus();
    setTimeout(() => { janela.print(); janela.close(); }, 400);
  };

  const aplicarRateioGlobal = () => {

    const totalOriginal = modalBaixa.contas.reduce((acc, c) => acc + c.saldo_devedor, 0);
    let dValGlobal = descGlobalTipo === 'VALOR' ? parseFloat(descGlobalValor || 0) : 0;
    let jValGlobal = jurosGlobalTipo === 'VALOR' ? parseFloat(jurosGlobalValor || 0) : 0;
    let pDesc = descGlobalTipo === 'PERCENTUAL' ? parseFloat(descGlobalValor || 0) / 100 : 0;
    let pJuros = jurosGlobalTipo === 'PERCENTUAL' ? parseFloat(jurosGlobalValor || 0) / 100 : 0;

    if (descGlobalTipo === 'VALOR' && dValGlobal > totalOriginal) dValGlobal = totalOriginal;

    let poolDinheiroRecebido = parseFloat(valorTotalRecebido);
    const aplicarCascata = !isNaN(poolDinheiroRecebido) && poolDinheiroRecebido > 0;

    const contasOrdenadas = [...modalBaixa.contas].sort((a, b) => {
      return converterDataBrParaDate(a.data_previsao_br) - converterDataBrParaDate(b.data_previsao_br);
    });

    const novosDetalhes = { ...detalhesPagamento };

    contasOrdenadas.forEach(c => {
      let descDaNota = 0, jurosDaNota = 0, valorPagoNestaNota = 0;
      if (aplicarCascata && poolDinheiroRecebido <= 0) {
        novosDetalhes[c.codigo_lancamento] = { desconto: 0, juros: 0, valor: 0 };
        return;
      }
      const peso = c.saldo_devedor / totalOriginal;
      let descFull = descGlobalTipo === 'PERCENTUAL' ? c.saldo_devedor * pDesc : dValGlobal * peso;
      let jurosFull = jurosGlobalTipo === 'PERCENTUAL' ? c.saldo_devedor * pJuros : jValGlobal * peso;
      let valorLiquidoFull = c.saldo_devedor - descFull + jurosFull;

      if (aplicarCascata) {
        if (poolDinheiroRecebido >= valorLiquidoFull) {
          valorPagoNestaNota = valorLiquidoFull;
          descDaNota = descFull;
          jurosDaNota = jurosFull;
          poolDinheiroRecebido -= valorLiquidoFull;
        } else {
          valorPagoNestaNota = poolDinheiroRecebido;
          poolDinheiroRecebido = 0;
          const proporcaoMassaMaga = valorPagoNestaNota / valorLiquidoFull;
          descDaNota = descFull * proporcaoMassaMaga;
          jurosDaNota = jurosFull * proporcaoMassaMaga;
        }
      } else {
        valorPagoNestaNota = valorLiquidoFull;
        descDaNota = descFull;
        jurosDaNota = jurosFull;
      }
      novosDetalhes[c.codigo_lancamento] = {
        desconto: Number(descDaNota.toFixed(2)),
        juros: Number(jurosDaNota.toFixed(2)),
        valor: Number(valorPagoNestaNota.toFixed(2))
      };
    });
    setDetalhesPagamento(novosDetalhes);
  };

  const handleAlterarDetalhe = (codigoLancamento, campo, valorDigitado) => {
    setDetalhesPagamento(prev => ({
      ...prev,
      [codigoLancamento]: {
        ...prev[codigoLancamento],
        [campo]: valorDigitado === '' ? '' : Number(valorDigitado)
      }
    }));
  };

  const calcularTotaisModal = () => {
    let totalPago = 0, totalOriginal = 0, totalDesconto = 0, totalJuros = 0;
    modalBaixa.contas.forEach(c => {
      totalOriginal += c.saldo_devedor;
      const det = detalhesPagamento[c.codigo_lancamento];
      if (det) {
        totalPago += Number(det.valor || 0);
        totalDesconto += Number(det.desconto || 0);
        totalJuros += Number(det.juros || 0);
      }
    });
    return { totalOriginal, totalPago, totalDesconto, totalJuros };
  };

  const handleEfetuarBaixaLote = async () => {
    setProcessandoBaixa(true);
    const hojeStr = getHojeBR();
    if (dataPagamento > hojeStr) {
      alert("Operação Negada: Não é permitido registrar pagamentos com data futura. Ajuste a data para hoje ou um dia anterior.");
      setProcessandoBaixa(false);
      return;
    }

    try {
      const [ano, mes, dia] = dataPagamento.split('-');
      const pagamentosTratados = modalBaixa.contas.map(c => {
        const det = detalhesPagamento[c.codigo_lancamento] || { valor: 0, desconto: 0, juros: 0 };
        return {
          codigo_lancamento: c.codigo_lancamento,
          valor: Number(det.valor || 0),
          desconto: Number(det.desconto || 0),
          juros: Number(det.juros || 0),
          contaOriginal: c
        };
      }).filter(p => p.valor > 0);

      if (pagamentosTratados.length === 0) {
        alert("Não há valores a receber informados nas notas.");
        setProcessandoBaixa(false);
        return;
      }

      const payload = {
        id_conta_corrente: parseInt(contaDestino),
        data_pagamento: `${dia}/${mes}/${ano}`,
        pagamentos: pagamentosTratados.map(p => ({
          codigo_lancamento: p.codigo_lancamento,
          valor: p.valor,
          desconto: p.desconto,
          juros: p.juros
        }))
      };

      const res = await fetch('http://localhost:8000/api/relatorios/recebimentos/baixar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Erro ao processar as notas.");

      const bancoSelecionado = listaBancos.find(b => b.id === contaDestino)?.nome;
      const totais = calcularTotaisModal();

      setReciboGerado({
        cliente: modalBaixa.cliente,
        banco: bancoSelecionado,
        data_pagamento: `${dia}/${mes}/${ano}`,
        totalOriginal: totais.totalOriginal,
        totalDesconto: totais.totalDesconto,
        totalJuros: totais.totalJuros,
        totalPago: totais.totalPago,
        notas: pagamentosTratados
      });

      setModalBaixa({ aberto: false, cliente: '', contas: [] });
      handleBuscarDados();
    } catch (e) {
      alert("Erro ao receber valores: " + e.message);
    } finally {
      setProcessandoBaixa(false);
    }
  }

  const contasFiltradas = useMemo(() => {
    let filtrado = contasBrutas;
    if (contaFiltro !== 'TODAS') {
      filtrado = filtrado.filter(c => c.conta_corrente === contaFiltro);
    }
    if (clienteFiltro.trim() !== '') {
      const termo = clienteFiltro.toLowerCase();
      filtrado = filtrado.filter(c =>
        (c.nome_cliente && c.nome_cliente.toLowerCase().includes(termo)) ||
        (c.nome_fornecedor && c.nome_fornecedor.toLowerCase().includes(termo)) ||
        (c.numero_documento_fiscal && c.numero_documento_fiscal.toLowerCase().includes(termo))
      );
    }
    return filtrado;
  }, [contasBrutas, contaFiltro, clienteFiltro]);

  const gruposRecebimentos = useMemo(() => {
    if (menuAtivo !== 'recebimentos') return [];
    const clientesUnicos = [...new Set(contasFiltradas.map(c => c.nome_cliente))];
    return clientesUnicos.map(cli => {
      const contasCompletasDoCli = contasFiltradas.filter(c => c.nome_cliente === cli);
      const subtotal = contasCompletasDoCli.reduce((acc, c) => acc + c.saldo_devedor, 0);
      return { dataReferencia: cli, contas: contasCompletasDoCli, subtotal, contasOcultas: 0 };
    }).sort((a, b) => b.subtotal - a.subtotal);
  }, [contasFiltradas, menuAtivo]);

  const totalItems = menuAtivo === 'recebimentos' ? gruposRecebimentos.length : contasFiltradas.length;
  const totalPaginas = Math.ceil(totalItems / registrosPorPagina) || 1;
  const indiceInicio = (paginaAtual - 1) * registrosPorPagina;
  const indiceFim = indiceInicio + registrosPorPagina;
  const contasPaginadas = contasFiltradas.slice(indiceInicio, indiceFim);

  const dadosAgrupados = useMemo(() => {
    if (menuAtivo === 'recebimentos') {
      return gruposRecebimentos.slice(indiceInicio, indiceFim);
    }
    return agruparDadosPorData(contasPaginadas, menuAtivo);
  }, [contasPaginadas, gruposRecebimentos, menuAtivo, indiceInicio, indiceFim]);

  const resumoCategorias = useMemo(() => agruparPorCategoria(contasFiltradas, menuAtivo), [contasFiltradas, menuAtivo]);
  const totalGeral = useMemo(() => contasFiltradas.reduce((acc, c) => acc + (menuAtivo === 'contas-pagas' ? c.valor_pago : c.saldo_devedor), 0), [contasFiltradas, menuAtivo]);

  const contasCorrentesDisponiveis = useMemo(() => {
    if (menuAtivo === 'contas-a-pagar') return [];
    return [...new Set(contasBrutas.map(c => c.conta_corrente))].sort();
  }, [contasBrutas, menuAtivo]);

  const tituloModulo = menuAtivo === 'contas-pagas' ? 'Módulo de Contas Pagas' : menuAtivo === 'recebimentos' ? 'Módulo de Convênios' : 'Módulo de Contas a Pagar';
  const descModulo = menuAtivo === 'contas-pagas' ? 'Sincronize as baixas realizadas e concilie contas correntes.' : menuAtivo === 'recebimentos' ? 'Acompanhe faturas de convênios, edite pagamentos parciais e gere recibos.' : 'Sincronize os dados e imprima o relatório detalhado.';
  const tituloRelatorio = menuAtivo === 'contas-pagas' ? 'Pagamentos Realizados' : menuAtivo === 'recebimentos' ? 'Títulos a Receber (Convênio)' : 'Previsão de Pagamentos';

  const SidebarItem = ({ id, icone: Icon, texto }) => (
    <button onClick={() => { setMenuAtivo(id); setContasBrutas([]); setSelecionados([]); setClienteFiltro(''); setContaFiltro('TODAS'); setPaginaAtual(1); }}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 print:hidden ${menuAtivo === id ? 'bg-gradient-to-r from-indigo-500/20 to-purple-500/20 text-indigo-400 border border-indigo-500/30 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]' : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
        }`}>
      <Icon size={20} className={menuAtivo === id ? 'text-indigo-400' : ''} />
      <span className="font-medium text-left text-sm">{texto}</span>
    </button>
  );

  return (
    <div className="flex h-screen bg-slate-950 font-sans overflow-hidden print:!block print:bg-white print:text-slate-900 print:!h-auto print:!overflow-visible">

      {/* SIDEBAR */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col z-20 print:hidden">
        <div className="h-20 flex items-center px-6 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <TrendingUp size={18} className="text-white" />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">Financial</h1>
          </div>
        </div>
        <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
          <p className="px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Relatórios</p>
          <SidebarItem id="dashboard" icone={LayoutDashboard} texto="Visão Geral" />
          <SidebarItem id="contas-pagar" icone={FileText} texto="Contas a Pagar (Previsão)" />
          <SidebarItem id="contas-pagas" icone={Database} texto="Contas Pagas (Realizado)" />
          <SidebarItem id="recebimentos" icone={CreditCard} texto="Contas a Receber (Convênio)" />
          <SidebarItem id="vendas" icone={TrendingUp} texto="Análise de Vendas" />
        </nav>
      </aside>

      {/* ÁREA PRINCIPAL */}
      <main className={`flex-1 flex flex-col relative overflow-y-auto overflow-x-hidden print:!block print:!h-auto print:!overflow-visible ${reciboGerado || reciboCobranca ? 'print:hidden' : ''}`}>

        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-indigo-500/10 rounded-full blur-[100px] transform-gpu pointer-events-none z-0 print:hidden"></div>
        <div className="absolute bottom-[-10%] right-[-5%] w-96 h-96 bg-purple-500/10 rounded-full blur-[100px] transform-gpu pointer-events-none z-0 print:hidden"></div>

        <header className="h-20 bg-slate-900/95 border-b border-slate-800 flex items-center justify-between px-8 z-50 sticky top-0 print:hidden">
          <div className="flex items-center bg-slate-800/50 border border-slate-700/50 rounded-full px-4 py-2 w-96">
            <Search size={18} className="text-slate-400" />
            <input type="text" placeholder="Buscar no sistema..." className="bg-transparent border-none outline-none text-sm ml-3 w-full text-slate-200" />
          </div>
          <div className="flex items-center gap-3 pl-6 border-l border-slate-800">
            <p className="text-sm font-medium text-slate-200 hidden md:block">Admin Financeiro</p>
            <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center border border-slate-600"><Users size={20} className="text-slate-300" /></div>
          </div>
        </header>

        <div className="flex-1 p-8 z-10 print:!p-0 print:!m-0 print:!block print:!overflow-visible">

          <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 mb-8 print:hidden">
            <div>
              <h2 className="text-3xl font-bold text-white mb-2">{tituloModulo}</h2>
              <p className="text-slate-400">{descModulo}</p>
            </div>

            <div className="bg-slate-900/80 border border-white/[0.05] rounded-2xl p-4 flex flex-col sm:flex-row items-center gap-4">
              {menuAtivo !== 'recebimentos' && (
                <div className="flex items-center gap-3">
                  <CalendarDays className="text-indigo-400 hidden sm:block" size={20} />
                  <input type="date" value={dataInicial} onChange={(e) => setDataInicial(e.target.value)} className="bg-slate-900/50 border border-slate-700/50 rounded-lg px-3 py-2 text-slate-200 text-sm [color-scheme:dark]" />
                  <span className="text-slate-500 text-sm font-medium">até</span>
                  <input type="date" value={dataFinal} onChange={(e) => setDataFinal(e.target.value)} className="bg-slate-900/50 border border-slate-700/50 rounded-lg px-3 py-2 text-slate-200 text-sm [color-scheme:dark]" />
                </div>
              )}

              <button onClick={handleBuscarDados} disabled={carregandoTela} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-lg font-bold transition-all disabled:opacity-50">
                {carregandoTela ? <Loader2 className="animate-spin" size={16} /> : <Database size={16} />}
                SINCRONIZAR DADOS
              </button>
            </div>
          </div>

          <div className="hidden print:flex items-center justify-between border-b-2 border-slate-800 pb-4 mb-6 mt-4 print:px-2">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 print:!bg-indigo-600 flex items-center justify-center">
                <TrendingUp size={18} className="text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Financial</h1>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Inteligência Financeira</p>
              </div>
            </div>
            <div className="text-right">
              <h2 className="text-lg font-bold text-slate-800 uppercase">{tituloRelatorio}</h2>
              {menuAtivo !== 'recebimentos' && <p className="text-sm font-medium text-slate-600 mt-1">Período: {dataInicial.split('-').reverse().join('/')} a {dataFinal.split('-').reverse().join('/')}</p>}
            </div>
          </div>

          {!carregandoTela && contasBrutas.length > 0 && (
            <div className="animate-[fadeIn_0.5s_ease-out] print:!block">

              <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-10 gap-4 print:hidden">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                    <p className="text-emerald-400 font-bold text-lg xl:text-xl">Global a {menuAtivo === 'recebimentos' ? 'Receber' : 'Pagar'}: R$ {totalGeral.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                  </div>

                  <div className="flex items-center gap-2 bg-slate-900/50 border border-slate-700/50 rounded-lg px-3 py-2">
                    <Search size={16} className="text-indigo-400" />
                    <input
                      type="text"
                      placeholder={menuAtivo === 'recebimentos' ? "Filtrar cliente/nota..." : "Filtrar fornecedor..."}
                      value={clienteFiltro}
                      onChange={(e) => {
                        setClienteFiltro(e.target.value);
                        setPaginaAtual(1);
                      }}
                      className="bg-transparent text-slate-200 text-sm font-medium focus:outline-none placeholder-slate-500 w-40"
                    />
                  </div>

                  {(menuAtivo === 'contas-pagas' || menuAtivo === 'recebimentos') && contasCorrentesDisponiveis.length > 0 && (
                    <div className="flex items-center gap-2 bg-slate-900/50 border border-slate-700/50 rounded-lg px-3 py-2">
                      <Filter size={16} className="text-indigo-400" />
                      <select
                        value={contaFiltro}
                        onChange={(e) => {
                          setContaFiltro(e.target.value);
                          setPaginaAtual(1);
                        }}
                        className="bg-transparent text-slate-200 text-sm font-medium focus:outline-none appearance-none pr-4"
                      >
                        <option value="TODAS">Todas as Contas</option>
                        {contasCorrentesDisponiveis.map(cc => <option key={cc} value={cc}>{cc}</option>)}
                      </select>
                    </div>
                  )}
                </div>

                <button onClick={handleImprimir} className="flex items-center gap-2 bg-slate-800 text-slate-300 hover:text-white px-6 py-3 rounded-xl font-bold group border border-slate-700 shadow-lg">
                  <Printer size={18} className="group-hover:scale-110 transition-transform" /> IMPRIMIR
                </button>
              </div>

              {contasFiltradas.length === 0 ? (
                <div className="text-center py-16 bg-slate-900/30 border border-dashed border-slate-700 rounded-2xl print:hidden">
                  <FileText size={48} className="mx-auto text-slate-600 mb-4" />
                  <p className="text-slate-400 font-medium">Nenhum registo encontrado para o filtro atual.</p>
                </div>
              ) : (
                <>
                  {menuAtivo === 'recebimentos' ? (
                    <div className="space-y-8">
                      {dadosAgrupados.map((grupo, gIdx) => (
                        <CartaoCliente
                          key={gIdx}
                          grupo={grupo}
                          selecionados={selecionados}
                          toggleSelecao={toggleSelecao}
                          toggleTodosCliente={toggleTodosCliente}
                          abrirModalLote={abrirModalLote}
                          gerarCobrancaLote={gerarCobrancaLote}
                        />
                      ))}
                    </div>
                  ) : (
                    /* A MÁGICA DO FUNDO BRANCO: O print:!bg-transparent remove aquele bloco azul escuro inteiro na impressão */
                    <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl print:rounded-none p-8 print:!p-0 print:!bg-transparent print:shadow-none relative z-10 shadow-lg">

                      {/* BLOCO 1: RESUMO POR CATEGORIA */}
                      <div className="mb-12 print:mb-6">
                        <h4 className="text-lg font-bold text-indigo-400 print:text-slate-900 uppercase tracking-wider mb-4 print:mb-2 print:mt-4 print:pl-2">
                          Resumo por Categoria de Despesa
                        </h4>
                        {/* A MÁGICA DA BORDA: Removido o overflow que cortava a borda e tirado os cantos arredondados */}
                        <div className="overflow-x-auto print:overflow-visible rounded-xl print:rounded-none border border-slate-700/50 print:border-slate-300 print:border shadow-lg shadow-black/20 print:shadow-none print:w-full">
                          <table className="w-full text-left border-collapse whitespace-nowrap">
                            <thead>
                              <tr className="bg-slate-900/80 print:bg-slate-200 print:!bg-slate-200 text-slate-300 print:text-slate-900 text-xs font-bold border-b print:border-b-2 border-slate-700/50 print:border-slate-400">
                                <th className="py-4 print:py-1 px-5 print:px-2 uppercase w-3/4 print:w-auto print:min-w-0">Categoria {menuAtivo === 'contas-pagas' && '/ Conta Corrente'}</th>
                                <th className="py-4 print:py-1 px-5 print:px-2 text-right uppercase w-1/4 min-w-[120px] print:w-auto print:min-w-0">Total {menuAtivo === 'contas-pagas' ? 'Pago' : 'a Pagar'}</th>
                              </tr>
                            </thead>
                            <tbody className="text-sm">
                              {resumoCategorias.map((item, idx) => (
                                <React.Fragment key={idx}>
                                  <tr className={`border-b border-slate-700/30 print:border-slate-300 text-slate-300 print:text-slate-800 hover:bg-slate-800/80 print:hover:bg-transparent transition-colors ${idx % 2 === 0 ? 'print:bg-white' : 'print:bg-slate-50 print:!bg-slate-50'}`}>
                                    <td className="py-3 print:py-1 px-5 print:px-2 font-bold">{item.categoria}</td>
                                    <td className="py-3 print:py-1 px-5 print:px-2 text-right font-bold text-slate-200 print:text-slate-900">
                                      R$ {item.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                    </td>
                                  </tr>

                                  {menuAtivo === 'contas-pagas' && item.contasCorrentes.map((ccItem, ccIdx) => (
                                    <tr key={`cc-${idx}-${ccIdx}`} className="border-b border-slate-700/10 print:border-slate-200 bg-slate-900/40 print:bg-transparent">
                                      <td className="py-2 print:py-1 px-5 print:px-2 pl-12 text-slate-400 print:text-slate-600 text-xs flex items-center gap-2 border-l-2 border-indigo-500/30 ml-4">
                                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 print:bg-slate-400"></div> {ccItem.cc}
                                      </td>
                                      <td className="py-2 print:py-1 px-5 print:px-2 text-right text-slate-400 print:text-slate-600 text-xs">
                                        R$ {ccItem.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                      </td>
                                    </tr>
                                  ))}
                                </React.Fragment>
                              ))}
                              <tr className="bg-slate-800/80 print:bg-slate-200 print:!bg-slate-200 border-t-2 border-slate-600 print:border-b-2 print:border-slate-800">
                                <td className="py-4 print:py-2 px-5 print:px-2 text-right font-bold text-slate-300 print:text-slate-900 uppercase text-lg">
                                  Total Geral
                                </td>
                                <td className="py-4 print:py-2 px-5 print:px-2 text-right font-bold text-emerald-400 print:text-slate-900 text-lg">
                                  R$ {totalGeral.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* BLOCO 2: DETALHAMENTO */}
                      <h3 className="text-xl font-bold text-indigo-400 mb-4 print:text-slate-900 uppercase tracking-wider print:mb-2 print:mt-4 print:pl-2">Detalhamento Financeiro (Previsão de Fluxo)</h3>
                      <div className="overflow-x-auto print:overflow-visible rounded-xl print:rounded-none border border-slate-700/50 print:border-slate-300 print:border shadow-lg shadow-black/20 print:shadow-none print:w-full">
                        <table className="w-full text-left border-collapse whitespace-nowrap">
                          <thead>
                            <tr className="bg-slate-900/80 print:bg-slate-200 print:!bg-slate-200 text-slate-300 print:text-slate-900 text-xs font-bold border-b print:border-b-2 border-slate-700/50 print:border-slate-400">
                              {/* A MÁGICA DA LARGURA: O print:w-auto desabilita as larguras de tela, impedindo que a tabela "vaze" para fora da folha A4 e suma a borda */}
                              <th className="py-4 print:py-1 px-5 print:px-2 text-center w-28 print:w-auto print:min-w-0">Data Emissão</th>
                              <th className="py-4 print:py-1 px-5 print:px-2 w-1/4 min-w-[200px] print:w-auto print:min-w-0">Categoria</th>
                              <th className="py-4 print:py-1 px-5 print:px-2 w-1/3 min-w-[250px] print:w-auto print:min-w-0">Fornecedor</th>
                              <th className="py-4 print:py-1 px-5 print:px-2 text-center w-28 print:w-auto print:min-w-0">{menuAtivo === 'contas-pagas' ? 'Data Pagto' : 'Vencimento'}</th>
                              {menuAtivo === 'contas-pagas' && <th className="py-4 print:py-1 px-5 print:px-2 w-1/5 min-w-[150px] print:w-auto print:min-w-0">Conta Corrente</th>}
                              <th className="py-4 print:py-1 px-5 print:px-2 text-center w-24 print:w-auto print:min-w-0">Nº Nota</th>
                              <th className="py-4 print:py-1 px-5 print:px-2 text-center w-20 print:w-auto print:min-w-0">Parcela</th>
                              <th className="py-4 print:py-1 px-5 print:px-2 text-right w-32 print:w-auto print:min-w-0">Valor</th>
                            </tr>
                          </thead>
                          <tbody className="text-sm">
                            {dadosAgrupados.map((grupo, gIdx) => (
                              <React.Fragment key={gIdx}>
                                {grupo.contas.map((conta, cIdx) => (
                                  <tr key={`${gIdx}-${cIdx}`} className={`border-b border-slate-700/30 print:border-slate-300 text-slate-400 print:text-slate-800 text-xs hover:bg-slate-800/80 print:hover:bg-transparent transition-colors ${cIdx % 2 === 0 ? 'print:bg-white' : 'print:bg-slate-50 print:!bg-slate-50'}`}>
                                    <td className="py-3 print:py-1 px-5 print:px-2 text-center">{formatarDataComDia(conta.data_emissao)}</td>
                                    <td className="py-3 print:py-1 px-5 print:px-2 truncate max-w-[200px] print:max-w-none">{conta.desc_categoria}</td>
                                    <td className="py-3 print:py-1 px-5 print:px-2 truncate max-w-[250px] print:max-w-none font-medium text-slate-300 print:text-slate-900">{conta.nome_fornecedor}</td>
                                    <td className="py-3 print:py-1 px-5 print:px-2 text-center font-medium text-slate-300 print:text-slate-800">{menuAtivo === 'contas-pagas' ? formatarDataComDia(conta.data_pagamento_br) : formatarDataComDia(conta.data_previsao_br)}</td>
                                    {menuAtivo === 'contas-pagas' && <td className="py-3 print:py-1 px-5 print:px-2 text-slate-300 truncate max-w-[150px] print:max-w-none">{conta.conta_corrente}</td>}
                                    <td className="py-3 print:py-1 px-5 print:px-2 text-center">{conta.numero_documento_fiscal}</td>
                                    <td className="py-3 print:py-1 px-5 print:px-2 text-center">{conta.numero_parcela}</td>
                                    <td className="py-3 print:py-1 px-5 print:px-2 text-right font-bold text-slate-200 print:text-slate-900">
                                      R$ {(menuAtivo === 'contas-pagas' ? conta.valor_pago : conta.saldo_devedor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                    </td>
                                  </tr>
                                ))}
                                <tr className="bg-slate-800/60 print:bg-slate-100 print:!bg-slate-100 border-b-2 border-slate-600 print:border-slate-400">
                                  <td colSpan={menuAtivo === 'contas-pagas' ? "7" : "6"} className="py-4 print:py-2 px-5 print:px-2 text-right font-bold text-slate-300 print:text-slate-900 text-xs uppercase">
                                    Subtotal de {grupo.dataReferencia}
                                  </td>
                                  <td className="py-4 print:py-2 px-5 print:px-2 text-right font-bold text-emerald-400 print:text-slate-900">
                                    R$ {grupo.subtotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                  </td>
                                </tr>
                              </React.Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {totalPaginas > 1 && (
                    <div className="flex items-center justify-between bg-slate-900/80 border border-slate-700/50 p-4 rounded-xl mt-6 print:hidden">
                      <p className="text-sm text-slate-400">
                        Mostrando <span className="text-white font-bold">{indiceInicio + 1}</span> até <span className="text-white font-bold">{Math.min(indiceFim, totalItems)}</span> de <span className="text-white font-bold">{totalItems}</span> {menuAtivo === 'recebimentos' ? 'clientes' : 'registros'}.
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setPaginaAtual(prev => Math.max(prev - 1, 1))}
                          disabled={paginaAtual === 1}
                          className="p-2 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronLeft size={18} />
                        </button>
                        <span className="text-sm font-medium text-slate-300 px-4">
                          Página {paginaAtual} de {totalPaginas}
                        </span>
                        <button
                          onClick={() => setPaginaAtual(prev => Math.min(prev + 1, totalPaginas))}
                          disabled={paginaAtual === totalPaginas}
                          className="p-2 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronRight size={18} />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

            </div>
          )}
        </div>

        {/* MODAL 1: INFORMADOR DE PAGAMENTO */}
        {modalBaixa.aberto && (
          <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center print:hidden p-4">
            <div className="bg-slate-900 border border-slate-700 p-8 rounded-2xl max-w-5xl w-full shadow-2xl overflow-y-auto max-h-[90vh]">
              <h3 className="text-2xl font-bold text-white mb-1">Confirmação de Recebimento</h3>
              <p className="text-slate-400 mb-6">Ajuste os valores pagos para o cliente <span className="text-indigo-400 font-bold">{modalBaixa.cliente}</span></p>

              {(() => {
                const { totalOriginal, totalPago } = calcularTotaisModal();
                return (
                  <>
                    <div className="grid grid-cols-2 gap-4 mb-6">
                      <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                        <p className="text-sm text-slate-400 font-medium">Qtd. Notas Selecionadas</p>
                        <p className="text-xl font-bold text-white">{modalBaixa.contas.length} nota(s)</p>
                      </div>
                      <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 flex justify-between items-center">
                        <div>
                          <p className="text-sm text-slate-400 font-medium">Subtotal Original</p>
                          <p className="text-xl font-bold text-slate-300">R$ {totalOriginal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-800/80 p-5 rounded-xl border border-slate-600 mb-6">
                      <div className="flex items-center gap-2 mb-4">
                        <Zap size={18} className="text-amber-400" />
                        <h4 className="text-white font-bold text-sm uppercase tracking-wider">Automação de Rateio (Cascata / FIFO)</h4>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                        <div className="col-span-1">
                          <label className="block text-xs font-medium text-slate-400 mb-1">Desc. Taxa Cartão</label>
                          <div className="flex bg-slate-900 border border-slate-600 rounded-lg overflow-hidden focus-within:border-indigo-500">
                            <select value={descGlobalTipo} onChange={e => setDescGlobalTipo(e.target.value)} className="bg-slate-700 text-white px-2 py-2 text-sm focus:outline-none border-none">
                              <option value="VALOR">R$</option>
                              <option value="PERCENTUAL">%</option>
                            </select>
                            <input type="number" min="0" placeholder="Ex: 1.99" value={descGlobalValor} onChange={e => setDescGlobalValor(e.target.value)} className="w-full bg-transparent px-2 py-2 text-white outline-none text-sm" />
                          </div>
                        </div>
                        <div className="col-span-1">
                          <label className="block text-xs font-medium text-slate-400 mb-1">Juros / Multa</label>
                          <div className="flex bg-slate-900 border border-slate-600 rounded-lg overflow-hidden focus-within:border-indigo-500">
                            <select value={jurosGlobalTipo} onChange={e => setJurosGlobalTipo(e.target.value)} className="bg-slate-700 text-white px-2 py-2 text-sm focus:outline-none border-none">
                              <option value="VALOR">R$</option>
                              <option value="PERCENTUAL">%</option>
                            </select>
                            <input type="number" min="0" placeholder="Ex: 5.00" value={jurosGlobalValor} onChange={e => setJurosGlobalValor(e.target.value)} className="w-full bg-transparent px-2 py-2 text-white outline-none text-sm" />
                          </div>
                        </div>
                        <div className="col-span-1">
                          <label className="block text-xs font-medium text-emerald-400 mb-1">Valor Físico Recebido (R$)</label>
                          <div className="flex bg-slate-900 border border-emerald-500/50 rounded-lg overflow-hidden focus-within:border-emerald-500">
                            <span className="bg-emerald-900/30 text-emerald-400 px-3 py-2 text-sm font-bold">R$</span>
                            <input type="number" min="0" placeholder="Ex: 500.00" value={valorTotalRecebido} onChange={e => setValorTotalRecebido(e.target.value)} className="w-full bg-transparent px-2 py-2 text-emerald-400 font-bold outline-none text-sm placeholder-emerald-800" />
                          </div>
                        </div>
                        <div className="col-span-1">
                          <button onClick={aplicarRateioGlobal} className="w-full bg-slate-700 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold transition-colors border border-slate-600 hover:border-indigo-500 h-[38px] text-sm flex justify-center items-center gap-2">
                            <ArrowDownToLine size={16} /> Distribuir
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="mb-6 overflow-x-auto rounded-xl border border-slate-700">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-800 text-slate-300 text-xs font-bold border-b border-slate-700">
                            <th className="py-3 px-4 w-28">Vencimento</th>
                            <th className="py-3 px-4">Nota / Parcela</th>
                            <th className="py-3 px-4 text-right">Saldo Devedor</th>
                            <th className="py-3 px-4 text-right w-28">Desc (R$)</th>
                            <th className="py-3 px-4 text-right w-28">Juros (R$)</th>
                            <th className="py-3 px-4 text-right w-32">A Pagar (R$)</th>
                          </tr>
                        </thead>
                        <tbody className="text-sm">
                          {[...modalBaixa.contas].sort((a, b) => converterDataBrParaDate(a.data_previsao_br) - converterDataBrParaDate(b.data_previsao_br)).map(conta => {
                            const det = detalhesPagamento[conta.codigo_lancamento] || { valor: '', desconto: '', juros: '' };
                            const isZerada = det.valor === 0 || det.valor === '';

                            return (
                              <tr key={conta.codigo_lancamento} className={`border-b border-slate-700/50 hover:bg-slate-800/30 transition-colors ${isZerada ? 'opacity-50' : ''}`}>
                                <td className="py-2 px-4 text-indigo-300 font-mono text-xs">{formatarDataComDia(conta.data_previsao_br)}</td>
                                <td className="py-2 px-4 text-slate-300">{conta.numero_documento_fiscal} - {conta.numero_parcela}</td>
                                <td className="py-2 px-4 text-right text-slate-400">R$ {conta.saldo_devedor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                <td className="py-2 px-4 text-right">
                                  <input
                                    type="number"
                                    min="0" step="0.01"
                                    value={det.desconto}
                                    onChange={(e) => handleAlterarDetalhe(conta.codigo_lancamento, 'desconto', e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-right outline-none focus:border-indigo-500"
                                  />
                                </td>
                                <td className="py-2 px-4 text-right">
                                  <input
                                    type="number"
                                    min="0" step="0.01"
                                    value={det.juros}
                                    onChange={(e) => handleAlterarDetalhe(conta.codigo_lancamento, 'juros', e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-right outline-none focus:border-indigo-500"
                                  />
                                </td>
                                <td className="py-2 px-4 text-right">
                                  <input
                                    type="number"
                                    min="0" step="0.01"
                                    value={det.valor}
                                    onChange={(e) => handleAlterarDetalhe(conta.codigo_lancamento, 'valor', e.target.value)}
                                    className={`w-full border rounded px-2 py-1 font-bold text-right outline-none ${isZerada ? 'bg-slate-900 border-slate-700 text-slate-500' : 'bg-indigo-900/50 border-indigo-500/50 text-emerald-400 focus:border-emerald-500'}`}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="bg-indigo-900/30 p-4 rounded-xl border border-indigo-500/30 mb-6 flex justify-between items-center">
                      <p className="text-indigo-200 font-medium">Total do Recebimento</p>
                      <p className="text-3xl font-black text-emerald-400">R$ {totalPago.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-6 mb-8">
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Conta de Destino</label>
                        <select value={contaDestino} onChange={e => setContaDestino(e.target.value)} className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-white text-sm">
                          <option value="">Selecione...</option>
                          {listaBancos.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Data</label>
                        <input type="date" max={getHojeBR()} value={dataPagamento} onChange={e => setDataPagamento(e.target.value)} className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-white text-sm [color-scheme:dark]" />
                      </div>
                    </div>
                  </>
                )
              })()}

              <div className="flex gap-4">
                <button onClick={() => setModalBaixa({ aberto: false, cliente: '', contas: [] })} className="flex-1 px-4 py-3 rounded-lg font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 transition">Cancelar</button>
                <button onClick={handleEfetuarBaixaLote} disabled={processandoBaixa || !contaDestino || !dataPagamento} className="flex-1 px-4 py-3 rounded-lg font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition disabled:opacity-50 flex justify-center items-center gap-2">
                  {processandoBaixa ? <><Loader2 size={18} className="animate-spin" /> Processando...</> : 'Confirmar Recebimento'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL 2: RECIBO DE PAGAMENTO (TELA DE SUCESSO) */}
        {reciboGerado && (
          <div className="fixed inset-0 z-[100] bg-slate-900/90 flex items-center justify-center p-4 print:p-0 print:bg-white print:block overflow-y-auto">
            <div className="bg-white text-slate-900 p-10 rounded-2xl max-w-2xl w-full shadow-2xl print:shadow-none print:w-full print:max-w-none relative my-8 print:my-0">

              <div className="text-center mb-8 border-b-2 border-slate-200 pb-6">
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4 print:hidden">
                  <CheckCircle size={32} className="text-emerald-600" />
                </div>
                <h1 className="text-3xl font-black text-slate-900 tracking-tight uppercase">Recibo de Pagamento</h1>
                <p className="text-slate-500 font-medium mt-1">Financial - Açougue</p>
              </div>

              <div className="grid grid-cols-2 gap-y-4 mb-8 text-sm">
                <div className="col-span-2 flex justify-between border-b border-slate-100 pb-2">
                  <span className="text-slate-500 font-medium">Recebemos de:</span>
                  <span className="font-bold text-slate-900 text-lg">{reciboGerado.cliente}</span>
                </div>
                <div className="col-span-2 flex justify-between border-b border-slate-100 pb-2 bg-emerald-50 p-3 rounded-lg">
                  <span className="text-emerald-700 font-bold uppercase">Valor Total Pago:</span>
                  <span className="font-black text-emerald-600 text-2xl">R$ {reciboGerado.totalPago.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 pb-2 pr-4">
                  <span className="text-slate-500 font-medium">Data Pgto:</span>
                  <span className="font-bold text-slate-900">{reciboGerado.data_pagamento}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 pb-2 pl-4">
                  <span className="text-slate-500 font-medium">Destino:</span>
                  <span className="font-bold text-slate-900">{reciboGerado.banco}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 pb-2 pr-4">
                  <span className="text-slate-500 font-medium">Subtotal Orig:</span>
                  <span className="font-bold text-slate-900">R$ {reciboGerado.totalOriginal.toLocaleString('pt-BR')}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 pb-2 pl-4">
                  <span className="text-slate-500 font-medium">Desc / Juros:</span>
                  <span className="font-bold text-slate-900">-R$ {reciboGerado.totalDesconto.toLocaleString('pt-BR')} / +R$ {reciboGerado.totalJuros.toLocaleString('pt-BR')}</span>
                </div>
              </div>

              <div className="mb-12">
                <h4 className="font-bold text-slate-700 mb-3 uppercase text-xs">Composição das Notas Recebidas</h4>
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100 text-slate-600">
                    <tr>
                      <th className="py-2 px-3 rounded-l-lg">Nota/Parc</th>
                      <th className="py-2 px-3 text-right">Original</th>
                      <th className="py-2 px-3 text-right">Desc/Juros</th>
                      <th className="py-2 px-3 text-right rounded-r-lg font-bold">Pago</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reciboGerado.notas.map(n => (
                      <tr key={n.codigo_lancamento} className="border-b border-slate-100">
                        <td className="py-2 px-3">{n.contaOriginal.numero_documento_fiscal} - {n.contaOriginal.numero_parcela}</td>
                        <td className="py-2 px-3 text-right">R$ {n.contaOriginal.saldo_devedor.toLocaleString('pt-BR')}</td>
                        <td className="py-2 px-3 text-right text-slate-500">
                          {n.desconto > 0 && <span className="text-red-500">-R${n.desconto.toLocaleString('pt-BR')}</span>}
                          {n.juros > 0 && <span className="text-amber-500">+R${n.juros.toLocaleString('pt-BR')}</span>}
                          {n.desconto === 0 && n.juros === 0 && '-'}
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-emerald-600">R$ {n.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="text-center pt-8 border-t border-slate-200">
                <p className="text-slate-400 text-sm mb-12">Assinatura do Recebedor / Responsável</p>
                <div className="w-72 h-[1px] bg-slate-800 mx-auto"></div>
              </div>

              <div className="flex gap-4 mt-12 print:hidden">
                <button onClick={() => setReciboGerado(null)} className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold py-3 rounded-xl transition">Fechar</button>
                <button onClick={imprimirRecibo} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl transition flex items-center justify-center gap-2">
                  <Printer size={18} /> Imprimir Recibo
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL 3: EXTRATO DE COBRANÇA */}
        {reciboCobranca && (
          <div className="fixed inset-0 z-[100] bg-slate-950/90 flex items-center justify-center p-4 overflow-y-auto print:bg-white print:p-0 print:block">
            <div className="flex flex-col items-center max-w-2xl w-full my-8 print:my-0 print:w-full print:max-w-none">

              <div ref={reciboCobrancaRef} className="bg-slate-900 border border-slate-800 p-8 md:p-10 rounded-[2rem] w-full relative overflow-hidden shadow-2xl print:bg-white print:border-none print:shadow-none print:rounded-none print:p-0 print:overflow-visible">

                <div
                  className="absolute top-[-40%] left-[-20%] w-[500px] h-[500px] pointer-events-none z-0 print:hidden"
                  style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, rgba(0,0,0,0) 60%)' }}
                ></div>
                <div
                  className="absolute bottom-[-40%] right-[-20%] w-[500px] h-[500px] pointer-events-none z-0 print:hidden"
                  style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.15) 0%, rgba(0,0,0,0) 60%)' }}
                ></div>

                <div className="relative z-10 print:text-slate-900">
                  <div className="text-center mb-8 border-b border-slate-800 pb-6 print:border-slate-300">
                    <div className="w-16 h-16 bg-indigo-500/20 border border-indigo-500/30 rounded-full flex items-center justify-center mx-auto mb-4 print:bg-transparent print:border-indigo-500">
                      <Receipt size={32} className="text-indigo-400 print:text-indigo-600" />
                    </div>
                    <h1 className="text-3xl font-black text-white tracking-tight uppercase print:text-slate-900">Demonstrativo de Cobrança</h1>
                    <p className="text-slate-400 font-medium mt-1 print:text-slate-600">Financial - Açougue</p>
                  </div>

                  <div className="grid grid-cols-2 gap-y-4 mb-8 text-sm">
                    <div className="col-span-2 flex justify-between border-b border-slate-800 pb-2 print:border-slate-200">
                      <span className="text-slate-400 font-medium print:text-slate-600">Sacado / Cliente:</span>
                      <span className="font-bold text-white text-lg print:text-slate-900">{reciboCobranca.cliente}</span>
                    </div>
                    <div className="col-span-2 flex justify-between border-b border-slate-800 pb-2 bg-indigo-900/30 p-4 rounded-xl border border-indigo-500/30 print:bg-transparent print:border-slate-300 print:p-2">
                      <span className="text-indigo-300 font-bold uppercase print:text-slate-600">Total a Pagar:</span>
                      <span className="font-black text-emerald-400 text-2xl print:text-slate-900">R$ {reciboCobranca.totalDevido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="col-span-2 flex justify-between border-b border-slate-800 pb-2 print:border-slate-200">
                      <span className="text-slate-400 font-medium print:text-slate-600">Data de Emissão deste Extrato:</span>
                      <span className="font-bold text-slate-300 print:text-slate-900">{reciboCobranca.dataHoraEmissao}</span>
                    </div>
                  </div>

                  <div className="mb-8">
                    <h4 className="font-bold text-indigo-400 mb-3 uppercase text-xs tracking-wider print:text-slate-700">Relação de Títulos Pendentes</h4>
                    <table className="w-full text-xs text-left border-collapse print:border print:border-slate-300">
                      <thead className="bg-slate-800/50 text-slate-400 print:bg-slate-100 print:text-slate-700">
                        <tr>
                          <th className="py-2 px-3 border border-slate-700/50 rounded-tl-lg print:border-slate-300 print:rounded-none">Emissão</th>
                          <th className="py-2 px-3 border border-slate-700/50 print:border-slate-300">Nota / Parcela</th>
                          <th className="py-2 px-3 text-right border border-slate-700/50 rounded-tr-lg font-bold print:border-slate-300 print:rounded-none">Valor (R$)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reciboCobranca.notas.map(n => (
                          <tr key={n.codigo_lancamento} className="border-b border-slate-700/50 hover:bg-slate-800/30 transition-colors print:border-slate-300 print:hover:bg-transparent">
                            <td className="py-2 px-3 border border-slate-700/30 text-slate-300 print:border-slate-300 print:text-slate-800">{formatarDataComDia(n.data_emissao)}</td>
                            <td className="py-2 px-3 border border-slate-700/30 text-slate-300 print:border-slate-300 print:text-slate-800">{n.numero_documento_fiscal} - {n.numero_parcela}</td>
                            <td className="py-2 px-3 text-right font-bold text-emerald-400 border border-slate-700/30 print:border-slate-300 print:text-slate-900">R$ {n.saldo_devedor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="text-center pt-6 border-t border-slate-800 bg-slate-800/20 rounded-xl p-4 print:bg-transparent print:border-none print:p-2">
                    <p className="text-slate-400 text-sm font-medium print:text-slate-600">Este documento é apenas demonstrativo e não possui valor fiscal ou de quitação.</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 w-full mt-6 print:hidden">
                <button onClick={() => setReciboCobranca(null)} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 rounded-xl transition border border-slate-700">Fechar</button>
                <button onClick={copiarImagemCobranca} disabled={gerandoImagem} className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:text-indigo-400 text-white font-bold py-3 rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20">
                  {gerandoImagem ? <Loader2 size={18} className="animate-spin" /> : <Copy size={18} />}
                  {gerandoImagem ? 'Gerando Imagem...' : 'Copiar Imagem'}
                </button>
                <button onClick={imprimirCobranca} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20">
                  <Printer size={18} /> Imprimir Cobrança
                </button>
              </div>

            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;