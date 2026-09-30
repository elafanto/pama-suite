# Paper Reel Stock

Standalone paper-reel stock project (web + Windows desktop via Tauri 2).

- **Own folder / own project** — not part of Pama Suite runtime
- **Own database:** IndexedDB `ReelStockStandaloneDB` (Pama’s `PamaSuiteDB` se alag)
- Features: add reels, for party/order, consume, qty left, filters, PDF/CSV, soft-delete
- Desktop: Tauri 2 → Windows NSIS `.exe` + MSI

## Run (web)

```bash
cd paper-reel-stock
npm install
npm run dev
```

http://127.0.0.1:5190/

## Run (Windows desktop)

**Prerequisites:** Node 20+, Rust, VS C++ Build Tools, WebView2.

```bash
cd paper-reel-stock
npm install
npm run tauri:dev          # dev window
npm run tauri:build        # installers
```

Installers:

- `src-tauri/target/release/bundle/nsis/` — setup `.exe`
- `src-tauri/target/release/bundle/msi/` — `.msi`

## CI

Repo workflow `.github/workflows/reel-stock-windows.yml` builds Windows artifacts when this folder changes.

## Split into its own GitHub repo (optional)

Is folder already self-contained. Naya empty repo banao, phir:

```bash
cd paper-reel-stock
git init
git add .
git commit -m "Initial Paper Reel Stock project"
git remote add origin https://github.com/YOUR_ORG/paper-reel-stock.git
git push -u origin main
```

Copy `.github/workflows/reel-stock-windows.yml` into that repo and set `working-directory` / paths to `.` (project root) if you flatten CI for a single-repo layout.
