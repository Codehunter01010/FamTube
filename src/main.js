const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const { Store } = require('./store');
const { validateApiKey } = require('./youtube-api');

// Links the setup guide may open in the parent's normal browser. Nothing else
// is ever allowed to leave the app.
const EXTERNAL_ALLOWLIST = [
  'https://console.cloud.google.com/',
  'https://accounts.google.com/',
];

let store;
let win;
// The parent area stays unlocked for a few minutes after a correct PIN.
let parentUnlockedUntil = 0;
const parentUnlocked = () => Date.now() < parentUnlockedUntil;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: 'YouTube',
    backgroundColor: '#0f0f0f',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);
  win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Lock-in: the app's own page is the only place this window may go,
  // and it may never open new windows.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

ipcMain.handle('state', () => store.publicState);

ipcMain.handle('set-pin', (_e, pin) => {
  if (store.data.setupDone) return { ok: false, message: 'Setup is already finished.' };
  try {
    store.setPin(pin);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('check-pin', (_e, pin) => {
  const ok = store.checkPin(pin);
  if (ok) parentUnlockedUntil = Date.now() + 10 * 60 * 1000;
  return { ok };
});

ipcMain.handle('lock-parent', () => {
  parentUnlockedUntil = 0;
});

ipcMain.handle('set-api-key', async (_e, key) => {
  // After setup, changing the key needs the parent PIN.
  if (store.data.setupDone && !parentUnlocked()) return { ok: false, message: 'Enter the parent PIN first.' };
  const result = await validateApiKey(key);
  if (result.ok) store.setApiKey(result.key);
  return { ok: result.ok, message: result.message };
});

ipcMain.handle('finish-setup', () => {
  try {
    store.finishSetup();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('open-guide-link', (_e, url) => {
  // Only during setup or in the parent area, and only to Google's pages.
  if (store.data.setupDone && !parentUnlocked()) return false;
  if (!EXTERNAL_ALLOWLIST.some((p) => String(url).startsWith(p))) return false;
  shell.openExternal(url);
  return true;
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    store = new Store(app.getPath('userData'));
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
