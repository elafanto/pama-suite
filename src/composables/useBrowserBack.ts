import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const ROOT_PATHS = new Set(['/', '/dashboard'])

export function useBrowserBack(fallback = '/dashboard') {
  const route = useRoute()
  const router = useRouter()

  const showBackButton = computed(() => !ROOT_PATHS.has(route.path))

  const hasHistoryBack = computed(() => {
    const back = (window.history.state as { back?: string } | null)?.back
    return typeof back === 'string' && back.length > 0
  })

  function goBack() {
    if (hasHistoryBack.value) {
      router.back()
      return
    }
    router.push(fallback)
  }

  return { showBackButton, hasHistoryBack, goBack }
}
