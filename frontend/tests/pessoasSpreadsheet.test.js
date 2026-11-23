import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildMonthTabs,
  decodeOriginPatch,
  defaultDateForMonth,
  encodeOriginValue,
  formatEditableBrl,
  monthKey,
  normalizePaymentFormaCode,
  parseBrlNumber,
  parseMonthKey,
  shiftMonth,
} from '../src/components/pessoasSpreadsheet.js';

const pessoasSrc = await readFile(new URL('../src/pages/Pessoas.jsx', import.meta.url), 'utf8');
const clientSrc = await readFile(new URL('../src/api/client.js', import.meta.url), 'utf8');

test('parseBrlNumber interpreta formatos BR e US e rejeita valores inválidos', () => {
  assert.equal(parseBrlNumber('150,50'), 150.5);
  assert.equal(parseBrlNumber('1.250,90'), 1250.9);
  assert.equal(parseBrlNumber('R$ 89,9'), 89.9);
  assert.equal(parseBrlNumber('200.55'), 200.55);
  assert.equal(parseBrlNumber(42.126), 42.13);

  assert.equal(parseBrlNumber(''), null);
  assert.equal(parseBrlNumber('0'), null);
  assert.equal(parseBrlNumber('-10,00'), null);
  assert.equal(parseBrlNumber('abc'), null);
  assert.equal(parseBrlNumber('10,20,30'), null);
  assert.equal(parseBrlNumber(NaN), null);
});

test('formatEditableBrl formata com vírgula e duas casas decimais', () => {
  assert.equal(formatEditableBrl(150.5), '150,50');
  assert.equal(formatEditableBrl(0), '0,00');
  assert.equal(formatEditableBrl('invalid'), '');
});

test('shiftMonth, monthKey, parseMonthKey e defaultDateForMonth lidam com virada de ano', () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), { ano: 2027, mes: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { ano: 2025, mes: 12 });
  assert.equal(monthKey(2026, 3), '2026-03');
  assert.deepEqual(parseMonthKey('2026-11'), { ano: 2026, mes: 11 });
  assert.equal(parseMonthKey('2026-13'), null);

  const ref = new Date(2026, 10, 23); // 23/11/2026
  assert.equal(defaultDateForMonth(11, 2026, ref), '2026-11-23');
  assert.equal(defaultDateForMonth(12, 2026, ref), '2026-12-01');
});

test('buildMonthTabs ordena meses cronologicamente e garante mês anterior, atual, próximo e selecionado', () => {
  const ref = new Date(2026, 10, 23); // Nov/2026
  const historico = [
    { ano: 2027, mes: 1, saldo_devedor: 120, total_gastos: 120, total_pagamentos: 0, lancamentos: [{}] },
    { ano: 2026, mes: 11, is_atual: true, saldo_devedor: 300, total_gastos: 300, total_pagamentos: 0, lancamentos: [{}, {}] },
  ];
  const tabs = buildMonthTabs(historico, '2026-08', ref);
  assert.deepEqual(
    tabs.map((t) => t.key),
    ['2026-08', '2026-10', '2026-11', '2026-12', '2027-01'],
  );
  const nov = tabs.find((t) => t.key === '2026-11');
  assert.equal(nov.label, 'Nov/2026');
  assert.equal(nov.isAtual, true);
  assert.equal(nov.qtdLancamentos, 2);
});

test('encodeOriginValue e decodeOriginPatch preservam consistência de cartão, conta e tipos especiais', () => {
  assert.equal(encodeOriginValue({ cartao_id: 5, conta_id: null }), 'card:5');
  assert.equal(encodeOriginValue({ cartao_id: null, conta_id: 2 }), 'account:2');
  assert.equal(encodeOriginValue({ cartao_id: null, conta_id: null }), 'cash');

  assert.deepEqual(decodeOriginPatch('card:7', 'despesa_conta'), {
    cartao_id: 7,
    conta_id: null,
    tipo: 'compra_cartao',
  });
  assert.deepEqual(decodeOriginPatch('account:3', 'compra_cartao'), {
    cartao_id: null,
    conta_id: 3,
    tipo: 'despesa_conta',
  });
  assert.deepEqual(decodeOriginPatch('account:3', 'emprestimo_dado'), {
    cartao_id: null,
    conta_id: 3,
    tipo: 'emprestimo_dado',
  });
  assert.deepEqual(decodeOriginPatch('cash', 'compra_para_mim'), {
    cartao_id: null,
    conta_id: null,
    tipo: 'compra_para_mim',
  });
});

test('normalizePaymentFormaCode identifica corretamente as formas de pagamento', () => {
  assert.equal(normalizePaymentFormaCode('Pix'), 'pix');
  assert.equal(normalizePaymentFormaCode('Dinheiro em mãos'), 'dinheiro');
  assert.equal(normalizePaymentFormaCode('Transferência bancária'), 'transferencia');
  assert.equal(normalizePaymentFormaCode('Abatimento de dívida'), 'abatimento');
  assert.equal(normalizePaymentFormaCode('Vale alimentação'), 'outro');
  assert.equal(normalizePaymentFormaCode(null, 4), 'transferencia');
  assert.equal(normalizePaymentFormaCode(null, null), 'dinheiro');
});

test('Pessoas.jsx e client.js expõem planilha mensal automática, edição inline, auto-save e endpoints PATCH', () => {
  assert.match(pessoasSrc, /data-testid="person-spreadsheet"/);
  assert.match(pessoasSrc, /data-testid="spreadsheet-month-tabs"/);
  assert.match(pessoasSrc, /data-testid="spreadsheet-save-status"/);
  assert.match(pessoasSrc, /data-testid="spreadsheet-launches-table"/);
  assert.match(pessoasSrc, /data-testid="spreadsheet-new-launch-row"/);
  assert.match(pessoasSrc, /data-testid="spreadsheet-payments-table"/);
  assert.match(pessoasSrc, /lancamentosApi\.atualizar\(/);
  assert.match(pessoasSrc, /lancamentosApi\.atualizarParcela\(/);
  assert.match(pessoasSrc, /pessoasApi\.atualizarPagamento\(/);
  assert.match(pessoasSrc, /✓ Salvo/);
  assert.match(pessoasSrc, /Salvando\.\.\./);

  assert.match(clientSrc, /atualizarPagamento:/);
  assert.match(clientSrc, /atualizarParcela:/);
  assert.match(clientSrc, /api\.patch\(`\/lancamentos\/\$\{id\}`/);
});
