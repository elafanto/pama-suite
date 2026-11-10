import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSyncDiagnostics, isOptionalMigrationWarning } from '@/services/sync'

describe('isOptionalMigrationWarning', () => {
  it('detects missing party_advances migration message', () => {
    const msg =
      'Supabase table "party_advances" missing. Run supabase/migrations/018_party_advances.sql in Supabase SQL Editor. Local pending rows stay dirty and will sync after migration.'
    expect(isOptionalMigrationWarning(msg)).toBe(true)
  })

  it('ignores hard sync failures', () => {
    expect(isOptionalMigrationWarning('Not logged in')).toBe(false)
    expect(isOptionalMigrationWarning('Cloud upsert failed')).toBe(false)
  })
})

describe('getSyncDiagnostics', () => {
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)) },
      removeItem: (k: string) => { store.delete(k) },
      clear: () => { store.clear() },
    })
  })

  it('surfaces legacy optional-table error text as a warning, not Last error', () => {
    const msg =
      'Supabase table "party_advances" missing. Run supabase/migrations/018_party_advances.sql in Supabase SQL Editor.'
    localStorage.setItem('pama_last_sync_result', 'Synced (signatures backed up, payroll backed up). ' + msg)
    localStorage.setItem('pama_last_sync_error', msg)
    const diag = getSyncDiagnostics()
    expect(diag.lastSyncError).toBe('')
    expect(diag.lastSyncWarning).toContain('party_advances')
    expect(diag.lastSyncWarning).toContain('018_party_advances.sql')
  })
})
