# Online Database + Mobile App — Setup (Hindi/English)

Yeh guide **cloud sync (Supabase)** aur **mobile par install** ke liye hai. Code ready hai — aapko sirf accounts banana aur env vars set karne hain.

---

## Part A: Online database (Supabase) — ₹0 free tier

### Step 1 — Supabase project

1. [supabase.com](https://supabase.com) par login / sign up
2. **New project** → naam: `pama-suite` → region: **South Asia (Mumbai)** ya closest
3. Database password save kar lo

### Step 2 — SQL migrations (zaroori)

Supabase Dashboard → **SQL Editor** → New query:

In files ko order me paste karke **Run** karo:

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_realtime_and_org_bootstrap.sql`
3. `supabase/migrations/003_bootstrap_user_org.sql`
4. `supabase/migrations/004_inventory_and_firm_sync_fields.sql`
5. `supabase/migrations/005_production_tracking.sql`
6. `supabase/migrations/006_item_stock_movements.sql`
7. `supabase/migrations/007_secure_org_members_insert.sql`

Ye migrations login org setup, realtime sync, inventory, production, paper reels, item stock movement tables, aur secure org membership policies ko cloud me ready karte hain.

### Step 3 — Email login

**Authentication** → **Providers** → **Email** ON  
(Optional) **Confirm email** OFF rakho agar testing ke liye turant login chahiye

### Step 4 — API keys → `.env.local`

**Settings** → **API** se copy karo:

```env
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbG...
```

File: `pama-suite/.env.local` (git me commit mat karo)

```powershell
cd c:\Users\saman\GIT\pama-suite
copy .env.example .env.local
# notepad se keys paste karo
npm.cmd run dev
```

### Step 5 — Pehli baar login + sync

1. Browser: `http://localhost:5180/login` (ya dev server jo port terminal me dikhaye)
2. **Sign up** (email + password)
3. Settings → Cloud Sync me zarurat ho to **Setup Organization** dabao
4. Agar PC/local app me existing data hai: **Full Push to Cloud** dabao
5. Doosre phone/PC par same login → **Full Pull from Cloud** dabao
6. Uske baad normal **Sync** button daily use ke liye kaafi hai

**Auto-sync:** Login ke baad app khud pull/push karta hai; doosre device par change hone par Realtime se ~1.5 sec me sync hota hai.

### Step 6 — Internet par host (Vercel)

1. [vercel.com](https://vercel.com) → GitHub se `pama-suite` import
2. **Environment Variables** (Production):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Deploy → URL milega jaise `https://pama-suite.vercel.app`
4. Supabase → **Authentication** → **URL Configuration**:
   - Site URL = aapka Vercel URL
   - Redirect URLs me bhi wahi URL add karo

Ab desktop + mobile browser se **ek hi link** — login + sync.

---

## Part B: Mobile app

### Option 1 — PWA install (sabse aasaan, recommended)

Deploy ke baad phone par:

**Android (Chrome):**
1. Site kholo → neeche **Install App** banner aayega, ya
2. Menu ⋮ → **Install app** / **Add to Home screen**

**iPhone (Safari):**
1. Share ⎙ → **Add to Home Screen**

App home screen par icon ban jata hai — full screen, offline shell, auto-update jab Vercel par naya deploy ho. Top bar ka **Update** button sirf app shell refresh karta hai; Supabase login/local business data clear nahi hota.

Local test: `npm run build` → `npm run preview -- --host 0.0.0.0 --port 5180` → phone same WiFi par `http://PC-IP:5180`

### Option 2 — Android APK (Play Store ke liye)

Capacitor se native wrapper (optional):

**Requirements:** Android Studio installed

```powershell
cd c:\Users\saman\GIT\pama-suite
npm.cmd install
npm.cmd run build
npx cap add android
npm.cmd run cap:sync
npm.cmd run cap:android
```

Android Studio me **Run** → APK phone par install.

Play Store ke liye signed release bundle banani hogi (Android Studio → Generate Signed Bundle).

---

## Verify cloud sync

| Test | Expected |
|------|----------|
| Desktop par naya bill save + Sync | Supabase Table Editor me `invoices` row |
| Existing PC data phone par chahiye | PC: Full Push, Phone: Full Pull |
| Mobile par login + Full Pull/Sync | Wahi bill dikhe |
| Mobile par party add + Sync | Desktop par refresh/sync par dikhe |
| Offline mode | App chale; online aate hi Sync |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `Local only` header | `.env.local` keys check karo, dev server restart |
| Sign up fail / RLS error | migrations `001` se `007` order me dubara verify/run karo |
| Organization setup pending | migrations `003` se `007` order me run karo, phir Settings → Setup Organization |
| `item_stock_movements` / schema cache sync error | Supabase SQL Editor me `supabase/migrations/006_item_stock_movements.sql` run karo, phir Sync/Full Push dabao. Local pending rows dirty rahenge. |
| Sync 0 records | Pehle local data ho (Import JSON), phir Full Push |
| Phone par data kam dikhe | PC par Full Push, phone par Full Pull, phir Sync Status check karo |
| Realtime nahi | Supabase → Database → Publications → `supabase_realtime` me tables ON |
| iPhone install nahi | Safari use karo, Chrome iOS par PWA limited hai |

---

Pehle **Part A Step 1–5** karo — uske baad hi multi-device sync kaam karega. Mobile ke liye pehle **Vercel deploy + PWA install** try karo; APK baad me chahiye to Option 2.
