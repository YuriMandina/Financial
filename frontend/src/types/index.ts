// --- [BLOCO: Tipos Derivados do Contrato OpenAPI] ---
import type { paths } from './api';

export type Paths = paths;

export type UserMeResponse = paths['/api/auth/me']['get']['responses'][200]['content']['application/json'];
export type LoginRequest = paths['/api/auth/login']['post']['requestBody']['content']['application/json'];
export type LoginResponse = paths['/api/auth/login']['post']['responses'][200]['content']['application/json'];
export type SnapshotsListResponse = paths['/api/snapshots']['get']['responses'][200]['content']['application/json'];
export type SnapshotItem = SnapshotsListResponse extends Array<infer T> ? T : never;

export type RelatorioSyncRequest = paths['/api/relatorios/{module}/sync']['post']['requestBody']['content']['application/json'];
export type RelatorioSyncResponse = paths['/api/relatorios/{module}/sync']['post']['responses'][200]['content']['application/json'];

// --- [BLOCO: Tipos de Navegação e Contexto da Aplicação] ---
export type MenuModulo = 
  | 'dashboard' 
  | 'contas-pagar' 
  | 'contas-pagas' 
  | 'recebimentos' 
  | 'curva-abc' 
  | 'dre-gerencial' 
  | 'desossa' 
  | 'configuracoes';

export interface TaskSyncItem {
  taskId: string;
  title: string;
  onSuccess?: string | (() => void) | null;
  status: 'processing' | 'duplicate' | 'completed' | 'error';
  text?: string;
  active: boolean;
  warning?: string | null;
}
