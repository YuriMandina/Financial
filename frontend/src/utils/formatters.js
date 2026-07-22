export const converterDataBrParaDate = (dataStr) => {
  if (!dataStr || dataStr === '-') return new Date(9999, 11, 31);
  const partes = dataStr.split('/');
  return new Date(partes[2], partes[1] - 1, partes[0]);
};

export const formatarDataComDia = (dataStr) => {
  if (!dataStr || dataStr === '-') return '-';
  const partes = dataStr.split('/');
  if (partes.length !== 3) return dataStr;
  const d = new Date(partes[2], partes[1] - 1, partes[0]);
  const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  return `${dataStr} - ${dias[d.getDay()]}`;
};
