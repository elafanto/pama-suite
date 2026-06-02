import type { Table } from 'dexie'
import { uid, nowISO } from './util'

/** Strip Vue reactivity / proxies → plain cloneable object (IndexedDB-safe). */
const plain = <X>(o: X): X => JSON.parse(JSON.stringify(o))

interface SyncFields {
  id: string
  created_at: string
  updated_at: string
  is_deleted: boolean
  _dirty?: boolean
}

/**
 * Generic repository over a Dexie table. Stamps sync metadata on every write
 * so a future cloud-sync layer can replicate via _dirty + updated_at.
 */
export function createRepo<T extends SyncFields>(table: Table<T, string>) {
  return {
    async all(firmId?: string): Promise<T[]> {
      const rows = await (firmId
        ? table.where('firm_id').equals(firmId).filter((r) => !r.is_deleted)
        : table.filter((r) => !r.is_deleted)
      ).toArray()
      return rows.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    },

    async get(id: string): Promise<T | undefined> {
      return table.get(id)
    },

    async create(data: Omit<T, keyof SyncFields>): Promise<T> {
      const now = nowISO()
      const rec = plain({
        ...(data as any),
        id: uid(),
        created_at: now,
        updated_at: now,
        is_deleted: false,
        _dirty: true,
      }) as T
      await table.add(rec)
      return rec
    },

    async update(id: string, patch: Partial<T>): Promise<T | undefined> {
      const existing = await table.get(id)
      if (!existing) return undefined
      const rec = plain({ ...existing, ...patch, updated_at: nowISO(), _dirty: true }) as T
      await table.put(rec)
      return rec
    },

    /** Insert or update by id (used by sync + import). */
    async upsert(rec: T): Promise<void> {
      await table.put(plain({ ...rec, updated_at: rec.updated_at || nowISO() }))
    },

    async remove(id: string): Promise<void> {
      const existing = await table.get(id)
      if (!existing) return
      await table.put({ ...existing, is_deleted: true, updated_at: nowISO(), _dirty: true })
    },

    async restore(id: string): Promise<T | undefined> {
      const existing = await table.get(id)
      if (!existing) return undefined
      const rec = plain({ ...existing, is_deleted: false, updated_at: nowISO(), _dirty: true }) as T
      await table.put(rec)
      return rec
    },

    /** Records pending push to cloud (for the future sync queue). */
    async dirty(): Promise<T[]> {
      return table.filter((r) => r._dirty === true).toArray()
    },
  }
}

export type Repo<T extends SyncFields> = ReturnType<typeof createRepo<T>>
