<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import PpModal from '@/components/PpModal.vue'
import { useFirmStore, type NewFirm } from '@/stores/firm'
import { useAuthStore } from '@/stores/auth'
import { getSupabaseConfig } from '@/services/supabase'
import { useSettingsStore } from '@/stores/settings'
import { exportAll, downloadBackup, importBackup } from '@/services/backup'
import { getSyncDiagnostics, runSync, runFullPullFromCloud, runFullPushToCloud } from '@/services/sync'
import { usePwaInstall } from '@/composables/usePwaInstall'
import type { Firm } from '@/types/models'

const firmStore = useFirmStore()
const auth = useAuthStore()
const settings = useSettingsStore()
const { canInstall, isStandalone, statusLabel, install, showInstallBanner } = usePwaInstall()
const showModal = ref(false)
const editingId = ref<string | null>(null)
const syncMsg = ref('')
const importMsg = ref('')
const geminiInput = ref(settings.geminiKey)
const supabaseUrlInput = ref('')
const supabaseAnonInput = ref('')
const supabaseKeyMsg = ref('')
const supabaseKeyOk = ref(false)
const includeSensitiveBackup = ref(false)
const syncDiag = ref(getSyncDiagnostics())

const blank = (): NewFirm => ({
  name: '', gst: '', addr: '', city: '', state: '05', pin: '', phone: '', email: '',
  bank_name: '', bank_acno: '', bank_ifsc: '',
  prefix: 'INV', next_bill_no: 1,
})
const form = reactive<NewFirm>(blank())

function openAdd() {
  editingId.value = null
  Object.assign(form, blank())
  showModal.value = true
}
function openEdit(f: Firm) {
  editingId.value = f.id
  Object.assign(form, {
    name: f.name, gst: f.gst, addr: f.addr, city: f.city, state: f.state, pin: f.pin,
    phone: f.phone, email: f.email, bank_name: f.bank_name, bank_acno: f.bank_acno, bank_ifsc: f.bank_ifsc,
    prefix: f.prefix || 'INV', next_bill_no: f.next_bill_no || 1,
  })
  showModal.value = true
}
async function save() {
  if (!form.name.trim()) return alert('Firm name required')
  if (editingId.value) await firmStore.update(editingId.value, { ...form })
  else await firmStore.add({ ...form })
  showModal.value = false
}

async function doExport() {
  if (includeSensitiveBackup.value && !confirm('Backup file me Gemini/Supabase API keys include honge. Is file ko private rakhein. Continue?')) return
  const data = await exportAll({ includeSensitiveSettings: includeSensitiveBackup.value })
  downloadBackup(data)
}

async function onImport(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const data = JSON.parse(await file.text())
    const mode = confirm('Replace ALL data? Cancel = merge with existing') ? 'replace' : 'merge'
    const { counts } = await importBackup(data, mode)
    importMsg.value = 'Imported: ' + Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(', ')
    await firmStore.load()
    location.reload()
  } catch (err: any) {
    importMsg.value = 'Import failed: ' + err.message
  }
  ;(e.target as HTMLInputElement).value = ''
}

async function doSync() {
  if (auth.syncBlockReason) {
    alert(auth.syncBlockReason)
    return
  }
  syncMsg.value = await runSync()
  refreshSyncDiag()
}

async function doFullPull() {
  if (auth.syncBlockReason) {
    alert(auth.syncBlockReason)
    return
  }
  if (!confirm('Cloud se SAARA data dubara download karein? Local changes overwrite ho sakte hain agar cloud naya hai.')) return
  syncMsg.value = 'Pulling all records…'
  syncMsg.value = await runFullPullFromCloud()
  refreshSyncDiag()
  await firmStore.load()
  location.reload()
}

async function doFullPush() {
  if (auth.syncBlockReason) {
    alert(auth.syncBlockReason)
    return
  }
  if (!confirm('Is device ka SAARA local data cloud par upload karein? (Import ke baad zaroori)')) return
  syncMsg.value = 'Pushing all records…'
  syncMsg.value = await runFullPushToCloud()
  refreshSyncDiag()
}

function saveGemini() {
  settings.saveGeminiKey(geminiInput.value.trim())
  alert('Gemini key saved')
}

async function saveSupabaseKeys() {
  supabaseKeyMsg.value = ''
  supabaseKeyOk.value = false
  const ok = await auth.applySupabaseKeys(supabaseUrlInput.value, supabaseAnonInput.value)
  if (ok) {
    supabaseKeyOk.value = true
    supabaseKeyMsg.value = 'Supabase connected! Ab Login karein, phir Sync dabayein.'
  } else {
    supabaseKeyMsg.value = auth.error || 'Save failed — URL aur anon key check karein'
  }
  refreshSyncDiag()
}

async function setupOrg() {
  syncMsg.value = 'Setting up organization…'
  const ok = await auth.ensureOrgSetup()
  syncMsg.value = ok ? 'Organization ready — ab Sync kar sakte hain.' : (auth.orgSetupError || auth.error || 'Setup failed')
  refreshSyncDiag()
}

function refreshSyncDiag() {
  syncDiag.value = getSyncDiagnostics()
}

function isMigration006SyncIssue(value: string) {
  return /item_stock_movements|006_item_stock_movements/i.test(value)
}

function fmtSyncTime(value: string) {
  if (!value) return 'Never'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

async function doSignOut() {
  await auth.signOut()
  refreshSyncDiag()
}

onMounted(() => {
  firmStore.load()
  const cfg = getSupabaseConfig()
  supabaseUrlInput.value = cfg.url
  supabaseAnonInput.value = cfg.anon
  refreshSyncDiag()
})
</script>

<template>
  <div class="p-6 max-w-4xl mx-auto">
    <header class="mb-5">
      <h1 class="text-2xl font-bold text-navy">Settings</h1>
      <p class="text-sm text-slate-500">Firms, backup, cloud sync &amp; AI</p>
    </header>

    <!-- Firms -->
    <section class="pp-card p-5 mb-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="font-bold text-navy">🏢 Firms / Companies</h2>
        <button class="pp-btn pp-btn-primary" @click="openAdd">+ Add Firm</button>
      </div>
      <div class="space-y-2">
        <div v-for="f in firmStore.firms" :key="f.id"
          :class="['flex items-center gap-3 p-3 rounded-lg border',
                   f.id === firmStore.activeFirmId ? 'border-accent bg-blue-50' : 'border-slate-200']">
          <div class="flex-1">
            <div class="font-semibold text-navy">{{ f.name }}
              <span v-if="f.id === firmStore.activeFirmId" class="pp-badge bg-accent text-white ml-1">Active</span>
            </div>
            <div class="text-xs text-slate-500">{{ f.gst || 'No GST' }} · {{ f.city || '—' }} · Bill: {{ f.prefix || 'INV' }}-xxxx (next {{ f.next_bill_no || 1 }})</div>
          </div>
          <button v-if="f.id !== firmStore.activeFirmId" class="pp-btn pp-btn-ghost !py-1.5" @click="firmStore.setActive(f.id)">Switch</button>
          <button class="pp-btn pp-btn-ghost !px-2 !py-1" @click="openEdit(f)">✏️</button>
        </div>
      </div>
    </section>

    <!-- Backup -->
    <section class="pp-card p-5 mb-5">
      <h2 class="font-bold text-navy mb-3">💾 Backup &amp; Import</h2>
      <p class="text-sm text-slate-500 mb-4">Export full suite JSON (including deleted records for restore) or import from PamaTools <code>pama_tools_live.json</code> / unified backup.</p>
      <label class="flex items-start gap-2 text-sm text-slate-600 mb-3">
        <input v-model="includeSensitiveBackup" type="checkbox" class="mt-1" />
        <span>Include saved API keys (Gemini + Supabase local config). Use only for private encrypted storage.</span>
      </label>
      <div class="flex flex-wrap gap-2">
        <button class="pp-btn pp-btn-primary" @click="doExport">Download Backup</button>
        <label class="pp-btn pp-btn-ghost cursor-pointer">
          Import JSON
          <input type="file" accept=".json" class="hidden" @change="onImport" />
        </label>
      </div>
      <p v-if="importMsg" class="text-sm mt-3 text-green-700">{{ importMsg }}</p>
    </section>

    <!-- PWA / Mobile App -->
    <section class="pp-card p-5 mb-5">
      <h2 class="font-bold text-navy mb-2">📱 Mobile App (PWA)</h2>
      <p class="text-sm text-slate-500 mb-3">
        Status: <strong>{{ statusLabel }}</strong>
      </p>
      <p class="text-xs text-slate-500 mb-4 leading-relaxed">
        PWA = ek link se phone par install, full-screen app jaisa, offline shell, auto-update jab Vercel par deploy ho.
        <strong>HTTPS</strong> par host hona chahiye (localhost ya Vercel).
      </p>
      <div class="flex flex-wrap gap-2">
        <button
          v-if="canInstall && !isStandalone"
          class="pp-btn pp-btn-primary"
          @click="install()"
        >
          Install App
        </button>
        <button
          v-if="!isStandalone"
          class="pp-btn pp-btn-ghost"
          @click="showInstallBanner()"
        >
          Show install help
        </button>
      </div>
      <ul class="text-xs text-slate-500 mt-4 space-y-1 list-disc pl-4">
        <li><strong>Android:</strong> Chrome → Install app / neeche banner</li>
        <li><strong>iPhone:</strong> Safari → Share ⎙ → Add to Home Screen</li>
        <li><strong>Desktop:</strong> Chrome address bar → Install icon</li>
      </ul>
    </section>

    <!-- Cloud -->
    <section class="pp-card p-5 mb-5">
      <h2 class="font-bold text-navy mb-2">☁️ Cloud Sync (Supabase)</h2>
      <p class="text-sm text-slate-500 mb-3">
        <span v-if="auth.canSync">Logged in as {{ auth.user?.email }} — sync pushes local changes to cloud.</span>
        <span v-else-if="auth.isConfigured && auth.isLoggedIn && !auth.orgId">
          Signed in as {{ auth.user?.email }} — organization setup ho raha hai. Thodi der wait karein.
        </span>
        <span v-else-if="auth.isConfigured">
          Supabase connected. Cloud sync ke liye <RouterLink to="/login" class="text-accent font-semibold">Sign in</RouterLink> karein.
        </span>
        <span v-else>
          Pehle neeche Supabase keys save karein (Vercel par bhi kaam karta hai — redeploy ki zaroorat nahi).
        </span>
      </p>

      <div v-if="!auth.isConfigured || !auth.canSync" class="mb-4 p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-3">
        <p class="text-xs text-slate-600">
          Supabase Dashboard → <strong>Settings → API</strong> se copy karein:
        </p>
        <p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 leading-relaxed">
          Mobile PWA me ye keys aur login session isi installed app ke storage me save hote hain. Agar app reinstall, browser data clear, ya nayi PWA install hui hai to keys dobara paste karke login karein.
        </p>
        <div>
          <label class="pp-label">Project URL</label>
          <input v-model="supabaseUrlInput" class="pp-input font-mono text-sm" placeholder="https://xxxxx.supabase.co" />
        </div>
        <div>
          <label class="pp-label">anon public key</label>
          <input v-model="supabaseAnonInput" type="password" class="pp-input font-mono text-sm" placeholder="eyJhbG..." />
        </div>
        <button type="button" class="pp-btn pp-btn-primary" @click="saveSupabaseKeys">Save &amp; Connect</button>
        <p v-if="supabaseKeyMsg" class="text-sm" :class="supabaseKeyOk ? 'text-green-700' : 'text-red-600'">{{ supabaseKeyMsg }}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          class="pp-btn pp-btn-primary"
          :class="{ 'opacity-60': !auth.canSync }"
          @click="doSync"
        >Sync Now</button>
        <button
          v-if="auth.isLoggedIn && !auth.canSync"
          class="pp-btn pp-btn-ghost"
          @click="setupOrg"
        >Setup Organization</button>
        <button
          class="pp-btn pp-btn-ghost"
          :class="{ 'opacity-60': !auth.canSync }"
          @click="doFullPull"
        >Full Pull from Cloud</button>
        <button
          class="pp-btn pp-btn-ghost"
          :class="{ 'opacity-60': !auth.canSync }"
          @click="doFullPush"
        >Full Push to Cloud</button>
        <button
          v-if="auth.isLoggedIn"
          class="pp-btn pp-btn-ghost"
          @click="doSignOut"
        >Sign Out</button>
      </div>
      <div class="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-semibold text-slate-700">Sync Status</h3>
          <button type="button" class="pp-btn pp-btn-ghost !py-1 !px-2 text-xs" @click="refreshSyncDiag">Refresh Status</button>
        </div>
        <div class="grid grid-cols-1 gap-2 text-xs text-slate-600 sm:grid-cols-2">
          <div><span class="font-semibold text-slate-500">Last sync:</span> {{ fmtSyncTime(syncDiag.lastSyncAt) }}</div>
          <div><span class="font-semibold text-slate-500">Last pull anchor:</span> {{ fmtSyncTime(syncDiag.lastPull) }}</div>
          <div class="sm:col-span-2"><span class="font-semibold text-slate-500">Result:</span> {{ syncDiag.lastSyncResult || 'No sync run on this device yet' }}</div>
          <div v-if="syncDiag.lastSyncError" class="sm:col-span-2 rounded border border-red-200 bg-white px-2 py-1 text-red-700">
            <span class="font-semibold">Last error:</span> {{ syncDiag.lastSyncError }}
            <p v-if="isMigration006SyncIssue(syncDiag.lastSyncError)" class="mt-1 text-xs text-red-600">
              Fix: Supabase SQL Editor me <code>supabase/migrations/006_item_stock_movements.sql</code> run karein. Local item stock movement rows dirty rahenge; migration ke baad Sync/Full Push dabayein.
            </p>
          </div>
        </div>
        <p class="mt-2 text-xs text-slate-500">
          Mobile me data missing ho to PC par Full Push, phir phone par Full Pull dabayein. Update button app shell refresh karta hai; login/local data clear nahi hota.
        </p>
      </div>
      <p class="text-xs text-slate-500 mt-3 leading-relaxed">
        Data kam dikhe? Pehle PC par <strong>Full Push</strong>, phir phone par <strong>Full Pull</strong>.
        Purana PamaTools data: <strong>Import JSON</strong> → OK (Replace) → phir <strong>Full Push</strong>.
      </p>
      <p v-if="syncMsg" class="text-sm mt-2 text-slate-600">{{ syncMsg }}</p>
    </section>

    <!-- Gemini -->
    <section class="pp-card p-5 mb-5">
      <h2 class="font-bold text-navy mb-2">🤖 AI Invoice Scanner (Gemini)</h2>
      <div class="flex gap-2 flex-wrap">
        <input v-model="geminiInput" type="password" class="pp-input flex-1 min-w-[200px]" placeholder="AIza..." />
        <button class="pp-btn pp-btn-primary" @click="saveGemini">Save Key</button>
      </div>
      <p class="text-xs text-slate-400 mt-2">Used in Purchases → Scan invoice. Key stays on this device only.</p>
    </section>

    <PpModal v-if="showModal" :title="editingId ? 'Edit Firm' : 'Add Firm'" @close="showModal = false">
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div><label class="pp-label">Bill Prefix</label><input v-model="form.prefix" class="pp-input uppercase" placeholder="INV" /></div>
          <div><label class="pp-label">Next Bill No.</label><input v-model.number="form.next_bill_no" type="number" min="1" class="pp-input" /></div>
        </div>
        <div><label class="pp-label">Firm Name *</label><input v-model="form.name" class="pp-input" /></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="pp-label">GSTIN</label><input v-model="form.gst" class="pp-input uppercase" /></div>
          <div><label class="pp-label">State code</label><input v-model="form.state" class="pp-input" /></div>
        </div>
        <div><label class="pp-label">Address</label><input v-model="form.addr" class="pp-input" /></div>
        <div class="grid grid-cols-3 gap-3">
          <div><label class="pp-label">City</label><input v-model="form.city" class="pp-input" /></div>
          <div><label class="pp-label">PIN</label><input v-model="form.pin" class="pp-input" /></div>
          <div><label class="pp-label">Phone</label><input v-model="form.phone" class="pp-input" /></div>
        </div>
        <div class="border-t border-slate-200 pt-3 grid grid-cols-3 gap-3">
          <div><label class="pp-label">Bank</label><input v-model="form.bank_name" class="pp-input" /></div>
          <div><label class="pp-label">A/c</label><input v-model="form.bank_acno" class="pp-input" /></div>
          <div><label class="pp-label">IFSC</label><input v-model="form.bank_ifsc" class="pp-input uppercase" /></div>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button class="pp-btn pp-btn-ghost" @click="showModal = false">Cancel</button>
          <button class="pp-btn pp-btn-primary" @click="save">Save</button>
        </div>
      </div>
    </PpModal>
  </div>
</template>
