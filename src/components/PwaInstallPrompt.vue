<script setup lang="ts">
import { ref, onMounted } from 'vue'

const show = ref(false)
const isIOS = ref(false)

onMounted(() => {
  isIOS.value = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const dismissed = localStorage.getItem('pama_pwa_install_dismissed')
  if (dismissed) {
    window.addEventListener('pama-show-pwa-banner', () => { show.value = true })
  }

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault()
    ;(window as any).__pamaInstallPrompt = e
    if (!localStorage.getItem('pama_pwa_install_dismissed')) show.value = true
  })

  window.addEventListener('pama-show-pwa-banner', () => { show.value = true })

  if (!dismissed && isIOS.value && !(window.navigator as any).standalone) {
    setTimeout(() => { show.value = true }, 3000)
  }
})

function dismiss() {
  show.value = false
  localStorage.setItem('pama_pwa_install_dismissed', '1')
}

async function install() {
  const prompt = (window as any).__pamaInstallPrompt as { prompt: () => Promise<void> } | undefined
  if (prompt) {
    await prompt.prompt()
    dismiss()
    return
  }
  dismiss()
}
</script>

<template>
  <div
    v-if="show"
    class="fixed bottom-0 inset-x-0 z-50 p-3 sm:p-4 no-print safe-area-pb"
  >
    <div class="max-w-lg mx-auto pp-card p-4 shadow-2xl border border-accent/30 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
      <div class="flex-1">
        <div class="font-bold text-navy text-sm">📱 Phone par install karein</div>
        <p v-if="!isIOS" class="text-xs text-slate-600 mt-1">
          Pama Suite ko home screen par add karein — ek link, offline bhi chalega, auto-update.
        </p>
        <p v-else class="text-xs text-slate-600 mt-1">
          Safari → Share <strong>⎙</strong> → <strong>Add to Home Screen</strong> dabayein.
        </p>
      </div>
      <div class="flex gap-2 shrink-0 w-full sm:w-auto">
        <button v-if="!isIOS" class="pp-btn pp-btn-primary flex-1 sm:flex-none text-xs" @click="install">
          Install App
        </button>
        <button class="pp-btn pp-btn-ghost text-xs" @click="dismiss">Baad mein</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.safe-area-pb {
  padding-bottom: max(12px, env(safe-area-inset-bottom));
}
</style>
