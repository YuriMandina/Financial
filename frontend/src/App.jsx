
import React, { useState, useMemo, useRef, useEffect } from 'react';
import html2canvas from 'html2canvas';
import {
  Settings as SettingsIcon, LayoutDashboard, FileText, TrendingUp, Users, Search, CalendarDays,
  Loader2, Database, Printer, Filter, CreditCard, CheckCircle,
  CheckSquare, Square, Calculator, Zap, ArrowDownToLine, ChevronLeft, ChevronRight,
  Receipt, Copy, RotateCcw, X, Target, LogOut, History, PieChart
} from 'lucide-react';
import RateioECusteio from './views/RateioCusteio/RateioCusteioView';
import DateRangePicker from './components/common/DateRangePicker';
import { AuthScreen } from './views/Auth/Auth';
import { VerifyEmail } from './views/Auth/VerifyEmail';
import { Settings } from './views/Settings/Settings';
import { DreGerencial } from './views/DreGerencial/DreGerencialView';
import { converterDataBrParaDate, formatarDataComDia } from './utils/formatters';

import ContasView from './views/Contas/ContasView';
import CurvaABCView from './views/CurvaABC/CurvaABCView';
import DashboardView from './views/Dashboard/DashboardView';
import CartaoCliente from './components/common/CartaoCliente';
import Sidebar from './components/layout/Sidebar';
import Topbar from './components/layout/Topbar';
import ModalRecebimento from './components/modals/ModalRecebimento';
import ModalHistoricoRecibos from './components/modals/ModalHistoricoRecibos';
import ModalSnapshots from './components/modals/ModalSnapshots';
import ProgressModal from './components/common/ProgressModal';
import ReciboPagamento from './components/modals/ReciboPagamento';
import ReciboCobranca from './components/modals/ReciboCobranca';



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
  
  const [activeSyncTasks, setActiveSyncTasks] = useState([]);

  const handleGlobalTaskStart = (taskId, title, onSuccess) => {
    setActiveSyncTasks(prev => [...prev, { taskId, title, onSuccess }]);
  };

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

    if (isForceSync) {
      try {
        let endpointBase = menuAtivo === 'contas-pagas' ? 'contas-pagas' 
          : menuAtivo === 'recebimentos' ? 'recebimentos' 
          : menuAtivo === 'curva-abc' ? 'curva-abc' 
          : menuAtivo === 'dre-gerencial' ? 'dre'
          : 'contas-a-pagar';
          
        if (menuAtivo === 'dashboard') {
            alert("A sincronização em lote do dashboard foi desativada temporariamente. Por favor, sincronize cada módulo individualmente.");
            return;
        }

        const urlSync = `http://localhost:8000/api/relatorios/${endpointBase}/sync`;
        const resSync = await fetchWithAuth(urlSync, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data_inicio: dataInicial, data_fim: dataFinal })
        });
        
        if (!resSync.ok) throw new Error("Falha ao iniciar sincronização.");
        const dataSync = await resSync.json();
        
        const titleMap = {
          'contas-pagas': 'Sincronizando Contas Pagas',
          'recebimentos': 'Sincronizando Recebimentos',
          'curva-abc': 'Sincronizando Curva ABC',
          'dre-gerencial': 'Sincronizando DRE',
          'contas-a-pagar': 'Sincronizando Contas a Pagar'
        };
        const taskTitle = titleMap[menuAtivo] || 'Sincronizando...';

        setActiveSyncTasks(prev => [...prev, { active: true, taskId: dataSync.task_id, title: taskTitle }]);
        return; 
      } catch (err) {
        setActiveSyncTasks(prev => [...prev, { active: true, status: 'error', text: err.message, taskId: `err-${Date.now()}`, title: 'Erro na Sincronização' }]);
        return;
      }
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
        const url = menuAtivo === 'recebimentos' 
          ? `http://localhost:8000/api/relatorios/recebimentos/dados`
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
      console.error(erro);
      setActiveSyncTasks(prev => [...prev, { active: true, status: 'error', text: `Erro: ${erro.message}`, taskId: `err-${Date.now()}`, title: 'Erro ao buscar dados' }]);
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
      <Sidebar menuAtivo={menuAtivo} setMenuAtivo={setMenuAtivo} setContasBrutas={setContasBrutas} setSelecionados={setSelecionados} setClienteFiltro={setClienteFiltro} setContaFiltro={setContaFiltro} setPaginaAtual={setPaginaAtual} />

      {/* ÁREA PRINCIPAL */}
      <main className={`flex-1 flex flex-col relative overflow-y-auto overflow-x-hidden print:!block print:!h-auto print:!overflow-visible ${reciboGerado || reciboCobranca ? 'print:hidden' : ''}`}>

        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-indigo-500/10 rounded-full blur-[100px] transform-gpu pointer-events-none z-0 print:hidden"></div>
        <div className="absolute bottom-[-10%] right-[-5%] w-96 h-96 bg-purple-500/10 rounded-full blur-[100px] transform-gpu pointer-events-none z-0 print:hidden"></div>

        <Topbar menuAtivo={menuAtivo} setMenuAtivo={setMenuAtivo} userName={userName} handleLogout={handleLogout} handleAbrirSnapshots={handleAbrirSnapshots} />

        
        {menuAtivo === 'configuracoes' ? (
          <Settings token={token} />
        ) : menuAtivo === 'desossa' ? (
          <RateioECusteio token={token} onTaskStart={handleGlobalTaskStart} />
        ) : menuAtivo === 'dre-gerencial' ? (
          <DreGerencial token={token} onTaskStart={handleGlobalTaskStart} />
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

              <button onClick={() => handleBuscarDados(true)} disabled={carregandoTela} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-lg font-bold transition-all disabled:opacity-50">
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
          <CurvaABCView resumoCurvaAbc={resumoCurvaAbc} dataInicial={dataInicial} dataFinal={dataFinal} isolarABC={isolarABC} setIsolarABC={setIsolarABC} familiasList={familiasList} familiasFiltro={familiasFiltro} setFamiliasFiltro={setFamiliasFiltro} classeAbcFiltro={classeAbcFiltro} setClasseAbcFiltro={setClasseAbcFiltro} dropFamiliaAberto={dropFamiliaAberto} setDropFamiliaAberto={setDropFamiliaAberto} dropClasseAberto={dropClasseAberto} setDropClasseAberto={setDropClasseAberto} menuAtivo={menuAtivo} carregandoTela={carregandoTela} curvaAbcProcessada={curvaAbcProcessada} contasBrutas={contasBrutas} clienteFiltro={clienteFiltro} setClienteFiltro={setClienteFiltro} setPaginaAtual={setPaginaAtual} setRegistrosPorPagina={setRegistrosPorPagina} />
          {/* ================================================================ */}
          {/* TELAS GENÉRICAS (contas-pagar, contas-pagas, recebimentos…)      */}
          {/* ================================================================ */}
          <ContasView menuAtivo={menuAtivo} carregandoTela={carregandoTela} contasBrutas={contasBrutas} totalGeral={totalGeral} clienteFiltro={clienteFiltro} setClienteFiltro={setClienteFiltro} contaFiltro={contaFiltro} setContaFiltro={setContaFiltro} listaBancos={listaBancos} isolarABC={isolarABC} paginaAtual={paginaAtual} setPaginaAtual={setPaginaAtual} totalItems={totalItems} indiceInicio={indiceInicio} indiceFim={indiceFim} registrosPorPagina={registrosPorPagina} setRegistrosPorPagina={setRegistrosPorPagina} contasFiltradas={contasFiltradas} gruposRecebimentos={gruposRecebimentos} selecionados={selecionados} toggleSelecao={toggleSelecao} toggleTodosCliente={toggleTodosCliente} abrirModalLote={abrirModalLote} gerarCobrancaLote={gerarCobrancaLote} formatarDataComDia={formatarDataComDia} converterDataBrParaDate={converterDataBrParaDate} setModalBaixa={setModalBaixa} handleCarregarHistoricoRecibos={handleCarregarHistoricoRecibos} setModalHistoricoRecibosAberto={setModalHistoricoRecibosAberto} contasCorrentesDisponiveis={contasCorrentesDisponiveis} handleImprimir={handleImprimir} dadosAgrupados={dadosAgrupados} metricsVencimento={metricsVencimento} resumoCategorias={resumoCategorias} totalPaginas={totalPaginas} />
        </div>
          </>
        )}

        <ModalRecebimento modalBaixa={modalBaixa} setModalBaixa={setModalBaixa} calcularTotaisModal={calcularTotaisModal} descGlobalTipo={descGlobalTipo} setDescGlobalTipo={setDescGlobalTipo} descGlobalValor={descGlobalValor} setDescGlobalValor={setDescGlobalValor} jurosGlobalTipo={jurosGlobalTipo} setJurosGlobalTipo={setJurosGlobalTipo} jurosGlobalValor={jurosGlobalValor} setJurosGlobalValor={setJurosGlobalValor} valorTotalRecebido={valorTotalRecebido} setValorTotalRecebido={setValorTotalRecebido} aplicarRateioGlobal={aplicarRateioGlobal} detalhesPagamento={detalhesPagamento} handleAlterarDetalhe={handleAlterarDetalhe} contaDestino={contaDestino} setContaDestino={setContaDestino} listaBancos={listaBancos} dataPagamento={dataPagamento} setDataPagamento={setDataPagamento} processandoBaixa={processandoBaixa} handleEfetuarBaixaLote={handleEfetuarBaixaLote} />
        {/* MODAL 2: RECIBO DE PAGAMENTO */}
        <ReciboPagamento reciboGerado={reciboGerado} setReciboGerado={setReciboGerado} reciboPagamentoRef={reciboPagamentoRef} userName={userName} copiarImagemRecibo={copiarImagemRecibo} imprimirRecibo={imprimirRecibo} gerandoImagem={gerandoImagem} />

        {/* MODAL 3: EXTRATO DE COBRANÇA */}
        <ReciboCobranca reciboCobranca={reciboCobranca} setReciboCobranca={setReciboCobranca} reciboCobrancaRef={reciboCobrancaRef} copiarImagemCobranca={copiarImagemCobranca} imprimirCobranca={imprimirCobranca} gerandoImagem={gerandoImagem} />

        <ModalHistoricoRecibos modalHistoricoRecibosAberto={modalHistoricoRecibosAberto} setModalHistoricoRecibosAberto={setModalHistoricoRecibosAberto} historicoRecibos={historicoRecibos} filtroHistoricoCliente={filtroHistoricoCliente} setFiltroHistoricoCliente={setFiltroHistoricoCliente} filtroHistoricoData={filtroHistoricoData} setFiltroHistoricoData={setFiltroHistoricoData} carregandoHistorico={carregandoHistorico} handleDesfazerBaixa={handleDesfazerBaixa} setReciboGerado={setReciboGerado} />
        <ModalSnapshots modalSnapshotsAberto={modalSnapshotsAberto} setModalSnapshotsAberto={setModalSnapshotsAberto} paginaSnapshots={paginaSnapshots} setPaginaSnapshots={setPaginaSnapshots} registrosPorPaginaSnapshots={registrosPorPaginaSnapshots} setRegistrosPorPaginaSnapshots={setRegistrosPorPaginaSnapshots} modalDataInicial={modalDataInicial} setModalDataInicial={setModalDataInicial} modalDataFinal={modalDataFinal} setModalDataFinal={setModalDataFinal} handleDeletarSnapshot={handleDeletarSnapshot} handleResincronizarSnapshot={handleResincronizarSnapshot} snapshotsPaginados={snapshotsPaginados} totalPaginasSnapshots={totalPaginasSnapshots} totalSnapshots={totalSnapshots} />
        
        <div className="fixed bottom-6 right-6 flex flex-col gap-4 z-[100] items-end pointer-events-none">
          {activeSyncTasks.map((taskState) => (
            <div key={taskState.taskId} className="pointer-events-auto">
              <ProgressModal 
                taskId={taskState.taskId?.startsWith('err-') ? null : taskState.taskId}
                manualState={taskState.taskId?.startsWith('err-') ? taskState : null} 
                onClose={() => setActiveSyncTasks(prev => prev.filter(t => t.taskId !== taskState.taskId))} 
                onSuccess={() => {
                  if (taskState.onSuccess) taskState.onSuccess();
                  handleBuscarDados(false);
                }}
                title={taskState.title}
              />
            </div>
          ))}
        </div>

        </main>
    </div>
      )}
    </>
  );
}

export default App;

