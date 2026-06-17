import React, { useState, useEffect } from 'react';
import { Loader2, Mail, Lock, UserPlus, LogIn, Settings, Users, Link } from 'lucide-react';

export const AuthScreen = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inviteToken, setInviteToken] = useState('');

  useEffect(() => {
    // Check if there is an invite token in the URL
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      setInviteToken(token);
      setIsLogin(false); // Default to register if they clicked an invite
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    if (!isLogin && password !== confirmPassword) {
      setError('As senhas não coincidem!');
      setLoading(false);
      return;
    }

    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const payload = isLogin ? { email, password } : { name, email, password, password_confirm: confirmPassword };
      const res = await fetch(`http://localhost:8000${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.detail || 'Ocorreu um erro');
      }
      
      if (isLogin) {
        localStorage.setItem('token', data.access_token);
        
        // If there was an invite token, accept it now
        if (inviteToken) {
          try {
            await fetch('http://localhost:8000/api/invites/accept', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${data.access_token}`
              },
              body: JSON.stringify({ token: inviteToken })
            });
            // Token accepted, clean URL
            window.history.replaceState({}, document.title, "/");
          } catch (err) {
            console.error("Erro ao aceitar convite:", err);
          }
        }
        
        onLogin(data.access_token);
      } else {
        // Registered successfully, switch to login or login automatically
        setIsLogin(true);
        setError('Conta criada com sucesso! Faça login.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-indigo-500/10 rounded-full blur-[100px] transform-gpu pointer-events-none z-0"></div>
      <div className="absolute bottom-[-10%] right-[-5%] w-96 h-96 bg-purple-500/10 rounded-full blur-[100px] transform-gpu pointer-events-none z-0"></div>
      
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-8 shadow-2xl z-10 relative">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-indigo-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-indigo-500/30">
            <LogIn size={32} className="text-indigo-400" />
          </div>
          <h1 className="text-3xl font-black text-white">{isLogin ? 'Bem-vindo de volta' : 'Criar nova conta'}</h1>
          <p className="text-slate-400 mt-2 font-medium">
            {inviteToken && !isLogin ? "Você recebeu um convite! Crie sua conta para aceitar." : "Acesse o painel financeiro da sua organização"}
          </p>
        </div>

        {error && (
          <div className={`p-4 rounded-xl mb-6 font-medium text-sm ${error.includes('sucesso') ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="block text-sm font-bold text-slate-300 mb-2">Nome Completo</label>
              <div className="relative">
                <Users className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input 
                  type="text" 
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required={!isLogin}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl pl-12 pr-4 py-3 outline-none focus:border-indigo-500 transition-colors font-medium"
                  placeholder="Seu nome"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-bold text-slate-300 mb-2">E-mail</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input 
                type="email" 
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl pl-12 pr-4 py-3 outline-none focus:border-indigo-500 transition-colors font-medium"
                placeholder="seu@email.com"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-bold text-slate-300 mb-2">Senha</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input 
                type="password" 
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl pl-12 pr-4 py-3 outline-none focus:border-indigo-500 transition-colors font-medium"
                placeholder="••••••••"
              />
            </div>
          </div>

          {!isLogin && (
            <div>
              <label className="block text-sm font-bold text-slate-300 mb-2">Confirmar Senha</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input 
                  type="password" 
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required={!isLogin}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl pl-12 pr-4 py-3 outline-none focus:border-indigo-500 transition-colors font-medium"
                  placeholder="••••••••"
                />
              </div>
            </div>
          )}

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 mt-6 disabled:opacity-50"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : (isLogin ? <LogIn size={20} /> : <UserPlus size={20} />)}
            {isLogin ? 'Entrar no Sistema' : 'Criar Conta'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button 
            onClick={() => { setIsLogin(!isLogin); setError(''); }}
            className="text-indigo-400 hover:text-indigo-300 font-bold text-sm transition-colors"
          >
            {isLogin ? 'Não tem uma conta? Cadastre-se' : 'Já tem uma conta? Faça Login'}
          </button>
        </div>
      </div>
    </div>
  );
};
