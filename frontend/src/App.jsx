import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TaskSyncProvider } from './context/TaskSyncContext';
import { AuthScreen } from './views/Auth/Auth';
import { VerifyEmail } from './views/Auth/VerifyEmail';
import AppLayout from './components/layout/AppLayout';

// --- [BLOCO: Roteador de Autenticação e Telas Públicas] ---
function RootNavigation() {
  const { setToken, isAuthenticated } = useAuth();
  const path = window.location.pathname;

  if (path === '/verify-email') {
    return <VerifyEmail onVerified={setToken} />;
  }

  if (!isAuthenticated) {
    return <AuthScreen onLogin={setToken} />;
  }

  return (
    <TaskSyncProvider>
      <AppLayout />
    </TaskSyncProvider>
  );
}

// --- [BLOCO: Ponto de Entrada da Aplicação] ---
export default function App() {
  return (
    <AuthProvider>
      <RootNavigation />
    </AuthProvider>
  );
}
