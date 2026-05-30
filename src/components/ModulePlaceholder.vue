<script setup lang="ts">
defineProps<{ icon: string; title: string; note?: string }>()
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">
    <header class="mb-6 flex items-center gap-3">
      <span class="text-3xl">{{ icon }}</span>
      <div>
        <h1 class="text-2xl font-bold text-navy">{{ title }}</h1>
        <p class="text-sm text-slate-500">{{ note || 'Module coming in a later milestone.' }}</p>
      </div>
    </header>
    <div class="pp-card p-10 text-center text-slate-400">
      <div class="text-5xl mb-3">🚧</div>
      <p class="font-semibold">{{ title }} — under construction</p>
      <p class="text-sm mt-1">Foundation ready. Features build milestone-by-milestone.</p>
    </div>
  </div>
</template>
