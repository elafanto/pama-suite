<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import PpModal from '@/components/PpModal.vue'
import { useFirmStore, type NewFirm, type FirmLinkedCounts } from '@/stores/firm'
import { useAuthStore } from '@/stores/auth'
import { getSupabaseConfig } from '@/services/supabase'
import { useSettingsStore } from '@/stores/settings'
import { exportAll, downloadBackup, importBackup, previewImport, type ImportPreview, type ImportResult } from '@/services/backup'
import { getSyncDiagnostics, runSync, runFullPullFromCloud, runFullPushToCloud } from '@/services/sync'
import { usePwaInstall } from '@/composables/usePwaInstall'
import type { BillNoFormat, Firm } from '@/types/models'
import { peekBillNo, BILL_NO_FORMAT_OPTIONS } from '@/services/invoiceNumber'
import { formatGstin } from '@/services/gst'
import { getDocumentStorageStats } from '@/services/documentAttachments'
import { exportGstAuditZip, listRecentIndianFYLabels } from '@/services/documentAuditExport'

const firmStore = useFirmStore()
const auth = useAuthStore()
const settings = useSettingsStore()
const { canInstall, isStandalone, statusLabel, install, showInstallBanner } = usePwaInstall()
const showModal = ref(false)
const editingId = ref<string | null>(null)
const deleteTarget = ref<Firm | null>(null)
const deleteConfirmText = ref('')
const deleteLinked = ref<FirmLinkedCounts | null>(null)
const deleteBusy = ref(false)
const syncMsg = ref('')
const importMsg = ref('')
const geminiInput = ref(settings.geminiKey)
const supabaseUrlInput = ref('')
const supabaseAnonInput = ref('')
const supabaseKeyMsg = ref('')
const supabaseKeyOk = ref(false)
const includeSensitiveBackup = ref(false)
const syncDiag = ref(getSyncDiagnostics())
const docStats = ref({ attachmentCount: 0, localBytes: 0, pendingUploads: 0, shouldWarnMobile: false })
const fyOptions = listRecentIndianFYLabels(6)
const selectedFyLabel = ref(fyOptions[0].label)
const auditExportBusy = ref(false)
const auditExportMsg = ref('')

const MAX_SIGNATURE_BYTES = 512 * 1024

const blank = (): NewFirm => ({
  name: '', gst: '', addr: '', city: '', state: '05', pin: '', phone: '', email: '',
  bank_name: '', bank_acno: '', bank_ifsc: '',
  prefix: 'INV', next_bill_no: 1, bill_no_format: 'dash_4' as BillNoFormat,
  signature: undefined,
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
    bill_no_format: f.bill_no_format || 'dash_4',
    signature: f.signature || undefined,
  })
  showModal.value = true
}

function onSignatureFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!/^image\/(png|jpe?g)$/i.test(file.type)) {
    alert('Please choose a PNG or JPEG image.')
    input.value = ''
    return
  }
  if (file.size > MAX_SIGNATURE_BYTES) {
    alert(`Signature image must be under ${Math.round(MAX_SIGNATURE_BYTES / 1024)}KB.`)
    input.value = ''
    return
  }
  const reader = new FileReader()
  reader.onload = () => { form.signature = reader.result as string }
  reader.readAsDataURL(file)
  input.value = ''
}

function clearSignature() {
  form.signature = undefined
}

const billNoPreview = computed(() =>
  peekBillNo(
    { prefix: form.prefix, bill_no_format: form.bill_no_format, next_bill_no: form.next_bill_no, id: '' } as Firm,
    [],
  ),
)

const selectedBillFormatHint = computed(() =>
  BILL_NO_FORMAT_OPTIONS.find((o) => o.value === form.bill_no_format)?.hint || '',
)

async function save() {
  if (!form.name.trim()) return alert('Firm name required')
  const payload = { ...form, signature: form.signature || undefined }
  if (editingId.value) await firmStore.update(editingId.value, payload)
  else await firmStore.add(payload)
  showModal.value = false
}

const deleteConfirmed = computed(() => {
  const target = deleteTarget.value
  return !!target && deleteConfirmText.value.trim() === target.name
})

const deleteHasLinked = computed(() => {
  const c = deleteLinked.value
  if (!c) return false
  return c.parties > 0 || c.invoices > 0 || c.purchases > 0
})

const canDeleteFirm = computed(() => firmStore.firms.length > 1)

async function openDelete(f: Firm) {
  if (!canDeleteFirm.value) return
  deleteTarget.value = f
  deleteConfirmText.value = ''
  deleteLinked.value = await firmStore.linkedCounts(f.id)
}

function closeDelete() {
  deleteTarget.value = null
  deleteConfirmText.value = ''
  deleteLinked.value = null
}

async function confirmDelete() {
  if (!deleteTarget.value || !deleteConfirmed.value || deleteBusy.value) return
  deleteBusy.value = true
  try {
    const result = await firmStore.remove(deleteTarget.value.id)
    if (!result.ok) {
      if (result.error === 'last_firm') alert('Cannot delete the last remaining firm.')
      else alert('Firm not found.')
      closeDelete()
      return
    }
    closeDelete()
  } finally {
    deleteBusy.value = false
  }
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
    const preview = await previewImport(data)
    if (!preview.supported) throw new Error(preview.warnings[0] || 'Unknown backup format')
    if (!confirm(`${formatImportPreview(preview)}\n\nContinue with import?`)) return

    const mode = confirm('Choose import mode:\n\nOK = Replace ALL local data with this backup.\nCancel = Merge newer records only.') ? 'replace' : 'merge'
    if (mode === 'replace' && !confirm('Final confirm: replace will clear local app data before restoring this backup. Continue?')) return

    const allowSensitiveSettings = preview.hasSensitiveSettings
      ? confirm('This backup contains saved Gemini/Supabase keys. Overwrite saved keys on this device?\n\nCancel keeps current keys and imports the rest.')
      : false

    const result = await importBackup(data, mode, { allowSensitiveSettings })
    importMsg.value = formatImportResult(result)
    await firmStore.load()
    location.reload()
  } catch (err: any) {
    importMsg.value = 'Import failed: ' + err.message
  } finally {
    ;(e.target as HTMLInputElement).value = ''
  }
}

function formatImportPreview(preview: ImportPreview) {
  const lines = [
    `Backup format: ${preview.format}`,
    preview.version ? `Version: ${preview.version}` : '',
    preview.exportedAt ? `Exported: ${fmtSyncTime(preview.exportedAt)}` : '',
    `Records: ${formatCounts(preview.counts) || 'none'}`,
  ].filter(Boolean)

  if (preview.warnings.length) {
    lines.push('', 'Warnings:', ...preview.warnings.map((w) => `- ${w}`))
  }
  return lines.join('\n')
}

function formatImportResult(result: ImportResult) {
  const parts = [`Imported: ${formatCounts(result.counts) || 'none'}`]
  const skipped = formatCounts(result.skipped || {})
  if (skipped) parts.push(`Skipped older/equal: ${skipped}`)
  if (result.skippedSensitiveSettings) parts.push('API keys were not overwritten.')
  return parts.join(' | ')
}

function formatCounts(counts: Record<string, number>) {
  return Object.entries(counts)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `${key}:${value}`)
    .join(', ')
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

function isOptionalMigrationSyncIssue(value: string) {
  return /reel_stocks|production_jobs|production_stages|stock_movements|005_production_tracking|item_stock_movements|006_item_stock_movements/i.test(value)
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

function formatDocBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function refreshDocStats() {
  docStats.value = await getDocumentStorageStats()
}

async function doGstAuditExport() {
  auditExportBusy.value = true
  auditExportMsg.value = ''
  try {
    const fy = fyOptions.find((f) => f.label === selectedFyLabel.value) || fyOptions[0]
    const result = await exportGstAuditZip({
      firmId: firmStore.activeFirmId,
      fy,
    })
    auditExportMsg.value = result.ok
      ? `ZIP download ho gaya (${result.fileCount} files, party + month folders).`
      : (result.error || 'Export failed')
  } finally {
    auditExportBusy.value = false
  }
}

onMounted(async () => {
  await firmStore.load()
  const cfg = getSupabaseConfig()
  supabaseUrlInput.value = cfg.url
  supabaseAnonInput.value = cfg.anon
  refreshSyncDiag()
  await refreshDocStats()
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
        <div class="flex gap-2">
          <RouterLink to="/recycle-bin" class="pp-btn pp-btn-ghost">Recycle Bin</RouterLink>
          <button class="pp-btn pp-btn-primary" @click="openAdd">+ Add Firm</button>
        </div>
      </div>
      <p v-if="!canDeleteFirm" class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
        At least one firm must remain. Add another firm before deleting this one.
      </p>
      <div class="space-y-2">
        <div v-for="f in firmStore.firms" :key="f.id"
          :class="['flex items-center gap-3 p-3 rounded-lg border',
                   f.id === firmStore.activeFirmId ? 'border-accent bg-blue-50' : 'border-slate-200']">
          <div class="flex-1">
            <div class="font-semibold text-navy">{{ f.name }}
              <span v-if="f.id === firmStore.activeFirmId" class="pp-badge bg-accent text-white ml-1">Active</span>
            </div>
            <div class="text-xs text-slate-500">
              {{ formatGstin(f.gst) || 'No GST' }} · {{ f.city || '—' }} · Bill: {{ peekBillNo(f, []) }} (next {{ f.next_bill_no || 1 }})
              <span v-if="f.signature" class="ml-1 text-green-700">· ✍️ Signature</span>
            </div>
          </div>
          <button v-if="f.id !== firmStore.activeFirmId" class="pp-btn pp-btn-ghost !py-1.5" @click="firmStore.setActive(f.id)">Switch</button>
          <button class="pp-btn pp-btn-ghost !px-2 !py-1" @click="openEdit(f)">✏️</button>
          <button
            v-if="canDeleteFirm"
            class="pp-btn pp-btn-danger !px-2 !py-1"
            title="Move firm to Recycle Bin"
            @click="openDelete(f)"
          >🗑️</button>
        </div>
      </div>
    </section>

    <!-- Backup -->
    <section class="pp-card p-5 mb-5">
      <h2 class="font-bold text-navy mb-3">💾 Backup &amp; Import</h2>
      <p class="text-sm text-slate-500 mb-4">Export full suite JSON (including deleted records for restore) or import from PamaTools <code>pama_tools_live.json</code> / unified backup.</p>
      <p class="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-2">
        ✍️ Firm signatures <strong>hamesha backup me included</strong> hain (<code>firmSignatures</code> + archive), API keys checkbox se independent.
      </p>
      <p class="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4">
        💰 Payroll (<code>staff</code>, <code>staff_advances</code>, <code>payroll_runs</code> + attendance) <strong>hamesha JSON backup me</strong> — top-level arrays + <code>settings.payrollBackup</code> duplicate.
      </p>
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
      <p class="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-2">
        ✍️ Firm signatures <strong>online bhi backup</strong> hote hain — Sync Now par Supabase <code>org_settings</code> me save (migration <code>010</code>).
      </p>
      <p class="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3">
        💰 Payroll staff + attendance + salary <strong>cloud sync</strong> — tables <code>staff</code>, <code>staff_advances</code>, <code>payroll_runs</code> (migration <code>011</code>) + extra snapshot <code>org_settings.payroll_backup</code> (migration <code>012</code>). Har save / Sync Now par backup.
      </p>
      <p class="text-xs text-sky-900 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 mb-3">
        🔄 <strong>Auto sync (sab modules):</strong> save ke ~3 second baad cloud push;
        har 30 second pe background sync; dusre device se change ~1.5s me pull.
        Manual <strong>Sync Now</strong> abhi bhi turant chalega.
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
            <p v-if="isOptionalMigrationSyncIssue(syncDiag.lastSyncError)" class="mt-1 text-xs text-red-600">
              Fix: Supabase SQL Editor me missing <code>supabase/migrations/005_production_tracking.sql</code> ya <code>supabase/migrations/006_item_stock_movements.sql</code> run karein. Local pending rows dirty rahenge; migration ke baad Sync/Full Push dabayein.
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

    <!-- Bill documents -->
    <section class="pp-card p-5 mb-5">
      <h2 class="font-bold text-navy mb-2">📎 Bill Documents (Purchases &amp; Vouchers)</h2>
      <p class="text-sm text-slate-500 mb-3">
        Upload par auto-compress, rename, Supabase cloud sync. <code>original_name</code> audit trail me save hota hai.
      </p>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div class="bg-slate-50 rounded-lg p-3 text-center">
          <div class="text-xs text-slate-500">Saved files</div>
          <div class="text-xl font-bold">{{ docStats.attachmentCount }}</div>
        </div>
        <div class="bg-slate-50 rounded-lg p-3 text-center">
          <div class="text-xs text-slate-500">Phone cache</div>
          <div class="text-xl font-bold">{{ formatDocBytes(docStats.localBytes) }}</div>
        </div>
        <div class="bg-slate-50 rounded-lg p-3 text-center">
          <div class="text-xs text-slate-500">Pending upload</div>
          <div class="text-xl font-bold">{{ docStats.pendingUploads }}</div>
        </div>
        <div class="bg-slate-50 rounded-lg p-3 text-center">
          <div class="text-xs text-slate-500">Max / file</div>
          <div class="text-xl font-bold">10 MB</div>
        </div>
      </div>
      <p v-if="docStats.shouldWarnMobile" class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mb-3">
        Phone par document cache 80 MB+ ho gaya. Purane bills ka GST ZIP export karke space manage karein.
      </p>
      <div class="flex flex-wrap items-end gap-2">
        <div>
          <label class="pp-label">GST Audit Pack (CA)</label>
          <select v-model="selectedFyLabel" class="pp-input min-w-[10rem]">
            <option v-for="fy in fyOptions" :key="fy.label" :value="fy.label">{{ fy.label }} (Apr–Mar)</option>
          </select>
        </div>
        <button class="pp-btn pp-btn-primary" :disabled="auditExportBusy" @click="doGstAuditExport">
          {{ auditExportBusy ? 'Building ZIP…' : 'Export FY ZIP' }}
        </button>
        <button type="button" class="pp-btn pp-btn-ghost" @click="refreshDocStats">Refresh</button>
      </div>
      <p v-if="auditExportMsg" class="text-sm mt-2" :class="auditExportMsg.includes('ho gaya') ? 'text-green-700' : 'text-slate-600'">{{ auditExportMsg }}</p>
      <p class="text-xs text-slate-400 mt-2">ZIP layout: Purchases/Vouchers → Party → YYYY-MM → renamed file + manifest.csv (original filename included).</p>
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
        <div>
          <label class="pp-label">Invoice Number Format</label>
          <select v-model="form.bill_no_format" class="pp-input">
            <option v-for="opt in BILL_NO_FORMAT_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
          <p class="text-xs text-slate-500 mt-1">Preview: <span class="font-semibold text-navy">{{ billNoPreview || '—' }}</span></p>
          <p v-if="selectedBillFormatHint" class="text-xs text-slate-400 mt-1">{{ selectedBillFormatHint }}</p>
          <p v-if="form.bill_no_format === 'fy_slash_4'" class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-2">
            Har April (naye financial year) se <strong>Next Bill No.</strong> ko 1 set karein.
          </p>
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
          <div><label class="pp-label-account">Bank</label><input v-model="form.bank_name" class="pp-input-account" /></div>
          <div><label class="pp-label-account">A/c</label><input v-model="form.bank_acno" class="pp-input-account" /></div>
          <div><label class="pp-label-account">IFSC</label><input v-model="form.bank_ifsc" class="pp-input-account uppercase" /></div>
        </div>
        <div class="border-t border-slate-200 pt-3">
          <label class="pp-label">Authorised Signature (PNG/JPEG, max 512KB)</label>
          <div class="flex flex-wrap items-center gap-3 mt-1">
            <label class="pp-btn pp-btn-ghost cursor-pointer !py-1.5">
              Choose image
              <input type="file" accept="image/png,image/jpeg,image/jpg" class="hidden" @change="onSignatureFile" />
            </label>
            <button v-if="form.signature" type="button" class="pp-btn pp-btn-danger !py-1.5" @click="clearSignature">Remove</button>
            <div class="flex items-center justify-center min-w-[120px] min-h-[44px] rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2">
              <img v-if="form.signature" :src="form.signature" alt="Signature preview" class="max-h-12 max-w-[140px] object-contain" />
              <span v-else class="text-xs text-slate-400">No signature</span>
            </div>
          </div>
          <p class="text-xs text-slate-400 mt-1">Transparent PNG recommended. Used on invoice PDF and bill preview.</p>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button class="pp-btn pp-btn-ghost" @click="showModal = false">Cancel</button>
          <button class="pp-btn pp-btn-primary" @click="save">Save</button>
        </div>
      </div>
    </PpModal>

    <PpModal
      v-if="deleteTarget"
      title="Delete Firm?"
      @close="closeDelete"
    >
      <div class="space-y-4">
        <div class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p class="font-semibold">This will move the firm to Recycle Bin, not permanently delete it.</p>
          <p class="mt-1">Bills, parties, purchases and other data stay linked to this firm. Restore the firm from Recycle Bin anytime.</p>
          <p v-if="deleteTarget.id === firmStore.activeFirmId" class="mt-2 font-semibold">
            This is your active firm — after delete, another firm will become active automatically.
          </p>
          <RouterLink to="/recycle-bin" class="mt-2 inline-flex font-semibold text-red-800 underline" @click="closeDelete">
            Open Recycle Bin
          </RouterLink>
        </div>

        <div v-if="deleteHasLinked" class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p class="font-semibold">This firm has linked records:</p>
          <ul class="mt-1 list-disc pl-4">
            <li v-if="deleteLinked!.parties">{{ deleteLinked!.parties }} parties</li>
            <li v-if="deleteLinked!.invoices">{{ deleteLinked!.invoices }} invoices / bills</li>
            <li v-if="deleteLinked!.purchases">{{ deleteLinked!.purchases }} purchases</li>
          </ul>
          <p class="mt-1">Data is kept — only the firm is hidden until restored.</p>
        </div>

        <div>
          <label class="pp-label">Type firm name: <span class="font-semibold">{{ deleteTarget.name }}</span></label>
          <input
            v-model="deleteConfirmText"
            class="pp-input"
            autocomplete="off"
            :placeholder="deleteTarget.name"
          />
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button class="pp-btn pp-btn-ghost" @click="closeDelete">Cancel</button>
          <button
            class="pp-btn pp-btn-danger"
            :disabled="!deleteConfirmed || deleteBusy"
            :class="{ 'opacity-50': !deleteConfirmed || deleteBusy }"
            @click="confirmDelete"
          >
            {{ deleteBusy ? 'Deleting…' : 'Move to Recycle Bin' }}
          </button>
        </div>
      </div>
    </PpModal>
  </div>
</template>
