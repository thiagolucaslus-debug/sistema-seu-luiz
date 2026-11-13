import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { formatChatTime, formatMessageTime, matchesChat } from '../src/components/whatsappFormat.js';

const layout = await readFile(new URL('../src/components/Layout.jsx', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const client = await readFile(new URL('../src/api/client.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../src/pages/WhatsApp.jsx', import.meta.url), 'utf8');

test('formata horários de conversa e mensagem em português', () => {
  const now = new Date('2026-11-13T18:30:00-03:00');
  assert.equal(formatChatTime(1794594000, now), '15:20');
  assert.equal(formatChatTime(1794513600, now), 'Ontem');
  assert.equal(formatMessageTime(1794594000), '15:20');
});

test('busca conversas ignorando caixa e acentos', () => {
  assert.equal(matchesChat({ name: 'João da Roça', last_message: { body: 'Pagamento recebido' } }, 'joao'), true);
  assert.equal(matchesChat({ name: 'Maria', last_message: { body: 'Fechamento' } }, 'pagamento'), false);
});

test('registra o módulo completo no menu, rota e cliente da API', () => {
  assert.match(layout, /path: '\/whatsapp'.*label: 'WhatsApp Web'/);
  assert.match(app, /path="\/whatsapp"/);
  for (const method of ['listarChats', 'listarMensagens', 'enviarMensagem', 'enviarMidia', 'obterMidia']) {
    assert.match(client, new RegExp(`${method}:`));
  }
  for (const text of ['Conversas', 'Nova conversa', 'Digite uma mensagem', 'Enviar arquivo']) {
    assert.match(page, new RegExp(text));
  }
});
