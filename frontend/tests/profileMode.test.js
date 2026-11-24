import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPersonalOnlyProfile } from '../src/components/profileMode.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('isPersonalOnlyProfile aplica modo pessoal exclusivamente para thiagolucas121', () => {
  assert.equal(isPersonalOnlyProfile({ usuario: 'thiagolucas121', nome: 'Thiago' }), true);
  assert.equal(isPersonalOnlyProfile({ usuario: '  ThiagoLucas121  ' }), true);
  assert.equal(isPersonalOnlyProfile({ email: 'thiagolucas121' }), true);

  assert.equal(isPersonalOnlyProfile({ usuario: 'luiz', nome: 'FRANCISCO LUIZ' }), false);
  assert.equal(isPersonalOnlyProfile({ usuario: 'admin' }), false);
  assert.equal(isPersonalOnlyProfile({ usuario: 'novo_usuario' }), false);
  assert.equal(isPersonalOnlyProfile(null), false);
  assert.equal(isPersonalOnlyProfile(undefined), false);
});

test('Layout, App, Dashboard, FechamentoMes e Lancamentos protegem o modo pessoal apenas atrás de isPersonalOnlyProfile', () => {
  const files = [
    '../src/components/Layout.jsx',
    '../src/App.jsx',
    '../src/pages/Dashboard.jsx',
    '../src/pages/FechamentoMes.jsx',
    '../src/pages/Lancamentos.jsx',
    '../src/components/ModalAcessoCelular.jsx',
  ];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    assert.match(src, /isPersonalOnlyProfile/, `${rel} deve usar isPersonalOnlyProfile`);
  }
  const layoutSrc = fs.readFileSync(path.join(__dirname, '../src/components/Layout.jsx'), 'utf8');
  assert.match(layoutSrc, /personalOnly \? \(\s*<Avatar/, 'Layout deve exibir a foto de perfil no topo no modo pessoal');
  assert.match(layoutSrc, /!\s*personalOnly \? \[\{ path: '\/pessoas'/, 'Layout deve ocultar Pessoas & Fechamentos apenas quando personalOnly=true');
});
