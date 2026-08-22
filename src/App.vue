<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { RouterView, RouterLink, useRoute } from 'vue-router'
import { navGroups } from '@/router'
import { useFirmStore } from '@/stores/firm'
import { useAuthStore } from '@/stores/auth'
import { runSync, startCloudRealtime, stopCloudRealtime, startAutoSync, stopAutoSync } from '@/services/sync'
import PwaInstallPrompt from '@/components/PwaInstallPrompt.vue'
import { useBrowserBack } from '@/composables/useBrowserBack'

const route = useRoute()
const { showBackButton, goBack } = useBrowserBack()
const auth = useAuthStore()
const firmStore = useFirmStore()
const sidebarOpen = ref(false)
const clock = ref('')
const syncing = ref(false)
const refreshingApp = ref(false)
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
const activeFirmLabel = computed(() => firmStore.activeFirm?.name || 'No firm selected')
const isAppChromeHidden = computed(() => route.meta?.hideAppChrome === true)

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

async function activateWaitingWorker(registration: ServiceWorkerRegistration) {
  if (!registration.waiting) return

  await new Promise<void>((resolve) => {
    let resolved = false
    const finish = () => {
      if (resolved) return
      resolved = true
      window.clearTimeout(timeout)
      navigator.serviceWorker.removeEventListener('controllerchange', finish)
      resolve()
    }
    const timeout = window.setTimeout(finish, 1500)

    navigator.serviceWorker.addEventListener('controllerchange', finish)
    registration.waiting?.postMessage({ type: 'SKIP_WAITING' })
  })
}

async function refreshApp() {
  if (refreshingApp.value) return

  refreshingApp.value = true
  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration()
      if (registration) {
        await registration.update()
        await activateWaitingWorker(registration)
      }
    }
  } catch (err) {
    console.warn('App refresh update check failed; reloading anyway.', err)
  } finally {
    window.location.reload()
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
    stopAutoSync()
    if (can) {
      cloudSync()
      stopRealtime = startCloudRealtime((msg) => { syncMsg.value = msg })
      startAutoSync((msg) => { syncMsg.value = msg })
    } else {
      stopCloudRealtime()
    }
  },
  { immediate: true },
)

onMounted(async () => {
  await firmStore.load()
  tick(); timer = window.setInterval(tick, 1000)
  window.addEventListener('online', onOnline)
})
onUnmounted(() => {
  clearInterval(timer)
  window.removeEventListener('online', onOnline)
  stopRealtime?.()
  stopCloudRealtime()
  stopAutoSync()
})
</script>

<template>
  <div class="h-full flex flex-col">
    <template v-if="isAppChromeHidden">
      <RouterView />
    </template>

    <template v-else>
    <!-- Top navbar -->
    <header class="bg-navy text-white flex min-h-[52px] items-center gap-2 px-3 py-2 shadow-lg z-20 shrink-0 sm:gap-3 sm:px-4">
      <button
        v-if="showBackButton"
        type="button"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-white/10 text-lg hover:bg-white/20"
        aria-label="Go back"
        title="Back"
        @click="goBack"
      >
        ←
      </button>
      <button class="lg:hidden text-xl px-1" @click="sidebarOpen = !sidebarOpen" aria-label="Menu">☰</button>
      <RouterLink to="/dashboard" class="flex min-w-0 max-w-[42vw] items-center gap-2 no-underline sm:max-w-none sm:gap-2.5">
        <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-teal flex items-center justify-center text-lg shrink-0">🏭</div>
        <div class="leading-tight min-w-0">
          <div class="text-[15px] font-bold text-white truncate">Pama Packaging</div>
          <div class="hidden text-[10px] text-sky-300 truncate sm:block">Business Suite</div>
        </div>
      </RouterLink>
      <div class="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1.5 sm:gap-3">
        <RouterLink
          to="/settings"
          class="hidden max-w-[96px] items-center rounded-lg border border-teal-300/30 bg-teal-400/15 px-2 py-1 text-[10px] font-semibold text-teal-50 no-underline hover:bg-teal-400/25 sm:inline-flex sm:max-w-[180px] sm:text-[11px] lg:max-w-[260px]"
          :title="`Active firm: ${activeFirmLabel}`"
        >
          <span class="truncate">Firm: {{ activeFirmLabel }}</span>
        </RouterLink>
        <button
          type="button"
          class="hidden pp-btn pp-btn-ghost !py-1 !px-2 text-[10px] !text-sky-100 !bg-white/10 hover:!bg-white/20 border border-white/20 whitespace-nowrap sm:inline-flex sm:text-xs"
          :disabled="refreshingApp"
          title="Check for app update and reload"
          @click="refreshApp"
        >
          {{ refreshingApp ? 'Updating…' : 'Update' }}
        </button>
        <RouterLink
          :to="cloudTarget"
          class="inline-flex min-w-0 max-w-[34vw] items-center rounded-lg border border-white/15 bg-white/10 px-2 py-1 text-[10px] font-semibold text-sky-50 no-underline hover:bg-white/20 hover:text-white sm:max-w-[220px] sm:text-[11px]"
          :title="cloudDetail"
        >
          <span class="truncate">☁️ {{ cloudLabel }}</span>
        </RouterLink>
        <button
          v-if="auth.canSync"
          type="button"
          class="pp-btn !py-1 !px-2 text-[10px] sm:text-xs !bg-accent !text-white hover:!bg-accent-dk border border-sky-300/30 disabled:opacity-60"
          :disabled="syncing"
          @click="cloudSync"
        >
          {{ syncing ? '…' : 'Sync' }}
        </button>
        <RouterLink
          v-else-if="auth.isConfigured && !auth.isLoggedIn"
          to="/login"
          class="hidden items-center rounded-lg border border-sky-300/30 bg-accent px-2 py-1 text-[10px] font-semibold text-white no-underline hover:bg-accent-dk sm:inline-flex sm:text-xs"
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
    </template>
  </div>
</template>
