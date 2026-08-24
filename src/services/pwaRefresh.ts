/** Safe PWA / app refresh — full cache bust for Vercel deploys. */

export async function hardRefreshApp(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((registration) => registration.unregister()))
    }

    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
    }
  } catch (err) {
    console.warn('App refresh cleanup failed; navigating anyway.', err)
  }

  const path = window.location.pathname || '/dashboard'
  const url = new URL(path, window.location.origin)
  url.searchParams.set('app_refresh', '1')
  url.searchParams.set('_t', String(Date.now()))
  window.location.assign(url.toString())
}

/** Remove one-shot refresh query params so URLs stay clean. */
export function stripRefreshQueryParam(): void {
  try {
    const url = new URL(window.location.href)
    let changed = false
    for (const key of ['_refresh', '_t']) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key)
        changed = true
      }
    }
    if (!changed) return
    const next = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : '') + url.hash
    window.history.replaceState(window.history.state, '', next)
  } catch {
    /* ignore */
  }
}

export function consumeAppRefreshNotice(): boolean {
  try {
    if (sessionStorage.getItem('pama_app_refresh') !== '1') return false
    sessionStorage.removeItem('pama_app_refresh')
    return true
  } catch {
    return false
  }
}
