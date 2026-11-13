import { useEffect, useState } from 'react';
import { Camera, Check, KeyRound, MessageCircle, Monitor, Moon, QrCode, Sun, UserRound } from 'lucide-react';
import { auth, whatsapp } from '../api/client';
import Avatar from '../components/Avatar';
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
        <div><h1>Configurações</h1><p>Perfil, aparência e conexões do sistema</p></div>
      </header>
      <div className="grid gap-5 md:grid-cols-2 items-start">
        <Perfil /><Aparencia /><Senha /><WhatsApp />
      </div>
    </div>
  );
}
