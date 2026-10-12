# --- [BLOCO: Cliente HTTP Centralizado e Connection Pooling] ---
import logging
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

try:
    import httpx
    HAS_HTTPX = True
    # Connection pooling e timeouts padronizados para APIs externas (Omie/Receita/etc)
    limits = httpx.Limits(max_keepalive_connections=20, max_connections=50, keepalive_expiry=30.0)
    timeout = httpx.Timeout(20.0, connect=10.0)
except ImportError:
    httpx = None
    HAS_HTTPX = False
    logger.warning("Biblioteca 'httpx' não encontrada no ambiente atual. Operações assíncronas de HTTP utilizarão fallback.")

_async_client: Optional[Any] = None

def get_async_client() -> Optional[Any]:
    """Retorna uma instância única e reutilizável de AsyncClient com pooling ativo se httpx estiver disponível."""
    global _async_client
    if not HAS_HTTPX:
        return None
    if _async_client is None or getattr(_async_client, 'is_closed', True):
        _async_client = httpx.AsyncClient(limits=limits, timeout=timeout)
    return _async_client

async def close_async_client():
    """Fecha a pool de conexões HTTP no encerramento da aplicação (no-op seguro caso httpx não esteja instalado)."""
    global _async_client
    if HAS_HTTPX and _async_client and not getattr(_async_client, 'is_closed', True):
        await _async_client.aclose()
        _async_client = None
