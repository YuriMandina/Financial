"""
Distribuição do App de Contagem (Android): versão publicada, endereços do servidor na rede
local e a página de instalação aberta pelo celular (via link ou QR Code).
"""
import html
import ipaddress
import json
import os
import socket
from datetime import datetime
from pathlib import Path
from string import Template
from typing import List, Optional

MOBILE_DIR = Path(__file__).resolve().parent.parent / "static" / "mobile"
APK_PATH = MOBILE_DIR / "contagem.apk"
INSTALL_PATH = "/api/estoque/app"
APK_DOWNLOAD_PATH = "/api/estoque/app/apk"


# ==============================================================================
# --- [BLOCO: Versão Publicada] ---
# ==============================================================================

def mobile_version() -> dict:
    try:
        data = json.loads((MOBILE_DIR / "version.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"version_name": None, "version_code": 0, "available": False}
    return {
        "version_name": data.get("versionName"),
        "version_code": int(data.get("versionCode") or 0),
        "available": APK_PATH.is_file(),
    }


def apk_details() -> dict:
    """Versão + tamanho e data de publicação do APK (para o painel e a página de instalação)."""
    info = mobile_version()
    if info["available"]:
        stat = APK_PATH.stat()
        info["size_bytes"] = stat.st_size
        info["published_at"] = datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds")
    else:
        info["size_bytes"] = None
        info["published_at"] = None
    return info


# ==============================================================================
# --- [BLOCO: Endereços na Rede Local] ---
# ==============================================================================
# O painel web costuma ser aberto em "localhost", que não serve para o celular.
# MOBILE_PUBLIC_URL (.env) fixa o endereço; sem ele, detecta os IPv4 privados do PC.

def _is_lan_ipv4(ip: str) -> bool:
    try:
        addr = ipaddress.IPv4Address(ip)
    except ValueError:
        return False
    return addr.is_private and not addr.is_loopback and not addr.is_link_local


def _primary_ipv4() -> Optional[str]:
    # "Conectar" UDP não envia pacotes: só revela a interface usada para sair da rede
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("10.255.255.255", 1))
            return sock.getsockname()[0]
    except OSError:
        return None


def lan_server_urls(port: Optional[int]) -> List[str]:
    configured = (os.getenv("MOBILE_PUBLIC_URL") or "").strip().rstrip("/")
    if configured:
        return [configured]
    ips: List[str] = []
    primary = _primary_ipv4()
    if primary:
        ips.append(primary)
    try:
        ips.extend(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError:
        pass
    port_suffix = f":{port}" if port and port not in (80, 443) else ""
    seen, urls = set(), []
    for ip in ips:
        if ip not in seen and _is_lan_ipv4(ip):
            seen.add(ip)
            urls.append(f"http://{ip}{port_suffix}")
    return urls


# ==============================================================================
# --- [BLOCO: Página de Instalação] ---
# ==============================================================================

def _format_size(size: Optional[int]) -> str:
    return f"{size / (1024 * 1024):.1f} MB".replace(".", ",") if size else ""


def render_install_page(server_url: str) -> str:
    info = apk_details()
    server = html.escape(server_url.rstrip("/"))
    if info["available"]:
        meta = " · ".join(filter(None, [f"Versão {html.escape(info['version_name'] or '')}".strip(),
                                         _format_size(info["size_bytes"])]))
        action = f'<a class="btn" href="{APK_DOWNLOAD_PATH}" download>Baixar o app</a><p class="meta">{meta}</p>'
    else:
        action = ('<div class="warn">O app ainda não foi publicado neste servidor. '
                  'Avise o responsável pelo sistema.</div>')
    return _PAGE.substitute(action=action, server=server)


_PAGE = Template("""<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Instalar App de Contagem</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         background: #020617; color: #e2e8f0; line-height: 1.5; }
  main { max-width: 480px; margin: 0 auto; padding: 28px 16px 40px; }
  h1 { font-size: 24px; margin: 0 0 4px; color: #fff; }
  .sub { color: #94a3b8; margin: 0 0 24px; }
  .btn { display: block; text-align: center; background: #4f46e5; color: #fff; text-decoration: none;
         font-weight: 700; font-size: 18px; padding: 16px; border-radius: 14px; }
  .btn:active { background: #4338ca; }
  .meta { text-align: center; color: #64748b; font-size: 13px; margin: 8px 0 0; }
  .warn { background: rgba(245,158,11,.1); border: 1px solid rgba(245,158,11,.3); color: #fde68a;
          padding: 14px; border-radius: 12px; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .04em; color: #94a3b8; margin: 32px 0 12px; }
  ol { margin: 0; padding: 0; list-style: none; counter-reset: step; }
  li { counter-increment: step; position: relative; padding: 0 0 16px 40px; }
  li::before { content: counter(step); position: absolute; left: 0; top: 0; width: 28px; height: 28px;
               border-radius: 50%; background: #1e293b; border: 1px solid #334155; color: #c7d2fe;
               font-weight: 700; font-size: 14px; display: flex; align-items: center; justify-content: center; }
  b { color: #fff; }
  .server { display: flex; gap: 8px; align-items: center; margin-top: 8px; background: #0f172a;
            border: 1px solid #334155; border-radius: 10px; padding: 10px 12px; }
  .server code { flex: 1; font-size: 15px; color: #a5b4fc; word-break: break-all; }
  .server button { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; border-radius: 8px;
                   padding: 6px 10px; font-size: 13px; }
  .note { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 14px; color: #94a3b8; font-size: 14px; }
</style>
</head>
<body>
<main>
  <h1>App de Contagem</h1>
  <p class="sub">Contagem de estoque do inventário pelo celular (Android).</p>
  $action

  <h2>Como instalar</h2>
  <ol>
    <li>Toque em <b>Baixar o app</b>. Se o navegador avisar que o arquivo pode ser perigoso, toque em <b>Baixar mesmo assim</b>.</li>
    <li>Abra o arquivo baixado (pela notificação ou na pasta <b>Downloads</b>).</li>
    <li>Se o Android pedir, toque em <b>Configurações</b> e ative <b>Permitir desta fonte</b>. Volte e toque em <b>Instalar</b>.</li>
    <li>Abra o app <b>Contagem Estoque</b>. No campo <b>Servidor</b>, use este endereço:
      <div class="server"><code id="server">$server</code><button type="button" onclick="copyServer(this)">Copiar</button></div>
    </li>
    <li>Entre com o mesmo e-mail e senha do sistema.</li>
  </ol>

  <h2>Atualizar</h2>
  <p class="note">Quando o app mostrar <b>Nova versão disponível</b>, baixe por esta mesma página e instale por cima.
  <b>Não desinstale</b> o app antigo: contagens ainda não enviadas ficam guardadas no celular.</p>
</main>
<script>
  function copyServer(btn) {
    var text = document.getElementById('server').textContent;
    var done = function () { btn.textContent = 'Copiado'; setTimeout(function () { btn.textContent = 'Copiar'; }, 1500); };
    if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(done); return; }
    var area = document.createElement('textarea');
    area.value = text; document.body.appendChild(area); area.select();
    try { document.execCommand('copy'); done(); } catch (e) {}
    document.body.removeChild(area);
  }
</script>
</body>
</html>
""")
