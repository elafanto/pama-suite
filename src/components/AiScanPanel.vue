<script setup lang="ts">
import { ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { scanInvoiceImage, fileToBase64, type ScanResult } from '@/services/aiScanner'

const emit = defineEmits<{ scanned: [result: ScanResult] }>()
const settings = useSettingsStore()
const status = ref('')
const loading = ref(false)
const preview = ref('')

async function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  preview.value = URL.createObjectURL(file)
  loading.value = true
  status.value = 'Scanning…'
  try {
    const { base64, mime } = await fileToBase64(file)
    const result = await scanInvoiceImage(settings.geminiKey, base64, mime)
    status.value = 'Done — form filled'
    emit('scanned', result)
  } catch (err: any) {
    status.value = err.message || 'Scan failed'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="border-2 border-dashed border-slate-300 rounded-lg p-4 mb-4 text-center bg-slate-50">
    <p class="text-sm font-semibold text-navy mb-2">🤖 AI Invoice Scan (Gemini)</p>
    <label class="pp-btn pp-btn-primary cursor-pointer inline-block">
      {{ loading ? 'Scanning…' : 'Upload Invoice Image' }}
      <input type="file" accept="image/*" class="hidden" :disabled="loading" @change="onFile" />
    </label>
    <p v-if="status" class="text-xs mt-2" :class="status.startsWith('Done') ? 'text-green-600' : 'text-slate-500'">{{ status }}</p>
    <img v-if="preview" :src="preview" class="max-h-32 mx-auto mt-2 rounded border" alt="preview" />
    <p class="text-xs text-slate-400 mt-2">Save Gemini key in Settings first</p>
  </div>
</template>
