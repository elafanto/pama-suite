<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'
import {
  type SegmentedFieldConfig,
  GSTIN_SEGMENT_CONFIG,
  MOBILE_SEGMENT_CONFIG,
  splitToSegments,
  joinSegments,
  filterSegmentValue,
  invalidCharMessage,
  sanitizeCombinedInput,
} from '@/utils/segmentedField'

const props = withDefaults(
  defineProps<{
    modelValue: string
    preset?: 'gstin' | 'mobile'
    config?: SegmentedFieldConfig
    inputClass?: string
    ariaLabel?: string
  }>(),
  { modelValue: '', inputClass: 'pp-input', ariaLabel: 'Segmented input' },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  blur: []
}>()

const fieldConfig = computed(() => {
  if (props.config) return props.config
  if (props.preset === 'mobile') return MOBILE_SEGMENT_CONFIG
  return GSTIN_SEGMENT_CONFIG
})

const segmentValues = ref<string[]>([])
const inputRefs = ref<(HTMLInputElement | null)[]>([])
const charError = ref('')

function syncFromModel(value: string) {
  segmentValues.value = splitToSegments(value, fieldConfig.value)
}

syncFromModel(props.modelValue)

watch(
  () => props.modelValue,
  (v) => {
    const joined = joinSegments(segmentValues.value)
    if (v !== joined) syncFromModel(v)
  },
)

watch(fieldConfig, () => syncFromModel(props.modelValue))

function setInputRef(idx: number, el: unknown) {
  inputRefs.value[idx] = el as HTMLInputElement | null
}

function emitValue() {
  const combined = joinSegments(segmentValues.value)
  emit('update:modelValue', combined)
}

function focusSegment(idx: number, placeAtEnd = false) {
  nextTick(() => {
    const el = inputRefs.value[idx]
    if (!el) return
    el.focus()
    const pos = placeAtEnd ? el.value.length : 0
    el.setSelectionRange(pos, pos)
  })
}

function onSegmentInput(idx: number, e: Event) {
  const el = e.target as HTMLInputElement
  const maxLen = fieldConfig.value.lengths[idx]
  const kind = fieldConfig.value.kinds[idx]
  const { value, rejected } = filterSegmentValue(el.value, kind, maxLen)
  segmentValues.value[idx] = value
  el.value = value
  charError.value = rejected ? invalidCharMessage(rejected, kind) : ''
  emitValue()
  if (value.length >= maxLen && idx < fieldConfig.value.lengths.length - 1) {
    focusSegment(idx + 1)
  }
}

function onKeydown(idx: number, e: KeyboardEvent) {
  if (e.key !== 'Backspace') return
  const el = e.target as HTMLInputElement
  const atStart = (el.selectionStart ?? 0) === 0
  if (segmentValues.value[idx] === '' && idx > 0 && atStart) {
    e.preventDefault()
    focusSegment(idx - 1, true)
  }
}

function onPaste(e: ClipboardEvent) {
  e.preventDefault()
  const pasted = e.clipboardData?.getData('text') ?? ''
  const combined = sanitizeCombinedInput(pasted, fieldConfig.value)
  if (!combined) return
  segmentValues.value = splitToSegments(combined, fieldConfig.value)
  charError.value = ''
  emitValue()
  const lastIdx = fieldConfig.value.lengths.length - 1
  const firstIncomplete = segmentValues.value.findIndex(
    (s, i) => s.length < fieldConfig.value.lengths[i],
  )
  focusSegment(firstIncomplete >= 0 ? firstIncomplete : lastIdx, true)
}

function onBlur() {
  emit('blur')
}

const segmentWidths = computed(() =>
  fieldConfig.value.lengths.map((len) => {
    if (len <= 2) return 'w-10'
    if (len <= 3) return 'w-12'
    return 'w-[4.5rem] sm:w-20'
  }),
)
</script>

<template>
  <div>
    <div
      class="flex flex-wrap items-center gap-1"
      role="group"
      :aria-label="ariaLabel"
    >
      <template v-for="(len, idx) in fieldConfig.lengths" :key="idx">
        <span v-if="idx > 0" class="text-slate-400 text-sm select-none" aria-hidden="true">·</span>
        <input
          :ref="(el) => setInputRef(idx, el)"
          :value="segmentValues[idx] ?? ''"
          type="text"
          :class="[inputClass, segmentWidths[idx], '!w-auto min-w-0 text-center uppercase tracking-wide']"
          :maxlength="len"
          :inputmode="fieldConfig.kinds[idx] === 'digits' ? 'numeric' : 'text'"
          :autocomplete="preset === 'mobile' ? 'tel' : 'off'"
          autocapitalize="characters"
          spellcheck="false"
          @input="onSegmentInput(idx, $event)"
          @keydown="onKeydown(idx, $event)"
          @paste="onPaste"
          @blur="onBlur"
        />
      </template>
    </div>
    <p v-if="charError" class="text-xs mt-1 text-amber-700">{{ charError }}</p>
  </div>
</template>
