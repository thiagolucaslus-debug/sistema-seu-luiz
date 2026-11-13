function dateFromTimestamp(timestamp) {
  const value = Number(timestamp || 0);
  return value > 0 ? new Date(value * 1000) : null;
}

export function formatMessageTime(timestamp) {
  const date = dateFromTimestamp(timestamp);
  return date ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
}

export function formatChatTime(timestamp, now = new Date()) {
  const date = dateFromTimestamp(timestamp);
  if (!date) return '';
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startMessage = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startToday - startMessage) / 86400000);
  if (days === 0) return formatMessageTime(timestamp);
  if (days === 1) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: date.getFullYear() === now.getFullYear() ? undefined : '2-digit' });
}

export function matchesChat(chat, query) {
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const term = normalize(query).trim();
  if (!term) return true;
  return normalize(chat?.name).includes(term) || normalize(chat?.last_message?.body).includes(term);
}

export function mediaDataUrl(media) {
  return media?.data && media?.mimetype ? `data:${media.mimetype};base64,${media.data}` : null;
}
