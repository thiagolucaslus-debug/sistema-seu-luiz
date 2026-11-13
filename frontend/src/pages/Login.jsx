import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { auth as authApi } from '../api/client';
import { Lock, User, ShieldCheck, Eye, EyeOff } from 'lucide-react';

export default function Login() {
  const [isSetup, setIsSetup] = useState(true);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ nome: 'Seu Luiz', usuario: '', senha: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showSenha, setShowSenha] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    authApi.checkSetup()
      .then(res => { setIsSetup(res.data.configured); })
      .catch(() => { setIsSetup(false); })
      .finally(() => { setLoading(false); });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      if (!isSetup) {
        // Primeiro acesso — cria o usuário
        await authApi.setup({ nome: form.nome, usuario: form.usuario, senha: form.senha });
        await login(form.usuario, form.senha);
      } else {
        await login(form.usuario, form.senha);
      }
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.detail || 'Usuário ou senha incorretos.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="login-background min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm" role="status">Carregando Sistema Financeiro...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="login-background min-h-screen flex items-center justify-center p-4">
      <div className="card login-card w-full max-w-md p-8 sm:p-10">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="login-mark w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 font-bold text-2xl select-none">
            SL
          </div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Seu Luiz</h1>
          <p className="text-gray-500 text-sm mt-1">
            {isSetup ? 'Faça login para acessar o painel' : 'Primeiro acesso — crie seu usuário e senha'}
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-5 text-sm font-medium flex items-center gap-2">
            <span>⚠️</span><span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Nome só no primeiro acesso */}
          {!isSetup && (
            <div>
              <label className="label">Seu Nome</label>
              <div className="relative">
                <User size={18} className="absolute left-3 top-3 text-gray-400" />
                <input
                  type="text"
                  className="input pl-10"
                  placeholder="Ex: Seu Luiz"
                  value={form.nome}
                  onChange={e => setForm({ ...form, nome: e.target.value })}
                  required
                />
              </div>
            </div>
          )}

          {/* Usuário */}
          <div>
            <label className="label">Usuário</label>
            <div className="relative">
              <User size={18} className="absolute left-3 top-3 text-gray-400" />
              <input
                type="text"
                className="input pl-10"
                placeholder={isSetup ? 'Seu usuário' : 'Escolha um nome de usuário'}
                value={form.usuario}
                onChange={e => setForm({ ...form, usuario: e.target.value })}
                autoComplete="username"
                required
              />
            </div>
          </div>

          {/* Senha */}
          <div>
            <label className="label">Senha</label>
            <div className="relative">
              <Lock size={18} className="absolute left-3 top-3 text-gray-400" />
              <input
                type={showSenha ? 'text' : 'password'}
                className="input pl-10 pr-10"
                placeholder="••••••••"
                value={form.senha}
                onChange={e => setForm({ ...form, senha: e.target.value })}
                autoComplete={isSetup ? 'current-password' : 'new-password'}
                required
              />
              <button
                type="button"
                onClick={() => setShowSenha(!showSenha)}
                className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
                tabIndex={-1}
              >
                {showSenha ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full btn-primary py-3 text-base font-semibold mt-1 shadow-lg shadow-blue-500/25"
          >
            {submitting ? 'Aguarde...' : (isSetup ? 'Acessar Sistema' : 'Criar Conta e Entrar')}
          </button>
        </form>

        <div className="mt-7 pt-5 border-t border-gray-100 text-center">
          <p className="text-xs text-gray-400 flex items-center justify-center gap-1.5">
            <ShieldCheck size={14} className="text-emerald-500" />
            Dados armazenados de forma 100% local e segura
          </p>
        </div>
      </div>
    </div>
  );
}
