<script setup lang="ts">
import { ref, computed, watch, onMounted, watchEffect } from 'vue'
import {
  applyScenarioToMainForm,
  calcWeightFromBaseForm,
  comboLabel,
  computeAllCompareRows,
  defaultCompareScenario,
  loadCompareScenarios,
  saveCompareScenarios,
  scenarioFromForm,
  type CompareRowResult,
  type CompareScenario,
} from '@/services/boxcalcCompare'
import { fmt, fmtMoney, type BoxCalcForm } from '@/services/boxcalcUi'

const props = defineProps<{
  baseForm: BoxCalcForm
}>()

const emit = defineEmits<{
  loadToCalculator: []
}>()

const scenarios = ref<CompareScenario[]>([])
const rowResults = ref<CompareRowResult[]>([])
const expandedId = ref<string | null>(null)

/** Re-run calculator whenever scenarios or base form inputs change. */
watchEffect(() => {
  const base = props.baseForm
  // Track base dimensions/costs so Compare follows Calculator tab edits.
  void base.length
  void base.width
  void base.height
  void base.quantity
  void base.dimensionUnit
  void base.dimType
  void base.starchGSM
  void base.starchRate
  void base.printingCost
  void base.shippingCostPerKg
  void base.productionWastePercent
  void base.scrapRate
  void base.joining.method
  void base.joining.wireRate
  void base.joining.cwpGSM
  void base.joining.coverage
  void base.joining.cwpRate
  void base.stackCheck.enabled
  void base.ply
  void base.flute
  void base.caliperOverride
  void base.glueFlap
  for (const layer of base.layers) {
    void layer.gsm
    void layer.bf
    void layer.rate
    void layer.takeUp
  }

  const list = scenarios.value
  for (const s of list) {
    void s.enabled
    void s.ply
    void s.flute
    void s.outerGsm
    void s.outerBf
    void s.outerRate
    void s.bottomGsm
    void s.bottomBf
    void s.bottomRate
    void s.midGsm
    void s.midBf
    void s.midRate
    void s.fluteGsm
    void s.fluteBf
    void s.fluteRate
    void s.marginPercent
    void s.convRatePerKg
  }

  rowResults.value = computeAllCompareRows(base, list)
})

const baseWeightGm = computed(() => calcWeightFromBaseForm(props.baseForm))

function weightMatchesCalc(idx: number): boolean {
  const rowWt = resultFor(idx)?.weightGm
  const baseWt = baseWeightGm.value
  if (rowWt == null || baseWt == null) return false
  return Math.abs(rowWt - baseWt) < 0.05
}

function resultFor(idx: number): CompareRowResult | undefined {
  return rowResults.value[idx]
}

const enabledRows = computed(() =>
  rowResults.value.filter((r) => r.scenario.enabled && !r.error && r.sellingPrice != null),
)

const bestPriceId = computed(() => {
  if (!enabledRows.value.length) return null
  const sorted = [...enabledRows.value].sort((a, b) => (a.sellingPrice || 0) - (b.sellingPrice || 0))
  return sorted[0]?.scenario.id ?? null
})

const baseSummary = computed(() => {
  const f = props.baseForm
  const u = f.dimensionUnit === 'inch' ? 'in' : 'mm'
  return `${f.length}×${f.width}×${f.height} ${u} · Qty ${f.quantity} · ${f.ply}/${f.flute}`
})

function persist() {
  saveCompareScenarios(scenarios.value)
}

function addRow() {
  const n = scenarios.value.length + 1
  scenarios.value.push(defaultCompareScenario(`Option ${n}`, props.baseForm))
  persist()
}

function duplicateRow(s: CompareScenario) {
  scenarios.value.push({
    ...JSON.parse(JSON.stringify(s)),
    id: Math.random().toString(36).slice(2, 10),
    label: `${s.label} (copy)`,
  })
  persist()
}

function removeRow(id: string) {
  if (scenarios.value.length <= 1) return
  scenarios.value = scenarios.value.filter((s) => s.id !== id)
  persist()
}

function syncFromCalculator() {
  scenarios.value = [scenarioFromForm(props.baseForm, 'From calculator')]
  persist()
}

function loadRow(idx: number) {
  const scenario = scenarios.value[idx]
  if (!scenario) return
  applyScenarioToMainForm(props.baseForm, scenario)
  emit('loadToCalculator')
}

function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}

function fmtNum(n: number | null | undefined, d = 2): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toFixed(d)
}

watch(scenarios, persist, { deep: true })

onMounted(() => {
  scenarios.value = loadCompareScenarios(props.baseForm)
})
</script>

<template>
  <div class="space-y-4">
    <div class="pp-card p-4 bg-gradient-to-r from-violet-50 to-indigo-50 border border-indigo-200">
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 class="font-bold text-indigo-900 text-lg">Advance Compare</h2>
          <p class="text-sm text-indigo-700/80 mt-1">
            Same box base — alag paper combo, rate aur margin side-by-side. Calculator tab ka size/qty yahan base hai.
          </p>
          <p class="text-xs font-mono text-indigo-900 mt-2 bg-white/70 rounded px-2 py-1 inline-block">{{ baseSummary }}</p>
          <p v-if="baseWeightGm != null" class="text-xs text-indigo-800 mt-1">
            Calculator box weight: <strong>{{ fmt(baseWeightGm, 1) }} gm</strong>
            <span class="text-indigo-600"> — same ply/paper hone par Compare me match hona chahiye</span>
          </p>
        </div>
        <div class="flex flex-wrap gap-2 shrink-0">
          <button type="button" class="pp-btn pp-btn-ghost !py-1.5 text-xs" @click="syncFromCalculator">
            ↻ Calculator se sync
          </button>
          <button type="button" class="pp-btn pp-btn-primary !py-1.5 text-xs" @click="addRow">
            + Row
          </button>
        </div>
      </div>
    </div>

    <!-- Desktop table -->
    <div class="hidden lg:block pp-card overflow-x-auto">
      <table class="w-full text-xs min-w-[72rem]">
        <thead class="bg-slate-50 text-[10px] uppercase text-slate-500">
          <tr>
            <th class="text-left px-2 py-2 w-8">On</th>
            <th class="text-left px-2 py-2 min-w-[7rem]">Label</th>
            <th class="text-left px-2 py-2">Ply</th>
            <th class="text-left px-2 py-2">Flute</th>
            <th class="text-center px-2 py-2" colspan="3">Top Liner</th>
            <th class="text-center px-2 py-2" colspan="3">Bottom Liner</th>
            <th class="text-center px-2 py-2" colspan="3">Flute (G/BF/₹)</th>
            <th class="text-center px-2 py-2" colspan="3">Mid (G/BF/₹)</th>
            <th class="text-right px-2 py-2">Margin%</th>
            <th class="text-right px-2 py-2">Conv ₹/kg</th>
            <th class="text-right px-2 py-2">Wt g</th>
            <th class="text-right px-2 py-2">Material</th>
            <th class="text-right px-2 py-2">Conv</th>
            <th class="text-right px-2 py-2 font-bold text-emerald-700">Sell ₹/box</th>
            <th class="text-right px-2 py-2">₹/kg</th>
            <th class="text-right px-2 py-2">Order total</th>
            <th class="text-right px-2 py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(scenario, idx) in scenarios"
            :key="scenario.id"
            :class="[
              'border-t border-slate-100',
              scenario.id === bestPriceId ? 'bg-emerald-50/80' : 'hover:bg-slate-50/80',
              !scenario.enabled ? 'opacity-50' : '',
            ]"
          >
            <td class="px-2 py-1.5">
              <input v-model="scenario.enabled" type="checkbox" class="rounded" />
            </td>
            <td class="px-2 py-1.5">
              <input v-model="scenario.label" class="pp-input !py-1 !text-xs w-full min-w-[6rem]" />
            </td>
            <td class="px-2 py-1.5">
              <select v-model="scenario.ply" class="pp-input !py-1 !text-xs w-20">
                <option value="3-ply">3</option>
                <option value="5-ply">5</option>
                <option value="7-ply">7</option>
              </select>
            </td>
            <td class="px-2 py-1.5">
              <input v-model="scenario.flute" class="pp-input !py-1 !text-xs w-14 font-mono" />
            </td>
            <td class="px-1 py-1.5"><input v-model.number="scenario.outerGsm" type="number" class="pp-input !py-1 !text-xs w-14" /></td>
            <td class="px-1 py-1.5"><input v-model.number="scenario.outerBf" type="number" class="pp-input !py-1 !text-xs w-12" /></td>
            <td class="px-1 py-1.5"><input v-model.number="scenario.outerRate" type="number" step="0.01" class="pp-input !py-1 !text-xs w-14" /></td>
            <td class="px-1 py-1.5"><input v-model.number="scenario.bottomGsm" type="number" class="pp-input !py-1 !text-xs w-14" /></td>
            <td class="px-1 py-1.5"><input v-model.number="scenario.bottomBf" type="number" class="pp-input !py-1 !text-xs w-12" /></td>
            <td class="px-1 py-1.5"><input v-model.number="scenario.bottomRate" type="number" step="0.01" class="pp-input !py-1 !text-xs w-14" /></td>
            <td class="px-1 py-1.5"><input v-model.number="scenario.fluteGsm" type="number" class="pp-input !py-1 !text-xs w-14" /></td>
            <td class="px-1 py-1.5"><input v-model.number="scenario.fluteBf" type="number" class="pp-input !py-1 !text-xs w-12" /></td>
            <td class="px-1 py-1.5"><input v-model.number="scenario.fluteRate" type="number" step="0.01" class="pp-input !py-1 !text-xs w-14" /></td>
            <td class="px-1 py-1.5">
              <input v-model.number="scenario.midGsm" type="number" class="pp-input !py-1 !text-xs w-14" :disabled="scenario.ply === '3-ply'" />
            </td>
            <td class="px-1 py-1.5">
              <input v-model.number="scenario.midBf" type="number" class="pp-input !py-1 !text-xs w-12" :disabled="scenario.ply === '3-ply'" />
            </td>
            <td class="px-1 py-1.5">
              <input v-model.number="scenario.midRate" type="number" step="0.01" class="pp-input !py-1 !text-xs w-14" :disabled="scenario.ply === '3-ply'" />
            </td>
            <td class="px-2 py-1.5">
              <input v-model.number="scenario.marginPercent" type="number" class="pp-input !py-1 !text-xs w-14 text-right" />
            </td>
            <td class="px-2 py-1.5">
              <input v-model.number="scenario.convRatePerKg" type="number" step="0.01" class="pp-input !py-1 !text-xs w-14 text-right" />
            </td>
            <td class="px-2 py-1.5 text-right font-mono">
              {{ resultFor(idx)?.weightGm != null ? fmt(resultFor(idx)!.weightGm, 1) : '—' }}
              <span v-if="weightMatchesCalc(idx)" class="block text-[9px] text-teal-600">= Calc</span>
            </td>
            <td class="px-2 py-1.5 text-right font-mono">{{ resultFor(idx)?.material != null ? fmtNum(resultFor(idx)!.material) : '—' }}</td>
            <td class="px-2 py-1.5 text-right font-mono">{{ resultFor(idx)?.conversion != null ? fmtNum(resultFor(idx)!.conversion) : '—' }}</td>
            <td class="px-2 py-1.5 text-right font-bold text-emerald-700 font-mono">
              <span v-if="resultFor(idx)?.error" class="text-rose-600 text-[10px] font-normal">{{ resultFor(idx)!.error }}</span>
              <span v-else>{{ resultFor(idx)?.sellingPrice != null ? fmtNum(resultFor(idx)!.sellingPrice) : '—' }}</span>
              <span v-if="scenario.id === bestPriceId" class="block text-[9px] text-emerald-600 font-semibold">LOWEST</span>
            </td>
            <td class="px-2 py-1.5 text-right font-mono">{{ resultFor(idx)?.perKg != null ? fmtNum(resultFor(idx)!.perKg) : '—' }}</td>
            <td class="px-2 py-1.5 text-right font-mono">{{ resultFor(idx)?.orderTotal != null ? fmtNum(resultFor(idx)!.orderTotal, 0) : '—' }}</td>
            <td class="px-2 py-1.5 whitespace-nowrap">
              <button type="button" class="text-indigo-600 underline text-[10px] mr-1" @click="loadRow(idx)">Load</button>
              <button type="button" class="text-slate-500 underline text-[10px] mr-1" @click="duplicateRow(scenario)">Dup</button>
              <button type="button" class="text-rose-600 underline text-[10px]" @click="removeRow(scenario.id)">Del</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Mobile / tablet cards -->
    <div class="lg:hidden space-y-3">
      <div
        v-for="(scenario, idx) in scenarios"
        :key="scenario.id"
        :class="[
          'pp-card p-3 border',
          scenario.id === bestPriceId ? 'border-emerald-400 bg-emerald-50/50' : 'border-slate-200',
          !scenario.enabled ? 'opacity-60' : '',
        ]"
      >
        <div class="flex items-start justify-between gap-2 mb-2">
          <div class="flex items-center gap-2 min-w-0 flex-1">
            <input v-model="scenario.enabled" type="checkbox" class="rounded shrink-0" />
            <input v-model="scenario.label" class="pp-input !py-1 text-sm font-semibold flex-1 min-w-0" />
          </div>
          <div v-if="scenario.id === bestPriceId" class="text-[10px] font-bold text-emerald-700 shrink-0">LOWEST</div>
        </div>

        <p class="text-[10px] text-slate-500 font-mono mb-2">{{ comboLabel(scenario) }}</p>

        <div class="grid grid-cols-2 gap-2 text-xs mb-2">
          <div>
            <label class="text-[10px] text-slate-500">Ply / Flute</label>
            <div class="flex gap-1">
              <select v-model="scenario.ply" class="pp-input !py-1 flex-1">
                <option value="3-ply">3-Ply</option>
                <option value="5-ply">5-Ply</option>
                <option value="7-ply">7-Ply</option>
              </select>
              <input v-model="scenario.flute" class="pp-input !py-1 w-14 font-mono" />
            </div>
          </div>
          <div>
            <label class="text-[10px] text-slate-500">Margin % / Conv ₹/kg</label>
            <div class="flex gap-1">
              <input v-model.number="scenario.marginPercent" type="number" class="pp-input !py-1 flex-1" />
              <input v-model.number="scenario.convRatePerKg" type="number" class="pp-input !py-1 flex-1" />
            </div>
          </div>
        </div>

        <button
          type="button"
          class="text-xs text-indigo-600 underline mb-2"
          @click="toggleExpand(scenario.id)"
        >
          {{ expandedId === scenario.id ? 'Hide paper rates ▲' : 'Paper GSM/BF/Rate ▼' }}
        </button>

        <div v-if="expandedId === scenario.id" class="space-y-2 mb-2 text-xs bg-slate-50 rounded-lg p-2">
          <div class="grid grid-cols-3 gap-1">
            <span class="font-semibold text-slate-600">Top liner</span>
            <input v-model.number="scenario.outerGsm" type="number" placeholder="GSM" class="pp-input !py-1" />
            <input v-model.number="scenario.outerBf" type="number" placeholder="BF" class="pp-input !py-1" />
            <span />
            <input v-model.number="scenario.outerRate" type="number" step="0.01" placeholder="₹/kg" class="pp-input !py-1 col-span-2" />
          </div>
          <div class="grid grid-cols-3 gap-1">
            <span class="font-semibold text-slate-600">Bottom liner</span>
            <input v-model.number="scenario.bottomGsm" type="number" placeholder="GSM" class="pp-input !py-1" />
            <input v-model.number="scenario.bottomBf" type="number" placeholder="BF" class="pp-input !py-1" />
            <span />
            <input v-model.number="scenario.bottomRate" type="number" step="0.01" placeholder="₹/kg" class="pp-input !py-1 col-span-2" />
          </div>
          <div class="grid grid-cols-3 gap-1">
            <span class="font-semibold text-slate-600">Flute</span>
            <input v-model.number="scenario.fluteGsm" type="number" class="pp-input !py-1" />
            <input v-model.number="scenario.fluteBf" type="number" class="pp-input !py-1" />
            <span />
            <input v-model.number="scenario.fluteRate" type="number" step="0.01" class="pp-input !py-1 col-span-2" />
          </div>
          <div v-if="scenario.ply !== '3-ply'" class="grid grid-cols-3 gap-1">
            <span class="font-semibold text-slate-600">Mid</span>
            <input v-model.number="scenario.midGsm" type="number" class="pp-input !py-1" />
            <input v-model.number="scenario.midBf" type="number" class="pp-input !py-1" />
            <span />
            <input v-model.number="scenario.midRate" type="number" step="0.01" class="pp-input !py-1 col-span-2" />
          </div>
        </div>

        <div v-if="resultFor(idx)?.error" class="text-xs text-rose-600 mb-2">{{ resultFor(idx)!.error }}</div>
        <div v-else class="grid grid-cols-2 gap-2 text-center mb-2">
          <div class="bg-white rounded border p-2">
            <div class="text-[10px] text-slate-500">Wt gm</div>
            <div class="font-bold font-mono">{{ resultFor(idx)?.weightGm != null ? fmt(resultFor(idx)!.weightGm, 1) : '—' }}</div>
            <div v-if="weightMatchesCalc(idx)" class="text-[9px] text-teal-600">= Calculator</div>
          </div>
          <div class="bg-white rounded border p-2">
            <div class="text-[10px] text-slate-500">Sell/box</div>
            <div class="font-bold text-emerald-700">{{ resultFor(idx)?.sellingPrice != null ? fmtMoney(resultFor(idx)!.sellingPrice) : '—' }}</div>
          </div>
          <div class="bg-white rounded border p-2">
            <div class="text-[10px] text-slate-500">₹/kg</div>
            <div class="font-bold">{{ resultFor(idx)?.perKg != null ? fmt(resultFor(idx)!.perKg) : '—' }}</div>
          </div>
          <div class="bg-white rounded border p-2">
            <div class="text-[10px] text-slate-500">Order total</div>
            <div class="font-bold text-sm">{{ resultFor(idx)?.orderTotal != null ? fmtMoney(resultFor(idx)!.orderTotal) : '—' }}</div>
          </div>
        </div>

        <div class="flex gap-2">
          <button type="button" class="pp-btn pp-btn-primary !py-1.5 text-xs flex-1" @click="loadRow(idx)">Load to Calc</button>
          <button type="button" class="pp-btn pp-btn-ghost !py-1.5 text-xs" @click="duplicateRow(scenario)">Dup</button>
          <button type="button" class="pp-btn pp-btn-danger !py-1.5 text-xs" @click="removeRow(scenario.id)">Del</button>
        </div>
      </div>
    </div>

    <p class="text-[10px] text-slate-400 text-center">
      Live recalc — har cell change par turant update. Rows browser me save hoti hain.
    </p>
  </div>
</template>
