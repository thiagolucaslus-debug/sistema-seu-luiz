import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { auth as authApi } from '../api/client';
import { Lock, User, ShieldCheck, Eye, EyeOff } from 'lucide-react';

export default function Login() {
  const [isSetup, setIsSetup] = useState(true);
  const [modo, setModo] = useState('login'); // 'login' | 'cadastro'
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ nome: '', usuario: '', senha: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showSenha, setShowSenha] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    authApi.checkSetup()
      .then(res => {
        const configured = Boolean(res.data?.configured);
        setIsSetup(configured);
        if (!configured) setModo('cadastro');
      })
      .catch(() => { setIsSetup(true); })
      .finally(() => { setLoading(false); });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      if (modo === 'cadastro') {
        if (!isSetup) {
          await authApi.setup({ nome: form.nome || 'Administrador', usuario: form.usuario, senha: form.senha });
        } else {
          await authApi.register({ nome: form.nome, usuario: form.usuario, senha: form.senha });
        }
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
          <span className="text-sm" role="status">Carregando Administração Financeira...</span>
        </div>
      </div>
    );
  }

  const isCadastro = modo === 'cadastro';

  return (
    <div className="login-background min-h-screen flex items-center justify-center p-4">
      <div className="card login-card w-full max-w-md p-8 sm:p-10">

        {/* Logo */}
        <div className="text-center mb-6">
          <div className="login-mark w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-3 font-black text-2xl select-none bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/25">
            AF
          </div>
          <h1 className="text-2xl font-black text-ink tracking-tight">Administração Financeira</h1>
          <p className="text-slate-400 text-xs mt-1">
            Mesmo usuário e senha em qualquer PC e no celular
          </p>
        </div>

        {/* Seletor Entrar / Criar Novo Perfil */}
        <div className="flex gap-1 p-1 rounded-xl bg-slate-900 border border-slate-800 mb-6">
          <button
            type="button"
            onClick={() => { setModo('login'); setError(''); }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
              modo === 'login' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => { setModo('cadastro'); setError(''); }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
              modo === 'cadastro' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            Criar Novo Perfil
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-rose-400 px-4 py-3 rounded-xl mb-5 text-sm font-medium flex items-center gap-2">
            <span>⚠️</span><span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Nome completo no cadastro */}
          {isCadastro && (
            <div>
              <label className="label text-ink font-semibold">Seu Nome Completo</label>
              <div className="relative">
                <User size={18} className="absolute left-3 top-3 text-gray-400" />
                <input
                  type="text"
                  className="input pl-10"
                  placeholder="Ex: Francisco Luiz"
                  value={form.nome}
                  onChange={e => setForm({ ...form, nome: e.target.value })}
                  required
                />
              </div>
            </div>
          )}

          {/* Usuário */}
          <div>
            <label className="label text-ink font-semibold">Nome de Usuário</label>
            <div className="relative">
              <User size={18} className="absolute left-3 top-3 text-gray-400" />
              <input
                type="text"
                className="input pl-10"
                placeholder={isCadastro ? 'Escolha um usuário (ex: luiz, admin)' : 'Seu usuário'}
                value={form.usuario}
                onChange={e => setForm({ ...form, usuario: e.target.value })}
                autoComplete="username"
                required
              />
            </div>
          </div>

          {/* Senha */}
          <div>
            <label className="label text-ink font-semibold">Senha</label>
            <div className="relative">
              <Lock size={18} className="absolute left-3 top-3 text-gray-400" />
              <input
                type={showSenha ? 'text' : 'password'}
                className="input pl-10 pr-10"
                placeholder="••••••••"
                value={form.senha}
                onChange={e => setForm({ ...form, senha: e.target.value })}
                autoComplete={isCadastro ? 'new-password' : 'current-password'}
                required
              />
              <button
                type="button"
                onClick={() => setShowSenha(!showSenha)}
                className="absolute right-3 top-3 text-gray-400 hover:text-gray-200"
                tabIndex={-1}
              >
                {showSenha ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full btn-primary py-3 text-base font-bold mt-2 shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2"
          >
            {submitting ? 'Aguarde...' : (isCadastro ? 'Criar Perfil e Entrar' : 'Acessar Sistema')}
          </button>
        </form>

        <div className="mt-7 pt-5 border-t border-slate-700/50 text-center">
          <p className="text-xs text-slate-400 flex items-center justify-center gap-1.5">
            <ShieldCheck size={14} className="text-emerald-400" />
            Dados armazenados com segurança local e em nuvem
          </p>
        </div>
      </div>
    </div>
  );
}
