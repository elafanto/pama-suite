# Paper Reel Stock (Standalone)

Offline paper-reel stock app extracted from Pama Suite — **separate codebase and database**.

- Does **not** modify or share data with Pama Business Suite (`PamaSuiteDB`).
- Own IndexedDB name: **`ReelStockStandaloneDB`**
- Features: add reels, for party/order, consume with remark, qty left, filters, summary, PDF/CSV, soft-delete.

## Run

```bash
cd reel-stock-app
npm install
npm run dev
```

Open http://127.0.0.1:5190/

## Build

```bash
npm run build
npm run preview
```

## Note

Pama Suite (`/src`, `/docs` Excel helpers, etc.) is untouched. Give this folder (or its `dist/`) to anyone who only needs reel management.
