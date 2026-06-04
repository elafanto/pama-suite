<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import {
  type SegmentedFieldConfig,
  GSTIN_SEGMENT_CONFIG,
  MOBILE_SEGMENT_CONFIG,
  sanitizeCombinedInput,
  formatSegments,
  totalSegmentLength,
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

// Single input: raw value (no separators) is stored/emitted, while the box
// shows segments separated by spaces (e.g. 07 ABCDE 1234F 1Z5).
const display = ref('')
const allDigits = computed(() => fieldConfig.value.kinds.every((k) => k === 'digits'))
// Total chars + one space between each segment.
const maxLen = computed(() => totalSegmentLength(fieldConfig.value) + fieldConfig.value.lengths.length - 1)

function syncFromModel() {
  display.value = formatSegments(props.modelValue, fieldConfig.value)
}
syncFromModel()

watch(
  () => props.modelValue,
  (v) => {
    if (v !== sanitizeCombinedInput(display.value, fieldConfig.value)) syncFromModel()
  },
)
watch(fieldConfig, syncFromModel)

/** Caret position in `text` just after the first `sig` non-space characters. */
function caretAfterSignificant(text: string, sig: number): number {
  let pos = 0
  let seen = 0
  while (pos < text.length && seen < sig) {
    if (text[pos] !== ' ') seen++
    pos++
  }
  while (pos < text.length && text[pos] === ' ') pos++
  return pos
}

/** Re-sanitize + re-format `typed`, keep the caret on the same logical char. */
function apply(el: HTMLInputElement, typed: string, caret: number) {
  const sigBefore = sanitizeCombinedInput(typed.slice(0, caret), fieldConfig.value).length
  const raw = sanitizeCombinedInput(typed, fieldConfig.value)
  const formatted = formatSegments(raw, fieldConfig.value)
  display.value = formatted
  el.value = formatted
  const pos = caretAfterSignificant(formatted, sigBefore)
  el.setSelectionRange(pos, pos)
  if (raw !== props.modelValue) emit('update:modelValue', raw)
}

function onInput(e: Event) {
  const el = e.target as HTMLInputElement
  apply(el, el.value, el.selectionStart ?? el.value.length)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Backspace') return
  const el = e.target as HTMLInputElement
  const start = el.selectionStart ?? 0
  // Backspacing onto an auto-inserted separator should remove the real
  // character before it, not get stuck on the space.
  if (start === el.selectionEnd && start >= 2 && el.value[start - 1] === ' ') {
    e.preventDefault()
    apply(el, el.value.slice(0, start - 2) + el.value.slice(start), start - 2)
  }
}

function onBlur() {
  emit('blur')
}
</script>

<template>
  <div>
    <input
      :value="display"
      type="text"
      :class="[inputClass, 'uppercase tracking-wide']"
      :maxlength="maxLen"
      :inputmode="allDigits ? 'numeric' : 'text'"
      :autocomplete="preset === 'mobile' ? 'tel' : 'off'"
      autocapitalize="characters"
      spellcheck="false"
      :aria-label="ariaLabel"
      @input="onInput"
      @keydown="onKeydown"
      @blur="onBlur"
    />
  </div>
</template>
