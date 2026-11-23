import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { predictInvoiceMonth, todayLocalISO } from '../src/components/dateUtils.js';

const layoutSrc = await readFile(new URL('../src/components/Layout.jsx', import.meta.url), 'utf8');
const contasSrc = await readFile(new URL('../src/pages/Contas.jsx', import.meta.url), 'utf8');
const lancamentosSrc = await readFile(new URL('../src/pages/Lancamentos.jsx', import.meta.url), 'utf8');
const configSrc = await readFile(new URL('../src/pages/Configuracoes.jsx', import.meta.url), 'utf8');
const loginSrc = await readFile(new URL('../src/pages/Login.jsx', import.meta.url), 'utf8');
const clientSrc = await readFile(new URL('../src/api/client.js', import.meta.url), 'utf8');

test('todayLocalISO retorna YYYY-MM-DD no fuso local sem rollover UTC', () => {
  const sample = new Date(2026, 10, 22, 23, 55, 0); // 22/11/2026 23:55 local
  assert.equal(todayLocalISO(sample), '2026-11-22');
  assert.match(todayLocalISO(), /^\d{4}-\d{2}-\d{2}$/);
});

test('predictInvoiceMonth calcula corretamente fatura atual, próximo mês e virada de ano', () => {
  // Antes ou no dia do fechamento (dia <= fechamento) -> mesma fatura (igual backend)
  assert.deepEqual(predictInvoiceMonth('2026-11-04', 5), { mes: 11, ano: 2026, label: 'Nov/2026', codigo: '11/2026' });
  assert.deepEqual(predictInvoiceMonth('2026-11-05', 5), { mes: 11, ano: 2026, label: 'Nov/2026', codigo: '11/2026' });
  // Após o dia do fechamento (dia > fechamento) -> próximo mês
  assert.deepEqual(predictInvoiceMonth('2026-11-06', 5), { mes: 12, ano: 2026, label: 'Dez/2026', codigo: '12/2026' });
  assert.deepEqual(predictInvoiceMonth('2026-11-22', 1), { mes: 12, ano: 2026, label: 'Dez/2026', codigo: '12/2026' });
  // Virada de ano em dezembro
  assert.deepEqual(predictInvoiceMonth('2026-12-15', 10), { mes: 1, ano: 2027, label: 'Jan/2027', codigo: '01/2027' });
  // Input inválido -> null
  assert.equal(predictInvoiceMonth('', 5), null);
});

test('Layout expõe barra superior com botão Backup, Restaurar, status de salvamento e remove Dívidas/Aprovações', () => {
  assert.match(layoutSrc, /data-testid="app-topbar"/);
  assert.match(layoutSrc, /data-testid="topbar-backup-btn"/);
  assert.match(layoutSrc, /data-testid="topbar-restore-btn"/);
  assert.match(layoutSrc, /data-testid="save-status-indicator"/);
  assert.doesNotMatch(layoutSrc, /solicitacoes\.contarPendentes/);
  assert.doesNotMatch(layoutSrc, /\/dividas/);
  assert.doesNotMatch(layoutSrc, /\/aprovacoes/);
});

test('Contas Bancárias expõe ações diretas de Entrada, Saída, Ajustar Saldo e Extrato por conta', () => {
  assert.match(contasSrc, /Adicionar \/ Entrada/);
  assert.match(contasSrc, /Remover \/ Saída/);
  assert.match(contasSrc, /Ajustar Saldo/);
  assert.match(contasSrc, /contasApi\.movimentar/);
  assert.match(contasSrc, /contasApi\.ajustarSaldo/);
  assert.match(clientSrc, /movimentar:/);
  assert.match(clientSrc, /ajustarSaldo:/);
  assert.match(clientSrc, /backupAgora:/);
  assert.match(clientSrc, /restoreBackup:/);
});

test('Lançamentos suporta Todos os meses, filtro por conta, previsão de fatura e confirmação pós-salvo', () => {
  assert.match(lancamentosSrc, /Todos os meses/);
  assert.match(lancamentosSrc, /predictInvoiceMonth/);
  assert.match(lancamentosSrc, /lancamento-saved-banner/);
  assert.match(lancamentosSrc, /Todas as contas/);
});

test('Configurações exibe Backup Automático Local, espelho Google Drive opcional e restauração por arquivo', () => {
  assert.match(configSrc, /Backup Automático Local/);
  assert.match(configSrc, /Restaurar Backup \(\.zip\/\.json\)/);
  assert.match(configSrc, /Espelhar automaticamente também no Google Drive/);
  assert.doesNotMatch(configSrc, /aprovações/i);
  // Garante envio correto via FormData e leitura de data?.counts (nunca data?.restored)
  assert.match(configSrc, /formData\.append\('file', file\)/);
  assert.match(configSrc, /data\?\.counts/);
  assert.doesNotMatch(configSrc, /data\?\.restored/);
  // Garante link dedicado gdrive_folder_url e exibição de gdrive_last_error
  assert.match(configSrc, /status\.gdrive_folder_url/);
  assert.match(configSrc, /status\.gdrive_last_error/);
  assert.match(configSrc, /ativarComCodigo\(event, true\)/);
});

test('Layout e client.js tratam warning, pending_changes, hub_outbox_count e erros 4xx corretamente', () => {
  assert.match(layoutSrc, /saveState\.state === 'warning'/);
  assert.match(layoutSrc, /hub_outbox_count/);
  assert.match(layoutSrc, /hub_sync_enabled/);
  assert.match(layoutSrc, /info\.cloud_error/);
  assert.match(clientSrc, /input instanceof FormData/);
  assert.match(clientSrc, /status >= 400 && status < 500/);
});

test('Lançamentos inclui busca por descrição e paginação Carregar mais', () => {
  assert.match(lancamentosSrc, /Carregar mais lançamentos/);
  assert.match(lancamentosSrc, /params\.busca/);
});

test('Login trata cloud_waking sem mostrar tela de cadastro inicial falsa', () => {
  assert.match(loginSrc, /cloud_waking/);
  assert.match(loginSrc, /Acordando servidor na nuvem/);
});
