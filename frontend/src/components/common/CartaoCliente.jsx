import React, { useState, useMemo } from 'react';
import { CalendarDays, CheckSquare, Square, Receipt, Calculator } from 'lucide-react';
import { converterDataBrParaDate, formatarDataComDia } from '../../utils/formatters';
import DateRangePicker from './DateRangePicker';

// --- SUBCOMPONENTE: CARD INTELIGENTE DO CLIENTE ---
const HeaderTH = ({ sortKey, label, width, align = "left", handleSort, sortConfig }) => (
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
  const contasOperaveis = contasOrdenadas.filter(c => !c.is_omie_cash);
  const selecionadasDoCliente = contasOrdenadas.filter(c => selecionados.find(s => s.codigo_lancamento === c.codigo_lancamento));
  const todasSelecionadas = contasOperaveis.length > 0 && contasOperaveis.every(c => selecionados.find(s => s.codigo_lancamento === c.codigo_lancamento));
  const valorTotalSelecionado = selecionadasDoCliente.reduce((acc, c) => acc + c.saldo_devedor, 0);
  const totalOmieCash = contasOrdenadas.filter(c => c.is_omie_cash).reduce((acc, c) => acc + c.saldo_devedor, 0);


  return (
    <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl print:rounded-none overflow-hidden print:border-slate-300 print:!bg-transparent print:break-inside-avoid shadow-lg relative z-10">
      <div className="bg-slate-900/50 p-6 border-b border-slate-800/80 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 print:bg-slate-100 print:border-slate-300 print:p-2 print:flex-row print:items-center print:gap-2">

        <div className="flex items-center gap-4 print:gap-2 print:flex-1 print:min-w-0">
          <div className="w-12 h-12 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-xl print:border print:border-slate-400 shrink-0 print:w-7 print:h-7 print:text-xs">
            {(grupo.dataReferencia || 'C').charAt(0).toUpperCase()}
          </div>
          <div className="print:min-w-0 print:overflow-hidden">
            <h3 className="text-xl font-bold text-white print:text-slate-900 print:text-sm print:leading-tight print:truncate">
              {grupo.dataReferencia || 'Cliente Não Informado'}
            </h3>
            <p className="text-slate-400 text-sm font-medium print:text-slate-600 print:text-[10px]">
              {contasOrdenadas.length} títulos listados {grupo.contasOcultas > 0 && `(mais ${grupo.contasOcultas} na busca oculta)`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-slate-950/50 p-1.5 rounded-lg border border-slate-800 print:hidden shrink-0">
          <DateRangePicker
            startValue={localFiltroInicio}
            endValue={localFiltroFim}
            onStartChange={setLocalFiltroInicio}
            onEndChange={setLocalFiltroFim}
            compact={true}
            align="right"
          />
        </div>

        <div className="text-right shrink-0 print:ml-auto">
          <p className="text-sm text-slate-400 uppercase font-bold print:text-slate-500 print:text-[9px] print:m-0 print:leading-tight">Total Aberto</p>
          <p className="text-2xl font-black text-emerald-400 print:text-slate-900 print:text-sm print:m-0 print:font-bold print:leading-tight">R$ {localSubtotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          {totalOmieCash > 0 && (
            <p className="text-[11px] font-semibold text-sky-400 print:hidden mt-0.5">
              (R$ {totalOmieCash.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} em Boletos Omie.Cash)
            </p>
          )}
        </div>
      </div>

      <div className="overflow-x-auto print:overflow-visible print:w-full">
        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead>
            <tr className="bg-slate-800/30 text-slate-300 print:bg-slate-200 print:text-slate-900 text-xs font-bold border-b border-slate-700/50 print:border-slate-300">
              <th className="py-3 px-5 print:hidden w-10">
                {contasOperaveis.length > 0 && (
                  <button onClick={() => toggleTodosCliente(contasOperaveis)} className="text-slate-400 hover:text-indigo-400" title="Selecionar Todos em Aberto (Carteira)">
                    {todasSelecionadas ? <CheckSquare size={18} className="text-indigo-400" /> : <Square size={18} />}
                  </button>
                )}
              </th>
              <HeaderTH handleSort={handleSort} sortConfig={sortConfig} sortKey="emissao" label="Emissão" width="w-36" />
              <HeaderTH handleSort={handleSort} sortConfig={sortConfig} sortKey="vencimento" label="Vencimento" width="w-36" />
              <HeaderTH handleSort={handleSort} sortConfig={sortConfig} sortKey="nota" label="Nota / Parcela" width="w-1/4 min-w-[150px]" />
              <HeaderTH handleSort={handleSort} sortConfig={sortConfig} sortKey="conta" label="Conta Corrente" width="w-1/3 min-w-[200px]" />
              <HeaderTH handleSort={handleSort} sortConfig={sortConfig} sortKey="valor" label="Valor a Receber" width="w-32" align="right" />
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
                  <tr key={conta.codigo_lancamento} className={`border-b border-slate-700/30 print:border-slate-300 ${conta.is_omie_cash ? 'bg-indigo-950/20' : taSelecionado ? 'bg-indigo-500/5' : 'hover:bg-slate-800/40'} transition-colors ${idx % 2 === 0 ? 'print:bg-white' : 'print:bg-slate-50'}`}>
                    <td className="py-3 px-5 print:hidden">
                      {conta.is_omie_cash ? (
                        <span className="text-[10px] font-bold text-sky-400 bg-sky-500/10 border border-sky-500/20 px-1.5 py-0.5 rounded cursor-default" title="Boleto emitido via Omie.Cash com liquidação automática">
                          Boleto
                        </span>
                      ) : (
                        <div className="cursor-pointer" onClick={() => toggleSelecao(conta)}>
                          {taSelecionado ? <CheckSquare size={18} className="text-indigo-400" /> : <Square size={18} className="text-slate-500" />}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-5 text-slate-400 print:text-slate-800 print:py-1 print:px-2 print:text-[10px]">{formatarDataComDia(conta.data_emissao)}</td>
                    <td className="py-3 px-5 font-medium text-slate-300 print:text-slate-800 print:py-1 print:px-2 print:text-[10px]">{formatarDataComDia(conta.data_previsao_br)}</td>
                    <td className="py-3 px-5 text-slate-300 print:text-slate-800 print:py-1 print:px-2 print:text-[10px]">{conta.numero_documento_fiscal} - {conta.numero_parcela}</td>
                    <td className="py-3 px-5 text-slate-400 print:text-slate-600 truncate max-w-[200px] print:max-w-none print:py-1 print:px-2 print:text-[10px]">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="truncate">{conta.conta_corrente}</span>
                        {conta.is_omie_cash && (
                          <span className="shrink-0 text-[9px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.2 rounded">
                            Baixa Automática
                          </span>
                        )}
                      </div>
                    </td>
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

export default CartaoCliente;
