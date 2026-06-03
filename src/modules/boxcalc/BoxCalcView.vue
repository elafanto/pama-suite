<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useRecipeStore } from '@/stores/recipes'
import { usePartyStore } from '@/stores/parties'
import { useItemStore } from '@/stores/items'
import { useFirmStore } from '@/stores/firm'
import {
  PAPER_LIBRARY,
  getTakeUp,
  COMMON_PAPER_COLORS,
} from '@/services/calculator'
import {
  defaultJobCard,
  getAutoRCT,
  getCurrentCaliper,
  getLayerBS,
  getLayerRCT,
  getPaperTypesForLayer,
  getPresetsForLayer,
  getCureStatus,
  getTotalBundles,
  getTwoPlyCount,
  generateJobNumber,
  loadRecentVendorPhones,
  loadSavedBoxNames,
  saveBoxName,
  setDimensionUnit,
  unitLabel,
  computeBoxCalcResults,
  defaultConversionSlabs,
  type BoxCalcForm,
  type BoxCalcJobCard,
  type VendorPhone,
} from '@/services/boxcalcUi'
import { openJobCardPrintWindow } from '@/services/jobCard'
import { exportAll, downloadBackup } from '@/services/backup'
import PpModal from '@/components/PpModal.vue'
import BoxCalcResults from '@/components/boxcalc/BoxCalcResults.vue'
import BoxCalcLivePanel from '@/components/boxcalc/BoxCalcLivePanel.vue'
import BoxCalcJobCardModal from '@/components/boxcalc/BoxCalcJobCardModal.vue'
import BoxCalcWhatsAppModal from '@/components/boxcalc/BoxCalcWhatsAppModal.vue'
import type { Recipe } from '@/types/models'

const router = useRouter()
const recipeStore = useRecipeStore()
const partyStore = usePartyStore()
const itemStore = useItemStore()
const firmStore = useFirmStore()

const activeTab = ref<'calculator' | 'saved' | 'settings'>('calculator')
const search = ref('')
const showResults = ref(false)
const showSaveModal = ref(false)
const showJobCardModal = ref(false)
const showWhatsAppModal = ref(false)
const recipeNameInput = ref('')
const saveStatus = ref('')
const vendorPhones = ref<VendorPhone[]>([])
const savedBoxNames = ref<string[]>([])

function initialFormState(): BoxCalcForm {
  return {
    customerName: '',
    boxName: '',
    printType: 'printed',
    dimensionUnit: 'mm',
    dimType: 'inner',
    length: 300,
    width: 200,
    height: 150,
    ply: '3-ply',
    flute: 'C',
    caliperOverride: null,
    glueFlap: null,
    layers: [],
    starchGSM: 7,
    starchRate: 30,
    joining: {
      method: 'stitching',
      pinHeadType: '',
      wireRate: 120,
      cwpGSM: 150,
      coverage: 0.80,
      cwpRate: 200,
    },
    quantity: 1000,
    productionWastePercent: 3,
    marginPercent: 15,
    printingCost: 0.50,
    shippingCostPerKg: 0.30,
    conversionSlabs: defaultConversionSlabs(),
    scrapRate: 12,
    priceMode: 'auto',
    customSellingPrice: null,
    stackCheck: { enabled: false, stackCount: 10, contentWeight: 5 },
    stackingConditions: { storage: 'medium', humid: false, transport: false, cold: false },
    jobCard: defaultJobCard(firmStore.activeFirm?.name || 'My Box Plant'),
  }
}

const form = reactive<BoxCalcForm>(initialFormState())
const jobCard = computed({
  get: () => form.jobCard!,
  set: (v: BoxCalcJobCard) => { form.jobCard = v },
})
const results = ref<any>(null)
const errors = ref<string[]>([])

const liveCalc = computed(() => computeBoxCalcResults(form))
const liveResults = computed(() => {
  const res = liveCalc.value
  if (!res || 'error' in res) return null
  return res
})
const liveError = computed(() => {
  const res = liveCalc.value
  return res && 'error' in res ? res.error : null
})

function getFluteOptions() {
  const flutes: Record<string, string[]> = {
    '3-ply': ['A', 'B', 'C', 'E'],
    '5-ply': ['BC', 'CC', 'BE', 'EB'],
    '7-ply': ['ABC', 'BCB', 'BCC'],
  }
  return flutes[form.ply] || ['C']
}

function getTakeUpForLayer(layerIdx: number): number {
  if (form.flute.length === 1) return getTakeUp(form.flute)
  const fluteChars = form.flute.split('')
  const plySlots: Record<string, string[]> = {
    '3-ply': ['', 'B', ''],
    '5-ply': ['', 'F1', '', 'F2', ''],
    '7-ply': ['', 'F1', '', 'F2', '', 'F3', ''],
  }
  const slots = plySlots[form.ply]
  let count = 0
  for (let i = 0; i <= layerIdx; i++) {
    if (slots[i]?.startsWith('F')) count++
  }
  return getTakeUp(fluteChars[count - 1] || 'C')
}

function updateLayersForPly() {
  const plyMap: Record<string, string[]> = {
    '3-ply': ['Top Liner', 'Flute', 'Bottom Liner'],
    '5-ply': ['Top Liner', 'Flute 1', 'Mid Liner', 'Flute 2', 'Bottom Liner'],
    '7-ply': ['Top Liner', 'Flute 1', 'Mid Liner 1', 'Flute 2', 'Mid Liner 2', 'Flute 3', 'Bottom Liner'],
  }
  const layerNames = plyMap[form.ply] || []
  const newLayers: BoxCalcForm['layers'] = []
  layerNames.forEach((name, idx) => {
    const isFlute = name.toLowerCase().includes('flute')
    const existing = form.layers[idx]
    if (existing && existing.name === name) {
      newLayers.push(existing)
    } else {
      const isOuter = idx === 0 || idx === layerNames.length - 1
      const paperType = isFlute ? 'flutingMedium' : (isOuter ? 'kraftLiner' : 'testLiner')
      const pLib = PAPER_LIBRARY[paperType as keyof typeof PAPER_LIBRARY]
      newLayers.push({
        name,
        paperType,
        gsm: isFlute ? 120 : (isOuter ? 150 : 120),
        bf: isFlute ? 16 : (isOuter ? 18 : 16),
        rate: pLib?.typicalRate || 40,
        color: pLib?.defaultColor || 'Natural Brown',
        takeUp: isFlute ? getTakeUpForLayer(idx) : 1.0,
        reelLength: null,
        rctOverride: null,
        showAdvanced: false,
      })
    }
  })
  form.layers = newLayers
}

watch(() => form.ply, () => {
  const opts = getFluteOptions()
  if (!opts.includes(form.flute)) form.flute = opts[0]
  updateLayersForPly()
})

watch(() => form.flute, () => {
  form.layers.forEach((layer, idx) => {
    if (layer.name.toLowerCase().includes('flute')) layer.takeUp = getTakeUpForLayer(idx)
  })
})

function onPrintTypeChange() {
  if (form.printType === 'non-printed') form.printingCost = 0
}

function applyPreset(layerIdx: number, preset: { gsm: number; bf: number; rate: number }) {
  const layer = form.layers[layerIdx]
  layer.gsm = preset.gsm
  layer.bf = preset.bf
  layer.rate = preset.rate
}

function onPaperTypeChange(layerIdx: number) {
  const layer = form.layers[layerIdx]
  const paperData = PAPER_LIBRARY[layer.paperType as keyof typeof PAPER_LIBRARY]
  if (paperData?.presets.length) {
    const midIdx = Math.floor(paperData.presets.length / 2)
    applyPreset(layerIdx, paperData.presets[midIdx])
    layer.rate = paperData.typicalRate
    layer.color = paperData.defaultColor
  }
}

function toggleLayerAdvanced(idx: number) {
  form.layers[idx].showAdvanced = !form.layers[idx].showAdvanced
}

function canCalculate() {
  return form.customerName.trim() && form.boxName.trim()
}

function runCostCalculation() {
  if (!canCalculate()) {
    alert('Party Name aur Box Name required!')
    return
  }
  errors.value = []
  const res = liveResults.value
  if (!res) {
    errors.value = [liveError.value || 'Unable to calculate with current inputs.']
    showResults.value = false
    results.value = null
    return
  }
  results.value = res
  showResults.value = true
  localStorage.setItem('boxapp_lastform', JSON.stringify(form))
  nextTick(() => {
    document.getElementById('results-section')?.scrollIntoView({ behavior: 'smooth' })
  })
}

function generateSaveName() {
  const sanitize = (s: string) => s.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '')
  const party = sanitize(form.customerName) || 'Party'
  const box = sanitize(form.boxName) || 'Box'
  const lVal = form.dimensionUnit === 'inch' ? parseFloat(String(form.length)).toFixed(1) : Math.round(form.length)
  const wVal = form.dimensionUnit === 'inch' ? parseFloat(String(form.width)).toFixed(1) : Math.round(form.width)
  const hVal = form.dimensionUnit === 'inch' ? parseFloat(String(form.height)).toFixed(1) : Math.round(form.height)
  const dim = `${lVal}x${wVal}x${hVal}${form.dimensionUnit === 'inch' ? 'in' : 'mm'}`
  const rate = results.value?.cost?.sellingPrice ? `R${results.value.cost.sellingPrice.toFixed(2)}` : ''
  const weight = results.value?.weight?.boxTotal ? `W${Math.round(results.value.weight.boxTotal)}g` : ''
  const pr = form.printType === 'non-printed' ? 'NP' : 'P'
  return [party, box, dim, rate, weight, pr].filter(Boolean).join('_')
}

function openSaveModal() {
  if (!showResults.value) return alert('Pehle calculate karo!')
  if (!form.customerName.trim() || !form.boxName.trim()) return alert('Party + Box Name required')
  recipeNameInput.value = generateSaveName()
  showSaveModal.value = true
}

async function confirmSaveRecipe() {
  if (!recipeNameInput.value.trim()) return alert('Recipe name required')
  const recipeData: Omit<Recipe, 'id' | 'firm_id' | 'created_at' | 'updated_at' | 'is_deleted' | '_dirty'> = {
    name: recipeNameInput.value.trim(),
    customer_name: form.customerName.trim(),
    box_name: form.boxName.trim(),
    print_type: form.printType,
    dimension_unit: form.dimensionUnit,
    ply: form.ply,
    flute: form.flute,
    form: JSON.parse(JSON.stringify(form)),
    results: JSON.parse(JSON.stringify(results.value)),
  }
  try {
    await recipeStore.add(recipeData)
    await partyStore.ensure(form.customerName.trim(), 'customer')
    saveBoxName(form.boxName.trim())
    refreshBoxNames()
    showSaveModal.value = false
    saveStatus.value = 'Saved!'
    setTimeout(() => { saveStatus.value = '' }, 3000)
  } catch (err) {
    console.error(err)
    alert('Failed to save recipe.')
  }
}

function migrateCostFields(target: BoxCalcForm & { conversionCost?: number; shippingCost?: number; conversionCostPerKg?: number }) {
  if (!target.conversionSlabs?.length) {
    target.conversionSlabs = defaultConversionSlabs()
  }
  const legacyPerKg = target.conversionCostPerKg ?? target.conversionCost
  if (legacyPerKg != null && Number.isFinite(Number(legacyPerKg))) {
    const rate = Number(legacyPerKg)
    target.conversionSlabs = target.conversionSlabs.map((s) => ({ ...s, ratePerKg: rate }))
  }
  if (target.shippingCost != null && target.shippingCostPerKg == null) {
    target.shippingCostPerKg = Number(target.shippingCost)
  }
  delete target.conversionCost
  delete target.conversionCostPerKg
  delete (target as { shippingCost?: number }).shippingCost
}

function loadRecipe(rec: Recipe) {
  Object.assign(form, rec.form)
  migrateCostFields(form as BoxCalcForm & { conversionCost?: number; shippingCost?: number })
  if (!form.jobCard) form.jobCard = defaultJobCard(firmStore.activeFirm?.name || 'My Box Plant')
  results.value = rec.results
  showResults.value = true
  activeTab.value = 'calculator'
  updateLayersForPly()
}

async function deleteRecipe(rec: Recipe) {
  if (confirm(`Delete "${rec.name}"?`)) {
    await recipeStore.remove(rec.id)
  }
}

function openJobCardModal() {
  if (!results.value) return alert('Pehle calculate karo!')
  if (!form.jobCard!.jobNumber) form.jobCard!.jobNumber = generateJobNumber()
  if (!form.jobCard!.orderDate) form.jobCard!.orderDate = new Date().toISOString().split('T')[0]
  if (!form.jobCard!.deliveryDate) {
    const d = new Date()
    d.setDate(d.getDate() + 7)
    form.jobCard!.deliveryDate = d.toISOString().split('T')[0]
  }
  showJobCardModal.value = true
}

function generateJobCard() {
  if (!results.value) return
  if (!form.jobCard!.jobNumber) form.jobCard!.jobNumber = generateJobNumber()
  openJobCardPrintWindow({
    form: JSON.parse(JSON.stringify(form)),
    results: JSON.parse(JSON.stringify(results.value)),
    cureStatus: getCureStatus(form.jobCard),
    totalBundles: getTotalBundles(form.quantity, form.jobCard!.bundleSize),
    twoPlyCount: getTwoPlyCount(form.ply),
  })
  showJobCardModal.value = false
}

function printFromRecipe(rec: Recipe) {
  openJobCardPrintWindow({
    form: JSON.parse(JSON.stringify(rec.form)),
    results: JSON.parse(JSON.stringify(rec.results)),
    cureStatus: getCureStatus(rec.form?.jobCard),
    totalBundles: getTotalBundles(rec.form?.quantity || 0, rec.form?.jobCard?.bundleSize || 25),
    twoPlyCount: getTwoPlyCount(rec.ply),
  })
}

function printResults() { window.print() }

async function exportBoxcalcData() {
  try {
    const data = await exportAll()
    downloadBackup(data)
  } catch (e: any) {
    alert('Export failed: ' + e.message)
  }
}

function resetForm() {
  if (confirm('Form reset karna hai?')) {
    localStorage.removeItem('boxapp_lastform')
    Object.assign(form, initialFormState())
    updateLayersForPly()
    results.value = null
    showResults.value = false
  }
}

async function addToCatalogue() {
  if (!showResults.value || !results.value) return alert('Calculate first.')
  const itName = `${form.boxName.trim()} (${form.length}x${form.width}x${form.height} ${form.dimensionUnit})`
  const itSize = `${form.length}x${form.width}x${form.height} ${form.dimensionUnit}`
  const avgGsm = form.layers.reduce((s, l) => s + parseFloat(String(l.gsm)), 0)
  const avgBf = form.layers.reduce((s, l) => s + parseFloat(String(l.bf)), 0)
  await itemStore.ensure(itName, {
    rate: results.value.cost.sellingPrice,
    size: itSize,
    gsm: String(Math.round(avgGsm / form.layers.length)),
    bf: String(Math.round(avgBf / form.layers.length)),
    hsn: '48191000',
    unit: 'PCS',
    gst: 18,
  })
  alert(`Added to catalogue at ₹${results.value.cost.sellingPrice.toFixed(2)}`)
}

async function createSalesInvoice() {
  if (!showResults.value || !results.value) return alert('Calculate first.')
  if (!form.customerName.trim() || !form.boxName.trim()) return alert('Client + box name required.')
  const avgGsm = form.layers.reduce((s, l) => s + parseFloat(String(l.gsm)), 0)
  const avgBf = form.layers.reduce((s, l) => s + parseFloat(String(l.bf)), 0)
  const itName = `${form.boxName.trim()} (${form.length}x${form.width}x${form.height} ${form.dimensionUnit})`
  await partyStore.ensure(form.customerName.trim(), 'customer')
  sessionStorage.setItem('pama_billing_prefill', JSON.stringify({
    party_name: form.customerName.trim(),
    items: [{
      name: itName,
      hsn: '48191000',
      size: `${form.length}x${form.width}x${form.height} ${form.dimensionUnit}`,
      gsm: String(Math.round(avgGsm / Math.max(1, form.layers.length))),
      bf: String(Math.round(avgBf / Math.max(1, form.layers.length))),
      qty: form.quantity,
      unit: 'PCS',
      rate: results.value.cost.sellingPrice,
      gst: 18,
    }],
  }))
  router.push('/billing')
}

function refreshBoxNames() {
  savedBoxNames.value = loadSavedBoxNames(recipeStore.list.map((r) => r.box_name))
}

function onWhatsAppCopied(msg: string) {
  saveStatus.value = msg
  setTimeout(() => { saveStatus.value = '' }, 3000)
}

const filteredRecipes = computed(() => {
  const q = search.value.toLowerCase().trim()
  return recipeStore.list.filter((r) => {
    if (!q) return true
    return r.name.toLowerCase().includes(q) || r.customer_name.toLowerCase().includes(q) || r.box_name.toLowerCase().includes(q)
  })
})

onMounted(async () => {
  await recipeStore.load()
  await partyStore.load()
  await itemStore.load()
  updateLayersForPly()
  vendorPhones.value = loadRecentVendorPhones()
  refreshBoxNames()
  const saved = localStorage.getItem('boxapp_lastform')
  if (saved) {
    try {
      Object.assign(form, JSON.parse(saved))
      if (!form.jobCard) form.jobCard = defaultJobCard(firmStore.activeFirm?.name || 'My Box Plant')
      migrateCostFields(form as BoxCalcForm & { conversionCost?: number; shippingCost?: number })
      updateLayersForPly()
    } catch { /* */ }
  }
})
</script>

<template>
  <div class="p-4 sm:p-6 max-w-[90rem] mx-auto pb-24 md:pb-8 hide-on-print">
    <header class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-bold text-navy">BoxCalc Pro</h1>
        <p class="text-sm text-slate-500">Corrugated box calculator — full production & costing</p>
      </div>
      <div v-if="saveStatus" class="text-sm text-emerald-600 font-semibold">{{ saveStatus }}</div>
      <div class="flex bg-slate-200/80 p-1 rounded-lg self-start">
        <button v-for="tab in ['calculator', 'saved', 'settings'] as const" :key="tab"
          :class="['px-3 py-1.5 text-xs font-semibold rounded-md capitalize', activeTab === tab ? 'bg-white text-navy shadow-sm' : 'text-slate-600']"
          @click="activeTab = tab">
          {{ tab === 'calculator' ? 'Calculator' : tab === 'saved' ? `Saved (${recipeStore.list.length})` : 'Settings' }}
        </button>
      </div>
    </header>

    <datalist id="customerList">
      <option v-for="c in partyStore.list.filter(p => !p.is_deleted)" :key="c.id" :value="c.name" />
    </datalist>
    <datalist id="boxNamesList">
      <option v-for="name in savedBoxNames" :key="name" :value="name" />
    </datalist>

    <!-- CALCULATOR -->
    <div v-if="activeTab === 'calculator'">
      <!-- Party & Box -->
      <div class="pp-card p-4 mb-4 bg-gradient-to-r from-indigo-50 to-blue-50 border-indigo-200">
        <h2 class="font-bold text-indigo-900 mb-3">Party & Box Info</h2>
        <div class="grid md:grid-cols-2 gap-3">
          <div>
            <label class="pp-label">Party Name *</label>
            <input v-model="form.customerName" list="customerList" class="pp-input" placeholder="ABC Industries" />
          </div>
          <div>
            <label class="pp-label">Box Name *</label>
            <input v-model="form.boxName" list="boxNamesList" class="pp-input" placeholder="Standard Carton" />
          </div>
        </div>
        <div class="mt-3">
          <label class="pp-label">Print Type</label>
          <div class="grid grid-cols-2 gap-2 mt-1">
            <button type="button" :class="['py-2 rounded-lg text-sm font-medium', form.printType === 'printed' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-300']"
              @click="form.printType = 'printed'; onPrintTypeChange()">Printed</button>
            <button type="button" :class="['py-2 rounded-lg text-sm font-medium', form.printType === 'non-printed' ? 'bg-slate-700 text-white' : 'bg-white border border-slate-300']"
              @click="form.printType = 'non-printed'; onPrintTypeChange()">Non-Printed</button>
          </div>
        </div>
      </div>

      <div v-if="errors.length" class="mb-4 p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl">
        <p v-for="err in errors" :key="err" class="text-sm font-semibold">{{ err }}</p>
      </div>

      <div class="xl:grid xl:grid-cols-[minmax(0,1fr)_20rem] xl:gap-5 xl:items-start">
        <!-- Form column -->
        <div>
      <!-- 2-column form -->
      <div class="grid md:grid-cols-2 gap-4">
        <!-- LEFT -->
        <div class="space-y-4">
          <!-- Dimensions -->
          <div class="pp-card p-4">
            <h2 class="font-bold text-navy mb-3">Box Dimensions</h2>
            <div class="space-y-3">
              <div>
                <label class="pp-label">Input Unit</label>
                <div class="grid grid-cols-2 gap-2 mt-1">
                  <button type="button" :class="['py-2 rounded-lg text-sm', form.dimensionUnit === 'mm' ? 'bg-emerald-600 text-white' : 'bg-slate-100']"
                    @click="setDimensionUnit(form, 'mm')">mm</button>
                  <button type="button" :class="['py-2 rounded-lg text-sm', form.dimensionUnit === 'inch' ? 'bg-emerald-600 text-white' : 'bg-slate-100']"
                    @click="setDimensionUnit(form, 'inch')">inch</button>
                </div>
              </div>
              <div>
                <label class="pp-label">Dimension Type</label>
                <div class="grid grid-cols-2 gap-2 mt-1">
                  <button type="button" :class="['py-2 rounded-lg text-sm', form.dimType === 'inner' ? 'bg-blue-600 text-white' : 'bg-slate-100']"
                    @click="form.dimType = 'inner'">Inner</button>
                  <button type="button" :class="['py-2 rounded-lg text-sm', form.dimType === 'outer' ? 'bg-blue-600 text-white' : 'bg-slate-100']"
                    @click="form.dimType = 'outer'">Outer</button>
                </div>
              </div>
              <div class="grid grid-cols-3 gap-2">
                <div><label class="pp-label">L ({{ unitLabel(form.dimensionUnit) }})</label><input v-model.number="form.length" type="number" class="pp-input" /></div>
                <div><label class="pp-label">W</label><input v-model.number="form.width" type="number" class="pp-input" /></div>
                <div><label class="pp-label">H</label><input v-model.number="form.height" type="number" class="pp-input" /></div>
              </div>
            </div>
          </div>

          <!-- Construction -->
          <div class="pp-card p-4">
            <h2 class="font-bold text-navy mb-3">Construction</h2>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="pp-label">Ply</label>
                <select v-model="form.ply" class="pp-input"><option value="3-ply">3-Ply</option><option value="5-ply">5-Ply</option><option value="7-ply">7-Ply</option></select>
              </div>
              <div>
                <label class="pp-label">Flute</label>
                <select v-model="form.flute" class="pp-input"><option v-for="fl in getFluteOptions()" :key="fl" :value="fl">{{ fl }}</option></select>
              </div>
            </div>
            <div class="mt-2 text-xs text-slate-500">
              Caliper: <strong>{{ getCurrentCaliper(form) }} mm</strong>
              <button type="button" class="ml-2 text-blue-600 underline" @click="form.caliperOverride = form.caliperOverride ? null : getCurrentCaliper(form)">
                {{ form.caliperOverride ? 'Use Default' : 'Override' }}
              </button>
            </div>
            <input v-if="form.caliperOverride" v-model.number="form.caliperOverride" type="number" step="0.1" class="pp-input mt-2" placeholder="Custom caliper mm" />
            <div class="mt-3">
              <label class="pp-label">Glue Flap (mm, auto if empty)</label>
              <input v-model.number="form.glueFlap" type="number" class="pp-input" placeholder="Auto" />
            </div>
          </div>

          <!-- Layers -->
          <div class="pp-card p-4">
            <h2 class="font-bold text-navy mb-3">Paper Layers</h2>
            <div v-for="(layer, idx) in form.layers" :key="idx" class="border border-slate-200 rounded-lg p-3 mb-3 bg-slate-50">
              <div class="font-medium text-sm mb-2">{{ layer.name }}</div>
              <select v-model="layer.paperType" class="pp-input !py-1 text-xs mb-2" @change="onPaperTypeChange(idx)">
                <option v-for="(pd, key) in getPaperTypesForLayer(idx, form.layers)" :key="key" :value="key">{{ pd?.name ?? key }}</option>
              </select>
              <div class="flex flex-wrap gap-1 mb-2">
                <button v-for="preset in getPresetsForLayer(idx, form.layers).slice(0, 6)" :key="preset.gsm + '_' + preset.bf" type="button"
                  :class="['px-2 py-0.5 rounded text-xs', layer.gsm === preset.gsm && layer.bf === preset.bf ? 'bg-blue-600 text-white' : 'bg-white border']"
                  @click="applyPreset(idx, preset)">{{ preset.gsm }}/{{ preset.bf }}</button>
              </div>
              <div class="grid grid-cols-3 gap-1 mb-2">
                <div><label class="text-[10px]">GSM</label><input v-model.number="layer.gsm" type="number" class="pp-input !py-1 text-xs" /></div>
                <div><label class="text-[10px]">BF</label><input v-model.number="layer.bf" type="number" class="pp-input !py-1 text-xs" /></div>
                <div><label class="text-[10px]">Rate ₹/kg</label><input v-model.number="layer.rate" type="number" step="0.01" class="pp-input !py-1 text-xs" /></div>
              </div>
              <div class="mb-2">
                <label class="text-[10px]">Color</label>
                <select v-model="layer.color" class="pp-input !py-1 text-xs">
                  <option v-for="c in COMMON_PAPER_COLORS" :key="c" :value="c">{{ c }}</option>
                </select>
              </div>
              <div class="bg-indigo-50 border border-indigo-200 rounded p-2 text-[10px]">
                <div class="flex justify-between mb-1">
                  <span class="font-semibold text-indigo-900">BS / RCT</span>
                  <button type="button" class="text-indigo-600 underline" @click="toggleLayerAdvanced(idx)">{{ layer.showAdvanced ? 'Hide' : 'RCT Override' }}</button>
                </div>
                <div class="grid grid-cols-2 gap-1">
                  <div>BS: <span class="font-mono font-semibold">{{ getLayerBS(layer).toFixed(2) }} kg/cm²</span></div>
                  <div>RCT: <span class="font-mono font-semibold">{{ getLayerRCT(layer).toFixed(1) }} N</span></div>
                </div>
                <div v-if="layer.showAdvanced" class="mt-2 pt-2 border-t border-indigo-200">
                  <input v-model.number="layer.rctOverride" type="number" step="0.1" :placeholder="`Auto: ${getAutoRCT(layer).toFixed(1)}`" class="pp-input !py-1 text-xs" />
                  <button type="button" class="text-xs mt-1 underline" @click="layer.rctOverride = null">Reset</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- RIGHT -->
        <div class="space-y-4">
          <!-- Glue & Joining -->
          <div class="pp-card p-4">
            <h2 class="font-bold text-navy mb-3">Glue & Joining</h2>
            <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
              <div class="text-xs font-bold text-amber-900 mb-2">Starch Glue</div>
              <div class="grid grid-cols-2 gap-2">
                <div><label class="pp-label">GSM/line</label><input v-model.number="form.starchGSM" type="number" class="pp-input !py-1.5" /></div>
                <div><label class="pp-label">₹/kg</label><input v-model.number="form.starchRate" type="number" class="pp-input !py-1.5" /></div>
              </div>
            </div>
            <div class="mb-3">
              <label class="pp-label">Side Seam</label>
              <div class="grid grid-cols-3 gap-2 mt-1">
                <button v-for="m in ['stitching', 'fevicol', 'both'] as const" :key="m" type="button"
                  :class="['py-2 rounded-lg text-xs font-medium capitalize', form.joining.method === m ? 'bg-blue-600 text-white' : 'bg-slate-100']"
                  @click="form.joining.method = m">{{ m }}</button>
              </div>
            </div>
            <div v-if="form.joining.method !== 'fevicol'" class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
              <div class="text-xs font-bold mb-2">Stitching</div>
              <div class="grid grid-cols-3 gap-1 mb-2">
                <button v-for="p in ['', 'single', 'double'] as const" :key="p" type="button"
                  :class="['py-1 rounded text-xs', form.joining.pinHeadType === p ? 'bg-blue-600 text-white' : 'bg-white border']"
                  @click="form.joining.pinHeadType = p">{{ p || 'Auto' }}</button>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div class="bg-white border rounded p-2 text-xs">
                  <div class="text-slate-500">Pins (calc)</div>
                  <div class="font-bold">{{ liveResults?.pinInfo?.pins ?? '—' }} pins</div>
                </div>
                <div><label class="pp-label">Wire ₹/kg</label><input v-model.number="form.joining.wireRate" type="number" class="pp-input !py-1.5" /></div>
              </div>
            </div>
            <div v-if="form.joining.method !== 'stitching'" class="bg-green-50 border border-green-200 rounded-lg p-3">
              <div class="text-xs font-bold mb-2">Fevicol CWP</div>
              <div class="grid grid-cols-3 gap-2">
                <div><label class="pp-label">GSM</label><input v-model.number="form.joining.cwpGSM" type="number" class="pp-input !py-1.5" /></div>
                <div><label class="pp-label">Coverage</label><input v-model.number="form.joining.coverage" type="number" step="0.05" class="pp-input !py-1.5" /></div>
                <div><label class="pp-label">₹/kg</label><input v-model.number="form.joining.cwpRate" type="number" class="pp-input !py-1.5" /></div>
              </div>
            </div>
          </div>

          <!-- Costs -->
          <div class="pp-card p-4">
            <h2 class="font-bold text-navy mb-3">Costs & Pricing</h2>
            <div class="grid grid-cols-2 gap-2 mb-3">
              <div><label class="pp-label">Quantity</label><input v-model.number="form.quantity" type="number" class="pp-input" /></div>
              <div><label class="pp-label">Margin %</label><input v-model.number="form.marginPercent" type="number" :disabled="form.priceMode === 'custom'" class="pp-input" /></div>
            </div>
            <div class="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-3">
              <label class="pp-label font-bold">Selling Price Mode</label>
              <div class="grid grid-cols-2 gap-2 mt-1">
                <button type="button" :class="['py-2 rounded-lg text-sm', form.priceMode === 'auto' ? 'bg-emerald-600 text-white' : 'bg-white border']"
                  @click="form.priceMode = 'auto'; form.customSellingPrice = null">Auto (Margin%)</button>
                <button type="button" :class="['py-2 rounded-lg text-sm', form.priceMode === 'custom' ? 'bg-orange-600 text-white' : 'bg-white border']"
                  @click="form.priceMode = 'custom'">Custom Price</button>
              </div>
              <div v-if="form.priceMode === 'custom'" class="mt-2">
                <input v-model.number="form.customSellingPrice" type="number" step="0.01" class="pp-input font-bold" placeholder="₹/box" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div><label class="pp-label">Printing ₹/box</label><input v-model.number="form.printingCost" type="number" class="pp-input" /></div>
              <div><label class="pp-label">Shipping ₹/kg</label><input v-model.number="form.shippingCostPerKg" type="number" step="0.01" class="pp-input" /></div>
              <div><label class="pp-label">Waste %</label><input v-model.number="form.productionWastePercent" type="number" class="pp-input" /></div>
              <div><label class="pp-label">Scrap ₹/kg</label><input v-model.number="form.scrapRate" type="number" class="pp-input" /></div>
            </div>
            <div class="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div class="text-xs font-bold text-amber-900 mb-2">Conversion Slabs (₹/kg × finished box weight)</div>
              <div class="space-y-1.5">
                <div v-for="(slab, idx) in form.conversionSlabs" :key="idx" class="grid grid-cols-[1fr_5rem] gap-2 items-center text-xs">
                  <span class="text-amber-800 font-medium">{{ slab.label }}</span>
                  <input v-model.number="slab.ratePerKg" type="number" step="0.01" class="pp-input !py-1 text-xs" />
                </div>
              </div>
              <p v-if="liveResults?.cost?.conversionSlabLabel" class="text-[10px] text-amber-700 mt-2">
                Active: {{ liveResults.cost.conversionSlabLabel }} → ₹{{ liveResults.cost.conversionPerKg?.toFixed(0) }}/kg
              </p>
            </div>
          </div>

          <!-- Stacking -->
          <div class="pp-card p-4">
            <div class="flex items-center justify-between mb-3">
              <h2 class="font-bold text-navy">Stacking Check</h2>
              <input v-model="form.stackCheck.enabled" type="checkbox" class="rounded" />
            </div>
            <div v-if="form.stackCheck.enabled" class="space-y-2">
              <div class="grid grid-cols-2 gap-2">
                <div><label class="pp-label">Stack Height</label><input v-model.number="form.stackCheck.stackCount" type="number" class="pp-input" /></div>
                <div><label class="pp-label">Content kg/box</label><input v-model.number="form.stackCheck.contentWeight" type="number" class="pp-input" /></div>
              </div>
              <select v-model="form.stackingConditions.storage" class="pp-input text-xs">
                <option value="short">Short (1-2w)</option>
                <option value="medium">Medium (1-2m)</option>
                <option value="long">Long (3m+)</option>
              </select>
              <div class="flex flex-wrap gap-2 text-xs">
                <label><input v-model="form.stackingConditions.humid" type="checkbox" /> Humid</label>
                <label><input v-model="form.stackingConditions.transport" type="checkbox" /> Transport</label>
                <label><input v-model="form.stackingConditions.cold" type="checkbox" /> Cold</label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-6 hidden md:block">
        <button type="button" class="pp-btn pp-btn-primary w-full py-3 text-lg" @click="runCostCalculation">Calculate Box Specifications</button>
      </div>
        </div>

        <!-- Sticky live results (xl+) -->
        <aside class="hidden xl:block xl:sticky xl:top-4">
          <BoxCalcLivePanel :form="form" :results="liveResults" :error="liveError" />
        </aside>
      </div>

      <div class="xl:hidden mt-4">
        <BoxCalcLivePanel :form="form" :results="liveResults" :error="liveError" />
      </div>

      <BoxCalcResults
        v-if="showResults && results"
        :form="form"
        :results="results"
        @save="openSaveModal"
        @job-card="openJobCardModal"
        @print="printResults"
        @export-backup="exportBoxcalcData"
        @invoice="createSalesInvoice"
        @whatsapp="showWhatsAppModal = true"
        @catalogue="addToCatalogue"
      />
    </div>

    <!-- SAVED -->
    <div v-if="activeTab === 'saved'" class="space-y-4">
      <input v-model="search" class="pp-input max-w-xs" placeholder="Search recipes..." />
      <div class="pp-card overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th class="text-left px-4 py-2">Recipe</th>
              <th class="text-left px-4 py-2">Client</th>
              <th class="text-center px-4 py-2">Ply</th>
              <th class="text-right px-4 py-2">Rate</th>
              <th class="text-right px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!filteredRecipes.length"><td colspan="5" class="text-center py-10 text-slate-400">No saved recipes</td></tr>
            <tr v-for="rec in filteredRecipes" :key="rec.id" class="border-t border-slate-100 hover:bg-slate-50">
              <td class="px-4 py-2"><strong>{{ rec.name }}</strong><span class="block text-xs text-slate-400">{{ rec.box_name }}</span></td>
              <td class="px-4 py-2">{{ rec.customer_name }}</td>
              <td class="px-4 py-2 text-center">{{ rec.ply }}/{{ rec.flute }}</td>
              <td class="px-4 py-2 text-right font-bold">₹{{ rec.results?.cost?.sellingPrice?.toFixed(2) }}</td>
              <td class="px-4 py-2 text-right space-x-1">
                <button class="pp-btn pp-btn-ghost !px-2 !py-1 text-xs" title="Job Card" @click="printFromRecipe(rec)">Job Card</button>
                <button class="pp-btn pp-btn-success !py-1 text-xs" @click="loadRecipe(rec)">Load</button>
                <button class="pp-btn pp-btn-danger !px-2 !py-1 text-xs" @click="deleteRecipe(rec)">Del</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- SETTINGS -->
    <div v-if="activeTab === 'settings'" class="pp-card p-6 space-y-6">
      <h2 class="text-lg font-bold text-navy">Settings & Data</h2>
      <p class="text-sm text-slate-600">Full suite backup is in global Settings. Here: BoxCalc stats and form reset.</p>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div class="bg-slate-50 p-4 rounded-lg text-center">
          <div class="text-xs text-slate-500">Saved Recipes</div>
          <div class="text-2xl font-bold">{{ recipeStore.list.length }}</div>
        </div>
        <div class="bg-slate-50 p-4 rounded-lg text-center">
          <div class="text-xs text-slate-500">Box Names</div>
          <div class="text-2xl font-bold">{{ savedBoxNames.length }}</div>
        </div>
        <div class="bg-slate-50 p-4 rounded-lg text-center">
          <div class="text-xs text-slate-500">Parties</div>
          <div class="text-2xl font-bold">{{ partyStore.list.filter(p => !p.is_deleted).length }}</div>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="pp-btn pp-btn-primary" @click="exportBoxcalcData">Export Suite Backup</button>
        <button type="button" class="pp-btn pp-btn-danger" @click="resetForm">Reset Form</button>
      </div>
    </div>

    <!-- Modals -->
    <PpModal v-if="showSaveModal" title="Save Recipe" @close="showSaveModal = false">
      <div class="space-y-4">
        <div class="text-xs bg-green-50 border border-green-200 rounded p-3">
          Party: <strong>{{ form.customerName }}</strong> | Box: <strong>{{ form.boxName }}</strong>
        </div>
        <div>
          <label class="pp-label">Recipe Name</label>
          <textarea v-model="recipeNameInput" rows="2" class="pp-input font-mono" />
          <button type="button" class="text-xs text-blue-600 underline mt-1" @click="recipeNameInput = generateSaveName()">Re-generate</button>
        </div>
        <div class="flex justify-end gap-2">
          <button type="button" class="pp-btn pp-btn-ghost" @click="showSaveModal = false">Cancel</button>
          <button type="button" class="pp-btn pp-btn-primary" @click="confirmSaveRecipe">Save</button>
        </div>
      </div>
    </PpModal>

    <BoxCalcJobCardModal
      v-if="showJobCardModal"
      :form="form"
      :job-card="jobCard"
      @close="showJobCardModal = false"
      @generate="generateJobCard"
      @update:job-card="jobCard = $event"
      @update:customer-name="form.customerName = $event"
    />

    <BoxCalcWhatsAppModal
      v-if="showWhatsAppModal"
      :form="form"
      :results="results"
      :vendor-phones="vendorPhones"
      @close="showWhatsAppModal = false"
      @update:vendor-phones="vendorPhones = $event"
      @copied="onWhatsAppCopied"
    />

    <!-- Mobile sticky bar -->
    <div class="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 z-30 shadow-lg">
      <div class="grid grid-cols-4">
        <button type="button" class="py-2 text-xs" :class="activeTab === 'calculator' ? 'text-blue-600' : 'text-slate-500'" @click="activeTab = 'calculator'">Calc</button>
        <button type="button" class="py-2 text-xs bg-blue-600 text-white font-bold" @click="runCostCalculation">Calculate</button>
        <button type="button" class="py-2 text-xs" :class="activeTab === 'saved' ? 'text-blue-600' : 'text-slate-500'" @click="activeTab = 'saved'">Saved</button>
        <button type="button" class="py-2 text-xs" :class="activeTab === 'settings' ? 'text-blue-600' : 'text-slate-500'" @click="activeTab = 'settings'">Settings</button>
      </div>
    </div>
  </div>
</template>
