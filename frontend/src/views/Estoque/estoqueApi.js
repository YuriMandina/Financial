// Cliente da API do Módulo de Inventário e constantes de exibição compartilhadas pelo painel.
import { API_BASE } from '../../config/api';

// --- [BLOCO: Requisições] ---
export class EstoqueApiError extends Error {
  constructor(message, details = null, status = 0) {
    super(message);
    this.details = details;
    this.status = status;
  }
}

export function createEstoqueApi(token) {
  const request = async (path, { method = 'GET', body, raw = false } = {}) => {
    const headers = { Authorization: `Bearer ${token}` };
    const isForm = body instanceof FormData;
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${API_BASE}/api/estoque${path}`, {
      method, headers, body: body === undefined ? undefined : (isForm ? body : JSON.stringify(body)),
    });
    if (raw && res.ok) return res;
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const detail = data?.detail;
      const message = typeof detail === 'string' ? detail : detail?.message || `Erro ${res.status}`;
      throw new EstoqueApiError(message, detail?.details || null, res.status);
    }
    return data;
  };

  return {
    // Cadastro
    familias: () => request('/familias'),
    toggleFamilia: (id, active) => request(`/familias/${id}`, { method: 'PUT', body: { is_active_for_inventory: active } }),
    produtos: (familyId) => request(`/produtos?family_id=${familyId}`),
    toggleProduto: (id, value) => request(`/produtos/${id}`, { method: 'PUT', body: { is_inventory_default: value } }),
    toggleProdutosFamilia: (familyId, value) =>
      request(`/familias/${familyId}/produtos-padrao`, { method: 'PUT', body: { is_inventory_default: value } }),
    criarEmbalagem: (productId, data) => request(`/produtos/${productId}/embalagens`, { method: 'POST', body: data }),
    atualizarEmbalagem: (id, data) => request(`/embalagens/${id}`, { method: 'PUT', body: data }),
    removerEmbalagem: (id) => request(`/embalagens/${id}`, { method: 'DELETE' }),
    pendencias: () => request('/pendencias'),
    atribuirFamilia: (productId, familyId) => request(`/pendencias/${productId}/familia`, { method: 'PUT', body: { family_id: familyId } }),
    sincronizarCatalogo: () => request('/catalogo/sincronizar', { method: 'POST' }),
    usuarios: () => request('/usuarios'),
    alterarPapel: (userId, role) => request(`/usuarios/${userId}/papel`, { method: 'PUT', body: { inventory_role: role } }),
    // Inventários
    motivos: () => request('/motivos'),
    indicadores: (params = {}) => request(`/indicadores?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`),
    inventarios: () => request('/inventarios'),
    inventario: (id) => request(`/inventarios/${id}`),
    criarInventario: (data) => request('/inventarios', { method: 'POST', body: data }),
    atualizarEscopo: (id, productIds) => request(`/inventarios/${id}/escopo`, { method: 'PUT', body: { product_ids: productIds } }),
    excluirRascunho: (id) => request(`/inventarios/${id}`, { method: 'DELETE' }),
    transicao: (id, action) => request(`/inventarios/${id}/transicao`, { method: 'POST', body: { action } }),
    snapshot: (id) => request(`/inventarios/${id}/snapshot`, { method: 'POST' }),
    pendenciasAprovacao: (id) => request(`/inventarios/${id}/pendencias`),
    resumo: (id) => request(`/inventarios/${id}/resumo`),
    paresSugeridos: (id) => request(`/inventarios/${id}/pares-sugeridos`),
    recontagemSugerida: (id) => request(`/inventarios/${id}/recontagem-sugerida`, { method: 'POST' }),
    conferenciaLote: (id, data) => request(`/inventarios/${id}/conferencia-lote`, { method: 'POST', body: data }),
    solicitarRecontagem: (itemId) => request(`/itens/${itemId}/recontagem`, { method: 'POST' }),
    atualizarConferencia: (itemId, data) => request(`/itens/${itemId}/conferencia`, { method: 'PUT', body: data }),
    atualizarMotivos: (itemId, reasons) => request(`/itens/${itemId}/motivos`, { method: 'PUT', body: { reasons } }),
    enviarViaAssinada: (id, file) => {
      const form = new FormData();
      form.append('file', file);
      return request(`/inventarios/${id}/via-assinada`, { method: 'POST', body: form });
    },
    baixar: async (path, filename) => {
      const res = await request(path, { raw: true });
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
  };
}

// --- [BLOCO: Constantes de Exibição] ---
export const STATUS_INFO = {
  RASCUNHO: { label: 'Rascunho', cls: 'bg-slate-800 text-slate-300 border-slate-700' },
  EM_CONTAGEM: { label: 'Em contagem', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/30' },
  CONFERENCIA: { label: 'Conferência', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  AGUARDANDO_APROVACAO: { label: 'Aguardando aprovação', cls: 'bg-violet-500/10 text-violet-300 border-violet-500/30' },
  APROVADO: { label: 'Aprovado', cls: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30' },
  EFETIVANDO: { label: 'Efetivando na Omie', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/30' },
  EFETIVANDO_COM_ERRO: { label: 'Erro na efetivação', cls: 'bg-rose-500/10 text-rose-300 border-rose-500/30' },
  EFETIVADO: { label: 'Efetivado', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  REVERTENDO: { label: 'Revertendo', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  REVERSAO_COM_ERRO: { label: 'Erro na reversão', cls: 'bg-rose-500/10 text-rose-300 border-rose-500/30' },
  CONCLUIDO: { label: 'Concluído', cls: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40' },
  CANCELADO: { label: 'Cancelado', cls: 'bg-slate-800 text-slate-500 border-slate-700' },
};

export const CASE_INFO = {
  A: 'Ajuste simples pela diferença (a CMC)',
  B: 'Saldo negativo: ajuste de saldo ao custo de referência',
  C: 'CMC suspeito: correção opcional ao custo de referência',
  D: 'Saldo negativo zerado: ajuste de saldo para zero',
};

export const formatQty = (v) => (v === null || v === undefined ? '—'
  : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 4 }));
export const formatMoney = (v) => (v === null || v === undefined ? '—'
  : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
export const formatDate = (iso) => (iso ? new Date(String(iso).length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR') : '—');
export const formatDateTime = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
