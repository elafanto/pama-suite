<script setup lang="ts">
import { computed } from 'vue'
import {
  fmt,
  fmtMoney,
  paperTypeLabel,
  type BoxCalcForm,
} from '@/services/boxcalcUi'

const props = defineProps<{
  form: BoxCalcForm
  results: any | null
  error?: string | null
}>()

const hasResults = computed(() => props.results && !props.results.error && props.results.cost)
</script>

<template>
  <aside class="pp-card p-4 border-indigo-200 bg-gradient-to-b from-slate-50 to-white shadow-md">
    <h2 class="font-bold text-navy text-sm mb-3 flex items-center gap-2">
      <span class="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
      Live Results
    </h2>

    <p v-if="error" class="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2 mb-3">{{ error }}</p>
    <p v-else-if="!hasResults" class="text-xs text-slate-500 py-6 text-center">Enter dimensions and layers to see live pricing.</p>

    <template v-else>
      <div class="grid grid-cols-2 gap-2 mb-3 text-xs">
        <div class="bg-indigo-50 border border-indigo-200 rounded-lg p-2 col-span-2">
          <div class="text-indigo-700 font-medium">Board GSM</div>
          <div class="text-lg font-bold text-indigo-900 font-mono">{{ fmt(results.weight?.boardGSM, 0) }}</div>
          <div class="text-[10px] text-indigo-600 mt-0.5">paper {{ fmt(results.weight?.sheetGsmTotal, 0) }} + starch glue</div>
        </div>
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-2">
          <div class="text-blue-700">Selling / box</div>
          <div class="font-bold text-blue-900">{{ fmtMoney(results.cost?.sellingPrice) }}</div>
        </div>
        <div class="bg-emerald-50 border border-emerald-200 rounded-lg p-2">
          <div class="text-emerald-700">Order value</div>
          <div class="font-bold text-emerald-900">{{ fmtMoney(results.order?.totalValue) }}</div>
        </div>
        <div class="bg-teal-50 border border-teal-200 rounded-lg p-2">
          <div class="text-teal-700">Sheet ₹/kg</div>
          <div class="font-bold text-teal-900 font-mono">{{ fmtMoney(results.cost?.sheetRatePerKg) }}</div>
        </div>
        <div class="bg-green-50 border border-green-200 rounded-lg p-2">
          <div class="text-green-700">Box ₹/kg</div>
          <div class="font-bold text-green-900 font-mono">{{ fmtMoney(results.cost?.boxRatePerKg) }}</div>
        </div>
      </div>

      <table class="w-full text-[11px] mb-3">
        <thead>
          <tr class="text-slate-500 border-b border-slate-200">
            <th class="text-left py-1 font-medium">Layer</th>
            <th class="text-left py-1">Paper</th>
            <th class="text-right py-1">GSM</th>
            <th class="text-right py-1">₹/kg</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(layer, idx) in form.layers" :key="idx" class="border-b border-slate-100">
            <td class="py-1 pr-1 text-slate-700">{{ layer.name }}</td>
            <td class="py-1 text-slate-600 truncate max-w-[72px]" :title="paperTypeLabel(layer.paperType)">{{ paperTypeLabel(layer.paperType) }}</td>
            <td class="py-1 text-right font-mono">{{ layer.gsm }}</td>
            <td class="py-1 text-right font-mono">{{ fmt(layer.rate, 2) }}</td>
          </tr>
        </tbody>
      </table>

      <table class="w-full text-xs">
        <tbody class="divide-y divide-slate-100">
          <tr>
            <td class="py-1.5 text-slate-600">Sheet weight</td>
            <td class="py-1.5 text-right font-mono font-medium">{{ fmt(results.weight?.sheetWeight, 1) }} gm</td>
          </tr>
          <tr>
            <td class="py-1.5 text-slate-600">Box weight</td>
            <td class="py-1.5 text-right font-mono font-medium">{{ fmt(results.weight?.boxTotal, 1) }} gm</td>
          </tr>
          <tr>
            <td class="py-1.5 text-slate-600">Shipping</td>
            <td class="py-1.5 text-right font-mono">{{ fmt(form.shippingCostPerKg, 2) }}/kg → {{ fmtMoney(results.cost?.shipping) }}</td>
          </tr>
          <tr>
            <td class="py-1.5 text-slate-600">Conversion</td>
            <td class="py-1.5 text-right font-mono">{{ fmt(form.conversionCostPerKg, 2) }}/kg → {{ fmtMoney(results.cost?.conversion) }}</td>
          </tr>
          <tr class="bg-slate-50">
            <td class="py-2 font-semibold text-navy">Cost subtotal</td>
            <td class="py-2 text-right font-mono font-semibold">{{ fmtMoney(results.cost?.subTotal) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </aside>
</template>
