<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    show?: boolean
    maxWidth?: string
  }>(),
  { show: true, maxWidth: 'max-w-lg' },
)
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <div
    v-if="show"
    class="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto"
    @click.self="emit('close')"
  >
    <div :class="['pp-card w-full mt-10 mb-10', maxWidth]">
      <div class="flex items-center justify-between px-5 py-3 border-b border-slate-200">
        <h3 class="font-bold text-navy">{{ title }}</h3>
        <button class="text-slate-400 hover:text-slate-700 text-xl leading-none" @click="emit('close')">✕</button>
      </div>
      <div class="p-5">
        <slot />
      </div>
    </div>
  </div>
</template>
