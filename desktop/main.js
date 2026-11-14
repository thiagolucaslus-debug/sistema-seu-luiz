'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell } = require('electron');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

app.setAppUserModelId('com.administracaofinanceira.desktop');

// Estabilidade em Windows 10/11 e instalacoes em discos secundarios (D:\, E:\, etc.)
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('no-proxy-server');
app.commandLine.appendSwitch('proxy-bypass-list', '<-loopback>');
app.commandLine.appendSwitch(
  'disable-features',
  'NetworkServiceSandbox,AudioServiceSandbox,RendererCodeIntegrity'
);

const DEFAULT_HUB_URL = 'https://sistema-seu-luiz.onrender.com';

let mainWindow = null;
let pythonProc = null;
let whatsappProc = null;
let backendPort = 0;
let serverUrl = '';
let isQuitting = false;

function copyDirFilesIfMissing(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(dstDir, entry.name);
    if (entry.isFile() && !fs.existsSync(d)) {
      try { fs.copyFileSync(s, d); } catch (_) {}
    }
  }
}

function resolveUserDataDir() {
  if (process.env.SEU_LUIZ_DATA_DIR && process.env.SEU_LUIZ_DATA_DIR.trim()) {
    return path.resolve(process.env.SEU_LUIZ_DATA_DIR.trim());
  }
  const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const defaultAppData = path.join(localApp, 'AdministracaoFinanceira');

  // Quando instalado em outro disco (ex.: D:\AdministracaoFinanceira), armazena banco,
  // uploads, PDFs e cache diretamente no disco escolhido (preservando espaco no C:\)
  // e migra automaticamente dados pre-existentes de %LOCALAPPDATA%\AdministracaoFinanceira.
  if (app.isPackaged) {
    try {
      const exeDir = path.dirname(process.execPath);
      const driveRoot = (path.parse(exeDir).root || '').toUpperCase();
      if (driveRoot && driveRoot !== 'C:\\') {
        const driveDataDir = path.join(exeDir, 'dados');
        fs.mkdirSync(driveDataDir, { recursive: true });
        const probe = path.join(driveDataDir, '.write_probe');
        fs.writeFileSync(probe, 'ok');
        fs.unlinkSync(probe);

        const dstDb = path.join(driveDataDir, 'financeiro.db');
        const srcDb = path.join(defaultAppData, 'financeiro.db');
        if (!fs.existsSync(dstDb) && fs.existsSync(srcDb)) {
          fs.copyFileSync(srcDb, dstDb);
          copyDirFilesIfMissing(path.join(defaultAppData, 'uploads'), path.join(driveDataDir, 'uploads'));
          copyDirFilesIfMissing(path.join(defaultAppData, 'backups_seguranca'), path.join(driveDataDir, 'backups_seguranca'));
        }
        return driveDataDir;
      }
    } catch (_) {}
  }
  return defaultAppData;
}

try {
  const initialDataRoot = resolveUserDataDir();
  const customChromiumProfile = path.join(initialDataRoot, 'electron_profile');
  fs.mkdirSync(customChromiumProfile, { recursive: true });
  app.setPath('userData', customChromiumProfile);
} catch (_) {}

function resolveEngineRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app_engine');
  }
  const cleanStaged = path.join(__dirname, 'app_engine_clean');
  if (fs.existsSync(path.join(cleanStaged, 'desktop_launcher.py'))) {
    return cleanStaged;
  }
  return path.resolve(__dirname, '..');
}

function resolvePythonBin() {
  const bundledPkg = path.join(process.resourcesPath || '', 'python_runtime', 'python.exe');
  const bundledDev = path.join(__dirname, 'portable_runtime', 'python_runtime', 'python.exe');
  const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const candidates = [
    ...(app.isPackaged ? [bundledPkg] : [bundledDev, bundledPkg]),
    path.join(localApp, 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(localApp, 'Programs', 'Python', 'Python311', 'python.exe'),
    'python',
  ];
  for (const cand of candidates) {
    if (cand && (cand === 'python' || fs.existsSync(cand))) {
      return cand;
    }
  }
  return 'python';
}

function resolveNodeBin() {
  const candidates = [
    path.join(process.resourcesPath || '', 'nodejs', 'node.exe'),
    path.join(__dirname, 'portable_runtime', 'nodejs', 'node.exe'),
    'C:\\Program Files\\nodejs\\node.exe',
  ];
  for (const cand of candidates) {
    if (cand && fs.existsSync(cand)) return cand;
  }
  return '';
}

function resolveIconPath() {
  const unpacked = __dirname.replace('app.asar', 'app.asar.unpacked');
  const candidates = [
    path.join(unpacked, 'icon.ico'),
    path.join(__dirname, 'icon.ico'),
    path.join(unpacked, 'icon.png'),
    path.join(__dirname, 'icon.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(__dirname, 'icon.ico');
}

function findFreePort(preferredPort = 18420) {
  return new Promise((resolve, reject) => {
    const tryListen = portToTry => {
      const srv = net.createServer();
      srv.unref();
      srv.on('error', () => {
        if (portToTry !== 0) {
          tryListen(0);
        } else {
          reject(new Error('Não foi possível alocar porta local em 127.0.0.1.'));
        }
      });
      srv.listen(portToTry, '127.0.0.1', () => {
        const chosen = srv.address().port;
        srv.close(() => resolve(chosen));
      });
    };
    tryListen(preferredPort);
  });
}

function isPortInUse(port) {
  return new Promise(resolve => {
    const sock = new net.Socket();
    sock.setTimeout(500);
    sock.once('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.once('timeout', () => {
      sock.destroy();
      resolve(false);
    });
    sock.once('error', () => {
      sock.destroy();
      resolve(false);
    });
    sock.connect(port, '127.0.0.1');
  });
}

function checkBackendHealth(url) {
  return new Promise(resolve => {
    if (!url) return resolve(false);
    const req = http.get(`${url}/health`, { timeout: 1500 }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(false);
        try {
          const parsed = JSON.parse(body);
          resolve(Boolean(parsed && parsed.status === 'ok'));
        } catch (_) {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function killProcessTree(proc) {
  if (!proc || !proc.pid) return;
  const pid = proc.pid;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else {
      proc.kill('SIGTERM');
    }
  } catch (_) {
    try { proc.kill(); } catch (__) {}
  }
}

async function maybeStartWhatsappService(engineRoot, userDataDir, logDir) {
  try {
    if (whatsappProc) return;
    const nodeBin = resolveNodeBin();
    const waDir = path.join(engineRoot, 'whatsapp-service');
    const waScript = path.join(waDir, 'sender.js');
    if (!nodeBin || !fs.existsSync(waScript) || !fs.existsSync(path.join(waDir, 'node_modules'))) {
      return;
    }
    if (await isPortInUse(3001)) {
      return;
    }
    const waLog = fs.openSync(path.join(logDir, 'whatsapp_service.log'), 'a');
    whatsappProc = spawn(nodeBin, [waScript], {
      cwd: waDir,
      windowsHide: true,
      stdio: ['ignore', waLog, waLog],
      env: {
        ...process.env,
        SEU_LUIZ_DATA_DIR: userDataDir,
      },
    });
    whatsappProc.on('exit', () => {
      whatsappProc = null;
    });
  } catch (_) {}
}

async function startBackend(forceRestart = false) {
  if (forceRestart && pythonProc) {
    killProcessTree(pythonProc);
    pythonProc = null;
    serverUrl = '';
    await new Promise(r => setTimeout(r, 400));
  }

  if (!forceRestart && serverUrl && (await checkBackendHealth(serverUrl))) {
    return serverUrl;
  }

  const userDataDir = resolveUserDataDir();
  const logDir = path.join(userDataDir, 'logs');
  fs.mkdirSync(path.join(userDataDir, 'uploads'), { recursive: true });
  fs.mkdirSync(path.join(userDataDir, 'pdfs'), { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  const engineRoot = resolveEngineRoot();
  const launcherScript = path.join(engineRoot, 'desktop_launcher.py');
  if (!fs.existsSync(launcherScript)) {
    throw new Error(`Motor do sistema não encontrado em: ${launcherScript}`);
  }

  const pyBin = resolvePythonBin();
  const pyDir = pyBin !== 'python' ? path.dirname(pyBin) : '';
  const pyScripts = pyDir ? path.join(pyDir, 'Scripts') : '';
  const mergedPath = [pyDir, pyScripts, process.env.PATH || process.env.Path || '']
    .filter(Boolean)
    .join(path.delimiter);

  const preferredPort = Number(process.env.SEU_LUIZ_PORT) || 18420;
  backendPort = await findFreePort(preferredPort);
  const candidateUrl = `http://127.0.0.1:${backendPort}`;

  const logFd = fs.openSync(path.join(logDir, 'desktop_backend.log'), 'a');
  const env = {
    ...process.env,
    PATH: mergedPath,
    PYTHONPATH: [path.join(engineRoot, 'backend'), engineRoot].join(path.delimiter),
    PYTHONNOUSERSITE: '1',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUNBUFFERED: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    SEU_LUIZ_PORT: String(backendPort),
    SEU_LUIZ_NO_BROWSER: '1',
    SEU_LUIZ_DESKTOP_MODE: '1',
    SEU_LUIZ_DATA_DIR: userDataDir,
    SEU_LUIZ_CLOUD_CONFIG_DIR: userDataDir,
    SEU_LUIZ_HUB_URL: process.env.SEU_LUIZ_HUB_URL || DEFAULT_HUB_URL,
  };

  pythonProc = spawn(pyBin, ['-X', 'utf8', '-u', launcherScript], {
    cwd: engineRoot,
    windowsHide: true,
    stdio: ['ignore', logFd, logFd],
    env,
  });

  pythonProc.on('exit', () => {
    pythonProc = null;
  });

  // Inicia o servico auxiliar de WhatsApp Web silenciosamente se disponivel
  maybeStartWhatsappService(engineRoot, userDataDir, logDir);

  const startedAt = Date.now();
  while (Date.now() - startedAt < 40000) {
    if (await checkBackendHealth(candidateUrl)) {
      serverUrl = candidateUrl;
      try {
        fs.writeFileSync(
          path.join(userDataDir, 'desktop_endpoint.json'),
          JSON.stringify({ url: serverUrl, port: backendPort, pid: process.pid, py_pid: pythonProc ? pythonProc.pid : null }),
          'utf8'
        );
      } catch (_) {}
      return serverUrl;
    }
    if (!pythonProc) {
      break;
    }
    await new Promise(r => setTimeout(r, 250));
  }

  let logTail = '';
  try {
    const rawLog = fs.readFileSync(path.join(logDir, 'desktop_backend.log'), 'utf8');
    logTail = rawLog.slice(-800);
  } catch (_) {}
  throw new Error(
    `O motor Python integrado não respondeu a tempo em ${candidateUrl}.\n\nDetalhes:\n${logTail || 'Verifique o log em ' + logDir}`
  );
}

function createMainWindow() {
  const iconPath = resolveIconPath();
  const iconImg = nativeImage.createFromPath(iconPath);

  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 980,
    minHeight: 660,
    title: 'Administração Financeira',
    icon: iconImg.isEmpty() ? iconPath : iconImg,
    backgroundColor: '#09111f',
    autoHideMenuBar: true,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (serverUrl && url.startsWith(serverUrl)) {
      return { action: 'allow' };
    }
    if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('close', () => {
    isQuitting = true;
    app.quit();
  });
}

function bringToFront() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

ipcMain.handle('desktop:restart-backend', async () => {
  const url = await startBackend(true);
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.loadURL(url);
  }
  return { ok: true, url };
});

ipcMain.handle('desktop:open-data-folder', async () => {
  const dir = resolveUserDataDir();
  fs.mkdirSync(dir, { recursive: true });
  await shell.openPath(dir);
  return { ok: true, path: dir };
});

ipcMain.handle('desktop:get-info', async () => ({
  isDesktopApp: true,
  version: app.getVersion(),
  execPath: process.execPath,
  dataDir: resolveUserDataDir(),
  serverUrl,
  hubUrl: process.env.SEU_LUIZ_HUB_URL || DEFAULT_HUB_URL,
}));

const singleLock = app.requestSingleInstanceLock();
if (!singleLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    bringToFront();
  });

  app.whenReady().then(async () => {
    createMainWindow();
    try {
      await mainWindow.loadFile(path.join(__dirname, 'splash.html'));
    } catch (_) {}

    try {
      const url = await startBackend(false);
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          await mainWindow.webContents.session.setProxy({ mode: 'direct' });
        } catch (_) {}
        await mainWindow.loadURL(url);
        bringToFront();
      }
    } catch (err) {
      dialog.showErrorBox('Erro ao iniciar Administração Financeira', err.message || String(err));
      app.quit();
    }
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  killProcessTree(pythonProc);
  killProcessTree(whatsappProc);
  pythonProc = null;
  whatsappProc = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || isQuitting) {
    app.quit();
  }
});
