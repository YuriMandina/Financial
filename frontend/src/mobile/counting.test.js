import { describe, expect, it } from 'vitest';
import {
  evaluateExpression, computeEntryQuantity, localItemTotal, itemEditable,
  findByCode, searchItems, syncOutbox,
} from './counting';

describe('calculadora', () => {
  it('soma caixas e avulsas', () => {
    expect(evaluateExpression('12*12+6')).toBe(150);
    expect(evaluateExpression('12x12 + 6')).toBe(150);
    expect(evaluateExpression('(2+3)*4')).toBe(20);
  });
  it('aceita vírgula decimal', () => {
    expect(evaluateExpression('3,450 + 2,120')).toBe(5.57);
  });
  it('rejeita entradas inválidas', () => {
    expect(() => evaluateExpression('')).toThrow();
    expect(() => evaluateExpression('2+')).toThrow();
    expect(() => evaluateExpression('1/0')).toThrow();
    expect(() => evaluateExpression('alert(1)')).toThrow();
    expect(() => evaluateExpression('(2+3')).toThrow();
  });
});

describe('quantidade do lançamento', () => {
  it('embalagem x fator', () => expect(computeEntryQuantity('EMB', 12, 12)).toBe(144));
  it('peso menos tara', () => expect(computeEntryQuantity('PESO', 12.5, 1, 0.8)).toBe(11.7));
  it('valida entradas', () => {
    expect(() => computeEntryQuantity('UN', 0)).toThrow();
    expect(() => computeEntryQuantity('PESO', 0.5, 1, 0.8)).toThrow();
  });
});

describe('totais e busca locais', () => {
  const items = [
    { id: 1, product_name: 'Coca 2L', ean: '789', omie_id: 10, counted_qty: 10, packagings: [{ id: 5, ean: 'DUN789', factor: 6 }] },
    { id: 2, product_name: 'Agua 500ml', ean: null, omie_id: 11, counted_qty: 0, packagings: [] },
  ];
  it('soma pendentes ao contado no servidor, ignorando rejeitados', () => {
    const pending = [
      { item_id: 1, quantity: 6 },
      { item_id: 1, quantity: 100, status: 'rejected' },
      { item_id: 2, quantity: 3 },
    ];
    expect(localItemTotal(items[0], pending)).toBe(16);
  });
  it('resolve EAN do produto e DUN da caixa', () => {
    expect(findByCode(items, '789').item.id).toBe(1);
    expect(findByCode(items, 'DUN789').packaging.factor).toBe(6);
    expect(findByCode(items, 'nada')).toBeNull();
  });
  it('busca por nome, EAN ou código', () => {
    expect(searchItems(items, 'agua').map((i) => i.id)).toEqual([2]);
    expect(searchItems(items, '11').map((i) => i.id)).toEqual([2]);
  });
  it('só permite lançar em contagem ou recontagem', () => {
    expect(itemEditable({ status: 'EM_CONTAGEM' }, { count_status: 'PENDENTE' })).toBe(true);
    expect(itemEditable({ status: 'CONFERENCIA' }, { count_status: 'CONTADO', current_round: 1 })).toBe(false);
    expect(itemEditable({ status: 'CONFERENCIA' }, { count_status: 'RECONTAGEM', current_round: 2 })).toBe(true);
  });
});

describe('sincronização da fila offline', () => {
  const makeStore = (entries) => {
    const data = new Map(entries.map((e) => [e.client_uuid, { ...e }]));
    return {
      data,
      listPending: async () => [...data.values()],
      remove: async (uuid) => { data.delete(uuid); },
      markRejected: async (uuid, reason) => { Object.assign(data.get(uuid), { status: 'rejected', reason }); },
    };
  };

  it('remove aceitos e duplicados, marca rejeitados e não reenvia rejeitados', async () => {
    const store = makeStore([
      { client_uuid: 'a', count_id: 1, item_id: 1, quantity: 6, mode: 'UN', raw_qty: 6 },
      { client_uuid: 'b', count_id: 1, item_id: 1, quantity: 1, mode: 'UN', raw_qty: 1 },
      { client_uuid: 'c', count_id: 1, item_id: 2, quantity: 2, mode: 'UN', raw_qty: 2 },
      { client_uuid: 'd', count_id: 1, item_id: 2, quantity: 9, status: 'rejected', reason: 'x' },
    ]);
    const calls = [];
    const api = {
      syncEntries: async (countId, payload) => {
        calls.push({ countId, payload });
        return { results: [
          { client_uuid: 'a', status: 'ACEITO' },
          { client_uuid: 'b', status: 'DUPLICADO' },
          { client_uuid: 'c', status: 'REJEITADO', reason: 'CONTAGEM_ENCERRADA' },
        ] };
      },
    };
    const summary = await syncOutbox(store, api);
    expect(calls).toHaveLength(1);
    expect(calls[0].payload.map((e) => e.client_uuid)).toEqual(['a', 'b', 'c']);
    expect(calls[0].payload[0]).not.toHaveProperty('quantity');
    expect(calls[0].payload[0]).not.toHaveProperty('count_id');
    expect(summary).toMatchObject({ accepted: 1, duplicated: 1, rejected: 1 });
    expect([...store.data.keys()]).toEqual(['c', 'd']);
    expect(store.data.get('c').reason).toBe('CONTAGEM_ENCERRADA');
  });

  it('falha de rede mantém a fila intacta para nova tentativa', async () => {
    const store = makeStore([{ client_uuid: 'a', count_id: 1, item_id: 1, quantity: 1 }]);
    const api = { syncEntries: async () => { throw new Error('offline'); } };
    await expect(syncOutbox(store, api)).rejects.toThrow('offline');
    expect(store.data.has('a')).toBe(true);
  });
});
