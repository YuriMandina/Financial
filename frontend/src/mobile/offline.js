// Armazenamento offline do app (IndexedDB): inventários em cache e fila de lançamentos pendentes.
import { openDB } from 'idb';

const DB_NAME = 'contagem';
const DB_VERSION = 1;

let dbPromise = null;
const db = () => {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        database.createObjectStore('counts', { keyPath: 'id' });        // detalhe do inventário (visão cega)
        database.createObjectStore('meta');                              // lista de inventários, etc.
        const outbox = database.createObjectStore('outbox', { keyPath: 'client_uuid' });
        outbox.createIndex('by_count', 'count_id');
      },
    });
  }
  return dbPromise;
};

// --- [BLOCO: Cache de Inventários] ---
export const cacheCountList = async (counts) => (await db()).put('meta', counts, 'countList');
export const getCachedCountList = async () => (await db()).get('meta', 'countList');
export const cacheCount = async (count) => (await db()).put('counts', { ...count, cached_at: new Date().toISOString() });
export const getCachedCount = async (countId) => (await db()).get('counts', countId);

// --- [BLOCO: Fila de Lançamentos] ---
export const outboxStore = {
  async add(entry) { return (await db()).put('outbox', { ...entry, status: 'pending' }); },
  async listPending(countId) {
    const database = await db();
    if (countId === undefined) return database.getAll('outbox');
    return database.getAllFromIndex('outbox', 'by_count', countId);
  },
  async remove(uuid) { return (await db()).delete('outbox', uuid); },
  async markRejected(uuid, reason) {
    const database = await db();
    const entry = await database.get('outbox', uuid);
    if (entry) await database.put('outbox', { ...entry, status: 'rejected', reason });
  },
};
