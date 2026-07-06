<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useBoxSheetSettingsStore } from '@/stores/boxSheetSettings'
import {
  CALIPER_TABLE_KEYS,
  DEFAULT_BOX_SHEET_SETTINGS,
  type BoxSheetSettings,
} from '@/services/boxSheetSettings'

const router = useRouter()
const store = useBoxSheetSettingsStore()

const form = reactive<BoxSheetSettings>(JSON.parse(JSON.stringify(store.settings)))
const status = ref('')

function syncFromStore() {
  Object.assign(form, JSON.parse(JSON.stringify(store.settings)))
}

watch(() => store.settings, syncFromStore, { deep: true })

function save() {
  store.persist(JSON.parse(JSON.stringify(form)))
  status.value = 'Settings saved — BoxCalc sheet calculation ab in values use karega.'
  setTimeout(() => { status.value = '' }, 4000)
}

function resetDefaults() {
  if (!confirm('Sab sheet settings factory default par reset karein?')) return
  store.reset()
  syncFromStore()
  status.value = 'Defaults restored.'
}

function goBoxCalc() {
  router.push('/boxcalc')
}

const gluePlyKeys = ['3-ply', '5-ply', '7-ply'] as const

const machineFields: { key: keyof BoxSheetSettings['machine']; label: string; hint?: string }[] = [
  { key: 'workingDeckleMM', label: 'Working deckle (mm)', hint: '67" = 1702' },
  { key: 'sideTrimMM', label: 'Side trim per edge (mm)' },
  { key: 'maxSheetLengthMM', label: 'Max single-piece blank (mm)', hint: '90" = 2286' },
  { key: 'maxSheetLength2PieceMM', label: 'Max 2-piece blank (mm)' },
  { key: 'maxSheetLength3PieceMM', label: 'Max 3-piece blank (mm)' },
  { key: 'lengthTrimMM', label: 'Cut-off trim per box (mm)' },
]
</script>

<template>
  <div class="p-6 max-w-3xl mx-auto">
    <header class="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div>
        <p class="text-[11px] font-mono uppercase tracking-wider text-teal-600">BoxCalc · sheet only</p>
        <h1 class="text-2xl font-bold text-navy mt-1">Sheet Calculation Settings</h1>
        <p class="text-sm text-slate-500 mt-1 max-w-xl">
          Sirf blank / sheet size ke formulas aur machine limits — cost, margin, strength yahan nahi.
        </p>
      </div>
      <button type="button" class="pp-btn pp-btn-ghost" @click="goBoxCalc">← BoxCalc</button>
    </header>

    <p v-if="status" class="mb-4 text-sm text-teal-800 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2">{{ status }}</p>

    <div class="space-y-4">
      <section class="pp-card p-4 space-y-3">
        <h2 class="font-bold text-navy">Inner ↔ Outer conversion</h2>
        <p class="text-xs text-slate-500">Board caliper (t) se inner/outer adjust — Fibre Box Handbook style.</p>
        <div class="grid sm:grid-cols-2 gap-3">
          <div>
            <label class="pp-label">L / W factor (× t)</label>
            <input v-model.number="form.innerOuterLwFactor" type="number" step="0.1" min="0" class="pp-input" />
            <p class="text-[10px] text-slate-400 mt-1">Default {{ DEFAULT_BOX_SHEET_SETTINGS.innerOuterLwFactor }}</p>
          </div>
          <div>
            <label class="pp-label">H factor (× t)</label>
            <input v-model.number="form.innerOuterHFactor" type="number" step="0.1" min="0" class="pp-input" />
            <p class="text-[10px] text-slate-400 mt-1">Default {{ DEFAULT_BOX_SHEET_SETTINGS.innerOuterHFactor }}</p>
          </div>
        </div>
      </section>

      <section class="pp-card p-4 space-y-3">
        <h2 class="font-bold text-navy">Blank formula</h2>
        <div>
          <label class="pp-label">Sheet width clearance (mm)</label>
          <input v-model.number="form.clearanceMM" type="number" step="0.5" min="0" class="pp-input max-w-xs" />
          <p class="text-xs text-slate-500 mt-1">Width = W + (H + factor×t + ply allowance) + clearance</p>
          <div class="mt-2">
            <label class="pp-label">Width caliper factor (× t)</label>
            <input v-model.number="form.widthCaliperFactor" type="number" step="0.5" min="0" class="pp-input max-w-xs" />
            <p class="text-[10px] text-slate-400 mt-1">Default {{ DEFAULT_BOX_SHEET_SETTINGS.widthCaliperFactor }} — RSC blank width me H ke saath 2× board thickness</p>
          </div>
        </div>
        <div class="grid sm:grid-cols-3 gap-3">
          <div v-for="ply in gluePlyKeys" :key="'h-' + ply">
            <label class="pp-label">Height allowance {{ ply }} (mm)</label>
            <input v-model.number="form.heightAllowanceDefaults[ply]" type="number" min="0" class="pp-input" />
            <p class="text-[10px] text-slate-400 mt-1">Default {{ DEFAULT_BOX_SHEET_SETTINGS.heightAllowanceDefaults[ply] ?? 0 }} — blank width me H term par extra mm</p>
          </div>
        </div>
        <div class="grid sm:grid-cols-3 gap-3">
          <div v-for="ply in gluePlyKeys" :key="ply">
            <label class="pp-label">Glue flap {{ ply }} (mm)</label>
            <input v-model.number="form.glueFlapDefaults[ply]" type="number" min="0" class="pp-input" />
          </div>
        </div>
      </section>

      <section class="pp-card p-4 space-y-3">
        <h2 class="font-bold text-navy">Caliper table (mm)</h2>
        <p class="text-xs text-slate-500">Ply + flute combination se board thickness.</p>
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <div v-for="key in CALIPER_TABLE_KEYS" :key="key" class="flex items-center gap-2">
            <label class="text-xs font-mono text-slate-600 w-24 shrink-0">{{ key }}</label>
            <input v-model.number="form.caliperTable[key]" type="number" step="0.1" min="0" class="pp-input !py-1.5 text-sm" />
          </div>
        </div>
      </section>

      <section class="pp-card p-4 space-y-3">
        <h2 class="font-bold text-navy">Machine limits (nesting)</h2>
        <div class="grid sm:grid-cols-2 gap-3">
          <div v-for="f in machineFields" :key="f.key">
            <label class="pp-label">{{ f.label }}</label>
            <input v-model.number="form.machine[f.key]" type="number" min="0" class="pp-input" />
            <p v-if="f.hint" class="text-[10px] text-slate-400 mt-0.5">{{ f.hint }}</p>
          </div>
        </div>
      </section>

      <div class="flex flex-wrap gap-2">
        <button type="button" class="pp-btn pp-btn-primary" @click="save">Save settings</button>
        <button type="button" class="pp-btn pp-btn-ghost" @click="resetDefaults">Reset to defaults</button>
      </div>
    </div>
  </div>
</template>
