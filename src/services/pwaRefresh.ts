/** Safe PWA / app refresh — avoids blank screen from SKIP_WAITING + instant reload races. */

export async function hardRefreshApp(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration()
      if (registration) {
        try {
          await registration.update()
        } catch {
          /* offline / no new SW */
        }
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' })
          await waitForControllerChange(2500)
        }
      }
    }

    // Drop Cache Storage so the next load cannot request deleted hashed assets.
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
    }
  } catch (err) {
    console.warn('App refresh cleanup failed; navigating anyway.', err)
  }

  // Hard navigation (not reload) bypasses bfcache and forces a fresh index.html.
  const url = new URL(window.location.href)
  url.searchParams.set('_refresh', String(Date.now()))
  window.location.replace(url.pathname + url.search + url.hash)
}

function waitForControllerChange(timeoutMs: number): Promise<void> {
  if (!('serviceWorker' in navigator)) return Promise.resolve()
  if (!navigator.serviceWorker.controller) {
    return new Promise((resolve) => setTimeout(resolve, Math.min(400, timeoutMs)))
  }

  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      navigator.serviceWorker.removeEventListener('controllerchange', finish)
      resolve()
    }
    const timer = window.setTimeout(finish, timeoutMs)
    navigator.serviceWorker.addEventListener('controllerchange', finish)
  })
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
