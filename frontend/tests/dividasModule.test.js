import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  calcularEstimativaAntecipacao,
  clampDueDateISO,
  describeSituacaoVencimento,
  formatBRL,
  formatCountdownVencimento,
} from '../src/components/dividasFormat.js';

const layout = await readFile(new URL('../src/components/Layout.jsx', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const client = await readFile(new URL('../src/api/client.js', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../src/pages/Dashboard.jsx', import.meta.url), 'utf8');
const page = await readFile(new URL('../src/pages/Dividas.jsx', import.meta.url), 'utf8');

test('ajusta vencimentos de dias 30 e 31 para meses curtos e anos bissextos', () => {
  assert.equal(clampDueDateISO(2026, 2, 30), '2026-02-28');
  assert.equal(clampDueDateISO(2026, 2, 31), '2026-02-28');
  assert.equal(clampDueDateISO(2028, 2, 30), '2028-02-29');
  assert.equal(clampDueDateISO(2026, 4, 31), '2026-04-30');
  assert.equal(clampDueDateISO(2026, 5, 31), '2026-05-31');
});

test('formata contagem regressiva e estados do radar de vencimentos em português', () => {
  assert.equal(
    formatCountdownVencimento('2026-11-20', '2026-11-16', 'pendente'),
    'Faltam 4 dias — Dia 20'
  );
  assert.equal(
    formatCountdownVencimento('2026-11-16', '2026-11-16', 'pendente'),
    'Vence hoje — Dia 16'
  );
  assert.equal(
    formatCountdownVencimento('2026-11-15', '2026-11-16', 'pendente'),
    'Atrasada há 1 dia — Dia 15'
  );
  assert.equal(
    formatCountdownVencimento('2026-11-20', '2026-11-16', 'pago'),
    'Quitada — Dia 20'
  );
  assert.equal(describeSituacaoVencimento('atrasada').badgeClass, 'badge-red');
  assert.equal(describeSituacaoVencimento('pago').badgeClass, 'badge-green');
  assert.match(formatBRL(1500), /1\.500,00/);
});

test('registra o módulo Dívidas & Estratégia completo no menu, rota, Dashboard e API', () => {
  assert.match(layout, /path:\s*'\/dividas'.*label:\s*'Dívidas & Estratégia'/);
  assert.match(app, /path="\/dividas"/);
  assert.match(dashboard, /Radar de Dívidas & Compromissos/);

  for (const method of [
    'painel',
    'listar',
    'criar',
    'atualizar',
    'deletar',
    'pagar',
    'estornar',
    'antecipar',
    'ajustarMes',
    'simular',
  ]) {
    assert.match(client, new RegExp(`${method}:`));
  }

  for (const label of [
    'Radar & Agenda do Mês',
    'Estratégia & Simulador',
    'Bola de Neve',
    'Maior Alívio Mensal / Avalanche',
    'Simulador de Antecipação & Aporte Extra',
    'Debitar de qual Conta Bancária',
    'selecionarModoEstrategia',
    'Método da Estratégia',
  ]) {
    assert.match(page, new RegExp(label));
  }
});

test('calcula estimativa de antecipação em modo percentual, valor fechado e CDC automático', () => {
  const selecionadas = [
    { numero: 17, mes: 3, ano: 2028, valor_atual: 1500 },
    { numero: 18, mes: 4, ano: 2028, valor_atual: 1500 },
  ];

  // 1) Desconto percentual explícito (5% sobre 2x 1500 = 2850, economia 150)
  const resPct = calcularEstimativaAntecipacao(selecionadas, {
    modoValor: 'percentual',
    descontoPct: '5',
    taxaJurosMensal: 1.8,
    dataPagamentoISO: '2026-11-16',
  });
  assert.equal(resPct.totalPagar, 2850);
  assert.equal(resPct.economia, 150);
  assert.equal(resPct.usaCdcAutomatico, false);

  // 2) CDC automático quando descontoPct está em branco e há taxa_juros_mensal > 0
  const resCdc = calcularEstimativaAntecipacao(selecionadas, {
    modoValor: 'percentual',
    descontoPct: '',
    taxaJurosMensal: 1.8,
    dataPagamentoISO: '2026-11-16',
  });
  assert.equal(resCdc.usaCdcAutomatico, true);
  assert.ok(resCdc.totalPagar < 3000 && resCdc.economia > 600);

  // 3) Digitar 0 explícito desativa desconto (paga valor nominal cheio)
  const resZero = calcularEstimativaAntecipacao(selecionadas, {
    modoValor: 'percentual',
    descontoPct: '0',
    taxaJurosMensal: 1.8,
    dataPagamentoISO: '2026-11-16',
  });
  assert.equal(resZero.totalPagar, 3000);
  assert.equal(resZero.economia, 0);
  assert.equal(resZero.usaCdcAutomatico, false);

  // 4) Valor fechado do boleto
  const resBoleto = calcularEstimativaAntecipacao(selecionadas, {
    modoValor: 'valor_fechado',
    valorFechado: '2620.50',
  });
  assert.equal(resBoleto.totalPagar, 2620.5);
  assert.equal(resBoleto.economia, 379.5);
});
