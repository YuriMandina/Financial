import React, { useState, useEffect } from 'react';
import { Loader2, Key, Users, UserPlus, Send, Copy, Settings as SettingsIcon, Eye, EyeOff, X, UserX, UserCheck } from 'lucide-react';

export const Settings = ({ token }) => {
  const [activeTab, setActiveTab] = useState('omie');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Omie Keys
  const [appKey, setAppKey] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [showAppKey, setShowAppKey] = useState(false);
  const [showAppSecret, setShowAppSecret] = useState(false);

  // Invites
  const [inviteEmail, setInviteEmail] = useState('');
  const [members, setMembers] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);

  useEffect(() => {
    loadSettings();
  }, [activeTab]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      if (activeTab === 'omie') {
        const res = await fetch('http://localhost:8000/api/settings/omie', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        setAppKey(data.app_key || '');
        setAppSecret(data.app_secret || '');
      } else {
        const res = await fetch('http://localhost:8000/api/invites/list', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        setMembers(data.members || []);
        setPendingInvites(data.pending_invites || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveOmie = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('http://localhost:8000/api/settings/omie', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ app_key: appKey, app_secret: appSecret })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Erro ao salvar as chaves');
      setSuccess('Chaves da Omie atualizadas com sucesso!');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSendInvite = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('http://localhost:8000/api/invites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ email: inviteEmail })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Erro ao enviar convite');
      setSuccess('Convite enviado com sucesso para ' + inviteEmail);
      setInviteEmail('');
      loadSettings();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelInvite = async (inviteId) => {
    if (!window.confirm("Tem certeza que deseja cancelar este convite?")) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`http://localhost:8000/api/invites/${inviteId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Erro ao cancelar convite');
      setSuccess('Convite cancelado.');
      loadSettings();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async (userId) => {
    if (!window.confirm("Tem certeza que deseja alterar o status deste membro?")) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`http://localhost:8000/api/invites/users/${userId}/toggle-status`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Erro ao alterar status');
      setSuccess(data.message);
      loadSettings();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 p-8 z-10 print:hidden overflow-y-auto">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center border border-slate-700">
          <SettingsIcon size={24} className="text-slate-300" />
        </div>
        <div>
          <h2 className="text-3xl font-bold text-white mb-1">Configurações da Conta</h2>
          <p className="text-slate-400">Gerencie a integração com a Omie e os convites da sua equipe</p>
        </div>
      </div>

      <div className="bg-slate-900/80 border border-white/[0.05] rounded-2xl overflow-hidden flex flex-col md:flex-row">
        <div className="md:w-64 bg-slate-950/50 p-6 flex flex-col gap-2 border-r border-white/[0.05]">
          <button 
            onClick={() => setActiveTab('omie')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-colors ${activeTab === 'omie' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
          >
            <Key size={18} /> Integração Omie
          </button>
          <button 
            onClick={() => setActiveTab('invites')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-colors ${activeTab === 'invites' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
          >
            <Users size={18} /> Membros e Convites
          </button>
        </div>

        <div className="flex-1 p-8">
          {error && <div className="bg-red-500/10 text-red-400 border border-red-500/20 p-4 rounded-xl mb-6 font-medium text-sm">{error}</div>}
          {success && <div className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 p-4 rounded-xl mb-6 font-medium text-sm">{success}</div>}

          {activeTab === 'omie' && (
            <form onSubmit={handleSaveOmie} className="space-y-6 max-w-xl">
              <div>
                <h3 className="text-xl font-bold text-white mb-2">Credenciais da API Omie</h3>
                <p className="text-sm text-slate-400 mb-6">Insira a chave do aplicativo criado dentro da plataforma Omie. Essas chaves são exclusivas da sua organização.</p>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-300 mb-2">APP_KEY</label>
                <div className="relative">
                  <input 
                    type={showAppKey ? "text" : "password"} 
                    value={appKey}
                    onChange={e => setAppKey(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl pl-4 pr-12 py-3 outline-none focus:border-indigo-500 transition-colors font-medium"
                    placeholder="Sua App Key"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAppKey(!showAppKey)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  >
                    {showAppKey ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-300 mb-2">APP_SECRET</label>
                <div className="relative">
                  <input 
                    type={showAppSecret ? "text" : "password"} 
                    value={appSecret}
                    onChange={e => setAppSecret(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl pl-4 pr-12 py-3 outline-none focus:border-indigo-500 transition-colors font-medium"
                    placeholder="Seu App Secret"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAppSecret(!showAppSecret)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  >
                    {showAppSecret ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>

              <button 
                type="submit" 
                disabled={loading}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-6 rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 disabled:opacity-50"
              >
                {loading ? <Loader2 className="animate-spin" size={20} /> : <SettingsIcon size={20} />}
                Salvar Configurações
              </button>
            </form>
          )}

          {activeTab === 'invites' && (
            <div className="space-y-8">
              <div>
                <h3 className="text-xl font-bold text-white mb-2">Convidar Novos Membros</h3>
                <p className="text-sm text-slate-400 mb-4">Envie um convite para o email da pessoa. Ela ingressará na sua organização e verá os mesmos relatórios sincronizados.</p>
                <form onSubmit={handleSendInvite} className="flex gap-4 max-w-xl">
                  <input 
                    type="email" 
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    required
                    className="flex-1 bg-slate-950 border border-slate-800 text-white rounded-xl px-4 py-3 outline-none focus:border-indigo-500 transition-colors font-medium"
                    placeholder="email@empresa.com"
                  />
                  <button 
                    type="submit" 
                    disabled={loading}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-6 rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 disabled:opacity-50 shrink-0"
                  >
                    {loading ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}
                    Enviar Convite
                  </button>
                </form>
              </div>

              <div>
                <h3 className="text-lg font-bold text-slate-300 mb-4">Membros Ativos ({members.length})</h3>
                <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                  {members.map(m => (
                    <div key={m.id} className="p-4 border-b border-slate-800 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${m.is_active ? 'bg-slate-800' : 'bg-red-500/20'}`}>
                          <Users size={16} className={m.is_active ? "text-slate-400" : "text-red-400"}/>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-white font-bold text-sm">{m.email}</p>
                            {!m.is_active && <span className="text-[10px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded font-bold uppercase">Inativo</span>}
                          </div>
                          <p className="text-slate-500 text-xs">Membro desde {new Date(m.joined_at).toLocaleDateString('pt-BR')}</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleToggleStatus(m.id)}
                        disabled={loading}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors disabled:opacity-50 ${m.is_active ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'}`}
                      >
                        {m.is_active ? <><UserX size={14}/> Bloquear</> : <><UserCheck size={14}/> Ativar</>}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {pendingInvites.length > 0 && (
                <div>
                  <h3 className="text-lg font-bold text-slate-300 mb-4">Convites Pendentes ({pendingInvites.length})</h3>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                    {pendingInvites.map(i => (
                      <div key={i.id} className="p-4 border-b border-slate-800 flex justify-between items-center">
                        <div>
                          <p className="text-white font-bold text-sm">{i.email}</p>
                          <p className="text-slate-500 text-xs">Enviado em {new Date(i.created_at).toLocaleDateString('pt-BR')}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold text-amber-500 bg-amber-500/10 px-2 py-1 rounded">Pendente</span>
                          <button 
                            onClick={() => handleCancelInvite(i.id)}
                            disabled={loading}
                            className="bg-red-500/10 text-red-400 hover:bg-red-500/20 p-1.5 rounded-lg transition-colors"
                            title="Cancelar Convite"
                          >
                            <X size={16}/>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
