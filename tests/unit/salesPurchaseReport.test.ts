import { describe, expect, it } from 'vitest'
import {
  buildSalesPurchaseSummary,
  resolvePeriodBounds,
} from '@/services/salesPurchaseReport'
import { buildSalesPurchaseWorkbook } from '@/services/salesPurchaseExcel'
import type { Invoice, Purchase } from '@/types/models'

const firmId = 'firm-1'

function inv(partial: Partial<Invoice> & Pick<Invoice, 'id' | 'bill_no' | 'date' | 'grand_total'>): Invoice {
  return {
    firm_id: firmId,
    party_id: 'p1',
    party_name: 'Acme',
    doc_type: 'INVOICE',
    amt_paid: 0,
    pay_status: 'UNPAID',
    is_deleted: false,
    cancelled_at: null,
    items: [],
    sub: partial.grand_total,
    total_tax: 0,
    round_off: 0,
    notes: '',
    gst_type: 'IGST',
    party_snapshot: {},
    created_at: '',
    updated_at: '',
    _dirty: false,
    ...partial,
  } as Invoice
}

function pur(partial: Partial<Purchase> & Pick<Purchase, 'id' | 'bill_no' | 'date' | 'grand_total'>): Purchase {
  return {
    firm_id: firmId,
    supplier_id: 'v1',
    supplier_name: 'Vendor Co',
    amt_paid: 0,
    pay_status: 'UNPAID',
    is_deleted: false,
    items: [],
    sub: partial.grand_total,
    total_tax: 0,
    round_off: 0,
    notes: '',
    gst_type: 'IGST',
    created_at: '',
    updated_at: '',
    _dirty: false,
    ...partial,
  } as Purchase
}

describe('salesPurchaseReport periods', () => {
  it('resolves this_fy and this_month bounds', () => {
    const ref = new Date('2026-09-06T12:00:00')
    expect(resolvePeriodBounds('this_fy', { ref })).toEqual({
      from: '2026-04-01',
      to: '2027-03-31',
      label: 'FY2026-27',
    })
    expect(resolvePeriodBounds('this_month', { ref })).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
      label: '2026-09',
    })
    expect(resolvePeriodBounds('all', { ref }).label).toBe('All time')
  })

  it('builds month and FY buckets for sales and purchases', () => {
    const summary = buildSalesPurchaseSummary({
      firmId,
      period: { label: 'All time' },
      invoices: [
        inv({ id: 'i1', bill_no: 'S1', date: '2026-04-10', grand_total: 1000, total_tax: 180, sub: 820 }),
        inv({ id: 'i2', bill_no: 'S2', date: '2026-05-12', grand_total: 500, total_tax: 90, sub: 410 }),
      ],
      purchases: [
        pur({ id: 'p1', bill_no: 'P1', date: '2026-04-15', grand_total: 300, total_tax: 54, sub: 246 }),
      ],
    })

    expect(summary.sales.billCount).toBe(2)
    expect(summary.sales.grandTotal).toBe(1500)
    expect(summary.purchases.grandTotal).toBe(300)
    expect(summary.net).toBe(1200)
    expect(summary.salesByMonth.map((r) => r.key)).toEqual(['2026-04', '2026-05'])
    expect(summary.salesByYear[0]?.key).toBe('FY2026-27')
    expect(summary.salesByYear[0]?.grandTotal).toBe(1500)
  })
})

describe('salesPurchaseExcel', () => {
  it('creates expected workbook sheets', () => {
    const summary = buildSalesPurchaseSummary({
      firmId,
      period: { from: '2026-04-01', to: '2027-03-31', label: 'FY2026-27' },
      invoices: [inv({ id: 'i1', bill_no: 'S1', date: '2026-04-10', grand_total: 1000 })],
      purchases: [pur({ id: 'p1', bill_no: 'P1', date: '2026-04-15', grand_total: 300 })],
    })
    const wb = buildSalesPurchaseWorkbook(summary)
    expect(wb.SheetNames).toEqual([
      'Summary',
      'Sales Register',
      'Purchase Register',
      'By Month',
      'By FY',
      'Sales by Party',
      'Purchases by Party',
    ])
  })
})
