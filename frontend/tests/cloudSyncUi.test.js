import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { describeCloudState, formatCloudTimestamp, isLocalBrowserHost } from '../src/components/cloudFormat.js';

const clientSrc = await readFile(new URL('../src/api/client.js', import.meta.url), 'utf8');
const settingsSrc = await readFile(new URL('../src/pages/Configuracoes.jsx', import.meta.url), 'utf8');

test('identifica corretamente hosts locais para OAuth em 1 clique', () => {
  assert.equal(isLocalBrowserHost('localhost'), true);
  assert.equal(isLocalBrowserHost('127.0.0.1'), true);
  assert.equal(isLocalBrowserHost('sistema-seu-luiz.onrender.com'), false);
  assert.equal(isLocalBrowserHost(''), false);
});

test('formata datas de sincronização e estados da nuvem em português', () => {
  assert.equal(formatCloudTimestamp(null), 'Ainda não sincronizado');
  assert.equal(formatCloudTimestamp(0), 'Ainda não sincronizado');
  assert.match(formatCloudTimestamp(1794672000), /\d{2}\/\d{2}\/2026/);

  assert.deepEqual(describeCloudState({ checking: true }), {
    badgeClass: 'badge-blue',
    label: 'Verificando nuvem…',
  });
  assert.deepEqual(describeCloudState({ connected: true }), {
    badgeClass: 'badge-green',
    label: 'Google Drive Conectado',
  });
  assert.deepEqual(describeCloudState({ connected: false }), {
    badgeClass: 'badge-yellow',
    label: 'Google Drive Desconectado',
  });
});

test('expõe API completa de Google Drive e painel Nuvem 24/7 nas Configurações', () => {
  for (const method of [
    'getStatus',
    'authorize',
    'configureClient',
    'importToken',
    'exportToken',
    'syncNow',
    'restoreNow',
    'disconnect',
    'downloadBackupZip',
  ]) {
    assert.match(clientSrc, new RegExp(`${method}:`));
  }

  for (const label of [
    'Nuvem 24/7 & Google Drive',
    'Anti-Sono 24/7 Ativo',
    'Salvar no Drive agora',
    'Restaurar do Drive',
    'Copiar Código Render',
    'Baixar Backup',
  ]) {
    assert.match(settingsSrc, new RegExp(label));
  }
});
