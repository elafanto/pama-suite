<script setup lang="ts">
import { computed } from 'vue'
import {
  fmt,
  fmtMoney,
  joiningMethodLabel,
  type BoxCalcForm,
} from '@/services/boxcalcUi'
import SheetCalcDetailPanel from '@/components/boxcalc/SheetCalcDetailPanel.vue'

const props = defineProps<{
  form: BoxCalcForm
  results: any | null
  error?: string | null
}>()

const hasResults = computed(() => {
  if (!props.results || props.results.error) return false
  if (props.results.calcMode === 'plainSheet') return (props.results.weight?.totalGm ?? 0) > 0
  return !!props.results.cost?.pricing
})
const isPlainSheet = computed(() => props.results?.calcMode === 'plainSheet')
const pricing = computed(() => props.results?.cost?.pricing)
const cost = computed(() => props.results?.cost)

const showPin = computed(() =>
  props.form.joining.method === 'stitching' || props.form.joining.method === 'both',
)
const showJoining = computed(() =>
  props.form.joining.method === 'fevicol' || props.form.joining.method === 'both',
)

type PricingRow = { label: string; perKg: number; perBox: number; bold?: boolean }

const mainRows = computed((): PricingRow[] => {
  const p = pricing.value
  const c = cost.value
  if (!p) return []
  const rows: PricingRow[] = [
    { label: 'Material', perKg: p.perKg.material, perBox: p.perBox.material },
    { label: 'Conversion', perKg: p.perKg.conversion, perBox: p.perBox.conversion },
    { label: 'Shipping', perKg: p.perKg.shipping, perBox: p.perBox.shipping, bold: true },
    { label: 'Subtotal (M+C+S)', perKg: p.perKg.subtotal, perBox: p.perBox.subtotal },
  ]
  // Box pricing per-kg is per kg of finished box (matches calculator).
  const boxKg = (props.results?.weight?.boxTotal ?? 0) / 1000
  if (c?.printing) {
    rows.push({
      label: 'Printing',
      perKg: boxKg > 0 ? c.printing / boxKg : 0,
      perBox: c.printing,
    })
  }
  rows.push(
    { label: `Margin (${fmt(c?.marginPercent, 1)}%)`, perKg: p.perKg.margin, perBox: p.perBox.margin },
    { label: 'Grand Total', perKg: p.perKg.grandTotal, perBox: p.perBox.grandTotal, bold: true },
  )
  return rows
})

const sheetRows = computed((): PricingRow[] => {
  const p = pricing.value
  if (!p?.sheet) return []
  return [
    { label: 'Material', perKg: p.sheet.perKg.material, perBox: p.sheet.perBox.material },
    { label: 'Conversion', perKg: p.sheet.perKg.conversion, perBox: p.sheet.perBox.conversion },
    { label: 'Shipping', perKg: p.sheet.perKg.shipping, perBox: p.sheet.perBox.shipping, bold: true },
    { label: 'Subtotal', perKg: p.sheet.perKg.subtotal, perBox: p.sheet.perBox.subtotal },
    { label: `Margin (${fmt(cost.value?.marginPercent, 1)}%)`, perKg: p.sheet.perKg.margin, perBox: p.sheet.perBox.margin },
    { label: 'Grand Total', perKg: p.sheet.perKg.grandTotal, perBox: p.sheet.perBox.grandTotal, bold: true },
  ]
})
</script>

<template>
  <aside class="pp-card p-4 border-indigo-200 bg-gradient-to-b from-slate-50 to-white shadow-md">
    <h2 class="font-bold text-navy text-sm mb-3 flex items-center gap-2">
      <span class="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
      Live Results
    </h2>

    <p v-if="error" class="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2 mb-3">{{ error }}</p>
    <p v-else-if="!hasResults" class="text-xs text-slate-500 py-6 text-center">
      {{ form.calcMode === 'plainSheet' ? 'Sheet size aur paper layers bharein.' : 'Enter dimensions and layers to see live pricing.' }}
    </p>

    <template v-else-if="isPlainSheet">
      <div class="grid grid-cols-2 gap-2 mb-3 text-xs">
        <div class="bg-teal-50 border border-teal-200 rounded-lg p-2 col-span-2">
          <div class="text-teal-700 font-medium">Sheet size</div>
          <div class="text-sm font-bold text-teal-900 font-mono">
            {{ Math.round(results.sheet?.lengthMm ?? 0) }} × {{ Math.round(results.sheet?.widthMm ?? 0) }} mm
          </div>
          <div class="text-[10px] text-teal-700 mt-0.5">{{ fmt(results.sheet?.areaM2, 4) }} m²</div>
        </div>
        <div class="bg-indigo-50 border border-indigo-200 rounded-lg p-2">
          <div class="text-indigo-700">Board GSM</div>
          <div class="text-lg font-bold text-indigo-900 font-mono">{{ fmt(results.weight?.boardGSM, 0) }}</div>
        </div>
        <div class="bg-emerald-50 border border-emerald-200 rounded-lg p-2">
          <div class="text-emerald-700">Total weight</div>
          <div class="text-lg font-bold text-emerald-900 font-mono">{{ fmt(results.weight?.totalGm, 1) }} gm</div>
          <div class="text-[10px] text-emerald-700">{{ fmt(results.weight?.totalKg, 3) }} kg</div>
        </div>
      </div>
      <div class="mb-2">
        <div class="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">Layer weights</div>
        <div class="space-y-1 text-[11px]">
          <div v-for="lw in results.weight?.layerWeights" :key="lw.name" class="flex justify-between text-slate-600">
            <span>{{ lw.name }} ({{ fmt(lw.gsm, 0) }} gsm × {{ fmt(lw.takeUp, 2) }})</span>
            <span class="font-mono">{{ fmt(lw.weightGm, 1) }} gm</span>
          </div>
          <div v-if="results.weight?.starchGm" class="flex justify-between text-slate-600">
            <span>Starch</span>
            <span class="font-mono">{{ fmt(results.weight.starchGm, 1) }} gm</span>
          </div>
          <div class="flex justify-between font-bold text-navy border-t border-slate-200 pt-1">
            <span>Total</span>
            <span class="font-mono">{{ fmt(results.weight?.totalGm, 1) }} gm</span>
          </div>
        </div>
      </div>
      <div v-if="results.cost?.materialCost" class="text-[11px] border-t border-slate-200 pt-2">
        <div class="flex justify-between text-slate-600">
          <span>Paper + starch cost</span>
          <span class="font-mono font-semibold">{{ fmtMoney(results.cost.materialCost) }}</span>
        </div>
        <div class="flex justify-between text-slate-500 mt-0.5">
          <span>₹/kg (material)</span>
          <span class="font-mono">{{ fmtMoney(results.cost.sheetRatePerKg) }}</span>
        </div>
      </div>
    </template>

    <template v-else>
      <!-- Header: GSM, joining, slab -->
      <div class="grid grid-cols-2 gap-2 mb-3 text-xs">
        <div class="bg-indigo-50 border border-indigo-200 rounded-lg p-2 col-span-2">
          <div class="text-indigo-700 font-medium">Board GSM</div>
          <div class="text-lg font-bold text-indigo-900 font-mono">{{ fmt(results.weight?.boardGSM, 0) }}</div>
        </div>
        <div class="bg-teal-50 border border-teal-200 rounded-lg p-2">
          <div class="text-teal-700">Box wt / Boxes/big</div>
          <div class="font-bold text-teal-900 font-mono">{{ fmt(results.weight?.boxTotal, 1) }} gm</div>
          <div class="text-xs text-teal-700 font-mono">{{ results.reel?.sheetsPerWidth }}w×{{ results.reel?.sheetsPerLength }}l={{ results.weight?.sheetsPerBigSheet }}</div>
        </div>
        <div class="bg-purple-50 border border-purple-200 rounded-lg p-2">
          <div class="text-purple-700">Sheet BS / BF</div>
          <div class="font-bold text-purple-900 font-mono">{{ fmt(results.strength?.combinedBS, 2) }} / {{ fmt(results.strength?.combinedBF, 0) }}</div>
        </div>
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-2">
          <div class="text-blue-700">Joining</div>
          <div class="font-bold text-blue-900">{{ joiningMethodLabel(form.joining.method) }}</div>
        </div>
        <div class="bg-amber-50 border border-amber-200 rounded-lg p-2">
          <div class="text-amber-700">Conversion slab</div>
          <div class="font-bold text-amber-900">{{ cost?.conversionSlabLabel }} @ ₹{{ fmt(cost?.conversionPerKg, 0) }}/kg</div>
        </div>
      </div>

      <div v-if="results.sheetCalcDetail" class="mb-3 border border-teal-200 rounded-lg p-2 bg-teal-50/30">
        <div class="text-[10px] font-bold uppercase text-teal-800 mb-1">Sheet size breakdown</div>
        <SheetCalcDetailPanel :detail="results.sheetCalcDetail" compact />
      </div>

      <!-- Material group -->
      <div class="mb-3">
        <div class="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Material</div>
        <div class="space-y-1 text-[11px]">
          <div class="flex justify-between text-slate-600">
            <span>Paper</span>
            <span class="font-mono">{{ fmtMoney(pricing?.material.paper) }}</span>
          </div>
          <div class="flex justify-between text-slate-600">
            <span>Starch</span>
            <span class="font-mono">{{ fmtMoney(pricing?.material.starch) }}</span>
          </div>
          <div v-if="showPin" class="flex justify-between text-slate-600">
            <span>Pin</span>
            <span class="font-mono">{{ fmtMoney(pricing?.material.pin) }}</span>
          </div>
          <div v-if="showJoining" class="flex justify-between text-slate-600">
            <span>{{ pricing?.material.joiningLabel }}</span>
            <span class="font-mono">{{ fmtMoney(pricing?.material.joining) }}</span>
          </div>
          <div v-if="pricing?.material.wastage" class="flex justify-between text-orange-600">
            <span>Wastage</span>
            <span class="font-mono">{{ fmtMoney(pricing?.material.wastage) }}</span>
          </div>
          <div class="flex justify-between font-semibold text-navy border-t border-slate-200 pt-1">
            <span>Material subtotal</span>
            <span class="font-mono">{{ fmtMoney(pricing?.material.subtotal) }}</span>
          </div>
        </div>
      </div>

      <!-- Conversion -->
      <div class="mb-2 text-[11px]">
        <div class="flex justify-between text-slate-600">
          <span>Conversion ({{ fmt(cost?.conversionPerKg, 0) }}/kg × {{ fmt(cost?.conversionPaperWeightKg, 3) }} kg box)</span>
          <span class="font-mono">{{ fmtMoney(pricing?.conversion.total) }}</span>
        </div>
      </div>

      <!-- Shipping: bold per box, small per kg -->
      <div class="mb-3 text-[11px]">
        <div class="flex justify-between items-baseline">
          <span class="text-slate-600">Shipping</span>
          <div class="text-right">
            <span class="font-mono font-bold text-navy">{{ fmtMoney(pricing?.perBox.shipping) }}</span>
            <span class="block text-[9px] text-slate-400 font-mono">{{ fmtMoney(pricing?.perKg.shipping) }}/kg</span>
          </div>
        </div>
      </div>

      <!-- Per KG | Per Box table -->
      <div class="mb-3">
        <div class="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">Box pricing</div>
        <table class="w-full text-[11px]">
          <thead>
            <tr class="text-slate-500 border-b border-slate-200">
              <th class="text-left py-1 font-medium">Line</th>
              <th class="text-right py-1 font-medium">Per KG</th>
              <th class="text-right py-1 font-medium">Per Box</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in mainRows" :key="row.label" class="border-b border-slate-100">
              <td class="py-1 text-slate-700">{{ row.label }}</td>
              <td class="py-1 text-right font-mono text-slate-500">{{ fmtMoney(row.perKg) }}</td>
              <td class="py-1 text-right font-mono" :class="row.bold ? 'font-bold text-navy' : ''">{{ fmtMoney(row.perBox) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Sheet pricing section -->
      <div class="border-t border-slate-200 pt-2">
        <div class="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">
          Sheet pricing <span class="font-normal normal-case text-slate-400">({{ fmt(results.weight?.sheetWeight, 1) }} gm)</span>
        </div>
        <table class="w-full text-[11px]">
          <thead>
            <tr class="text-slate-500 border-b border-slate-200">
              <th class="text-left py-1 font-medium">Line</th>
              <th class="text-right py-1 font-medium">Per KG</th>
              <th class="text-right py-1 font-medium">Per Box</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in sheetRows" :key="'sheet-' + row.label" class="border-b border-slate-100">
              <td class="py-1 text-slate-700">{{ row.label }}</td>
              <td class="py-1 text-right font-mono text-slate-500">{{ fmtMoney(row.perKg) }}</td>
              <td class="py-1 text-right font-mono" :class="row.bold ? 'font-bold text-navy' : ''">{{ fmtMoney(row.perBox) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </aside>
</template>
