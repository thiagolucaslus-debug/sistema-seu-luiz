import assert from 'node:assert/strict';
import test from 'node:test';
import { getCardBrand } from '../src/components/cardBrand.js';

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
