import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
const tailwind = await readFile(new URL('../tailwind.config.js', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../src/pages/Dashboard.jsx', import.meta.url), 'utf8');
const layout = await readFile(new URL('../src/components/Layout.jsx', import.meta.url), 'utf8');

test('usa os tokens estruturais da paleta Grafite Premium', () => {
  for (const token of [
    '--canvas: #eef1f5',
    '--surface: #ffffff',
    '--raised: #f3f5f8',
    '--ink: #111827',
    '--accent: #2563eb',
    '--sidebar: #151a22',
    '--canvas: #10151d',
    '--surface: #1a202b',
    '--accent: #60a5fa',
  ]) {
    assert.match(css, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('remove a antiga identidade verde dos elementos estruturais', () => {
  for (const oldColor of ['#335341', '#26372d', '#385643', '#354c3b']) {
    assert.doesNotMatch(css, new RegExp(oldColor, 'i'));
  }
});

test('alinha a escala utilitária azul ao cobalto do tema', () => {
  assert.match(tailwind, /500:\s*'#3b82f6'/i);
  assert.match(tailwind, /600:\s*'#2563eb'/i);
  assert.match(tailwind, /700:\s*'#1d4ed8'/i);
});

test('usa acentos frios e controlados nos cartões do Dashboard', () => {
  for (const accent of ['#2563eb', '#0891b2', '#6366f1', '#d97706']) {
    assert.match(dashboard, new RegExp(accent, 'i'));
  }

  for (const oldAccent of ['#52704f', '#a45d49', '#a37a39']) {
    assert.doesNotMatch(dashboard, new RegExp(oldAccent, 'i'));
  }
});

test('expõe a troca Claro e Escuro diretamente no layout principal', () => {
  assert.match(layout, /useAppearance\(\)/);
  assert.match(layout, /theme === 'dark' \? 'Ativar modo claro' : 'Ativar modo escuro'/);
  assert.match(layout, /setTheme\(theme === 'dark' \? 'light' : 'dark'\)/);
  assert.match(layout, /Sun/);
  assert.match(layout, /Moon/);
  assert.match(css, /\.theme-toggle\s*\{/);
});
