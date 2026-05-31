import { ref, computed, onMounted } from 'vue'

export function usePwaInstall() {
  const canInstall = ref(false)
  const isStandalone = ref(false)
  const isIOS = ref(false)

  onMounted(() => {
    isIOS.value = /iphone|ipad|ipod/i.test(navigator.userAgent)
    isStandalone.value =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true

    if ((window as any).__pamaInstallPrompt) canInstall.value = true

    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault()
      ;(window as any).__pamaInstallPrompt = e
      canInstall.value = true
    })
  })

  const statusLabel = computed(() => {
    if (isStandalone.value) return 'Installed (home screen app)'
    if (canInstall.value) return 'Ready to install'
    if (isIOS.value) return 'Use Safari → Add to Home Screen'
    return 'Open in Chrome/Edge on HTTPS to install'
  })

  async function install() {
    const prompt = (window as any).__pamaInstallPrompt as { prompt: () => Promise<{ outcome: string }> } | undefined
    if (prompt?.prompt) {
      await prompt.prompt()
      canInstall.value = false
      return true
    }
    return false
  }

  function showInstallBanner() {
    localStorage.removeItem('pama_pwa_install_dismissed')
    window.dispatchEvent(new Event('pama-show-pwa-banner'))
  }

  return { canInstall, isStandalone, isIOS, statusLabel, install, showInstallBanner }
}
