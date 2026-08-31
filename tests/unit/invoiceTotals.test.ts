import { describe, expect, it } from 'vitest'
import {
  computeInvoiceTotals,
  inferInvoiceDiscountMode,
  invoiceTaxableSales,
  resolveInvoiceDiscountAmount,
} from '@/services/invoiceTotals'

describe('invoice totals with discount', () => {
  const items = [
    { name: 'Box A', qty: 100, rate: 10, gst: 18 },
    { name: 'Box B', qty: 50, rate: 20, gst: 12 },
  ]

  it('matches legacy totals when no discount', () => {
    const t = computeInvoiceTotals({ items, discount_mode: 'none' })
    expect(t.sub).toBe(2000)
    expect(t.discount_amount).toBe(0)
    expect(t.taxable).toBe(2000)
    expect(t.total_tax).toBe(300) // 180 + 120
    expect(t.grand_total).toBe(2300)
  })

  it('applies flat discount before tax', () => {
    const t = computeInvoiceTotals({ items, discount_mode: 'flat', discount_value: 200 })
    expect(t.discount_amount).toBe(200)
    expect(t.taxable).toBe(1800)
    expect(t.taxBuckets[18].taxable).toBe(900)
    expect(t.taxBuckets[12].taxable).toBe(900)
    expect(t.total_tax).toBe(270)
    expect(t.grand_total).toBe(2070)
  })

  it('applies percent discount before tax', () => {
    const t = computeInvoiceTotals({ items, discount_mode: 'pct', discount_value: 10 })
    expect(t.discount_amount).toBe(200)
    expect(t.discount_pct).toBe(10)
    expect(t.taxable).toBe(1800)
    expect(t.grand_total).toBe(2070)
  })

  it('caps discount at subtotal', () => {
    expect(resolveInvoiceDiscountAmount(1000, 'flat', 5000).amount).toBe(1000)
  })

  it('infers discount mode from saved invoice', () => {
    expect(inferInvoiceDiscountMode(500, 0)).toEqual({ mode: 'flat', value: 500 })
    expect(inferInvoiceDiscountMode(200, 10)).toEqual({ mode: 'pct', value: 10 })
    expect(inferInvoiceDiscountMode(0, 0)).toEqual({ mode: 'none', value: 0 })
  })

  it('ledger taxable uses tax buckets when present', () => {
    const taxable = invoiceTaxableSales({
      sub: 2000,
      discount_amount: 200,
      taxBuckets: { 18: { taxable: 900, tax: 162 }, 12: { taxable: 900, tax: 108 } },
    })
    expect(taxable).toBe(1800)
  })
})
