import { describe, it, expect } from 'vitest'
import type { Item, Invoice, Purchase, ItemStockMovement } from '@/types/models'
import { computeStock, stockSummary, findStockRowForLine } from '@/services/stock'
import { manualAdjustmentTotals } from '@/services/inventoryLedger'

const FIRM = 'F1'

const item = (over: Partial<Item> = {}): Item =>
  ({
    id: 'I1', firm_id: FIRM, name: 'Kraft 120', unit: 'KG', is_deleted: false,
    track_stock: true, opening_stock: 0, reorder_level: 0, purchase_rate: 50, rate: 60,
    ...over,
  }) as Item

const purchase = (items: any[], over: Partial<Purchase> = {}): Purchase =>
  ({ id: 'P' + Math.random(), firm_id: FIRM, is_deleted: false, items, ...over }) as Purchase

const invoice = (items: any[], over: Partial<Invoice> = {}): Invoice =>
  ({ id: 'B' + Math.random(), firm_id: FIRM, is_deleted: false, doc_type: 'INVOICE', items, ...over }) as Invoice

const adj = (over: Partial<ItemStockMovement> = {}): ItemStockMovement =>
  ({
    id: 'M' + Math.random(), firm_id: FIRM, item_id: 'I1', is_deleted: false,
    source: 'manual', ref_type: 'manual_adjustment', qty_delta: 0,
    ...over,
  }) as ItemStockMovement

describe('computeStock', () => {
  it('on-hand = opening + purchased − sold + adjustments', () => {
    const items = [item({ opening_stock: 100 })]
    const purchases = [purchase([{ item_id: 'I1', name: 'Kraft 120', qty: 50 }])]
    const invoices = [invoice([{ item_id: 'I1', name: 'Kraft 120', qty: 30 }])]
    const movements = [adj({ qty_delta: -5 })]

    const rows = computeStock(items, purchases, invoices, FIRM, movements)
    expect(rows).toHaveLength(1)
    const r = rows[0]
    expect(r.opening).toBe(100)
    expect(r.purchased).toBe(50)
    expect(r.sold).toBe(30)
    expect(r.adjusted).toBe(-5)
    expect(r.onHand).toBe(115)
    expect(r.value).toBe(115 * 50)
    expect(r.status).toBe('ok')
  })

  it('flags low and out-of-stock statuses', () => {
    const low = computeStock(
      [item({ opening_stock: 5, reorder_level: 10 })], [], [], FIRM,
    )[0]
    expect(low.status).toBe('low')

    const out = computeStock(
      [item({ opening_stock: 0, reorder_level: 10 })], [], [], FIRM,
    )[0]
    expect(out.status).toBe('out')
  })

  it('matches legacy lines by name when item_id is absent', () => {
    const items = [item({ id: 'I9', opening_stock: 0, name: 'Gum Tape' })]
    const purchases = [purchase([{ item_id: '', name: 'Gum Tape', qty: 12 }])]
    const rows = computeStock(items, purchases, [], FIRM)
    expect(rows[0].purchased).toBe(12)
  })

  it('excludes items with track_stock = false', () => {
    const rows = computeStock([item({ track_stock: false })], [], [], FIRM)
    expect(rows).toHaveLength(0)
  })

  it('ignores credit notes (only INVOICE doc_type reduces stock)', () => {
    const items = [item({ opening_stock: 100 })]
    const cn = invoice([{ item_id: 'I1', name: 'Kraft 120', qty: 40 }], { doc_type: 'CREDIT_NOTE' as any })
    const rows = computeStock(items, [], [cn], FIRM)
    expect(rows[0].sold).toBe(0)
    expect(rows[0].onHand).toBe(100)
  })

  it('ignores cancelled invoices so stock is restored', () => {
    const items = [item({ opening_stock: 100 })]
    const cancelled = invoice([{ item_id: 'I1', name: 'Kraft 120', qty: 40 }], { cancelled_at: '2026-08-01T00:00:00.000Z' })
    const rows = computeStock(items, [], [cancelled], FIRM)
    expect(rows[0].sold).toBe(0)
    expect(rows[0].onHand).toBe(100)
  })
})

describe('stockSummary', () => {
  it('aggregates SKU counts and total value', () => {
    const rows = computeStock(
      [
        item({ id: 'A', name: 'A', opening_stock: 10, purchase_rate: 2 }),
        item({ id: 'B', name: 'B', opening_stock: 0, reorder_level: 5 }),
      ],
      [], [], FIRM,
    )
    const s = stockSummary(rows)
    expect(s.skus).toBe(2)
    expect(s.outOfStock).toBe(1)
    expect(s.totalValue).toBe(20)
  })
})

describe('findStockRowForLine', () => {
  it('matches by id first, then by name', () => {
    const rows = computeStock([item({ id: 'I1', name: 'Kraft 120', opening_stock: 1 })], [], [], FIRM)
    expect(findStockRowForLine(rows, { item_id: 'I1', name: 'x' })?.itemId).toBe('I1')
    expect(findStockRowForLine(rows, { item_id: '', name: 'Kraft 120' })?.itemId).toBe('I1')
    expect(findStockRowForLine(rows, { item_id: '', name: 'nope' })).toBeNull()
  })
})

describe('manualAdjustmentTotals', () => {
  it('sums only manual adjustments per item', () => {
    const movements = [
      adj({ item_id: 'I1', qty_delta: 5 }),
      adj({ item_id: 'I1', qty_delta: -2 }),
      adj({ item_id: 'I2', qty_delta: 7 }),
      // a purchase movement must be ignored
      adj({ item_id: 'I1', qty_delta: 100, source: 'purchase' as any, ref_type: 'purchase' }),
    ]
    const totals = manualAdjustmentTotals(movements, FIRM)
    expect(totals.get('I1')).toBe(3)
    expect(totals.get('I2')).toBe(7)
  })
})
