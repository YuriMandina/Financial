import React, { useState, useEffect } from 'react';
import { Loader2, Key, Users, UserPlus, Send, Copy, Settings as SettingsIcon, Eye, EyeOff, X, UserX, UserCheck, Zap, Shield, Building2 } from 'lucide-react';

// Máscaras dos dados da empresa
const formatCnpjCpf = (value) => {
  const d = String(value).replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11) {
    return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return d.replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
};
const formatCep = (value) => String(value).replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');

const COMPANY_FIELDS = [
  { key: 'razao_social', label: 'Razão Social', span: 'md:col-span-6', required: true },
  { key: 'nome_fantasia', label: 'Nome Fantasia', span: 'md:col-span-3' },
  { key: 'cnpj', label: 'CNPJ / CPF', span: 'md:col-span-3', mask: formatCnpjCpf, placeholder: '00.000.000/0000-00', required: true },
  { key: 'inscricao_estadual', label: 'Inscrição Estadual', span: 'md:col-span-3' },
  { key: 'telefone', label: 'Telefone', span: 'md:col-span-3' },
  { key: 'endereco', label: 'Endereço (rua, número, bairro)', span: 'md:col-span-6' },
  { key: 'cidade', label: 'Cidade', span: 'md:col-span-3' },
  { key: 'uf', label: 'UF', span: 'md:col-span-1', mask: (v) => v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) },
  { key: 'cep', label: 'CEP', span: 'md:col-span-2', mask: formatCep, placeholder: '00000-000' },
  { key: 'email', label: 'E-mail', span: 'md:col-span-3' },
  { key: 'responsavel', label: 'Responsável / RH', span: 'md:col-span-3' }
];

// Organização: vale para todos os membros. Pessoal: só para quem está logado, neste navegador.
const SETTINGS_GROUPS = [
  {
    label: 'Organização',
    hint: 'Compartilhado com todos os membros',
    tabs: [
      { id: 'company', label: 'Dados da Empresa', icon: Building2 },
      { id: 'omie', label: 'Integração Omie', icon: Key },
      { id: 'invites', label: 'Membros e Convites', icon: Users },
      { id: 'security', label: 'Segurança', icon: Shield }
    ]
  },
  {
    label: 'Pessoal',
    hint: 'Somente você, neste navegador',
    tabs: [{ id: 'preferences', label: 'Minhas Preferências', icon: Zap }]
  }
];
const ORG_TABS = SETTINGS_GROUPS[0].tabs.map((t) => t.id);

export const Settings = ({ token, initialTab }) => {
  const [activeTab, setActiveTab] = useState(initialTab || 'omie');

  // Dados da empresa
  const [company, setCompany] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Omie Keys
  const [appKey, setAppKey] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [showAppKey, setShowAppKey] = useState(false);
  const [showAppSecret, setShowAppSecret] = useState(false);

  // Performance & Preferences
  const [performanceMode, setPerformanceMode] = useState(() => localStorage.getItem('performanceMode') === 'true');
  const [sessionTimeout, setSessionTimeout] = useState(120);

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
      } else if (activeTab === 'company') {
        const res = await fetch('http://localhost:8000/api/settings/company', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        setCompany(await res.json());
      } else if (activeTab === 'invites') {
        const res = await fetch('http://localhost:8000/api/invites/list', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        setMembers(data.members || []);
        setPendingInvites(data.pending_invites || []);
      } else if (activeTab === 'preferences' || activeTab === 'security') {
        const res = await fetch('http://localhost:8000/api/settings/preferences', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        setSessionTimeout(data.session_timeout_minutes || 120);
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

  const handleSaveCompany = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('http://localhost:8000/api/settings/company', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(company)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Erro ao salvar os dados da empresa');
      setSuccess('Dados da empresa atualizados com sucesso!');
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

  const handleTogglePerformanceMode = () => {
    const newVal = !performanceMode;
    setPerformanceMode(newVal);
    localStorage.setItem('performanceMode', String(newVal));
    if (newVal) document.body.classList.add('performance-mode');
    else document.body.classList.remove('performance-mode');
  };

  const handleSavePreferences = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('http://localhost:8000/api/settings/preferences', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ session_timeout_minutes: Number(sessionTimeout) })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Erro ao salvar preferências');
      setSuccess('Preferências atualizadas com sucesso!');
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
          <h2 className="text-3xl font-bold text-white mb-1">Configurações</h2>
          <p className="text-slate-400">Dados e integrações da organização, compartilhados com toda a equipe, e suas preferências pessoais</p>
        </div>
      </div>

      <div className="bg-slate-900/80 border border-white/[0.05] rounded-2xl overflow-hidden flex flex-col md:flex-row">
        <div className="md:w-64 bg-slate-950/50 p-6 flex flex-col gap-2 border-r border-white/[0.05]">
          {SETTINGS_GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col gap-2 mb-4 last:mb-0">
              <div className="px-1">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{group.label}</div>
                <div className="text-[11px] text-slate-600">{group.hint}</div>
              </div>
              {group.tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-colors ${activeTab === tab.id ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
                >
                  <tab.icon size={18} /> {tab.label}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="flex-1 p-8">
          {error && <div className="bg-red-500/10 text-red-400 border border-red-500/20 p-4 rounded-xl mb-6 font-medium text-sm">{error}</div>}
          {success && <div className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 p-4 rounded-xl mb-6 font-medium text-sm">{success}</div>}
          {ORG_TABS.includes(activeTab) ? (
            <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 mb-6">
              <Users size={14} className="text-indigo-400 shrink-0" />
              Configuração da organização: as alterações valem para todos os membros.
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 mb-6">
              <Zap size={14} className="text-amber-400 shrink-0" />
              Preferência pessoal: vale apenas para você, neste navegador.
            </div>
          )}

          {activeTab === 'company' && (
            <form onSubmit={handleSaveCompany} className="space-y-6 max-w-2xl">
              <div>
                <h3 className="text-xl font-bold text-white mb-2">Dados da Empresa</h3>
                <p className="text-sm text-slate-400">
                  Identificação do empregador usada nos documentos do sistema, como o cabeçalho da folha de ponto e a ficha cadastral.
                  O nome fantasia (ou a razão social) também passa a ser o nome da organização.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                {COMPANY_FIELDS.map((f) => (
                  <div key={f.key} className={f.span}>
                    <label className="block text-sm font-bold text-slate-300 mb-2">
                      {f.label}{f.required && <span className="text-rose-400"> *</span>}
                    </label>
                    <input
                      type="text"
                      required={f.required}
                      placeholder={f.placeholder}
                      value={company[f.key] || ''}
                      onChange={(e) => setCompany({ ...company, [f.key]: f.mask ? f.mask(e.target.value) : e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                  </div>
                ))}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
              >
                {loading && <Loader2 size={18} className="animate-spin" />}
                Salvar Dados da Empresa
              </button>
            </form>
          )}

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

          {activeTab === 'preferences' && (
            <div className="space-y-8">
              <div>
                <h3 className="text-xl font-bold text-white mb-2">Interface e Desempenho</h3>
                <p className="text-sm text-slate-400 mb-6">Ajuste como o sistema é renderizado no seu navegador.</p>
                
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex items-center justify-between hover:bg-slate-900/50 transition-colors">
                  <div>
                    <h4 className="text-white font-bold">Modo de Desempenho</h4>
                    <p className="text-sm text-slate-400 mt-1">Desativa animações e transições graduais (ideal para PCs mais lentos)</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={performanceMode} onChange={handleTogglePerformanceMode} />
                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-8">
              <div>
                <h3 className="text-xl font-bold text-white mb-2">Segurança</h3>
                <p className="text-sm text-slate-400 mb-6">Configurações de sessão aplicáveis a todos os membros da organização.</p>
                
                <form onSubmit={handleSavePreferences} className="space-y-6">
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between hover:bg-slate-900/50 transition-colors gap-4">
                    <div>
                      <h4 className="text-white font-bold">Tempo de Sessão (Logout Automático)</h4>
                      <p className="text-sm text-slate-400 mt-1">Tempo limite antes que a sessão expire por inatividade (requer novo login).</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <select
                        value={sessionTimeout}
                        onChange={e => setSessionTimeout(e.target.value)}
                        className="bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 outline-none focus:border-indigo-500 font-medium"
                      >
                        <option value={15}>15 Minutos (Mais Seguro)</option>
                        <option value={60}>1 Hora</option>
                        <option value={240}>4 Horas</option>
                        <option value={720}>12 Horas</option>
                        <option value={1440}>24 Horas</option>
                        <option value={10080}>7 Dias (Menos Seguro)</option>
                      </select>
                    </div>
                  </div>
                  <button 
                    type="submit" 
                    disabled={loading}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-6 rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="animate-spin" size={20} /> : <Shield size={20} />}
                    Salvar Configurações de Segurança
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
