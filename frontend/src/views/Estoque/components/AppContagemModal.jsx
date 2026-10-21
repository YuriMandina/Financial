// Distribuição do app de contagem: QR Code da página de instalação para o celular e download direto do APK.
import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Download, Smartphone } from 'lucide-react';
import Skeleton from '../../../components/common/Skeleton';
import { API_BASE } from '../../../config/api';
import { formatDateTime } from '../estoqueApi';
import { Alert, Button, Modal } from './ui';

const formatSize = (bytes) => (bytes ? `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : null);

// --- [BLOCO: Botão de Abertura] ---
export function AppContagemButton({ api }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon={Smartphone} onClick={() => setOpen(true)}>App de contagem</Button>
      {open && <AppContagemModal api={api} onClose={() => setOpen(false)} />}
    </>
  );
}

// --- [BLOCO: Modal] ---
export default function AppContagemModal({ api, onClose }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [server, setServer] = useState(null);
  const [qrCode, setQrCode] = useState({ url: null, image: null });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.appDistribuicao()
      .then((data) => { setInfo(data); setServer(data.servers[0] || null); })
      .catch((e) => setError(e.message));
  }, [api]);

  const installUrl = info && server ? `${server}${info.install_path}` : null;

  // Guarda a URL junto da imagem: ao trocar de endereço, o QR antigo some até o novo ficar pronto
  const qr = qrCode.url === installUrl ? qrCode.image : null;
  useEffect(() => {
    if (!installUrl) return;
    QRCode.toDataURL(installUrl, { margin: 1, width: 480, errorCorrectionLevel: 'M' })
      .then((image) => setQrCode({ url: installUrl, image }))
      .catch(() => setQrCode({ url: installUrl, image: null }));
  }, [installUrl]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(installUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* área de transferência indisponível: o link continua visível para copiar manualmente */ }
  };

  const meta = info?.available
    ? [`Versão ${info.version_name}`, formatSize(info.size_bytes), info.published_at && `publicada em ${formatDateTime(info.published_at)}`]
      .filter(Boolean).join(' · ')
    : null;

  return (
    <Modal title="App de contagem (Android)" subtitle="Instale o app nos celulares da equipe para lançar as contagens"
      onClose={onClose} width="max-w-3xl"
      footer={(
        <>
          <Button onClick={onClose}>Fechar</Button>
          {info?.available && (
            <a href={`${API_BASE}${info.apk_path}`} download
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white">
              <Download size={16} /> Baixar APK neste computador
            </a>
          )}
        </>
      )}>
      {error && <Alert>{error}</Alert>}

      {/* --- [BLOCO: Carregando] --- */}
      {!info && !error && (
        <div className="flex flex-col md:flex-row gap-6">
          <Skeleton className="w-60 h-60 rounded-2xl shrink-0" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-10 w-full mt-4" />
          </div>
        </div>
      )}

      {info && !info.available && (
        <Alert tone="warn">
          O app ainda não foi publicado neste servidor. O responsável técnico deve gerar o APK com
          <code className="mx-1 px-1.5 py-0.5 rounded bg-slate-950 text-amber-100">npm run apk</code>
          (pasta <code className="px-1.5 py-0.5 rounded bg-slate-950 text-amber-100">frontend</code>).
        </Alert>
      )}

      {/* --- [BLOCO: QR Code e Passo a Passo] --- */}
      {info?.available && (
        <div className="space-y-5">
          {!server && (
            <Alert tone="warn">
              Não foi possível identificar o endereço deste servidor na rede local. Defina
              <code className="mx-1 px-1.5 py-0.5 rounded bg-slate-950">MOBILE_PUBLIC_URL</code>
              no <code className="px-1.5 py-0.5 rounded bg-slate-950">.env</code> do backend (ex: http://192.168.0.11:8000).
              Enquanto isso, use o botão abaixo e envie o APK ao celular por cabo ou mensagem.
            </Alert>
          )}

          {server && (
            <div className="flex flex-col md:flex-row gap-6">
              <div className="w-60 h-60 shrink-0 rounded-2xl bg-white p-3 self-center md:self-start">
                {qr ? <img src={qr} alt="QR Code da página de instalação" className="w-full h-full" />
                  : <Skeleton className="w-full h-full" />}
              </div>
              <div className="flex-1 min-w-0 space-y-4">
                <ol className="space-y-2.5 text-sm text-slate-300">
                  {[
                    <>Conecte o celular ao <b className="text-white">Wi-Fi da loja</b>.</>,
                    <>Aponte a <b className="text-white">câmera</b> para o QR Code e toque no link que aparecer.</>,
                    <>Na página que abrir, toque em <b className="text-white">Baixar o app</b> e siga as instruções de instalação.</>,
                    <>No app, entre com o mesmo <b className="text-white">e-mail e senha</b> do sistema.</>,
                  ].map((step, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="w-6 h-6 shrink-0 rounded-full bg-slate-800 border border-slate-700 text-indigo-300 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                      <span className="pt-0.5">{step}</span>
                    </li>
                  ))}
                </ol>

                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wide mb-1.5">Link da página de instalação</p>
                  <div className="flex items-center gap-2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2">
                    <code className="flex-1 text-sm text-indigo-300 truncate">{installUrl}</code>
                    <button onClick={copy} title="Copiar link" className="text-slate-400 hover:text-white">
                      {copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5">Também pode ser enviado por mensagem e aberto no navegador do celular.</p>
                </div>

                {info.servers.length > 1 && (
                  <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wide mb-1.5">Endereço na rede</p>
                    <div className="flex flex-wrap gap-2">
                      {info.servers.map((s) => (
                        <button key={s} onClick={() => setServer(s)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${s === server
                            ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-200' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'}`}>
                          {s.replace(/^https?:\/\//, '')}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-slate-500 mt-1.5">Se o QR Code não abrir no celular, tente outro endereço.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          <p className="text-xs text-slate-500 border-t border-slate-800 pt-4">
            {meta}. Para atualizar, basta instalar a nova versão por cima — não desinstale o app, pois contagens
            ainda não enviadas ficam guardadas no celular.
          </p>
        </div>
      )}
    </Modal>
  );
}
