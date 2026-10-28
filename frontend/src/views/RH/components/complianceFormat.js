// Formatação e rótulos compartilhados pela auditoria mensal e pelo relatório de irregularidades
// ==============================================================================
// --- [BLOCO: FORMATAÇÃO COMPARTILHADA (AUDITORIA E RELATÓRIO)] ---
// ==============================================================================

export const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export const STATUS_LABELS = {
  PENDENTE: { label: 'Pendente', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
  APROVADA: { label: 'Aprovada', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
  REABERTA: { label: 'Reaberta', cls: 'bg-orange-500/15 text-orange-300 border-orange-500/40' },
  SEM_IRREGULARIDADES: { label: 'Sem irregularidades', cls: 'bg-slate-800 text-slate-300 border-slate-700' }
};

export const SEVERITY = {
  CRITICA: { label: 'Crítica', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/40' },
  ALERTA: { label: 'Alerta', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40' }
};

export const ORIGIN_LABELS = { MANUAL: 'Manual', LOTE: 'Lote', RESET: 'Restauração', FOLGA_COMP: 'Folga compensatória' };
export const NO_DAY_HISTORY_RULES = ['R03', 'R04', 'R12', 'R14'];

export const fmtDate = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
export const fmtDates = (dates = []) => {
  if (dates.length <= 2) return dates.map(fmtDate).join(' e ');
  return `${fmtDate(dates[0])} a ${fmtDate(dates[dates.length - 1])}`;
};
export const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const describeDay = (snap) => {
  if (!snap) return 'sem registro';
  if (snap.status !== 'TRABALHO') return snap.status;
  return snap.lunch_start
    ? `${snap.start_time}–${snap.lunch_start} / ${snap.lunch_end}–${snap.end_time}`
    : `${snap.start_time}–${snap.end_time}`;
};
