// Gerenciador do Túnel Cloudflare para Acesso Celular / Remoto
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const binDir = path.join(rootDir, 'bin');
const cloudflaredExe = path.join(binDir, 'cloudflared.exe');

let qrcodeTerminal = null;
try {
  qrcodeTerminal = require(path.join(rootDir, 'whatsapp-service', 'node_modules', 'qrcode-terminal'));
} catch (e) {}

console.log('=====================================================');
console.log('   CONECTAR CELULAR — SISTEMA FINANCEIRO SEU LUIZ   ');
console.log('=====================================================\n');

if (!fs.existsSync(cloudflaredExe)) {
  console.log('[1/2] Baixando Cloudflare Tunnel (apenas na 1ª vez)...');
  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
  const curlCmd = spawn('curl.exe', [
    '-L',
    '--output', cloudflaredExe,
    'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
  ], { stdio: 'inherit' });

  curlCmd.on('close', (code) => {
    if (code === 0 && fs.existsSync(cloudflaredExe)) {
      console.log('Cloudflare baixado com sucesso!\n');
      iniciarTunel();
    } else {
      console.error('Falha ao baixar cloudflared. Verifique sua conexão com a internet.');
    }
  });
} else {
  iniciarTunel();
}

function iniciarTunel() {
  console.log('[2/2] Gerando link seguro HTTPS para o celular...\n');

  const proc = spawn(cloudflaredExe, ['tunnel', '--url', 'http://127.0.0.1:5173'], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let urlCapturada = null;

  function processarTexto(texto) {
    if (urlCapturada) return;
    const match = texto.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match) {
      urlCapturada = match[0];
      exibirResultado(urlCapturada);
    }
  }

  proc.stdout.on('data', (d) => processarTexto(d.toString()));
  proc.stderr.on('data', (d) => processarTexto(d.toString()));

  proc.on('close', (code) => {
    console.log(`Túnel encerrado (código ${code}).`);
  });
}

function exibirResultado(url) {
  console.log('=====================================================');
  console.log('LINK DE ACESSO REMOTO GERADO COM SUCESSO:');
  console.log(`\n  👉  \x1b[32m\x1b[1m${url}\x1b[0m  👈\n`);
  console.log('=====================================================');
  console.log('Aponte a camera do seu celular para o QR Code abaixo:\n');

  if (qrcodeTerminal) {
    qrcodeTerminal.generate(url, { small: true });
  }

  // Gera página HTML amigável com QR Code e abre no navegador
  const htmlPath = path.join(rootDir, 'conectar_celular.html');
  const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Acesso pelo Celular — Seu Luiz</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #10151d; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; text-align: center; }
    .card { background: #1a202b; padding: 30px; border-radius: 24px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); max-width: 420px; border: 1px solid #334155; }
    h1 { margin: 0 0 10px; font-size: 22px; font-weight: 800; }
    p { color: #94a3b8; font-size: 14px; margin: 0 0 20px; }
    .qr { background: #fff; padding: 15px; border-radius: 16px; display: inline-block; margin-bottom: 20px; }
    .qr img { display: block; width: 220px; height: 220px; }
    a { display: inline-block; background: #2563eb; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 12px; font-weight: bold; font-size: 14px; word-break: break-all; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Conectar Celular ao Seu Luiz</h1>
    <p>Aponte a camera do seu celular ou compartilhe o link:</p>
    <div class="qr">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(url)}" alt="QR Code" />
    </div>
    <br>
    <a href="${url}" target="_blank">${url}</a>
  </div>
</body>
</html>`;

  fs.writeFileSync(htmlPath, htmlContent, 'utf-8');
  console.log(`\nUma pagina com o QR Code foi gerada em: conectar_celular.html`);
  console.log('Mantenha esta janela aberta para manter o celular conectado!\n');

  // Abre a página no navegador
  const openCmd = spawn('cmd.exe', ['/c', 'start', htmlPath]);
}
