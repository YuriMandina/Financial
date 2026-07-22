import React from 'react';
import { CheckCircle, Copy, Printer, Loader2 } from 'lucide-react';
import { converterDataBrParaDate } from '../../utils/formatters';

export default function ReciboPagamento({ 
  reciboGerado, 
  setReciboGerado, 
  reciboPagamentoRef, 
  userName, 
  copiarImagemRecibo, 
  imprimirRecibo, 
  gerandoImagem 
}) {
  if (!reciboGerado) return null;

  return (
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
  );
}
