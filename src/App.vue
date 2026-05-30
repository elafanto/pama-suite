<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { RouterView, RouterLink, useRoute } from 'vue-router'
import { navItems } from '@/router'
import { useFirmStore } from '@/stores/firm'

const route = useRoute()
const sidebarOpen = ref(false)
const clock = ref('')

let timer: number
function tick() {
  const n = new Date()
  clock.value = [n.getHours(), n.getMinutes(), n.getSeconds()]
    .map(x => String(x).padStart(2, '0')).join(':')
}
onMounted(async () => {
  await useFirmStore().load()
  tick(); timer = window.setInterval(tick, 1000)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Top navbar -->
    <header class="bg-navy text-white flex items-center px-4 gap-3 shadow-lg z-20 shrink-0" style="height:52px">
      <button class="lg:hidden text-xl px-1" @click="sidebarOpen = !sidebarOpen" aria-label="Menu">☰</button>
      <RouterLink to="/dashboard" class="flex items-center gap-2.5 no-underline">
        <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-teal flex items-center justify-center text-lg">🏭</div>
        <div class="leading-tight">
          <div class="text-[15px] font-bold text-white">Pama Packaging</div>
          <div class="text-[10px] text-sky-300">Business Suite</div>
        </div>
      </RouterLink>
      <div class="ml-auto flex items-center gap-3">
        <span class="hidden sm:block text-sky-300 text-sm tabular-nums">{{ clock }}</span>
        <div class="flex items-center gap-2 bg-primary rounded-full pl-1.5 pr-3 py-1">
          <div class="w-6 h-6 rounded-full bg-gradient-to-br from-accent to-teal flex items-center justify-center text-xs font-bold">AS</div>
          <span class="hidden sm:block text-xs font-semibold text-slate-100">Anju Samant</span>
        </div>
      </div>
    </header>

    <div class="flex-1 flex min-h-0">
      <!-- Sidebar -->
      <aside
        :class="['bg-primary w-60 shrink-0 overflow-y-auto z-30 transition-transform',
                 'fixed lg:static inset-y-0 left-0 top-[52px] lg:top-0',
                 sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0']">
        <nav class="p-3 space-y-1">
          <RouterLink v-for="item in navItems" :key="item.path" :to="item.path"
            @click="sidebarOpen = false"
            :class="['flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium no-underline transition-colors',
                     route.path === item.path
                       ? 'bg-white/15 text-white'
                       : 'text-sky-200 hover:bg-white/10 hover:text-white']">
            <span class="text-base w-5 text-center">{{ (item.meta as any).icon }}</span>
            <span>{{ (item.meta as any).title }}</span>
          </RouterLink>
        </nav>
        <div class="p-4 mt-2 border-t border-white/10 text-[11px] text-sky-300 leading-relaxed">
          <strong class="text-sky-200">Union Bank of India</strong><br/>
          Jaspur Branch<br/>
          CC: 663205090000180
        </div>
      </aside>

      <!-- Backdrop (mobile) -->
      <div v-if="sidebarOpen" class="fixed inset-0 bg-black/40 z-20 lg:hidden" @click="sidebarOpen = false"></div>

      <!-- Main -->
      <main class="flex-1 min-w-0 overflow-y-auto bg-[#f0f4f8]">
        <RouterView />
      </main>
    </div>
  </div>
</template>
