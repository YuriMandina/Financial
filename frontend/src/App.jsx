import React from 'react';
import { createBrowserRouter, RouterProvider, Routes, Route } from 'react-router';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TaskSyncProvider } from './context/TaskSyncContext';
import { AuthScreen } from './views/Auth/Auth';
import { VerifyEmail } from './views/Auth/VerifyEmail';
import AppLayout from './components/layout/AppLayout';

// --- [BLOCO: Área Autenticada] ---
// Sem token, mostra o login mantendo a URL — após entrar, o usuário cai onde estava.
function ProtectedApp() {
  const { setToken, isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <AuthScreen onLogin={setToken} />;
  }

  return (
    <TaskSyncProvider>
      <AppLayout />
    </TaskSyncProvider>
  );
}

// --- [BLOCO: Roteador de Autenticação e Telas Públicas] ---
function RootNavigation() {
  const { setToken } = useAuth();

  return (
    <Routes>
      <Route path="/verify-email" element={<VerifyEmail onVerified={setToken} />} />
      <Route path="/*" element={<ProtectedApp />} />
    </Routes>
  );
}

function Root() {
  return (
    <AuthProvider>
      <RootNavigation />
    </AuthProvider>
  );
}

// Data router (necessário para useBlocker); as rotas reais ficam nos <Routes> descendentes.
const router = createBrowserRouter([{ path: '*', element: <Root /> }]);

// --- [BLOCO: Ponto de Entrada da Aplicação] ---
export default function App() {
  return <RouterProvider router={router} />;
}
