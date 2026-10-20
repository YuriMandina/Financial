// --- [BLOCO: Endereço da API] ---
// Vazio = mesma origem: no PC o Vite encaminha /api para o backend (proxy em vite.config.js).
// Builds que rodam fora do servidor web (ex: app Android) definem VITE_API_BASE ou usam seu próprio cliente.
export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
