# Alvin's system – Daftari for Big Rabbit Meat

Offline sales and stock book for **Big Rabbit Meat** (Kimara Kona, Dar es Salaam), live at https://daftari-book.netlify.app.

| Folder | What it is |
| --- | --- |
| `app/` | The web app Netlify publishes (HTML, CSS, icons, fonts, offline worker). |
| `src/head.js`, `src/tail.js` | The app's code: settings and English/Swahili text, then all the logic. Netlify joins them into `app/app.js` on every deploy. |
| `sheet/Code.gs` | The Google Apps Script that keeps the Google Sheet copy in sync. |

## Making a change
1. Edit `src/head.js` or `src/tail.js` (or files in `app/`).
2. Build locally if you want to test: `cat src/head.js src/tail.js > app/app.js`, then open `app/` with any static server.
3. Bump `VERSION` in `src/head.js` and `CACHE` in `app/sw.js`, so installed phones pick up the change.
4. Push to `main`. Netlify builds and publishes automatically.

## The Google Sheet script
Paste `sheet/Code.gs` into the Sheet's Apps Script, then **Deploy › Manage deployments › edit the existing deployment › Version: New version › Deploy**. Never create a new deployment: the app's sync link would change.

Each phone asks for its own sync link the first time; no link is built into the app.
