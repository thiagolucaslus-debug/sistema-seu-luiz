import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAppearance } from '../contexts/AppearanceContext';
import { cloud } from '../api/client';
import Avatar from './Avatar';
import ModalAcessoCelular from './ModalAcessoCelular';
import { formatCloudTimestamp } from './cloudFormat';
import { todayLocalISO } from './dateUtils';
import {
  LayoutDashboard, CreditCard, Building2, Users, Grid3X3,
  ListPlus, BarChart3, Menu, X, LogOut, ChevronRight, Settings,
  Sun, Moon, MessageCircle, CalendarCheck, Smartphone,
  Download, Upload, CheckCircle2, Cloud, Loader2, AlertTriangle
} from 'lucide-react';

function extractFilenameFromDisposition(disposition, fallback) {
  if (!disposition) return fallback;
  const match = /filename\*?=(?:UTF-8''|")?([^";\n]+)/i.exec(disposition);
  if (match && match[1]) {
    return match[1].replace(/^"|"$/g, '').trim();
  }
  return fallback;
}

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modalCelular, setModalCelular] = useState(false);
  const [cloudStatus, setCloudStatus] = useState(null);
  const [saveState, setSaveState] = useState({ state: 'idle', at: null, message: '' });
  const [backingUp, setBackingUp] = useState(false);
  const [restoringFile, setRestoringFile] = useState(false);
  const [toast, setToast] = useState(null);
  const restoreInputRef = useRef(null);
  const toastTimerRef = useRef(null);

  const location = useLocation();
  const navigate = useNavigate();
  const { usuario, logout } = useAuth();
  const { theme, setTheme } = useAppearance();
  const nome = usuario?.nome || 'Administração Financeira';
  const foto = usuario?.logo_path;
  const themeLabel = theme === 'dark' ? 'Escuro' : 'Claro';
  const themeActionLabel = theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro';

  const showToast = (text, tone = 'success', duration = 6000) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ text, tone });
    toastTimerRef.current = setTimeout(() => setToast(null), duration);
  };

  useEffect(() => {
    let active = true;
    const fetchStatus = async () => {
      try {
        const { data } = await cloud.getStatus();
        if (active) {
          setCloudStatus(data);
          if (!data?.last_error && !data?.pending_changes && !(data?.hub_outbox_count > 0)) {
            setSaveState(prev => (prev.state === 'error' ? { state: 'idle', at: Date.now(), message: '' } : prev));
          }
        }
      } catch {
        // Silencioso em caso de rede offline momentânea
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 20000);

    const onSaveEvent = (ev) => {
      const detail = ev?.detail || {};
      setSaveState({
        state: detail.state || 'saved',
        at: detail.at || Date.now(),
        syncStatus: detail.syncStatus || '',
        rev: detail.rev || 0,
        message: detail.message || '',
      });
      if (detail.state === 'saved' || detail.state === 'warning') {
        fetchStatus();
      }
    };
    window.addEventListener('app:save-state', onSaveEvent);

    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener('app:save-state', onSaveEvent);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const navItems = [
    { path: '/', label: 'Visão Geral', icon: LayoutDashboard },
    { path: '/fechamento', label: 'Fechamento do Mês', icon: CalendarCheck, destaque: true },
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

  const handleBackupClick = async () => {
    if (backingUp) return;
    setBackingUp(true);
    setSaveState(prev => ({ ...prev, state: 'saving' }));
    try {
      // 1. Garante salvamento imediato no arquivo local + nuvem (Cofre / Google Drive)
      const saveRes = await cloud.backupAgora();
      const info = saveRes.data || {};
      if (info.status) setCloudStatus(info.status);

      // 2. Baixa imediatamente o pacote completo (.zip com financeiro.db + backup_dados.json + uploads)
      const zipRes = await cloud.downloadBackupZip();
      const fallbackName = `backup_${(usuario?.usuario || 'perfil').replace(/[^a-z0-9_-]+/gi, '_')}_${todayLocalISO()}.zip`;
      const filename = extractFilenameFromDisposition(zipRes.headers?.['content-disposition'], fallbackName);

      const url = window.URL.createObjectURL(new Blob([zipRes.data], { type: 'application/zip' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      const c = info.counts || {};
      const resumo = `${c.lancamentos ?? 0} lançamentos, ${c.cartoes ?? 0} cartões, ${c.contas_bancarias ?? 0} contas, ${c.pessoas ?? 0} pessoas`;
      if (info.cloud_error) {
        setSaveState({ state: 'warning', at: Date.now(), syncStatus: 'error', message: info.cloud_error });
        showToast(
          `Backup salvo local e baixado (${filename}), mas a nuvem avisou: ${info.cloud_error}`,
          'warning',
          8000
        );
      } else {
        setSaveState({ state: 'saved', at: Date.now(), syncStatus: info.cloud_synced ? 'synced' : 'local_only' });
        showToast(
          info.cloud_synced
            ? `Backup salvo na nuvem e baixado (${filename}) — ${resumo}.`
            : `Backup salvo no sistema e baixado (${filename}) — ${resumo}.`,
          'success',
          7000
        );
      }
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || 'Erro ao gerar backup.';
      setSaveState({ state: 'error', at: Date.now(), message: msg });
      showToast(`Não foi possível concluir o backup: ${msg}`, 'error', 7000);
    } finally {
      setBackingUp(false);
    }
  };

  const handleRestoreFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!window.confirm(`Deseja restaurar o backup "${file.name}" no perfil atual (${nome})? Uma cópia de segurança dos dados atuais será salva antes.`)) {
      return;
    }
    setRestoringFile(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await cloud.restoreBackup(formData);
      if (data?.status) setCloudStatus(data.status);
      showToast(data?.mensagem || 'Backup restaurado com sucesso!', 'success', 5000);
      setTimeout(() => {
        window.location.reload();
      }, 900);
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || 'Arquivo de backup inválido.';
      showToast(`Erro ao restaurar backup: ${msg}`, 'error', 7000);
    } finally {
      setRestoringFile(false);
    }
  };

  // Cálculo do indicador visual de salvamento automático
  const renderSaveIndicator = (compact = false) => {
    const outboxCount = Number(cloudStatus?.hub_outbox_count || 0);
    const isSaving = saveState.state === 'saving' || backingUp || restoringFile || Boolean(cloudStatus?.syncing);
    const isPending = Boolean(cloudStatus?.connected && cloudStatus?.pending_changes) || outboxCount > 0;
    const hasError =
      saveState.state === 'error'
      || saveState.state === 'warning'
      || Boolean(cloudStatus?.last_error)
      || Boolean(cloudStatus?.gdrive_last_error);
    const isCloudSynced = Boolean(
      (
        (cloudStatus?.connected && !cloudStatus?.pending_changes)
        || (cloudStatus?.hub_sync_enabled && cloudStatus?.hub_online && outboxCount === 0)
      )
      && !hasError
    );
    const lastTs = cloudStatus?.last_sync_at || cloudStatus?.local_backup_at;
    const tooltip = hasError
      ? `Aviso de salvamento: ${saveState.message || cloudStatus?.last_error || cloudStatus?.gdrive_last_error || 'Verifique a conexão'}`
      : isPending
        ? (outboxCount > 0
          ? `${outboxCount} alteração(ões) salvas no PC aguardando conexão com a nuvem.`
          : 'Alterações salvas localmente; sincronizando com a nuvem...')
        : isCloudSynced
          ? `Salvamento automático ativo (Nuvem + Backup Local). Último backup: ${formatCloudTimestamp(lastTs)}${cloudStatus?.revision ? ` • rev. #${cloudStatus.revision}` : ''}`
          : `Dados salvos automaticamente no banco e arquivo local. Último backup: ${formatCloudTimestamp(lastTs)}`;

    if (isSaving) {
      return (
        <span
          data-testid="save-status-indicator"
          title="Salvando alterações automaticamente..."
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-500/15 text-blue-500 border border-blue-500/30 whitespace-nowrap"
        >
          <Loader2 size={13} className="animate-spin shrink-0" />
          <span>{compact ? 'Salvando…' : 'Salvando automaticamente…'}</span>
        </span>
      );
    }

    if (hasError) {
      return (
        <Link
          to="/configuracoes"
          data-testid="save-status-indicator"
          title={tooltip}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/15 text-amber-500 border border-amber-500/30 whitespace-nowrap hover:bg-amber-500/25 transition-colors"
        >
          <AlertTriangle size={13} className="shrink-0" />
          <span>{compact ? 'Atenção' : 'Salvo local • Verificar nuvem'}</span>
        </Link>
      );
    }

    if (isPending) {
      return (
        <Link
          to="/configuracoes"
          data-testid="save-status-indicator"
          title={tooltip}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-500/15 text-blue-500 border border-blue-500/30 whitespace-nowrap hover:bg-blue-500/25 transition-colors"
        >
          <Cloud size={13} className="shrink-0" />
          <span>{compact ? 'Sincronizando' : (outboxCount > 0 ? `Salvo local • ${outboxCount} pendente(s)` : 'Sincronizando nuvem…')}</span>
        </Link>
      );
    }

    return (
      <Link
        to="/configuracoes"
        data-testid="save-status-indicator"
        title={tooltip}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 whitespace-nowrap hover:bg-emerald-500/25 transition-colors"
      >
        {isCloudSynced ? <Cloud size={13} className="shrink-0" /> : <CheckCircle2 size={13} className="shrink-0" />}
        <span>{compact ? 'Salvo' : (isCloudSynced ? '✓ Salvo (Nuvem + Local)' : '✓ Salvo automaticamente')}</span>
      </Link>
    );
  };

  return (
    <div className="app-shell flex h-screen overflow-hidden">
      {/* Input oculto para restauração de arquivo de backup (.zip ou .json) */}
      <input
        ref={restoreInputRef}
        type="file"
        accept=".zip,.json,application/zip,application/json"
        className="hidden"
        onChange={handleRestoreFileChange}
      />

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
            <img
              src="/logo-oficial.png"
              alt="Administração Financeira"
              className="w-12 h-12 object-contain shrink-0 select-none drop-shadow"
              draggable={false}
            />
            <div className="min-w-0">
              <p className="text-white font-bold text-base leading-tight truncate">{nome}</p>
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
          {navItems.map(({ path, label, icon: Icon, destaque }) => {
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
                {active && <ChevronRight size={16} className="shrink-0 opacity-70" />}
              </Link>
            );
          })}
        </nav>

        {/* Rodapé da Sidebar: Perfil, Tema e Logout compactos */}
        <div className="p-3 border-t border-slate-800/80 space-y-2">
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
        <header className="mobile-header lg:hidden px-3 py-2 flex items-center justify-between gap-2 border-b border-[var(--line)] print-hidden">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--raised)]"
              aria-label="Abrir menu"
            >
              <Menu size={21} />
            </button>
            <Link to="/" className="flex items-center gap-1.5 min-w-0">
              <img
                src="/logo-oficial.png"
                alt="Administração Financeira"
                className="w-8 h-8 object-contain shrink-0 select-none"
                draggable={false}
              />
              <span className="font-bold text-[var(--ink)] text-sm truncate max-w-[110px]">{nome}</span>
            </Link>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {renderSaveIndicator(true)}

            <button
              type="button"
              onClick={handleBackupClick}
              disabled={backingUp}
              data-testid="topbar-backup-btn-mobile"
              className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 shadow-sm disabled:opacity-60"
              title="Salvar na nuvem e baixar arquivo completo de backup"
            >
              {backingUp ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              <span>Backup</span>
            </button>

            <button
              type="button"
              className="theme-toggle p-1.5 rounded-lg"
              onClick={toggleTheme}
              aria-label={themeActionLabel}
              title={themeActionLabel}
            >
              {theme === 'dark' ? <Moon size={16} className="text-blue-400" /> : <Sun size={16} className="text-amber-400" />}
            </button>
          </div>
        </header>

        {/* Top bar on Desktop (Sempre visível: Status de Salvamento + Botão Backup + Restaurar) */}
        <header
          data-testid="app-topbar"
          className="hidden lg:flex items-center justify-between gap-4 px-8 py-2.5 border-b border-[var(--line)] bg-[var(--surface)]/90 backdrop-blur print-hidden shrink-0"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xs font-semibold text-[var(--muted)] truncate">
              Perfil ativo: <strong className="text-[var(--ink)]">{nome}</strong>
            </span>
            {renderSaveIndicator(false)}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => restoreInputRef.current?.click()}
              disabled={restoringFile || backingUp}
              data-testid="topbar-restore-btn"
              className="btn-secondary text-xs py-1.5 px-3"
              title="Restaurar arquivo de backup (.zip ou .json) neste perfil"
            >
              {restoringFile ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              <span>{restoringFile ? 'Restaurando…' : 'Restaurar'}</span>
            </button>

            <button
              type="button"
              onClick={handleBackupClick}
              disabled={backingUp || restoringFile}
              data-testid="topbar-backup-btn"
              className="btn-success text-xs py-1.5 px-3.5 font-bold shadow-sm"
              title="Salva automaticamente na nuvem + disco e baixa arquivo completo de backup (.zip)"
            >
              {backingUp ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              <span>{backingUp ? 'Salvando Backup…' : 'Backup'}</span>
            </button>
          </div>
        </header>

        {/* Notificação de confirmação de Backup / Restauração */}
        {toast && (
          <div
            data-testid="backup-toast"
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={`px-4 sm:px-8 py-2.5 text-xs font-semibold flex items-center justify-between gap-3 border-b print-hidden ${
              toast.tone === 'error'
                ? 'bg-rose-500/15 text-rose-500 border-rose-500/30'
                : toast.tone === 'warning'
                  ? 'bg-amber-500/15 text-amber-500 border-amber-500/30'
                  : 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {(toast.tone === 'error' || toast.tone === 'warning') ? <AlertTriangle size={15} className="shrink-0" /> : <CheckCircle2 size={15} className="shrink-0" />}
              <span className="truncate">{toast.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="p-1 rounded hover:bg-black/10 shrink-0"
              aria-label="Fechar aviso"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Page Content */}
        <main className="app-main flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-[88rem] mx-auto">
            {children}
          </div>
        </main>

        {/* Modal de Acesso Celular */}
        <ModalAcessoCelular isOpen={modalCelular} onClose={() => setModalCelular(false)} />

        {/* Barra de Navegação Inferior para Celular (Mobile BottomNav) */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-slate-900/95 backdrop-blur border-t border-slate-800 z-30 flex items-center justify-around py-2 px-1 print-hidden">
          <Link
            to="/"
            className={`flex flex-col items-center gap-0.5 text-[10px] ${location.pathname === '/' ? 'text-blue-400 font-bold' : 'text-slate-400'}`}
          >
            <LayoutDashboard size={18} />
            <span>Início</span>
          </Link>
          <Link
            to="/fechamento"
            className={`flex flex-col items-center gap-0.5 text-[10px] ${location.pathname === '/fechamento' ? 'text-blue-400 font-bold' : 'text-slate-400'}`}
          >
            <CalendarCheck size={18} />
            <span>Fechamento</span>
          </Link>
          <Link
            to="/lancamentos"
            className={`flex flex-col items-center gap-0.5 text-[10px] ${location.pathname === '/lancamentos' ? 'text-blue-400 font-bold' : 'text-slate-400'}`}
          >
            <ListPlus size={18} />
            <span>Lançar</span>
          </Link>
          <Link
            to="/cartoes"
            className={`flex flex-col items-center gap-0.5 text-[10px] ${location.pathname === '/cartoes' ? 'text-blue-400 font-bold' : 'text-slate-400'}`}
          >
            <CreditCard size={18} />
            <span>Cartões</span>
          </Link>
          <Link
            to="/contas"
            className={`flex flex-col items-center gap-0.5 text-[10px] ${location.pathname === '/contas' ? 'text-blue-400 font-bold' : 'text-slate-400'}`}
          >
            <Building2 size={18} />
            <span>Contas</span>
          </Link>
          <Link
            to="/pessoas"
            className={`flex flex-col items-center gap-0.5 text-[10px] ${location.pathname === '/pessoas' ? 'text-blue-400 font-bold' : 'text-slate-400'}`}
          >
            <Users size={18} />
            <span>Pessoas</span>
          </Link>
        </nav>
      </div>
    </div>
  );
}
