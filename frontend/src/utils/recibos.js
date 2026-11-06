import { converterDataBrParaDate } from './formatters';

// Recibos podem vir em dois formatos: os montados no front (com `contaOriginal`)
// e os persistidos pelo backend na baixa em lote (campos achatados na propria nota).
export function normalizarNotaRecibo(n) {
  const c = n.contaOriginal || {};
  const valor = Number(n.valor || 0);
  const desconto = Number(n.desconto || 0);
  const juros = Number(n.juros || 0);
  const saldo = c.saldo_devedor ?? n.saldo_devedor;
  return {
    data_emissao: c.data_emissao || n.data_emissao || '',
    numero_documento_fiscal: c.numero_documento_fiscal ?? n.numero_documento_fiscal ?? '-',
    numero_parcela: c.numero_parcela ?? n.numero_parcela ?? '-',
    original: saldo != null ? Number(saldo) : valor + desconto - juros,
    valor,
    desconto,
    juros,
  };
}

export function ordenarNotasRecibo(notas = []) {
  return notas.map(n => ({ ...n, _n: normalizarNotaRecibo(n) })).sort((a, b) =>
    converterDataBrParaDate(b._n.data_emissao).getTime() - converterDataBrParaDate(a._n.data_emissao).getTime()
  );
}
