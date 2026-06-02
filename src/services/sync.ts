import { db } from '@/data/db'
import { nowISO } from '@/data/util'
import { getSupabase } from '@/services/supabase'
import { reloadAllStores } from '@/services/reloadStores'
import { useAuthStore } from '@/stores/auth'
import { allocateBillNo, findDuplicateBillNoGroups, resolveNextSequence } from '@/services/invoiceNumber'
import type { Firm, Party, Item, Invoice, Purchase, Recipe, Account, Voucher, ItemStockMovement } from '@/types/models'
import type { RealtimeChannel } from '@supabase/supabase-js'

type SyncTable =
  | 'firms'
  | 'parties'
  | 'items'
  | 'invoices'
  | 'purchases'
  | 'recipes'
  | 'accounts'
  | 'vouchers'
  | 'reel_stocks'
  | 'production_jobs'
  | 'production_stages'
  | 'stock_movements'
  | 'item_stock_movements'

const TABLE_MAP: Record<SyncTable, string> = {
  firms: 'firms',
  parties: 'parties',
  items: 'items',
  invoices: 'invoices',
  purchases: 'purchases',
  recipes: 'recipes',
  accounts: 'accounts',
  vouchers: 'vouchers',
  reel_stocks: 'reel_stocks',
  production_jobs: 'production_jobs',
  production_stages: 'production_stages',
  stock_movements: 'stock_movements',
  item_stock_movements: 'item_stock_movements',
}

const PAYLOAD_TABLES: SyncTable[] = [
  'invoices',
  'purchases',
  'recipes',
  'accounts',
  'vouchers',
  'reel_stocks',
  'production_jobs',
  'production_stages',
  'stock_movements',
  'item_stock_movements',
]

function isNewer(remote: string, local?: string): boolean {
  if (!local) return true
  return new Date(remote).getTime() > new Date(local).getTime()
}

const PULL_PAGE_SIZE = 1000
const EPOCH_ISO = '1970-01-01T00:00:00.000Z'
const LAST_SYNC_AT_KEY = 'pama_last_sync_at'
const LAST_SYNC_RESULT_KEY = 'pama_last_sync_result'
const LAST_SYNC_ERROR_KEY = 'pama_last_sync_error'
const OPTIONAL_TABLE_MIGRATIONS: Partial<Record<SyncTable, string>> = {
  reel_stocks: '005_production_tracking.sql',
  production_jobs: '005_production_tracking.sql',
  production_stages: '005_production_tracking.sql',
  stock_movements: '005_production_tracking.sql',
  item_stock_movements: '006_item_stock_movements.sql',
}

let syncInFlight: Promise<string> | null = null

export interface SyncDiagnostics {
  lastPull: string
  lastSyncAt: string
  lastSyncResult: string
  lastSyncError: string
}

function isMissingRemoteTableError(message: string): boolean {
  return /Could not find the table .* in the schema cache|relation .* does not exist/i.test(message)
}

function optionalTableWarning(localName: SyncTable, message: string): string {
  const migration = OPTIONAL_TABLE_MIGRATIONS[localName]
  if (!migration || !isMissingRemoteTableError(message)) return ''
  return `Supabase table "${TABLE_MAP[localName]}" missing. Run supabase/migrations/${migration} in Supabase SQL Editor. Local pending rows stay dirty and will sync after migration.`
}

function uniqWarnings(warnings: string[]): string[] {
  return [...new Set(warnings.filter(Boolean))]
}

function withWarnings(message: string, warnings?: string[]): string {
  const unique = uniqWarnings(warnings || [])
  return unique.length ? `${message}. ${unique.join(' ')}` : message
}

function dirtyPullWarning(localName: SyncTable): string {
  return `Skipped incoming "${TABLE_MAP[localName]}" updates because matching local rows have unsynced changes. Local rows stay dirty; resolve conflicts before accepting those cloud updates.`
}

function runSingleFlightSync(work: () => Promise<string>): Promise<string> {
  if (syncInFlight) return syncInFlight
  syncInFlight = work().finally(() => {
    syncInFlight = null
  })
  return syncInFlight
}

function readLocalStorage(key: string): string {
  try {
    return localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

function rememberSyncResult(message: string, error = ''): void {
  try {
    localStorage.setItem(LAST_SYNC_AT_KEY, nowISO())
    localStorage.setItem(LAST_SYNC_RESULT_KEY, message)
    if (error) localStorage.setItem(LAST_SYNC_ERROR_KEY, error)
    else localStorage.removeItem(LAST_SYNC_ERROR_KEY)
  } catch {
    // Diagnostics should never block sync.
  }
}

export function getSyncDiagnostics(): SyncDiagnostics {
  return {
    lastPull: readLocalStorage('pama_last_pull'),
    lastSyncAt: readLocalStorage(LAST_SYNC_AT_KEY),
    lastSyncResult: readLocalStorage(LAST_SYNC_RESULT_KEY),
    lastSyncError: readLocalStorage(LAST_SYNC_ERROR_KEY),
  }
}

/** Supabase returns max 1000 rows per request — paginate until all rows are fetched. */
async function fetchAllOrgRows(
  sb: NonNullable<ReturnType<typeof getSupabase>>,
  table: string,
  orgId: string,
  sinceIso: string,
  select: string,
): Promise<any[]> {
  const all: any[] = []
  let from = 0
  while (true) {
    const { data, error } = await sb
      .from(table)
      .select(select)
      .eq('org_id', orgId)
      .gte('updated_at', sinceIso)
      .order('updated_at', { ascending: true })
      .range(from, from + PULL_PAGE_SIZE - 1)
    if (error) throw error
    if (!data?.length) break
    all.push(...data)
    if (data.length < PULL_PAGE_SIZE) break
    from += PULL_PAGE_SIZE
  }
  return all
}

async function upsertCloudRow(
  sb: NonNullable<ReturnType<typeof getSupabase>>,
  orgId: string,
  localName: SyncTable,
  remoteName: string,
  rec: any,
  cloudUpdatedAt: string,
): Promise<{ error?: string; skipped?: string }> {
  const row: any = {
    id: rec.id,
    org_id: orgId,
    is_deleted: rec.is_deleted,
    created_at: rec.created_at,
    updated_at: cloudUpdatedAt,
  }

  if (localName === 'firms') {
    const { data: remoteFirm } = await sb
      .from(remoteName)
      .select('next_bill_no')
      .eq('id', rec.id)
      .eq('org_id', orgId)
      .maybeSingle()
    Object.assign(row, {
      name: rec.name, gst: rec.gst, addr: rec.addr, city: rec.city, state: rec.state,
      pin: rec.pin, phone: rec.phone, email: rec.email,
      bank_name: rec.bank_name, bank_acno: rec.bank_acno, bank_ifsc: rec.bank_ifsc,
      logo: rec.logo, signature: rec.signature, decl: rec.decl, terms: rec.terms,
      prefix: rec.prefix || 'INV',
      next_bill_no: Math.max(Number(rec.next_bill_no) || 1, Number(remoteFirm?.next_bill_no) || 1),
    })
  } else if (localName === 'parties') {
    Object.assign(row, {
      firm_id: rec.firm_id, name: rec.name, roles: rec.roles, gst: rec.gst,
      phone: rec.phone, email: rec.email, addr: rec.addr, city: rec.city,
      pin: rec.pin, state: rec.state, is_consumer: rec.is_consumer,
      bank: rec.bank, acno: rec.acno, ifsc: rec.ifsc, acname: rec.acname,
    })
  } else if (localName === 'items') {
    Object.assign(row, {
      firm_id: rec.firm_id, name: rec.name, unit: rec.unit, hsn: rec.hsn,
      gst: rec.gst, rate: rec.rate, size: rec.size, gsm: rec.gsm, bf: rec.bf,
      track_stock: rec.track_stock, opening_stock: rec.opening_stock,
      reorder_level: rec.reorder_level, purchase_rate: rec.purchase_rate,
    })
  } else {
    row.firm_id = rec.firm_id
    row.payload = { ...rec, updated_at: cloudUpdatedAt }
  }

  let { error } = await sb.from(remoteName).upsert(row)
  if (error && /column .* does not exist|Could not find .* column/i.test(error.message || '')) {
    // Older Supabase schemas keep syncing core data until the latest migration is applied.
    for (const k of ['signature', 'track_stock', 'opening_stock', 'reorder_level', 'purchase_rate']) {
      delete row[k]
    }
    ;({ error } = await sb.from(remoteName).upsert(row))
  }
  if (error) {
    const skipped = optionalTableWarning(localName, error.message || '')
    if (skipped) return { skipped }
    return { error: error.message || 'Cloud upsert failed' }
  }
  return {}
}

async function repairLocalInvoiceNumberState(): Promise<number> {
  let repaired = 0
  const firms = await db.firms.filter((f) => !f.is_deleted).toArray()
  for (const firm of firms) {
    let invoices = await db.invoices.where('firm_id').equals(firm.id).filter((b) => !b.is_deleted).toArray()
    const groups = findDuplicateBillNoGroups(invoices)
    for (const group of groups) {
      const ordered = [...group].sort((a, b) =>
        (a.created_at || a.updated_at || '').localeCompare(b.created_at || b.updated_at || ''),
      )
      for (const dup of ordered.slice(1)) {
        const { billNo } = allocateBillNo(firm, invoices)
        const updated = { ...dup, bill_no: billNo, updated_at: nowISO(), _dirty: true }
        await db.invoices.put(updated)
        invoices = invoices.map((b) => (b.id === dup.id ? updated : b))
        repaired++
      }
    }
    const freshInvoices = await db.invoices.where('firm_id').equals(firm.id).filter((b) => !b.is_deleted).toArray()
    const resolved = resolveNextSequence(firm, freshInvoices)
    if ((firm.next_bill_no || 1) < resolved) {
      await db.firms.put({ ...firm, next_bill_no: resolved, updated_at: nowISO(), _dirty: true })
      repaired++
    }
  }
  return repaired
}

/** Push all _dirty records to Supabase (jsonb payload tables). */
export async function pushDirtyToCloud(): Promise<{ ok: boolean; pushed: number; error?: string; warnings?: string[] }> {
  const auth = useAuthStore()
  const sb = getSupabase()
  if (!sb || !auth.canSync || !auth.orgId) {
    return { ok: false, pushed: 0, error: 'Login + Supabase required for cloud sync' }
  }

  let pushed = 0
  const warnings: string[] = []
  const orgId = auth.orgId
  const cloudUpdatedAt = nowISO()

  for (const [localName, remoteName] of Object.entries(TABLE_MAP) as [SyncTable, string][]) {
    const table = (db as any)[localName]
    if (!table) continue
    const dirty = await table.filter((r: any) => r._dirty === true).toArray()

    for (const rec of dirty) {
      const result = await upsertCloudRow(sb, orgId, localName, remoteName, rec, cloudUpdatedAt)
      if (result.error) return { ok: false, pushed, error: result.error, warnings: uniqWarnings(warnings) }
      if (result.skipped) {
        warnings.push(result.skipped)
        break
      }

      await table.update(rec.id, { _dirty: false, updated_at: cloudUpdatedAt })
      pushed++
    }
  }

  return { ok: true, pushed, warnings: uniqWarnings(warnings) }
}

/** Push every local record to cloud (use after import or when cloud is missing data). */
export async function pushAllToCloud(): Promise<{ ok: boolean; pushed: number; error?: string; warnings?: string[] }> {
  const auth = useAuthStore()
  const sb = getSupabase()
  if (!sb || !auth.canSync || !auth.orgId) {
    return { ok: false, pushed: 0, error: 'Login + Supabase required for cloud sync' }
  }

  let pushed = 0
  const warnings: string[] = []
  const orgId = auth.orgId
  const cloudUpdatedAt = nowISO()

  for (const [localName, remoteName] of Object.entries(TABLE_MAP) as [SyncTable, string][]) {
    const table = (db as any)[localName]
    if (!table) continue
    const rows = await table.toArray()

    for (const rec of rows) {
      const result = await upsertCloudRow(sb, orgId, localName, remoteName, rec, cloudUpdatedAt)
      if (result.error) return { ok: false, pushed, error: result.error, warnings: uniqWarnings(warnings) }
      if (result.skipped) {
        warnings.push(result.skipped)
        for (const row of rows) await table.update(row.id, { _dirty: true })
        break
      }
      await table.update(rec.id, { _dirty: false, updated_at: cloudUpdatedAt })
      pushed++
    }
  }

  return { ok: true, pushed, warnings: uniqWarnings(warnings) }
}

/** Pull cloud records updated after `since` and merge into Dexie when remote is newer. */
export async function pullFromCloud(since?: string): Promise<{ ok: boolean; pulled: number; _maxCloudTs?: string; error?: string; warnings?: string[] }> {
  const auth = useAuthStore()
  const sb = getSupabase()
  if (!sb || !auth.canSync || !auth.orgId) {
    return { ok: false, pulled: 0, error: 'Not logged in' }
  }

  const orgId = auth.orgId
  const sinceIso = since || localStorage.getItem('pama_last_pull') || EPOCH_ISO
  let pulled = 0
  let _maxCloudTs = ''
  const warnings: string[] = []

  const noteCloudTs = (updatedAt?: string) => {
    if (updatedAt && updatedAt > _maxCloudTs) _maxCloudTs = updatedAt
  }

  const merge = async <T extends { id: string; updated_at: string }>(
    localName: SyncTable,
    table: { get: (id: string) => Promise<T | undefined>; put: (r: T) => Promise<unknown> },
    row: T,
  ) => {
    // Track highest cloud timestamp to anchor next incremental pull.
    noteCloudTs(row.updated_at)
    const local = await table.get(row.id)
    if (!isNewer(row.updated_at, local?.updated_at)) return
    if ((local as any)?._dirty) {
      warnings.push(dirtyPullWarning(localName))
      return
    }
    await table.put({ ...row, _dirty: false })
    pulled++
  }

  try {
    const firms = await fetchAllOrgRows(sb, 'firms', orgId, sinceIso, '*')
    for (const r of firms) {
      const firm: Firm = {
        id: r.id,
        name: r.name,
        gst: r.gst || '',
        addr: r.addr || '',
        city: r.city || '',
        state: r.state || '',
        pin: r.pin || '',
        phone: r.phone || '',
        email: r.email || '',
        bank_name: r.bank_name || '',
        bank_acno: r.bank_acno || '',
        bank_ifsc: r.bank_ifsc || '',
        logo: r.logo || '',
        signature: r.signature || '',
        decl: r.decl || '',
        terms: r.terms || '',
        prefix: r.prefix || 'INV',
        next_bill_no: r.next_bill_no || 1,
        created_at: r.created_at,
        updated_at: r.updated_at,
        is_deleted: r.is_deleted,
        _dirty: false,
      }
      noteCloudTs(firm.updated_at)
      const local = await db.firms.get(firm.id)
      if (local && isNewer(firm.updated_at, local.updated_at)) {
        if (local._dirty) {
          warnings.push(dirtyPullWarning('firms'))
          continue
        }
        const nextBillNo = Math.max(local.next_bill_no || 1, firm.next_bill_no || 1)
        await db.firms.put({
          ...firm,
          next_bill_no: nextBillNo,
          _dirty: nextBillNo > (firm.next_bill_no || 1),
        })
        pulled++
      } else if (!local) {
        await merge('firms', db.firms, firm)
      }
    }

    const parties = await fetchAllOrgRows(sb, 'parties', orgId, sinceIso, '*')
    for (const r of parties) {
      const party: Party = {
        id: r.id,
        firm_id: r.firm_id,
        name: r.name,
        roles: r.roles || [],
        gst: r.gst || '',
        phone: r.phone || '',
        email: r.email || '',
        addr: r.addr || '',
        city: r.city || '',
        pin: r.pin || '',
        state: r.state || '',
        is_consumer: r.is_consumer,
        bank: r.bank || '',
        acno: r.acno || '',
        ifsc: r.ifsc || '',
        acname: r.acname || '',
        created_at: r.created_at,
        updated_at: r.updated_at,
        is_deleted: r.is_deleted,
        _dirty: false,
      }
      await merge('parties', db.parties, party)
    }

    const items = await fetchAllOrgRows(sb, 'items', orgId, sinceIso, '*')
    for (const r of items) {
      const item: Item = {
        id: r.id,
        firm_id: r.firm_id,
        name: r.name,
        unit: r.unit || 'PCS',
        hsn: r.hsn || '',
        gst: Number(r.gst) || 0,
        rate: Number(r.rate) || 0,
        size: r.size || '',
        gsm: r.gsm || '',
        bf: r.bf || '',
        track_stock: r.track_stock !== false,
        opening_stock: Number(r.opening_stock) || 0,
        reorder_level: Number(r.reorder_level) || 0,
        purchase_rate: Number(r.purchase_rate) || 0,
        created_at: r.created_at,
        updated_at: r.updated_at,
        is_deleted: r.is_deleted,
        _dirty: false,
      }
      await merge('items', db.items, item)
    }

    for (const name of PAYLOAD_TABLES) {
      let rows: any[]
      try {
        rows = await fetchAllOrgRows(
          sb,
          TABLE_MAP[name],
          orgId,
          sinceIso,
          'id, firm_id, payload, is_deleted, created_at, updated_at',
        )
      } catch (e: any) {
        const skipped = optionalTableWarning(name, e?.message || '')
        if (skipped) {
          warnings.push(skipped)
          continue
        }
        throw e
      }
      const table = (db as any)[name] as { get: (id: string) => Promise<any>; put: (r: any) => Promise<void> }
      for (const r of rows) {
        const payload = r.payload as Invoice | Purchase | Recipe | Account | Voucher | ItemStockMovement
        const rec = {
          ...payload,
          id: r.id,
          firm_id: r.firm_id,
          is_deleted: r.is_deleted,
          created_at: r.created_at,
          updated_at: r.updated_at,
          _dirty: false,
        }
        await merge(name, table, rec)
      }
    }
  } catch (e: any) {
    return { ok: false, pulled, _maxCloudTs, error: e?.message || 'Pull failed' }
  }

  // Use the highest cloud updated_at we saw (instead of device clock) so
  // a device whose clock is behind never misses recently-updated records.
  if (_maxCloudTs) localStorage.setItem('pama_last_pull', _maxCloudTs)
  return { ok: true, pulled, _maxCloudTs, warnings: uniqWarnings(warnings) }
}

/** Re-download all cloud data (fixes partial sync on new phone / after 1000-row limit). */
export async function runFullPullFromCloud(): Promise<string> {
  return runSingleFlightSync(async () => {
    localStorage.removeItem('pama_last_pull')
    const pull = await pullFromCloud(EPOCH_ISO)
    if (!pull.ok) {
      const message = pull.error || 'Full pull failed'
      rememberSyncResult(message, message)
      return message
    }
    const repaired = await repairLocalInvoiceNumberState()
    if (pull.pulled > 0) await reloadAllStores()
    const message = withWarnings(
      pull.pulled || repaired ? `Full pull: ${pull.pulled} records${repaired ? `, repaired ${repaired}` : ''}` : 'Cloud has no data for this account',
      pull.warnings,
    )
    rememberSyncResult(message, uniqWarnings(pull.warnings || []).join(' '))
    return message
  })
}

/** Upload all local data to cloud (fixes phone missing data after PC import). */
export async function runFullPushToCloud(): Promise<string> {
  return runSingleFlightSync(async () => {
    const push = await pushAllToCloud()
    if (!push.ok) {
      const message = push.error || 'Full push failed'
      rememberSyncResult(message, message)
      return message
    }
    const message = withWarnings(push.pushed ? `Full push: ${push.pushed} records` : 'No local records to push', push.warnings)
    rememberSyncResult(message, uniqWarnings(push.warnings || []).join(' '))
    return message
  })
}

export async function runSync(): Promise<string> {
  return runSingleFlightSync(async () => {
    const pull = await pullFromCloud()
    if (!pull.ok) {
      const message = pull.error || 'Pull failed'
      rememberSyncResult(message, message)
      return message
    }
    const repaired = await repairLocalInvoiceNumberState()
    const push = await pushDirtyToCloud()
    if (!push.ok) {
      const message = push.error || 'Sync failed'
      rememberSyncResult(message, message)
      return message
    }
    if (pull.pulled > 0) await reloadAllStores()
    const parts: string[] = []
    if (pull.pulled) parts.push(`pulled ${pull.pulled}`)
    if (repaired) parts.push(`repaired ${repaired}`)
    if (push.pushed) parts.push(`pushed ${push.pushed}`)
    const warnings = uniqWarnings([...(pull.warnings || []), ...(push.warnings || [])])
    const message = withWarnings(parts.length ? `Synced (${parts.join(', ')})` : 'Already up to date', warnings)
    rememberSyncResult(message, warnings.join(' '))
    return message
  })
}

let realtimeChannel: RealtimeChannel | null = null
let syncDebounce: ReturnType<typeof setTimeout> | null = null

/** Listen for remote DB changes and debounce-pull (multi-device sync). */
export function startCloudRealtime(onSynced?: (msg: string) => void): () => void {
  const auth = useAuthStore()
  const sb = getSupabase()
  stopCloudRealtime()
  if (!sb || !auth.orgId) return () => {}

  const orgId = auth.orgId
  const channel = sb.channel(`pama-org-${orgId}`)
  for (const table of Object.values(TABLE_MAP)) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `org_id=eq.${orgId}` },
      () => {
        if (syncDebounce) clearTimeout(syncDebounce)
        syncDebounce = setTimeout(async () => {
          const msg = await runSync()
          onSynced?.(msg)
        }, 1500)
      },
    )
  }
  channel.subscribe()
  realtimeChannel = channel
  return stopCloudRealtime
}

export function stopCloudRealtime() {
  const sb = getSupabase()
  if (realtimeChannel && sb) sb.removeChannel(realtimeChannel)
  realtimeChannel = null
  if (syncDebounce) clearTimeout(syncDebounce)
  syncDebounce = null
}
