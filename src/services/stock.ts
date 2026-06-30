import { manualAdjustmentTotals } from '@/services/inventoryLedger'
import { isGenericInventoryLine } from '@/services/purchaseLineKind'
import type { Item, Invoice, Purchase, ItemStockMovement } from '@/types/models'

export type StockStatus = 'out' | 'low' | 'ok'

export interface StockRow {
  itemId: string
  name: string
  unit: string
  opening: number
  purchased: number
  sold: number
  adjusted: number
  onHand: number
  reorder: number
  status: StockStatus
  value: number          // onHand × purchase/std rate
  rate: number
}

function normName(name: string): string {
  return (name || '').trim().toLowerCase()
}

export function findStockRowForLine(
  rows: StockRow[],
  line: Pick<Invoice['items'][number], 'item_id' | 'name'>,
): StockRow | null {
  const itemId = (line.item_id || '').trim()
  if (itemId) {
    const byId = rows.find((r) => r.itemId === itemId)
    if (byId) return byId
  }
  const nameKey = (line.name || '').trim().toLowerCase()
  if (!nameKey) return null
  return rows.find((r) => r.name.trim().toLowerCase() === nameKey) || null
}

/**
 * On-hand per item = opening_stock + Σ purchased − Σ sold.
 * Lines are matched by item_id when present, else by a unique lowercased name,
 * so legacy transactions still count without duplicating across same-name items.
 */
export function computeStock(
  items: Item[],
  purchases: Purchase[],
  invoices: Invoice[],
  firmId: string,
  movements: ItemStockMovement[] = [],
): StockRow[] {
  const live = items.filter((i) => !i.is_deleted && i.firm_id === firmId && i.track_stock !== false)
  const liveIds = new Set(live.map((it) => it.id))
  const uniqueItemByName = new Map<string, Item | null>()
  for (const it of live) {
    const key = normName(it.name)
    uniqueItemByName.set(key, uniqueItemByName.has(key) ? null : it)
  }

  const purchasedMap = new Map<string, number>()
  const soldMap = new Map<string, number>()

  function resolveLineItemId(itemId: string | null | undefined, name: string): string | null {
    const trimmedId = itemId?.trim()
    if (trimmedId && liveIds.has(trimmedId)) return trimmedId
    return uniqueItemByName.get(normName(name))?.id || null
  }

  for (const p of purchases) {
    if (p.is_deleted || p.firm_id !== firmId) continue
    for (const l of p.items || []) {
      if (!isGenericInventoryLine(l)) continue
      const itemId = resolveLineItemId(l.item_id, l.name)
      if (!itemId) continue
      purchasedMap.set(itemId, (purchasedMap.get(itemId) || 0) + (Number(l.qty) || 0))
    }
  }
  for (const inv of invoices) {
    if (inv.is_deleted || inv.firm_id !== firmId) continue
    if (inv.doc_type !== 'INVOICE' && inv.doc_type !== 'invoice') continue
    for (const l of inv.items || []) {
      const itemId = resolveLineItemId(l.item_id, l.name)
      if (!itemId) continue
      soldMap.set(itemId, (soldMap.get(itemId) || 0) + (Number(l.qty) || 0))
    }
  }

  const rows: StockRow[] = []
  const adjustments = manualAdjustmentTotals(movements, firmId)
  for (const it of live) {
    const purchased = purchasedMap.get(it.id) || 0
    const sold = soldMap.get(it.id) || 0
    const adjusted = adjustments.get(it.id) || 0
    const opening = Number(it.opening_stock) || 0
    const onHand = opening + purchased - sold + adjusted
    const reorder = Number(it.reorder_level) || 0
    const rate = Number(it.purchase_rate) || Number(it.rate) || 0
    const status: StockStatus = onHand <= 0 ? 'out' : reorder > 0 && onHand <= reorder ? 'low' : 'ok'
    rows.push({
      itemId: it.id, name: it.name, unit: it.unit,
      opening, purchased, sold, onHand, reorder, status,
      adjusted, rate, value: Math.round(onHand * rate * 100) / 100,
    })
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

export interface StockSummary {
  skus: number
  outOfStock: number
  lowStock: number
  totalValue: number
}

export function stockSummary(rows: StockRow[]): StockSummary {
  return {
    skus: rows.length,
    outOfStock: rows.filter((r) => r.status === 'out').length,
    lowStock: rows.filter((r) => r.status === 'low').length,
    totalValue: Math.round(rows.reduce((s, r) => s + r.value, 0) * 100) / 100,
  }
}
