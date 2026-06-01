import { db } from '@/data/db'
import { nowISO } from '@/data/util'
import { getSupabase } from '@/services/supabase'
import { reloadAllStores } from '@/services/reloadStores'
import { useAuthStore } from '@/stores/auth'
import { allocateBillNo, findDuplicateBillNoGroups, resolveNextSequence } from '@/services/invoiceNumber'
import type { Firm, Party, Item, Invoice, Purchase, Recipe, Account, Voucher } from '@/types/models'
import type { RealtimeChannel } from '@supabase/supabase-js'

type SyncTable = 'firms' | 'parties' | 'items' | 'invoices' | 'purchases' | 'recipes' | 'accounts' | 'vouchers'

const TABLE_MAP: Record<SyncTable, string> = {
  firms: 'firms',
  parties: 'parties',
  items: 'items',
  invoices: 'invoices',
  purchases: 'purchases',
  recipes: 'recipes',
  accounts: 'accounts',
  vouchers: 'vouchers',
}

const PAYLOAD_TABLES: SyncTable[] = ['invoices', 'purchases', 'recipes', 'accounts', 'vouchers']

function isNewer(remote: string, local?: string): boolean {
  if (!local) return true
  return new Date(remote).getTime() > new Date(local).getTime()
}

const PULL_PAGE_SIZE = 1000
const EPOCH_ISO = '1970-01-01T00:00:00.000Z'

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
): Promise<string | null> {
  const row: any = {
    id: rec.id,
    org_id: orgId,
    is_deleted: rec.is_deleted,
    created_at: rec.created_at,
    updated_at: rec.updated_at,
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
    row.payload = rec
  }

  let { error } = await sb.from(remoteName).upsert(row)
  if (error && /column .* does not exist|Could not find .* column/i.test(error.message || '')) {
    // Older Supabase schemas keep syncing core data until the latest migration is applied.
    for (const k of ['signature', 'track_stock', 'opening_stock', 'reorder_level', 'purchase_rate']) {
      delete row[k]
    }
    ;({ error } = await sb.from(remoteName).upsert(row))
  }
  return error?.message || null
}

async function repairLocalInvoiceNumberState(): Promise<number> {
  let repaired = 0
  const firms = await db.firms.filter((f) => !f.is_deleted).toArray()
  for (const firm of firms) {
    let invoices = await db.invoices.filter((b) => b.firm_id === firm.id && !b.is_deleted).toArray()
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
    const freshInvoices = await db.invoices.filter((b) => b.firm_id === firm.id && !b.is_deleted).toArray()
    const resolved = resolveNextSequence(firm, freshInvoices)
    if ((firm.next_bill_no || 1) < resolved) {
      await db.firms.put({ ...firm, next_bill_no: resolved, updated_at: nowISO(), _dirty: true })
      repaired++
    }
  }
  return repaired
}

/** Push all _dirty records to Supabase (jsonb payload tables). */
export async function pushDirtyToCloud(): Promise<{ ok: boolean; pushed: number; error?: string }> {
  const auth = useAuthStore()
  const sb = getSupabase()
  if (!sb || !auth.canSync || !auth.orgId) {
    return { ok: false, pushed: 0, error: 'Login + Supabase required for cloud sync' }
  }

  let pushed = 0
  const orgId = auth.orgId

  for (const [localName, remoteName] of Object.entries(TABLE_MAP) as [SyncTable, string][]) {
    const table = (db as any)[localName]
    if (!table) continue
    const dirty = await table.filter((r: any) => r._dirty === true).toArray()

    for (const rec of dirty) {
      const err = await upsertCloudRow(sb, orgId, localName, remoteName, rec)
      if (err) return { ok: false, pushed, error: err }

      await table.update(rec.id, { _dirty: false })
      pushed++
    }
  }

  return { ok: true, pushed }
}

/** Push every local record to cloud (use after import or when cloud is missing data). */
export async function pushAllToCloud(): Promise<{ ok: boolean; pushed: number; error?: string }> {
  const auth = useAuthStore()
  const sb = getSupabase()
  if (!sb || !auth.canSync || !auth.orgId) {
    return { ok: false, pushed: 0, error: 'Login + Supabase required for cloud sync' }
  }

  let pushed = 0
  const orgId = auth.orgId

  for (const [localName, remoteName] of Object.entries(TABLE_MAP) as [SyncTable, string][]) {
    const table = (db as any)[localName]
    if (!table) continue
    const rows = await table.toArray()

    for (const rec of rows) {
      const err = await upsertCloudRow(sb, orgId, localName, remoteName, rec)
      if (err) return { ok: false, pushed, error: err }
      await table.update(rec.id, { _dirty: false })
      pushed++
    }
  }

  return { ok: true, pushed }
}

/** Pull cloud records updated after `since` and merge into Dexie when remote is newer. */
export async function pullFromCloud(since?: string): Promise<{ ok: boolean; pulled: number; error?: string }> {
  const auth = useAuthStore()
  const sb = getSupabase()
  if (!sb || !auth.canSync || !auth.orgId) {
    return { ok: false, pulled: 0, error: 'Not logged in' }
  }

  const orgId = auth.orgId
  const sinceIso = since || localStorage.getItem('pama_last_pull') || EPOCH_ISO
  let pulled = 0

  const merge = async <T extends { id: string; updated_at: string }>(
    table: { get: (id: string) => Promise<T | undefined>; put: (r: T) => Promise<unknown> },
    row: T,
  ) => {
    const local = await table.get(row.id)
    if (!isNewer(row.updated_at, local?.updated_at)) return
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
      const local = await db.firms.get(firm.id)
      if (local && isNewer(firm.updated_at, local.updated_at)) {
        const nextBillNo = Math.max(local.next_bill_no || 1, firm.next_bill_no || 1)
        await db.firms.put({
          ...firm,
          next_bill_no: nextBillNo,
          _dirty: nextBillNo > (firm.next_bill_no || 1),
        })
        pulled++
      } else if (!local) {
        await merge(db.firms, firm)
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
      await merge(db.parties, party)
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
      await merge(db.items, item)
    }

    for (const name of PAYLOAD_TABLES) {
      const rows = await fetchAllOrgRows(
        sb,
        TABLE_MAP[name],
        orgId,
        sinceIso,
        'id, firm_id, payload, is_deleted, created_at, updated_at',
      )
      const table = (db as any)[name] as { get: (id: string) => Promise<any>; put: (r: any) => Promise<void> }
      for (const r of rows) {
        const payload = r.payload as Invoice | Purchase | Recipe | Account | Voucher
        const rec = {
          ...payload,
          id: r.id,
          firm_id: r.firm_id,
          is_deleted: r.is_deleted,
          created_at: r.created_at,
          updated_at: r.updated_at,
          _dirty: false,
        }
        await merge(table, rec)
      }
    }
  } catch (e: any) {
    return { ok: false, pulled, error: e?.message || 'Pull failed' }
  }

  localStorage.setItem('pama_last_pull', new Date().toISOString())
  return { ok: true, pulled }
}

/** Re-download all cloud data (fixes partial sync on new phone / after 1000-row limit). */
export async function runFullPullFromCloud(): Promise<string> {
  localStorage.removeItem('pama_last_pull')
  const pull = await pullFromCloud(EPOCH_ISO)
  if (!pull.ok) return pull.error || 'Full pull failed'
  const repaired = await repairLocalInvoiceNumberState()
  if (pull.pulled > 0) await reloadAllStores()
  return pull.pulled || repaired ? `Full pull: ${pull.pulled} records${repaired ? `, repaired ${repaired}` : ''}` : 'Cloud has no data for this account'
}

/** Upload all local data to cloud (fixes phone missing data after PC import). */
export async function runFullPushToCloud(): Promise<string> {
  const push = await pushAllToCloud()
  if (!push.ok) return push.error || 'Full push failed'
  return push.pushed ? `Full push: ${push.pushed} records` : 'No local records to push'
}

export async function runSync(): Promise<string> {
  const pull = await pullFromCloud()
  if (!pull.ok) return pull.error || 'Pull failed'
  const repaired = await repairLocalInvoiceNumberState()
  const push = await pushDirtyToCloud()
  if (!push.ok) return push.error || 'Sync failed'
  if (pull.pulled > 0) await reloadAllStores()
  const parts: string[] = []
  if (pull.pulled) parts.push(`pulled ${pull.pulled}`)
  if (repaired) parts.push(`repaired ${repaired}`)
  if (push.pushed) parts.push(`pushed ${push.pushed}`)
  return parts.length ? `Synced (${parts.join(', ')})` : 'Already up to date'
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
