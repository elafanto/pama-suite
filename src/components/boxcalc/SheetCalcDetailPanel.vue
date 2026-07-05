<script setup lang="ts">
import { fmt, fmtInt } from '@/services/boxcalcUi'
import type { SheetCalcDetail } from '@/services/calculator'

defineProps<{
  detail: SheetCalcDetail | null | undefined
  compact?: boolean
}>()
</script>

<template>
  <div v-if="detail" class="space-y-4">
    <section class="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">1 · Caliper & inner size</h4>
      <p class="text-sm text-navy font-mono">
        {{ detail.input.ply }}-{{ detail.input.flute }} → caliper
        <strong>{{ detail.caliper.value }} mm</strong>
        <span class="text-slate-500">({{ detail.caliper.source }})</span>
      </p>
      <ul class="mt-2 space-y-1 text-xs font-mono text-slate-600">
        <li v-for="(step, i) in detail.innerOuter.steps" :key="i">{{ step }}</li>
      </ul>
      <p class="mt-2 text-xs text-slate-500">
        Inner {{ fmtInt(detail.innerOuter.inner.L) }} × {{ fmtInt(detail.innerOuter.inner.W) }} × {{ fmtInt(detail.innerOuter.inner.H) }} mm
        · Outer {{ fmtInt(detail.innerOuter.outer.L) }} × {{ fmtInt(detail.innerOuter.outer.W) }} × {{ fmtInt(detail.innerOuter.outer.H) }} mm
      </p>
    </section>

    <section class="rounded-xl border border-teal-200 bg-teal-50/50 p-4">
      <h4 class="text-xs font-bold uppercase tracking-wider text-teal-800 mb-2">2 · Blank sheet size</h4>
      <p class="text-sm font-semibold text-navy mb-2">
        Length = <span class="font-mono text-teal-800">{{ fmtInt(detail.blank.lengthTotal) }} mm</span>
        · Width = <span class="font-mono text-teal-800">{{ fmtInt(detail.blank.widthTotal) }} mm</span>
      </p>
      <div class="grid sm:grid-cols-2 gap-3 text-xs">
        <div>
          <div class="font-bold text-slate-600 mb-1">Length breakdown</div>
          <table class="w-full font-mono">
            <tr v-for="(p, i) in detail.blank.lengthParts" :key="'l' + i" class="border-b border-teal-100">
              <td class="py-1 pr-2 text-slate-600">{{ p.label }}</td>
              <td class="py-1 text-right font-semibold">{{ fmtInt(p.mm) }}</td>
              <td v-if="p.formula" class="py-1 pl-2 text-slate-400 hidden lg:table-cell">{{ p.formula }}</td>
            </tr>
            <tr class="font-bold text-teal-900">
              <td class="py-1">Total length</td>
              <td class="py-1 text-right">{{ fmtInt(detail.blank.lengthTotal) }}</td>
            </tr>
          </table>
        </div>
        <div>
          <div class="font-bold text-slate-600 mb-1">Width breakdown</div>
          <table class="w-full font-mono">
            <tr v-for="(p, i) in detail.blank.widthParts" :key="'w' + i" class="border-b border-teal-100">
              <td class="py-1 pr-2 text-slate-600">{{ p.label }}</td>
              <td class="py-1 text-right font-semibold">{{ fmtInt(p.mm) }}</td>
            </tr>
            <tr class="font-bold text-teal-900">
              <td class="py-1">Total width</td>
              <td class="py-1 text-right">{{ fmtInt(detail.blank.widthTotal) }}</td>
            </tr>
          </table>
        </div>
      </div>
      <p class="mt-2 text-xs font-mono text-teal-800">Area: {{ detail.blank.areaFormula }}</p>
      <p v-if="!compact" class="mt-1 text-xs text-slate-500">
        Glue flap {{ fmtInt(detail.blank.glueFlap) }} mm · Clearance {{ fmtInt(detail.blank.clearanceMM) }} mm
      </p>
    </section>

    <section v-if="!compact" class="rounded-xl border border-slate-200 bg-white p-4">
      <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">3 · Construction & slots</h4>
      <p class="text-sm text-navy">
        <strong>{{ detail.construction.type }}</strong> ({{ detail.construction.pieces }} piece)
      </p>
      <p class="text-xs font-mono text-slate-500 mt-1">
        Slot cuts @ {{ detail.slots.positions.map((p) => fmtInt(p)).join(', ') }} mm · depth {{ fmtInt(detail.slots.slotDepth) }} mm
      </p>
    </section>

    <section class="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
      <h4 class="text-xs font-bold uppercase tracking-wider text-indigo-800 mb-2">{{ compact ? '3' : '4' }} · Reel nesting</h4>
      <p class="text-sm font-semibold text-navy font-mono">
        {{ detail.nesting.sheetsPerWidth }}w × {{ detail.nesting.sheetsPerLength }}l =
        <strong>{{ detail.nesting.boxesPerBigSheet }}</strong> boxes / big sheet
      </p>
      <ul class="mt-2 space-y-1 text-xs font-mono text-slate-600">
        <li v-for="(step, i) in detail.nesting.steps" :key="i">{{ step }}</li>
      </ul>
      <p v-if="!compact" class="mt-2 text-xs text-slate-500">
        Reel {{ fmtInt(detail.nesting.reelWidthMM) }} mm wide · big sheet feed {{ fmtInt(detail.nesting.bigSheetLengthMM) }} mm ·
        util {{ fmt(detail.nesting.utilizationPercent, 1) }}%
      </p>
    </section>
  </div>
</template>
