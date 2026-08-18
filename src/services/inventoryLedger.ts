import { db } from '@/data/db'
import { uid, nowISO } from '@/data/util'
import { logActivity } from '@/services/activityLog'
import type { Invoice, ItemStockMovement, Purchase } from '@/types/models'
import { isGenericInventoryLine } from '@/services/purchaseLineKind'

export interface ManualAdjustmentInput {
  firmId: string
  itemId: string
  date: string
  qtyDelta: number
  reasonCode: string
  notes?: string
  rate?: number
  currentOnHand?: number
}

export async function listItemStockMovements(
  firmId: string,
  opts: { itemId?: string; limit?: number } = {},
): Promise<ItemStockMovement[]> {
  const rows = await db.item_stock_movements
    .where('firm_id')
    .equals(firmId)
    .filter((r) => !r.is_deleted && (!opts.itemId || r.item_id === opts.itemId))
    .toArray()

  return rows
    .sort((a, b) => {
      const byDate = (b.date || '').localeCompare(a.date || '')
      if (byDate) return byDate
      return (b.created_at || '').localeCompare(a.created_at || '')
    })
    .slice(0, opts.limit || rows.length)
}

export function manualAdjustmentTotals(movements: ItemStockMovement[], firmId: string): Map<string, number> {
  const totals = new Map<string, number>()
  for (const m of movements) {
    if (m.is_deleted || m.firm_id !== firmId) continue
    if (m.source !== 'manual' && m.ref_type !== 'manual_adjustment') continue
    totals.set(m.item_id, (totals.get(m.item_id) || 0) + (Number(m.qty_delta) || 0))
  }
  return totals
}

export async function createManualAdjustment(input: ManualAdjustmentInput): Promise<ItemStockMovement> {
  const qtyDelta = Number(input.qtyDelta)
  if (!input.firmId) throw new Error('Active firm required')
  if (!input.itemId) throw new Error('Item required')
  if (!Number.isFinite(qtyDelta) || qtyDelta === 0) throw new Error('Adjustment quantity must be non-zero')
  if (input.currentOnHand !== undefined && input.currentOnHand + qtyDelta < 0) {
    throw new Error('Adjustment cannot make stock negative')
  }

  const item = await db.items.get(input.itemId)
  if (!item || item.is_deleted || item.firm_id !== input.firmId) throw new Error('Item not found')

  const now = nowISO()
  const id = uid()
  const rec: ItemStockMovement = {
    id,
    firm_id: input.firmId,
    item_id: item.id,
    date: input.date || now.slice(0, 10),
    source: 'manual',
    ref_type: 'manual_adjustment',
    ref_id: id,
    qty_delta: qtyDelta,
    unit: item.unit,
    rate: Number(input.rate) || Number(item.purchase_rate) || Number(item.rate) || 0,
    reason_code: input.reasonCode || 'adjustment',
    notes: input.notes?.trim() || '',
    created_at: now,
    updated_at: now,
    is_deleted: false,
    _dirty: true,
  }

  await db.item_stock_movements.add(rec)
  const sign = qtyDelta > 0 ? '+' : ''
  await logActivity(
    input.firmId,
    'adjust',
    'item_stock_movement',
    rec.id,
    `Stock adjusted for ${item.name}: ${sign}${qtyDelta} ${item.unit}`,
    {
      item_id: item.id,
      item_name: item.name,
      qty_delta: qtyDelta,
      reason_code: rec.reason_code,
      adjusted_on: rec.date,
    },
  )
  return rec
}

async function replaceMovementsForRef(
  firmId: string,
  source: ItemStockMovement['source'],
  refType: ItemStockMovement['ref_type'],
  refId: string,
  rows: Omit<ItemStockMovement, 'id' | 'firm_id' | 'created_at' | 'updated_at' | 'is_deleted' | '_dirty'>[],
): Promise<ItemStockMovement[]> {
  const now = nowISO()
  const existing = await db.item_stock_movements
    .where('firm_id')
    .equals(firmId)
    .filter((r) => !r.is_deleted && r.source === source && r.ref_type === refType && r.ref_id === refId)
    .toArray()

  await db.transaction('rw', db.item_stock_movements, async () => {
    for (const old of existing) {
      await db.item_stock_movements.put({ ...old, is_deleted: true, updated_at: now, _dirty: true })
    }
  })

  const created = rows.map((r) => ({
    ...r,
    id: uid(),
    firm_id: firmId,
    created_at: now,
    updated_at: now,
    is_deleted: false,
    _dirty: true,
  })) as ItemStockMovement[]

  if (created.length) await db.item_stock_movements.bulkAdd(created)
  return created
}

export async function recordPurchaseMovements(purchase: Purchase): Promise<ItemStockMovement[]> {
  if (purchase.is_deleted) {
    return replaceMovementsForRef(purchase.firm_id, 'purchase', 'purchase', purchase.id, [])
  }

  const rows = (purchase.items || [])
    .filter((line) => !!line.item_id && Number(line.qty) !== 0 && isGenericInventoryLine(line))
    .map((line) => ({
      item_id: line.item_id!,
      date: purchase.received_date || purchase.date,
      source: 'purchase' as const,
      ref_type: 'purchase',
      ref_id: purchase.id,
      qty_delta: Math.abs(Number(line.qty) || 0),
      unit: line.unit,
      rate: Number(line.rate) || 0,
      reason_code: 'purchase_receipt',
      notes: purchase.bill_no ? `Purchase ${purchase.bill_no}` : 'Purchase receipt',
    }))
  return replaceMovementsForRef(purchase.firm_id, 'purchase', 'purchase', purchase.id, rows)
}

export async function recordInvoiceMovements(invoice: Invoice): Promise<ItemStockMovement[]> {
  if (invoice.is_deleted || invoice.cancelled_at || (invoice.doc_type !== 'INVOICE' && invoice.doc_type !== 'invoice')) {
    return replaceMovementsForRef(invoice.firm_id, 'invoice', 'invoice', invoice.id, [])
  }

  const rows = (invoice.items || [])
    .filter((line) => !!line.item_id && Number(line.qty) !== 0)
    .map((line) => ({
      item_id: line.item_id!,
      date: invoice.date,
      source: 'invoice' as const,
      ref_type: 'invoice',
      ref_id: invoice.id,
      qty_delta: -Math.abs(Number(line.qty) || 0),
      unit: line.unit,
      rate: Number(line.rate) || 0,
      reason_code: 'invoice_dispatch',
      notes: invoice.bill_no ? `Invoice ${invoice.bill_no}` : 'Invoice dispatch',
    }))
  return replaceMovementsForRef(invoice.firm_id, 'invoice', 'invoice', invoice.id, rows)
}
