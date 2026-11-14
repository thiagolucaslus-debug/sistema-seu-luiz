import { useEffect, useState } from 'react';
import {
  Camera,
  Check,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  KeyRound,
  MessageCircle,
  Monitor,
  Moon,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Sun,
  Upload,
  UserRound,
} from 'lucide-react';
import { auth, cloud, whatsapp } from '../api/client';
import Avatar from '../components/Avatar';
import { describeCloudState, formatCloudTimestamp, isLocalBrowserHost } from '../components/cloudFormat';
import { useAppearance } from '../contexts/AppearanceContext';
import { useAuth } from '../contexts/AuthContext';

function detail(error, fallback) {
  return typeof error.response?.data?.detail === 'string' ? error.response.data.detail : fallback;
}

function Panel({ icon: Icon, title, description, children }) {
  return (
    <section className="card settings-panel">
      <header className="settings-panel__header">
        <span className="settings-icon"><Icon size={21} /></span>
        <div><h2>{title}</h2><p>{description}</p></div>
      </header>
      {children}
    </section>
  );
}

function Feedback({ message }) {
  return message && <p role={message.error ? 'alert' : 'status'} className={message.error ? 'feedback feedback--error' : 'feedback'}>{message.text}</p>;
}

function Perfil() {
  const { usuario, atualizarUsuario } = useAuth();
  const [nome, setNome] = useState(usuario.nome);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  async function salvar(action, success) {
    setBusy(true);
    setMessage(null);
    try {
      const { data } = await action();
      atualizarUsuario(data);
      setMessage({ text: success });
    } catch (error) {
      setMessage({ error: true, text: detail(error, 'Não foi possível atualizar o perfil.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel icon={UserRound} title="Meu perfil" description={usuario.usuario ? `Usuário: ${usuario.usuario}` : 'Nome e foto exibidos no painel'}>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar nome={usuario.nome} foto={usuario.logo_path} className="avatar--profile" />
        <div className="flex flex-wrap gap-2">
          <label className="btn-secondary cursor-pointer focus-within:ring-2 focus-within:ring-blue-500">
            <Camera size={17} /> Alterar foto
            <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy}
              onChange={event => {
                const file = event.target.files[0];
                event.target.value = '';
                if (!file) return;
                const form = new FormData();
                form.append('file', file);
                salvar(() => auth.uploadFoto(form), 'Foto atualizada.');
              }}
            />
          </label>
          {usuario.logo_path && (
            <button type="button" className="btn-secondary" disabled={busy}
              onClick={() => salvar(auth.removerFoto, 'Foto removida.')}>Remover foto</button>
          )}
        </div>
      </div>
      <form className="mt-5 space-y-3" onSubmit={event => {
        event.preventDefault();
        salvar(() => auth.atualizarPerfil({ nome }), 'Nome atualizado.');
      }}>
        <label className="block"><span className="label">Nome de exibição</span>
          <input className="input" value={nome} onChange={event => setNome(event.target.value)} maxLength={100} required />
        </label>
        <button className="btn-primary" disabled={busy || !nome.trim() || nome.trim() === usuario.nome}>Salvar nome</button>
      </form>
      <Feedback message={message} />
    </Panel>
  );
}

function Aparencia() {
  const { theme, setTheme, size, setSize, backgroundIntensity, setBackgroundIntensity } = useAppearance();
  return (
    <Panel icon={Monitor} title="Aparência" description="Preferências salvas neste navegador">
      <div className="label">Tema</div>
      <div className="grid grid-cols-2 gap-2">
        {[['light', 'Claro', Sun], ['dark', 'Escuro', Moon]].map(([value, label, Icon]) => (
          <button type="button" key={value} className="theme-option" aria-pressed={theme === value} onClick={() => setTheme(value)}>
            <Icon size={19} /> {label}{theme === value && <Check size={16} className="ml-auto" />}
          </button>
        ))}
      </div>
      <label className="block mt-5"><span className="label">Tamanho do texto</span>
        <select className="input" value={size} onChange={event => setSize(Number(event.target.value))}>
          <option value={90}>Menor · 90%</option>
          <option value={100}>Padrão · 100%</option>
          <option value={110}>Grande · 110%</option>
          <option value={120}>Maior · 120%</option>
          <option value={130}>Extra grande · 130%</option>
        </select>
      </label>
      <label className="block mt-5" htmlFor="intensidade-fundo">
        <span className="label flex justify-between gap-2">
          Intensidade da foto <output htmlFor="intensidade-fundo">{backgroundIntensity}%</output>
        </span>
        <input id="intensidade-fundo" className="background-slider" type="range" min="0" max="100" step="5"
          value={backgroundIntensity} onChange={event => setBackgroundIntensity(Number(event.target.value))} />
        <span className="flex justify-between text-xs text-gray-500"><span>Sem foto</span><span>Mais visível</span></span>
      </label>
    </Panel>
  );
}

function Senha() {
  const initial = { senha_atual: '', nova_senha: '', confirmar: '' };
  const [form, setForm] = useState(initial);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  async function salvar(event) {
    event.preventDefault();
    if (form.nova_senha !== form.confirmar) {
      setMessage({ error: true, text: 'As novas senhas precisam ser iguais.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const { data } = await auth.trocarSenha({ senha_atual: form.senha_atual, nova_senha: form.nova_senha });
      localStorage.setItem('token', data.access_token);
      setForm(initial);
      setMessage({ text: 'Senha atualizada. As sessões anteriores foram encerradas.' });
    } catch (error) {
      setMessage({ error: true, text: detail(error, 'Não foi possível trocar a senha.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel icon={KeyRound} title="Alterar senha" description="Confirme a senha atual para salvar uma nova">
      <form onSubmit={salvar} className="space-y-3">
        {Object.entries({ senha_atual: 'Senha atual', nova_senha: 'Nova senha', confirmar: 'Confirmar nova senha' })
          .map(([key, label]) => (
            <label className="block" key={key}><span className="label">{label}</span>
              <input className="input" type="password" autoComplete={key === 'senha_atual' ? 'current-password' : 'new-password'}
                value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })}
                minLength={key === 'senha_atual' ? undefined : 6} required />
            </label>
          ))}
        <button className="btn-primary" disabled={busy}>Atualizar senha</button>
      </form>
      <Feedback message={message} />
    </Panel>
  );
}

function NuvemGoogleDrive() {
  const { atualizarUsuario } = useAuth();
  const [status, setStatus] = useState({ checking: true });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [tokenInput, setTokenInput] = useState('');
  const [restoreFirst, setRestoreFirst] = useState(true);
  const isLocalHost = typeof window !== 'undefined' && isLocalBrowserHost(window.location.hostname);

  async function sincronizarPerfilRestaurado() {
    try {
      const { data: me } = await auth.me();
      if (me) atualizarUsuario(me);
    } catch {
      // Mantém sessão atual caso não haja alteração de perfil
    }
  }

  async function carregarStatus() {
    try {
      const { data } = await cloud.getStatus();
      setStatus(data);
      return data;
    } catch {
      setStatus({ connected: false, error_offline: true });
      return null;
    }
  }

  useEffect(() => {
    let active = true;
    let timer;
    async function loop() {
      try {
        const { data } = await cloud.getStatus();
        if (active) setStatus(data);
      } catch {
        if (active) setStatus(prev => ({ ...prev, checking: false }));
      } finally {
        if (active) timer = setTimeout(loop, 6000);
      }
    }
    loop();
    return () => { active = false; clearTimeout(timer); };
  }, []);

  async function conectarUmClique() {
    setBusy(true);
    setMessage(null);
    const popup = window.open('about:blank', '_blank');
    try {
      const { data } = await cloud.authorize();
      if (popup) popup.location.href = data.url;
      else window.open(data.url, '_blank', 'noopener');
      setMessage({ text: 'Conclua o login na janela do Google. Assim que autorizar, a conexão será ativada automaticamente.' });

      const started = Date.now();
      const poll = async () => {
        const atual = await carregarStatus();
        if (atual?.connected && atual.connection_version !== data.connection_version) {
          setMessage({ text: `Google Drive conectado (${atual.account || 'conta vinculada'})! Salvamento automático ativo.` });
          return;
        }
        if (Date.now() - started < 300000) {
          setTimeout(poll, 2200);
        }
      };
      setTimeout(poll, 2200);
    } catch (error) {
      if (popup) popup.close();
      setMessage({ error: true, text: detail(error, 'Não foi possível iniciar o login no Google Drive.') });
    } finally {
      setBusy(false);
    }
  }

  async function ativarComCodigo(event) {
    event.preventDefault();
    if (!tokenInput.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const { data } = await cloud.importToken({
        token: tokenInput.trim(),
        restore_first: restoreFirst,
        sync_immediately: true,
      });
      if (data.access_token) localStorage.setItem('token', data.access_token);
      setStatus(data);
      setTokenInput('');
      if (restoreFirst) await sincronizarPerfilRestaurado();
      setMessage({ text: `Google Drive conectado (${data.account || 'conta vinculada'})! Seus dados estão protegidos.` });
    } catch (error) {
      setMessage({ error: true, text: detail(error, 'Código inválido ou expirado.') });
    } finally {
      setBusy(false);
    }
  }

  async function importarClienteJson(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const parsed = JSON.parse(await file.text());
      const { data } = await cloud.configureClient(parsed);
      setStatus(data);
      setMessage({ text: 'Cliente OAuth Google configurado. Agora clique em Conectar Google Drive.' });
    } catch (error) {
      setMessage({ error: true, text: detail(error, 'Arquivo JSON inválido. Use o JSON de credenciais OAuth do Google.') });
    } finally {
      setBusy(false);
    }
  }

  async function salvarAgora() {
    setBusy(true);
    setMessage(null);
    try {
      const { data } = await cloud.syncNow();
      setStatus(data);
      setMessage({ text: 'Backup completo (banco + comprovantes) salvo no Google Drive!' });
    } catch (error) {
      setMessage({ error: true, text: detail(error, 'Falha ao salvar backup no Google Drive.') });
    } finally {
      setBusy(false);
    }
  }

  async function restaurarAgora() {
    if (!window.confirm('Deseja restaurar os dados e fotos salvos na pasta do Google Drive? Isso atualizará o banco atual com a cópia da nuvem.')) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const { data } = await cloud.restoreNow({ force: true });
      if (data.access_token) localStorage.setItem('token', data.access_token);
      setStatus(data);
      await sincronizarPerfilRestaurado();
      setMessage({ text: 'Dados e comprovantes restaurados do Google Drive com sucesso!' });
    } catch (error) {
      setMessage({ error: true, text: detail(error, 'Falha ao restaurar dados do Google Drive.') });
    } finally {
      setBusy(false);
    }
  }

  async function copiarCodigoNuvem() {
    setBusy(true);
    setMessage(null);
    try {
      const { data } = await cloud.exportToken();
      await navigator.clipboard.writeText(data.compact_token);
      setMessage({ text: 'Código GOOGLE_DRIVE_OAUTH_JSON copiado! Cole nas Variáveis de Ambiente do Render para persistência eterna.' });
    } catch (error) {
      setMessage({ error: true, text: detail(error, 'Não foi possível copiar o código da nuvem.') });
    } finally {
      setBusy(false);
    }
  }

  async function baixarZip() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await cloud.downloadBackupZip();
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/zip' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `backup_sistema_seu_luiz_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setMessage({ text: 'Pacote completo (.zip) baixado com sucesso.' });
    } catch (error) {
      setMessage({ error: true, text: detail(error, 'Não foi possível gerar o arquivo .zip de backup.') });
    } finally {
      setBusy(false);
    }
  }

  async function desconectarDrive() {
    if (!window.confirm('Desconectar o Google Drive deste painel? Os arquivos já salvos no seu Drive permanecerão intactos.')) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const { data } = await cloud.disconnect();
      setStatus(data);
      setMessage({ text: 'Google Drive desconectado.' });
    } catch (error) {
      setMessage({ error: true, text: detail(error, 'Não foi possível desconectar.') });
    } finally {
      setBusy(false);
    }
  }

  const badge = describeCloudState(status);

  return (
    <Panel
      icon={Cloud}
      title="Nuvem 24/7 & Google Drive"
      description="Anti-sono 24/7 gratuito e backup automático de lançamentos e fotos no seu Google Drive"
    >
      <div className="flex flex-wrap gap-2 items-center">
        <span className={badge.badgeClass}>{badge.label}</span>
        <span className="badge-green">
          <ShieldCheck size={13} className="mr-1" /> Anti-Sono 24/7 Ativo ({status.keep_alive_interval_minutes || 10} min)
        </span>
      </div>

      {status.connected ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border p-3 text-sm space-y-1" style={{ borderColor: 'var(--line)', background: 'var(--raised)' }}>
            {status.account && <p><strong>Conta Google:</strong> {status.account}</p>}
            <p><strong>Pasta privada:</strong> {status.folder_name}</p>
            <p><strong>Último salvamento:</strong> {formatCloudTimestamp(status.last_sync_at)} {status.revision ? `(rev. #${status.revision})` : ''}</p>
            <p><strong>Arquivos protegidos:</strong> Banco SQLite íntegro + {status.uploads_synced_count || 0} foto(s)/comprovante(s)</p>
            {status.folder_url && (
              <p className="pt-1">
                <a href={status.folder_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline">
                  Abrir pasta no Google Drive <ExternalLink size={14} />
                </a>
              </p>
            )}
          </div>

          {status.is_cloud_container && !status.env_var_configured && (
            <div className="rounded-xl border border-amber-300 bg-amber-50/80 text-amber-900 p-3 text-xs space-y-1">
              <p className="font-bold">Dica importante para o Render nunca esquecer a conexão:</p>
              <p>Clique em <strong>Copiar Código Render</strong> abaixo e cole na variável <code>GOOGLE_DRIVE_OAUTH_JSON</code> em <em>Environment</em> no painel do Render.</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" className="btn-primary" disabled={busy || status.syncing} onClick={salvarAgora}>
              <RefreshCw size={16} /> Salvar no Drive agora
            </button>
            <button type="button" className="btn-secondary" disabled={busy || status.restoring} onClick={restaurarAgora}>
              <Cloud size={16} /> Restaurar do Drive
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={copiarCodigoNuvem}>
              <Copy size={16} /> Copiar Código Render
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={baixarZip}>
              <Download size={16} /> Baixar Backup (.zip)
            </button>
            <button type="button" className="btn-secondary text-red-600" disabled={busy} onClick={desconectarDrive}>
              Desconectar
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Conecte seu Google Drive uma única vez: toda compra, pagamento ou comprovante será salvo automaticamente na sua conta Google e restaurado sozinho se o servidor reiniciar.
          </p>

          {(isLocalHost || status.custom_client_configured) && (
            <button type="button" className="btn-primary w-full sm:w-auto" disabled={busy} onClick={conectarUmClique}>
              <Cloud size={18} /> Conectar Google Drive em 1 Clique
            </button>
          )}

          <form onSubmit={ativarComCodigo} className="space-y-2 rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'var(--raised)' }}>
            <label className="block">
              <span className="label">Ativar com Código da Nuvem (gerado pelo CONFIGURAR_NUVEM_24H.bat)</span>
              <input
                className="input"
                placeholder="Cole aqui seu código GDRIVE1:... ou JSON"
                value={tokenInput}
                onChange={event => setTokenInput(event.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--muted)' }}>
              <input
                type="checkbox"
                checked={restoreFirst}
                onChange={event => setRestoreFirst(event.target.checked)}
              />
              Restaurar automaticamente dados já existentes no Google Drive ao ativar
            </label>
            <div className="flex flex-wrap gap-2 pt-1">
              <button className="btn-primary" disabled={busy || !tokenInput.trim()}>
                Ativar Google Drive
              </button>
              <button type="button" className="btn-secondary" disabled={busy} onClick={baixarZip}>
                <Download size={16} /> Baixar Backup Local (.zip)
              </button>
            </div>
          </form>

          <details className="text-xs" style={{ color: 'var(--muted)' }}>
            <summary className="cursor-pointer font-semibold">Opções avançadas (importar cliente OAuth JSON próprio)</summary>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="btn-secondary cursor-pointer text-xs">
                <Upload size={14} /> Importar client_secret.json
                <input className="sr-only" type="file" accept=".json,application/json" disabled={busy} onChange={importarClienteJson} />
              </label>
            </div>
          </details>
        </div>
      )}

      {status.last_error && !message && (
        <p role="alert" className="feedback feedback--error">{status.last_error}</p>
      )}
      <Feedback message={message} />
    </Panel>
  );
}

function WhatsApp() {
  const [status, setStatus] = useState({ state: 'checking' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let timer;
    async function atualizar() {
      try {
        const { data } = await whatsapp.getStatus();
        if (active) setStatus(data);
      } catch {
        if (active) setStatus({ state: 'offline' });
      } finally {
        if (active) timer = setTimeout(atualizar, 2500);
      }
    }
    atualizar();
    return () => { active = false; clearTimeout(timer); };
  }, [revision]);

  async function alterarConexao(action) {
    setBusy(true);
    setMessage(null);
    try {
      const { data } = await action();
      setStatus(data);
      setRevision(value => value + 1);
    } catch (error) {
      setMessage({ error: true, text: detail(error, 'Não foi possível alterar a conexão.') });
    } finally {
      setBusy(false);
    }
  }
  const labels = {
    idle: 'Desconectado', checking: 'Consultando serviço…', starting: 'Iniciando WhatsApp Web…',
    qr: 'Aguardando leitura do QR Code', ready: 'Conectado', disconnecting: 'Desconectando…',
    error: 'Falha na conexão', offline: 'Serviço indisponível',
  };
  const qr = status.qr;
  return (
    <Panel icon={MessageCircle} title="WhatsApp Web" description="Conecte seu aparelho para enviar fechamentos pelo painel">
      <p className={status.ready ? 'badge-green' : 'badge-blue'}>{labels[status.state]}</p>
      {status.ready && (
        <div className="mt-4 space-y-3">
          {status.account && <p className="font-semibold">{status.account}</p>}
          <p className="text-sm text-gray-500">A sessão vinculada fica salva neste computador.</p>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => {
            if (window.confirm('Desconectar este aparelho do WhatsApp?')) alterarConexao(whatsapp.disconnect);
          }}>Desconectar WhatsApp</button>
        </div>
      )}
      {qr && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-gray-600">No celular, abra <strong>Aparelhos conectados</strong>, toque em <strong>Conectar um aparelho</strong> e escaneie o código.</p>
          <svg className="qr-image" viewBox={`-4 -4 ${qr.length + 8} ${qr.length + 8}`} role="img" aria-label="QR Code de vinculação do WhatsApp" shapeRendering="crispEdges">
            <rect x="-4" y="-4" width={qr.length + 8} height={qr.length + 8} fill="white" />
            <path d={qr.flatMap((row, y) => row.map((filled, x) => filled ? `M${x},${y}h1v1h-1z` : '')).join('')} fill="black" />
          </svg>
        </div>
      )}
      {['idle', 'error'].includes(status.state) && (
        <button type="button" className="btn-primary mt-4" disabled={busy} onClick={() => alterarConexao(whatsapp.connect)}>
          <QrCode size={18} /> {status.state === 'error' ? 'Tentar novamente' : 'Conectar por QR Code'}
        </button>
      )}
      {status.state === 'offline' && <p className="mt-3 text-sm text-gray-600">Abra o sistema pelo iniciar.bat para iniciar o serviço.</p>}
      <Feedback message={message} />
    </Panel>
  );
}

export default function Configuracoes() {
  return (
    <div className="space-y-6">
      <header className="page-heading">
        <div><h1>Configurações</h1><p>Perfil, aparência, backup na nuvem 24/7 e conexões do sistema</p></div>
      </header>
      <div className="grid gap-5 md:grid-cols-2 items-start">
        <Perfil /><Aparencia /><NuvemGoogleDrive /><WhatsApp /><Senha />
      </div>
    </div>
  );
}
