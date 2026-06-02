<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useFirmStore } from '@/stores/firm'
import { usePartyStore } from '@/stores/parties'
import { useItemStore } from '@/stores/items'
import { useProductionStore } from '@/stores/production'
import { productionBalance, STAGE_LABELS, STOCK_LABELS } from '@/services/production'
import type { ProductionStage, ProductionStockType } from '@/types/models'

const firmStore = useFirmStore()
const partyStore = usePartyStore()
const itemStore = useItemStore()
const production = useProductionStore()

const activeTab = ref<'jobs' | 'reels' | 'daily' | 'consumables' | 'reports'>('daily')
const selectedJobId = ref('')
const tabItems: { id: typeof activeTab.value; label: string }[] = [
  { id: 'daily', label: 'Daily Entry' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'reels', label: 'Reel Stock' },
  { id: 'consumables', label: 'Consumables' },
  { id: 'reports', label: 'Reports' },
]
const consumableTypes: ProductionStockType[] = ['glue', 'ink', 'stitching_wire']

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

watch(() => firmStore.activeFirmId, () => {
  production.load()
  partyStore.load()
  itemStore.load()
})

watch(() => stageForm.stage, applyStageDefaults)

function n2(v: number) {
  return (Number(v) || 0).toFixed(2)
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
  await production.addStage({ ...stageForm })
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

    <div v-else-if="activeTab === 'reels'" class="pp-card p-6">
      <h2 class="font-semibold border-b pb-2 mb-4">Kraft Paper Reel Stock</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-xs uppercase text-slate-500 bg-slate-50">
            <tr>
              <th class="p-3 text-left">Reel No</th>
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
            <tr v-for="reel in production.reels" :key="reel.id">
              <td class="p-3 font-mono">{{ reel.reel_no }}</td>
              <td class="p-3">{{ reel.supplier_name }}</td>
              <td class="p-3">{{ reel.deckle_size }}</td>
              <td class="p-3">{{ reel.gsm }} / {{ reel.bf }}</td>
              <td class="p-3">{{ reel.color }}</td>
              <td class="p-3 text-right font-mono">{{ n2(reel.opening_weight) }}</td>
              <td class="p-3 text-right font-mono">{{ n2(reel.current_weight) }}</td>
              <td class="p-3 text-center"><span class="pp-badge" :class="reel.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-slate-100'">{{ reel.status }}</span></td>
            </tr>
            <tr v-if="production.reels.length === 0">
              <td colspan="8" class="p-8 text-center text-slate-400">Purchase bill me Kraft Reel mark karte hi stock yahan dikhega.</td>
            </tr>
          </tbody>
        </table>
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

    <div v-else class="pp-card p-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4 mb-4">
        <h2 class="font-semibold">Production Stock Balance</h2>
        <select v-model="selectedJobId" class="pp-input sm:w-80">
          <option value="">All jobs</option>
          <option v-for="job in production.jobs" :key="job.id" :value="job.id">{{ job.job_no }} - {{ job.customer_name }}</option>
        </select>
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
  </div>
</template>
