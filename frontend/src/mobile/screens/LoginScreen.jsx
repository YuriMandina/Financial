/* global __APP_VERSION__ */
import React, { useState } from 'react';
import { ClipboardList, LoaderCircle, Server } from 'lucide-react';
import { api, getServer, setServer } from '../api';
import { Banner, PrimaryButton } from '../components';

const inputClass = 'w-full h-12 px-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-emerald-500 outline-none text-base';

export default function LoginScreen({ notice, onLoggedIn }) {
  const [server, setServerField] = useState(getServer());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(notice ? { tone: 'warn', text: notice } : null);

  // --- [BLOCO: Teste de Conexão] ---
  const testServer = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api.appVersion(server.trim().replace(/\/+$/, ''));
      setMessage({ tone: 'ok', text: 'Servidor encontrado.' });
    } catch {
      setMessage({ tone: 'error', text: 'Servidor não respondeu. Confira o endereço e se o celular está no Wi-Fi da loja.' });
    } finally {
      setBusy(false);
    }
  };

  // --- [BLOCO: Login] ---
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      setServer(server);
      const user = await api.login(email.trim(), password);
      onLoggedIn(user);
    } catch (err) {
      setMessage({ tone: 'error', text: err.offline ? 'Sem conexão com o servidor.' : err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center px-5 py-8 safe-top pb-safe-6">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-12 h-12 rounded-xl bg-emerald-600/20 text-emerald-400 flex items-center justify-center">
          <ClipboardList size={26} />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Contagem de Estoque</h1>
          <p className="text-sm text-slate-400">Inventário por família</p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="text-sm text-slate-300">Servidor</span>
          <div className="flex gap-2 mt-1">
            <input className={inputClass} value={server} onChange={(e) => setServerField(e.target.value)}
              inputMode="url" autoCapitalize="none" autoCorrect="off" />
            <button type="button" onClick={testServer} disabled={busy}
              className="h-12 px-3 rounded-xl border border-slate-700 active:bg-slate-800 flex items-center gap-1.5 text-sm shrink-0">
              <Server size={18} /> Testar
            </button>
          </div>
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">E-mail</span>
          <input className={`${inputClass} mt-1`} value={email} onChange={(e) => setEmail(e.target.value)}
            type="email" autoCapitalize="none" autoComplete="username" required />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Senha</span>
          <input className={`${inputClass} mt-1`} value={password} onChange={(e) => setPassword(e.target.value)}
            type="password" autoComplete="current-password" required />
        </label>
        {message && <div className="-mx-3"><Banner tone={message.tone}>{message.text}</Banner></div>}
        <PrimaryButton type="submit" disabled={busy}>
          {busy && <LoaderCircle size={20} className="animate-spin" />} Entrar
        </PrimaryButton>
      </form>
      <p className="text-center text-xs text-slate-600 mt-10">Versão {__APP_VERSION__}</p>
    </div>
  );
}
