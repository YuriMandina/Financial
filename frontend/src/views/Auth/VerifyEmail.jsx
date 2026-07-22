import React, { useEffect, useState, useRef } from 'react';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

export const VerifyEmail = ({ onVerified }) => {
  const [status, setStatus] = useState('loading'); // loading, success, error
  const [message, setMessage] = useState('Verificando seu e-mail...');
  const hasFetched = useRef(false);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    
    const verifyToken = async () => {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token');

      if (!token) {
        setStatus('error');
        setMessage('O link de verificação está ausente ou corrompido. Por favor, utilize o link exato enviado para o seu e-mail.');
        return;
      }

      try {
        const res = await fetch(`http://localhost:8000/api/auth/verify-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ token: token })
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.detail || 'Não foi possível validar o seu e-mail no momento. Tente novamente mais tarde.');
        }

        setStatus('success');
        setMessage('E-mail validado com sucesso! Sua conta está ativa. Estamos redirecionando você para o painel financeiro...');
        
        // Se houver um token de acesso retornado, já podemos logar
        if (data.access_token) {
          localStorage.setItem('token', data.access_token);
          setTimeout(() => {
            window.history.replaceState({}, document.title, "/");
            onVerified(data.access_token);
          }, 2000);
        }
      } catch (err) {
        setStatus('error');
        setMessage(err.message);
      }
    };

    verifyToken();
  }, [onVerified]);

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-8 shadow-2xl text-center relative overflow-hidden">
        <div className="absolute top-[-50px] left-[-50px] w-40 h-40 bg-indigo-500/20 rounded-full blur-[50px] pointer-events-none z-0"></div>
        
        <div className="relative z-10 flex flex-col items-center">
          {status === 'loading' && (
            <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mb-6">
              <Loader2 className="animate-spin text-indigo-400" size={32} />
            </div>
          )}
          
          {status === 'success' && (
            <div className="w-16 h-16 bg-emerald-500/20 rounded-2xl flex items-center justify-center mb-6 border border-emerald-500/30">
              <CheckCircle2 size={32} className="text-emerald-400" />
            </div>
          )}

          {status === 'error' && (
            <div className="w-16 h-16 bg-red-500/20 rounded-2xl flex items-center justify-center mb-6 border border-red-500/30">
              <XCircle size={32} className="text-red-400" />
            </div>
          )}

          <h2 className="text-3xl font-black text-white mb-3">
            {status === 'loading' ? 'Verificando E-mail' : status === 'success' ? 'Conta Ativada!' : 'Falha na Validação'}
          </h2>
          <p className="text-slate-400 font-medium mb-8 leading-relaxed max-w-sm mx-auto">{message}</p>

          {status === 'error' && (
            <button 
              onClick={() => window.location.href = '/'}
              className="bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 px-6 rounded-xl transition-colors"
            >
              Voltar ao Início
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
