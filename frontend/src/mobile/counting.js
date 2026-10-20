// Regras de contagem do app (espelham services/estoque_engine.py do backend).
// Funções puras: usadas para pré-visualizar o resultado offline; o backend recalcula e é a fonte da verdade.

export const QTY_DECIMALS = 4;
export const MODE_UNIDADE = 'UN';
export const MODE_EMBALAGEM = 'EMB';
export const MODE_PESO = 'PESO';

export const roundQty = (value) => {
  const factor = 10 ** QTY_DECIMALS;
  return Math.round((Number(value) || 0) * factor) / factor;
};

export const formatQty = (value) =>
  roundQty(value).toLocaleString('pt-BR', { maximumFractionDigits: QTY_DECIMALS });

// --- [BLOCO: Calculadora de Expressões] ---
// Parser próprio (sem eval): números, + - * / x, parênteses e vírgula decimal.

const tokenize = (expression) => {
  const src = String(expression).replace(/,/g, '.').replace(/[xX×]/g, '*').replace(/÷/g, '/');
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ') { i += 1; continue; }
    if (/[0-9.]/.test(ch)) {
      let num = '';
      while (i < src.length && /[0-9.]/.test(src[i])) { num += src[i]; i += 1; }
      if ((num.match(/\./g) || []).length > 1 || num === '.') throw new Error(`Número inválido: ${num}`);
      tokens.push({ type: 'num', value: parseFloat(num) });
      continue;
    }
    if ('+-*/()'.includes(ch)) { tokens.push({ type: 'op', value: ch }); i += 1; continue; }
    throw new Error(`Caractere inválido: ${ch}`);
  }
  return tokens;
};

export function evaluateExpression(expression) {
  if (expression === null || expression === undefined || !String(expression).trim()) {
    throw new Error('Expressão vazia.');
  }
  const tokens = tokenize(expression);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  // Gramática: expr = term (('+'|'-') term)* ; term = factor (('*'|'/') factor)* ; factor = num | '(' expr ')' | '-' factor
  const parseFactor = () => {
    const tok = next();
    if (!tok) throw new Error('Expressão incompleta.');
    if (tok.type === 'num') return tok.value;
    if (tok.value === '-') return -parseFactor();
    if (tok.value === '+') return parseFactor();
    if (tok.value === '(') {
      const value = parseExpr();
      if (!next() || tokens[pos - 1].value !== ')') throw new Error('Parêntese não fechado.');
      return value;
    }
    throw new Error('Expressão inválida.');
  };
  const parseTerm = () => {
    let value = parseFactor();
    while (peek() && (peek().value === '*' || peek().value === '/')) {
      const op = next().value;
      const right = parseFactor();
      if (op === '/' && right === 0) throw new Error('Divisão por zero.');
      value = op === '*' ? value * right : value / right;
    }
    return value;
  };
  const parseExpr = () => {
    let value = parseTerm();
    while (peek() && (peek().value === '+' || peek().value === '-')) {
      const op = next().value;
      const right = parseTerm();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  };

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error('Expressão inválida.');
  return roundQty(result);
}

// --- [BLOCO: Quantidade do Lançamento] ---

export function computeEntryQuantity(mode, rawQty, factor = 1, tareTotal = 0) {
  const raw = Number(rawQty) || 0;
  if (raw <= 0) throw new Error('A quantidade deve ser maior que zero.');
  if (mode === MODE_UNIDADE) return roundQty(raw);
  if (mode === MODE_EMBALAGEM) {
    if (!(Number(factor) > 0)) throw new Error('Fator da embalagem inválido.');
    return roundQty(raw * Number(factor));
  }
  if (mode === MODE_PESO) {
    const tare = Number(tareTotal) || 0;
    if (tare < 0) throw new Error('A tara não pode ser negativa.');
    const net = raw - tare;
    if (net <= 0) throw new Error('Peso líquido (bruto - tara) deve ser maior que zero.');
    return roundQty(net);
  }
  throw new Error(`Modo inválido: ${mode}`);
}

// --- [BLOCO: Totais e Busca Local] ---

// Total exibido = contado no servidor (rodada atual) + lançamentos ainda não sincronizados
export function localItemTotal(item, pendingEntries) {
  const pending = (pendingEntries || [])
    .filter((e) => e.item_id === item.id && e.status !== 'rejected')
    .reduce((sum, e) => sum + (Number(e.quantity) || 0), 0);
  return roundQty((Number(item.counted_qty) || 0) + pending);
}

export function itemCountStatus(item, pendingEntries) {
  const hasPending = (pendingEntries || []).some((e) => e.item_id === item.id && e.status !== 'rejected');
  if (hasPending) return 'CONTADO';
  return item.count_status;
}

// Contagem aceita lançamentos: inventário em contagem, ou item em recontagem na conferência
export function itemEditable(count, item) {
  if (!count || !item) return false;
  if (count.status === 'EM_CONTAGEM') return true;
  return count.status === 'CONFERENCIA' && (item.count_status === 'RECONTAGEM' || item.current_round > 1);
}

export function findByCode(items, code) {
  const target = String(code || '').trim();
  if (!target) return null;
  for (const item of items || []) {
    if ((item.ean && item.ean === target) || (item.product_code && item.product_code === target)) return { item, packaging: null };
    const pack = (item.packagings || []).find((p) => p.ean && p.ean === target);
    if (pack) return { item, packaging: pack };
  }
  return null;
}

export function searchItems(items, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return items || [];
  return (items || []).filter((item) =>
    item.product_name.toLowerCase().includes(q)
    || (item.ean || '').includes(q)
    || (item.product_code || '').toLowerCase().includes(q));
}

// --- [BLOCO: Sincronização da Fila Offline] ---
// store: { listPending(), remove(uuid), markRejected(uuid, reason) }
// api:   { syncEntries(countId, entries) -> { results: [{client_uuid, status, reason}] } }

export const SYNC_BATCH_SIZE = 200;
// Campos enviados ao backend (status/motivo/quantidade local ficam só no aparelho)
const SYNC_FIELDS = ['client_uuid', 'item_id', 'mode', 'raw_qty', 'expression', 'packaging_id',
  'tare_total', 'tare_units', 'device_id', 'counted_at'];
const toPayload = (entry) => Object.fromEntries(SYNC_FIELDS.map((key) => [key, entry[key] ?? null]));

export async function syncOutbox(store, api) {
  const pending = (await store.listPending()).filter((e) => e.status !== 'rejected');
  const summary = { sent: 0, accepted: 0, duplicated: 0, rejected: 0, countIds: new Set() };
  const byCount = new Map();
  for (const entry of pending) {
    if (!byCount.has(entry.count_id)) byCount.set(entry.count_id, []);
    byCount.get(entry.count_id).push(entry);
  }
  for (const [countId, entries] of byCount) {
    for (let i = 0; i < entries.length; i += SYNC_BATCH_SIZE) {
      const batch = entries.slice(i, i + SYNC_BATCH_SIZE);
      const payload = batch.map(toPayload);
      const response = await api.syncEntries(countId, payload);
      summary.sent += batch.length;
      summary.countIds.add(countId);
      for (const result of response.results || []) {
        if (result.status === 'ACEITO') { summary.accepted += 1; await store.remove(result.client_uuid); }
        else if (result.status === 'DUPLICADO') { summary.duplicated += 1; await store.remove(result.client_uuid); }
        else { summary.rejected += 1; await store.markRejected(result.client_uuid, result.reason || 'Rejeitado'); }
      }
    }
  }
  return summary;
}

export const newUuid = () => {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
};
