import { db } from '@/data/db'
import { nowISO } from '@/data/util'
import { normalizePartyName } from '@/services/partyPaymentAllocation'
import type { Party, PartyRole } from '@/types/models'

const plain = <X>(o: X): X => JSON.parse(JSON.stringify(o))

export type PartyMergeField =
  | 'name'
  | 'gst'
  | 'phone'
  | 'email'
  | 'addr'
  | 'city'
  | 'pin'
  | 'state'
  | 'is_consumer'
  | 'bank'
  | 'acno'
  | 'ifsc'
  | 'acname'

export interface PartyMergeFieldPicks {
  /** For each conflict field, which party id wins. Missing = prefer winner if non-empty else loser. */
  [field: string]: string | undefined
}

export interface PartyMergePreview {
  winner: Party
  loser: Party
  invoices: number
  purchases: number
  jobs: number
  reels: number
  consumableLots: number
  capitalAssets: number
  recipes: number
  stockMovements: number
  attachments: number
  conflicts: PartyMergeField[]
}

export interface PartyMergeResult {
  winnerId: string
  loserId: string
  rewritten: number
}

function pickValue(winner: Party, loser: Party, field: PartyMergeField, picks?: PartyMergeFieldPicks): any {
  const prefer = picks?.[field]
  const w = (winner as any)[field]
  const l = (loser as any)[field]
  if (prefer === loser.id) return l
  if (prefer === winner.id) return w
  if (field === 'is_consumer') return Boolean(w) || Boolean(l)
  const wEmpty = w == null || String(w).trim() === ''
  const lEmpty = l == null || String(l).trim() === ''
  if (!wEmpty) return w
  if (!lEmpty) return l
  return w
}

function unionRoles(a: PartyRole[], b: PartyRole[]): PartyRole[] {
  return Array.from(new Set([...(a || []), ...(b || [])])) as PartyRole[]
}

function fieldConflicts(winner: Party, loser: Party): PartyMergeField[] {
  const fields: PartyMergeField[] = [
    'name', 'gst', 'phone', 'email', 'addr', 'city', 'pin', 'state',
    'bank', 'acno', 'ifsc', 'acname',
  ]
  return fields.filter((f) => {
    const w = String((winner as any)[f] || '').trim()
    const l = String((loser as any)[f] || '').trim()
    return w && l && w.toLowerCase() !== l.toLowerCase()
  })
}

export async function previewPartyMerge(winnerId: string, loserId: string): Promise<PartyMergePreview> {
  if (!winnerId || !loserId) throw new Error('Dono parties select karo')
  if (winnerId === loserId) throw new Error('Same party merge nahi ho sakti')

  const winner = await db.parties.get(winnerId)
  const loser = await db.parties.get(loserId)
  if (!winner || winner.is_deleted) throw new Error('Keep party nahi mili')
  if (!loser || loser.is_deleted) throw new Error('Merge party nahi mili')
  if (winner.firm_id !== loser.firm_id) throw new Error('Sirf same firm ki parties merge ho sakti hain')

  const firmId = winner.firm_id
  const loserName = normalizePartyName(loser.name)

  const [invoices, purchases, jobs, reels, lots, assets, recipes, moves, attachments] = await Promise.all([
    db.invoices.where('firm_id').equals(firmId).filter((r) => !r.is_deleted && (r.party_id === loserId || normalizePartyName(r.party_name) === loserName)).count(),
    db.purchases.where('firm_id').equals(firmId).filter((r) => !r.is_deleted && (r.supplier_id === loserId || normalizePartyName(r.supplier_name) === loserName)).count(),
    db.production_jobs.where('firm_id').equals(firmId).filter((r) => !r.is_deleted && (r.customer_id === loserId || normalizePartyName(r.customer_name) === loserName)).count(),
    db.reel_stocks.where('firm_id').equals(firmId).filter((r) => !r.is_deleted && (r.supplier_id === loserId || normalizePartyName(r.supplier_name) === loserName)).count(),
    db.consumable_lots.where('firm_id').equals(firmId).filter((r) => !r.is_deleted && (r.supplier_id === loserId || normalizePartyName(r.supplier_name || '') === loserName)).count(),
    db.capital_assets.where('firm_id').equals(firmId).filter((r) => !r.is_deleted && (r.supplier_id === loserId || normalizePartyName(r.supplier_name) === loserName)).count(),
    db.recipes.where('firm_id').equals(firmId).filter((r) => !r.is_deleted && normalizePartyName(r.customer_name) === loserName).count(),
    db.stock_movements.where('firm_id').equals(firmId).filter((r) => !r.is_deleted && r.customer_id === loserId).count(),
    db.document_attachments.where('firm_id').equals(firmId).filter((r) => !r.is_deleted && normalizePartyName(r.party_name || '') === loserName).count(),
  ])

  return {
    winner,
    loser,
    invoices,
    purchases,
    jobs,
    reels,
    consumableLots: lots,
    capitalAssets: assets,
    recipes,
    stockMovements: moves,
    attachments,
    conflicts: fieldConflicts(winner, loser),
  }
}

export async function mergeParties(
  winnerId: string,
  loserId: string,
  fieldPicks?: PartyMergeFieldPicks,
): Promise<PartyMergeResult> {
  const preview = await previewPartyMerge(winnerId, loserId)
  const { winner, loser } = preview

  const gstW = String(pickValue(winner, loser, 'gst', fieldPicks) || '').trim().toUpperCase()
  const gstL = String(pickValue(loser, winner, 'gst', { gst: loser.id }) || '').trim().toUpperCase()
  // If both had different GST and user didn't explicitly pick, block
  if (
    preview.conflicts.includes('gst')
    && fieldPicks?.gst !== winner.id
    && fieldPicks?.gst !== loser.id
  ) {
    throw new Error('GST conflict — pehle Keep / Merge party ka GST choose karo')
  }
  void gstL

  const now = nowISO()
  const mergedName = String(pickValue(winner, loser, 'name', fieldPicks) || winner.name).trim()
  const merged: Party = plain({
    ...winner,
    name: mergedName,
    gst: gstW || winner.gst,
    phone: String(pickValue(winner, loser, 'phone', fieldPicks) || ''),
    email: String(pickValue(winner, loser, 'email', fieldPicks) || ''),
    addr: String(pickValue(winner, loser, 'addr', fieldPicks) || ''),
    city: String(pickValue(winner, loser, 'city', fieldPicks) || ''),
    pin: String(pickValue(winner, loser, 'pin', fieldPicks) || ''),
    state: String(pickValue(winner, loser, 'state', fieldPicks) || ''),
    is_consumer: Boolean(pickValue(winner, loser, 'is_consumer', fieldPicks)),
    bank: String(pickValue(winner, loser, 'bank', fieldPicks) || ''),
    acno: String(pickValue(winner, loser, 'acno', fieldPicks) || ''),
    ifsc: String(pickValue(winner, loser, 'ifsc', fieldPicks) || ''),
    acname: String(pickValue(winner, loser, 'acname', fieldPicks) || ''),
    roles: unionRoles(winner.roles || [], loser.roles || []),
    updated_at: now,
    _dirty: true,
  })

  const loserName = normalizePartyName(loser.name)
  let rewritten = 0

  await db.transaction(
    'rw',
    [
      db.parties,
      db.invoices,
      db.purchases,
      db.production_jobs,
      db.reel_stocks,
      db.consumable_lots,
      db.capital_assets,
      db.recipes,
      db.stock_movements,
      db.document_attachments,
    ],
    async () => {
      const invoices = await db.invoices.where('firm_id').equals(winner.firm_id).toArray()
      for (const inv of invoices) {
        if (inv.is_deleted) continue
        const hit = inv.party_id === loser.id || normalizePartyName(inv.party_name) === loserName
        if (!hit) continue
        const snap = inv.party_snapshot ? { ...inv.party_snapshot, name: mergedName } : inv.party_snapshot
        await db.invoices.put(plain({
          ...inv,
          party_id: winner.id,
          party_name: mergedName,
          party_snapshot: snap,
          updated_at: now,
          _dirty: true,
        }))
        rewritten++
      }

      const purchases = await db.purchases.where('firm_id').equals(winner.firm_id).toArray()
      for (const pur of purchases) {
        if (pur.is_deleted) continue
        const hit = pur.supplier_id === loser.id || normalizePartyName(pur.supplier_name) === loserName
        if (!hit) continue
        await db.purchases.put(plain({
          ...pur,
          supplier_id: winner.id,
          supplier_name: mergedName,
          updated_at: now,
          _dirty: true,
        }))
        rewritten++
      }

      const jobs = await db.production_jobs.where('firm_id').equals(winner.firm_id).toArray()
      for (const job of jobs) {
        if (job.is_deleted) continue
        const hit = job.customer_id === loser.id || normalizePartyName(job.customer_name) === loserName
        if (!hit) continue
        await db.production_jobs.put(plain({
          ...job,
          customer_id: winner.id,
          customer_name: mergedName,
          updated_at: now,
          _dirty: true,
        }))
        rewritten++
      }

      const reels = await db.reel_stocks.where('firm_id').equals(winner.firm_id).toArray()
      for (const reel of reels) {
        if (reel.is_deleted) continue
        const hit = reel.supplier_id === loser.id || normalizePartyName(reel.supplier_name) === loserName
        if (!hit) continue
        await db.reel_stocks.put(plain({
          ...reel,
          supplier_id: winner.id,
          supplier_name: mergedName,
          updated_at: now,
          _dirty: true,
        }))
        rewritten++
      }

      const lots = await db.consumable_lots.where('firm_id').equals(winner.firm_id).toArray()
      for (const lot of lots) {
        if (lot.is_deleted) continue
        const hit = lot.supplier_id === loser.id || normalizePartyName(lot.supplier_name || '') === loserName
        if (!hit) continue
        await db.consumable_lots.put(plain({
          ...lot,
          supplier_id: winner.id,
          supplier_name: mergedName,
          updated_at: now,
          _dirty: true,
        }))
        rewritten++
      }

      const assets = await db.capital_assets.where('firm_id').equals(winner.firm_id).toArray()
      for (const asset of assets) {
        if (asset.is_deleted) continue
        const hit = asset.supplier_id === loser.id || normalizePartyName(asset.supplier_name) === loserName
        if (!hit) continue
        await db.capital_assets.put(plain({
          ...asset,
          supplier_id: winner.id,
          supplier_name: mergedName,
          updated_at: now,
          _dirty: true,
        }))
        rewritten++
      }

      const recipes = await db.recipes.where('firm_id').equals(winner.firm_id).toArray()
      for (const recipe of recipes) {
        if (recipe.is_deleted) continue
        if (normalizePartyName(recipe.customer_name) !== loserName) continue
        await db.recipes.put(plain({
          ...recipe,
          customer_name: mergedName,
          updated_at: now,
          _dirty: true,
        }))
        rewritten++
      }

      const moves = await db.stock_movements.where('firm_id').equals(winner.firm_id).toArray()
      for (const move of moves) {
        if (move.is_deleted || move.customer_id !== loser.id) continue
        await db.stock_movements.put(plain({
          ...move,
          customer_id: winner.id,
          updated_at: now,
          _dirty: true,
        }))
        rewritten++
      }

      const attachments = await db.document_attachments.where('firm_id').equals(winner.firm_id).toArray()
      for (const att of attachments) {
        if (att.is_deleted) continue
        if (normalizePartyName(att.party_name || '') !== loserName) continue
        await db.document_attachments.put(plain({
          ...att,
          party_name: mergedName,
          updated_at: now,
          _dirty: true,
        }))
        rewritten++
      }

      await db.parties.put(merged)
      await db.parties.put(plain({
        ...loser,
        is_deleted: true,
        updated_at: now,
        _dirty: true,
      }))
    },
  )

  // Remap local banking chips
  try {
    const raw = localStorage.getItem('pama_benes')
    if (raw) {
      const list = JSON.parse(raw) as Array<{ name?: string; partyId?: string | null }>
      let changed = false
      for (const row of list) {
        if (row.partyId === loser.id) {
          row.partyId = winner.id
          changed = true
        }
        if (normalizePartyName(row.name || '') === loserName) {
          row.name = mergedName
          changed = true
        }
      }
      if (changed) localStorage.setItem('pama_benes', JSON.stringify(list))
    }
  } catch {
    /* ignore */
  }

  return { winnerId: winner.id, loserId: loser.id, rewritten }
}
