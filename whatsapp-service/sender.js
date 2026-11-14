// Sistema Financeiro "Seu Luiz" — Serviço WhatsApp
// Envia PDFs e mensagens de fechamento pelo WhatsApp

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode-terminal/vendor/QRCode');
const qrLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { normalizePhone, validateChatId, serializeChat, serializeMessage, validateMediaPayload } = require('./chat-utils');

const app = express();
app.use((req, res, next) => {
  if (req.headers.origin || req.headers['sec-fetch-site']) {
    return res.status(403).json({ error: 'Use o painel para acessar o serviço.' });
  }
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '18mb' }));

const dataRoot = process.env.SEU_LUIZ_DATA_DIR ? path.resolve(process.env.SEU_LUIZ_DATA_DIR) : null;
const legacyAuthDir = path.join(__dirname, '.wwebjs_auth');
const authDir = fs.existsSync(path.join(legacyAuthDir, 'session'))
  ? legacyAuthDir
  : (dataRoot ? path.join(dataRoot, '.wwebjs_auth') : legacyAuthDir);
const primaryPdfDir = dataRoot ? path.join(dataRoot, 'pdfs') : path.resolve(__dirname, '..', 'backend', 'pdfs');
const fallbackPdfDir = path.resolve(__dirname, '..', 'backend', 'pdfs');
const allowedPdfDirs = new Set([primaryPdfDir.toLowerCase(), fallbackPdfDir.toLowerCase()]);
let client = null;
let state = 'idle';
let qrMatrix = null;
let account = null;

console.log('╔═══════════════════════════════════════════════╗');
console.log('║   SEU LUIZ FINANCEIRO — SERVIÇO WHATSAPP      ║');
console.log('╚═══════════════════════════════════════════════╝');

const chromePath = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : (fs.existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
      ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
      : undefined);

function status() {
  return { state, ready: state === 'ready', qr: qrMatrix, account };
}

async function closeClient(current, nextState) {
  if (client !== current || state === 'disconnecting') return;
  state = 'disconnecting';
  qrMatrix = null;
  account = null;
  try {
    await current.destroy();
  } catch (error) {
    console.error('Erro ao fechar o WhatsApp:', error.message);
  } finally {
    client = null;
    state = nextState;
  }
}

function connect() {
  if (client) return;
  state = 'starting';
  const current = new Client({
    authStrategy: new LocalAuth({ dataPath: authDir }),
    puppeteer: { headless: true, executablePath: chromePath },
    authTimeoutMs: 60000,
  });
  client = current;
  current.on('qr', (value) => {
    if (client !== current || state === 'disconnecting') return;
    try {
      const qr = new QRCode(-1, qrLevel.L);
      qr.addData(value);
      qr.make();
      qrMatrix = qr.modules;
      state = 'qr';
    } catch (error) {
      console.error('Erro ao gerar o QR Code:', error.message);
      void closeClient(current, 'error');
    }
  });
  current.on('authenticated', () => {
    if (client !== current || state === 'disconnecting' || state === 'ready') return;
    qrMatrix = null;
    state = 'starting';
  });
  current.on('ready', () => {
    if (client !== current || state === 'disconnecting') return;
    qrMatrix = null;
    account = current.info?.pushname || null;
    state = 'ready';
  });
  current.on('disconnected', () => void closeClient(current, 'idle'));
  current.on('auth_failure', () => void closeClient(current, 'error'));
  current.initialize().catch((error) => {
    console.error('Erro ao iniciar WhatsApp Web:', error.message);
    void closeClient(current, 'error');
  });
}

if (fs.existsSync(path.join(authDir, 'session'))) connect();

app.get('/status', (req, res) => res.json(status()));
app.post('/connect', (req, res) => {
  connect();
  res.json(status());
});

function readyClient(res) {
  if (state !== 'ready' || !client) {
    res.status(503).json({ error: 'Conecte seu WhatsApp em Configurações.' });
    return null;
  }
  return client;
}

async function resolveChatId(current, body) {
  if (body.chat_id) return validateChatId(body.chat_id);
  const candidate = normalizePhone(body.telefone);
  const registered = await current.getNumberId(candidate.split('@')[0]);
  if (!registered) throw new Error('Este número não está cadastrado no WhatsApp.');
  return registered._serialized || registered.$1 || candidate;
}

app.get('/chats', async (req, res) => {
  const current = readyClient(res);
  if (!current) return;
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 60));
    const chats = (await current.getChats())
      .filter(chat => {
        const id = chat.id?._serialized || chat.id?.$1 || '';
        return id && !id.endsWith('@broadcast');
      })
      .sort((a, b) => Number(b.timestamp || b.lastMessage?.timestamp || 0) - Number(a.timestamp || a.lastMessage?.timestamp || 0))
      .slice(0, limit);

    const items = await Promise.all(chats.map(async chat => {
      let contactName = null;
      let profilePicture = null;
      try {
        const contact = await chat.getContact();
        contactName = contact.pushname || contact.name || contact.number || null;
        profilePicture = await contact.getProfilePicUrl() || null;
      } catch {}
      return serializeChat({
        id: chat.id,
        name: chat.name,
        contactName,
        isGroup: chat.isGroup,
        unreadCount: chat.unreadCount,
        timestamp: chat.timestamp,
        lastMessage: chat.lastMessage,
        profilePicture,
      });
    }));
    res.json({ chats: items });
  } catch (error) {
    console.error('Erro ao listar conversas:', error.message);
    res.status(500).json({ error: 'Não foi possível carregar as conversas.' });
  }
});

app.get('/chats/:chatId/messages', async (req, res) => {
  const current = readyClient(res);
  if (!current) return;
  try {
    const chat = await current.getChatById(validateChatId(req.params.chatId));
    const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 60));
    const messages = (await chat.fetchMessages({ limit }))
      .map(serializeMessage)
      .sort((a, b) => a.timestamp - b.timestamp);
    res.json({ chat_id: req.params.chatId, messages });
  } catch (error) {
    console.error('Erro ao carregar mensagens:', error.message);
    res.status(404).json({ error: 'Não foi possível carregar esta conversa.' });
  }
});

app.get('/messages/:messageId/media', async (req, res) => {
  const current = readyClient(res);
  if (!current) return;
  try {
    const message = await current.getMessageById(req.params.messageId);
    if (!message?.hasMedia) return res.status(404).json({ error: 'Mídia não encontrada.' });
    const media = await message.downloadMedia();
    if (!media?.data) return res.status(404).json({ error: 'Mídia indisponível.' });
    res.json({ mimetype: media.mimetype, data: media.data, filename: media.filename || 'arquivo' });
  } catch (error) {
    console.error('Erro ao baixar mídia:', error.message);
    res.status(404).json({ error: 'Mídia indisponível.' });
  }
});

app.post('/messages', async (req, res) => {
  const current = readyClient(res);
  if (!current) return;
  try {
    const body = String(req.body.mensagem || '').trim();
    if (!body) return res.status(400).json({ error: 'Digite uma mensagem.' });
    const chatId = await resolveChatId(current, req.body);
    const message = await current.sendMessage(chatId, body);
    res.json({ success: true, chat_id: chatId, message: serializeMessage(message) });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Não foi possível enviar a mensagem.' });
  }
});

app.post('/messages/media', async (req, res) => {
  const current = readyClient(res);
  if (!current) return;
  try {
    const chatId = await resolveChatId(current, req.body);
    const mediaPayload = validateMediaPayload(req.body);
    const media = new MessageMedia(mediaPayload.mimetype, mediaPayload.data, mediaPayload.filename);
    const message = await current.sendMessage(chatId, media, { caption: mediaPayload.caption || undefined });
    res.json({ success: true, chat_id: chatId, message: serializeMessage(message) });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Não foi possível enviar o arquivo.' });
  }
});

// Enviar PDF
app.post('/send-pdf', async (req, res) => {
  if (state !== 'ready') {
    return res.status(503).json({ error: 'Conecte seu WhatsApp em Configurações.' });
  }

  const { telefone, pdf_path, mensagem, nome_pessoa, mes_ano } = req.body;

  if (!telefone || !pdf_path) {
    return res.status(400).json({ error: 'Parâmetros "telefone" e "pdf_path" são obrigatórios.' });
  }

  try {
    let numero = String(telefone).replace(/\D/g, '');
    if (!numero.startsWith('55')) {
      numero = '55' + numero;
    }
    const chatId = `${numero}@c.us`;

    const resolved = path.resolve(pdf_path);
    if (!allowedPdfDirs.has(path.dirname(resolved).toLowerCase()) ||
        path.extname(resolved).toLowerCase() !== '.pdf' || !fs.existsSync(resolved)) {
      return res.status(404).json({ error: 'Relatório PDF não encontrado.' });
    }

    const media = MessageMedia.fromFilePath(resolved);

    const textoMensagem = mensagem ||
      `Olá, *${nome_pessoa || 'amigo(a)'}*!\n\n` +
      `Segue anexo o seu *Fechamento Financeiro* referente a *${mes_ano || 'este mês'}*.\n\n` +
      `Qualquer dúvida nos lançamentos, estou à disposição! 👍\n` +
      `_Sistema Financeiro Seu Luiz_`;

    const current = client;
    await current.sendMessage(chatId, textoMensagem);
    await new Promise(r => setTimeout(r, 1200));
    await current.sendMessage(chatId, media, { caption: `📄 Fechamento - ${mes_ano || 'Resumo'}` });

    console.log(`✅ PDF enviado para ${numero} (${nome_pessoa || ''})`);
    res.json({ success: true, message: `PDF enviado com sucesso para ${numero}.` });
  } catch (error) {
    console.error('Erro ao enviar PDF:', error);
    res.status(500).json({ error: error.message });
  }
});

// Desconectar
app.post('/disconnect', async (req, res) => {
  if (state !== 'ready') return res.status(409).json({ error: 'Não há uma sessão conectada.' });
  const current = client;
  state = 'disconnecting';
  try {
    await current.logout();
    client = null;
    qrMatrix = null;
    account = null;
    state = 'idle';
    res.json(status());
  } catch (err) {
    state = 'ready';
    await closeClient(current, 'error');
    res.status(502).json({ error: 'Falha ao desconectar. Verifique o aparelho no seu celular.' });
  }
});

const PORT = 3001;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`📡 API do WhatsApp escutando em http://localhost:${PORT}`);
});
