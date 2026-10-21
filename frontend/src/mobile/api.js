// Cliente HTTP do app de contagem: servidor configurável (IP do PC na rede local) e token próprio.
import { newUuid } from './counting';

// --- [BLOCO: Configuração Local] ---
const KEYS = { server: 'contagem.server', token: 'contagem.token', user: 'contagem.user', device: 'contagem.device', email: 'contagem.email' };
export const DEFAULT_SERVER = 'http://192.168.0.11:8000';
const TIMEOUT_MS = 15000;

const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* armazenamento indisponível: segue apenas em memória */ }
};

export const getServer = () => read(KEYS.server) || DEFAULT_SERVER;
export const setServer = (url) => write(KEYS.server, String(url || '').trim().replace(/\/+$/, ''));
export const getToken = () => read(KEYS.token);
export const getSavedEmail = () => read(KEYS.email) || '';
export const hasSavedServer = () => Boolean(read(KEYS.server));
export const getUser = () => { try { return JSON.parse(read(KEYS.user) || 'null'); } catch { return null; } };
export const clearSession = () => { write(KEYS.token, null); write(KEYS.user, null); };

export const getDeviceId = () => {
  let id = read(KEYS.device);
  if (!id) { id = newUuid(); write(KEYS.device, id); }
  return id;
};

// --- [BLOCO: Requisições] ---
export class ApiError extends Error {
  constructor(message, { status = 0, offline = false, details = null } = {}) {
    super(message);
    this.status = status;
    this.offline = offline;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, auth = true, server, timeoutMs = TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && getToken()) headers.Authorization = `Bearer ${getToken()}`;
  let res;
  try {
    res = await fetch(`${server || getServer()}${path}`, {
      method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: controller.signal,
    });
  } catch {
    throw new ApiError('Sem conexão com o servidor.', { offline: true });
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const detail = data?.detail;
    const message = typeof detail === 'string' ? detail : detail?.message || `Erro ${res.status}`;
    if (res.status === 401 && auth) clearSession();
    throw new ApiError(message, { status: res.status, details: detail?.details || null });
  }
  return data;
}

// --- [BLOCO: Endpoints] ---
export const api = {
  appVersion: (server) => request('/api/estoque/app/versao', { auth: false, server, timeoutMs: 5000 }),

  async login(email, password, remember = false) {
    const data = await request('/api/auth/login', { method: 'POST', body: { email, password, remember }, auth: false });
    write(KEYS.token, data.access_token);
    write(KEYS.email, email);
    const me = await request('/api/auth/me');
    write(KEYS.user, JSON.stringify({ name: me.name || (me.email || '').split('@')[0], email: me.email }));
    return getUser();
  },

  listCounts: () => request('/api/estoque/inventarios'),
  getCountForCounting: (countId) => request(`/api/estoque/inventarios/${countId}/contagem`),
  syncEntries: (countId, entries) =>
    request(`/api/estoque/inventarios/${countId}/lancamentos/sync`, { method: 'POST', body: { entries } }),
  voidEntry: (entryId) => request(`/api/estoque/lancamentos/${entryId}/estornar`, { method: 'POST' }),
  confirmZero: (itemId, confirmed) =>
    request(`/api/estoque/itens/${itemId}/zerado`, { method: 'POST', body: { confirmed } }),
};

export const apkUrl = () => `${getServer()}/api/estoque/app/apk`;
