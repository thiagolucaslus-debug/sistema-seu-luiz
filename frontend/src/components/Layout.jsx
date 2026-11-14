import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAppearance } from '../contexts/AppearanceContext';
import { solicitacoes } from '../api/client';
import Avatar from './Avatar';
import ModalAcessoCelular from './ModalAcessoCelular';
import {
  LayoutDashboard, CreditCard, Building2, Users, Grid3X3,
  ListPlus, BarChart3, Menu, X, LogOut, ChevronRight, Settings,
  Sun, Moon, MessageCircle, CalendarCheck, CheckSquare, Smartphone
} from 'lucide-react';

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendentesCount, setPendentesCount] = useState(0);
  const [modalCelular, setModalCelular] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { usuario, logout } = useAuth();
  const { theme, setTheme } = useAppearance();
  const nome = usuario?.nome || 'Administração Financeira';
  const foto = usuario?.logo_path;
  const themeLabel = theme === 'dark' ? 'Escuro' : 'Claro';
  const themeActionLabel = theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro';

  useEffect(() => {
    let ativo = true;
    const checar = async () => {
      try {
        const res = await solicitacoes.contarPendentes();
        const totalPend = res.data?.pendentes ?? res.data?.count;
        if (ativo && totalPend !== undefined) {
          setPendentesCount(totalPend);
        }
      } catch (e) {
        // Silencioso se rota pública ou sem token
      }
    };
    checar();
    const interval = setInterval(checar, 12000);
    return () => {
      ativo = false;
      clearInterval(interval);
    };
  }, [location.pathname]);

  const navItems = [
    { path: '/', label: 'Visão Geral', icon: LayoutDashboard },
    { path: '/fechamento', label: 'Fechamento do Mês', icon: CalendarCheck, destaque: true },
    { path: '/aprovacoes', label: 'Aprovações', icon: CheckSquare, badge: pendentesCount },
    { path: '/lancamentos', label: 'Lançamentos', icon: ListPlus },
    { path: '/cartoes', label: 'Cartões de Crédito', icon: CreditCard },
    { path: '/contas', label: 'Contas Bancárias', icon: Building2 },
    { path: '/pessoas', label: 'Pessoas & Fechamentos', icon: Users },
    { path: '/modulos', label: 'Módulos', icon: Grid3X3 },
    { path: '/relatorios', label: 'Relatórios', icon: BarChart3 },
    { path: '/whatsapp', label: 'WhatsApp Web', icon: MessageCircle },
    { path: '/configuracoes', label: 'Configurações', icon: Settings },
  ];

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  return (
    <div className="app-shell flex h-screen overflow-hidden">
      {/* Overlay Mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 lg:hidden transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-40
        app-sidebar w-64
        transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        flex flex-col
      `}>
        {/* Cabeçalho do menu */}
        <div className="app-brand flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 min-w-0" onClick={() => setSidebarOpen(false)}>
            <Avatar nome={nome} foto={foto} className="avatar--brand" />
            <div className="min-w-0">
              <p className="text-white font-bold text-lg leading-tight truncate">{nome}</p>
              <p className="app-brand__subtitle">Administração Financeira</p>
            </div>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden sidebar-action p-1 text-slate-400 hover:text-white"
            aria-label="Fechar menu"
          >
            <X size={20} />
          </button>
        </div>

        {/* Botão de Atalho para Acesso no Celular */}
        <div className="px-3 pt-3 pb-1">
          <button
            type="button"
            onClick={() => setModalCelular(true)}
            className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs shadow-md shadow-blue-500/20 transition-all group"
          >
            <div className="flex items-center gap-2.5">
              <Smartphone size={17} className="text-blue-200 group-hover:scale-110 transition-transform" />
              <span>Acesso no Celular</span>
            </div>
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-white/20 font-black tracking-wider">QR</span>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1.5 overflow-y-auto" aria-label="Menu principal">
          {navItems.map(({ path, label, icon: Icon, badge, destaque }) => {
            const active = location.pathname === path;
            return (
              <Link
                key={path}
                to={path}
                onClick={() => setSidebarOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={`
                  flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl
                  transition-all duration-200 group font-medium text-sm relative
                  ${active
                    ? 'nav-active'
                    : destaque
                      ? 'text-blue-400 hover:bg-blue-950/30'
                      : 'nav-link'
                  }
                `}
              >
                <Icon size={19} className="shrink-0" />
                <span className="flex-1 truncate">{label}</span>
                {badge > 0 && (
                  <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-amber-500 text-slate-950 shadow-sm animate-pulse">
                    {badge}
                  </span>
                )}
                {active && <ChevronRight size={16} className="shrink-0 opacity-70" />}
              </Link>
            );
          })}
        </nav>

        {/* Rodapé da Sidebar: Perfil, Tema e Logout compactos */}
        <div className="p-3 border-t border-slate-800/80 space-y-2">
          {/* Linha com Perfil e Alternador de Tema compacto */}
          <div className="flex items-center justify-between gap-2">
            <Link
              to="/configuracoes"
              className="sidebar-profile flex-1 flex items-center gap-2.5 min-w-0 p-1.5 rounded-lg hover:bg-slate-800/50 transition-colors"
              onClick={() => setSidebarOpen(false)}
            >
              <Avatar nome={nome} foto={foto} className="w-8 h-8 rounded-full shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-semibold truncate leading-tight">{nome}</p>
                <p className="text-[11px] text-slate-400 truncate">Configurações</p>
              </div>
            </Link>

            {/* Botão de Tema Compacto e Elegante no rodapé */}
            <button
              type="button"
              className="theme-toggle flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white transition-all text-xs font-medium border border-slate-700/50"
              onClick={toggleTheme}
              aria-label={themeActionLabel}
              title={themeActionLabel}
            >
              {theme === 'dark' ? <Moon size={14} className="text-blue-400" /> : <Sun size={14} className="text-amber-400" />}
              <span className="hidden sm:inline">{themeLabel}</span>
            </button>
          </div>

          {/* Botão Encerrar Sessão */}
          <button
            onClick={handleLogout}
            className="sidebar-action w-full flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg text-xs font-medium text-slate-400 hover:text-red-400 hover:bg-red-950/20 transition-colors"
          >
            <LogOut size={14} />
            <span>Encerrar Sessão</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden pb-16 lg:pb-0">
        {/* Top bar on Mobile */}
        <header className="mobile-header lg:hidden px-4 py-2.5 flex items-center justify-between border-b border-slate-800 bg-slate-900/90 backdrop-blur">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 rounded-lg text-slate-300 hover:bg-slate-800"
              aria-label="Abrir menu"
            >
              <Menu size={22} />
            </button>
            <Link to="/" className="flex items-center gap-2 min-w-0">
              <Avatar nome={nome} foto={foto} className="w-8 h-8 rounded-full" />
              <span className="font-bold text-white text-base truncate">{nome}</span>
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setModalCelular(true)}
              className="p-1.5 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center gap-1 text-xs font-bold"
              title="Acesso Celular e Links"
            >
              <Smartphone size={16} />
              <span className="text-[11px]">Links</span>
            </button>

            {pendentesCount > 0 && (
              <Link to="/aprovacoes" className="px-2 py-0.5 text-xs font-bold rounded-full bg-amber-500 text-slate-950">
                {pendentesCount}
              </Link>
            )}
            <button
              type="button"
              className="theme-toggle p-2 rounded-lg bg-slate-800 text-slate-300"
              onClick={toggleTheme}
              aria-label={themeActionLabel}
              title={themeActionLabel}
            >
              {theme === 'dark' ? <Moon size={17} className="text-blue-400" /> : <Sun size={17} className="text-amber-400" />}
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="app-main flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-[88rem] mx-auto">
            {children}
          </div>
        </main>

        {/* Modal de Acesso Celular */}
        <ModalAcessoCelular isOpen={modalCelular} onClose={() => setModalCelular(false)} />

        {/* Barra de Navegação Inferior para Celular (Mobile BottomNav) */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-slate-900/95 backdrop-blur border-t border-slate-800 z-30 flex items-center justify-around py-2 px-1">
          <Link
            to="/"
            className={`flex flex-col items-center gap-0.5 text-[11px] ${location.pathname === '/' ? 'text-blue-400 font-bold' : 'text-slate-400'}`}
          >
            <LayoutDashboard size={19} />
            <span>Início</span>
          </Link>
          <Link
            to="/fechamento"
            className={`flex flex-col items-center gap-0.5 text-[11px] ${location.pathname === '/fechamento' ? 'text-blue-400 font-bold' : 'text-slate-400'}`}
          >
            <CalendarCheck size={19} />
            <span>Fechamento</span>
          </Link>
          <Link
            to="/lancamentos"
            className={`flex flex-col items-center gap-0.5 text-[11px] ${location.pathname === '/lancamentos' ? 'text-blue-400 font-bold' : 'text-slate-400'}`}
          >
            <ListPlus size={19} />
            <span>Lançar</span>
          </Link>
          <Link
            to="/cartoes"
            className={`flex flex-col items-center gap-0.5 text-[11px] ${location.pathname === '/cartoes' ? 'text-blue-400 font-bold' : 'text-slate-400'}`}
          >
            <CreditCard size={19} />
            <span>Cartões</span>
          </Link>
          <Link
            to="/pessoas"
            className={`flex flex-col items-center gap-0.5 text-[11px] ${location.pathname === '/pessoas' ? 'text-blue-400 font-bold' : 'text-slate-400'}`}
          >
            <Users size={19} />
            <span>Pessoas</span>
          </Link>
        </nav>
      </div>
    </div>
  );
}
