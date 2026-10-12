import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

// --- [BLOCO: Definição do Contexto e Hook] ---
const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser utilizado dentro de um AuthProvider');
  }
  return context;
};

// --- [BLOCO: AuthProvider e Gerenciamento de Sessão] ---
export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(() => localStorage.getItem('token') || '');
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [loadingUser, setLoadingUser] = useState(false);

  const handleLogout = useCallback(() => {
    setToken('');
    setUserName('');
    setUserEmail('');
    localStorage.removeItem('token');
    window.location.href = '/';
  }, []);

  const fetchWithAuth = useCallback(async (url, options = {}) => {
    const currentToken = localStorage.getItem('token') || token;
    const defaultHeaders = {
      'Authorization': `Bearer ${currentToken}`,
      'Content-Type': 'application/json',
    };

    const mergedOptions = {
      ...options,
      headers: {
        ...defaultHeaders,
        ...(options.headers || {}),
      },
    };

    // Remove Content-Type se for FormData ou se método for GET sem body
    if (options.body instanceof FormData || (!options.body && (!options.method || options.method === 'GET'))) {
      delete mergedOptions.headers['Content-Type'];
    }

    try {
      const res = await fetch(url, mergedOptions);
      if (res.status === 401) {
        setToken('');
        localStorage.removeItem('token');
        throw new Error('Sessão expirada. Faça login novamente.');
      }
      return res;
    } catch (err) {
      throw err;
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      setLoadingUser(true);
      fetchWithAuth('http://localhost:8000/api/auth/me')
        .then((res) => {
          if (!res.ok) throw new Error('Falha ao autenticar usuário');
          return res.json();
        })
        .then((data) => {
          if (data.name) {
            setUserName(data.name);
          } else if (data.email) {
            setUserName(data.email.split('@')[0]);
          }
          if (data.email) {
            setUserEmail(data.email);
          }
        })
        .catch((err) => {
          console.error('[AuthContext] Erro ao carregar dados do usuário:', err);
        })
        .finally(() => {
          setLoadingUser(false);
        });
    } else {
      setUserName('');
      setUserEmail('');
    }
  }, [token, fetchWithAuth]);

  const value = {
    token,
    setToken,
    userName,
    setUserName,
    userEmail,
    loadingUser,
    fetchWithAuth,
    handleLogout,
    isAuthenticated: Boolean(token),
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
