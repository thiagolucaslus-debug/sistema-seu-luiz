const MAX_MEDIA_BYTES = 12 * 1024 * 1024;

function serializedId(value) {
  return value?.id?._serialized || value?.id?.$1 || value?._serialized || value?.$1 || null;
}

function normalizePhone(value) {
  let number = String(value || '').replace(/\D/g, '');
  if (!number.startsWith('55')) number = `55${number}`;
  if (number.length < 12 || number.length > 13) throw new Error('Telefone inválido. Informe DDD e número.');
  return `${number}@c.us`;
}

function validateChatId(value) {
  const id = String(value || '');
  if (!/^[-_:\d]+@(c\.us|g\.us|lid)$/.test(id)) throw new Error('Conversa inválida.');
  return id;
}

function messagePreview(message) {
  if (!message) return null;
  const body = String(message.body || '').trim();
  if (body) return body;
  const labels = { image: 'Imagem', video: 'Vídeo', audio: 'Áudio', ptt: 'Áudio', document: 'Documento', sticker: 'Figurinha' };
  return message.hasMedia ? `[${labels[message.type] || 'Mídia'}]` : '';
}

function serializeChat(chat) {
  const id = serializedId(chat);
  const last = chat.lastMessage ? {
    body: messagePreview(chat.lastMessage),
    from_me: Boolean(chat.lastMessage.fromMe),
    timestamp: Number(chat.lastMessage.timestamp || 0),
    type: chat.lastMessage.type || 'chat',
  } : null;
  return {
    id,
    name: chat.name || chat.contactName || id?.split('@')[0] || 'Conversa',
    is_group: Boolean(chat.isGroup),
    unread_count: Number(chat.unreadCount || 0),
    timestamp: Number(chat.timestamp || chat.lastMessage?.timestamp || 0),
    last_message: last,
    profile_picture: chat.profilePicture || null,
  };
}

function serializeMessage(message) {
  return {
    id: serializedId(message),
    body: String(message.body || ''),
    from_me: Boolean(message.fromMe),
    timestamp: Number(message.timestamp || 0),
    type: message.type || 'chat',
    has_media: Boolean(message.hasMedia),
    ack: Number(message.ack ?? 0),
  };
}

function validateMediaPayload(payload) {
  const data = String(payload?.data || '');
  const mimetype = String(payload?.mimetype || '');
  if (!data || !mimetype || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('Arquivo inválido.');
  const bytes = Math.floor(data.length * 3 / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
  if (bytes > MAX_MEDIA_BYTES) throw new Error('O arquivo deve ter no máximo 12 MB.');
  return {
    data,
    mimetype,
    filename: String(payload.filename || 'arquivo'),
    caption: String(payload.caption || '').trim(),
  };
}

module.exports = { normalizePhone, validateChatId, serializeChat, serializeMessage, validateMediaPayload, messagePreview };
