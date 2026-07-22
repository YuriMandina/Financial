import React, { useState, useMemo, useRef, useEffect } from 'react';
import html2canvas from 'html2canvas';
import {
  Settings as SettingsIcon, LayoutDashboard, FileText, TrendingUp, Users, Search, CalendarDays,
  Loader2, Database, Printer, Filter, CreditCard, CheckCircle,
  CheckSquare, Square, Calculator, Zap, ArrowDownToLine, ChevronLeft, ChevronRight,
  Receipt, Copy, RotateCcw, X, Target, LogOut, History, PieChart
} from 'lucide-react';
import RateioECusteio from './rateio_e_custeio';
import DateRangePicker from './DateRangePicker';
import { AuthScreen } from './Auth';
import { VerifyEmail } from './VerifyEmail';
import { Settings } from './Settings';
import { DreGerencial } from './DreGerencial';
import { converterDataBrParaDate, formatarDataComDia } from './utils/formatters';

import ContasView from './views/Contas/ContasView';
import CurvaABCView from './views/CurvaABC/CurvaABCView';
import DashboardView from './views/Dashboard/DashboardView';
import CartaoCliente from './components/common/CartaoCliente';


// --- COMPONENTE PRINCIPAL ---
function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [userName, setUserName] = useState('');

  const fetchWithAuth = async (url, options = {}) => {
    const defaultHeaders = { 'Authorization': `Bearer ${token}` };
    if (options.headers) {
      Object.assign(options.headers, defaultHeaders);
    } else {
      options.headers = defaultHeaders;
    }
    const res = await fetch(url, options);
    if (res.status === 401) {
      setToken('');
      localStorage.removeItem('token');
      throw new Error('Sessão expirada');
    }
    return res;
  };

  const handleLogout = () => {
    setToken('');
    localStorage.removeItem('token');
    window.location.href = '/';
  };

  useEffect(() => {
    if (token) {
      fetchWithAuth('http://localhost:8000/api/auth/me')
        .then(res => res.json())
        .then(data => {
          if (data.name) setUserName(data.name);
          else setUserName(data.email.split('@')[0]);
        })
        .catch(err => console.error(err));
    }
  }, [token]);


  const [dataInicial, setDataInicial] = useState('');
  const [dataFinal, setDataFinal] = useState('');
  const [carregandoTela, setCarregandoTela] = useState(false);
  const [menuAtivo, setMenuAtivo] = useState('dashboard');

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

  const reciboPagamentoRef = useRef(null);
  const [modalHistoricoRecibosAberto, setModalHistoricoRecibosAberto] = useState(false);
  const [historicoRecibos, setHistoricoRecibos] = useState([]);
  const [filtroHistoricoCliente, setFiltroHistoricoCliente] = useState('');
  const [filtroHistoricoData, setFiltroHistoricoData] = useState('');
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);
  const [ultimaSincronizacaoRecebimentos, setUltimaSincronizacaoRecebimentos] = useState(null);

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

  // --- ESTADO EXCLUSIVO: DASHBOARD ---
  const [dashboardData, setDashboardData] = useState(null);

  // --- ESTADOS: GERENCIAMENTO DE SNAPSHOTS ---
  const [modalSnapshotsAberto, setModalSnapshotsAberto] = useState(false);
  const [listaSnapshots, setListaSnapshots] = useState([]);
  const [paginaSnapshots, setPaginaSnapshots] = useState(1);
  const [registrosPorPaginaSnapshots, setRegistrosPorPaginaSnapshots] = useState(10);
  const [modalDataInicial, setModalDataInicial] = useState('');
  const [modalDataFinal, setModalDataFinal] = useState('');

  useEffect(() => {
    if (menuAtivo === 'recebimentos') {
      handleBuscarDados(false);
    }
  }, [menuAtivo]);

  const [dropClienteAberto, setDropClienteAberto] = useState(false);

  const carregarSnapshots = async () => {
    try {
      const res = await fetchWithAuth('http://localhost:8000/api/snapshots');
      const dados = await res.json();
      setListaSnapshots(dados);
    } catch (e) {
      console.error(e);
    }
  };

  const handleAbrirSnapshots = () => {
    carregarSnapshots();
    setPaginaSnapshots(1);
    setModalSnapshotsAberto(true);
  };

  const handleDeletarSnapshot = async (id) => {
    try {
      await fetchWithAuth(`http://localhost:8000/api/snapshots/${id}`, { method: 'DELETE' });
      carregarSnapshots();
    } catch (e) {
      console.error(e);
    }
  };

  const handleResincronizarSnapshot = async (snap) => {
    try {
      await fetchWithAuth(`http://localhost:8000/api/snapshots/${snap.id}`, { method: 'DELETE' });
      
      let url = "";
      if (snap.tipo_relatorio === 'Contas Pagas') {
        url = `http://localhost:8000/api/relatorios/contas-pagas/dados?data_inicio=${snap.data_referencia}&data_fim=${snap.data_referencia}`;
      } else if (snap.tipo_relatorio === 'Vendas PDV' || snap.tipo_relatorio.includes('CMC')) {
        url = `http://localhost:8000/api/relatorios/curva-abc/dados?data_inicio=${snap.data_referencia}&data_fim=${snap.data_referencia}`;
      } else if (snap.tipo_relatorio.includes('Pagar')) {
        url = `http://localhost:8000/api/relatorios/contas-a-pagar/dados?data_inicio=${snap.data_referencia}&data_fim=${snap.data_referencia}`;
      } else if (snap.tipo_relatorio.includes('Receber')) {
        url = `http://localhost:8000/api/relatorios/recebimentos/dados?data_inicio=${snap.data_referencia}&data_fim=${snap.data_referencia}`;
      } else if (snap.tipo_relatorio.includes('Dicionário') || snap.tipo_relatorio.includes('Famílias')) {
        url = `http://localhost:8000/api/relatorios/contas-pagas/dados?data_inicio=2026-01-01&data_fim=2026-01-01`;
      }
      
      if (url) {
        await fetchWithAuth(url);
      }
      carregarSnapshots();
    } catch (e) {
      console.error(e);
    }
  };

  // --- ESTADO EXCLUSIVO: CURVA ABC E LUCRATIVIDADE ---
  const [resumoCurvaAbc, setResumoCurvaAbc] = useState(null);
  const [familiasList, setFamiliasList] = useState([]);       // lista de famílias disponíveis
  const [familiasFiltro, setFamiliasFiltro] = useState([]);   // famílias selecionadas (vazio = todas)
  const [classeAbcFiltro, setClasseAbcFiltro] = useState([]); // classes selecionadas (vazio = todas)
  const [isolarABC, setIsolarABC] = useState(false);
  const [dropFamiliaAberto, setDropFamiliaAberto] = useState(false);
  const [dropClasseAberto, setDropClasseAberto] = useState(false);

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

  const handleBuscarDados = async (isForceSync = false) => {
    if ((!dataInicial || !dataFinal) && menuAtivo !== 'recebimentos') {
      alert("Por favor, selecione a Data Inicial e a Data Final.");
      return;
    }
    setCarregandoTela(true);
    setContaFiltro('TODAS');
    setClienteFiltro('');
    setSelecionados([]);
    setPaginaAtual(1);
    setResumoCurvaAbc(null);
    try {
      // --- ROTEAMENTO DE ENDPOINTS ---
      if (menuAtivo === 'dashboard') {
        const urlPagar = `http://localhost:8000/api/relatorios/contas-a-pagar/dados?data_inicio=${dataInicial}&data_fim=${dataFinal}`;
        const urlPagas = `http://localhost:8000/api/relatorios/contas-pagas/dados?data_inicio=${dataInicial}&data_fim=${dataFinal}`;
        const urlRec = `http://localhost:8000/api/relatorios/recebimentos/dados`;
        
        const [resPagar, resPagas, resRec] = await Promise.all([
          fetchWithAuth(urlPagar),
          fetchWithAuth(urlPagas),
          fetchWithAuth(urlRec)
        ]);
        
        const dadosPagar = resPagar.ok ? await resPagar.json() : { contas: [] };
        const dadosPagas = resPagas.ok ? await resPagas.json() : { contas: [] };
        const dadosRec = resRec.ok ? await resRec.json() : { contas: [] };
        
        setDashboardData({
          pagar: dadosPagar.contas || [],
          pagas: dadosPagas.contas || [],
          receber: dadosRec.contas || []
        });
      } else if (menuAtivo === 'curva-abc') {
        const url = `http://localhost:8000/api/relatorios/curva-abc/dados?data_inicio=${dataInicial}&data_fim=${dataFinal}`;
        const resposta = await fetchWithAuth(url);
        if (!resposta.ok) throw new Error("Erro de comunicação com o servidor.");
        const dados = await resposta.json();
        // Armazena o resumo financeiro global no estado dedicado
        setResumoCurvaAbc(dados.resumo || null);
        // Lista de famílias retornada pelo backend
        setFamiliasList(dados.familias || []);
        setFamiliasFiltro([]);   // reset filtros ao recarregar
        setClasseAbcFiltro([]);
        // Alimenta o estado padrão com a lista de produtos
        setContasBrutas(dados.itens || []);
      } else {
        const endpoint = menuAtivo === 'contas-pagas' ? 'contas-pagas' : menuAtivo === 'recebimentos' ? 'recebimentos' : 'contas-a-pagar';
        const isForce = isForceSync === true;
        const url = menuAtivo === 'recebimentos' 
          ? `http://localhost:8000/api/relatorios/recebimentos/dados?force_sync=${isForce}`
          : `http://localhost:8000/api/relatorios/${endpoint}/dados?data_inicio=${dataInicial}&data_fim=${dataFinal}`;

        const resposta = await fetchWithAuth(url);
        if (!resposta.ok) throw new Error("Erro de comunicação com o servidor.");
        const dados = await resposta.json();
        setContasBrutas(dados.contas || []);
        if (menuAtivo === 'recebimentos') {
          setUltimaSincronizacaoRecebimentos(dados.ultima_sincronizacao || null);
        }

        if (menuAtivo === 'recebimentos' && listaBancos.length === 0) {
          fetchWithAuth('http://localhost:8000/api/geral/bancos')
            .then(res => res.json())
            .then(data => setListaBancos(data))
            .catch(e => console.error(e));
        }
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
    
    const element = reciboCobrancaRef.current;
    const modal = element.closest('.overflow-y-auto');
    const originalScroll = modal ? modal.scrollTop : 0;
    if (modal) modal.scrollTop = 0;

    try {
      const canvas = await html2canvas(element, { 
        backgroundColor: '#0f172a', 
        scale: 4,
        useCORS: true
      });
      
      if (modal) modal.scrollTop = originalScroll;

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
      if (modal) modal.scrollTop = originalScroll;
      alert('Erro interno ao tentar gerar a imagem.');
      console.error(err);
      setGerandoImagem(false);
    }
  };

  const copiarImagemRecibo = async () => {
    if (!reciboPagamentoRef.current) return;
    setGerandoImagem(true);
    
    const element = reciboPagamentoRef.current;
    const modal = element.closest('.overflow-y-auto');
    const originalScroll = modal ? modal.scrollTop : 0;
    if (modal) modal.scrollTop = 0;

    // Workaround: Elevar a assinatura especificamente para o html2canvas
    const assinaturaEl = element.querySelector('#assinatura-modal');
    const originalMarginBottom = assinaturaEl ? assinaturaEl.style.marginBottom : '';
    if (assinaturaEl) assinaturaEl.style.marginBottom = '24px';

    try {
      const canvas = await html2canvas(element, { 
        backgroundColor: '#ffffff', 
        scale: 4,
        useCORS: true
      });
      
      if (assinaturaEl) assinaturaEl.style.marginBottom = originalMarginBottom;
      if (modal) modal.scrollTop = originalScroll;

      canvas.toBlob(async (blob) => {
        try {
          const item = new ClipboardItem({ 'image/png': blob });
          await navigator.clipboard.write([item]);
          alert('Recibo copiado com sucesso! Abra o WhatsApp do cliente e aperte Ctrl+V para colar.');
        } catch (err) {
          alert('Ocorreu um erro ao copiar. Seu navegador pode não suportar a cópia direta de imagens.');
          console.error(err);
        } finally {
          setGerandoImagem(false);
        }
      }, 'image/png');
    } catch (err) {
      if (assinaturaEl) assinaturaEl.style.marginBottom = originalMarginBottom;
      if (modal) modal.scrollTop = originalScroll;
      alert('Erro interno ao tentar gerar a imagem.');
      console.error(err);
      setGerandoImagem(false);
    }
  };

  const handleCarregarHistoricoRecibos = async () => {
    setCarregandoHistorico(true);
    try {
      const res = await fetchWithAuth('http://localhost:8000/api/recibos');
      if (res.ok) {
        const data = await res.json();
        setHistoricoRecibos(data);
      }
    } catch (e) {
      console.error("Erro ao carregar historico", e);
    } finally {
      setCarregandoHistorico(false);
    }
  };

  const handleDesfazerBaixa = async (recibo) => {
    if (!window.confirm(`Deseja realmente desfazer as baixas do recibo #${recibo.id} na Omie? Isso não pode ser revertido e o recibo será excluído do histórico.`)) return;
    try {
      const res = await fetchWithAuth(`http://localhost:8000/api/recibos/${recibo.id}/desfazer`, {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Falha ao desfazer a baixa.");
      alert("Baixa desfeita com sucesso na Omie!");
      handleCarregarHistoricoRecibos();
      handleBuscarDados(); // Refresh current page
    } catch (e) {
      alert("Erro: " + e.message);
    }
  };

  const imprimirCobranca = () => {
    if (!reciboCobranca) return;
    const linhas = reciboCobranca.notas.map(n => `
      <tr>
        <td style="padding:6px 10px;border:1px solid #cbd5e1;">${n.data_emissao || '-'}</td>
        <td style="padding:6px 10px;border:1px solid #cbd5e1;">${n.numero_documento_fiscal} - ${n.numero_parcela}</td>
        <td style="padding:6px 10px;text-align:right;font-weight:bold;border:1px solid #cbd5e1;">R$ ${n.saldo_devedor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
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
      <div class="total-box"><span class="label">Total a Pagar</span><span class="value">R$ ${reciboCobranca.totalDevido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div>
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
    
    const notasOrdenadas = [...reciboGerado.notas].sort((a, b) => {
      const dataA = converterDataBrParaDate(a.contaOriginal.data_emissao).getTime();
      const dataB = converterDataBrParaDate(b.contaOriginal.data_emissao).getTime();
      return dataB - dataA;
    });

    const linhas = notasOrdenadas.map(n => `
      <tr>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;">${n.contaOriginal.data_emissao || '-'}</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;">${n.contaOriginal.numero_documento_fiscal} - ${n.contaOriginal.numero_parcela}</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;">R$ ${n.contaOriginal.saldo_devedor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;">${n.desconto > 0 ? `<span style="color:#ef4444;">-R$ ${n.desconto.toLocaleString('pt-BR')}</span>` : ''
      }${n.juros > 0 ? `<span style="color:#f59e0b;"> +R$ ${n.juros.toLocaleString('pt-BR')}</span>` : ''}${n.desconto === 0 && n.juros === 0 ? '-' : ''}</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-weight:bold;color:#059669;">R$ ${n.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
      </tr>`).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Recibo de Pagamento</title>
      <link href="https://fonts.googleapis.com/css2?family=Great+Vibes&display=swap" rel="stylesheet">
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
      <div class="total-box"><span class="label">Valor Total Pago</span><span class="value">R$ ${reciboGerado.totalPago.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div>
      <div class="row"><span class="label">Data de Pagamento:</span><span class="value">${reciboGerado.data_pagamento}</span></div>
      <div class="row"><span class="label">Conta de Destino:</span><span class="value">${reciboGerado.banco || '-'}</span></div>
      <div class="row"><span class="label">Subtotal Original:</span><span class="value">R$ ${reciboGerado.totalOriginal.toLocaleString('pt-BR')}</span></div>
      <div class="row"><span class="label">Descontos / Juros:</span><span class="value">-R$ ${reciboGerado.totalDesconto.toLocaleString('pt-BR')} / +R$ ${reciboGerado.totalJuros.toLocaleString('pt-BR')}</span></div>
      <p class="section-title">Composição das Notas Recebidas</p>
      <table>
        <thead><tr><th>Emissão</th><th>Nota / Parcela</th><th style="text-align:right">Original</th><th style="text-align:right">Desc/Juros</th><th style="text-align:right">Pago</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
      <div class="assinatura">
        <div style="font-family: 'Great Vibes', cursive; font-size: 44px; color: #1e293b; margin-bottom: 4px;">${userName}</div>
        <div class="linha"></div>
        <p style="margin-top: 8px;">Assinatura do Recebedor / Responsável</p>
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

      const res = await fetchWithAuth('http://localhost:8000/api/relatorios/recebimentos/baixar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Erro ao processar as notas.");

      const bancoSelecionado = listaBancos.find(b => b.id === contaDestino)?.nome;
      const totais = calcularTotaisModal();

      const pagamentosComBaixa = pagamentosTratados.map(p => {
        const baixaEncontrada = data.baixas?.find(b => b.codigo_lancamento === p.codigo_lancamento);
        return {
           ...p,
           codigo_baixa: baixaEncontrada ? baixaEncontrada.codigo_baixa : null
        };
      });

      const novoRecibo = {
        cliente: modalBaixa.cliente,
        banco: bancoSelecionado,
        data_pagamento: `${dia}/${mes}/${ano}`,
        totalOriginal: totais.totalOriginal,
        totalDesconto: totais.totalDesconto,
        totalJuros: totais.totalJuros,
        totalPago: totais.totalPago,
        notas: pagamentosComBaixa
      };

      try {
        await fetchWithAuth('http://localhost:8000/api/recibos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(novoRecibo)
        });
      } catch (err) {
        console.error("Erro ao salvar recibo:", err);
      }

      setReciboGerado(novoRecibo);

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

  const curvaAbcProcessada = useMemo(() => {
    if (menuAtivo !== 'curva-abc' || !resumoCurvaAbc || contasBrutas.length === 0) return { itens: [], resumoKpi: null };

    // 1. Filtragem por texto do produto
    let itensFiltrados = clienteFiltro.trim()
      ? contasBrutas.filter(p =>
        p.descricao_produto && p.descricao_produto.toLowerCase().includes(clienteFiltro.toLowerCase())
      )
      : contasBrutas;

    // 2. Filtragem por família
    if (familiasFiltro.length > 0) {
      itensFiltrados = itensFiltrados.filter(p => familiasFiltro.includes(p.familia_produto));
    }

    // -- RECALCULAR ABC SE isolarABC --
    let kpiReceita = 0, kpiLucro = 0, kpiMargem = 0;

    if (isolarABC && itensFiltrados.length > 0) {
        const totalReceitaFiltrada = itensFiltrados.reduce((s, p) => s + (p.receita_total || 0), 0);
        let isolados = itensFiltrados.map(p => ({...p}));
        
        isolados.forEach(p => {
            p.participacao_perc = totalReceitaFiltrada ? (p.receita_total / totalReceitaFiltrada) * 100 : 0;
        });
        
        isolados.sort((a, b) => b.participacao_perc - a.participacao_perc);
        
        let acum = 0;
        isolados.forEach(p => {
            acum += p.participacao_perc;
            p.participacao_acumulada = acum;
            if (acum <= 21.0) p.classe_abc = 'A';
            else if (acum <= 51.0) p.classe_abc = 'B';
            else p.classe_abc = 'C';
        });
        
        itensFiltrados = isolados;
        
        kpiReceita = totalReceitaFiltrada;
        kpiLucro = itensFiltrados.reduce((s, p) => s + (p.lucro_bruto || 0), 0);
        kpiMargem = kpiReceita !== 0 ? (kpiLucro / kpiReceita) * 100 : 0;
    } else {
        kpiReceita = resumoCurvaAbc.receita_total;
        kpiLucro = resumoCurvaAbc.lucro_bruto_total;
        kpiMargem = resumoCurvaAbc.margem_media_perc;
    }

    // 3. Filtragem por classe ABC
    if (classeAbcFiltro.length > 0) {
      itensFiltrados = itensFiltrados.filter(p => classeAbcFiltro.includes(p.classe_abc));
    }

    return { 
      itens: itensFiltrados, 
      resumoKpi: {
         receita_total: kpiReceita,
         lucro_bruto_total: kpiLucro,
         margem_media_perc: kpiMargem
      }
    };
  }, [contasBrutas, menuAtivo, clienteFiltro, familiasFiltro, classeAbcFiltro, isolarABC, resumoCurvaAbc]);

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

  const metricsVencimento = useMemo(() => {
    if (menuAtivo !== 'recebimentos') return { acima30: 0, acima60: 0, acima90: 0, totalAcima30: 0, totalAcima60: 0, totalAcima90: 0 };
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    let acima30 = 0, acima60 = 0, acima90 = 0;
    let totalAcima30 = 0, totalAcima60 = 0, totalAcima90 = 0;
    contasFiltradas.forEach(c => {
      const venc = converterDataBrParaDate(c.data_previsao_br);
      if (venc >= new Date(9999, 0)) return; // sem data válida
      const diffDias = Math.floor((hoje - venc) / (1000 * 60 * 60 * 24));
      if (diffDias > 90) { acima90++; totalAcima90 += c.saldo_devedor; }
      if (diffDias > 60) { acima60++; totalAcima60 += c.saldo_devedor; }
      if (diffDias > 30) { acima30++; totalAcima30 += c.saldo_devedor; }
    });
    return { acima30, acima60, acima90, totalAcima30, totalAcima60, totalAcima90 };
  }, [contasFiltradas, menuAtivo]);

  const contasCorrentesDisponiveis = useMemo(() => {
    if (menuAtivo === 'contas-a-pagar') return [];
    return [...new Set(contasBrutas.map(c => c.conta_corrente))].sort();
  }, [contasBrutas, menuAtivo]);

  const snapshotsFiltrados = useMemo(() => {
    let filtrados = listaSnapshots.filter(snap => {
      if (menuAtivo === 'dashboard') return true;
      if (menuAtivo === 'contas-pagar') return snap.tipo_relatorio === 'Contas a Pagar (Abertas)' || snap.tipo_relatorio.includes('Dicionário de');
      if (menuAtivo === 'contas-pagas') return snap.tipo_relatorio === 'Contas Pagas' || snap.tipo_relatorio.includes('Dicionário de');
      if (menuAtivo === 'recebimentos') return snap.tipo_relatorio === 'Contas a Receber (Abertas)' || snap.tipo_relatorio.includes('Dicionário de');
      if (menuAtivo === 'curva-abc') return snap.tipo_relatorio === 'Vendas PDV' || snap.tipo_relatorio.includes('CMC') || snap.tipo_relatorio.includes('Famílias');
      return true;
    });

    if (modalDataInicial || modalDataFinal) {
      filtrados = filtrados.filter(snap => {
        if (snap.data_referencia === 'Global') return false; // Hide globals when filtering by date
        if (modalDataInicial && snap.data_referencia < modalDataInicial) return false;
        if (modalDataFinal && snap.data_referencia > modalDataFinal) return false;
        return true;
      });
    }

    filtrados.sort((a, b) => {
      if (a.data_referencia === 'Global' && b.data_referencia !== 'Global') return 1;
      if (b.data_referencia === 'Global' && a.data_referencia !== 'Global') return -1;
      if (a.data_referencia > b.data_referencia) return -1;
      if (a.data_referencia < b.data_referencia) return 1;
      return b.id - a.id;
    });

    return filtrados;
  }, [listaSnapshots, menuAtivo, modalDataInicial, modalDataFinal]);

  const totalSnapshots = snapshotsFiltrados.length;
  const totalPaginasSnapshots = Math.ceil(totalSnapshots / registrosPorPaginaSnapshots) || 1;
  const indexInicioSnapshots = (paginaSnapshots - 1) * registrosPorPaginaSnapshots;
  const indexFimSnapshots = indexInicioSnapshots + registrosPorPaginaSnapshots;
  const snapshotsPaginados = snapshotsFiltrados.slice(indexInicioSnapshots, indexFimSnapshots);

  const tituloModulo = menuAtivo === 'contas-pagas' ? 'Módulo de Contas Pagas'
    : menuAtivo === 'recebimentos' ? 'Módulo de Convênios'
      : menuAtivo === 'curva-abc' ? 'Análise de Lucratividade'
        : menuAtivo === 'dashboard' ? 'Visão Geral Financeira'
          : menuAtivo === 'dre-gerencial' ? 'DRE Gerencial'
            : menuAtivo === 'desossa' ? 'Rateio e Custeio'
            : 'Módulo de Contas a Pagar';
  const descModulo = menuAtivo === 'contas-pagas' ? 'Sincronize as baixas realizadas e concilie contas correntes.'
    : menuAtivo === 'recebimentos' ? 'Acompanhe faturas de convênios, edite pagamentos parciais e gere recibos.'
      : menuAtivo === 'curva-abc' ? 'Avalie o peso e a margem de cada produto na sua operação.'
        : menuAtivo === 'dashboard' ? 'Acompanhe os principais indicadores de saúde financeira do seu negócio.'
          : menuAtivo === 'dre-gerencial' ? 'Demonstrativo de Resultado do Exercício por competência.'
            : menuAtivo === 'desossa' ? 'Rateio por Preço de Venda do processo de Desossa.'
            : 'Sincronize os dados e imprima o relatório detalhado.';
  const tituloRelatorio = menuAtivo === 'contas-pagas' ? 'Pagamentos Realizados'
    : menuAtivo === 'recebimentos' ? 'Títulos a Receber (Convênio)'
      : menuAtivo === 'curva-abc' ? 'Curva ABC e Lucratividade'
        : menuAtivo === 'dashboard' ? 'Dashboard Executivo'
          : menuAtivo === 'dre-gerencial' ? 'DRE Gerencial'
            : menuAtivo === 'desossa' ? 'Rateio e Custeio'
            : 'Previsão de Pagamentos';

  const SidebarItem = ({ id, icone: Icon, texto }) => (
    <button onClick={() => { setMenuAtivo(id); setContasBrutas([]); setSelecionados([]); setClienteFiltro(''); setContaFiltro('TODAS'); setPaginaAtual(1); }}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 print:hidden ${menuAtivo === id ? 'bg-gradient-to-r from-indigo-500/20 to-purple-500/20 text-indigo-400 border border-indigo-500/30 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]' : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
        }`}>
      <Icon size={20} className={menuAtivo === id ? 'text-indigo-400' : ''} />
      <span className="font-medium text-left text-sm">{texto}</span>
    </button>
  );

  // Roteamento manual básico
  const path = window.location.pathname;

  return (
    <>
      {path === '/verify-email' ? (
        <VerifyEmail onVerified={setToken} />
      ) : !token ? (
        <AuthScreen onLogin={setToken} />
      ) : (
        <div className="flex h-screen bg-slate-950 font-sans overflow-hidden print:!block print:bg-white print:text-slate-900 print:!h-auto print:!overflow-visible">

      {/* SIDEBAR */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col z-20 print:hidden">
        <div className="h-20 shrink-0 flex items-center px-6 border-b border-slate-800">
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
          <SidebarItem id="curva-abc" icone={TrendingUp} texto="Curva ABC e Lucratividade" />
          <SidebarItem id="dre-gerencial" icone={Target} texto="DRE Gerencial" />
          <SidebarItem id="desossa" icone={PieChart} texto="Rateio e Custeio" />
        </nav>
      </aside>

      {/* ÁREA PRINCIPAL */}
      <main className={`flex-1 flex flex-col relative overflow-y-auto overflow-x-hidden print:!block print:!h-auto print:!overflow-visible ${reciboGerado || reciboCobranca ? 'print:hidden' : ''}`}>

        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-indigo-500/10 rounded-full blur-[100px] transform-gpu pointer-events-none z-0 print:hidden"></div>
        <div className="absolute bottom-[-10%] right-[-5%] w-96 h-96 bg-purple-500/10 rounded-full blur-[100px] transform-gpu pointer-events-none z-0 print:hidden"></div>

        <header className="h-20 shrink-0 bg-slate-900/95 border-b border-slate-800 flex items-center justify-end px-8 z-50 sticky top-0 print:hidden">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setMenuAtivo('configuracoes')}
              className={`p-2 rounded-xl transition-all ${menuAtivo === 'configuracoes' ? 'bg-indigo-600/20 text-indigo-400' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
              title="Configurações"
            >
              <SettingsIcon size={20} />
            </button>
            <button
              onClick={handleLogout}
              className="p-2 rounded-xl text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition-all"
              title="Sair da Conta"
            >
              <LogOut size={20} />
            </button>
            <div className="flex items-center gap-3 bg-slate-900 px-4 py-2 rounded-xl border border-slate-800 shadow-inner">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                <Users size={16} className="text-indigo-400" />
              </div>
              <p className="text-sm font-medium text-slate-200 hidden md:block">{userName || 'Carregando...'}</p>
            </div>
          </div>
        </header>

        
        {menuAtivo === 'configuracoes' ? (
          <Settings token={token} />
        ) : menuAtivo === 'desossa' ? (
          <RateioECusteio token={token} />
        ) : menuAtivo === 'dre-gerencial' ? (
          <DreGerencial token={token} />
        ) : (
          <>
          <div className="flex-1 p-8 z-10 print:!p-0 print:!m-0 print:!block print:!overflow-visible">


          <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 mb-8 print:hidden">
            <div>
              <h2 className="text-3xl font-bold text-white mb-2">{tituloModulo}</h2>
              <p className="text-slate-400">{descModulo}</p>
            </div>

            <div className="bg-slate-900/80 border border-white/[0.05] rounded-2xl p-4 flex flex-col sm:flex-row items-center gap-4">
              {menuAtivo !== 'recebimentos' && (
                <DateRangePicker
                  startValue={dataInicial}
                  endValue={dataFinal}
                  onStartChange={setDataInicial}
                  onEndChange={setDataFinal}
                  disabled={carregandoTela}
                />
              )}

              <button onClick={() => handleBuscarDados(menuAtivo === 'recebimentos')} disabled={carregandoTela} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-lg font-bold transition-all disabled:opacity-50">
                {carregandoTela ? <Loader2 className="animate-spin" size={16} /> : <Database size={16} />}
                SINCRONIZAR DADOS
              </button>
              {menuAtivo !== 'recebimentos' ? (
                <button onClick={handleAbrirSnapshots} className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-5 py-2.5 rounded-lg font-bold transition-all">
                  <Database size={16} />
                  BASE DE DADOS
                </button>
              ) : (
                ultimaSincronizacaoRecebimentos && (
                  <div className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-slate-800/50 border border-slate-700 text-slate-300 font-medium text-sm">
                    <Database size={16} className="text-slate-500" />
                    Última sincronização: {ultimaSincronizacaoRecebimentos}
                  </div>
                )
              )}
              {menuAtivo === 'recebimentos' && (
                <button onClick={() => { handleCarregarHistoricoRecibos(); setModalHistoricoRecibosAberto(true); }} className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-lg font-bold transition-all">
                  <Receipt size={16} />
                  HISTÓRICO DE RECIBOS
                </button>
              )}
            </div>
          </div>

          <div className={`hidden ${menuAtivo !== 'curva-abc' ? 'print:flex' : ''} items-center justify-between border-b-2 border-slate-800 pb-4 mb-6 mt-4 print:px-2`}>
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
              {menuAtivo !== 'recebimentos' && (
                <p className="text-sm font-medium text-slate-600 mt-1">Período: {dataInicial.split('-').reverse().join('/')} a {dataFinal.split('-').reverse().join('/')}</p>
              )}
            </div>
          </div>

          {/* ================================================================ */}
          {/* TELA: CURVA ABC E LUCRATIVIDADE                                  */}
          {/* ================================================================ */}
          <CurvaABCView resumoCurvaAbc={resumoCurvaAbc} dataInicial={dataInicial} dataFinal={dataFinal} isolarABC={isolarABC} setIsolarABC={setIsolarABC} familiasList={familiasList} familiasFiltro={familiasFiltro} setFamiliasFiltro={setFamiliasFiltro} classeAbcFiltro={classeAbcFiltro} setClasseAbcFiltro={setClasseAbcFiltro} dropFamiliaAberto={dropFamiliaAberto} setDropFamiliaAberto={setDropFamiliaAberto} dropClasseAberto={dropClasseAberto} setDropClasseAberto={setDropClasseAberto} menuAtivo={menuAtivo} carregandoTela={carregandoTela} curvaAbcProcessada={curvaAbcProcessada} contasBrutas={contasBrutas} clienteFiltro={clienteFiltro} setClienteFiltro={setClienteFiltro} setPaginaAtual={setPaginaAtual} setRegistrosPorPagina={setRegistrosPorPagina} />

          {/* ================================================================ */}
          {/* TELA: DASHBOARD (VISÃO GERAL)                                    */}
          {/* ================================================================ */}
          {menuAtivo === 'dashboard' && <DashboardView carregandoTela={carregandoTela} dashboardData={dashboardData} />}
          {/* ================================================================ */}
          {/* TELAS GENÉRICAS (contas-pagar, contas-pagas, recebimentos…)      */}
          {/* ================================================================ */}
          <ContasView menuAtivo={menuAtivo} carregandoTela={carregandoTela} contasBrutas={contasBrutas} totalGeral={totalGeral} clienteFiltro={clienteFiltro} setClienteFiltro={setClienteFiltro} contaFiltro={contaFiltro} setContaFiltro={setContaFiltro} listaBancos={listaBancos} isolarABC={isolarABC} paginaAtual={paginaAtual} setPaginaAtual={setPaginaAtual} totalItems={totalItems} indiceInicio={indiceInicio} indiceFim={indiceFim} registrosPorPagina={registrosPorPagina} setRegistrosPorPagina={setRegistrosPorPagina} contasFiltradas={contasFiltradas} gruposRecebimentos={gruposRecebimentos} selecionados={selecionados} toggleSelecao={toggleSelecao} toggleTodosCliente={toggleTodosCliente} abrirModalLote={abrirModalLote} gerarCobrancaLote={gerarCobrancaLote} formatarDataComDia={formatarDataComDia} converterDataBrParaDate={converterDataBrParaDate} setModalBaixa={setModalBaixa} handleCarregarHistoricoRecibos={handleCarregarHistoricoRecibos} setModalHistoricoRecibosAberto={setModalHistoricoRecibosAberto} contasCorrentesDisponiveis={contasCorrentesDisponiveis} handleImprimir={handleImprimir} dadosAgrupados={dadosAgrupados} metricsVencimento={metricsVencimento} resumoCategorias={resumoCategorias} totalPaginas={totalPaginas} />
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
            <div className="flex flex-col items-center max-w-2xl w-full my-8 print:my-0 print:w-full print:max-w-none">
            <div className="bg-white text-slate-900 rounded-2xl w-full shadow-2xl print:shadow-none print:w-full print:max-w-none relative print:my-0 overflow-hidden">
              <div ref={reciboPagamentoRef} className="bg-white p-10 print:p-0">
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
                      <th className="py-2 px-3 rounded-l-lg">Emissão</th>
                      <th className="py-2 px-3">Nota/Parc</th>
                      <th className="py-2 px-3 text-right">Original</th>
                      <th className="py-2 px-3 text-right">Desc/Juros</th>
                      <th className="py-2 px-3 text-right rounded-r-lg font-bold">Pago</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...reciboGerado.notas].sort((a,b) => {
                      const dataA = converterDataBrParaDate(a.contaOriginal?.data_emissao || '').getTime();
                      const dataB = converterDataBrParaDate(b.contaOriginal?.data_emissao || '').getTime();
                      return dataB - dataA;
                    }).map(n => (
                      <tr key={n.codigo_lancamento} className="border-b border-slate-100">
                        <td className="py-2 px-3">{n.contaOriginal?.data_emissao || '-'}</td>
                        <td className="py-2 px-3">{n.contaOriginal?.numero_documento_fiscal} - {n.contaOriginal?.numero_parcela}</td>
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

              <div className="text-center pt-8 border-t border-slate-200 mt-8">
                <div id="assinatura-modal" style={{ fontFamily: "'Great Vibes', cursive" }} className="text-5xl text-slate-800 mb-2 relative z-10">{userName}</div>
                <div className="w-72 h-[1px] bg-slate-800 mx-auto relative z-0"></div>
                <p className="text-slate-400 text-sm mt-2">Assinatura do Recebedor / Responsável</p>
              </div>
              </div>

              <div className="flex gap-4 mt-2 px-10 pb-10 print:hidden w-full">
                <button onClick={() => setReciboGerado(null)} className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold py-3 rounded-xl transition">Fechar</button>
                <button onClick={copiarImagemRecibo} disabled={gerandoImagem} className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:text-indigo-400 text-white font-bold py-3 rounded-xl transition flex items-center justify-center gap-2">
                  {gerandoImagem ? <Loader2 size={18} className="animate-spin" /> : <Copy size={18} />}
                  {gerandoImagem ? 'Gerando...' : 'Copiar Imagem'}
                </button>
                <button onClick={imprimirRecibo} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl transition flex items-center justify-center gap-2">
                  <Printer size={18} /> Imprimir Recibo
                </button>
              </div>
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
        {/* MODAL HISTORICO DE RECIBOS */}
        {modalHistoricoRecibosAberto && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
              <div className="p-6 border-b border-slate-800 flex flex-col sm:flex-row sm:justify-between sm:items-center bg-slate-900 gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-white">Histórico de Recibos</h2>
                  <p className="text-sm text-slate-400 font-medium">Consulte, imprima ou desfaça recebimentos anteriores</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex bg-slate-800/50 border border-white/[0.05] rounded-xl p-1 shadow-sm gap-2">
                    <input 
                      type="text" 
                      placeholder="Cliente..." 
                      className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none w-32 md:w-48"
                      value={filtroHistoricoCliente}
                      onChange={(e) => setFiltroHistoricoCliente(e.target.value)}
                    />
                    <input 
                      type="date" 
                      className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none [color-scheme:dark]"
                      value={filtroHistoricoData}
                      onChange={(e) => setFiltroHistoricoData(e.target.value)}
                    />
                  </div>
                  <button onClick={() => setModalHistoricoRecibosAberto(false)} className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400">
                    <X size={24} />
                  </button>
                </div>
              </div>

              <div className="p-6 overflow-y-auto bg-slate-950 flex-1">
                <div className="bg-slate-900 rounded-xl shadow-lg border border-slate-800 overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-800/50 border-b border-slate-800">
                        <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase">ID</th>
                        <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase">Cliente</th>
                        <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase">Data Pgto</th>
                        <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase">Valor Total</th>
                        <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {carregandoHistorico ? (
                        <tr><td colSpan="5" className="text-center py-8 text-slate-400"><Loader2 className="animate-spin mx-auto" /></td></tr>
                      ) : (
                        historicoRecibos.filter(r => {
                          const matchCli = r.cliente.toLowerCase().includes(filtroHistoricoCliente.toLowerCase());
                          const dataFiltroBr = filtroHistoricoData ? filtroHistoricoData.split('-').reverse().join('/') : '';
                          const matchData = dataFiltroBr ? r.data_pagamento === dataFiltroBr : true;
                          return matchCli && matchData;
                        }).map(rec => (
                          <tr key={rec.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                            <td className="px-4 py-3 text-sm text-slate-400 font-medium">#{rec.id}</td>
                            <td className="px-4 py-3 text-sm text-slate-300 font-bold">{rec.cliente}</td>
                            <td className="px-4 py-3 text-sm text-slate-400">{rec.data_pagamento}</td>
                            <td className="px-4 py-3 text-sm text-emerald-400 font-bold">R$ {rec.totalPago.toLocaleString('pt-BR', {minimumFractionDigits:2})}</td>
                            <td className="px-4 py-3 text-sm text-right flex justify-end gap-2">
                              <button onClick={() => handleDesfazerBaixa(rec)} className="bg-red-500/10 text-red-400 hover:bg-red-500/20 px-3 py-1.5 rounded font-bold text-xs transition-colors flex items-center gap-1">
                                <RotateCcw size={14} /> Desfazer
                              </button>
                              <button onClick={() => { setReciboGerado(rec); setModalHistoricoRecibosAberto(false); }} className="bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 px-3 py-1.5 rounded font-bold text-xs transition-colors flex items-center gap-1">
                                <Printer size={14} /> Abrir Recibo
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                      {!carregandoHistorico && historicoRecibos.length === 0 && (
                        <tr>
                          <td colSpan="5" className="px-4 py-8 text-center text-slate-400 font-medium">Nenhum recibo salvo.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MODAL SNAPSHOTS */}
        {modalSnapshotsAberto && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
              <div className="p-6 border-b border-slate-800 flex flex-col sm:flex-row sm:justify-between sm:items-center bg-slate-900 gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-white">Base de Dados Sincronizada</h2>
                  <p className="text-sm text-slate-400 font-medium">Gerencie o histórico de dados já importados por dia</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="bg-slate-800/50 border border-white/[0.05] rounded-xl p-1 shadow-sm">
                    <DateRangePicker
                      startValue={modalDataInicial}
                      endValue={modalDataFinal}
                      onStartChange={(val) => { setModalDataInicial(val); setPaginaSnapshots(1); }}
                      onEndChange={(val) => { setModalDataFinal(val); setPaginaSnapshots(1); }}
                    />
                  </div>
                  <button onClick={() => setModalSnapshotsAberto(false)} className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400">
                    <X size={24} />
                  </button>
                </div>
              </div>

              <div className="p-6 overflow-y-auto bg-slate-950 flex-1">
                <div className="bg-slate-900 rounded-xl shadow-lg border border-slate-800 overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-800/50 border-b border-slate-800">
                        <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase">ID</th>
                        <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase">Relatório</th>
                        <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase">Data Ref.</th>
                        <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase">Sincronizado Em</th>
                        <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshotsPaginados.map(snap => (
                        <tr key={snap.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                          <td className="px-4 py-3 text-sm text-slate-400 font-medium">{snap.id}</td>
                          <td className="px-4 py-3 text-sm text-slate-300 font-bold">{snap.tipo_relatorio}</td>
                          <td className="px-4 py-3 text-sm text-indigo-400 font-bold">{snap.data_referencia}</td>
                          <td className="px-4 py-3 text-sm text-slate-500">{snap.created_at}</td>
                          <td className="px-4 py-3 text-sm text-right flex justify-end gap-2">
                            <button onClick={() => handleDeletarSnapshot(snap.id)} className="bg-red-500/10 text-red-400 hover:bg-red-500/20 px-3 py-1.5 rounded font-bold text-xs transition-colors">Excluir</button>
                            <button onClick={() => handleResincronizarSnapshot(snap)} className="bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 px-3 py-1.5 rounded font-bold text-xs transition-colors flex items-center gap-1">
                              <RotateCcw size={14} /> Resincronizar
                            </button>
                          </td>
                        </tr>
                      ))}
                      {snapshotsPaginados.length === 0 && (
                        <tr>
                          <td colSpan="5" className="px-4 py-8 text-center text-slate-400 font-medium">Nenhum dado sincronizado encontrado para este relatório.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {snapshotsFiltrados.length > 0 && (
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-4 bg-slate-900 p-4 rounded-xl shadow-lg border border-slate-800">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-400">Mostrar</span>
                      <select 
                        className="border border-slate-700 rounded p-1 text-sm text-slate-300 bg-slate-800 outline-none"
                        value={registrosPorPaginaSnapshots}
                        onChange={(e) => {
                          setRegistrosPorPaginaSnapshots(Number(e.target.value));
                          setPaginaSnapshots(1);
                        }}
                      >
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                      </select>
                      <span className="text-sm text-slate-400">por página</span>
                    </div>

                    <div className="flex items-center gap-4">
                      <span className="text-sm font-medium text-slate-400">
                        Página {paginaSnapshots} de {totalPaginasSnapshots}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setPaginaSnapshots(p => Math.max(1, p - 1))}
                          disabled={paginaSnapshots === 1}
                          className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <button
                          onClick={() => setPaginaSnapshots(p => Math.min(totalPaginasSnapshots, p + 1))}
                          disabled={paginaSnapshots === totalPaginasSnapshots}
                          className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        </>
        )}
      </main>
    </div>
      )}
    </>
  );
}

export default App;

