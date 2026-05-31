<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import PpModal from '@/components/PpModal.vue'
import { useFirmStore, type NewFirm } from '@/stores/firm'
import { useAuthStore } from '@/stores/auth'
import { isVercelDeploy } from '@/services/supabase'
import { useSettingsStore } from '@/stores/settings'
import { exportAll, downloadBackup, importBackup } from '@/services/backup'
import { runSync, runFullPullFromCloud, runFullPushToCloud } from '@/services/sync'
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

const blank = (): NewFirm => ({
  name: '', gst: '', addr: '', city: '', state: '05', pin: '', phone: '', email: '',
  bank_name: '', bank_acno: '', bank_ifsc: '',
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
  const data = await exportAll()
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
}

async function doFullPull() {
  if (auth.syncBlockReason) {
    alert(auth.syncBlockReason)
    return
  }
  if (!confirm('Cloud se SAARA data dubara download karein? Local changes overwrite ho sakte hain agar cloud naya hai.')) return
  syncMsg.value = 'Pulling all records…'
  syncMsg.value = await runFullPullFromCloud()
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
}

function saveGemini() {
  settings.saveGeminiKey(geminiInput.value.trim())
  alert('Gemini key saved')
}

onMounted(firmStore.load)
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
            <div class="text-xs text-slate-500">{{ f.gst || 'No GST' }} · {{ f.city || '—' }}</div>
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
          Signed in as {{ auth.user?.email }} — organization setup ho raha hai. Thodi der wait karein, ya dubara sign in karein.
        </span>
        <span v-else-if="auth.isConfigured">
          Cloud sync ke liye pehle <RouterLink to="/login" class="text-accent font-semibold">Sign in</RouterLink> karein.
          Sync button dabane par exact reason dikhega agar kuch missing ho.
        </span>
        <span v-else-if="isVercelDeploy()">
          Is Vercel site par Supabase keys set nahi hain. Vercel Dashboard → Settings → Environment Variables mein
          <code>VITE_SUPABASE_URL</code> aur <code>VITE_SUPABASE_ANON_KEY</code> add karein (Supabase Dashboard → Settings → API se),
          phir <strong>Redeploy</strong> karein — sirf env add karne se kaam nahi chalega, build dubara chahiye.
        </span>
        <span v-else>
          Local par Supabase keys chahiye: <code>.env.example</code> ko <code>.env.local</code> mein copy karein, keys bharein,
          phir <code>npm run dev</code> restart karein.
        </span>
      </p>
      <div class="flex flex-wrap gap-2">
        <button
          class="pp-btn pp-btn-primary"
          :class="{ 'opacity-60': !auth.canSync }"
          @click="doSync"
        >Sync Now</button>
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
