<script setup lang="ts">
import { computed } from 'vue'
import {
  fmt,
  fmtInt,
  fmtMoney,
  getSheetDiagramSVG,
  getStrengthRating,
  joiningMethodLabel,
  type BoxCalcForm,
} from '@/services/boxcalcUi'

const props = defineProps<{
  form: BoxCalcForm
  results: any
}>()

defineEmits<{
  save: []
  jobCard: []
  print: []
  exportBackup: []
  invoice: []
  whatsapp: []
  catalogue: []
}>()

const diagramSvg = computed(() => getSheetDiagramSVG(props.results))

const boxWeightKg = computed(() => (props.results?.weight?.boxTotal || 0) / 1000)
/** Per-kg cost divisor matches calculator (layer paper weight, not finished box). */
const costPerKgDivisor = computed(
  () => props.results?.cost?.shippingPaperWeightKg ?? (props.results?.weight?.paperTotal || 0) / 1000,
)

const bigSheetWeightGm = computed(() => {
  const boardGSM = props.results?.weight?.boardGSM ?? 0
  const L = props.results?.sheet?.length ?? 0
  const W = props.results?.reel?.reelWidthMM ?? 0
  if (!boardGSM || !L || !W) return 0
  return boardGSM * (L * W) / 1_000_000
})

function perKgFromBoxWeight(perBox: number) {
  return boxWeightKg.value > 0 ? perBox / boxWeightKg.value : 0
}

function perKgFromCost(perBox: number) {
  return costPerKgDivisor.value > 0 ? perBox / costPerKgDivisor.value : 0
}

function stackRatingClass(passes: boolean) {
  return passes ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-red-50 border-red-300 text-red-800'
}

const showPin = computed(() =>
  props.form.joining.method === 'stitching' || props.form.joining.method === 'both',
)
const showJoining = computed(() =>
  props.form.joining.method === 'fevicol' || props.form.joining.method === 'both',
)

type DualRow = { label: string; perBox: number; perKg?: number; bold?: boolean; highlight?: string; negative?: boolean; weightPercent?: number | null; pricePercent?: number | null }

const weightRows = computed((): DualRow[] => {
  const w = props.results?.weight
  if (!w) return []
  return [
    { label: 'SHEET WEIGHT / box', perBox: w.sheetWeight, bold: true, highlight: 'teal' },
    { label: '− Trim Waste', perBox: w.trimPerBox, negative: true, highlight: 'red' },
    { label: '= Net Sheet', perBox: w.netSheetWeight, highlight: 'cyan' },
    { label: '− Slot Cutout', perBox: w.slotWaste, negative: true, highlight: 'orange' },
    {
      label: `+ Joining (${joiningMethodLabel(props.form.joining.method)})`,
      perBox: w.joining,
      highlight: 'blue',
    },
    { label: 'BOX WEIGHT (Final)', perBox: w.boxTotal, bold: true, highlight: 'green' },
  ].map((row) => ({ ...row, perKg: perKgFromBoxWeight(row.perBox) }))
})

type CostDualRow = DualRow & { shippingStyle?: boolean; marginNegative?: boolean }

const materialCostRows = computed((): CostDualRow[] => {
  const c = props.results?.cost
  const w = props.results?.weight
  if (!c) return []
  const materialSubtotal = c.materialSubtotal ?? 0
  const paperTotal = w?.paperTotal ?? 0
  const pct = (v: number, total: number) => total > 0 ? (v / total) * 100 : null
  const layers = c.layers ?? []
  const rows: CostDualRow[] = layers.map((layer: { name: string; cost: number }, idx: number) => ({
    label: layer.name,
    perBox: layer.cost ?? 0,
    weightPercent: pct(w?.layers?.[idx]?.weightGm ?? 0, paperTotal),
    pricePercent: pct(layer.cost ?? 0, materialSubtotal),
  }))
  rows.push({ label: 'Starch', perBox: c.starch ?? 0, weightPercent: null, pricePercent: pct(c.starch ?? 0, materialSubtotal) })
  if (showPin.value) rows.push({ label: 'Pin', perBox: c.pin ?? 0, weightPercent: null, pricePercent: pct(c.pin ?? 0, materialSubtotal) })
  if (showJoining.value) {
    rows.push({ label: c.joiningLabel || 'Fevicol', perBox: c.joining ?? 0, weightPercent: null, pricePercent: pct(c.joining ?? 0, materialSubtotal) })
  }
  if (c.wastage) rows.push({ label: 'Wastage', perBox: c.wastage, highlight: 'orange', weightPercent: null, pricePercent: pct(c.wastage, materialSubtotal) })
  rows.push({ label: 'Material Subtotal', perBox: materialSubtotal, bold: true, weightPercent: null, pricePercent: null })
  return rows.map((row) => ({ ...row, perKg: perKgFromCost(row.perBox) }))
})

const costRowsAfterMaterial = computed((): CostDualRow[] => {
  const c = props.results?.cost
  if (!c) return []
  const rows: CostDualRow[] = [
    {
      label: `Conversion (${fmt(c.conversionPerKg, 0)}/kg × ${fmt(c.conversionPaperWeightKg ?? c.conversionBoxWeightKg, 3)} kg box)`,
      perBox: c.conversion ?? 0,
    },
    { label: 'Shipping', perBox: c.shipping ?? 0, shippingStyle: true },
    { label: 'Subtotal (Material + Conversion + Shipping)', perBox: c.pricingSubtotal ?? 0, bold: true },
  ]
  if (c.printing) rows.push({ label: 'Printing', perBox: c.printing })
  rows.push({
    label: `Margin (${fmt(c.marginPercent, 1)}%)`,
    perBox: c.margin ?? 0,
    marginNegative: (c.margin ?? 0) < 0,
  })
  rows.push({ label: 'SELLING PRICE', perBox: c.sellingPrice ?? 0, bold: true, highlight: 'sell' })
  return rows.map((row) => ({ ...row, perKg: perKgFromCost(row.perBox) }))
})
</script>

<template>
  <div id="results-section" class="mt-6 space-y-4 print-section">
    <!-- Summary cards -->
    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3">
      <div class="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white rounded-xl p-4 shadow">
        <div class="text-xs opacity-90">Board GSM</div>
        <div class="text-xl font-bold mt-1">{{ fmtInt(results?.weight?.boardGSM) }}</div>
        <div class="text-xs opacity-90 mt-1">combined sheet</div>
      </div>
      <div class="bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl p-4 shadow">
        <div class="text-xs opacity-90">Selling Price</div>
        <div class="text-xl font-bold mt-1">{{ fmtMoney(results?.cost?.sellingPrice) }}</div>
        <div class="text-xs opacity-90 mt-1">per box</div>
      </div>
      <div class="bg-gradient-to-br from-teal-500 to-teal-600 text-white rounded-xl p-4 shadow">
        <div class="text-xs opacity-90">Sheet Weight</div>
        <div class="text-xl font-bold mt-1">{{ fmt(results?.weight?.sheetWeight, 1) }} gm</div>
        <div class="text-xs opacity-90 mt-1">with trim share</div>
      </div>
      <div class="bg-gradient-to-br from-red-500 to-orange-500 text-white rounded-xl p-4 shadow">
        <div class="text-xs opacity-90">Trim Waste</div>
        <div class="text-xl font-bold mt-1">{{ fmt(results?.weight?.trimPercent, 2) }}%</div>
        <div class="text-xs opacity-90 mt-1">{{ fmt(results?.weight?.trimPerBox, 2) }} gm/box</div>
      </div>
      <div class="bg-gradient-to-br from-green-500 to-green-600 text-white rounded-xl p-4 shadow">
        <div class="text-xs opacity-90">Box Weight</div>
        <div class="text-xl font-bold mt-1">{{ fmt(results?.weight?.boxTotal, 1) }} gm</div>
        <div class="text-xs opacity-90 mt-1">{{ fmt((results?.weight?.boxTotal || 0) / 1000, 3) }} kg</div>
      </div>
      <div class="bg-gradient-to-br from-amber-500 to-amber-600 text-white rounded-xl p-4 shadow">
        <div class="text-xs opacity-90">Sheet Size</div>
        <div class="text-sm font-bold mt-1">{{ fmtInt(results?.sheet?.length) }} × {{ fmtInt(results?.sheet?.width) }} indiv</div>
        <div class="text-sm font-bold">{{ fmtInt(results?.sheet?.length) }} × {{ fmtInt(results?.reel?.reelWidthMM) }} big</div>
        <div class="text-[10px] opacity-90 mt-1">{{ results?.weight?.sheetsPerBigSheet }} box/big | {{ fmt(bigSheetWeightGm, 0) }} gm</div>
      </div>
      <div class="bg-gradient-to-br from-purple-500 to-purple-600 text-white rounded-xl p-4 shadow">
        <div class="text-xs opacity-90">Order Value</div>
        <div class="text-lg font-bold mt-1">{{ fmtMoney(results?.order?.totalValue) }}</div>
        <div class="text-xs opacity-90 mt-1">{{ results?.order?.quantity }} boxes</div>
      </div>
      <div class="bg-gradient-to-br from-cyan-500 to-cyan-600 text-white rounded-xl p-4 shadow">
        <div class="text-xs opacity-90">Sheet ₹/kg</div>
        <div class="text-xl font-bold mt-1">{{ fmtMoney(results?.cost?.sheetRatePerKg) }}</div>
        <div class="text-xs opacity-90 mt-1">paper cost basis</div>
      </div>
      <div class="bg-gradient-to-br from-violet-500 to-violet-600 text-white rounded-xl p-4 shadow">
        <div class="text-xs opacity-90">Box ₹/kg</div>
        <div class="text-xl font-bold mt-1">{{ fmtMoney(results?.cost?.boxRatePerKg) }}</div>
        <div class="text-xs opacity-90 mt-1">selling price basis</div>
      </div>
      <div class="bg-gradient-to-br from-rose-500 to-rose-600 text-white rounded-xl p-4 shadow">
        <div class="text-xs opacity-90">Sheet BS</div>
        <div class="text-xl font-bold mt-1">{{ fmt(results?.strength?.combinedBS, 2) }}</div>
        <div class="text-xs opacity-90 mt-1">kg/cm² combined</div>
      </div>
      <div class="bg-gradient-to-br from-lime-500 to-lime-600 text-white rounded-xl p-4 shadow">
        <div class="text-xs opacity-90">Sheet BF</div>
        <div class="text-xl font-bold mt-1">{{ fmtInt(results?.strength?.combinedBF) }}</div>
        <div class="text-xs opacity-90 mt-1">wtd avg of plies</div>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex flex-wrap gap-2 hide-on-print">
      <button type="button" class="pp-btn pp-btn-success" @click="$emit('save')">Save Recipe</button>
      <button type="button" class="pp-btn pp-btn-primary" @click="$emit('jobCard')">Job Card</button>
      <button type="button" class="pp-btn pp-btn-ghost" @click="$emit('print')">Print</button>
      <button type="button" class="pp-btn pp-btn-ghost" @click="$emit('exportBackup')">Export Backup</button>
      <button type="button" class="pp-btn pp-btn-primary" @click="$emit('invoice')">Create Invoice</button>
      <button type="button" class="pp-btn pp-btn-ghost" @click="$emit('catalogue')">Add to Catalogue</button>
    </div>

    <!-- Pin info -->
    <div v-if="results?.pinInfo && form.joining.method !== 'fevicol'" class="pp-card p-4 bg-blue-50 border-blue-200">
      <h4 class="font-bold text-blue-900 text-sm mb-1">Pin / Stitching Info</h4>
      <div class="text-sm text-blue-800">
        {{ results.pinInfo.pins }} pins ({{ results.pinInfo.headType }} head, {{ results.pinInfo.spacing }}mm spacing)
      </div>
    </div>

    <!-- Warnings -->
    <div v-if="results?.warnings?.length" class="bg-yellow-50 border-l-4 border-yellow-500 p-3 rounded">
      <p v-for="(warn, i) in results.warnings" :key="i" class="text-sm text-yellow-800">⚠️ {{ warn }}</p>
    </div>

    <!-- Dimensions -->
    <div class="pp-card p-4 print-section">
      <h3 class="font-bold text-navy mb-3">Dimensions</h3>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div class="bg-slate-50 p-3 rounded-lg">
          <div class="text-xs text-slate-500 font-medium">INNER</div>
          <div class="font-mono mt-1">
            L: {{ fmtInt(results?.dimensions?.inner?.L) }}<br>
            W: {{ fmtInt(results?.dimensions?.inner?.W) }}<br>
            H: {{ fmtInt(results?.dimensions?.inner?.H) }}
          </div>
        </div>
        <div class="bg-slate-50 p-3 rounded-lg">
          <div class="text-xs text-slate-500 font-medium">OUTER</div>
          <div class="font-mono mt-1">
            L: {{ fmtInt(results?.dimensions?.outer?.L) }}<br>
            W: {{ fmtInt(results?.dimensions?.outer?.W) }}<br>
            H: {{ fmtInt(results?.dimensions?.outer?.H) }}
          </div>
        </div>
        <div class="bg-blue-50 border border-blue-200 p-3 rounded-lg">
          <div class="text-xs text-blue-700 font-medium">INDIVIDUAL SHEET</div>
          <div class="font-mono mt-1">
            L: {{ fmtInt(results?.sheet?.length) }}<br>
            W: {{ fmtInt(results?.sheet?.width) }}<br>
            Area: {{ fmt(results?.sheet?.areaM2, 4) }} m²
          </div>
        </div>
        <div class="bg-amber-50 border border-amber-200 p-3 rounded-lg">
          <div class="text-xs text-amber-900 font-bold">BIG SHEET</div>
          <div class="font-mono mt-1 text-sm">
            L: {{ fmtInt(results?.sheet?.length) }} mm<br>
            W: {{ fmtInt(results?.reel?.reelWidthMM) }} mm<br>
            Trim: {{ fmtInt(results?.reel?.totalTrimMM) }} mm ({{ fmt(results?.weight?.trimPercent, 1) }}%)<br>
            <span class="font-bold text-amber-900">Wt: {{ fmt(bigSheetWeightGm, 0) }} gm</span>
          </div>
        </div>
      </div>
      <div class="mt-3 text-xs text-slate-500">
        Construction: <strong>{{ results?.construction?.type }}</strong> |
        Caliper: <strong>{{ results?.caliper }} mm</strong> |
        Glue Flap: <strong>{{ results?.glueFlap }} mm</strong>
      </div>
    </div>

    <!-- Sheet diagram -->
    <div class="pp-card p-4 print-section">
      <h3 class="font-bold text-navy mb-3">Sheet Layout Diagram</h3>
      <div class="overflow-x-auto" v-html="diagramSvg" />
      <div class="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div class="bg-blue-50 border border-blue-200 rounded p-2">
          <div class="font-bold text-blue-900 mb-1">Creasing</div>
          <div>W1: {{ fmt(results?.machineSetup?.creases?.topCrease, 1) }} mm</div>
          <div>W2: {{ fmt(results?.machineSetup?.creases?.bottomCrease, 1) }} mm</div>
        </div>
        <div class="bg-indigo-50 border border-indigo-200 rounded p-2">
          <div class="font-bold text-indigo-900 mb-1">Slots</div>
          <div v-for="(slot, idx) in results?.machineSetup?.slots?.slots" :key="idx">
            Slot {{ Number(idx) + 1 }}: {{ fmt(slot, 1) }} mm
          </div>
        </div>
      </div>
    </div>

    <!-- Reel order -->
    <div class="pp-card p-4 print-section">
      <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 class="font-bold text-navy">Reel Order</h3>
        <button type="button" class="pp-btn pp-btn-success !py-1.5 text-xs hide-on-print" @click="$emit('whatsapp')">
          WhatsApp Send
        </button>
      </div>

      <div class="bg-gradient-to-r from-emerald-50 to-teal-50 border-2 border-emerald-300 rounded-lg p-4 mb-3">
        <div class="flex justify-between flex-wrap gap-2">
          <div>
            <div class="text-xs text-emerald-700">RECOMMENDED REEL WIDTH</div>
            <div class="text-3xl font-bold text-emerald-900">{{ results?.reel?.reelWidthMM }} mm</div>
            <div class="text-xs text-emerald-700">{{ fmt((results?.reel?.reelWidthMM || 0) / 25.4, 2) }} inches</div>
          </div>
          <div class="text-right">
            <div class="text-xs text-emerald-700">Sheets per width</div>
            <div class="text-2xl font-bold text-emerald-900">{{ results?.reel?.sheetsPerWidth }}</div>
            <div class="text-xs text-emerald-700">Util: {{ fmt(results?.reel?.utilizationPercent, 1) }}%</div>
          </div>
        </div>
      </div>

      <div class="bg-slate-50 rounded p-3 mb-3">
        <div class="text-xs font-bold text-slate-700 mb-2">Slitter Blade Positions (mm):</div>
        <div class="flex flex-wrap gap-1 text-xs font-mono">
          <span
            v-for="(blade, idx) in results?.machineSetup?.slitterBlades"
            :key="idx"
            class="bg-white border border-slate-300 px-2 py-1 rounded"
          >B{{ Number(idx) + 1 }}: {{ blade }}mm</span>
        </div>
      </div>

      <div class="bg-blue-50 border border-blue-200 rounded p-3 mb-3 overflow-x-auto">
        <div class="text-xs font-bold text-blue-900 mb-2">Multi-Sheet Crease Positions</div>
        <table class="w-full text-xs">
          <thead class="bg-blue-100">
            <tr>
              <th class="p-1 text-center">Sheet #</th>
              <th class="p-1 text-right">Left Edge</th>
              <th class="p-1 text-right">W1</th>
              <th class="p-1 text-right">W2</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="sheet in results?.machineSetup?.multiSheetCreases" :key="sheet.sheetNumber" class="border-b border-blue-100">
              <td class="p-1 text-center font-bold">{{ sheet.sheetNumber }}</td>
              <td class="p-1 text-right font-mono">{{ fmtInt(sheet.sheetLeftEdge) }} mm</td>
              <td class="p-1 text-right font-mono font-bold text-blue-700">{{ fmtInt(sheet.w1Machine) }} mm</td>
              <td class="p-1 text-right font-mono font-bold text-blue-700">{{ fmtInt(sheet.w2Machine) }} mm</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead class="bg-slate-100">
            <tr>
              <th class="text-left p-2">Layer</th>
              <th class="text-right p-2">GSM/BF</th>
              <th class="text-left p-2">Color</th>
              <th class="text-right p-2">Reel Size</th>
              <th class="text-right p-2">Reel kg</th>
              <th class="text-right p-2">Reels</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(order, idx) in results?.reelOrders" :key="idx" class="border-b border-slate-100">
              <td class="p-2 font-medium">{{ order.name }}</td>
              <td class="p-2 text-right font-mono">{{ order.gsm }}/{{ order.bf }}</td>
              <td class="p-2">{{ form.layers[Number(idx)]?.color || '-' }}</td>
              <td class="p-2 text-right font-mono">{{ results.reel.reelWidthMM }}mm × {{ order.reelLengthM || 4000 }}m</td>
              <td class="p-2 text-right font-mono">{{ fmt(order.reelWeightKg, 0) }}</td>
              <td class="p-2 text-right font-bold text-blue-700">{{ order.reelsToOrder }} reel{{ order.reelsToOrder > 1 ? 's' : '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Strength -->
    <div class="pp-card p-4 print-section">
      <h3 class="font-bold text-navy mb-3">Strength Analysis</h3>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <div class="bg-blue-50 border border-blue-200 p-3 rounded">
          <div class="text-xs text-blue-800 font-medium">ECT</div>
          <div class="font-bold text-blue-900">{{ fmt(results?.strength?.ect, 2) }} kN/m</div>
        </div>
        <div class="bg-indigo-50 border border-indigo-200 p-3 rounded">
          <div class="text-xs text-indigo-800 font-medium">BCT</div>
          <div class="font-bold text-indigo-900">{{ fmt(results?.strength?.bct?.bctKg, 1) }} kg</div>
        </div>
        <div class="bg-purple-50 border border-purple-200 p-3 rounded">
          <div class="text-xs text-purple-800 font-medium">Safe Load</div>
          <div class="font-bold text-purple-900">{{ fmt(results?.strength?.safeStack?.safeLoadKg, 1) }} kg</div>
        </div>
        <div class="bg-pink-50 border border-pink-200 p-3 rounded">
          <div class="text-xs text-pink-800 font-medium">Eff. SF</div>
          <div class="font-bold text-pink-900">{{ fmt(results?.strength?.safeStack?.effectiveSF, 2) }}</div>
        </div>
      </div>
      <div v-if="results?.strength?.stackValidation" :class="['border-2 rounded-lg p-3', stackRatingClass(results.strength.stackValidation.passes)]">
        <div class="flex justify-between items-center">
          <div>
            <div class="font-bold text-lg">{{ results.strength.stackValidation.passes ? 'PASS' : 'FAIL' }}</div>
            <div class="text-sm">
              Load: {{ fmt(results.strength.stackValidation.loadKg, 1) }} kg /
              Safe: {{ fmt(results.strength.stackValidation.safeLoadKg, 1) }} kg
            </div>
          </div>
          <div class="text-right">
            <div class="text-xs">Utilization</div>
            <div class="text-2xl font-bold">{{ fmt(results.strength.stackValidation.utilizationPercent, 1) }}%</div>
            <div class="text-xs font-medium">{{ getStrengthRating(results.strength.stackValidation.utilizationPercent).text }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Weight breakdown -->
    <div class="pp-card p-4 print-section">
      <h3 class="font-bold text-navy mb-3">Weight Breakdown</h3>
      <details class="mb-2 text-sm">
        <summary class="cursor-pointer text-slate-600 text-xs font-medium">Paper layer breakdown (click to expand)</summary>
        <table class="w-full text-xs mt-2">
          <thead>
            <tr class="text-slate-500 border-b border-slate-200">
              <th class="text-left py-1 pl-2 font-medium">Layer</th>
              <th class="text-right py-1 font-medium">Per Box</th>
              <th class="text-right py-1 pr-2 font-medium">Per KG</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(layer, idx) in results?.weight?.layers" :key="idx" class="border-b border-slate-100">
              <td class="py-1.5 pl-2">{{ layer.name }}</td>
              <td class="py-1.5 text-right font-mono">{{ fmt(layer.weightGm, 2) }} gm</td>
              <td class="py-1.5 pr-2 text-right font-mono text-slate-500">{{ fmt(perKgFromBoxWeight(layer.weightGm), 1) }} gm/kg</td>
            </tr>
            <tr class="bg-slate-50">
              <td class="py-1.5 pl-2 font-semibold">Paper Subtotal</td>
              <td class="py-1.5 text-right font-mono font-semibold">{{ fmt(results?.weight?.paperTotal, 2) }} gm</td>
              <td class="py-1.5 pr-2 text-right font-mono font-semibold text-slate-600">{{ fmt(perKgFromBoxWeight(results?.weight?.paperTotal || 0), 1) }} gm/kg</td>
            </tr>
          </tbody>
        </table>
      </details>
      <table class="w-full text-sm">
        <thead>
          <tr class="text-slate-500 border-b border-slate-200">
            <th class="text-left py-1.5 font-medium">Line</th>
            <th class="text-right py-1.5 font-medium">Per Box</th>
            <th class="text-right py-1.5 font-medium">Per KG</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in weightRows"
            :key="row.label"
            :class="[
              row.highlight === 'teal' ? 'bg-teal-50 border-y-2 border-teal-400' : '',
              row.highlight === 'red' ? 'border-b bg-red-50/50' : '',
              row.highlight === 'cyan' ? 'bg-cyan-50 border-y border-cyan-200' : '',
              row.highlight === 'orange' ? 'border-b' : '',
              row.highlight === 'blue' ? 'border-b' : '',
              row.highlight === 'green' ? 'bg-green-50 border-y-2 border-green-500' : '',
              !row.highlight ? 'border-b border-slate-100' : '',
            ]"
          >
            <td
              class="py-2 pl-1"
              :class="{
                'font-bold text-teal-900 py-2.5': row.highlight === 'teal',
                'text-red-700': row.highlight === 'red',
                'text-cyan-900 font-semibold': row.highlight === 'cyan',
                'text-orange-700 text-xs': row.highlight === 'orange',
                'text-blue-700': row.highlight === 'blue',
                'font-bold text-green-900 py-2.5': row.highlight === 'green',
              }"
            >{{ row.label }}</td>
            <td
              class="py-2 text-right font-mono"
              :class="{
                'font-bold text-teal-900 text-lg py-2.5': row.highlight === 'teal',
                'text-red-700': row.highlight === 'red',
                'font-semibold text-cyan-900': row.highlight === 'cyan',
                'text-orange-700 text-xs': row.highlight === 'orange',
                'text-blue-700': row.highlight === 'blue',
                'font-bold text-green-900 text-lg py-2.5': row.highlight === 'green',
              }"
            >
              <span v-if="row.negative">− </span><span v-else-if="row.highlight === 'blue' || row.highlight === 'green'">+ </span>{{ fmt(row.perBox, 2) }} gm
            </td>
            <td
              class="py-2 text-right font-mono text-slate-500"
              :class="{
                'font-bold text-teal-800 py-2.5': row.highlight === 'teal',
                'text-red-600': row.highlight === 'red',
                'text-cyan-800': row.highlight === 'cyan',
                'text-orange-600 text-xs': row.highlight === 'orange',
                'text-blue-600': row.highlight === 'blue',
                'font-bold text-green-800 py-2.5': row.highlight === 'green',
              }"
            >
              <span v-if="row.negative">− </span>{{ fmt(row.perKg, 1) }} gm/kg
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Cost breakdown -->
    <div class="pp-card p-4 print-section">
      <h3 class="font-bold text-navy mb-3">Cost Breakdown</h3>

      <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-slate-600 border-b-2 border-slate-200">
            <th class="text-left py-1.5 font-medium">Line</th>
            <th class="text-right py-1.5 font-medium">Per Box (₹)</th>
            <th class="text-right py-1.5 font-medium">Per KG (₹)</th>
            <th class="text-right py-1.5 font-medium hidden sm:table-cell text-[11px]">Wt %</th>
            <th class="text-right py-1.5 font-medium hidden sm:table-cell text-[11px]">₹ %</th>
          </tr>
        </thead>
        <tbody>
          <tr class="bg-slate-100">
            <td colspan="5" class="py-1.5 pl-2 text-xs font-bold uppercase text-slate-700">Material</td>
          </tr>
          <tr
            v-for="row in materialCostRows"
            :key="'mat-' + row.label"
            :class="[
              'border-b border-slate-100',
              row.bold ? 'bg-slate-50' : '',
              row.highlight === 'orange' ? 'text-orange-700' : '',
            ]"
          >
            <td class="py-1.5 pl-2" :class="row.bold ? 'font-semibold' : 'text-slate-700'">{{ row.label }}</td>
            <td class="py-1.5 text-right font-mono" :class="row.bold ? 'font-semibold' : ''">{{ fmtMoney(row.perBox) }}</td>
            <td class="py-1.5 text-right font-mono text-slate-600" :class="row.bold ? 'font-semibold' : ''">{{ fmtMoney(row.perKg) }}</td>
            <td class="py-1.5 text-right font-mono text-slate-500 hidden sm:table-cell text-[11px]">
              {{ row.weightPercent != null ? fmt(row.weightPercent, 1) + '%' : '—' }}
            </td>
            <td class="py-1.5 text-right font-mono hidden sm:table-cell text-[11px]"
              :class="row.bold ? 'font-semibold text-slate-600' : 'text-slate-500'">
              {{ row.pricePercent != null ? fmt(row.pricePercent, 1) + '%' : (row.bold ? '100%' : '—') }}
            </td>
          </tr>
          <tr
            v-for="row in costRowsAfterMaterial"
            :key="row.label"
            :class="[
              'border-b border-slate-100',
              row.bold && row.highlight !== 'sell' ? 'bg-slate-100' : '',
              row.marginNegative ? 'bg-red-50' : '',
              row.highlight === 'sell' ? (results?.cost?.priceMode === 'custom' ? 'bg-orange-50' : 'bg-green-50') : '',
            ]"
          >
            <td
              class="py-2 pl-1"
              :class="{
                'font-semibold': row.bold && row.highlight !== 'sell',
                'text-red-700': row.marginNegative,
                'text-green-700': row.label.startsWith('Margin') && !row.marginNegative,
                'font-bold text-lg': row.highlight === 'sell',
              }"
            >
              {{ row.label }}
              <span v-if="row.label.startsWith('Conversion')" class="text-xs text-slate-500 ml-1">{{ results?.cost?.conversionSlabLabel }}</span>
            </td>
            <td
              class="py-2 text-right"
              :class="{
                'font-mono font-semibold': row.bold && row.highlight !== 'sell',
                'text-red-700 font-bold font-mono': row.marginNegative,
                'text-green-700 font-mono': row.label.startsWith('Margin') && !row.marginNegative,
                'font-mono font-bold text-lg': row.highlight === 'sell',
              }"
            >
              <template v-if="row.shippingStyle">
                <span class="font-mono font-bold text-navy">{{ fmtMoney(row.perBox) }}</span>
              </template>
              <template v-else>
                <span class="font-mono" :class="row.bold ? 'font-bold' : ''">{{ fmtMoney(row.perBox) }}</span>
              </template>
            </td>
            <td
              class="py-2 text-right font-mono text-slate-600"
              :class="{
                'font-semibold': row.bold && row.highlight !== 'sell',
                'text-red-600': row.marginNegative,
                'text-green-600': row.label.startsWith('Margin') && !row.marginNegative,
                'font-bold text-slate-700': row.highlight === 'sell',
              }"
            >
              <template v-if="row.shippingStyle">
                <span class="text-[10px]">{{ fmtMoney(row.perKg) }}</span>
              </template>
              <template v-else>
                {{ fmtMoney(row.perKg) }}
              </template>
            </td>
            <td class="hidden sm:table-cell" />
            <td class="hidden sm:table-cell" />
          </tr>
        </tbody>
      </table>
      </div>
    </div>

    <!-- Order total -->
    <div class="bg-gradient-to-r from-blue-600 to-indigo-700 text-white rounded-xl shadow-lg p-5 print-section">
      <h3 class="font-bold text-lg mb-3">Order Total</h3>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <div class="text-xs opacity-90">Quantity</div>
          <div class="text-2xl font-bold">{{ results?.order?.quantity }}</div>
        </div>
        <div>
          <div class="text-xs opacity-90">Total Weight</div>
          <div class="text-2xl font-bold">{{ fmt(results?.order?.totalWeightKg, 1) }} kg</div>
        </div>
        <div>
          <div class="text-xs opacity-90">Total Cost</div>
          <div class="text-2xl font-bold">{{ fmtMoney(results?.order?.totalCost) }}</div>
        </div>
        <div>
          <div class="text-xs opacity-90">Total Value</div>
          <div class="text-2xl font-bold text-yellow-200">{{ fmtMoney(results?.order?.totalValue) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
