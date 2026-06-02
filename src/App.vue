<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { RouterView, RouterLink, useRoute } from 'vue-router'
import { navGroups } from '@/router'
import { useFirmStore } from '@/stores/firm'
import { useAuthStore } from '@/stores/auth'
import { runSync, startCloudRealtime, stopCloudRealtime } from '@/services/sync'
import PwaInstallPrompt from '@/components/PwaInstallPrompt.vue'

const route = useRoute()
const auth = useAuthStore()
const sidebarOpen = ref(false)
const clock = ref('')
const syncing = ref(false)
const syncMsg = ref('')

const cloudLabel = computed(() => {
  if (auth.loading && !auth.initialized) return 'Checking login'
  if (!auth.isConfigured) return 'Local only'
  if (auth.isLoggedIn && auth.canSync) return auth.user?.email || 'Cloud connected'
  if (auth.isLoggedIn) return 'Org setup pending'
  return 'Sign in'
})
const cloudDetail = computed(() => {
  if (!auth.isConfigured) return 'Supabase not configured. Open Settings → Cloud Sync.'
  if (auth.isLoggedIn) {
    return `${auth.user?.email || 'Signed in'}${auth.orgId ? ` · Org ${auth.orgId}` : ' · Organization setup pending'}${syncMsg.value ? ` · ${syncMsg.value}` : ''}`
  }
  return auth.statusMessage || 'Not signed in. Tap to login.'
})
const cloudTarget = computed(() => {
  if (!auth.isConfigured) return '/settings'
  if (!auth.isLoggedIn) return '/login'
  return '/settings'
})

let timer: number
let stopRealtime: (() => void) | null = null

function tick() {
  const n = new Date()
  clock.value = [n.getHours(), n.getMinutes(), n.getSeconds()]
    .map(x => String(x).padStart(2, '0')).join(':')
}

async function cloudSync() {
  syncing.value = true
  syncMsg.value = ''
  try {
    syncMsg.value = await runSync()
  } finally {
    syncing.value = false
  }
}

function onOnline() {
  if (auth.canSync) cloudSync()
}

watch(
  () => auth.canSync,
  (can) => {
    stopRealtime?.()
    stopRealtime = null
    if (can) {
      cloudSync()
      stopRealtime = startCloudRealtime((msg) => { syncMsg.value = msg })
    } else {
      stopCloudRealtime()
    }
  },
  { immediate: true },
)

onMounted(async () => {
  await useFirmStore().load()
  tick(); timer = window.setInterval(tick, 1000)
  window.addEventListener('online', onOnline)
})
onUnmounted(() => {
  clearInterval(timer)
  window.removeEventListener('online', onOnline)
  stopRealtime?.()
  stopCloudRealtime()
})
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Top navbar -->
    <header class="bg-navy text-white flex items-center px-4 gap-3 shadow-lg z-20 shrink-0" style="height:52px">
      <button class="lg:hidden text-xl px-1" @click="sidebarOpen = !sidebarOpen" aria-label="Menu">☰</button>
      <RouterLink to="/dashboard" class="flex items-center gap-2.5 no-underline min-w-0">
        <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-teal flex items-center justify-center text-lg shrink-0">🏭</div>
        <div class="leading-tight min-w-0">
          <div class="text-[15px] font-bold text-white truncate">Pama Packaging</div>
          <div class="text-[10px] text-sky-300 truncate">Business Suite</div>
        </div>
      </RouterLink>
      <div class="ml-auto flex items-center gap-1.5 sm:gap-3 shrink-0">
        <RouterLink
          :to="cloudTarget"
          class="text-[10px] sm:text-[11px] text-sky-300 hover:text-white max-w-[128px] sm:max-w-[260px] truncate no-underline"
          :title="cloudDetail"
        >☁️ {{ cloudLabel }}</RouterLink>
        <button
          v-if="auth.canSync"
          type="button"
          class="pp-btn pp-btn-ghost !py-1 !px-2 text-[10px] sm:text-xs text-sky-100 border border-white/20"
          :disabled="syncing"
          @click="cloudSync"
        >
          {{ syncing ? '…' : 'Sync' }}
        </button>
        <RouterLink
          v-else-if="auth.isConfigured && !auth.isLoggedIn"
          to="/login"
          class="text-[10px] sm:text-xs font-semibold text-sky-200 hover:text-white no-underline"
        >
          Sign in
        </RouterLink>
        <span class="hidden sm:block text-sky-300 text-sm tabular-nums">{{ clock }}</span>
      </div>
    </header>

    <div class="flex-1 flex min-h-0">
      <!-- Sidebar -->
      <aside
        :class="['bg-primary w-60 shrink-0 overflow-y-auto z-30 transition-transform',
                 'fixed lg:static inset-y-0 left-0 top-[52px] lg:top-0',
                 sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0']">
        <nav class="p-3 space-y-3">
          <div v-for="grp in navGroups" :key="grp.label">
            <div class="px-3 mb-1 text-[10px] font-bold uppercase tracking-wider text-sky-400/70">{{ grp.label }}</div>
            <div class="space-y-0.5">
              <RouterLink v-for="item in grp.items" :key="item.path" :to="item.path"
                @click="sidebarOpen = false"
                :class="['flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium no-underline transition-colors',
                         route.path === item.path
                           ? 'bg-white/15 text-white'
                           : 'text-sky-200 hover:bg-white/10 hover:text-white']">
                <span class="text-base w-5 text-center">{{ item.icon }}</span>
                <span>{{ item.title }}</span>
              </RouterLink>
            </div>
          </div>
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
    <PwaInstallPrompt />
  </div>
</template>
