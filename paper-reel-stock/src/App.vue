<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useReelStore } from '@/stores/reels'
import {
  deckleFromInch,
  deckleFromMm,
  estimateReelWeightKg,
  findDuplicateReelNosInList,
  findReelNosAlreadyInStock,
  formatDeckleDisplay,
  formatReelConsumptionSummary,
  normalizePaperType,
  normalizeReelColor,
  REEL_CORE_DIA_MM,
  resolveDecklePair,
  resolveRemainingWeightUpdate,
  reelInventorySummary,
  type ReelIntakeCondition,
} from '@/services/reel'
import {
  downloadReelAbstractStockPdf,
  downloadReelPhysicalVerificationPdf,
  downloadReelWiseCsv,
  downloadReelWiseStockPdf,
} from '@/services/reelStockPdf'
import type { PaperType, ReelStock } from '@/types/models'

const store = useReelStore()
const { reels, movements, firmName, loaded } = storeToRefs(store)

const n2 = (v: number) => (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const filters = reactive({
  paper_type: '' as '' | PaperType,
  gsm: '',
  bf: '',
  showConsumed: false,
  q: '',
})

const selectedIds = ref<string[]>([])
const consumeRemark = ref('')
const remainingDrafts = reactive<Record<string, number>>({})
const remainingRemark = reactive<Record<string, string>>({})
const remainingMode = reactive<Record<string, 'weight' | 'dia'>>({})
const diaDrafts = reactive<Record<string, number>>({})

const addForm = reactive({
  supplier_name: '',
  paper_type: 'KRAFT' as PaperType,
  gsm: '',
  bf: '',
  color: 'NS',
  deckle_mm: 0,
  deckle_inch: 0,
  intake_condition: 'fresh' as ReelIntakeCondition,
  remark: '',
  date: new Date().toISOString().slice(0, 10),
  reel_count: 1,
})

const lines = ref<Array<{ reel_no: string; opening_weight: number }>>([{ reel_no: '', opening_weight: 0 }])

watch(() => addForm.reel_count, (n) => {
  const count = Math.min(50, Math.max(1, Number(n) || 1))
  addForm.reel_count = count
  while (lines.value.length < count) lines.value.push({ reel_no: '', opening_weight: 0 })
  while (lines.value.length > count) lines.value.pop()
})

const editOpen = ref(false)
const editForm = reactive({
  reel_id: '',
  reel_no: '',
  paper_type: 'KRAFT' as PaperType,
  supplier_name: '',
  gsm: '',
  bf: '',
  color: 'NS',
  deckle_mm: 0,
  deckle_inch: 0,
  intake_condition: 'fresh' as ReelIntakeCondition,
  remark: '',
})

const nameDraft = ref('')

onMounted(async () => {
  await store.load()
  nameDraft.value = firmName.value
})

const inventory = computed(() => reelInventorySummary(reels.value))

const filtered = computed(() => {
  const q = filters.q.trim().toLowerCase()
  return reels.value.filter((r) => {
    if (!filters.showConsumed && r.status !== 'active') return false
    if (filters.paper_type && normalizePaperType(r.paper_type) !== filters.paper_type) return false
    if (filters.gsm && r.gsm !== filters.gsm) return false
    if (filters.bf && r.bf !== filters.bf) return false
    if (q) {
      const hay = `${r.reel_no} ${r.supplier_name} ${r.remark || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
})

const filterOptions = computed(() => {
  const gsm = new Set<string>()
  const bf = new Set<string>()
  for (const r of reels.value) {
    if (r.gsm) gsm.add(r.gsm)
    if (r.bf) bf.add(r.bf)
  }
  return { gsm: [...gsm].sort(), bf: [...bf].sort() }
})

const activeSelected = computed(() =>
  filtered.value.filter((r) => selectedIds.value.includes(r.id) && r.status === 'active' && r.current_weight > 0),
)

const dupInList = computed(() => findDuplicateReelNosInList(lines.value.map((l) => l.reel_no)))
const dupInStock = computed(() =>
  findReelNosAlreadyInStock(lines.value.map((l) => l.reel_no), reels.value.map((r) => r.reel_no)),
)

function consumeInfo(reelId: string) {
  return formatReelConsumptionSummary(movements.value, reelId)
}

function deckleLabel(reel: ReelStock) {
  if (reel.deckle_mm || reel.deckle_inch) {
    return formatDeckleDisplay(Number(reel.deckle_mm) || 0, Number(reel.deckle_inch) || 0)
  }
  return resolveDecklePair({ deckle_size: reel.deckle_size }).deckle_size || reel.deckle_size || '—'
}

function onDeckleMm(v: number) {
  const p = deckleFromMm(v)
  addForm.deckle_mm = p.deckle_mm
  addForm.deckle_inch = p.deckle_inch
}

function onDeckleInch(v: number) {
  const p = deckleFromInch(v)
  addForm.deckle_mm = p.deckle_mm
  addForm.deckle_inch = p.deckle_inch
}

function toggleSelect(id: string, on: boolean) {
  if (on) selectedIds.value = [...new Set([...selectedIds.value, id])]
  else selectedIds.value = selectedIds.value.filter((x) => x !== id)
}

async function saveFirmName() {
  await store.setFirmName(nameDraft.value)
}

async function saveAdd() {
  try {
    await store.addReels({
      supplier_name: addForm.supplier_name,
      paper_type: addForm.paper_type,
      gsm: addForm.gsm,
      bf: addForm.bf,
      color: addForm.color,
      deckle_mm: addForm.deckle_mm,
      deckle_inch: addForm.deckle_inch,
      intake_condition: addForm.intake_condition,
      remark: addForm.remark,
      date: addForm.date,
      lines: lines.value.map((l) => ({ ...l })),
    })
    addForm.remark = ''
    addForm.reel_count = 1
    lines.value = [{ reel_no: '', opening_weight: 0 }]
    alert('Reel stock me add ho gaya.')
  } catch (err: any) {
    alert(err?.message || 'Add fail')
  }
}

async function updateOne(reel: ReelStock) {
  if (remainingMode[reel.id] === 'dia') {
    try {
      const kg = estimateReelWeightKg({
        deckleMm: Number(reel.deckle_mm) || resolveDecklePair({ deckle_size: reel.deckle_size }).deckle_mm,
        diaMm: Number(diaDrafts[reel.id]) || 0,
        gsm: reel.gsm,
        coreMm: REEL_CORE_DIA_MM,
      })
      remainingDrafts[reel.id] = kg
    } catch (err: any) {
      return alert(err?.message || 'Dia→KG fail')
    }
  }
  const remaining = Number(remainingDrafts[reel.id])
  let used = 0
  try {
    ;({ used } = resolveRemainingWeightUpdate(Number(reel.current_weight) || 0, remaining))
  } catch (err: any) {
    return alert(err?.message || 'Invalid remaining')
  }
  const remark = String(remainingRemark[reel.id] || '').trim()
  const auto = `Remaining set to ${remaining} KG (was ${n2(Number(reel.current_weight) || 0)})`
  const ok = confirm(
    remaining <= 0
      ? `Reel ${reel.reel_no} FULL consume?\n\n${n2(Number(reel.current_weight))} → 0${remark ? `\nRemark: ${remark}` : ''}`
      : `Reel ${reel.reel_no}: consume ${n2(used)} KG → ${n2(remaining)} left?${remark ? `\nRemark: ${remark}` : ''}`,
  )
  if (!ok) return
  try {
    await store.updateRemaining(reel.id, remaining, remark ? `${auto} · ${remark}` : auto)
    remainingRemark[reel.id] = ''
    selectedIds.value = selectedIds.value.filter((id) => id !== reel.id)
  } catch (err: any) {
    alert(err?.message || 'Update fail')
  }
}

async function fullConsumeSelected() {
  const targets = activeSelected.value
  if (!targets.length) return alert('Pehle active reels select karo')
  const remark = consumeRemark.value.trim()
  const total = targets.reduce((s, r) => s + (Number(r.current_weight) || 0), 0)
  const ok = confirm(`Full consume ${targets.length} reels (${n2(total)} KG)?${remark ? `\nRemark: ${remark}` : ''}`)
  if (!ok) return
  try {
    await store.fullConsume(targets.map((r) => r.id), remark || undefined)
    selectedIds.value = []
    consumeRemark.value = ''
    alert('Full consumed.')
  } catch (err: any) {
    alert(err?.message || 'Consume fail')
  }
}

function openEdit(reel: ReelStock) {
  const pair = resolveDecklePair({
    deckle_mm: reel.deckle_mm,
    deckle_inch: reel.deckle_inch,
    deckle_size: reel.deckle_size,
  })
  editForm.reel_id = reel.id
  editForm.reel_no = reel.reel_no
  editForm.paper_type = normalizePaperType(reel.paper_type)
  editForm.supplier_name = reel.supplier_name
  editForm.gsm = reel.gsm
  editForm.bf = reel.bf
  editForm.color = normalizeReelColor(reel.color)
  editForm.deckle_mm = pair.deckle_mm
  editForm.deckle_inch = pair.deckle_inch
  editForm.intake_condition = reel.intake_condition === 'partial' ? 'partial' : 'fresh'
  editForm.remark = reel.remark || ''
  editOpen.value = true
}

async function saveEdit() {
  try {
    await store.updateSpecs({
      firm_id: store.firmId,
      reel_id: editForm.reel_id,
      reel_no: editForm.reel_no,
      paper_type: editForm.paper_type,
      supplier_name: editForm.supplier_name,
      gsm: editForm.gsm,
      bf: editForm.bf,
      color: editForm.color,
      deckle_mm: editForm.deckle_mm,
      deckle_inch: editForm.deckle_inch,
      intake_condition: editForm.intake_condition,
      remark: editForm.remark,
    })
    editOpen.value = false
  } catch (err: any) {
    alert(err?.message || 'Save fail')
  }
}

async function deleteOne(reel: ReelStock) {
  const ok = confirm(`Delete reel ${reel.reel_no} + linked movements?`)
  if (!ok) return
  await store.removeReels([reel.id])
}

function exportCsv() {
  const map = new Map<string, string>()
  for (const r of filtered.value) map.set(r.id, consumeInfo(r.id).short)
  const res = downloadReelWiseCsv({ reels: filtered.value, consumedOnByReelId: map })
  alert(`CSV: ${res.file}`)
}

function exportPdf() {
  const res = downloadReelWiseStockPdf({
    reels: filtered.value,
    firmName: firmName.value,
  })
  alert(`PDF: ${res.file}`)
}

function exportPhys() {
  const res = downloadReelPhysicalVerificationPdf({
    reels: filtered.value.filter((r) => r.status === 'active'),
    firmName: firmName.value,
  })
  alert(`Physical verify: ${res.file}`)
}

function exportAbstract() {
  const inv = inventory.value
  const res = downloadReelAbstractStockPdf({
    breakdown: inv.breakdown.filter((r) => r.stockStatus !== 'zero'),
    firmName: firmName.value,
    totals: {
      totalReels: inv.totalReels,
      availableKg: inv.currentWeight,
      consumedKg: inv.consumedWeight,
      lowStockReels: inv.lowStockReels,
      zeroStockReels: inv.zeroStockReels,
    },
  })
  alert(`Abstract: ${res.file}`)
}
</script>

<template>
  <div class="min-h-full">
    <header class="bg-navy text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-lg font-bold tracking-wide">Paper Reel Stock</h1>
        <p class="text-xs text-slate-300">Standalone app · alag database (Pama Suite se alag)</p>
      </div>
      <div class="flex items-center gap-2">
        <input v-model="nameDraft" class="pp-input !py-1.5 !text-sm !bg-white/10 !border-white/20 !text-white max-w-[14rem]" placeholder="Firm / mill name" />
        <button type="button" class="pp-btn pp-btn-ghost !bg-white/10 !text-white hover:!bg-white/20" @click="saveFirmName">Save name</button>
      </div>
    </header>

    <main class="max-w-[1400px] mx-auto p-4 space-y-4">
      <p v-if="!loaded" class="text-slate-500 text-sm">Loading…</p>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div class="pp-card p-4">
          <div class="text-xs uppercase text-slate-500 font-semibold">Total reels</div>
          <div class="text-2xl font-bold font-mono mt-1">{{ inventory.totalReels }}</div>
          <div class="text-xs text-slate-500">{{ inventory.activeReels }} active</div>
        </div>
        <div class="pp-card p-4">
          <div class="text-xs uppercase text-slate-500 font-semibold">Available KG</div>
          <div class="text-2xl font-bold font-mono mt-1 text-emerald-700">{{ n2(inventory.currentWeight) }}</div>
        </div>
        <div class="pp-card p-4">
          <div class="text-xs uppercase text-slate-500 font-semibold">Consumed KG</div>
          <div class="text-2xl font-bold font-mono mt-1">{{ n2(inventory.consumedWeight) }}</div>
        </div>
        <div class="pp-card p-4">
          <div class="text-xs uppercase text-slate-500 font-semibold">Low / Consumed</div>
          <div class="text-2xl font-bold font-mono mt-1 text-amber-700">{{ inventory.lowStockReels }} / {{ inventory.consumedReels }}</div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="lg:col-span-2 space-y-4">
          <div class="pp-card p-4 space-y-3">
            <div class="flex flex-wrap gap-2 items-end justify-between">
              <h2 class="font-semibold text-navy">Stock list</h2>
              <div class="flex flex-wrap gap-2">
                <button type="button" class="pp-btn pp-btn-ghost !py-1.5 !text-xs" @click="exportPhys">Physical PDF</button>
                <button type="button" class="pp-btn pp-btn-ghost !py-1.5 !text-xs" @click="exportCsv">CSV</button>
                <button type="button" class="pp-btn pp-btn-ghost !py-1.5 !text-xs" @click="exportPdf">PDF reel-wise</button>
                <button type="button" class="pp-btn pp-btn-ghost !py-1.5 !text-xs" @click="exportAbstract">PDF abstract</button>
              </div>
            </div>

            <div class="flex flex-wrap gap-2 items-center">
              <select v-model="filters.paper_type" class="pp-input !w-auto">
                <option value="">All type</option>
                <option value="KRAFT">KRAFT</option>
                <option value="DUPLEX">DUPLEX</option>
              </select>
              <select v-model="filters.gsm" class="pp-input !w-auto">
                <option value="">All GSM</option>
                <option v-for="g in filterOptions.gsm" :key="g" :value="g">{{ g }}</option>
              </select>
              <select v-model="filters.bf" class="pp-input !w-auto">
                <option value="">All BF</option>
                <option v-for="b in filterOptions.bf" :key="b" :value="b">{{ b }}</option>
              </select>
              <input v-model="filters.q" class="pp-input max-w-xs" placeholder="Search reel / mill / party" />
              <label class="inline-flex items-center gap-1.5 text-sm text-slate-600">
                <input v-model="filters.showConsumed" type="checkbox" />
                Show consumed
              </label>
            </div>

            <div class="flex flex-wrap gap-2 items-center">
              <button
                type="button"
                class="pp-btn pp-btn-primary !py-1.5 !text-xs"
                :disabled="!activeSelected.length"
                @click="fullConsumeSelected"
              >
                Full consume selected ({{ activeSelected.length }})
              </button>
              <input
                v-model="consumeRemark"
                class="pp-input !py-1.5 !text-xs max-w-xs"
                placeholder="Consume on — party / order / job"
              />
            </div>

            <div class="overflow-auto border rounded-lg">
              <table class="w-full text-sm min-w-[1100px]">
                <thead class="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th class="p-2 text-center">Select</th>
                    <th class="p-2 text-left">Reel No</th>
                    <th class="p-2 text-left">Type</th>
                    <th class="p-2 text-left">Mill</th>
                    <th class="p-2 text-left">Deckle</th>
                    <th class="p-2 text-left">GSM</th>
                    <th class="p-2 text-left">BF</th>
                    <th class="p-2 text-left">Color</th>
                    <th class="p-2 text-left">For (party/order)</th>
                    <th class="p-2 text-left">Consumed on</th>
                    <th class="p-2 text-right">Opening</th>
                    <th class="p-2 text-right">Qty left</th>
                    <th class="p-2 text-right">Remaining</th>
                    <th class="p-2 text-center">Status</th>
                    <th class="p-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody class="divide-y">
                  <tr v-for="reel in filtered" :key="reel.id">
                    <td class="p-2 text-center">
                      <input
                        v-if="reel.status === 'active' && reel.current_weight > 0"
                        type="checkbox"
                        :checked="selectedIds.includes(reel.id)"
                        @change="toggleSelect(reel.id, ($event.target as HTMLInputElement).checked)"
                      />
                      <span v-else class="text-slate-300">—</span>
                    </td>
                    <td class="p-2 font-mono">{{ reel.reel_no }}</td>
                    <td class="p-2">
                      <span class="pp-badge" :class="normalizePaperType(reel.paper_type) === 'DUPLEX' ? 'bg-purple-100 text-purple-800' : 'bg-amber-100 text-amber-800'">
                        {{ normalizePaperType(reel.paper_type) }}
                      </span>
                    </td>
                    <td class="p-2">{{ reel.supplier_name }}</td>
                    <td class="p-2 text-xs">{{ deckleLabel(reel) }}</td>
                    <td class="p-2">{{ reel.gsm }}</td>
                    <td class="p-2">{{ reel.bf }}</td>
                    <td class="p-2">{{ normalizeReelColor(reel.color) }}</td>
                    <td class="p-2 text-xs max-w-[9rem]">
                      <span class="line-clamp-2" :title="reel.remark || ''">{{ reel.remark || '—' }}</span>
                    </td>
                    <td class="p-2 text-xs max-w-[12rem]">
                      <span class="line-clamp-3" :title="consumeInfo(reel.id).detail || consumeInfo(reel.id).short">
                        {{ consumeInfo(reel.id).short }}
                      </span>
                    </td>
                    <td class="p-2 text-right font-mono">{{ n2(reel.opening_weight) }}</td>
                    <td class="p-2 text-right font-mono" :class="reel.status === 'active' ? 'font-bold text-emerald-700' : 'text-slate-400'">
                      {{ n2(reel.current_weight) }}
                    </td>
                    <td class="p-2 text-right">
                      <template v-if="reel.status === 'active' && reel.current_weight > 0">
                        <div class="inline-flex flex-col items-end gap-1">
                          <div class="flex gap-2 text-[10px]">
                            <label class="inline-flex items-center gap-0.5">
                              <input type="radio" :checked="(remainingMode[reel.id] || 'weight') === 'weight'" @change="remainingMode[reel.id] = 'weight'" /> KG
                            </label>
                            <label class="inline-flex items-center gap-0.5">
                              <input type="radio" :checked="remainingMode[reel.id] === 'dia'" @change="remainingMode[reel.id] = 'dia'" /> Dia
                            </label>
                          </div>
                          <input
                            v-if="(remainingMode[reel.id] || 'weight') === 'weight'"
                            type="number"
                            min="0"
                            step="0.001"
                            class="pp-input !w-24 !py-1 text-right font-mono text-xs"
                            :value="remainingDrafts[reel.id] ?? ''"
                            @input="remainingDrafts[reel.id] = Number(($event.target as HTMLInputElement).value)"
                          />
                          <input
                            v-else
                            type="number"
                            min="0"
                            step="0.1"
                            class="pp-input !w-20 !py-1 text-right font-mono text-xs"
                            placeholder="mm"
                            :value="diaDrafts[reel.id] || ''"
                            @input="diaDrafts[reel.id] = Number(($event.target as HTMLInputElement).value)"
                          />
                        </div>
                      </template>
                      <span v-else class="text-slate-400">—</span>
                    </td>
                    <td class="p-2 text-center">
                      <span class="pp-badge" :class="reel.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-slate-100'">{{ reel.status }}</span>
                    </td>
                    <td class="p-2 text-right">
                      <div class="inline-flex flex-col items-end gap-1 min-w-[8rem]">
                        <input
                          v-if="reel.status === 'active' && reel.current_weight > 0"
                          v-model="remainingRemark[reel.id]"
                          class="pp-input !py-1 !text-xs w-full"
                          placeholder="Consume on — party/order"
                        />
                        <div class="inline-flex flex-wrap justify-end gap-1">
                          <button type="button" class="pp-btn pp-btn-ghost !py-1 !px-2 text-xs" @click="openEdit(reel)">Edit</button>
                          <button
                            v-if="reel.status === 'active' && reel.current_weight > 0"
                            type="button"
                            class="pp-btn pp-btn-primary !py-1 !px-2 text-xs"
                            @click="updateOne(reel)"
                          >Update</button>
                          <button type="button" class="pp-btn pp-btn-danger !py-1 !px-2 text-xs" @click="deleteOne(reel)">Delete</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                  <tr v-if="filtered.length === 0">
                    <td colspan="15" class="p-8 text-center text-slate-500">
                      List khali hai — right side se reel add karo.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="space-y-4">
          <div class="pp-card p-4 space-y-3">
            <h2 class="font-semibold border-b pb-2">Add Reel (stock)</h2>
            <div>
              <label class="pp-label">Paper Mill *</label>
              <input v-model="addForm.supplier_name" class="pp-input" placeholder="Search / type mill" />
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="pp-label">BF *</label>
                <input v-model="addForm.bf" class="pp-input" placeholder="e.g. 18" />
              </div>
              <div>
                <label class="pp-label">GSM *</label>
                <input v-model="addForm.gsm" class="pp-input" placeholder="e.g. 120" />
              </div>
              <div>
                <label class="pp-label">Color *</label>
                <input v-model="addForm.color" class="pp-input" />
              </div>
              <div>
                <label class="pp-label">Paper Type *</label>
                <select v-model="addForm.paper_type" class="pp-input">
                  <option value="KRAFT">KRAFT</option>
                  <option value="DUPLEX">DUPLEX</option>
                </select>
              </div>
              <div>
                <label class="pp-label">Deckle (inch)</label>
                <input type="number" min="0" step="0.001" class="pp-input text-right" :value="addForm.deckle_inch || ''" @input="onDeckleInch(Number(($event.target as HTMLInputElement).value))" />
              </div>
              <div>
                <label class="pp-label">Deckle (mm) *</label>
                <input type="number" min="0" step="0.1" class="pp-input text-right" :value="addForm.deckle_mm || ''" @input="onDeckleMm(Number(($event.target as HTMLInputElement).value))" />
              </div>
            </div>
            <div>
              <label class="pp-label">Condition *</label>
              <div class="flex gap-4 text-sm">
                <label class="inline-flex items-center gap-1.5"><input v-model="addForm.intake_condition" type="radio" value="fresh" /> Fresh</label>
                <label class="inline-flex items-center gap-1.5"><input v-model="addForm.intake_condition" type="radio" value="partial" /> Partial used</label>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="pp-label">No. of reels *</label>
                <input v-model.number="addForm.reel_count" type="number" min="1" max="50" class="pp-input text-right" />
              </div>
              <div>
                <label class="pp-label">Date</label>
                <input v-model="addForm.date" type="date" class="pp-input" />
              </div>
            </div>
            <div>
              <label class="pp-label">For party / order</label>
              <input v-model="addForm.remark" class="pp-input" placeholder="Kis party / kis item ki reel" />
            </div>
            <div class="border rounded-lg overflow-hidden">
              <table class="w-full text-sm">
                <thead class="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th class="p-2 text-left">#</th>
                    <th class="p-2 text-left">Reel No *</th>
                    <th class="p-2 text-right">Opening KG *</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, idx) in lines" :key="idx" class="border-t">
                    <td class="p-2 text-slate-400">{{ idx + 1 }}</td>
                    <td class="p-2"><input v-model="row.reel_no" class="pp-input !py-1 font-mono" placeholder="e.g. R-101" /></td>
                    <td class="p-2"><input v-model.number="row.opening_weight" type="number" min="0" step="0.001" class="pp-input !py-1 text-right" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-if="dupInList.length" class="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
              List me duplicate: {{ dupInList.join(', ') }}
            </p>
            <p v-else-if="dupInStock.length" class="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
              Pehle se stock me: {{ dupInStock.join(', ') }}
            </p>
            <button
              type="button"
              class="pp-btn pp-btn-primary w-full"
              :disabled="dupInList.length > 0 || dupInStock.length > 0"
              @click="saveAdd"
            >
              Add {{ addForm.reel_count }} reel{{ addForm.reel_count > 1 ? 's' : '' }} to stock
            </button>
          </div>

          <div class="pp-card p-4 text-xs text-slate-500 space-y-1">
            <p class="font-semibold text-slate-700">Database</p>
            <p>IndexedDB: <span class="font-mono">ReelStockStandaloneDB</span></p>
            <p>Pama Suite DB (<span class="font-mono">PamaSuiteDB</span>) touch nahi hota.</p>
          </div>
        </div>
      </div>
    </main>

    <div v-if="editOpen" class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" @click.self="editOpen = false">
      <div class="pp-card p-5 w-full max-w-lg space-y-3">
        <h3 class="font-semibold text-navy">Edit reel specs</h3>
        <div class="grid grid-cols-2 gap-2">
          <div class="col-span-2">
            <label class="pp-label">Reel No</label>
            <input v-model="editForm.reel_no" class="pp-input font-mono" />
          </div>
          <div>
            <label class="pp-label">Mill</label>
            <input v-model="editForm.supplier_name" class="pp-input" />
          </div>
          <div>
            <label class="pp-label">Type</label>
            <select v-model="editForm.paper_type" class="pp-input">
              <option value="KRAFT">KRAFT</option>
              <option value="DUPLEX">DUPLEX</option>
            </select>
          </div>
          <div>
            <label class="pp-label">GSM</label>
            <input v-model="editForm.gsm" class="pp-input" />
          </div>
          <div>
            <label class="pp-label">BF</label>
            <input v-model="editForm.bf" class="pp-input" />
          </div>
          <div>
            <label class="pp-label">Color</label>
            <input v-model="editForm.color" class="pp-input" />
          </div>
          <div>
            <label class="pp-label">Deckle mm</label>
            <input v-model.number="editForm.deckle_mm" type="number" class="pp-input text-right" @change="(() => { const p = deckleFromMm(editForm.deckle_mm); editForm.deckle_mm = p.deckle_mm; editForm.deckle_inch = p.deckle_inch })()" />
          </div>
          <div class="col-span-2">
            <label class="pp-label">For party / order</label>
            <input v-model="editForm.remark" class="pp-input" />
          </div>
        </div>
        <div class="flex justify-end gap-2 border-t pt-3">
          <button type="button" class="pp-btn pp-btn-ghost" @click="editOpen = false">Cancel</button>
          <button type="button" class="pp-btn pp-btn-primary" @click="saveEdit">Save</button>
        </div>
      </div>
    </div>
  </div>
</template>
