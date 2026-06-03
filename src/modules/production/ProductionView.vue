<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useFirmStore } from '@/stores/firm'
import { usePartyStore } from '@/stores/parties'
import { useItemStore } from '@/stores/items'
import { useProductionStore } from '@/stores/production'
import { normalizePaperType, productionBalance, REEL_LOW_STOCK_KG, reelInventorySummary, STAGE_LABELS, STOCK_LABELS } from '@/services/production'
import type { PaperType, ProductionStage, ProductionStockType, ReelStock } from '@/types/models'

const firmStore = useFirmStore()
const partyStore = usePartyStore()
const itemStore = useItemStore()
const production = useProductionStore()
const route = useRoute()

type ProductionTab = 'jobs' | 'reels' | 'daily' | 'consumables' | 'reports'

const activeTab = ref<ProductionTab>(route.path === '/paper-reels' ? 'reels' : 'daily')
const selectedJobId = ref('')
const tabItems: { id: ProductionTab; label: string }[] = [
  { id: 'daily', label: 'Daily Entry' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'reels', label: 'Paper Reels' },
  { id: 'consumables', label: 'Consumables' },
  { id: 'reports', label: 'Reports' },
]
const consumableTypes: ProductionStockType[] = ['glue', 'ink', 'stitching_wire']
const paperTypes: PaperType[] = ['KRAFT', 'DUPLEX']

const jobForm = reactive({
  date: new Date().toISOString().slice(0, 10),
  customer_name: '',
  customer_id: null as string | null,
  job_no: '',
  item_id: null as string | null,
  box_name: '',
  box_size: '',
  target_qty: 0,
  notes: '',
})

const stageForm = reactive({
  date: new Date().toISOString().slice(0, 10),
  job_id: '',
  stage: 'corrugation' as ProductionStage,
  input_stock_type: 'raw_reel' as ProductionStockType,
  input_ref_id: '',
  input_qty: 0,
  input_weight: 0,
  output_stock_type: '2ply' as ProductionStockType,
  output_qty: 0,
  output_weight: 0,
  waste_qty: 0,
  waste_weight: 0,
  notes: '',
})

const consumableForm = reactive({
  date: new Date().toISOString().slice(0, 10),
  stock_type: 'glue' as ProductionStockType,
  mode: 'add' as 'add' | 'consume',
  qty: 0,
  weight: 0,
  notes: '',
})

const reelConsumptionForm = reactive({
  date: new Date().toISOString().slice(0, 10),
  reel_id: '',
  used_weight: 0,
  job_id: '',
  reason: 'Plant consumption',
  notes: '',
})

const reelFilters = reactive({
  paper_type: '',
  gsm: '',
  bf: '',
  deckle: '',
  color: '',
  status: 'all',
})

const reportFilters = reactive({
  from: '',
  to: '',
  job_id: '',
})

const stagePairs: Record<ProductionStage, { input: ProductionStockType; output: ProductionStockType }> = {
  corrugation: { input: 'raw_reel', output: '2ply' },
  paper_cutting: { input: '2ply', output: 'cut_sheet' },
  pasting: { input: 'cut_sheet', output: 'pasted_sheet' },
  thin_blade: { input: 'pasted_sheet', output: 'trimmed_sheet' },
  printer_slotter: { input: 'trimmed_sheet', output: 'printed_sheet' },
  stitching: { input: 'printed_sheet', output: 'finished_box' },
  dispatch: { input: 'finished_box', output: 'finished_box' },
}

const stages = Object.keys(STAGE_LABELS) as ProductionStage[]
const stockTypes = Object.keys(STOCK_LABELS) as ProductionStockType[]
const openJobs = computed(() => production.jobs.filter((j) => j.status !== 'closed' && j.status !== 'dispatched'))
const selectedJob = computed(() => production.jobs.find((j) => j.id === stageForm.job_id) || null)
const activeReels = computed(() => production.reels.filter((r) => r.status === 'active' && r.current_weight > 0))
const reelFilterOptions = computed(() => {
  const uniq = (values: string[]) => Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b))
  return {
    paper_type: uniq(production.reels.map((r) => paperTypeOf(r))),
    gsm: uniq(production.reels.map((r) => r.gsm)),
    bf: uniq(production.reels.map((r) => r.bf)),
    deckle: uniq(production.reels.map((r) => r.deckle_size)),
    color: uniq(production.reels.map((r) => r.color)),
  }
})
const filteredReels = computed(() => production.reels.filter((reel) =>
  (!reelFilters.paper_type || paperTypeOf(reel) === reelFilters.paper_type) &&
  (!reelFilters.gsm || reel.gsm === reelFilters.gsm) &&
  (!reelFilters.bf || reel.bf === reelFilters.bf) &&
  (!reelFilters.deckle || reel.deckle_size === reelFilters.deckle) &&
  (!reelFilters.color || reel.color === reelFilters.color) &&
  (reelFilters.status === 'all' || reel.status === reelFilters.status),
))
const balanceRows = computed(() => {
  const bal = productionBalance(production.movements, firmStore.activeFirmId, selectedJobId.value || undefined)
  return stockTypes.map((type) => ({ type, label: STOCK_LABELS[type], ...bal[type] }))
})
const consumableRows = computed(() => {
  const bal = productionBalance(production.movements, firmStore.activeFirmId)
  return consumableTypes.map((type) => ({ type, label: STOCK_LABELS[type], ...bal[type] }))
})
const recentConsumableMoves = computed(() => {
  return production.movements
    .filter((m) => consumableTypes.includes(m.stock_type))
    .slice(0, 12)
})
const recentReelMoves = computed(() => {
  return production.movements
    .filter((m) => m.stock_type === 'raw_reel')
    .slice(0, 12)
})
const reelInventory = computed(() => reelInventorySummary(production.reels, production.movements))
const reelBalanceReportRows = computed(() => reelInventory.value.breakdown)

const BREAKDOWN_STATUS_META = {
  zero: { label: 'Zero stock', cls: 'bg-red-100 text-red-700' },
  low: { label: 'Low stock', cls: 'bg-amber-100 text-amber-700' },
  ok: { label: 'In stock', cls: 'bg-emerald-100 text-emerald-700' },
} as const

function breakdownRowCls(status: keyof typeof BREAKDOWN_STATUS_META) {
  return status === 'zero' ? 'bg-red-50' : status === 'low' ? 'bg-amber-50' : ''
}

function paperTypeCardCls(type: PaperType) {
  return type === 'DUPLEX' ? 'from-purple-600 to-violet-800' : 'from-amber-600 to-orange-800'
}
const reelConsumptionReportRows = computed(() => {
  const reelsById = new Map(production.reels.map((reel) => [reel.id, reel]))
  const rows = new Map<string, {
    key: string
    date: string
    jobId: string
    job: string
    reels: Set<string>
    entries: number
    usedWeight: number
  }>()

  for (const move of production.movements) {
    if (move.stock_type !== 'raw_reel' || (Number(move.weight_out) || 0) <= 0) continue
    if (!matchesReportFilters(move.date, move.job_id)) continue
    const jobId = move.job_id || ''
    const key = `${move.date}|${jobId}`
    if (!rows.has(key)) rows.set(key, { key, date: move.date, jobId, job: jobLabel(jobId), reels: new Set(), entries: 0, usedWeight: 0 })
    const out = rows.get(key)!
    const reelNo = move.stock_ref_id ? reelsById.get(move.stock_ref_id)?.reel_no : ''
    if (reelNo) out.reels.add(reelNo)
    out.entries += 1
    out.usedWeight += Number(move.weight_out) || 0
  }

  return [...rows.values()]
    .map((row) => ({ ...row, reelCount: row.reels.size }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.job.localeCompare(b.job))
})
const wasteReportRows = computed(() => {
  const rows = new Map<string, {
    key: string
    date: string
    jobId: string
    job: string
    inputWeight: number
    outputWeight: number
    wasteWeight: number
    wasteQty: number
  }>()

  for (const stage of production.stages) {
    if (!matchesReportFilters(stage.date, stage.job_id)) continue
    const key = `${stage.date}|${stage.job_id}`
    if (!rows.has(key)) rows.set(key, { key, date: stage.date, jobId: stage.job_id, job: jobLabel(stage.job_id), inputWeight: 0, outputWeight: 0, wasteWeight: 0, wasteQty: 0 })
    const out = rows.get(key)!
    out.inputWeight += Number(stage.input_weight) || 0
    out.outputWeight += Number(stage.output_weight) || 0
    out.wasteWeight += Number(stage.waste_weight) || 0
    out.wasteQty += Number(stage.waste_qty) || 0
  }

  return [...rows.values()]
    .map((row) => ({ ...row, wastePercent: wastePercent(row.wasteWeight, row.inputWeight, row.outputWeight) }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.job.localeCompare(b.job))
})

watch(() => firmStore.activeFirmId, () => {
  production.load()
  partyStore.load()
  itemStore.load()
})

watch(() => stageForm.stage, applyStageDefaults)
watch(() => route.path, (path) => {
  if (path === '/paper-reels') activeTab.value = 'reels'
  else if (path === '/production' && activeTab.value === 'reels') activeTab.value = 'daily'
})

function n2(v: number) {
  return (Number(v) || 0).toFixed(2)
}

function paperTypeOf(reel: Pick<ReelStock, 'paper_type'>) {
  return normalizePaperType(reel.paper_type)
}

function matchesReportFilters(date: string, jobId?: string) {
  if (reportFilters.from && date < reportFilters.from) return false
  if (reportFilters.to && date > reportFilters.to) return false
  if (reportFilters.job_id && jobId !== reportFilters.job_id) return false
  return true
}

function jobLabel(jobId?: string) {
  if (!jobId) return 'No job'
  const job = production.jobs.find((j) => j.id === jobId)
  return job ? `${job.job_no} - ${job.customer_name}` : 'Unknown job'
}

function wastePercent(wasteWeight: number, inputWeight: number, outputWeight: number) {
  const base = inputWeight > 0 ? inputWeight : outputWeight + wasteWeight
  return base > 0 ? (wasteWeight / base) * 100 : 0
}

function exportCsv(filename: string, headers: string[], rows: string[][]) {
  const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
}

function exportProductionBalance() {
  const job = production.jobs.find((j) => j.id === selectedJobId.value)
  const suffix = job ? `_${job.job_no}` : ''
  exportCsv(`Production_Stock_Balance${suffix}.csv`,
    ['Stock Type', 'Qty', 'Weight KG', 'Waste Qty', 'Waste KG'],
    balanceRows.value.map((row) => [row.label, n2(row.qty), n2(row.weight), n2(row.wasteQty), n2(row.wasteWeight)]))
}

function applyStageDefaults() {
  const pair = stagePairs[stageForm.stage]
  stageForm.input_stock_type = pair.input
  stageForm.output_stock_type = pair.output
  if (stageForm.stage !== 'corrugation') stageForm.input_ref_id = ''
}

function selectCustomer() {
  const key = jobForm.customer_name.trim().toLowerCase()
  const match = partyStore.customers.find((p) => p.name.trim().toLowerCase() === key)
  jobForm.customer_id = match?.id || null
}

function selectItem() {
  const key = jobForm.box_name.trim().toLowerCase()
  const match = itemStore.list.find((i) => i.name.trim().toLowerCase() === key)
  if (!match) return
  jobForm.item_id = match.id
  jobForm.box_name = match.name
  jobForm.box_size = match.size || jobForm.box_size
}

async function saveJob() {
  if (!jobForm.customer_name.trim()) return alert('Customer name required')
  if (!jobForm.job_no.trim()) return alert('Job no required')
  if (!jobForm.box_name.trim()) return alert('Box/item name required')
  await production.addJob({
    ...jobForm,
    customer_name: jobForm.customer_name.trim(),
    job_no: jobForm.job_no.trim(),
    box_name: jobForm.box_name.trim(),
    status: 'open',
  })
  selectedJobId.value = production.jobs[0]?.id || ''
  Object.assign(jobForm, {
    date: new Date().toISOString().slice(0, 10),
    customer_name: '',
    customer_id: null,
    job_no: '',
    item_id: null,
    box_name: '',
    box_size: '',
    target_qty: 0,
    notes: '',
  })
  activeTab.value = 'daily'
}

async function saveStage() {
  if (!stageForm.job_id) return alert('Job select karo')
  if (stageForm.output_qty <= 0 && stageForm.output_weight <= 0) return alert('Output quantity ya weight enter karo')
  if (stageForm.stage === 'corrugation' && !stageForm.input_ref_id) return alert('Corrugation ke liye reel select karo')
  if (stageForm.stage === 'corrugation' && stageForm.input_ref_id && stageForm.input_weight > 0) {
    const selectedReel = production.reels.find((reel) => reel.id === stageForm.input_ref_id)
    if (selectedReel && stageForm.input_weight > (Number(selectedReel.current_weight) || 0)) {
      return alert(`Selected reel ${selectedReel.reel_no} me sirf ${n2(selectedReel.current_weight)} KG available hai.`)
    }
  }
  try {
    await production.addStage({ ...stageForm })
  } catch (err: any) {
    alert(err?.message || 'Daily production entry save nahi ho payi.')
    return
  }
  Object.assign(stageForm, {
    date: new Date().toISOString().slice(0, 10),
    job_id: stageForm.job_id,
    stage: stageForm.stage,
    input_stock_type: stageForm.input_stock_type,
    input_ref_id: '',
    input_qty: 0,
    input_weight: 0,
    output_stock_type: stageForm.output_stock_type,
    output_qty: 0,
    output_weight: 0,
    waste_qty: 0,
    waste_weight: 0,
    notes: '',
  })
}

async function saveConsumableAdjustment() {
  if (!consumableTypes.includes(consumableForm.stock_type)) return alert('Consumable type select karo')
  if (consumableForm.qty <= 0 && consumableForm.weight <= 0) return alert('Quantity ya weight enter karo')
  await production.addStockAdjustment({ ...consumableForm })
  Object.assign(consumableForm, {
    date: new Date().toISOString().slice(0, 10),
    stock_type: consumableForm.stock_type,
    mode: consumableForm.mode,
    qty: 0,
    weight: 0,
    notes: '',
  })
}

async function saveReelConsumption() {
  if (!reelConsumptionForm.reel_id) return alert('Paper reel select karo')
  if (reelConsumptionForm.used_weight <= 0) return alert('Used weight enter karo')
  const selectedReel = production.reels.find((reel) => reel.id === reelConsumptionForm.reel_id)
  if (selectedReel && reelConsumptionForm.used_weight > (Number(selectedReel.current_weight) || 0)) {
    return alert(`Selected reel ${selectedReel.reel_no} me sirf ${n2(selectedReel.current_weight)} KG available hai.`)
  }
  try {
    await production.addReelConsumption({
      ...reelConsumptionForm,
      job_id: reelConsumptionForm.job_id || undefined,
    })
  } catch (err: any) {
    alert(err?.message || 'Paper reel consumption save nahi ho payi.')
    return
  }
  Object.assign(reelConsumptionForm, {
    date: new Date().toISOString().slice(0, 10),
    reel_id: '',
    used_weight: 0,
    job_id: '',
    reason: 'Plant consumption',
    notes: '',
  })
}

function closeJob(id: string) {
  if (confirm('Is job ko close karna hai?')) production.closeJob(id)
}

onMounted(async () => {
  await Promise.all([production.load(), partyStore.load(), itemStore.load()])
  selectedJobId.value = production.jobs[0]?.id || ''
  stageForm.job_id = openJobs.value[0]?.id || ''
})
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto space-y-6">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Production</h1>
        <p class="text-sm text-slate-500">Daily production, reel stock, waste, WIP aur finished box tracking</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button v-for="tab in tabItems" :key="tab.id" @click="activeTab = tab.id" class="pp-btn" :class="activeTab === tab.id ? 'pp-btn-primary' : 'pp-btn-ghost'">
          {{ tab.label }}
        </button>
      </div>
    </div>

    <div v-if="activeTab === 'jobs'" class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="pp-card p-6 space-y-4">
        <h2 class="font-semibold border-b pb-2">New Production Job</h2>
        <div>
          <label class="pp-label">Date</label>
          <input v-model="jobForm.date" type="date" class="pp-input" />
        </div>
        <div>
          <label class="pp-label">Customer *</label>
          <input v-model="jobForm.customer_name" @input="selectCustomer" list="production-customers" class="pp-input" placeholder="Customer name" />
          <datalist id="production-customers">
            <option v-for="p in partyStore.customers" :key="p.id" :value="p.name"></option>
          </datalist>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="pp-label">Job No *</label>
            <input v-model="jobForm.job_no" class="pp-input" placeholder="JOB-001" />
          </div>
          <div>
            <label class="pp-label">Target Boxes</label>
            <input v-model.number="jobForm.target_qty" type="number" class="pp-input text-right" />
          </div>
        </div>
        <div>
          <label class="pp-label">Box / Item *</label>
          <input v-model="jobForm.box_name" @input="selectItem" list="production-items" class="pp-input" placeholder="Box name" />
          <datalist id="production-items">
            <option v-for="it in itemStore.list" :key="it.id" :value="it.name"></option>
          </datalist>
        </div>
        <div>
          <label class="pp-label">Box Size</label>
          <input v-model="jobForm.box_size" class="pp-input" placeholder="L x W x H" />
        </div>
        <div>
          <label class="pp-label">Notes</label>
          <textarea v-model="jobForm.notes" class="pp-input min-h-[80px]"></textarea>
        </div>
        <button @click="saveJob" class="pp-btn pp-btn-primary w-full">Create Job</button>
      </div>

      <div class="lg:col-span-2 pp-card p-6">
        <h2 class="font-semibold border-b pb-2 mb-4">Production Jobs</h2>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-xs uppercase text-slate-500 bg-slate-50">
              <tr>
                <th class="p-3 text-left">Date</th>
                <th class="p-3 text-left">Job</th>
                <th class="p-3 text-left">Customer</th>
                <th class="p-3 text-left">Box</th>
                <th class="p-3 text-right">Target</th>
                <th class="p-3 text-center">Status</th>
                <th class="p-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              <tr v-for="job in production.jobs" :key="job.id">
                <td class="p-3">{{ job.date }}</td>
                <td class="p-3 font-mono">{{ job.job_no }}</td>
                <td class="p-3">{{ job.customer_name }}</td>
                <td class="p-3">{{ job.box_name }}</td>
                <td class="p-3 text-right font-mono">{{ job.target_qty }}</td>
                <td class="p-3 text-center"><span class="pp-badge bg-slate-100">{{ job.status }}</span></td>
                <td class="p-3 text-center">
                  <button v-if="job.status !== 'closed'" @click="closeJob(job.id)" class="pp-btn pp-btn-ghost px-2 py-1 text-xs">Close</button>
                </td>
              </tr>
              <tr v-if="production.jobs.length === 0">
                <td colspan="7" class="p-8 text-center text-slate-400">No production jobs yet.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-else-if="activeTab === 'daily'" class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 pp-card p-6 space-y-4">
        <h2 class="font-semibold border-b pb-2">Daily Production Entry</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label class="pp-label">Date</label>
            <input v-model="stageForm.date" type="date" class="pp-input" />
          </div>
          <div>
            <label class="pp-label">Job *</label>
            <select v-model="stageForm.job_id" class="pp-input">
              <option value="">Select job</option>
              <option v-for="job in openJobs" :key="job.id" :value="job.id">{{ job.job_no }} - {{ job.customer_name }}</option>
            </select>
          </div>
          <div>
            <label class="pp-label">Stage</label>
            <select v-model="stageForm.stage" class="pp-input">
              <option v-for="stage in stages" :key="stage" :value="stage">{{ STAGE_LABELS[stage] }}</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl">
          <div>
            <label class="pp-label">Input Stock</label>
            <select v-model="stageForm.input_stock_type" class="pp-input">
              <option v-for="type in stockTypes" :key="type" :value="type">{{ STOCK_LABELS[type] }}</option>
            </select>
          </div>
          <div v-if="stageForm.input_stock_type === 'raw_reel'">
            <label class="pp-label">Input Reel</label>
            <select v-model="stageForm.input_ref_id" class="pp-input">
              <option value="">Select reel</option>
              <option v-for="reel in activeReels" :key="reel.id" :value="reel.id">{{ reel.reel_no }} - {{ reel.deckle_size }} / {{ reel.gsm }} GSM / {{ n2(reel.current_weight) }} KG</option>
            </select>
          </div>
          <div>
            <label class="pp-label">Input Qty</label>
            <input v-model.number="stageForm.input_qty" type="number" class="pp-input text-right" />
          </div>
          <div>
            <label class="pp-label">Input Weight KG</label>
            <input v-model.number="stageForm.input_weight" type="number" class="pp-input text-right" />
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label class="pp-label">Output Stock</label>
            <select v-model="stageForm.output_stock_type" class="pp-input">
              <option v-for="type in stockTypes" :key="type" :value="type">{{ STOCK_LABELS[type] }}</option>
            </select>
          </div>
          <div>
            <label class="pp-label">Output Qty / Boxes</label>
            <input v-model.number="stageForm.output_qty" type="number" class="pp-input text-right" />
          </div>
          <div>
            <label class="pp-label">Output Weight KG</label>
            <input v-model.number="stageForm.output_weight" type="number" class="pp-input text-right" />
          </div>
          <div>
            <label class="pp-label">Waste Qty</label>
            <input v-model.number="stageForm.waste_qty" type="number" class="pp-input text-right" />
          </div>
          <div>
            <label class="pp-label">Waste Weight KG</label>
            <input v-model.number="stageForm.waste_weight" type="number" class="pp-input text-right" />
          </div>
          <div>
            <label class="pp-label">Notes</label>
            <input v-model="stageForm.notes" class="pp-input" />
          </div>
        </div>
        <button @click="saveStage" class="pp-btn pp-btn-primary w-full">Save Daily Entry</button>
      </div>

      <div class="space-y-6">
        <div class="pp-card p-6">
          <h2 class="font-semibold border-b pb-2 mb-4">Selected Job</h2>
          <div v-if="selectedJob" class="space-y-2 text-sm">
            <div class="font-semibold">{{ selectedJob.job_no }} - {{ selectedJob.customer_name }}</div>
            <div class="text-slate-500">{{ selectedJob.box_name }} {{ selectedJob.box_size }}</div>
            <div>Target: <span class="font-mono">{{ selectedJob.target_qty }}</span></div>
            <div>Status: <span class="pp-badge bg-blue-100 text-blue-800">{{ selectedJob.status }}</span></div>
          </div>
          <div v-else class="text-sm text-slate-400">No open job selected.</div>
        </div>
        <div class="pp-card p-6">
          <h2 class="font-semibold border-b pb-2 mb-4">Latest Entries</h2>
          <div class="space-y-3 max-h-[360px] overflow-auto">
            <div v-for="entry in production.stages.slice(0, 8)" :key="entry.id" class="text-sm border rounded-lg p-3">
              <div class="flex justify-between gap-2">
                <span class="font-semibold">{{ STAGE_LABELS[entry.stage] }}</span>
                <span class="text-slate-500">{{ entry.date }}</span>
              </div>
              <div class="text-slate-500">Out: {{ entry.output_qty }} qty / {{ n2(entry.output_weight) }} KG</div>
              <div class="text-rose-600">Waste: {{ entry.waste_qty }} qty / {{ n2(entry.waste_weight) }} KG</div>
            </div>
            <div v-if="production.stages.length === 0" class="text-sm text-slate-400">No daily entries yet.</div>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="activeTab === 'reels'" class="space-y-6">
      <div class="space-y-4">
        <div>
          <h2 class="text-lg font-semibold text-navy">Paper Reel Inventory Summary</h2>
          <p class="text-xs text-slate-500">Firm-scoped totals from reel stock and movement ledger (Kraft / Duplex, GSM, BF, deckle, color).</p>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <div class="pp-card p-4">
            <div class="text-xs font-semibold text-slate-500 uppercase">Total Reels</div>
            <div class="text-2xl font-bold text-navy mt-1">{{ reelInventory.totalReels }}</div>
            <div class="text-xs text-slate-500 mt-1">{{ reelInventory.activeReels }} active</div>
          </div>
          <div class="pp-card p-4 border-l-4 border-emerald-400">
            <div class="text-xs font-semibold text-slate-500 uppercase">Available KG</div>
            <div class="text-2xl font-bold text-emerald-700 mt-1 font-mono">{{ n2(reelInventory.currentWeight) }}</div>
          </div>
          <div class="pp-card p-4 border-l-4 border-slate-400">
            <div class="text-xs font-semibold text-slate-500 uppercase">Consumed KG</div>
            <div class="text-2xl font-bold text-slate-700 mt-1 font-mono">{{ n2(reelInventory.consumedWeight) }}</div>
            <div class="text-xs text-slate-500 mt-1">Ledger out {{ n2(reelInventory.movementConsumed) }} KG</div>
          </div>
          <div class="pp-card p-4 border-l-4 border-blue-400">
            <div class="text-xs font-semibold text-slate-500 uppercase">Opening KG</div>
            <div class="text-2xl font-bold text-blue-800 mt-1 font-mono">{{ n2(reelInventory.openingWeight) }}</div>
          </div>
          <div class="pp-card p-4 border-l-4 border-amber-400">
            <div class="text-xs font-semibold text-slate-500 uppercase">Low Stock</div>
            <div class="text-2xl font-bold text-amber-600 mt-1">{{ reelInventory.lowStockReels }}</div>
            <div class="text-xs text-slate-500 mt-1">reels &lt; {{ REEL_LOW_STOCK_KG }} KG or 15% left</div>
          </div>
          <div class="pp-card p-4 border-l-4 border-red-400">
            <div class="text-xs font-semibold text-slate-500 uppercase">Zero / Used</div>
            <div class="text-2xl font-bold text-red-600 mt-1">{{ reelInventory.zeroStockReels + reelInventory.consumedReels }}</div>
            <div class="text-xs text-slate-500 mt-1">{{ reelInventory.consumedReels }} fully consumed</div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div
            v-for="row in reelInventory.byPaperType"
            :key="row.paper_type"
            class="pp-card p-4 bg-gradient-to-br text-white"
            :class="paperTypeCardCls(row.paper_type)"
          >
            <div class="text-xs font-semibold uppercase opacity-90">{{ row.paper_type }}</div>
            <div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <span class="opacity-80">Reels</span>
              <span class="font-mono text-right font-semibold">{{ row.reels }} ({{ row.activeReels }} active)</span>
              <span class="opacity-80">Available KG</span>
              <span class="font-mono text-right font-semibold">{{ n2(row.currentWeight) }}</span>
              <span class="opacity-80">Consumed KG</span>
              <span class="font-mono text-right font-semibold">{{ n2(row.consumedWeight) }}</span>
              <span class="opacity-80">Opening KG</span>
              <span class="font-mono text-right">{{ n2(row.openingWeight) }}</span>
            </div>
          </div>
        </div>

        <div class="pp-card p-4 overflow-x-auto">
          <h3 class="font-semibold text-sm mb-3 border-b pb-2">Breakdown by GSM / BF / Deckle / Color</h3>
          <table class="w-full text-sm min-w-[980px]">
            <thead class="text-xs uppercase text-slate-500 bg-slate-50">
              <tr>
                <th class="p-2 text-left">Type</th>
                <th class="p-2 text-left">GSM</th>
                <th class="p-2 text-left">BF</th>
                <th class="p-2 text-left">Deckle</th>
                <th class="p-2 text-left">Color</th>
                <th class="p-2 text-right">Reels</th>
                <th class="p-2 text-right">Active</th>
                <th class="p-2 text-right">Available KG</th>
                <th class="p-2 text-right">Consumed KG</th>
                <th class="p-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              <tr
                v-for="row in reelBalanceReportRows"
                :key="row.key"
                :class="breakdownRowCls(row.stockStatus)"
              >
                <td class="p-2">
                  <span class="pp-badge text-xs" :class="row.paper_type === 'DUPLEX' ? 'bg-purple-100 text-purple-800' : 'bg-amber-100 text-amber-800'">
                    {{ row.paper_type }}
                  </span>
                </td>
                <td class="p-2">{{ row.gsm }}</td>
                <td class="p-2">{{ row.bf }}</td>
                <td class="p-2">{{ row.deckle }}</td>
                <td class="p-2">{{ row.color }}</td>
                <td class="p-2 text-right font-mono">{{ row.reels }}</td>
                <td class="p-2 text-right font-mono">{{ row.activeReels }}</td>
                <td class="p-2 text-right font-mono">{{ n2(row.currentWeight) }}</td>
                <td class="p-2 text-right font-mono text-slate-600">{{ n2(row.consumedWeight) }}</td>
                <td class="p-2 text-center">
                  <span class="pp-badge text-xs" :class="BREAKDOWN_STATUS_META[row.stockStatus].cls">
                    {{ BREAKDOWN_STATUS_META[row.stockStatus].label }}
                  </span>
                </td>
              </tr>
              <tr v-if="reelBalanceReportRows.length === 0">
                <td colspan="10" class="p-6 text-center text-slate-400">No paper reel stock yet.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <div class="xl:col-span-2 pp-card p-6">
        <div class="flex flex-col gap-2 border-b pb-3 mb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 class="font-semibold">Paper Reel Stock</h2>
            <p class="text-xs text-slate-500">Normal inventory se alag reel-wise Kraft/Duplex stock aur movement tracking.</p>
          </div>
          <RouterLink to="/purchases" class="pp-btn pp-btn-ghost !py-1.5 !px-3 text-xs no-underline">
            Add from Purchase
          </RouterLink>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
        <div>
          <label class="pp-label">Paper Type</label>
          <select v-model="reelFilters.paper_type" class="pp-input">
            <option value="">All Type</option>
            <option v-for="type in paperTypes" :key="type" :value="type">{{ type }}</option>
          </select>
        </div>
        <div>
          <label class="pp-label">GSM</label>
          <select v-model="reelFilters.gsm" class="pp-input">
            <option value="">All GSM</option>
            <option v-for="gsm in reelFilterOptions.gsm" :key="gsm" :value="gsm">{{ gsm }}</option>
          </select>
        </div>
        <div>
          <label class="pp-label">BF</label>
          <select v-model="reelFilters.bf" class="pp-input">
            <option value="">All BF</option>
            <option v-for="bf in reelFilterOptions.bf" :key="bf" :value="bf">{{ bf }}</option>
          </select>
        </div>
        <div>
          <label class="pp-label">Deckle</label>
          <select v-model="reelFilters.deckle" class="pp-input">
            <option value="">All Deckle</option>
            <option v-for="deckle in reelFilterOptions.deckle" :key="deckle" :value="deckle">{{ deckle }}</option>
          </select>
        </div>
        <div>
          <label class="pp-label">Color</label>
          <select v-model="reelFilters.color" class="pp-input">
            <option value="">All Color</option>
            <option v-for="color in reelFilterOptions.color" :key="color" :value="color">{{ color }}</option>
          </select>
        </div>
        <div>
          <label class="pp-label">Status</label>
          <select v-model="reelFilters.status" class="pp-input">
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="consumed">Consumed</option>
          </select>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm min-w-[1120px]">
          <thead class="text-xs uppercase text-slate-500 bg-slate-50">
            <tr>
              <th class="p-3 text-left">Reel No</th>
              <th class="p-3 text-left">Type</th>
              <th class="p-3 text-left">Bill No</th>
              <th class="p-3 text-left">Supplier</th>
              <th class="p-3 text-left">Deckle</th>
              <th class="p-3 text-left">GSM / BF</th>
              <th class="p-3 text-left">Color</th>
              <th class="p-3 text-right">Opening KG</th>
              <th class="p-3 text-right">Current KG</th>
              <th class="p-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody class="divide-y">
            <tr v-for="reel in filteredReels" :key="reel.id">
              <td class="p-3 font-mono">{{ reel.reel_no }}</td>
              <td class="p-3">
                <span class="pp-badge" :class="paperTypeOf(reel) === 'DUPLEX' ? 'bg-purple-100 text-purple-800' : 'bg-amber-100 text-amber-800'">
                  {{ paperTypeOf(reel) }}
                </span>
              </td>
              <td class="p-3 font-mono">{{ reel.purchase_bill_no || '-' }}</td>
              <td class="p-3">{{ reel.supplier_name }}</td>
              <td class="p-3">{{ reel.deckle_size }}</td>
              <td class="p-3">{{ reel.gsm }} / {{ reel.bf }}</td>
              <td class="p-3">{{ reel.color }}</td>
              <td class="p-3 text-right font-mono">{{ n2(reel.opening_weight) }}</td>
              <td class="p-3 text-right font-mono">{{ n2(reel.current_weight) }}</td>
              <td class="p-3 text-center"><span class="pp-badge" :class="reel.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-slate-100'">{{ reel.status }}</span></td>
            </tr>
            <tr v-if="filteredReels.length === 0">
              <td colspan="10" class="p-8 text-center text-slate-400">Purchase bill me Paper Reel mark karte hi stock yahan dikhega.</td>
            </tr>
          </tbody>
        </table>
      </div>
      </div>

      <div class="space-y-6">
        <div class="pp-card p-6 space-y-4">
          <h2 class="font-semibold border-b pb-2">Manual Reel Consumption</h2>
          <div>
            <label class="pp-label">Date</label>
            <input v-model="reelConsumptionForm.date" type="date" class="pp-input" />
          </div>
          <div>
            <label class="pp-label">Paper Reel *</label>
            <select v-model="reelConsumptionForm.reel_id" class="pp-input">
              <option value="">Select reel</option>
              <option v-for="reel in activeReels" :key="reel.id" :value="reel.id">
                {{ reel.reel_no }} - {{ paperTypeOf(reel) }} / {{ reel.deckle_size }} / {{ reel.gsm }} GSM / {{ n2(reel.current_weight) }} KG
              </option>
            </select>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="pp-label">Used Weight KG *</label>
              <input v-model.number="reelConsumptionForm.used_weight" type="number" min="0" step="0.001" class="pp-input text-right" />
            </div>
            <div>
              <label class="pp-label">Job (optional)</label>
              <select v-model="reelConsumptionForm.job_id" class="pp-input">
                <option value="">No job</option>
                <option v-for="job in production.jobs" :key="job.id" :value="job.id">{{ job.job_no }}</option>
              </select>
            </div>
          </div>
          <div>
            <label class="pp-label">Reason</label>
            <input v-model="reelConsumptionForm.reason" class="pp-input" placeholder="Plant consumption, sample, damage..." />
          </div>
          <div>
            <label class="pp-label">Notes</label>
            <textarea v-model="reelConsumptionForm.notes" class="pp-input min-h-[80px]" placeholder="Operator, machine, reference..."></textarea>
          </div>
          <button @click="saveReelConsumption" class="pp-btn pp-btn-primary w-full">Consume Reel Stock</button>
          <p class="text-xs text-slate-500">
            Consumption current weight se minus hota hai aur stock movement ledger me log hota hai.
          </p>
        </div>

        <div class="pp-card p-6">
          <h2 class="font-semibold border-b pb-2 mb-4">Recent Reel Movements</h2>
          <div class="space-y-3 max-h-[360px] overflow-auto">
            <div v-for="move in recentReelMoves" :key="move.id" class="rounded-lg border p-3 text-sm">
              <div class="flex justify-between gap-2">
                <span class="font-semibold capitalize">{{ move.source }}</span>
                <span class="text-slate-500">{{ move.date }}</span>
              </div>
              <div class="font-mono text-slate-700">
                In {{ n2(move.weight_in) }} KG / Out {{ n2(move.weight_out) }} KG
              </div>
              <div class="text-slate-500">{{ move.notes }}</div>
            </div>
            <div v-if="recentReelMoves.length === 0" class="text-sm text-slate-400">No reel movements yet.</div>
          </div>
        </div>
      </div>
      </div>
    </div>

    <div v-else-if="activeTab === 'consumables'" class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="pp-card p-6 space-y-4">
        <h2 class="font-semibold border-b pb-2">Glue / Ink / Stitching Wire</h2>
        <div>
          <label class="pp-label">Date</label>
          <input v-model="consumableForm.date" type="date" class="pp-input" />
        </div>
        <div>
          <label class="pp-label">Consumable</label>
          <select v-model="consumableForm.stock_type" class="pp-input">
            <option v-for="type in consumableTypes" :key="type" :value="type">{{ STOCK_LABELS[type] }}</option>
          </select>
        </div>
        <div>
          <label class="pp-label">Entry Type</label>
          <select v-model="consumableForm.mode" class="pp-input">
            <option value="add">Manual Feed / Add Stock</option>
            <option value="consume">Consumption / Use Stock</option>
          </select>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="pp-label">Qty</label>
            <input v-model.number="consumableForm.qty" type="number" class="pp-input text-right" placeholder="0" />
          </div>
          <div>
            <label class="pp-label">Weight KG</label>
            <input v-model.number="consumableForm.weight" type="number" class="pp-input text-right" placeholder="0" />
          </div>
        </div>
        <div>
          <label class="pp-label">Notes</label>
          <textarea v-model="consumableForm.notes" class="pp-input min-h-[80px]" placeholder="Purchase without bill, daily consumption, adjustment..."></textarea>
        </div>
        <button @click="saveConsumableAdjustment" class="pp-btn pp-btn-primary w-full">
          Save Consumable Entry
        </button>
        <p class="text-xs text-slate-500">
          Purchase bill me line item ko Consumable mark karne par stock automatically add hoga.
        </p>
      </div>

      <div class="lg:col-span-2 space-y-6">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div v-for="row in consumableRows" :key="row.type" class="pp-card p-4">
            <div class="text-sm font-semibold">{{ row.label }}</div>
            <div class="mt-3 grid grid-cols-2 gap-2 text-sm">
              <span class="text-slate-500">Qty</span>
              <span class="font-mono text-right">{{ n2(row.qty) }}</span>
              <span class="text-slate-500">Weight</span>
              <span class="font-mono text-right">{{ n2(row.weight) }} KG</span>
            </div>
          </div>
        </div>

        <div class="pp-card p-6">
          <h2 class="font-semibold border-b pb-2 mb-4">Recent Consumable Entries</h2>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="text-xs uppercase text-slate-500 bg-slate-50">
                <tr>
                  <th class="p-3 text-left">Date</th>
                  <th class="p-3 text-left">Item</th>
                  <th class="p-3 text-left">Source</th>
                  <th class="p-3 text-right">In</th>
                  <th class="p-3 text-right">Out</th>
                  <th class="p-3 text-left">Notes</th>
                </tr>
              </thead>
              <tbody class="divide-y">
                <tr v-for="move in recentConsumableMoves" :key="move.id">
                  <td class="p-3">{{ move.date }}</td>
                  <td class="p-3">{{ STOCK_LABELS[move.stock_type] }}</td>
                  <td class="p-3">{{ move.source }}</td>
                  <td class="p-3 text-right font-mono">{{ n2(move.qty_in || move.weight_in) }}</td>
                  <td class="p-3 text-right font-mono">{{ n2(move.qty_out || move.weight_out) }}</td>
                  <td class="p-3 text-slate-500">{{ move.notes }}</td>
                </tr>
                <tr v-if="recentConsumableMoves.length === 0">
                  <td colspan="6" class="p-8 text-center text-slate-400">No consumable entries yet.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="space-y-6">
      <div class="pp-card p-6">
        <div class="flex flex-col gap-4 border-b pb-4 mb-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 class="font-semibold">Production / Paper Reel Reports</h2>
            <p class="text-xs text-slate-500">Basic balances, consumption and waste percentage from saved entries.</p>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <div>
              <label class="pp-label">From</label>
              <input v-model="reportFilters.from" type="date" class="pp-input" />
            </div>
            <div>
              <label class="pp-label">To</label>
              <input v-model="reportFilters.to" type="date" class="pp-input" />
            </div>
            <div>
              <label class="pp-label">Job</label>
              <select v-model="reportFilters.job_id" class="pp-input sm:w-72">
                <option value="">All jobs</option>
                <option v-for="job in production.jobs" :key="job.id" :value="job.id">{{ job.job_no }} - {{ job.customer_name }}</option>
              </select>
            </div>
            <div>
              <label class="pp-label">Stock Balance</label>
              <select v-model="selectedJobId" class="pp-input sm:w-72">
                <option value="">All jobs</option>
                <option v-for="job in production.jobs" :key="job.id" :value="job.id">{{ job.job_no }} - {{ job.customer_name }}</option>
              </select>
            </div>
          </div>
        </div>
        <div class="flex justify-end mb-4">
          <button class="pp-btn pp-btn-primary !py-2 !text-xs" @click="exportProductionBalance">📥 Export Stock CSV</button>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div v-for="row in balanceRows" :key="row.type" class="border rounded-xl p-4 bg-white">
            <div class="font-semibold">{{ row.label }}</div>
            <div class="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div class="text-slate-500">Qty</div>
              <div class="font-mono text-right">{{ n2(row.qty) }}</div>
              <div class="text-slate-500">Weight</div>
              <div class="font-mono text-right">{{ n2(row.weight) }} KG</div>
              <div class="text-rose-500">Waste Qty</div>
              <div class="font-mono text-right text-rose-600">{{ n2(row.wasteQty) }}</div>
              <div class="text-rose-500">Waste KG</div>
              <div class="font-mono text-right text-rose-600">{{ n2(row.wasteWeight) }}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="pp-card p-6">
        <h2 class="font-semibold border-b pb-2 mb-4">Reel Balance by Type / GSM / BF / Deckle / Color</h2>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div class="pp-card p-3 text-sm">
            <div class="text-slate-500">Total reels</div>
            <div class="font-bold text-navy text-lg">{{ reelInventory.totalReels }}</div>
          </div>
          <div class="pp-card p-3 text-sm">
            <div class="text-slate-500">Available KG</div>
            <div class="font-mono font-bold text-emerald-700 text-lg">{{ n2(reelInventory.currentWeight) }}</div>
          </div>
          <div class="pp-card p-3 text-sm">
            <div class="text-slate-500">Consumed KG</div>
            <div class="font-mono font-bold text-lg">{{ n2(reelInventory.consumedWeight) }}</div>
          </div>
          <div class="pp-card p-3 text-sm">
            <div class="text-slate-500">Movement out KG</div>
            <div class="font-mono font-bold text-lg">{{ n2(reelInventory.movementConsumed) }}</div>
          </div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm min-w-[1020px]">
            <thead class="text-xs uppercase text-slate-500 bg-slate-50">
              <tr>
                <th class="p-3 text-left">Type</th>
                <th class="p-3 text-left">GSM</th>
                <th class="p-3 text-left">BF</th>
                <th class="p-3 text-left">Deckle</th>
                <th class="p-3 text-left">Color</th>
                <th class="p-3 text-right">Reels</th>
                <th class="p-3 text-right">Active</th>
                <th class="p-3 text-right">Opening KG</th>
                <th class="p-3 text-right">Available KG</th>
                <th class="p-3 text-right">Consumed KG</th>
                <th class="p-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              <tr v-for="row in reelBalanceReportRows" :key="row.key" :class="breakdownRowCls(row.stockStatus)">
                <td class="p-3">{{ row.paper_type }}</td>
                <td class="p-3">{{ row.gsm }}</td>
                <td class="p-3">{{ row.bf }}</td>
                <td class="p-3">{{ row.deckle }}</td>
                <td class="p-3">{{ row.color }}</td>
                <td class="p-3 text-right font-mono">{{ row.reels }}</td>
                <td class="p-3 text-right font-mono">{{ row.activeReels }}</td>
                <td class="p-3 text-right font-mono">{{ n2(row.openingWeight) }}</td>
                <td class="p-3 text-right font-mono">{{ n2(row.currentWeight) }}</td>
                <td class="p-3 text-right font-mono">{{ n2(row.consumedWeight) }}</td>
                <td class="p-3 text-center">
                  <span class="pp-badge text-xs" :class="BREAKDOWN_STATUS_META[row.stockStatus].cls">
                    {{ BREAKDOWN_STATUS_META[row.stockStatus].label }}
                  </span>
                </td>
              </tr>
              <tr v-if="reelBalanceReportRows.length === 0">
                <td colspan="11" class="p-8 text-center text-slate-400">No paper reel stock yet.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div class="pp-card p-6">
          <h2 class="font-semibold border-b pb-2 mb-4">Reel Consumption by Date / Job</h2>
          <div class="overflow-x-auto">
            <table class="w-full text-sm min-w-[620px]">
              <thead class="text-xs uppercase text-slate-500 bg-slate-50">
                <tr>
                  <th class="p-3 text-left">Date</th>
                  <th class="p-3 text-left">Job</th>
                  <th class="p-3 text-right">Entries</th>
                  <th class="p-3 text-right">Reels</th>
                  <th class="p-3 text-right">Used KG</th>
                </tr>
              </thead>
              <tbody class="divide-y">
                <tr v-for="row in reelConsumptionReportRows" :key="row.key">
                  <td class="p-3">{{ row.date }}</td>
                  <td class="p-3">{{ row.job }}</td>
                  <td class="p-3 text-right font-mono">{{ row.entries }}</td>
                  <td class="p-3 text-right font-mono">{{ row.reelCount }}</td>
                  <td class="p-3 text-right font-mono">{{ n2(row.usedWeight) }}</td>
                </tr>
                <tr v-if="reelConsumptionReportRows.length === 0">
                  <td colspan="5" class="p-8 text-center text-slate-400">No reel consumption in this range.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="pp-card p-6">
          <h2 class="font-semibold border-b pb-2 mb-4">Waste % by Date / Job</h2>
          <div class="overflow-x-auto">
            <table class="w-full text-sm min-w-[720px]">
              <thead class="text-xs uppercase text-slate-500 bg-slate-50">
                <tr>
                  <th class="p-3 text-left">Date</th>
                  <th class="p-3 text-left">Job</th>
                  <th class="p-3 text-right">Input KG</th>
                  <th class="p-3 text-right">Output KG</th>
                  <th class="p-3 text-right">Waste KG</th>
                  <th class="p-3 text-right">Waste %</th>
                </tr>
              </thead>
              <tbody class="divide-y">
                <tr v-for="row in wasteReportRows" :key="row.key">
                  <td class="p-3">{{ row.date }}</td>
                  <td class="p-3">{{ row.job }}</td>
                  <td class="p-3 text-right font-mono">{{ n2(row.inputWeight) }}</td>
                  <td class="p-3 text-right font-mono">{{ n2(row.outputWeight) }}</td>
                  <td class="p-3 text-right font-mono text-rose-600">{{ n2(row.wasteWeight) }}</td>
                  <td class="p-3 text-right font-mono font-semibold">{{ n2(row.wastePercent) }}%</td>
                </tr>
                <tr v-if="wasteReportRows.length === 0">
                  <td colspan="6" class="p-8 text-center text-slate-400">No production entries in this range.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
