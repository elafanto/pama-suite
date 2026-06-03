<script setup lang="ts">
import { computed } from 'vue'
import {
  generateJobNumber,
  getCureStatus,
  getTotalBundles,
  todayISO,
  type BoxCalcForm,
  type BoxCalcJobCard,
} from '@/services/boxcalcUi'

const props = defineProps<{
  form: BoxCalcForm
  jobCard: BoxCalcJobCard
}>()

const emit = defineEmits<{
  close: []
  generate: []
  'update:jobCard': [BoxCalcJobCard]
  'update:customerName': [string]
}>()

const jc = computed({
  get: () => props.jobCard,
  set: (v) => emit('update:jobCard', v),
})

const cureStatus = computed(() => getCureStatus(props.jobCard))
const totalBundles = computed(() => getTotalBundles(props.form.quantity, props.jobCard.bundleSize))

function regenJobNumber() {
  emit('update:jobCard', { ...props.jobCard, jobNumber: generateJobNumber() })
}

function setPastingNow() {
  const local = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
  emit('update:jobCard', { ...props.jobCard, pastingTime: local })
}

function patchJobCard(partial: Partial<BoxCalcJobCard>) {
  emit('update:jobCard', { ...props.jobCard, ...partial })
}

function patchOperator(key: string, value: string) {
  emit('update:jobCard', {
    ...props.jobCard,
    operators: { ...props.jobCard.operators, [key]: value },
  })
}

function patchMaterialLoss(key: string, value: number | string) {
  emit('update:jobCard', {
    ...props.jobCard,
    materialLoss: { ...props.jobCard.materialLoss, [key]: value },
  })
}
</script>

<template>
  <div class="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-2 sm:p-4 overflow-y-auto">
    <div class="bg-white rounded-2xl shadow-2xl max-w-3xl w-full my-4 max-h-[95vh] overflow-y-auto">
      <div class="sticky top-0 bg-gradient-to-r from-orange-500 to-amber-600 text-white px-4 py-3 rounded-t-2xl flex items-center justify-between z-10">
        <h3 class="text-lg font-bold">Job Card Details</h3>
        <button class="text-white/80 hover:text-white text-xl" @click="emit('close')">✕</button>
      </div>

      <div class="p-4 sm:p-5 space-y-4">
        <!-- Job details -->
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <h4 class="font-bold text-blue-900 text-sm mb-2">Job Info</h4>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="pp-label">Job #</label>
              <div class="flex gap-1 mt-1">
                <input v-model="jc.jobNumber" class="pp-input !py-1.5 text-sm font-mono flex-1" />
                <button type="button" class="pp-btn pp-btn-ghost !px-2 text-xs" @click="regenJobNumber">Auto</button>
              </div>
            </div>
            <div>
              <label class="pp-label">Company</label>
              <input
                :value="jobCard.companyName"
                class="pp-input !py-1.5 text-sm mt-1"
                @input="patchJobCard({ companyName: ($event.target as HTMLInputElement).value })"
              />
            </div>
            <div>
              <label class="pp-label">Order Date</label>
              <input
                type="date"
                :value="jobCard.orderDate || todayISO()"
                class="pp-input !py-1.5 text-sm mt-1"
                @input="patchJobCard({ orderDate: ($event.target as HTMLInputElement).value })"
              />
            </div>
            <div>
              <label class="pp-label">Delivery Date</label>
              <input
                type="date"
                :value="jobCard.deliveryDate"
                class="pp-input !py-1.5 text-sm mt-1"
                @input="patchJobCard({ deliveryDate: ($event.target as HTMLInputElement).value })"
              />
            </div>
            <div class="col-span-2">
              <label class="pp-label">Priority</label>
              <select
                :value="jobCard.priority"
                class="pp-input !py-1.5 text-sm mt-1"
                @change="patchJobCard({ priority: ($event.target as HTMLSelectElement).value })"
              >
                <option value="सामान्य">Normal</option>
                <option value="तत्काल">Urgent</option>
                <option value="उच्च">High</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Customer -->
        <div class="bg-green-50 border border-green-200 rounded-lg p-3">
          <h4 class="font-bold text-green-900 text-sm mb-2">Customer</h4>
          <div class="grid grid-cols-2 gap-2">
            <div class="col-span-2">
              <label class="pp-label">Party Name</label>
              <input
                :value="form.customerName"
                class="pp-input !py-1.5 text-sm mt-1"
                @input="emit('update:customerName', ($event.target as HTMLInputElement).value)"
              />
            </div>
            <div>
              <label class="pp-label">Contact</label>
              <input
                :value="jobCard.customerContact"
                class="pp-input !py-1.5 text-sm mt-1"
                @input="patchJobCard({ customerContact: ($event.target as HTMLInputElement).value })"
              />
            </div>
            <div>
              <label class="pp-label">Phone</label>
              <input
                :value="jobCard.customerPhone"
                class="pp-input !py-1.5 text-sm mt-1"
                @input="patchJobCard({ customerPhone: ($event.target as HTMLInputElement).value })"
              />
            </div>
            <div class="col-span-2">
              <label class="pp-label">Address</label>
              <textarea
                :value="jobCard.customerAddress"
                rows="2"
                class="pp-input !py-1.5 text-sm mt-1"
                @input="patchJobCard({ customerAddress: ($event.target as HTMLTextAreaElement).value })"
              />
            </div>
          </div>
        </div>

        <!-- Bundling -->
        <div class="bg-purple-50 border border-purple-200 rounded-lg p-3">
          <h4 class="font-bold text-purple-900 text-sm mb-2">Bundling</h4>
          <div class="grid grid-cols-3 gap-2">
            <div>
              <label class="pp-label">Bundle Size</label>
              <input
                type="number"
                :value="jobCard.bundleSize"
                min="1"
                class="pp-input !py-1.5 text-sm mt-1"
                @input="patchJobCard({ bundleSize: Number(($event.target as HTMLInputElement).value) })"
              />
            </div>
            <div>
              <label class="pp-label">Total Bundles</label>
              <input :value="totalBundles" readonly class="pp-input !py-1.5 text-sm mt-1 bg-purple-100 font-bold" />
            </div>
            <div>
              <label class="pp-label">Quantity</label>
              <input :value="`${form.quantity} boxes`" readonly class="pp-input !py-1.5 text-sm mt-1 bg-slate-100" />
            </div>
          </div>
        </div>

        <!-- Cure timer -->
        <div class="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <h4 class="font-bold text-amber-900 text-sm mb-2">Cure Timer (Pasting)</h4>
          <div class="grid grid-cols-2 gap-2">
            <div class="col-span-2">
              <label class="pp-label">Pasted At</label>
              <div class="flex gap-1 mt-1">
                <input
                  type="datetime-local"
                  :value="jobCard.pastingTime"
                  class="pp-input !py-1.5 text-sm flex-1"
                  @input="patchJobCard({ pastingTime: ($event.target as HTMLInputElement).value })"
                />
                <button type="button" class="pp-btn pp-btn-ghost !px-2 text-xs" @click="setPastingNow">Now</button>
              </div>
            </div>
            <div>
              <label class="pp-label">Cure Hours</label>
              <input
                type="number"
                :value="jobCard.cureDurationHours"
                min="1"
                max="72"
                class="pp-input !py-1.5 text-sm mt-1"
                @input="patchJobCard({ cureDurationHours: Number(($event.target as HTMLInputElement).value) })"
              />
            </div>
            <div>
              <label class="pp-label">Status</label>
              <div
                class="mt-1 px-2 py-1.5 rounded text-xs font-medium"
                :class="{
                  'bg-gray-100 text-gray-700': cureStatus.status === 'not_started',
                  'bg-yellow-100 text-yellow-800': cureStatus.status === 'curing',
                  'bg-green-100 text-green-800': cureStatus.status === 'ready',
                }"
              >
                {{ cureStatus.message }}
              </div>
            </div>
          </div>
          <div v-if="cureStatus.status === 'curing'" class="mt-2">
            <div class="bg-amber-200 rounded-full h-2 overflow-hidden">
              <div class="bg-amber-600 h-full transition-all" :style="{ width: `${cureStatus.percent}%` }" />
            </div>
            <div class="text-[10px] text-amber-700 mt-1">Ready at: {{ cureStatus.readyAt }}</div>
          </div>
        </div>

        <!-- Operators -->
        <details class="bg-slate-50 border border-slate-200 rounded-lg">
          <summary class="cursor-pointer p-3 font-bold text-slate-800 text-sm">Operators (Optional)</summary>
          <div class="p-3 pt-0 grid grid-cols-2 gap-2">
            <div v-for="(label, key) in {
              paperIssue: 'Paper Issue', corrugator: 'Corrugator', sheetCutter: 'Sheet Cutter',
              pasting: 'Pasting', slitterScorer: 'Slitter Scorer', printerSlotter: 'Printer Slotter',
              stitching: 'Stitching', bundling: 'Bundling'
            }" :key="key">
              <label class="pp-label">{{ label }}</label>
              <input
                :value="jobCard.operators[key]"
                class="pp-input !py-1 text-xs mt-1"
                @input="patchOperator(key, ($event.target as HTMLInputElement).value)"
              />
            </div>
            <div class="col-span-2">
              <label class="pp-label">Supervisor</label>
              <input
                :value="jobCard.supervisor"
                class="pp-input !py-1 text-xs mt-1"
                @input="patchJobCard({ supervisor: ($event.target as HTMLInputElement).value })"
              />
            </div>
          </div>
        </details>

        <!-- Material loss -->
        <details class="bg-red-50 border border-red-200 rounded-lg">
          <summary class="cursor-pointer p-3 font-bold text-red-900 text-sm">Material Loss (Optional)</summary>
          <div class="p-3 pt-0 space-y-2 text-xs">
            <div class="grid grid-cols-3 gap-1">
              <div v-for="f in [
                { k: 'corrugatorSetupKg', l: 'Setup kg' },
                { k: 'corrugatorTrimKg', l: 'Trim kg' },
                { k: 'corrugatorRejectKg', l: 'Reject kg' },
              ]" :key="f.k">
                <label class="text-[10px]">{{ f.l }}</label>
                <input
                  type="number"
                  :value="jobCard.materialLoss[f.k]"
                  class="pp-input !py-1 text-xs"
                  @input="patchMaterialLoss(f.k, Number(($event.target as HTMLInputElement).value))"
                />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div v-for="f in [
                { k: 'sheetCutterRejectNos', l: 'Sheet Cutter Reject' },
                { k: 'pastingRejectNos', l: 'Pasting Reject' },
                { k: 'slitterTrimKg', l: 'Slitter Trim kg' },
                { k: 'slitterRejectNos', l: 'Slitter Reject' },
                { k: 'printerRejectNos', l: 'Printer Reject' },
                { k: 'slotterRejectNos', l: 'Slotter Reject' },
                { k: 'stitchingRejectNos', l: 'Stitching Reject' },
                { k: 'bundlingRejectNos', l: 'Bundling Reject' },
              ]" :key="f.k">
                <label class="text-[10px]">{{ f.l }}</label>
                <input
                  type="number"
                  :value="jobCard.materialLoss[f.k]"
                  class="pp-input !py-1 text-xs"
                  @input="patchMaterialLoss(f.k, Number(($event.target as HTMLInputElement).value))"
                />
              </div>
            </div>
          </div>
        </details>

        <div class="bg-blue-50 border border-blue-300 rounded-lg p-3 text-xs text-blue-900">
          Job Card prints as 4 A4 pages (10 production stage cards).
        </div>
      </div>

      <div class="sticky bottom-0 bg-white border-t border-slate-200 px-4 py-3 flex gap-2 rounded-b-2xl">
        <button type="button" class="pp-btn pp-btn-primary flex-1" @click="emit('generate')">Generate Job Card</button>
        <button type="button" class="pp-btn pp-btn-ghost" @click="emit('close')">Cancel</button>
      </div>
    </div>
  </div>
</template>
