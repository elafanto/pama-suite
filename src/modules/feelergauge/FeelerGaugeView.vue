<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  FEELER_BLADE_COUNT,
  FEELER_MAX_MM,
  FEELER_MIN_MM,
  FEELER_TICK_MM,
  classifyCandidate,
  isFeelerInRange,
  mmFromTick,
  rangeArr,
  runLabel,
  snapMm,
  solveFeeler,
  tickFromMm,
  type FeelerBlockSum,
  type FeelerExactCandidate,
  type FeelerSerialOption,
} from '@/services/feelerGauge'

type ResultTab = 'exact' | 'closest'
type Selection = { runTicks: number[]; skipTicks: number[] }

const targetMm = ref(3)
const snapHint = ref('')
const resultTab = ref<ResultTab>('exact')
const selection = ref<Selection>({ runTicks: [], skipTicks: [] })
const selectedKey = ref('')

const ticks = computed(() => {
  const v = Number(targetMm.value)
  if (!Number.isFinite(v)) return null
  return tickFromMm(v)
})

const solution = computed(() => {
  const T = ticks.value
  if (T === null) return null
  return solveFeeler(T)
})

const outOfRange = computed(() => {
  const T = ticks.value
  return T !== null && !isFeelerInRange(T)
})

const bladeHeights = Array.from({ length: FEELER_BLADE_COUNT }, (_, i) => 26 + ((i + 1) / FEELER_BLADE_COUNT) * 70)

function plural(n: number) {
  return n === 1 ? 'blade' : 'blades'
}

function applySnap() {
  const v = Number(targetMm.value)
  if (!Number.isFinite(v)) {
    snapHint.value = ''
    return
  }
  const snapped = snapMm(v)
  if (Math.abs(snapped - v) > 1e-9) {
    snapHint.value = `Snapped to ${snapped.toFixed(2)} mm — blades only come in ${FEELER_TICK_MM.toFixed(2)} mm steps.`
    targetMm.value = snapped
  } else {
    snapHint.value = ''
  }
}

function step(delta: number) {
  const v = Number(targetMm.value)
  const base = Number.isFinite(v) ? v : 0
  targetMm.value = Math.max(FEELER_MIN_MM, Math.min(FEELER_MAX_MM, +(base + delta).toFixed(2)))
  applySnap()
}

function selectSerial(opt: FeelerSerialOption, key: string) {
  selectedKey.value = key
  selection.value = { runTicks: rangeArr(opt.a, opt.b), skipTicks: [] }
}

function selectExact(cand: FeelerExactCandidate, key: string) {
  const c = classifyCandidate(cand)
  selectedKey.value = key
  selection.value = { runTicks: c.runTicks, skipTicks: c.skipTicks }
}

function selectClosest(block: FeelerBlockSum, key: string) {
  selectedKey.value = key
  selection.value = { runTicks: rangeArr(block.a, block.b), skipTicks: [] }
}

function autoSelect() {
  const sol = solution.value
  const T = ticks.value
  if (T === null || !sol || outOfRange.value) {
    selection.value = { runTicks: [], skipTicks: [] }
    selectedKey.value = ''
    return
  }
  if (sol.serial.length) {
    selectSerial(sol.serial[0], `serial-0`)
    return
  }
  if (resultTab.value === 'exact' && sol.exact.length) {
    selectExact(sol.exact[0], `exact-0`)
    return
  }
  const block = sol.closest.below || sol.closest.above
  if (block) selectClosest(block, sol.closest.below ? 'closest-below' : 'closest-above')
  else {
    selection.value = { runTicks: [], skipTicks: [] }
    selectedKey.value = ''
  }
}

watch([ticks, resultTab], autoSelect, { immediate: true })

function leafClass(tick: number) {
  if (selection.value.runTicks.includes(tick)) return 'bg-teal-500 shadow-[0_0_0_1px_#14b8a6,0_0_12px_-2px_#14b8a6]'
  if (selection.value.skipTicks.includes(tick)) return 'bg-amber-500 shadow-[0_0_0_1px_#f59e0b,0_0_12px_-2px_#f59e0b]'
  return 'bg-slate-300'
}

function leafLabelClass(tick: number) {
  if (selection.value.runTicks.includes(tick)) return 'text-teal-700 font-semibold'
  if (selection.value.skipTicks.includes(tick)) return 'text-amber-700 font-semibold'
  return 'text-slate-400'
}

function cardClass(key: string, primary: boolean) {
  const base = 'pp-card p-4 cursor-pointer transition border'
  if (selectedKey.value === key) return `${base} border-teal-500 ring-2 ring-teal-500/40`
  if (primary) return `${base} border-teal-300 bg-teal-50/60`
  return `${base} border-slate-200 hover:border-slate-300`
}

function closestDiffMm(block: FeelerBlockSum) {
  const T = ticks.value ?? 0
  return (block.sum - T) * FEELER_TICK_MM
}

const closestItems = computed(() => {
  const sol = solution.value
  if (!sol) return [] as { key: string; label: string; block: FeelerBlockSum }[]
  const items: { key: string; label: string; block: FeelerBlockSum }[] = []
  if (sol.closest.below) items.push({ key: 'closest-below', label: 'Nearest below', block: sol.closest.below })
  if (sol.closest.above) items.push({ key: 'closest-above', label: 'Nearest above', block: sol.closest.above })
  return items
})
</script>

<template>
  <div class="p-6 max-w-xl mx-auto">
    <header class="mb-5">
      <p class="text-[11px] font-mono uppercase tracking-[0.2em] text-teal-600 m-0">Feeler gauge · 0.05–1.00 mm</p>
      <h1 class="text-2xl font-bold text-navy mt-1">Combination Finder</h1>
      <p class="text-sm text-slate-500 mt-1">
        Target thickness se continuous block ya minimum-skip blade combination nikaalo.
      </p>
    </header>

    <section class="pp-card p-4">
      <label class="pp-label" for="feeler-target">Target thickness</label>
      <div class="flex items-stretch gap-2 mt-1">
        <button type="button" class="pp-btn pp-btn-ghost !w-14 !h-14 !text-2xl shrink-0" aria-label="Decrease by 0.05" @click="step(-FEELER_TICK_MM)">−</button>
        <div class="relative flex-1">
          <input
            id="feeler-target"
            v-model.number="targetMm"
            type="number"
            inputmode="decimal"
            :step="FEELER_TICK_MM"
            :min="FEELER_MIN_MM"
            :max="FEELER_MAX_MM"
            class="pp-input !h-14 text-center font-mono text-3xl font-semibold"
            @change="applySnap"
            @blur="applySnap"
          />
          <span class="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-sm text-slate-400 pointer-events-none">mm</span>
        </div>
        <button type="button" class="pp-btn pp-btn-ghost !w-14 !h-14 !text-2xl shrink-0" aria-label="Increase by 0.05" @click="step(FEELER_TICK_MM)">+</button>
      </div>
      <p v-if="snapHint" class="mt-2 text-xs font-mono text-amber-700">{{ snapHint }}</p>
    </section>

    <section class="mt-4 space-y-3">
      <div v-if="ticks === null" class="pp-card p-4 text-slate-400 text-sm">Target thickness daalo.</div>

      <article v-else-if="outOfRange" class="pp-card p-4 border border-amber-300 bg-amber-50">
        <p class="font-semibold text-amber-800">Out of range</p>
        <p class="text-xs font-mono text-amber-700 mt-1">
          Enter {{ FEELER_MIN_MM.toFixed(2) }}–{{ FEELER_MAX_MM.toFixed(2) }} mm (full 20-blade set).
        </p>
      </article>

      <template v-else-if="solution">
        <template v-if="solution.serial.length">
          <article
            v-for="(opt, i) in solution.serial"
            :key="`serial-${i}`"
            :class="cardClass(`serial-${i}`, i === 0)"
            @click="selectSerial(opt, `serial-${i}`)"
          >
            <p class="text-[11px] font-mono uppercase tracking-wider m-0" :class="i === 0 ? 'text-teal-700' : 'text-slate-400'">
              {{ i === 0 ? 'Serial match · fewest blades' : 'Alternate serial' }}
            </p>
            <p class="mt-1 font-semibold text-navy" :class="i === 0 ? 'text-lg' : ''">
              Take blades
              <span class="font-mono text-teal-700">{{ mmFromTick(opt.a) }}</span>
              →
              <span class="font-mono text-teal-700">{{ mmFromTick(opt.b) }}</span>
              mm, continuously.
            </p>
            <div class="flex flex-wrap gap-1.5 mt-3">
              <span
                v-for="t in rangeArr(opt.a, opt.b)"
                :key="t"
                class="rounded-md border border-teal-300 bg-teal-50 text-teal-800 px-2 py-0.5 font-mono text-sm font-medium"
              >
                {{ mmFromTick(t) }}
              </span>
            </div>
            <p class="mt-3 text-xs font-mono text-slate-500">
              {{ opt.count }} {{ plural(opt.count) }} · total {{ mmFromTick(rangeArr(opt.a, opt.b).reduce((a, b) => a + b, 0)) }} mm
            </p>
          </article>
        </template>

        <template v-else>
          <div class="pp-card p-1.5 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              class="h-10 rounded-xl text-sm font-medium transition"
              :class="resultTab === 'exact' ? 'bg-teal-600 text-white' : 'text-slate-500 hover:bg-slate-50'"
              @click="resultTab = 'exact'"
            >
              Exact (min skips)
            </button>
            <button
              type="button"
              class="h-10 rounded-xl text-sm font-medium transition"
              :class="resultTab === 'closest' ? 'bg-teal-600 text-white' : 'text-slate-500 hover:bg-slate-50'"
              @click="resultTab = 'closest'"
            >
              Closest serial
            </button>
          </div>

          <template v-if="resultTab === 'exact'">
            <article
              v-for="(cand, i) in solution.exact.slice(0, 3)"
              :key="`exact-${i}`"
              :class="cardClass(`exact-${i}`, i === 0)"
              @click="selectExact(cand, `exact-${i}`)"
            >
              <p class="text-[11px] font-mono uppercase tracking-wider m-0" :class="i === 0 ? 'text-teal-700' : 'text-slate-400'">
                {{ i === 0 ? 'Exact match · minimum skips' : 'Alternate exact' }}
              </p>
              <p class="mt-1 font-semibold text-navy text-lg">{{ runLabel(cand.runs) }}</p>
              <div class="flex flex-wrap gap-1.5 mt-3">
                <span
                  v-for="t in cand.ticks"
                  :key="t"
                  class="rounded-md border px-2 py-0.5 font-mono text-sm font-medium"
                  :class="classifyCandidate(cand).kindOf(t) === 'run'
                    ? 'border-teal-300 bg-teal-50 text-teal-800'
                    : 'border-amber-300 bg-amber-50 text-amber-800'"
                >
                  {{ mmFromTick(t) }}
                </span>
              </div>
              <p class="mt-3 text-xs font-mono text-slate-500">
                {{ cand.blades }} {{ plural(cand.blades) }} ·
                total {{ mmFromTick(cand.ticks.reduce((a, b) => a + b, 0)) }} mm
              </p>
            </article>
            <div v-if="!solution.exact.length" class="pp-card p-4 text-sm text-slate-500">
              Exact combination nahi mili — Closest serial try karo.
            </div>
          </template>

          <template v-else>
            <article
              v-for="item in closestItems"
              :key="item.key"
              :class="cardClass(item.key, false)"
              @click="selectClosest(item.block, item.key)"
            >
              <div class="flex items-center justify-between gap-2">
                <p class="text-[11px] font-mono uppercase tracking-wider text-slate-400 m-0">{{ item.label }}</p>
                <span class="rounded-md border border-amber-300 bg-amber-50 text-amber-800 px-2 py-0.5 font-mono text-xs">
                  {{ closestDiffMm(item.block) > 0 ? '+' : '−' }}{{ Math.abs(closestDiffMm(item.block)).toFixed(2) }} mm
                </span>
              </div>
              <p class="mt-1 font-semibold text-navy">
                Blades
                <span class="font-mono text-teal-700">{{ mmFromTick(item.block.a) }}</span>
                →
                <span class="font-mono text-teal-700">{{ mmFromTick(item.block.b) }}</span>
                mm =
                <span class="font-mono">{{ mmFromTick(item.block.sum) }} mm</span>
              </p>
              <div class="flex flex-wrap gap-1.5 mt-3">
                <span
                  v-for="t in rangeArr(item.block.a, item.block.b)"
                  :key="t"
                  class="rounded-md border border-teal-300 bg-teal-50 text-teal-800 px-2 py-0.5 font-mono text-sm font-medium"
                >
                  {{ mmFromTick(t) }}
                </span>
              </div>
              <p class="mt-3 text-xs font-mono text-slate-500">
                {{ item.block.b - item.block.a + 1 }} {{ plural(item.block.b - item.block.a + 1) }} continuous
              </p>
            </article>
          </template>
        </template>
      </template>
    </section>

    <section class="pp-card p-4 mt-4">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <p class="pp-label !mb-0">Gauge layout</p>
        <div class="flex items-center gap-3 text-[11px] font-mono text-slate-500">
          <span class="inline-flex items-center gap-1.5"><i class="w-2.5 h-2.5 rounded-full bg-teal-500 inline-block" />block</span>
          <span class="inline-flex items-center gap-1.5"><i class="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />single</span>
        </div>
      </div>
      <div class="flex items-end gap-1 overflow-x-auto pb-2 mt-3">
        <div v-for="t in FEELER_BLADE_COUNT" :key="t" class="flex flex-col items-center gap-1 shrink-0">
          <div
            class="w-5 rounded-t-sm border border-slate-200 transition"
            :class="leafClass(t)"
            :style="{ height: `${bladeHeights[t - 1]}px` }"
          />
          <div class="font-mono text-[9px] leading-none" :class="leafLabelClass(t)">{{ mmFromTick(t) }}</div>
        </div>
      </div>
      <p class="mt-1 text-[11px] font-mono text-slate-400">
        {{ FEELER_BLADE_COUNT }} blades · full set = {{ FEELER_MAX_MM.toFixed(2) }} mm · scroll to see all
      </p>
    </section>
  </div>
</template>
