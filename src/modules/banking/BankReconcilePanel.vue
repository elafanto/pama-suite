<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useFirmStore } from '@/stores/firm'
import { usePartyStore } from '@/stores/parties'
import { useInvoiceStore } from '@/stores/invoices'
import { usePurchaseStore } from '@/stores/purchases'
import { useSettingsStore } from '@/stores/settings'
import {
  parseBankStatementFile,
  previewBankStatementFile,
  type BankColumnMapping,
  type BankSheetPreview,
} from '@/services/bankStatementParse'
import {
  buildBankMatchSuggestions,
  loadDoneFingerprints,
  matchKindLabel,
  saveDoneFingerprints,
  type BankMatchSuggestion,
} from '@/services/bankStatementMatch'
import { geminiEnhanceBankMatches } from '@/services/bankStatementGemini'

const firmStore = useFirmStore()
const partyStore = usePartyStore()
const invoiceStore = useInvoiceStore()
const purchaseStore = usePurchaseStore()
const settingsStore = useSettingsStore()

const step = ref<'upload' | 'map' | 'review'>('upload')
const file = ref<File | null>(null)
const preview = ref<BankSheetPreview | null>(null)
const mapping = ref<BankColumnMapping>({ date: '', amount: '' })
const suggestions = ref<BankMatchSuggestion[]>([])
const busy = ref(false)
const filter = ref<'all' | 'open' | 'matched' | 'ignored'>('open')
const statusMsg = ref('')
const useGemini = ref(true)

onMounted(async () => {
  await Promise.all([partyStore.load(), invoiceStore.load(), purchaseStore.load()])
})

const visibleRows = computed(() => {
  return suggestions.value.filter((row) => {
    if (filter.value === 'ignored') return row.ignored || row.alreadyDone
    if (filter.value === 'matched') return !row.ignored && !row.alreadyDone && row.selectedIds.length > 0
    if (filter.value === 'open') return !row.ignored && !row.alreadyDone
    return true
  })
})

const confirmableCount = computed(() =>
  suggestions.value.filter((r) => !r.ignored && !r.alreadyDone && r.selectedIds.length > 0).length,
)

function n2(n: number) {
  return (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

async function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f) return
  busy.value = true
  statusMsg.value = ''
  try {
    file.value = f
    preview.value = await previewBankStatementFile(f)
    mapping.value = { ...preview.value.suggestedMapping }
    step.value = 'map'
  } catch (err: any) {
    alert(err?.message || 'File read fail')
  } finally {
    busy.value = false
  }
}

const hasGeminiKey = computed(() => !!settingsStore.geminiKey?.trim())

async function runMatch() {
  if (!file.value) return
  busy.value = true
  try {
    const lines = await parseBankStatementFile(file.value, mapping.value)
    const done = loadDoneFingerprints(firmStore.activeFirmId)
    const firmInvoices = invoiceStore.list.filter((i) => i.firm_id === firmStore.activeFirmId)
    const firmPurchases = purchaseStore.list.filter((p) => p.firm_id === firmStore.activeFirmId)
    const firmParties = partyStore.list.filter((p) => p.firm_id === firmStore.activeFirmId)

    let result = buildBankMatchSuggestions({
      lines,
      invoices: firmInvoices,
      purchases: firmPurchases,
      parties: firmParties,
      doneFingerprints: done,
    })

    if (useGemini.value && hasGeminiKey.value) {
      statusMsg.value = 'Rule match done — Gemini se refine ho raha hai…'
      result = await geminiEnhanceBankMatches({
        apiKey: settingsStore.geminiKey,
        suggestions: result,
        invoices: firmInvoices,
        purchases: firmPurchases,
        parties: firmParties,
        onProgress: (msg) => { statusMsg.value = msg },
      })
    } else if (useGemini.value && !hasGeminiKey.value) {
      statusMsg.value = 'Gemini key nahi — Settings me save karo (rule-based match only)'
    }

    suggestions.value = result
    step.value = 'review'
    const aiCount = result.filter((r) => r.geminiEnhanced).length
    statusMsg.value = useGemini.value && hasGeminiKey.value
      ? `${lines.length} lines · Gemini refined ${aiCount}`
      : `${lines.length} bank lines loaded`
  } catch (err: any) {
    alert(err?.message || 'Parse / match fail')
  } finally {
    busy.value = false
  }
}

function toggleIgnore(row: BankMatchSuggestion) {
  row.ignored = !row.ignored
  if (row.ignored) row.selectedIds = []
}

function toggleCandidate(row: BankMatchSuggestion, id: string) {
  if (row.selectedIds.includes(id)) {
    row.selectedIds = row.selectedIds.filter((x) => x !== id)
  } else {
    row.selectedIds = [...row.selectedIds, id]
  }
}

async function confirmSelected() {
  const rows = suggestions.value.filter((r) => !r.ignored && !r.alreadyDone && r.selectedIds.length > 0)
  if (!rows.length) return alert('Koi selected match nahi')
  const ok = confirm(`${rows.length} bank line(s) confirm karke payment post karein?`)
  if (!ok) return
  busy.value = true
  let okCount = 0
  const doneKeys: string[] = []
  try {
    for (const row of rows) {
      const amount = row.line.amount
      const date = row.line.date
      const note = `Bank reconcile · ${row.matchKind} · ${row.line.narration || row.line.utr || 'statement'}`.slice(0, 180)
      // Oldest selected first so FIFO spill starts from earliest bill
      const orderedIds = [...row.selectedIds].sort((a, b) => {
        const ca = row.candidates.find((c) => c.id === a)
        const cb = row.candidates.find((c) => c.id === b)
        return (ca?.date || '').localeCompare(cb?.date || '') || a.localeCompare(b)
      })
      const primaryId = orderedIds[0]
      const primary = row.candidates.find((c) => c.id === primaryId)
      if (!primary) continue
      if (primary.kind === 'purchase') {
        await purchaseStore.recordPayment(primaryId, amount, false, note, date, undefined, orderedIds)
      } else {
        await invoiceStore.recordPayment(primaryId, amount, false, note, date, orderedIds)
      }
      row.alreadyDone = true
      row.selectedIds = []
      doneKeys.push(row.lineKey)
      okCount++
    }
    saveDoneFingerprints(firmStore.activeFirmId, doneKeys)
    statusMsg.value = `${okCount} payment(s) posted`
    await Promise.all([invoiceStore.load(), purchaseStore.load()])
  } catch (err: any) {
    alert(err?.message || 'Confirm fail')
  } finally {
    busy.value = false
  }
}

function resetAll() {
  step.value = 'upload'
  file.value = null
  preview.value = null
  suggestions.value = []
  statusMsg.value = ''
}
</script>

<template>
  <div class="space-y-4">
    <div class="pp-card p-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="font-semibold text-navy">Bank Statement Reconcile</h2>
        <p class="text-xs text-slate-500">CSV / Excel upload → auto-match purchases (debit) &amp; sales (credit) → human confirm.</p>
      </div>
      <div class="flex gap-2">
        <button v-if="step !== 'upload'" type="button" class="pp-btn pp-btn-ghost !py-1.5 text-xs" @click="resetAll">New file</button>
      </div>
    </div>

    <div v-if="step === 'upload'" class="pp-card p-6 space-y-3">
      <label class="pp-label">Upload bank statement (CSV / XLSX)</label>
      <input type="file" accept=".csv,.xlsx,.xls" class="pp-input" :disabled="busy" @change="onFilePicked" />
        <p class="text-xs text-slate-500">Pehli sheet use hogi. Column mapping next step me confirm karna.</p>
        <p v-if="hasGeminiKey" class="text-xs text-teal-700">Gemini key saved — smart match available after column map.</p>
        <p v-else class="text-xs text-amber-700">Settings → Gemini key save karo for AI-assisted bill matching.</p>
    </div>

    <div v-else-if="step === 'map' && preview" class="pp-card p-6 space-y-4">
      <div class="text-sm text-slate-600">
        Sheet: <b>{{ preview.sheetName }}</b> · File: {{ file?.name }}
        <span class="block text-xs text-slate-500 mt-1">
          Header row {{ preview.headerRowIndex + 1 }} detect hui ·
          <b>{{ preview.totalDataRows }}</b> data rows (neeche sirf preview ke 8 rows)
        </span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label class="pp-label">Date *</label>
          <select v-model="mapping.date" class="pp-input">
            <option value="">—</option>
            <option v-for="h in preview.headers" :key="h" :value="h">{{ h }}</option>
          </select>
        </div>
        <div>
          <label class="pp-label">Amount (single col)</label>
          <select v-model="mapping.amount" class="pp-input">
            <option value="">—</option>
            <option v-for="h in preview.headers" :key="h" :value="h">{{ h }}</option>
          </select>
        </div>
        <div>
          <label class="pp-label">Debit amount col</label>
          <select v-model="mapping.debitAmount" class="pp-input">
            <option value="">—</option>
            <option v-for="h in preview.headers" :key="h" :value="h">{{ h }}</option>
          </select>
        </div>
        <div>
          <label class="pp-label">Credit amount col</label>
          <select v-model="mapping.creditAmount" class="pp-input">
            <option value="">—</option>
            <option v-for="h in preview.headers" :key="h" :value="h">{{ h }}</option>
          </select>
        </div>
        <div>
          <label class="pp-label">Dr/Cr type col</label>
          <select v-model="mapping.side" class="pp-input">
            <option value="">—</option>
            <option v-for="h in preview.headers" :key="h" :value="h">{{ h }}</option>
          </select>
        </div>
        <div>
          <label class="pp-label">Narration</label>
          <select v-model="mapping.narration" class="pp-input">
            <option value="">—</option>
            <option v-for="h in preview.headers" :key="h" :value="h">{{ h }}</option>
          </select>
        </div>
        <div>
          <label class="pp-label">UTR / Ref</label>
          <select v-model="mapping.utr" class="pp-input">
            <option value="">—</option>
            <option v-for="h in preview.headers" :key="h" :value="h">{{ h }}</option>
          </select>
        </div>
        <div>
          <label class="pp-label">Party hint</label>
          <select v-model="mapping.partyHint" class="pp-input">
            <option value="">—</option>
            <option v-for="h in preview.headers" :key="h" :value="h">{{ h }}</option>
          </select>
        </div>
      </div>
      <div class="overflow-x-auto border rounded">
        <table class="w-full text-xs">
          <thead class="bg-slate-50">
            <tr>
              <th v-for="h in preview.headers" :key="h" class="p-2 text-left whitespace-nowrap">{{ h }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in preview.rows" :key="i" class="border-t">
              <td v-for="h in preview.headers" :key="h" class="p-2 whitespace-nowrap">{{ row[h] }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <label class="flex items-center gap-2 text-sm text-slate-600">
        <input v-model="useGemini" type="checkbox" class="rounded" :disabled="!hasGeminiKey" />
        <span>🤖 Gemini: party name + bill match (narration se party pehle)</span>
      </label>
      <button type="button" class="pp-btn pp-btn-primary" :disabled="busy" @click="runMatch">
        {{ busy ? 'Matching…' : 'Parse &amp; Match' }}
      </button>
    </div>

    <div v-else-if="step === 'review'" class="space-y-4">
      <div class="pp-card p-4 flex flex-wrap items-center gap-3">
        <select v-model="filter" class="pp-input max-w-[180px]">
          <option value="open">Open lines</option>
          <option value="matched">Selected</option>
          <option value="ignored">Ignored / done</option>
          <option value="all">All</option>
        </select>
        <span class="text-sm text-slate-500">{{ statusMsg }}</span>
        <button
          type="button"
          class="pp-btn pp-btn-primary ml-auto"
          :disabled="busy || !confirmableCount"
          :class="{ 'opacity-50': busy || !confirmableCount }"
          @click="confirmSelected"
        >
          Confirm {{ confirmableCount }} payment(s)
        </button>
      </div>

      <div class="pp-card overflow-x-auto">
        <table class="w-full text-sm min-w-[900px]">
          <thead class="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th class="p-3 text-left">Bank</th>
              <th class="p-3 text-right">Amount</th>
              <th class="p-3 text-left">Narration</th>
              <th class="p-3 text-left">Suggested bills</th>
              <th class="p-3 text-center">Type</th>
              <th class="p-3 text-center">Conf.</th>
              <th class="p-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody class="divide-y">
            <tr v-for="row in visibleRows" :key="row.lineKey" :class="row.alreadyDone || row.ignored ? 'bg-slate-50 opacity-70' : ''">
              <td class="p-3 whitespace-nowrap">
                <div class="font-mono text-xs">{{ row.line.date }}</div>
                <div class="text-[11px] uppercase" :class="row.line.side === 'debit' ? 'text-orange-600' : 'text-emerald-600'">
                  {{ row.line.side }}
                </div>
              </td>
              <td class="p-3 text-right font-mono font-semibold">₹{{ n2(row.line.amount) }}</td>
              <td class="p-3 text-xs text-slate-600 max-w-[16rem]">
                <div class="truncate" :title="row.line.narration">{{ row.line.narration || '—' }}</div>
                <div v-if="row.line.utr" class="font-mono text-[10px] text-slate-400">{{ row.line.utr }}</div>
                <div v-if="row.geminiPartyName" class="text-[10px] font-semibold text-indigo-700 mt-1">
                  Party: {{ row.geminiPartyName }}
                </div>
                <div v-if="row.geminiReason" class="text-[10px] text-teal-700 mt-0.5">{{ row.geminiReason }}</div>
              </td>
              <td class="p-3">
                <div v-if="row.alreadyDone" class="text-xs text-emerald-700">Already reconciled</div>
                <div v-else-if="row.matchKind === 'advance'" class="text-xs text-violet-700">Advance — bill pe auto-match nahi</div>
                <div v-else-if="!row.candidates.length" class="text-xs text-slate-400">No match</div>
                <label
                  v-for="c in row.candidates"
                  :key="c.id"
                  class="flex items-start gap-2 text-xs py-1 border-t first:border-0"
                >
                  <input
                    type="checkbox"
                    class="mt-0.5"
                    :checked="row.selectedIds.includes(c.id)"
                    :disabled="row.ignored || row.alreadyDone"
                    @change="toggleCandidate(row, c.id)"
                  />
                  <span>
                    <span class="font-semibold">{{ c.refNo }}</span>
                    · {{ c.partyName }}
                    · {{ c.date }}
                    · out ₹{{ n2(c.outstanding) }}
                    <span class="text-slate-400">(score {{ c.score }})</span>
                  </span>
                </label>
              </td>
              <td class="p-3 text-center">
                <span
                  class="pp-badge text-[10px]"
                  :class="{
                    'bg-emerald-100 text-emerald-800': row.matchKind === 'exact',
                    'bg-sky-100 text-sky-800': row.matchKind === 'partial',
                    'bg-amber-100 text-amber-900': row.matchKind === 'lump',
                    'bg-violet-100 text-violet-800': row.matchKind === 'advance',
                    'bg-slate-100 text-slate-600': row.matchKind === 'unmatched',
                  }"
                >{{ matchKindLabel(row.matchKind) }}</span>
                <span v-if="row.geminiEnhanced" class="pp-badge text-[10px] bg-teal-100 text-teal-800 ml-1" :title="row.geminiReason">AI</span>
              </td>
              <td class="p-3 text-center">
                <span
                  class="pp-badge text-[10px]"
                  :class="{
                    'bg-emerald-100 text-emerald-800': row.confidence === 'high',
                    'bg-amber-100 text-amber-800': row.confidence === 'medium',
                    'bg-slate-100 text-slate-600': row.confidence === 'low' || row.confidence === 'none',
                  }"
                >{{ row.confidence }}</span>
              </td>
              <td class="p-3 text-right">
                <button
                  v-if="!row.alreadyDone"
                  type="button"
                  class="pp-btn pp-btn-ghost !py-1 !px-2 text-xs"
                  @click="toggleIgnore(row)"
                >
                  {{ row.ignored ? 'Unignore' : 'Ignore' }}
                </button>
              </td>
            </tr>
            <tr v-if="!visibleRows.length">
              <td colspan="7" class="p-8 text-center text-slate-400">Is filter me koi line nahi.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
