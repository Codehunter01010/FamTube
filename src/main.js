const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { Store } = require('./store');
const { Library, CATEGORIES } = require('./library');
const { fileStorage } = require('./file-storage');
const yt = require('./youtube-api');

// Links the parent may open in their normal browser. Nothing else is ever
// allowed to leave the app.
const EXTERNAL_ALLOWLIST = [
  'https://console.cloud.google.com/',
  'https://accounts.google.com/',
];

const RENDERER_DIR = path.join(__dirname, 'renderer');
const EMBED_PREFIXES = ['https://www.youtube-nocookie.com/embed/', 'https://www.youtube.com/embed/'];
const SYNC_EVERY_MS = 6 * 60 * 60 * 1000;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };

// The app's pages are served from http://localhost so the YouTube player
// sees a normal website (embeds refuse to play on file:// pages). It only
// listens on this computer, not on the network.
let APP_ORIGIN = '';
let store;
let library;
let win;
// The parent area stays unlocked for a few minutes after a correct PIN.
let parentUnlockedUntil = 0;
const parentUnlocked = () => Date.now() < parentUnlockedUntil;
// Channels found by the last parent search, so "Add" uses data from YouTube
// rather than whatever the page sends back.
const lastFound = new Map();

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: 'FamTube',
    backgroundColor: '#0f0f0f',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });
  Menu.setApplicationMenu(null);
  win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadURL(`${APP_ORIGIN}/index.html`);

  // Lock-in: the window never leaves the app, never opens new windows, and
  // the embedded player may only show approved videos.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(APP_ORIGIN + '/')) e.preventDefault();
  });
  win.webContents.on('will-frame-navigate', (e) => {
    if (e.isMainFrame) return;
    if (!isAllowedFrameUrl(e.url)) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function isAllowedFrameUrl(url) {
  if (url === 'about:blank') return true;
  const prefix = EMBED_PREFIXES.find((p) => url.startsWith(p));
  if (!prefix) return false;
  const id = url.slice(prefix.length).split(/[?#/]/)[0];
  return library.isAllowed(id);
}

function serveApp() {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.normalize(path.join(RENDERER_DIR, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(RENDERER_DIR + path.sep)) {
      res.writeHead(404).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(data);
    });
  });
  // A fixed port keeps the address stable; try a few in case one is taken.
  return new Promise((resolve, reject) => {
    let port = 47821;
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && port < 47840) server.listen(++port, '127.0.0.1');
      else reject(err);
    });
    server.on('listening', () => {
      APP_ORIGIN = `http://localhost:${port}`;
      resolve();
    });
    server.listen(port, '127.0.0.1');
  });
}

// ---- Sync -----------------------------------------------------------------

let syncing = null;

async function syncChannel(channel) {
  const videos = await yt.getChannelVideos(channel, store.data.apiKey);
  library.setChannelVideos(channel.id, videos);
}

function syncAll() {
  if (syncing || !store.data.apiKey) return syncing;
  syncing = (async () => {
    const errors = [];
    for (const c of [...library.channels]) {
      try {
        await syncChannel(c);
      } catch (err) {
        errors.push(`${c.title}: ${err.message}`);
      }
    }
    library.markSynced();
    notifyLibraryChanged();
    return errors;
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

function notifyLibraryChanged() {
  if (win && !win.isDestroyed()) win.webContents.send('library-updated');
}

// ---- Setup and PIN --------------------------------------------------------

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
  const result = await yt.validateApiKey(key);
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

// ---- What the child sees (always filtered by the library) -----------------

ipcMain.handle('settings', () => ({ premium: !!store.data.premium }));
ipcMain.handle('feed', (_e, category) => library.feed(category || null));
ipcMain.handle('categories', () => library.categories());
ipcMain.handle('channels', () => library.channels.map(({ id, title, thumb, handle, subscribers }) => ({ id, title, thumb, handle, subscribers })));
ipcMain.handle('channel-videos', (_e, id) => library.channelVideos(id));
ipcMain.handle('video', (_e, id) => library.video(id));
ipcMain.handle('up-next', (_e, id) => library.upNext(id));
ipcMain.handle('search', (_e, q) => library.search(q));
ipcMain.handle('report-unplayable', (_e, id) => {
  if (library.markUnplayable(id)) notifyLibraryChanged();
});

// ---- Parent area (requires a recent correct PIN) --------------------------

function parentOnly(fn) {
  return async (_e, ...args) => {
    if (!parentUnlocked()) return { ok: false, message: 'Enter the parent PIN first.' };
    parentUnlockedUntil = Date.now() + 10 * 60 * 1000;
    try {
      return { ok: true, ...(await fn(...args)) };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };
}

ipcMain.handle('parent:info', parentOnly(() => ({
  categories: CATEGORIES,
  channels: library.channels.map((c) => ({
    id: c.id,
    title: c.title,
    thumb: c.thumb,
    handle: c.handle,
    categories: c.categories,
    videoCount: library.channelVideos(c.id).length,
  })),
  hidden: library.data.hidden,
  lastSync: library.data.lastSync,
  syncing: !!syncing,
  premium: !!store.data.premium,
})));

ipcMain.handle('parent:set-premium', parentOnly((on) => {
  store.data.premium = !!on;
  store.save();
}));

ipcMain.handle('parent:find-channel', parentOnly(async (input) => {
  const text = String(input || '').trim();
  if (!text) return { results: [] };
  const results = yt.parseChannelInput(text)
    ? [await yt.getChannel(text, store.data.apiKey)].filter(Boolean)
    : await yt.searchChannels(text, store.data.apiKey);
  lastFound.clear();
  for (const c of results) lastFound.set(c.id, c);
  return { results: results.map((c) => ({ ...c, approved: !!library.channel(c.id) })) };
}));

ipcMain.handle('parent:add-channel', parentOnly(async (id, categories) => {
  const channel = lastFound.get(id);
  if (!channel) throw new Error('Search for the channel again, then press Add.');
  library.addChannel(channel, categories || []);
  await syncChannel(library.channel(id));
  notifyLibraryChanged();
  return { videoCount: library.channelVideos(id).length };
}));

ipcMain.handle('parent:set-categories', parentOnly((id, categories) => {
  library.setCategories(id, categories || []);
  notifyLibraryChanged();
}));

ipcMain.handle('parent:remove-channel', parentOnly((id) => {
  library.removeChannel(id);
  notifyLibraryChanged();
}));

ipcMain.handle('parent:hide-video', parentOnly((input) => {
  const m = String(input || '').match(/(?:v=|youtu\.be\/|embed\/|shorts\/|^)([A-Za-z0-9_-]{11})(?:[&?#/]|$)/);
  if (!m) throw new Error('Paste a video link, or open the video and use "Hide this video".');
  library.hideVideo(m[1]);
  notifyLibraryChanged();
}));

ipcMain.handle('parent:unhide-video', parentOnly((id) => {
  library.unhideVideo(id);
  notifyLibraryChanged();
}));

ipcMain.handle('parent:sync', parentOnly(async () => ({ errors: await syncAll() })));
ipcMain.handle('parent:export-list', parentOnly(() => ({ list: library.exportList() })));
ipcMain.handle('parent:import-list', parentOnly(async (text) => {
  let list;
  try {
    list = JSON.parse(text);
  } catch {
    throw new Error('This is not a FamTube channel list.');
  }
  const added = library.importList(list);
  notifyLibraryChanged();
  syncAll();
  return { added };
}));

// ---- Start ----------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(async () => {
    store = new Store(app.getPath('userData'));
    library = new Library(fileStorage(path.join(app.getPath('userData'), 'library.json')));
    await serveApp();
    createWindow();
    const due = () => store.data.setupDone && Date.now() - library.data.lastSync > SYNC_EVERY_MS;
    if (due()) syncAll();
    setInterval(() => due() && syncAll(), 15 * 60 * 1000);
  });
  app.on('window-all-closed', () => app.quit());
}
