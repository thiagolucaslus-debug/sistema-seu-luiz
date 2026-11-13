const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizePhone,
  serializeChat,
  serializeMessage,
  validateChatId,
  validateMediaPayload,
} = require('../chat-utils');

test('normaliza telefone brasileiro para um id do WhatsApp', () => {
  assert.equal(normalizePhone('(11) 99876-5432'), '5511998765432@c.us');
  assert.equal(normalizePhone('+55 11 99876-5432'), '5511998765432@c.us');
  assert.throws(() => normalizePhone('123'), /Telefone inválido/);
});

test('serializa conversa mesmo sem última mensagem ou foto', () => {
  assert.deepEqual(serializeChat({
    id: { _serialized: '5511999999999@c.us' },
    name: 'Maria',
    isGroup: false,
    unreadCount: 2,
    timestamp: 1700000000,
  }), {
    id: '5511999999999@c.us',
    name: 'Maria',
    is_group: false,
    unread_count: 2,
    timestamp: 1700000000,
    last_message: null,
    profile_picture: null,
  });
});

test('serializa mensagem nos dois sentidos', () => {
  assert.deepEqual(serializeMessage({
    id: { _serialized: 'msg-1' },
    body: 'Oi',
    fromMe: true,
    timestamp: 1700000100,
    type: 'chat',
    hasMedia: false,
    ack: 2,
  }), {
    id: 'msg-1', body: 'Oi', from_me: true, timestamp: 1700000100,
    type: 'chat', has_media: false, ack: 2,
  });
});

test('limita anexos a 12 MB e exige base64 válido', () => {
  assert.equal(validateMediaPayload({ data: 'SGVsbG8=', mimetype: 'text/plain', filename: 'oi.txt' }).filename, 'oi.txt');
  assert.throws(() => validateMediaPayload({ data: '', mimetype: 'text/plain' }), /Arquivo inválido/);
  assert.throws(() => validateMediaPayload({ data: 'a'.repeat(16 * 1024 * 1024 + 4), mimetype: 'x' }), /12 MB/);
});

test('aceita ids privados, grupos e o formato LID atual do WhatsApp', () => {
  for (const id of ['5511999999999@c.us', '120363000000000000@g.us', '123456789@lid']) {
    assert.equal(validateChatId(id), id);
  }
  assert.throws(() => validateChatId('status@broadcast'), /Conversa inválida/);
});
