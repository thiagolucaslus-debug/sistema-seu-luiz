import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AppearanceProvider } from './contexts/AppearanceContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Lancamentos from './pages/Lancamentos';
import Cartoes from './pages/Cartoes';
import Contas from './pages/Contas';
import Pessoas from './pages/Pessoas';
import Modulos from './pages/Modulos';
import Relatorios from './pages/Relatorios';
import Configuracoes from './pages/Configuracoes';
import WhatsApp from './pages/WhatsApp';
import FechamentoMes from './pages/FechamentoMes';
import LancarCompra from './pages/LancarCompra';

const Dashboard = lazy(() => import('./pages/Dashboard'));

function ProtectedRoute({ children }) {
  const { usuario, loading } = useAuth();

  if (loading) {
    return (
      <div className="login-background min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm" role="status">Carregando painel financeiro...</span>
        </div>
      </div>
    );
  }

  if (!usuario) {
    return <Navigate to="/login" replace />;
  }

  return <Layout>{children}</Layout>;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Rota Pública de Lançamento por Link Individual (sem login) */}
      <Route path="/lancar/:token" element={<LancarCompra />} />

      {/* Rota de Login */}
      <Route path="/login" element={<Login />} />

      {/* Rotas Protegidas do Sistema */}
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/fechamento" element={<ProtectedRoute><FechamentoMes /></ProtectedRoute>} />
      <Route path="/lancamentos" element={<ProtectedRoute><Lancamentos /></ProtectedRoute>} />
      <Route path="/cartoes" element={<ProtectedRoute><Cartoes /></ProtectedRoute>} />
      <Route path="/contas" element={<ProtectedRoute><Contas /></ProtectedRoute>} />
      <Route path="/pessoas" element={<ProtectedRoute><Pessoas /></ProtectedRoute>} />
      <Route path="/modulos" element={<ProtectedRoute><Modulos /></ProtectedRoute>} />
      <Route path="/relatorios" element={<ProtectedRoute><Relatorios /></ProtectedRoute>} />
      <Route path="/whatsapp" element={<ProtectedRoute><WhatsApp /></ProtectedRoute>} />
      <Route path="/configuracoes" element={<ProtectedRoute><Configuracoes /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AppearanceProvider>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<p className="p-8 text-sm" role="status">Carregando painel…</p>}>
            <AppRoutes />
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </AppearanceProvider>
  );
}
