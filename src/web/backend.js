// Browser implementation of window.safetube, the same API the desktop app's
// preload exposes. Everything is stored in this browser only (IndexedDB);
// the website itself holds no settings, PIN or key.
const { Library, CATEGORIES } = require('../library');
const yt = require('../youtube-api');

const EXTERNAL_ALLOWLIST = ['https://console.cloud.google.com/', 'https://accounts.google.com/'];
const SYNC_EVERY_MS = 6 * 60 * 60 * 1000;
const UNLOCK_MS = 10 * 60 * 1000;

// ---- Tiny IndexedDB key-value store ----

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('family-tube', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idb(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}

// Synchronous facade over IndexedDB: data is loaded once at start, and each
// save is written in the background (latest write wins).
function idbStorage(db, key, initial) {
  let pending = null;
  return {
    load: () => initial,
    save(data) {
      pending = JSON.parse(JSON.stringify(data));
      queueMicrotask(() => {
        if (!pending) return;
        const value = pending;
        pending = null;
        idb(db, 'readwrite', (s) => s.put(value, key)).catch((err) => console.error('Saving failed', err));
      });
    },
  };
}

// ---- PIN hashing (PBKDF2 via WebCrypto) ----

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hashPin(pin, saltHex) {
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, key, 256));
}

// ---- Backend ----

const ready = (async () => {
  const db = await openDb();
  const [settings, libData] = await Promise.all([
    idb(db, 'readonly', (s) => s.get('settings')),
    idb(db, 'readonly', (s) => s.get('library')),
  ]);
  const settingsStore = idbStorage(db, 'settings', null);
  const state = { settings: { setupDone: false, pinSalt: null, pinHash: null, apiKey: null, ...(settings || {}) } };
  state.saveSettings = () => settingsStore.save(state.settings);
  state.library = new Library(idbStorage(db, 'library', libData || null));
  return state;
})();

let unlockedUntil = 0;
const unlocked = () => Date.now() < unlockedUntil;
const listeners = [];
const notify = () => listeners.forEach((fn) => fn());
const lastFound = new Map();
let syncing = null;

async function syncChannel(s, channel) {
  s.library.setChannelVideos(channel.id, await yt.getChannelVideos(channel, s.settings.apiKey));
}

async function syncAll() {
  const s = await ready;
  if (syncing || !s.settings.apiKey) return syncing;
  syncing = (async () => {
    const errors = [];
    for (const c of [...s.library.channels]) {
      try {
        await syncChannel(s, c);
      } catch (err) {
        errors.push(`${c.title}: ${err.message}`);
      }
    }
    s.library.markSynced();
    notify();
    return errors;
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

function parentOnly(fn) {
  return async (...args) => {
    if (!unlocked()) return { ok: false, message: 'Enter the parent PIN first.' };
    unlockedUntil = Date.now() + UNLOCK_MS;
    try {
      return { ok: true, ...(await fn(await ready, ...args)) };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };
}

const lib = (fn) => async (...args) => fn((await ready).library, ...args);

window.safetube = {
  // Setup and PIN
  async state() {
    const { settings } = await ready;
    return { setupDone: settings.setupDone, hasPin: !!settings.pinHash, hasApiKey: !!settings.apiKey };
  },
  async setPin(pin) {
    const s = await ready;
    if (s.settings.setupDone) return { ok: false, message: 'Setup is already finished.' };
    if (!/^\d{4,8}$/.test(pin)) return { ok: false, message: 'The PIN must be 4 to 8 digits.' };
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    s.settings.pinSalt = salt;
    s.settings.pinHash = await hashPin(pin, salt);
    s.saveSettings();
    return { ok: true };
  },
  async checkPin(pin) {
    const s = await ready;
    const ok = !!s.settings.pinHash && typeof pin === 'string' && (await hashPin(pin, s.settings.pinSalt)) === s.settings.pinHash;
    if (ok) unlockedUntil = Date.now() + UNLOCK_MS;
    return { ok };
  },
  async lockParent() {
    unlockedUntil = 0;
  },
  async setApiKey(key) {
    const s = await ready;
    if (s.settings.setupDone && !unlocked()) return { ok: false, message: 'Enter the parent PIN first.' };
    const result = await yt.validateApiKey(key);
    if (result.ok) {
      s.settings.apiKey = result.key;
      s.saveSettings();
    }
    return { ok: result.ok, message: result.message };
  },
  async finishSetup() {
    const s = await ready;
    if (!s.settings.pinHash || !s.settings.apiKey) return { ok: false, message: 'Set a PIN and an API key first.' };
    s.settings.setupDone = true;
    s.saveSettings();
    return { ok: true };
  },
  async openGuideLink(url) {
    const s = await ready;
    if (s.settings.setupDone && !unlocked()) return false;
    if (!EXTERNAL_ALLOWLIST.some((p) => String(url).startsWith(p))) return false;
    window.open(url, '_blank', 'noopener');
    return true;
  },

  // Library (approved videos only)
  feed: lib((l, category) => l.feed(category || null)),
  categories: lib((l) => l.categories()),
  channels: lib((l) => l.channels.map(({ id, title, thumb, handle, subscribers }) => ({ id, title, thumb, handle, subscribers }))),
  channelVideos: lib((l, id) => l.channelVideos(id)),
  video: lib((l, id) => l.video(id)),
  upNext: lib((l, id) => l.upNext(id)),
  search: lib((l, q) => l.search(q)),
  onLibraryUpdated: (fn) => listeners.push(fn),

  // Parent area
  parent: {
    info: parentOnly((s) => ({
      categories: CATEGORIES,
      channels: s.library.channels.map((c) => ({
        id: c.id,
        title: c.title,
        thumb: c.thumb,
        handle: c.handle,
        categories: c.categories,
        videoCount: s.library.channelVideos(c.id).length,
      })),
      hidden: s.library.data.hidden,
      lastSync: s.library.data.lastSync,
      syncing: !!syncing,
    })),
    findChannel: parentOnly(async (s, input) => {
      const text = String(input || '').trim();
      if (!text) return { results: [] };
      const results = yt.parseChannelInput(text)
        ? [await yt.getChannel(text, s.settings.apiKey)].filter(Boolean)
        : await yt.searchChannels(text, s.settings.apiKey);
      lastFound.clear();
      for (const c of results) lastFound.set(c.id, c);
      return { results: results.map((c) => ({ ...c, approved: !!s.library.channel(c.id) })) };
    }),
    addChannel: parentOnly(async (s, id, categories) => {
      const channel = lastFound.get(id);
      if (!channel) throw new Error('Search for the channel again, then press Add.');
      s.library.addChannel(channel, categories || []);
      await syncChannel(s, s.library.channel(id));
      notify();
      return { videoCount: s.library.channelVideos(id).length };
    }),
    setCategories: parentOnly((s, id, categories) => {
      s.library.setCategories(id, categories || []);
      notify();
    }),
    removeChannel: parentOnly((s, id) => {
      s.library.removeChannel(id);
      notify();
    }),
    hideVideo: parentOnly((s, input) => {
      const m = String(input || '').match(/(?:v=|youtu\.be\/|embed\/|shorts\/|^)([A-Za-z0-9_-]{11})(?:[&?#/]|$)/);
      if (!m) throw new Error('Paste a video link, or open the video and use "Hide this video".');
      s.library.hideVideo(m[1]);
      notify();
    }),
    unhideVideo: parentOnly((s, id) => {
      s.library.unhideVideo(id);
      notify();
    }),
    sync: parentOnly(async () => ({ errors: await syncAll() })),
  },
};

// Check for new videos on start and every 15 minutes once 6 hours have passed.
ready.then((s) => {
  const due = () => s.settings.setupDone && Date.now() - s.library.data.lastSync > SYNC_EVERY_MS;
  if (due()) syncAll();
  setInterval(() => due() && syncAll(), 15 * 60 * 1000);
});

// Ask the browser to keep our data even when disk space runs low.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
