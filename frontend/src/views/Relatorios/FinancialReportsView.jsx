import React, { useState, useMemo, useRef, useEffect, startTransition } from 'react';
import html2canvas from 'html2canvas';
import {
  TrendingUp, Loader2, Database, Receipt
} from 'lucide-react';

import DateRangePicker from '../../components/common/DateRangePicker';
import ContasView from '../Contas/ContasView';
import CurvaABCView from '../CurvaABC/CurvaABCView';
import DashboardView from '../Dashboard/DashboardView';

import ModalRecebimento from '../../components/modals/ModalRecebimento';
import ModalHistoricoRecibos from '../../components/modals/ModalHistoricoRecibos';
import ModalSnapshots from '../../components/modals/ModalSnapshots';
import ReciboPagamento from '../../components/modals/ReciboPagamento';
import ReciboCobranca from '../../components/modals/ReciboCobranca';

import { useAuth } from '../../context/AuthContext';
import { useTaskSync } from '../../context/TaskSyncContext';
import { converterDataBrParaDate } from '../../utils/formatters';
import { API_BASE } from '../../config/api';

export default function FinancialReportsView({ menuAtivo, onMenuChange }) {
  const { token, userName, fetchWithAuth } = useAuth();
  const { handleGlobalTaskStart, globalRefreshCounter, triggerGlobalRefresh } = useTaskSync();

  // --- [BLOCO: Estados e Parâmetros de Filtro] ---
  const [dataInicial, setDataInicial] = useState(() => sessionStorage.getItem(`dt_ini_${menuAtivo}`) || '');
  const [dataFinal, setDataFinal] = useState(() => sessionStorage.getItem(`dt_fim_${menuAtivo}`) || '');
  const [carregandoTela, setCarregandoTela] = useState(false);
  const [contasBrutas, setContasBrutas] = useState([]);
  const [contaFiltro, setContaFiltro] = useState('TODAS');
  const [clienteFiltro, setClienteFiltro] = useState('');
  const [paginaAtual, setPaginaAtual] = useState(1);
  const [registrosPorPagina, setRegistrosPorPagina] = useState(50);

  // Estados Curva ABC
  const [resumoCurvaAbc, setResumoCurvaAbc] = useState(null);
  const [familiasList, setFamiliasList] = useState([]);
  const [familiasFiltro, setFamiliasFiltro] = useState([]);
  const [classeAbcFiltro, setClasseAbcFiltro] = useState([]);
  const [isolarABC, setIsolarABC] = useState(false);
  const [dropFamiliaAberto, setDropFamiliaAberto] = useState(false);
  const [dropClasseAberto, setDropClasseAberto] = useState(false);

  // Estados Dashboard
  const [dashboardData, setDashboardData] = useState(null);

  // Estados de Baixa e Recibos
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

  // Estados de Snapshots
  const [modalSnapshotsAberto, setModalSnapshotsAberto] = useState(false);
  const [listaSnapshots, setListaSnapshots] = useState([]);
  const [paginaSnapshots, setPaginaSnapshots] = useState(1);
  const [registrosPorPaginaSnapshots, setRegistrosPorPaginaSnapshots] = useState(10);
  const [modalDataInicial, setModalDataInicial] = useState('');
  const [modalDataFinal, setModalDataFinal] = useState('');

  // Persistência do filtro de data por menu
  useEffect(() => {
    if (dataInicial) sessionStorage.setItem(`dt_ini_${menuAtivo}`, dataInicial);
    if (dataFinal) sessionStorage.setItem(`dt_fim_${menuAtivo}`, dataFinal);
  }, [dataInicial, dataFinal, menuAtivo]);

  // Reset de filtros pontuais ao trocar de menu
  useEffect(() => {
    setContasBrutas([]);
    setSelecionados([]);
    setClienteFiltro('');
    setContaFiltro('TODAS');
    setPaginaAtual(1);
    if (menuAtivo === 'recebimentos') {
      handleBuscarDados(false);
    }
  }, [menuAtivo]);

  useEffect(() => {
    if (globalRefreshCounter > 0) {
      handleBuscarDados(false);
    }
  }, [globalRefreshCounter]);

  // --- [BLOCO: Consulta de Dados e Sincronização Omie] ---
  const handleBuscarDados = async (isForceSync = false) => {
    if (['desossa', 'dre-gerencial', 'configuracoes'].includes(menuAtivo)) {
      return;
    }

    if ((!dataInicial || !dataFinal) && menuAtivo !== 'recebimentos') {
      alert("Por favor, selecione a Data Inicial e a Data Final.");
      return;
    }

    if (isForceSync) {
      try {
        const endpointBase = menuAtivo === 'contas-pagas' ? 'contas-pagas' 
          : menuAtivo === 'contas-recebidas' ? 'contas-recebidas'
          : menuAtivo === 'recebimentos' ? 'recebimentos' 
          : menuAtivo === 'curva-abc' ? 'curva-abc' 
          : menuAtivo === 'dre-gerencial' ? 'dre'
          : 'contas-a-pagar';
          
        if (menuAtivo === 'dashboard') {
          alert("A sincronização em lote do dashboard foi desativada temporariamente. Por favor, sincronize cada módulo individualmente.");
          return;
        }

        const urlSync = `${API_BASE}/api/relatorios/${endpointBase}/sync`;
        const resSync = await fetchWithAuth(urlSync, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data_inicio: dataInicial, data_fim: dataFinal })
        });
        const dataSync = await resSync.json();
        
        const titleMap = {
          'contas-pagas': 'Sincronizando Contas Pagas',
          'contas-recebidas': 'Sincronizando Contas Recebidas',
          'recebimentos': 'Sincronizando Recebimentos',
          'curva-abc': 'Sincronizando Curva ABC',
          'dre-gerencial': 'Sincronizando DRE',
          'contas-a-pagar': 'Sincronizando Contas a Pagar'
        };
        const taskTitle = titleMap[menuAtivo] || 'Sincronizando...';

        if (resSync.status === 409 && dataSync.task_id) {
          handleGlobalTaskStart(dataSync.task_id, taskTitle, menuAtivo, 'duplicate', dataSync.detail || "Ação em andamento");
          return;
        }

        if (!resSync.ok) throw new Error(dataSync.detail || dataSync.message || "Falha ao iniciar sincronização.");

        handleGlobalTaskStart(dataSync.task_id, taskTitle, menuAtivo);
        return; 
      } catch (err) {
        handleGlobalTaskStart(`err-${Date.now()}`, 'Erro na Sincronização', null, 'error', err.message);
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
      if (menuAtivo === 'dashboard') {
        const urlPagar = `${API_BASE}/api/relatorios/contas-a-pagar/dados?data_inicio=${dataInicial}&data_fim=${dataFinal}`;
        const urlPagas = `${API_BASE}/api/relatorios/contas-pagas/dados?data_inicio=${dataInicial}&data_fim=${dataFinal}`;
        const urlRecebidas = `${API_BASE}/api/relatorios/contas-recebidas/dados?data_inicio=${dataInicial}&data_fim=${dataFinal}`;
        const urlRec = `${API_BASE}/api/relatorios/recebimentos/dados`;
        
        const [resPagar, resPagas, resRecebidas, resRec] = await Promise.all([
          fetchWithAuth(urlPagar),
          fetchWithAuth(urlPagas),
          fetchWithAuth(urlRecebidas),
          fetchWithAuth(urlRec)
        ]);
        
        const dadosPagar = resPagar.ok ? await resPagar.json() : { contas: [] };
        const dadosPagas = resPagas.ok ? await resPagas.json() : { contas: [] };
        const dadosRecebidas = resRecebidas.ok ? await resRecebidas.json() : { contas: [] };
        const dadosRec = resRec.ok ? await resRec.json() : { contas: [] };
        
        startTransition(() => {
          setDashboardData({
            pagar: dadosPagar.contas || [],
            pagas: dadosPagas.contas || [],
            recebidas: dadosRecebidas.contas || [],
            receber: dadosRec.contas || []
          });
        });
      } else if (menuAtivo === 'curva-abc') {
        const url = `${API_BASE}/api/relatorios/curva-abc/dados?data_inicio=${dataInicial}&data_fim=${dataFinal}`;
        const resposta = await fetchWithAuth(url);
        if (!resposta.ok) throw new Error("Erro de comunicação com o servidor.");
        const dados = await resposta.json();
        startTransition(() => {
          setResumoCurvaAbc(dados.resumo || null);
          setFamiliasList(dados.familias || []);
          setFamiliasFiltro([]);
          setClasseAbcFiltro([]);
          setContasBrutas(dados.itens || []);
        });
      } else {
        const endpoint = menuAtivo === 'contas-pagas' ? 'contas-pagas' 
          : menuAtivo === 'contas-recebidas' ? 'contas-recebidas'
          : menuAtivo === 'recebimentos' ? 'recebimentos' 
          : 'contas-a-pagar';
        const url = menuAtivo === 'recebimentos' 
          ? `${API_BASE}/api/relatorios/recebimentos/dados`
          : `${API_BASE}/api/relatorios/${endpoint}/dados?data_inicio=${dataInicial}&data_fim=${dataFinal}`;

        const resposta = await fetchWithAuth(url);
        if (!resposta.ok) throw new Error("Erro de comunicação com o servidor.");
        const dados = await resposta.json();
        startTransition(() => {
          setContasBrutas(dados.contas || []);
          if (menuAtivo === 'recebimentos') {
            setUltimaSincronizacaoRecebimentos(dados.ultima_sincronizacao || null);
          }
        });

        if (menuAtivo === 'recebimentos' || menuAtivo === 'contas-recebidas') {
          fetchWithAuth(`${API_BASE}/api/geral/bancos`)
            .then(res => res.json())
            .then(data => setListaBancos(Array.isArray(data) ? data : []))
            .catch(e => console.error(e));
        }
      }
    } catch (erro) {
      console.error(erro);
      handleGlobalTaskStart(`err-${Date.now()}`, 'Erro ao buscar dados', null, 'error', erro.message);
    } finally {
      setCarregandoTela(false);
    }
  };

  // --- [BLOCO: Processamento Analítico e Agrupamentos] ---
  const agruparDadosPorData = (contas, tipoRelatorio) => {
    const isLiquidado = tipoRelatorio === 'contas-pagas' || tipoRelatorio === 'contas-recebidas';
    const campoData = isLiquidado ? 'data_pagamento_br' : 'data_previsao_br';
    const campoValor = isLiquidado ? 'valor_pago' : 'saldo_devedor';

    const datasUnicas = [...new Set(contas.map(c => c[campoData]))];
    return datasUnicas.map(data => {
      const contasDoDia = contas.filter(c => c[campoData] === data);
      const subtotal = contasDoDia.reduce((acc, c) => acc + c[campoValor], 0);
      return { dataReferencia: data, contas: contasDoDia, subtotal };
    });
  };

  const agruparPorCategoria = (contas, tipoRelatorio) => {
    const isLiquidado = tipoRelatorio === 'contas-pagas' || tipoRelatorio === 'contas-recebidas';
    const campoValor = isLiquidado ? 'valor_pago' : 'saldo_devedor';
    const resumo = contas.reduce((acc, conta) => {
      // Se a conta possuir categorias múltiplas detalhadas, soma individualmente cada uma
      if (Array.isArray(conta.categorias) && conta.categorias.length > 0) {
        conta.categorias.forEach(catItem => {
          const cat = catItem.desc_categoria || 'Sem Categoria';
          const val = Number(catItem.valor) || 0;
          if (!acc[cat]) acc[cat] = { total: 0, contasCorrentes: {} };
          acc[cat].total += val;
          if (isLiquidado || tipoRelatorio === 'recebimentos') {
            const cc = conta.conta_corrente || 'Conta Não Identificada';
            if (!acc[cat].contasCorrentes[cc]) acc[cat].contasCorrentes[cc] = 0;
            acc[cat].contasCorrentes[cc] += val;
          }
        });
      } else {
        const cat = conta.desc_categoria || 'Sem Categoria';
        const val = Number(conta[campoValor]) || 0;
        if (!acc[cat]) acc[cat] = { total: 0, contasCorrentes: {} };
        acc[cat].total += val;
        if (isLiquidado || tipoRelatorio === 'recebimentos') {
          const cc = conta.conta_corrente || 'Conta Não Identificada';
          if (!acc[cat].contasCorrentes[cc]) acc[cat].contasCorrentes[cc] = 0;
          acc[cat].contasCorrentes[cc] += val;
        }
      }
      return acc;
    }, {});

    return Object.entries(resumo)
      .map(([categoria, dados]) => ({
        categoria, total: dados.total,
        contasCorrentes: Object.entries(dados.contasCorrentes).map(([cc, valor]) => ({ cc, valor })).sort((a, b) => b.valor - a.valor)
      })).sort((a, b) => b.total - a.total);
  };

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

    let itensFiltrados = clienteFiltro.trim()
      ? contasBrutas.filter(p =>
        p.descricao_produto && p.descricao_produto.toLowerCase().includes(clienteFiltro.toLowerCase())
      )
      : contasBrutas;

    if (familiasFiltro.length > 0) {
      itensFiltrados = itensFiltrados.filter(p => familiasFiltro.includes(p.familia_produto));
    }

    let kpiReceita = 0, kpiLucro = 0, kpiMargem = 0;

    if (isolarABC && itensFiltrados.length > 0) {
      const totalReceitaFiltrada = itensFiltrados.reduce((s, p) => s + (p.receita_total || 0), 0);
      let isolados = itensFiltrados.map(p => ({ ...p }));
      
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
    const clientesUnicos = [...new Set(contasFiltradas.map(c => c.nome_cliente).filter(Boolean))];
    return clientesUnicos.map(cli => {
      const contasCompletasDoCli = contasFiltradas.filter(c => c.nome_cliente === cli);
      const subtotal = contasCompletasDoCli.reduce((acc, c) => acc + (c.saldo_devedor || 0), 0);
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
  const totalGeral = useMemo(() => contasFiltradas.reduce((acc, c) => acc + ((menuAtivo === 'contas-pagas' || menuAtivo === 'contas-recebidas') ? c.valor_pago : c.saldo_devedor), 0), [contasFiltradas, menuAtivo]);

  const metricsVencimento = useMemo(() => {
    if (menuAtivo !== 'recebimentos') return { acima30: 0, acima60: 0, acima90: 0, totalAcima30: 0, totalAcima60: 0, totalAcima90: 0 };
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    let acima30 = 0, acima60 = 0, acima90 = 0;
    let totalAcima30 = 0, totalAcima60 = 0, totalAcima90 = 0;
    contasFiltradas.forEach(c => {
      const venc = converterDataBrParaDate(c.data_previsao_br);
      if (venc >= new Date(9999, 0)) return;
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

  // --- [BLOCO: Ações de Baixa, Cobrança e Recibos] ---
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
      const canvas = await html2canvas(element, { backgroundColor: '#0f172a', scale: 4, useCORS: true });
      if (modal) modal.scrollTop = originalScroll;
      canvas.toBlob(async (blob) => {
        try {
          const item = new ClipboardItem({ 'image/png': blob });
          await navigator.clipboard.write([item]);
          alert('Cobrança copiada com sucesso! Abra o WhatsApp do cliente e aperte Ctrl+V para colar.');
        } catch (err) {
          alert('Ocorreu um erro ao copiar imagem.');
          console.error(err);
        } finally {
          setGerandoImagem(false);
        }
      }, 'image/png');
    } catch (err) {
      if (modal) modal.scrollTop = originalScroll;
      alert('Erro interno ao tentar gerar imagem.');
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

    const assinaturaEl = element.querySelector('#assinatura-modal');
    const originalMarginBottom = assinaturaEl ? assinaturaEl.style.marginBottom : '';
    if (assinaturaEl) assinaturaEl.style.marginBottom = '24px';

    try {
      const canvas = await html2canvas(element, { backgroundColor: '#ffffff', scale: 4, useCORS: true });
      if (assinaturaEl) assinaturaEl.style.marginBottom = originalMarginBottom;
      if (modal) modal.scrollTop = originalScroll;

      canvas.toBlob(async (blob) => {
        try {
          const item = new ClipboardItem({ 'image/png': blob });
          await navigator.clipboard.write([item]);
          alert('Recibo copiado com sucesso! Abra o WhatsApp do cliente e aperte Ctrl+V para colar.');
        } catch (err) {
          alert('Ocorreu um erro ao copiar imagem.');
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
      const res = await fetchWithAuth(`${API_BASE}/api/recibos`);
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
      const res = await fetchWithAuth(`${API_BASE}/api/recibos/${recibo.id}/desfazer`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && data.task_id) {
          handleGlobalTaskStart(data.task_id, "Desfazendo Baixa...", null, "duplicate", data.detail);
          return;
        }
        throw new Error(data.detail || "Falha ao desfazer a baixa.");
      }
      
      if (data.task_id) {
        handleGlobalTaskStart(data.task_id, "Desfazendo Baixa...", async () => {
          handleCarregarHistoricoRecibos();
          setTimeout(() => { triggerGlobalRefresh(); }, 500);
        });
      } else {
        alert("Baixa desfeita com sucesso na Omie!");
        handleCarregarHistoricoRecibos();
        handleBuscarDados();
      }
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
      <div class="header"><h1>Demonstrativo de Cobrança</h1><p class="sub">Financial - Açougue</p></div>
      <div class="row"><span class="label">Sacado / Cliente:</span><span class="value">${reciboCobranca.cliente}</span></div>
      <div class="total-box"><span class="label">Total a Pagar</span><span class="value">R$ ${reciboCobranca.totalDevido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div>
      <div class="row"><span class="label">Data de Emissão deste Extrato:</span><span class="value">${reciboCobranca.dataHoraEmissao}</span></div>
      <table><thead><tr><th>Emissão</th><th>Nota / Parcela</th><th style="text-align:right">Valor (R$)</th></tr></thead><tbody>${linhas}</tbody></table>
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
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;">${n.desconto > 0 ? `<span style="color:#ef4444;">-R$ ${n.desconto.toLocaleString('pt-BR')}</span>` : ''}${n.juros > 0 ? `<span style="color:#f59e0b;"> +R$ ${n.juros.toLocaleString('pt-BR')}</span>` : ''}${n.desconto === 0 && n.juros === 0 ? '-' : ''}</td>
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
      <div class="header"><h1>Recibo de Pagamento</h1><p class="sub">Financial - Açougue</p></div>
      <div class="row"><span class="label">Recebemos de:</span><span class="value" style="font-size:15px;">${reciboGerado.cliente}</span></div>
      <div class="total-box"><span class="label">Valor Total Pago</span><span class="value">R$ ${reciboGerado.totalPago.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div>
      <div class="row"><span class="label">Data de Pagamento:</span><span class="value">${reciboGerado.data_pagamento}</span></div>
      <div class="row"><span class="label">Conta de Destino:</span><span class="value">${reciboGerado.banco || '-'}</span></div>
      <div class="row"><span class="label">Subtotal Original:</span><span class="value">R$ ${reciboGerado.totalOriginal.toLocaleString('pt-BR')}</span></div>
      <div class="row"><span class="label">Descontos / Juros:</span><span class="value">-R$ ${reciboGerado.totalDesconto.toLocaleString('pt-BR')} / +R$ ${reciboGerado.totalJuros.toLocaleString('pt-BR')}</span></div>
      <p class="section-title">Composição das Notas Recebidas</p>
      <table><thead><tr><th>Emissão</th><th>Nota / Parcela</th><th style="text-align:right">Original</th><th style="text-align:right">Desc/Juros</th><th style="text-align:right">Pago</th></tr></thead><tbody>${linhas}</tbody></table>
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

      const bancoSelecionado = listaBancos.find(b => String(b.id) === String(contaDestino))?.nome || 'Conta Não Identificada';
      const totais = calcularTotaisModal();
      const nomeCliente = modalBaixa.cliente;

      const payload = {
        id_conta_corrente: parseInt(contaDestino),
        data_pagamento: `${dia}/${mes}/${ano}`,
        cliente: nomeCliente,
        banco: bancoSelecionado,
        totais: {
          totalOriginal: totais.totalOriginal,
          totalDesconto: totais.totalDesconto,
          totalJuros: totais.totalJuros,
          totalPago: totais.totalPago
        },
        pagamentos: pagamentosTratados.map(p => ({
          codigo_lancamento: p.codigo_lancamento,
          valor: p.valor,
          desconto: p.desconto,
          juros: p.juros,
          numero_documento_fiscal: p.contaOriginal?.numero_documento_fiscal,
          numero_parcela: p.contaOriginal?.numero_parcela,
          data_vencimento: p.contaOriginal?.data_previsao_br,
          data_emissao: p.contaOriginal?.data_emissao
        }))
      };

      setModalBaixa({ aberto: false, cliente: '', contas: [] });

      const res = await fetchWithAuth(`${API_BASE}/api/relatorios/recebimentos/baixar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && data.task_id) {
          handleGlobalTaskStart(data.task_id, `Baixa Convênio: ${nomeCliente || 'Lote'}`, null, "duplicate", data.detail);
          return;
        }
        throw new Error(data.detail || "Erro ao processar as notas.");
      }

      if (data.task_id) {
        handleGlobalTaskStart(data.task_id, `Baixa Convênio: ${nomeCliente || 'Lote'}`, async (result) => {
          // O backend já persiste o recibo automaticamente no banco, mesmo para baixas parciais
          const baixas = result?.baixas || [];
          const pagamentosComBaixa = pagamentosTratados
            .filter(p => baixas.length === 0 || baixas.some(b => b.codigo_lancamento === p.codigo_lancamento))
            .map(p => {
              const baixaEncontrada = baixas.find(b => b.codigo_lancamento === p.codigo_lancamento);
              return { ...p, codigo_baixa: baixaEncontrada?.codigo_baixa || null };
            });

          const reciboFinal = {
            id: result?.recibo_id,
            cliente: nomeCliente,
            banco: bancoSelecionado,
            data_pagamento: `${dia}/${mes}/${ano}`,
            totalOriginal: totais.totalOriginal,
            totalDesconto: totais.totalDesconto,
            totalJuros: totais.totalJuros,
            totalPago: totais.totalPago,
            notas: pagamentosComBaixa
          };

          setReciboGerado(reciboFinal);
          setTimeout(() => { triggerGlobalRefresh(); }, 500);
        });
      } else {
        const pagamentosComBaixa = pagamentosTratados.map(p => {
          const baixaEncontrada = data.baixas?.find(b => b.codigo_lancamento === p.codigo_lancamento);
          return { ...p, codigo_baixa: baixaEncontrada ? baixaEncontrada.codigo_baixa : null };
        });

        const novoRecibo = {
          cliente: nomeCliente,
          banco: bancoSelecionado,
          data_pagamento: `${dia}/${mes}/${ano}`,
          totalOriginal: totais.totalOriginal,
          totalDesconto: totais.totalDesconto,
          totalJuros: totais.totalJuros,
          totalPago: totais.totalPago,
          notas: pagamentosComBaixa
        };

        try {
          await fetchWithAuth(`${API_BASE}/api/recibos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(novoRecibo)
          });
        } catch (err) {
          console.error("Erro ao salvar recibo:", err);
        }

        setReciboGerado(novoRecibo);
        handleBuscarDados();
      }
    } catch (e) {
      alert("Erro ao receber valores: " + e.message);
    } finally {
      setProcessandoBaixa(false);
    }
  };

  // --- [BLOCO: Gerenciamento de Snapshots] ---
  const carregarSnapshots = async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/snapshots`);
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
      await fetchWithAuth(`${API_BASE}/api/snapshots/${id}`, { method: 'DELETE' });
      carregarSnapshots();
    } catch (e) {
      console.error(e);
    }
  };

  const handleResincronizarSnapshot = async (snap) => {
    try {
      await fetchWithAuth(`${API_BASE}/api/snapshots/${snap.id}`, { method: 'DELETE' });
      let url = "";
      if (snap.tipo_relatorio === 'Contas Pagas') {
        url = `${API_BASE}/api/relatorios/contas-pagas/dados?data_inicio=${snap.data_referencia}&data_fim=${snap.data_referencia}`;
      } else if (snap.tipo_relatorio === 'Contas Recebidas (Convênios)') {
        url = `${API_BASE}/api/relatorios/contas-recebidas/dados?data_inicio=${snap.data_referencia}&data_fim=${snap.data_referencia}`;
      } else if (snap.tipo_relatorio === 'Vendas PDV' || snap.tipo_relatorio.includes('CMC')) {
        url = `${API_BASE}/api/relatorios/curva-abc/dados?data_inicio=${snap.data_referencia}&data_fim=${snap.data_referencia}`;
      } else if (snap.tipo_relatorio.includes('Pagar')) {
        url = `${API_BASE}/api/relatorios/contas-a-pagar/dados?data_inicio=${snap.data_referencia}&data_fim=${snap.data_referencia}`;
      } else if (snap.tipo_relatorio.includes('Receber')) {
        url = `${API_BASE}/api/relatorios/recebimentos/dados?data_inicio=${snap.data_referencia}&data_fim=${snap.data_referencia}`;
      } else if (snap.tipo_relatorio.includes('Dicionário') || snap.tipo_relatorio.includes('Famílias')) {
        url = `${API_BASE}/api/relatorios/contas-pagas/dados?data_inicio=2026-01-01&data_fim=2026-01-01`;
      }
      if (url) await fetchWithAuth(url);
      carregarSnapshots();
    } catch (e) {
      console.error(e);
    }
  };

  const snapshotsFiltrados = useMemo(() => {
    let filtrados = listaSnapshots.filter(snap => {
      if (menuAtivo === 'dashboard') return true;
      if (menuAtivo === 'contas-pagar') return snap.tipo_relatorio === 'Contas a Pagar (Abertas)' || snap.tipo_relatorio.includes('Dicionário de');
      if (menuAtivo === 'contas-pagas') return snap.tipo_relatorio === 'Contas Pagas' || snap.tipo_relatorio.includes('Dicionário de');
      if (menuAtivo === 'contas-recebidas') return snap.tipo_relatorio === 'Contas Recebidas (Convênios)' || snap.tipo_relatorio.includes('Dicionário de');
      if (menuAtivo === 'recebimentos') return snap.tipo_relatorio === 'Contas a Receber (Abertas)' || snap.tipo_relatorio.includes('Dicionário de');
      if (menuAtivo === 'curva-abc') return snap.tipo_relatorio === 'Vendas PDV' || snap.tipo_relatorio.includes('CMC') || snap.tipo_relatorio.includes('Famílias');
      return true;
    });

    if (modalDataInicial || modalDataFinal) {
      filtrados = filtrados.filter(snap => {
        if (snap.data_referencia === 'Global') return false;
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

  // --- [BLOCO: Títulos e Rótulos do Cabeçalho] ---
  const tituloModulo = menuAtivo === 'contas-pagas' ? 'Módulo de Contas Pagas'
    : menuAtivo === 'contas-recebidas' ? 'Módulo de Contas Recebidas (Convênios)'
    : menuAtivo === 'recebimentos' ? 'Módulo de Convênios'
    : menuAtivo === 'curva-abc' ? 'Análise de Lucratividade'
    : menuAtivo === 'dashboard' ? 'Visão Geral Financeira'
    : 'Módulo de Contas a Pagar';

  const descModulo = menuAtivo === 'contas-pagas' ? 'Sincronize as baixas realizadas e concilie contas correntes.'
    : menuAtivo === 'contas-recebidas' ? 'Acompanhe os títulos de convênios liquidados no período e concilie com os bancos.'
    : menuAtivo === 'recebimentos' ? 'Acompanhe faturas de convênios, edite pagamentos parciais e gere recibos.'
    : menuAtivo === 'curva-abc' ? 'Avalie o peso e a margem de cada produto na sua operação.'
    : menuAtivo === 'dashboard' ? 'Acompanhe os principais indicadores de saúde financeira do seu negócio.'
    : 'Sincronize os dados e imprima o relatório detalhado.';

  const tituloRelatorio = menuAtivo === 'contas-pagas' ? 'Pagamentos Realizados'
    : menuAtivo === 'contas-recebidas' ? 'Recebimentos Realizados (Convênios)'
    : menuAtivo === 'recebimentos' ? 'Títulos a Receber (Convênio)'
    : menuAtivo === 'curva-abc' ? 'Curva ABC e Lucratividade'
    : menuAtivo === 'dashboard' ? 'Dashboard Executivo'
    : 'Previsão de Pagamentos';

  // --- [BLOCO: Renderização da View e Modais Correlatos] ---
  return (
    <>
      <div className="flex-1 p-8 z-10 print:!p-0 print:!m-0 print:!block print:!overflow-visible">
        {/* Cabeçalho de Ações e Filtro de Período */}
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 mb-8 print:hidden">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight mb-1">{tituloModulo}</h2>
            <p className="text-sm text-slate-400">{descModulo}</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-col sm:flex-row items-center gap-3 shadow-sm">
            {menuAtivo !== 'recebimentos' && (
              <DateRangePicker
                startValue={dataInicial}
                endValue={dataFinal}
                onStartChange={setDataInicial}
                onEndChange={setDataFinal}
                disabled={carregandoTela}
              />
            )}

            <button
              onClick={() => handleBuscarDados(true)}
              disabled={carregandoTela}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 shadow-sm"
            >
              {carregandoTela ? <Loader2 className="animate-spin" size={16} /> : <Database size={16} />}
              SINCRONIZAR DADOS
            </button>

            {menuAtivo !== 'recebimentos' ? (
              <button
                onClick={handleAbrirSnapshots}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/70 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
              >
                <Database size={16} />
                BASE DE DADOS
              </button>
            ) : (
              ultimaSincronizacaoRecebimentos && (
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800/80 border border-slate-700/70 text-slate-300 font-medium text-xs">
                  <Database size={14} className="text-slate-400" />
                  Última sincronização: {ultimaSincronizacaoRecebimentos}
                </div>
              )
            )}

            {menuAtivo === 'recebimentos' && (
              <button
                onClick={() => { handleCarregarHistoricoRecibos(); setModalHistoricoRecibosAberto(true); }}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors shadow-sm"
              >
                <Receipt size={16} />
                HISTÓRICO DE RECIBOS
              </button>
            )}
          </div>
        </div>

        {/* Cabeçalho de Impressão */}
        <div className={`hidden ${menuAtivo !== 'curva-abc' ? 'print:flex' : ''} items-center justify-between border-b-2 border-slate-800 pb-4 mb-6 mt-4 print:px-2`}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 print:!bg-indigo-600 flex items-center justify-center">
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
              <p className="text-sm font-medium text-slate-600 mt-1">
                Período: {dataInicial.split('-').reverse().join('/')} a {dataFinal.split('-').reverse().join('/')}
              </p>
            )}
          </div>
        </div>

        {/* View: Curva ABC */}
        {menuAtivo === 'curva-abc' && (
          <CurvaABCView
            resumoCurvaAbc={resumoCurvaAbc}
            dataInicial={dataInicial}
            dataFinal={dataFinal}
            isolarABC={isolarABC}
            setIsolarABC={setIsolarABC}
            familiasList={familiasList}
            familiasFiltro={familiasFiltro}
            setFamiliasFiltro={setFamiliasFiltro}
            classeAbcFiltro={classeAbcFiltro}
            setClasseAbcFiltro={setClasseAbcFiltro}
            dropFamiliaAberto={dropFamiliaAberto}
            setDropFamiliaAberto={setDropFamiliaAberto}
            dropClasseAberto={dropClasseAberto}
            setDropClasseAberto={setDropClasseAberto}
            menuAtivo={menuAtivo}
            carregandoTela={carregandoTela}
            curvaAbcProcessada={curvaAbcProcessada}
            contasBrutas={contasBrutas}
            clienteFiltro={clienteFiltro}
            setClienteFiltro={setClienteFiltro}
            setPaginaAtual={setPaginaAtual}
            setRegistrosPorPagina={setRegistrosPorPagina}
          />
        )}

        {/* View: Dashboard Executivo */}
        {menuAtivo === 'dashboard' && (
          <DashboardView
            carregandoTela={carregandoTela}
            dashboardData={dashboardData}
          />
        )}

        {/* Views: Contas a Pagar / Contas Pagas / Recebimentos */}
        {['contas-pagar', 'contas-pagas', 'recebimentos', 'contas-recebidas'].includes(menuAtivo) && (
          <ContasView
            menuAtivo={menuAtivo}
            carregandoTela={carregandoTela}
            contasBrutas={contasBrutas}
            totalGeral={totalGeral}
            clienteFiltro={clienteFiltro}
            setClienteFiltro={setClienteFiltro}
            contaFiltro={contaFiltro}
            setContaFiltro={setContaFiltro}
            listaBancos={listaBancos}
            isolarABC={isolarABC}
            paginaAtual={paginaAtual}
            setPaginaAtual={setPaginaAtual}
            totalItems={totalItems}
            indiceInicio={indiceInicio}
            indiceFim={indiceFim}
            registrosPorPagina={registrosPorPagina}
            setRegistrosPorPagina={setRegistrosPorPagina}
            contasFiltradas={contasFiltradas}
            gruposRecebimentos={gruposRecebimentos}
            selecionados={selecionados}
            toggleSelecao={toggleSelecao}
            toggleTodosCliente={toggleTodosCliente}
            abrirModalLote={abrirModalLote}
            gerarCobrancaLote={gerarCobrancaLote}
            formatarDataComDia={(d) => d}
            converterDataBrParaDate={converterDataBrParaDate}
            setModalBaixa={setModalBaixa}
            handleCarregarHistoricoRecibos={handleCarregarHistoricoRecibos}
            setModalHistoricoRecibosAberto={setModalHistoricoRecibosAberto}
            contasCorrentesDisponiveis={contasCorrentesDisponiveis}
            handleImprimir={handleImprimir}
            dadosAgrupados={dadosAgrupados}
            metricsVencimento={metricsVencimento}
            resumoCategorias={resumoCategorias}
            totalPaginas={totalPaginas}
          />
        )}
      </div>

      {/* Modais de Operação Financeira */}
      <ModalRecebimento
        modalBaixa={modalBaixa}
        setModalBaixa={setModalBaixa}
        calcularTotaisModal={calcularTotaisModal}
        descGlobalTipo={descGlobalTipo}
        setDescGlobalTipo={setDescGlobalTipo}
        descGlobalValor={descGlobalValor}
        setDescGlobalValor={setDescGlobalValor}
        jurosGlobalTipo={jurosGlobalTipo}
        setJurosGlobalTipo={setJurosGlobalTipo}
        jurosGlobalValor={jurosGlobalValor}
        setJurosGlobalValor={setJurosGlobalValor}
        valorTotalRecebido={valorTotalRecebido}
        setValorTotalRecebido={setValorTotalRecebido}
        aplicarRateioGlobal={aplicarRateioGlobal}
        detalhesPagamento={detalhesPagamento}
        handleAlterarDetalhe={handleAlterarDetalhe}
        contaDestino={contaDestino}
        setContaDestino={setContaDestino}
        listaBancos={listaBancos}
        dataPagamento={dataPagamento}
        setDataPagamento={setDataPagamento}
        processandoBaixa={processandoBaixa}
        handleEfetuarBaixaLote={handleEfetuarBaixaLote}
      />

      <ReciboPagamento
        reciboGerado={reciboGerado}
        setReciboGerado={setReciboGerado}
        reciboPagamentoRef={reciboPagamentoRef}
        userName={userName}
        copiarImagemRecibo={copiarImagemRecibo}
        imprimirRecibo={imprimirRecibo}
        gerandoImagem={gerandoImagem}
      />

      <ReciboCobranca
        reciboCobranca={reciboCobranca}
        setReciboCobranca={setReciboCobranca}
        reciboCobrancaRef={reciboCobrancaRef}
        copiarImagemCobranca={copiarImagemCobranca}
        imprimirCobranca={imprimirCobranca}
        gerandoImagem={gerandoImagem}
      />

      <ModalHistoricoRecibos
        modalHistoricoRecibosAberto={modalHistoricoRecibosAberto}
        setModalHistoricoRecibosAberto={setModalHistoricoRecibosAberto}
        historicoRecibos={historicoRecibos}
        filtroHistoricoCliente={filtroHistoricoCliente}
        setFiltroHistoricoCliente={setFiltroHistoricoCliente}
        filtroHistoricoData={filtroHistoricoData}
        setFiltroHistoricoData={setFiltroHistoricoData}
        carregandoHistorico={carregandoHistorico}
        handleDesfazerBaixa={handleDesfazerBaixa}
        setReciboGerado={setReciboGerado}
      />

      <ModalSnapshots
        modalSnapshotsAberto={modalSnapshotsAberto}
        setModalSnapshotsAberto={setModalSnapshotsAberto}
        paginaSnapshots={paginaSnapshots}
        setPaginaSnapshots={setPaginaSnapshots}
        registrosPorPaginaSnapshots={registrosPorPaginaSnapshots}
        setRegistrosPorPaginaSnapshots={setRegistrosPorPaginaSnapshots}
        modalDataInicial={modalDataInicial}
        setModalDataInicial={setModalDataInicial}
        modalDataFinal={modalDataFinal}
        setModalDataFinal={setModalDataFinal}
        handleDeletarSnapshot={handleDeletarSnapshot}
        handleResincronizarSnapshot={handleResincronizarSnapshot}
        snapshotsPaginados={snapshotsPaginados}
        totalPaginasSnapshots={totalPaginasSnapshots}
        totalSnapshots={totalSnapshots}
      />
    </>
  );
}
