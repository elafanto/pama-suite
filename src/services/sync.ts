import { db } from '@/data/db'
import { getSupabase } from '@/services/supabase'
import { reloadAllStores } from '@/services/reloadStores'
import { useAuthStore } from '@/stores/auth'
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
      const row: any = {
        id: rec.id,
        org_id: orgId,
        firm_id: rec.firm_id || rec.id,
        is_deleted: rec.is_deleted,
        created_at: rec.created_at,
        updated_at: rec.updated_at,
      }

      if (localName === 'firms') {
        Object.assign(row, {
          name: rec.name, gst: rec.gst, addr: rec.addr, city: rec.city, state: rec.state,
          pin: rec.pin, phone: rec.phone, email: rec.email,
          bank_name: rec.bank_name, bank_acno: rec.bank_acno, bank_ifsc: rec.bank_ifsc,
          prefix: rec.prefix, next_bill_no: rec.next_bill_no,
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
        })
      } else {
        row.firm_id = rec.firm_id
        row.payload = rec
      }

      const { error } = await sb.from(remoteName).upsert(row)
      if (error) return { ok: false, pushed, error: error.message }

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
  const sinceIso = since || localStorage.getItem('pama_last_pull') || '1970-01-01T00:00:00.000Z'
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

  const { data: firms, error: fErr } = await sb
    .from('firms')
    .select('*')
    .eq('org_id', orgId)
    .gte('updated_at', sinceIso)
  if (fErr) return { ok: false, pulled, error: fErr.message }
  for (const r of firms || []) {
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
      prefix: r.prefix,
      next_bill_no: r.next_bill_no,
      created_at: r.created_at,
      updated_at: r.updated_at,
      is_deleted: r.is_deleted,
      _dirty: false,
    }
    await merge(db.firms, firm)
  }

  const { data: parties, error: pErr } = await sb
    .from('parties')
    .select('*')
    .eq('org_id', orgId)
    .gte('updated_at', sinceIso)
  if (pErr) return { ok: false, pulled, error: pErr.message }
  for (const r of parties || []) {
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

  const { data: items, error: iErr } = await sb
    .from('items')
    .select('*')
    .eq('org_id', orgId)
    .gte('updated_at', sinceIso)
  if (iErr) return { ok: false, pulled, error: iErr.message }
  for (const r of items || []) {
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
      created_at: r.created_at,
      updated_at: r.updated_at,
      is_deleted: r.is_deleted,
      _dirty: false,
    }
    await merge(db.items, item)
  }

  for (const name of PAYLOAD_TABLES) {
    const { data: rows, error } = await sb
      .from(TABLE_MAP[name])
      .select('id, firm_id, payload, is_deleted, created_at, updated_at')
      .eq('org_id', orgId)
      .gte('updated_at', sinceIso)
    if (error) return { ok: false, pulled, error: error.message }

    const table = (db as any)[name] as { get: (id: string) => Promise<any>; put: (r: any) => Promise<void> }
    for (const r of rows || []) {
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

  localStorage.setItem('pama_last_pull', new Date().toISOString())
  return { ok: true, pulled }
}

export async function runSync(): Promise<string> {
  const pull = await pullFromCloud()
  if (!pull.ok) return pull.error || 'Pull failed'
  const push = await pushDirtyToCloud()
  if (!push.ok) return push.error || 'Sync failed'
  if (pull.pulled > 0) await reloadAllStores()
  const parts: string[] = []
  if (pull.pulled) parts.push(`pulled ${pull.pulled}`)
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
