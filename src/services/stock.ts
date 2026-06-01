import type { Item, Invoice, Purchase } from '@/types/models'

export type StockStatus = 'out' | 'low' | 'ok'

export interface StockRow {
  itemId: string
  name: string
  unit: string
  opening: number
  purchased: number
  sold: number
  onHand: number
  reorder: number
  status: StockStatus
  value: number          // onHand × purchase/std rate
  rate: number
}

/** Normalised key to match invoice/purchase lines to an item. */
function lineKey(itemId: string | null | undefined, name: string): string {
  return (itemId && itemId.trim()) || `name:${(name || '').trim().toLowerCase()}`
}

/**
 * On-hand per item = opening_stock + Σ purchased − Σ sold.
 * Lines are matched by item_id when present, else by lowercased name, so
 * transactions entered before an item existed still count.
 */
export function computeStock(
  items: Item[],
  purchases: Purchase[],
  invoices: Invoice[],
  firmId: string,
): StockRow[] {
  const live = items.filter((i) => !i.is_deleted && i.firm_id === firmId && i.track_stock !== false)
  const byKey = new Map<string, Item>()
  for (const it of live) {
    byKey.set(lineKey(it.id, it.name), it)
    byKey.set(`name:${it.name.trim().toLowerCase()}`, it)
  }

  const purchasedMap = new Map<string, number>()
  const soldMap = new Map<string, number>()

  for (const p of purchases) {
    if (p.is_deleted || p.firm_id !== firmId) continue
    for (const l of p.items || []) {
      const k = lineKey(l.item_id, l.name)
      purchasedMap.set(k, (purchasedMap.get(k) || 0) + (Number(l.qty) || 0))
    }
  }
  for (const inv of invoices) {
    if (inv.is_deleted || inv.firm_id !== firmId) continue
    if (inv.doc_type !== 'INVOICE' && inv.doc_type !== 'invoice') continue
    for (const l of inv.items || []) {
      const k = lineKey(l.item_id, l.name)
      soldMap.set(k, (soldMap.get(k) || 0) + (Number(l.qty) || 0))
    }
  }

  const rows: StockRow[] = []
  for (const it of live) {
    const k1 = lineKey(it.id, it.name)
    const k2 = `name:${it.name.trim().toLowerCase()}`
    const purchased = (purchasedMap.get(k1) || 0) + (k2 !== k1 ? purchasedMap.get(k2) || 0 : 0)
    const sold = (soldMap.get(k1) || 0) + (k2 !== k1 ? soldMap.get(k2) || 0 : 0)
    const opening = Number(it.opening_stock) || 0
    const onHand = opening + purchased - sold
    const reorder = Number(it.reorder_level) || 0
    const rate = Number(it.purchase_rate) || Number(it.rate) || 0
    const status: StockStatus = onHand <= 0 ? 'out' : reorder > 0 && onHand <= reorder ? 'low' : 'ok'
    rows.push({
      itemId: it.id, name: it.name, unit: it.unit,
      opening, purchased, sold, onHand, reorder, status,
      rate, value: Math.round(onHand * rate * 100) / 100,
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
