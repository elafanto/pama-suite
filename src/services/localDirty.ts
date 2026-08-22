/** Lightweight pub/sub so Dexie writes can request cloud sync without circular imports. */

type DirtyListener = () => void

const listeners = new Set<DirtyListener>()

export function onLocalDirty(listener: DirtyListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyLocalDirty(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      /* never block local saves */
    }
  }
}
