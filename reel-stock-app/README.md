# Paper Reel Stock (Standalone)

Offline paper-reel stock app extracted from Pama Suite — **separate codebase and database**.

- Does **not** modify or share data with Pama Business Suite (`PamaSuiteDB`).
- Own IndexedDB name: **`ReelStockStandaloneDB`**
- Features: add reels, for party/order, consume with remark, qty left, filters, summary, PDF/CSV, soft-delete.
- Desktop: **Tauri 2** Windows app (WebView2 + same IndexedDB storage).

## Web app

```bash
cd reel-stock-app
npm install
npm run dev
```

Open http://127.0.0.1:5190/

```bash
npm run build
npm run preview
```

## Desktop (Tauri / Windows)

### Prerequisites (Windows)

1. **Node.js** 20+ (LTS) — https://nodejs.org/
2. **Rust** (stable) — https://rustup.rs/  
   In PowerShell: `winget install Rustlang.Rustup` then restart the terminal.
3. **Microsoft C++ Build Tools** — Visual Studio Build Tools with “Desktop development with C++”, or:
   ```powershell
   winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
   ```
4. **WebView2 Runtime** — usually already on Windows 10/11. If missing:  
   https://developer.microsoft.com/microsoft-edge/webview2/

### Dev (desktop window)

```bash
cd reel-stock-app
npm install
npm run tauri:dev
```

### Build `.exe` / MSI locally

```bash
cd reel-stock-app
npm install
npm run tauri:build
```

Installers land under:

- `src-tauri/target/release/bundle/nsis/` — NSIS setup `.exe`
- `src-tauri/target/release/bundle/msi/` — `.msi`
- `src-tauri/target/release/paper-reel-stock.exe` — raw binary

### CI (recommended)

This repo includes `.github/workflows/reel-stock-windows.yml`, which builds Windows NSIS + MSI on `windows-latest` and uploads artifacts. Trigger via **Actions → Paper Reel Stock (Windows)** → **Run workflow**, or push changes under `reel-stock-app/`.

No Linux machine is required for the final Windows installers.

## Note

Pama Suite (`/src`, `/docs` Excel helpers, etc.) is untouched. Give this folder (or its `dist/` / Windows installer) to anyone who only needs reel management.
