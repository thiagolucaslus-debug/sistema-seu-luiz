import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  getCardBrand,
  CARD_COLOR_PALETTE,
  suggestIssuerColor,
} from '../src/components/cardBrand.js';

const css = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
const cardArtworkSrc = await readFile(new URL('../src/components/CardArtwork.jsx', import.meta.url), 'utf8');
const cartoesSrc = await readFile(new URL('../src/pages/Cartoes.jsx', import.meta.url), 'utf8');
const pessoasSrc = await readFile(new URL('../src/pages/Pessoas.jsx', import.meta.url), 'utf8');

test('reconhece emissores em nomes cadastrados com acentos, abreviações e apelidos', () => {
  for (const [nome, emissor] of [
    ['Cartão ATACADÃO Visa', 'atacadao'],
    ['atacadao', 'atacadao'],
    ['COOOP', 'coop'],
    ['Co-op Fácil', 'coop'],
    ['Banco Itaú', 'itau'],
    ['ITAU', 'itau'],
    ['Itaucard Click Platinum', 'itau-click'],
    ['Itaú Personnalité', 'itau-personnalite'],
    ['Uniclass Signature', 'itau-uniclass'],
    ['Meu roxinho', 'nubank'],
    ['Nubank Ultravioleta', 'ultravioleta'],
    ['Cartão Coop Bradescard', 'coop'],
  ]) {
    assert.equal(getCardBrand(nome).id, emissor, nome);
  }
});

test('mantém tema personalizado para emissores desconhecidos e evita coincidências parciais', () => {
  for (const nome of ['Cooperativa', 'Cartão Taubaté', 'Nuance', '', undefined]) {
    const tema = getCardBrand(nome, '#185278');
    assert.equal(tema.id, 'custom');
    assert.equal(tema.color, '#185278');
  }
  assert.equal(getCardBrand('Outro', 'red').color, '#51677e');
});

test('aplica a cor escolhida na paleta mesmo em emissores conhecidos (Itaú, Coop, Atacadão, Nubank)', () => {
  const itauRoxo = getCardBrand('ITAU 7467', '#5712f8');
  assert.equal(itauRoxo.id, 'itau');
  assert.equal(itauRoxo.color, '#5712f8');
  assert.equal(itauRoxo.hasCustomColor, true);

  const coopCinza = getCardBrand('coop', '#616161');
  assert.equal(coopCinza.id, 'coop');
  assert.equal(coopCinza.color, '#616161');
  assert.equal(coopCinza.hasCustomColor, true);

  const atacadaoVerde = getCardBrand('ATACADÃO ', '#10b981');
  assert.equal(atacadaoVerde.id, 'atacadao');
  assert.equal(atacadaoVerde.color, '#10b981');

  assert.equal(suggestIssuerColor('Itaú 8334'), '#dd550b');
  assert.equal(suggestIssuerColor('Cartão Próprio'), null);
  assert.ok(CARD_COLOR_PALETTE.length >= 12);
});

test('garante que CSS e CardArtwork usem exatamente a cor do indicador no cartão e expõe edição/zerar', () => {
  assert.doesNotMatch(css, /\.card-art\[data-issuer='itau'\]\s*\{\s*background:/);
  assert.doesNotMatch(css, /\.card-art\[data-issuer='coop'\]\s*\{\s*background:/);
  assert.doesNotMatch(css, /\.card-art\[data-issuer='atacadao'\]\s*\{\s*background:/);
  assert.doesNotMatch(css, /\.card-art\[data-issuer='nubank'\]\s*\{\s*background:/);
  assert.match(cardArtworkSrc, /!brand\.hasCustomColor/);
  assert.match(cartoesSrc, /CARD_COLOR_PALETTE/);
  assert.match(cartoesSrc, /cartoesApi\.atualizar/);
  assert.match(pessoasSrc, /pessoasApi\.zerar/);
  assert.match(pessoasSrc, /pessoasApi\.restaurar/);
  assert.match(pessoasSrc, /pessoasApi\.deletarPagamento/);
  assert.match(pessoasSrc, /lancamentosApi\.cancelar/);
});
