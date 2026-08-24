/** Safe PWA / app refresh — unregister SW + clear caches so Vercel deploy actually loads. */

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

  const url = new URL(window.location.href)
  url.searchParams.set('_refresh', String(Date.now()))
  window.location.replace(url.pathname + url.search + url.hash)
}

/** Remove one-shot refresh query so bookmarks/URLs stay clean. */
export function stripRefreshQueryParam(): void {
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('_refresh')) return
    url.searchParams.delete('_refresh')
    const next = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : '') + url.hash
    window.history.replaceState(window.history.state, '', next)
  } catch {
    /* ignore */
  }
}
