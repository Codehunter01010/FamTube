# Family YouTube (SafeTube)

A Windows desktop app that looks like YouTube but only shows channels a parent approved.
Everything runs on the PC; there is no server.

## For developers

- `npm install` then `npm start` to run it.
- `npm test` runs the unit tests.
- `npm run dist:win` builds `dist/YouTube-Family-Setup-<version>.exe`
  (on Linux this needs wine with 32-bit support).

## Layout

- `src/main.js`: Electron main process, window lock-in, settings IPC.
- `src/store.js`: local settings (hashed parent PIN, API key).
- `src/youtube-api.js`: YouTube Data API v3 calls.
- `src/renderer/`: the YouTube-style interface and first-run wizard.

Settings live in `%APPDATA%\YouTube\settings.json`.
