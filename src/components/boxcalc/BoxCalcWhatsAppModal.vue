<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  generateReelOrderMessage,
  normalizePhone,
  saveVendorPhone,
  type BoxCalcForm,
  type VendorPhone,
} from '@/services/boxcalcUi'

const props = defineProps<{
  form: BoxCalcForm
  results: any
  vendorPhones: VendorPhone[]
}>()

const emit = defineEmits<{
  close: []
  'update:vendorPhones': [VendorPhone[]]
  copied: [string]
}>()

const phone = ref('')
const message = computed(() => generateReelOrderMessage(props.form, props.results))

const hasMissingColors = computed(() =>
  props.form.layers.some((l) => !l.color?.trim()),
)

function pickVendor(vendor: VendorPhone) {
  phone.value = vendor.displayPhone || vendor.phone
}

function sendWhatsApp() {
  const msg = message.value
  if (!msg) return alert('Calculate karo pehle!')
  const encodedMsg = encodeURIComponent(msg)
  const normalized = normalizePhone(phone.value)
  if (normalized) {
    emit('update:vendorPhones', saveVendorPhone(props.vendorPhones, phone.value))
  }
  const url = normalized
    ? `https://wa.me/${normalized}?text=${encodedMsg}`
    : `https://wa.me/?text=${encodedMsg}`
  window.open(url, '_blank')
  emit('close')
}

async function copyText() {
  try {
    await navigator.clipboard.writeText(message.value)
    emit('copied', '✓ Message copied to clipboard!')
  } catch {
    const ta = document.createElement('textarea')
    ta.value = message.value
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    emit('copied', '✓ Message copied!')
  }
}
</script>

<template>
  <div class="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-2 sm:p-4 overflow-y-auto">
    <div class="bg-white rounded-2xl shadow-2xl max-w-2xl w-full my-4 max-h-[95vh] overflow-y-auto">
      <div class="sticky top-0 bg-gradient-to-r from-green-500 to-emerald-600 text-white px-4 py-3 rounded-t-2xl flex items-center justify-between z-10">
        <h3 class="text-lg font-bold">WhatsApp Reel Order Share</h3>
        <button class="text-white/80 hover:text-white text-xl" @click="emit('close')">✕</button>
      </div>

      <div class="p-4 sm:p-5 space-y-4">
        <div>
          <label class="text-sm font-bold text-slate-800 block mb-2">
            Supplier Phone (optional)
          </label>
          <input
            v-model="phone"
            type="tel"
            list="vendor-phones-list"
            placeholder="9876543210 or +91 9876543210"
            class="pp-input border-2 border-green-300"
          />
          <datalist id="vendor-phones-list">
            <option
              v-for="vendor in vendorPhones"
              :key="vendor.phone"
              :value="vendor.displayPhone || vendor.phone"
              :label="vendor.name ? `${vendor.name} (${vendor.useCount}x)` : `(${vendor.useCount}x)`"
            />
          </datalist>
          <div v-if="vendorPhones.length" class="mt-2">
            <div class="text-[10px] text-slate-500 mb-1">Recent suppliers:</div>
            <div class="flex flex-wrap gap-1">
              <button
                v-for="vendor in vendorPhones.slice(0, 5)"
                :key="vendor.phone"
                type="button"
                class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-mono"
                @click="pickVendor(vendor)"
              >
                {{ vendor.displayPhone || vendor.phone }}
                <span class="text-[10px] text-slate-500">({{ vendor.useCount }})</span>
              </button>
            </div>
          </div>
        </div>

        <div>
          <label class="text-sm font-bold text-slate-800 block mb-2">Message Preview</label>
          <div class="bg-slate-50 border border-slate-300 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap max-h-96 overflow-y-auto">
            {{ message }}
          </div>
        </div>

        <div v-if="hasMissingColors" class="bg-yellow-50 border border-yellow-300 rounded-lg p-3 text-xs text-yellow-900">
          Some paper layers have no color set — set colors in the form for better quotes.
        </div>
      </div>

      <div class="sticky bottom-0 bg-white border-t border-slate-200 px-4 py-3 flex gap-2 rounded-b-2xl">
        <button type="button" class="pp-btn pp-btn-ghost" @click="copyText">Copy Text</button>
        <button type="button" class="pp-btn pp-btn-success flex-1" @click="sendWhatsApp">WhatsApp Send</button>
        <button type="button" class="pp-btn pp-btn-ghost" @click="emit('close')">Cancel</button>
      </div>
    </div>
  </div>
</template>
