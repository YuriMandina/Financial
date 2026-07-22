import React from 'react';
import { Receipt, Copy, Printer, Loader2 } from 'lucide-react';
import { formatarDataComDia } from '../../utils/formatters';

export default function ReciboCobranca({ 
  reciboCobranca, 
  setReciboCobranca, 
  reciboCobrancaRef, 
  copiarImagemCobranca, 
  imprimirCobranca, 
  gerandoImagem 
}) {
  if (!reciboCobranca) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/90 flex items-center justify-center p-4 overflow-y-auto print:bg-white print:p-0 print:block">
      <div className="flex flex-col items-center max-w-2xl w-full my-8 print:my-0 print:w-full print:max-w-none">
        
        <div ref={reciboCobrancaRef} className="bg-slate-900 border border-slate-800 p-8 md:p-10 rounded-[2rem] w-full relative overflow-hidden shadow-2xl print:bg-white print:border-none print:shadow-none print:rounded-none print:p-0 print:overflow-visible">
          <div className="absolute top-[-40%] left-[-20%] w-[500px] h-[500px] pointer-events-none z-0 print:hidden"
               style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, rgba(0,0,0,0) 60%)' }}></div>
          <div className="absolute bottom-[-40%] right-[-20%] w-[500px] h-[500px] pointer-events-none z-0 print:hidden"
               style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.15) 0%, rgba(0,0,0,0) 60%)' }}></div>

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
  );
}
