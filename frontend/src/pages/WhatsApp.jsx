import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, CheckCheck, Download, File, Image as ImageIcon, LoaderCircle,
  MessageCircle, Paperclip, Plus, RefreshCw, Search, Send, Users, X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { whatsapp } from '../api/client';
import { formatChatTime, formatMessageTime, matchesChat, mediaDataUrl } from '../components/whatsappFormat';

function errorDetail(error, fallback) {
  return typeof error.response?.data?.detail === 'string' ? error.response.data.detail : fallback;
}

function Initials({ chat, size = 'normal' }) {
  const initials = String(chat?.name || '?').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  return (
    <span className={`wa-avatar ${size === 'large' ? 'wa-avatar--large' : ''}`}>
      {chat?.profile_picture
        ? <img src={chat.profile_picture} alt="" referrerPolicy="no-referrer" />
        : chat?.is_group ? <Users size={19} /> : initials}
    </span>
  );
}

function MediaContent({ message, media, onLoad, busy }) {
  if (!message.has_media) return null;
  if (!media) {
    return (
      <button type="button" className="wa-media-button" onClick={() => onLoad(message)} disabled={busy}>
        {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}
        Abrir mídia
      </button>
    );
  }
  const src = mediaDataUrl(media);
  if (media.mimetype.startsWith('image/')) return <img className="wa-message-image" src={src} alt="Mídia da conversa" />;
  if (media.mimetype.startsWith('audio/')) return <audio className="wa-message-audio" src={src} controls />;
  if (media.mimetype.startsWith('video/')) return <video className="wa-message-video" src={src} controls />;
  return <a className="wa-media-button" href={src} download={media.filename || 'arquivo'}><File size={16} /> Baixar {media.filename || 'arquivo'}</a>;
}

export default function WhatsApp() {
  const [status, setStatus] = useState({ state: 'checking', ready: false });
  const [chats, setChats] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [query, setQuery] = useState('');
  const [text, setText] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newConversation, setNewConversation] = useState(false);
  const [attachment, setAttachment] = useState(null);
  const [media, setMedia] = useState({});
  const [mediaBusy, setMediaBusy] = useState(null);
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);
  const fileRef = useRef(null);
  const lastMessageId = useRef(null);

  const selectedChat = chats.find(chat => chat.id === selectedId) || null;
  const filteredChats = useMemo(() => chats.filter(chat => matchesChat(chat, query)), [chats, query]);

  const loadStatus = useCallback(async () => {
    try {
      const { data } = await whatsapp.getStatus();
      setStatus(data);
    } catch {
      setStatus({ state: 'offline', ready: false });
    }
  }, []);

  const loadChats = useCallback(async (quiet = false) => {
    if (!status.ready) return;
    if (!quiet) setLoadingChats(true);
    try {
      const { data } = await whatsapp.listarChats(80);
      const items = Array.isArray(data.chats) ? data.chats : [];
      setChats(items);
      setSelectedId(current => current && items.some(chat => chat.id === current) ? current : items[0]?.id || null);
      setError('');
    } catch (requestError) {
      if (!quiet) setError(errorDetail(requestError, 'Não foi possível carregar as conversas.'));
    } finally {
      if (!quiet) setLoadingChats(false);
    }
  }, [status.ready]);

  const loadMessages = useCallback(async (quiet = false) => {
    if (!selectedId || newConversation || !status.ready) return;
    if (!quiet) setLoadingMessages(true);
    try {
      const { data } = await whatsapp.listarMensagens(selectedId, 80);
      const items = Array.isArray(data.messages) ? data.messages : [];
      const nextLastId = items.at(-1)?.id || null;
      setMessages(items);
      if (nextLastId && nextLastId !== lastMessageId.current) {
        lastMessageId.current = nextLastId;
        requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: quiet ? 'smooth' : 'auto' }));
      }
      setError('');
    } catch (requestError) {
      if (!quiet) setError(errorDetail(requestError, 'Não foi possível carregar as mensagens.'));
    } finally {
      if (!quiet) setLoadingMessages(false);
    }
  }, [newConversation, selectedId, status.ready]);

  useEffect(() => {
    loadStatus();
    const timer = setInterval(loadStatus, 5000);
    return () => clearInterval(timer);
  }, [loadStatus]);

  useEffect(() => {
    if (!status.ready) return undefined;
    loadChats();
    const timer = setInterval(() => loadChats(true), 7000);
    return () => clearInterval(timer);
  }, [loadChats, status.ready]);

  useEffect(() => {
    if (!selectedId || newConversation) {
      setMessages([]);
      return undefined;
    }
    lastMessageId.current = null;
    loadMessages();
    const timer = setInterval(() => loadMessages(true), 3500);
    return () => clearInterval(timer);
  }, [loadMessages, newConversation, selectedId]);

  function selectChat(id) {
    setSelectedId(id);
    setNewConversation(false);
    setAttachment(null);
    setText('');
  }

  function startConversation() {
    setSelectedId(null);
    setNewConversation(true);
    setMessages([]);
    setAttachment(null);
    setText('');
    setError('');
  }

  async function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) {
      setError('O arquivo deve ter no máximo 12 MB.');
      return;
    }
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setAttachment({ data, mimetype: file.type || 'application/octet-stream', filename: file.name });
  }

  async function sendMessage(event) {
    event.preventDefault();
    const target = selectedId ? { chat_id: selectedId } : { telefone: newPhone.trim() };
    if (!target.chat_id && !target.telefone) return setError('Informe o telefone com DDD.');
    if (!text.trim() && !attachment) return;
    setSending(true);
    setError('');
    try {
      const response = attachment
        ? await whatsapp.enviarMidia({ ...target, ...attachment, caption: text.trim() || undefined })
        : await whatsapp.enviarMensagem({ ...target, mensagem: text.trim() });
      setText('');
      setAttachment(null);
      if (response.data.chat_id) {
        setSelectedId(response.data.chat_id);
        setNewConversation(false);
      }
      await loadChats(true);
      setTimeout(() => loadMessages(true), 350);
    } catch (requestError) {
      setError(errorDetail(requestError, 'Não foi possível enviar. Confira o número e tente novamente.'));
    } finally {
      setSending(false);
    }
  }

  async function loadMedia(message) {
    setMediaBusy(message.id);
    try {
      const { data } = await whatsapp.obterMidia(message.id);
      setMedia(current => ({ ...current, [message.id]: data }));
    } catch (requestError) {
      setError(errorDetail(requestError, 'Esta mídia não está mais disponível.'));
    } finally {
      setMediaBusy(null);
    }
  }

  if (!status.ready) {
    const labels = {
      checking: 'Consultando conexão…', starting: 'Iniciando WhatsApp Web…', qr: 'Aguardando leitura do QR Code',
      idle: 'WhatsApp desconectado', offline: 'Serviço do WhatsApp indisponível', error: 'Falha na conexão',
    };
    return (
      <div className="space-y-6">
        <header className="page-heading"><div><h1>WhatsApp Web</h1><p>Conversas e mensagens dentro do painel</p></div></header>
        <section className="card wa-empty-state">
          <span className="wa-empty-state__icon"><MessageCircle size={34} /></span>
          <h2>{labels[status.state] || 'Conecte seu aparelho'}</h2>
          <p>Abra as configurações para vincular o WhatsApp por QR Code. Depois, suas conversas aparecerão aqui.</p>
          <Link className="btn-primary" to="/configuracoes">Abrir configurações</Link>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="page-heading wa-page-heading">
        <div><h1>WhatsApp Web</h1><p>Conversas, mensagens e arquivos dentro do painel</p></div>
        <span className="badge-green">Conectado{status.account ? ` · ${status.account}` : ''}</span>
      </header>

      <section className={`wa-workspace card ${selectedId || newConversation ? 'wa-workspace--chat-open' : ''}`}>
        <aside className="wa-chat-sidebar">
          <header className="wa-chat-sidebar__header">
            <div><strong>Conversas</strong><span>{chats.length} carregadas</span></div>
            <button type="button" className="wa-icon-button" onClick={startConversation} title="Nova conversa" aria-label="Nova conversa"><Plus size={20} /></button>
          </header>
          <label className="wa-search"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar conversa" /></label>
          <div className="wa-chat-list">
            {loadingChats && !chats.length && <div className="wa-loading"><LoaderCircle className="animate-spin" /> Carregando conversas…</div>}
            {!loadingChats && !filteredChats.length && <div className="wa-list-empty">Nenhuma conversa encontrada.</div>}
            {filteredChats.map(chat => (
              <button key={chat.id} type="button" onClick={() => selectChat(chat.id)} className={`wa-chat-item ${selectedId === chat.id ? 'wa-chat-item--active' : ''}`}>
                <Initials chat={chat} />
                <span className="wa-chat-item__body">
                  <span className="wa-chat-item__top"><strong>{chat.name}</strong><time>{formatChatTime(chat.timestamp || chat.last_message?.timestamp)}</time></span>
                  <span className="wa-chat-item__preview">{chat.last_message?.from_me && <CheckCheck size={14} />}{chat.last_message?.body || 'Sem mensagens recentes'}</span>
                </span>
                {chat.unread_count > 0 && <span className="wa-unread">{chat.unread_count > 99 ? '99+' : chat.unread_count}</span>}
              </button>
            ))}
          </div>
        </aside>

        <div className="wa-chat-panel">
          {(selectedChat || newConversation) ? (
            <>
              <header className="wa-conversation-header">
                <button type="button" className="wa-icon-button wa-back" aria-label="Voltar para conversas" onClick={() => { setSelectedId(null); setNewConversation(false); }}><ArrowLeft size={20} /></button>
                {selectedChat ? <Initials chat={selectedChat} /> : <span className="wa-avatar"><Plus size={18} /></span>}
                <div>
                  <strong>{newConversation ? 'Nova conversa' : selectedChat.name}</strong>
                  <span>{newConversation ? 'Informe um número para começar' : selectedChat.is_group ? 'Grupo' : 'WhatsApp'}</span>
                </div>
                {!newConversation && <button type="button" className="wa-icon-button ml-auto" title="Atualizar" onClick={() => { loadChats(); loadMessages(); }}><RefreshCw size={18} /></button>}
              </header>

              {newConversation && (
                <div className="wa-new-contact">
                  <label><span>Telefone com DDD</span><input className="input" value={newPhone} onChange={event => setNewPhone(event.target.value)} placeholder="Ex. 11 99999-9999" /></label>
                </div>
              )}

              <div className="wa-messages">
                {loadingMessages && <div className="wa-loading"><LoaderCircle className="animate-spin" /> Carregando mensagens…</div>}
                {!loadingMessages && !newConversation && !messages.length && <div className="wa-list-empty wa-list-empty--center">Nenhuma mensagem nesta conversa.</div>}
                {newConversation && <div className="wa-list-empty wa-list-empty--center">Digite a primeira mensagem para iniciar a conversa.</div>}
                {messages.map(message => (
                  <div key={message.id} className={`wa-message-row ${message.from_me ? 'wa-message-row--mine' : ''}`}>
                    <article className="wa-message-bubble">
                      <MediaContent message={message} media={media[message.id]} onLoad={loadMedia} busy={mediaBusy === message.id} />
                      {message.body && <p>{message.body}</p>}
                      <footer><time>{formatMessageTime(message.timestamp)}</time>{message.from_me && <CheckCheck size={14} className={message.ack >= 3 ? 'wa-read' : ''} />}</footer>
                    </article>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              {error && <div className="wa-error"><span>{error}</span><button type="button" onClick={() => setError('')}><X size={16} /></button></div>}
              {attachment && <div className="wa-attachment"><ImageIcon size={18} /><span>{attachment.filename}</span><button type="button" onClick={() => setAttachment(null)} aria-label="Remover arquivo"><X size={16} /></button></div>}
              <form className="wa-composer" onSubmit={sendMessage}>
                <input ref={fileRef} type="file" className="sr-only" onChange={chooseFile} />
                <button type="button" className="wa-icon-button" onClick={() => fileRef.current?.click()} title="Enviar arquivo" aria-label="Enviar arquivo"><Paperclip size={20} /></button>
                <textarea value={text} onChange={event => setText(event.target.value)} onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
                }} placeholder="Digite uma mensagem" rows={1} />
                <button type="submit" className="wa-send" disabled={sending || (!text.trim() && !attachment)} aria-label="Enviar mensagem">
                  {sending ? <LoaderCircle size={20} className="animate-spin" /> : <Send size={20} />}
                </button>
              </form>
            </>
          ) : (
            <div className="wa-chat-placeholder">
              <span><MessageCircle size={36} /></span>
              <h2>WhatsApp Web</h2>
              <p>Selecione uma conversa ou inicie uma nova para enviar mensagens e arquivos.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
