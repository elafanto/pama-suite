import { db } from '@/data/db'
import { nowISO } from '@/data/util'
import { logActivity } from '@/services/activityLog'
import type { LedgerEntry, Purchase, PurchaseItemLine } from '@/types/models'

const plain = <X>(o: X): X => JSON.parse(JSON.stringify(o))
const norm = (value: string | undefined | null) => (value || '').trim().toLowerCase()

export interface MovePurchaseBillsInput {
  purchaseIds: string[]
  fromFirmId: string
  toFirmId: string
  note?: string
}

export interface MovePurchaseBillsResult {
  purchases: number
  vouchers: number
  reelStocks: number
  stockMovements: number
  itemStockMovements: number
  activityLogs: number
  warnings: string[]
}

function retargetLedgerEntries(entries: LedgerEntry[] = [], fromFirmId: string, toFirmId: string): LedgerEntry[] {
  return entries.map((entry) => ({
    ...entry,
    accountId: entry.accountId?.startsWith(`${fromFirmId}_`)
      ? `${toFirmId}_${entry.accountId.slice(fromFirmId.length + 1)}`
      : entry.accountId,
  }))
}

function uniqueWarnings(warnings: string[]) {
  return Array.from(new Set(warnings)).slice(0, 8)
}

/**
 * Correct purchase bills uploaded under the wrong firm.
 *
 * This intentionally retags only purchase-owned records and linked ledger/stock
 * rows. It does not move parties/items across firms; exact target-firm matches
 * are used when present, otherwise existing references are preserved and the UI
 * reports warnings so the operator can create missing masters if needed.
 */
export async function movePurchaseBillsToFirm(input: MovePurchaseBillsInput): Promise<MovePurchaseBillsResult> {
  const purchaseIds = Array.from(new Set(input.purchaseIds.filter(Boolean)))
  if (!input.fromFirmId) throw new Error('Source firm is required')
  if (!input.toFirmId) throw new Error('Target firm is required')
  if (input.fromFirmId === input.toFirmId) throw new Error('Target firm must be different')
  if (purchaseIds.length === 0) throw new Error('Select at least one purchase bill')

  const [fromFirm, toFirm, allPurchases, targetParties, targetItems] = await Promise.all([
    db.firms.get(input.fromFirmId),
    db.firms.get(input.toFirmId),
    db.purchases.bulkGet(purchaseIds),
    db.parties.filter((p) => !p.is_deleted && p.firm_id === input.toFirmId).toArray(),
    db.items.filter((i) => !i.is_deleted && i.firm_id === input.toFirmId).toArray(),
  ])

  if (!fromFirm) throw new Error('Source firm not found')
  if (!toFirm) throw new Error('Target firm not found')
  const sourceFirm = fromFirm
  const targetFirm = toFirm

  const purchases = allPurchases.filter((p): p is Purchase => !!p && !p.is_deleted)
  if (purchases.length !== purchaseIds.length) throw new Error('Some selected purchase bills were not found')

  const wrongFirm = purchases.find((p) => p.firm_id !== input.fromFirmId)
  if (wrongFirm) {
    throw new Error(`Purchase ${wrongFirm.bill_no || wrongFirm.id} does not belong to the selected source firm`)
  }

  const targetVendorByName = new Map(targetParties
    .filter((p) => p.roles?.includes('vendor'))
    .map((p) => [norm(p.name), p]))
  const targetItemByName = new Map(targetItems.map((i) => [norm(i.name), i]))
  const targetItemIds = new Set(targetItems.map((i) => i.id))
  const warnings: string[] = []
  const itemIdMap = new Map<string, string>()
  const supplierIdMap = new Map<string, string>()

  function retargetSupplier(purchase: Purchase) {
    if (!purchase.supplier_id) return purchase.supplier_id
    const match = targetVendorByName.get(norm(purchase.supplier_name))
    if (match) {
      supplierIdMap.set(purchase.supplier_id, match.id)
      return match.id
    }
    warnings.push(`Vendor "${purchase.supplier_name}" was not found in ${targetFirm.name}; existing supplier reference was kept.`)
    return purchase.supplier_id
  }

  function retargetItemLine(line: PurchaseItemLine): PurchaseItemLine {
    if (!line.item_id) return line
    if (targetItemIds.has(line.item_id)) return line

    const match = targetItemByName.get(norm(line.name))
    if (match) {
      itemIdMap.set(line.item_id, match.id)
      return { ...line, item_id: match.id, name: match.name, hsn: match.hsn || line.hsn, unit: match.unit || line.unit }
    }

    warnings.push(`Item "${line.name}" was not found in ${targetFirm.name}; existing item reference was kept.`)
    return line
  }

  const now = nowISO()
  const result: MovePurchaseBillsResult = {
    purchases: 0,
    vouchers: 0,
    reelStocks: 0,
    stockMovements: 0,
    itemStockMovements: 0,
    activityLogs: 0,
    warnings: [],
  }
  const idSet = new Set(purchaseIds)
  const paymentRefSet = new Set(purchaseIds.map((id) => `${id}_PAY`))

  await db.transaction(
    'rw',
    [
      db.purchases,
      db.vouchers,
      db.reel_stocks,
      db.stock_movements,
      db.item_stock_movements,
      db.activity_log,
    ],
    async () => {
      for (const purchase of purchases) {
        await db.purchases.put(plain({
          ...purchase,
          firm_id: input.toFirmId,
          supplier_id: retargetSupplier(purchase),
          items: (purchase.items || []).map(retargetItemLine),
          updated_at: now,
          _dirty: true,
        }))
        result.purchases++
      }

      const vouchers = await db.vouchers
        .filter((v) => !!v.ref_id && (idSet.has(v.ref_id) || paymentRefSet.has(v.ref_id)))
        .toArray()
      for (const voucher of vouchers) {
        await db.vouchers.put(plain({
          ...voucher,
          firm_id: input.toFirmId,
          entries: retargetLedgerEntries(voucher.entries, input.fromFirmId, input.toFirmId),
          updated_at: now,
          _dirty: true,
        }))
        result.vouchers++
      }

      const reels = await db.reel_stocks
        .filter((r) => !!r.purchase_id && idSet.has(r.purchase_id))
        .toArray()
      for (const reel of reels) {
        await db.reel_stocks.put(plain({
          ...reel,
          firm_id: input.toFirmId,
          supplier_id: reel.supplier_id && supplierIdMap.has(reel.supplier_id) ? supplierIdMap.get(reel.supplier_id)! : reel.supplier_id,
          updated_at: now,
          _dirty: true,
        }))
        result.reelStocks++
      }

      const stockMovements = await db.stock_movements
        .filter((m) => m.source === 'purchase' && idSet.has(m.ref_id))
        .toArray()
      for (const movement of stockMovements) {
        await db.stock_movements.put(plain({
          ...movement,
          firm_id: input.toFirmId,
          updated_at: now,
          _dirty: true,
        }))
        result.stockMovements++
      }

      const itemStockMovements = await db.item_stock_movements
        .filter((m) => m.source === 'purchase' && m.ref_type === 'purchase' && !!m.ref_id && idSet.has(m.ref_id))
        .toArray()
      for (const movement of itemStockMovements) {
        await db.item_stock_movements.put(plain({
          ...movement,
          firm_id: input.toFirmId,
          item_id: itemIdMap.get(movement.item_id) || movement.item_id,
          updated_at: now,
          _dirty: true,
        }))
        result.itemStockMovements++
      }

      const activityLogs = await db.activity_log
        .filter((log) => log.entity_type === 'purchase' && idSet.has(log.entity_id))
        .toArray()
      for (const log of activityLogs) {
        await db.activity_log.put(plain({
          ...log,
          firm_id: input.toFirmId,
          updated_at: now,
          _dirty: true,
        }))
        result.activityLogs++
      }
    },
  )

  result.warnings = uniqueWarnings(warnings)
  const billNos = purchases.map((p) => p.bill_no || p.id.slice(0, 8)).join(', ')
  const summary = `${purchaseIds.length} purchase bill(s) moved from ${sourceFirm.name} to ${targetFirm.name}: ${billNos}`
  await logActivity(input.fromFirmId, 'move_out', 'purchase_correction', purchaseIds.join(','), summary, {
    to_firm_id: input.toFirmId,
    purchase_ids: purchaseIds,
    note: input.note || '',
  })
  await logActivity(input.toFirmId, 'move_in', 'purchase_correction', purchaseIds.join(','), summary, {
    from_firm_id: input.fromFirmId,
    purchase_ids: purchaseIds,
    note: input.note || '',
  })

  return result
}
