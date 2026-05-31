# Pama Business Suite — Setup Guide

This app runs **offline-first** in the browser (IndexedDB via Dexie). Cloud sync, login, and multi-device backup require **Supabase**. Production hosting is designed for **Vercel**.

## Prerequisites

- Node.js 20+ and npm
- A [Supabase](https://supabase.com) account (free tier is fine)
- A [Vercel](https://vercel.com) account (optional, for deployment)
- A [Google AI Studio](https://aistudio.google.com) API key (optional, for AI invoice scanning in Purchases)

## 1. Local development

```bash
cd pama-suite
npm install
npm run dev
```

Open the URL shown in the terminal (usually `http://localhost:5173`).

## 2. Supabase project

1. Create a new project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Go to **SQL Editor** → **New query**.
3. Paste and run the full script from:

   `supabase/migrations/001_initial_schema.sql`

4. Then run **`supabase/migrations/002_realtime_and_org_bootstrap.sql`** (first-login fix + Realtime sync).

5. Go to **Authentication** → **Providers** → enable **Email** (password sign-in).
6. Go to **Settings** → **API** and copy:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon public** key → `VITE_SUPABASE_ANON_KEY`

## 3. Environment variables

Copy the example file and fill in your keys:

```bash
cp .env.example .env.local
```

`.env.local` (never commit this file):

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

Restart `npm run dev` after changing env vars.

Without Supabase keys the app still works locally; the header shows **Local only** and sync/login are disabled.

## 4. First login & sync

1. Open **Login** (`/login`) or use **Sign in** in the top bar.
2. **Sign up** with email/password (confirm email if your project requires it).
3. On first login the app creates an **org** and links your profile automatically.
4. Use **Sync** in the header or **Settings → Cloud Sync** to push local changes and pull updates from other devices.

Sync order: **pull** remote changes first, then **push** local `_dirty` records. After login, sync runs automatically; Realtime pushes changes from other devices within ~2 seconds.

**Full Hindi/English guide:** see [`MOBILE-CLOUD-SETUP.md`](./MOBILE-CLOUD-SETUP.md) for cloud + mobile install steps.

## 5. Import legacy PamaTools data

1. Export or copy your old `pama_tools_live.json` from PamaTools.
2. Go to **Settings → Backup & Import → Import JSON**.
3. Choose **Merge** to keep existing data or **Replace** to wipe local DB first.

Supported formats: `pama_suite_backup`, `pama_unified_backup`, and legacy billing JSON.

## 6. Gemini AI scanner (optional)

1. Create an API key in Google AI Studio.
2. **Settings → AI Invoice Scanner** → paste key → **Save Key**.
3. In **Purchases → Record Bill**, use **Scan invoice** to pre-fill supplier and line items.

The key is stored only in this browser (`localStorage`).

## 7. Deploy to Vercel

1. Push `pama-suite` to GitHub (or import the folder in Vercel).
2. In Vercel project **Settings → Environment Variables**, add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Build command: `npm run build`
4. Output directory: `dist`
5. Deploy. The included `vercel.json` adds SPA fallback for Vue Router.

After deploy, add your Vercel URL under Supabase **Authentication → URL Configuration** (Site URL + Redirect URLs) if you use email confirmation links.

## 8. Production build check

```bash
npm run build
npm run preview
```

## Module map

| Route | Module |
|-------|--------|
| `/dashboard` | Overview & quick links |
| `/billing` | GST invoices, templates, payments |
| `/purchases` | Vendor bills, AI scan |
| `/accounting` | Ledger, vouchers, Trial Balance, P&L, Balance Sheet |
| `/parties` | Customers & vendors (unified) |
| `/items` | Product / box catalogue |
| `/boxcalc` | Corrugated costing & recipes |
| `/banking` | RTGS/NEFT email generator |
| `/reports` | GSTR-1, outstanding, cash book, activity log |
| `/settings` | Firms, backup, sync, Gemini key |
| `/login` | Supabase auth |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Sync says "Login required" | Sign in and ensure `.env.local` has valid Supabase keys |
| RLS / permission errors | Re-run `001_initial_schema.sql`; check user is in `org_members` |
| Blank after deploy | Confirm Vercel env vars are set for the **Production** environment |
| AI scan fails | Save Gemini key in Settings; check browser network to Google API |
