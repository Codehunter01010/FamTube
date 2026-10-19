# Family YouTube

A YouTube-style app that only shows channels a parent approved. No Shorts,
no recommendations from YouTube, and nothing plays by itself.

It comes in two forms that share the same interface and allowlist code:

- **Web app** (`npm run build:web` → `web/`), published to GitHub Pages on
  every push to `main`. Settings, PIN and API key live only in the browser
  that uses it (IndexedDB), never on the website.
- **Windows desktop app** (Electron, `npm run dist:win`).

## Layout

- `src/library.js`: the allowlist and cached videos. Everything the child
  sees comes through here.
- `src/youtube-api.js`: YouTube Data API v3 calls.
- `src/renderer/`: the interface (shared by web and desktop).
- `src/web/backend.js`: browser backend for the web app.
- `src/main.js`, `src/preload.js`, `src/store.js`: desktop backend.

## Develop

- `npm install`
- `npm test` runs the allowlist tests.
- `npm run build:web`, then serve `web/` with any static server.
- `npm start` runs the desktop app.
