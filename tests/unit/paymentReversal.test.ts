import { describe, expect, it } from 'vitest'
import {
  findCoveringPayVouchers,
  planInvoicePaymentClear,
  planPurchasePaymentClear,
  relatedInvoicePaymentIds,
  relatedPurchasePaymentIds,
} from '@/services/paymentReversal'
import type { Invoice, Purchase, Voucher } from '@/types/models'

function voucher(partial: Partial<Voucher> & Pick<Voucher, 'id' | 'ref_id' | 'narration'>): Voucher {
  return {
    firm_id: 'f1',
    voucher_no: 'R-1',
    date: '2026-08-15',
    type: 'RECEIPT',
    entries: [],
    created_at: '',
    updated_at: '',
    is_deleted: false,
    ...partial,
  }
}

describe('paymentReversal', () => {
  it('clears only one bill when no payment voucher on primary', () => {
    const invoices = [
      { id: 'i1', party_id: 'c1', party_name: 'Buyer', amt_paid: 5000, last_payment_date: '2026-08-10' },
      { id: 'i2', party_id: 'c1', party_name: 'Buyer', amt_paid: 3000, last_payment_date: '2026-08-10' },
    ] as Invoice[]

    expect(relatedInvoicePaymentIds(invoices[0], invoices, false)).toEqual(['i1'])
  })

  it('clears lump-linked bills with same party and payment date when voucher exists', () => {
    const invoices = [
      { id: 'i1', party_id: 'c1', party_name: 'Buyer', amt_paid: 37643, last_payment_date: '2026-08-15' },
      { id: 'i2', party_id: 'c1', party_name: 'Buyer', amt_paid: 62357, last_payment_date: '2026-08-15' },
      { id: 'i3', party_id: 'c1', party_name: 'Buyer', amt_paid: 0, last_payment_date: '' },
    ] as Invoice[]

    expect(relatedInvoicePaymentIds(invoices[0], invoices, true)).toEqual(['i1', 'i2'])
  })

  it('does not clear other party bills on same date', () => {
    const purchases = [
      { id: 'p1', supplier_id: 'v1', supplier_name: 'A', amt_paid: 1000, last_payment_date: '2026-08-01', is_deleted: false },
      { id: 'p2', supplier_id: 'v2', supplier_name: 'B', amt_paid: 2000, last_payment_date: '2026-08-01', is_deleted: false },
    ] as Purchase[]

    expect(relatedPurchasePaymentIds(purchases[0], purchases, true)).toEqual(['p1'])
  })

  it('finds covering voucher when secondary bill is only in ALLOC tag', () => {
    const v = voucher({
      id: 'v1',
      ref_id: 'i1_PAY',
      narration: 'Lump | [ALLOC:i1=100.00|INV-1;i2=50.00|INV-2]',
    })
    expect(findCoveringPayVouchers('i2', [v]).map((row) => row.id)).toEqual(['v1'])
    expect(findCoveringPayVouchers('i1', [v]).map((row) => row.id)).toEqual(['v1'])
    expect(findCoveringPayVouchers('i9', [v])).toEqual([])
  })

  it('plans clear of secondary lump bill: reverse primary voucher + zero ALLOC bills', () => {
    const invoices = [
      { id: 'i1', party_id: 'c1', party_name: 'Buyer', amt_paid: 100, last_payment_date: '2026-08-15', bill_no: 'INV-1' },
      { id: 'i2', party_id: 'c1', party_name: 'Buyer', amt_paid: 50, last_payment_date: '2026-08-15', bill_no: 'INV-2' },
      { id: 'i3', party_id: 'c1', party_name: 'Buyer', amt_paid: 999, last_payment_date: '2026-08-15', bill_no: 'INV-3' },
    ] as Invoice[]
    const vouchers = [
      voucher({
        id: 'v1',
        ref_id: 'i1_PAY',
        narration: 'Lump ₹150 | INV-1 ₹100.00 + INV-2 ₹50.00 | [ALLOC:i1=100.00|INV-1;i2=50.00|INV-2]',
      }),
    ]

    // Clear from secondary bill i2 — old bug: no voucher reverse, only i2 zeroed.
    const plan = planInvoicePaymentClear(invoices[1], invoices, vouchers)
    expect(plan.hasCoveringVoucher).toBe(true)
    expect(plan.voucherRefIds).toEqual(['i1_PAY'])
    expect(plan.voucherIds).toEqual(['v1'])
    expect(plan.billIds.sort()).toEqual(['i1', 'i2'])
    expect(plan.billIds).not.toContain('i3')
  })

  it('plans purchase clear from ALLOC on vendor lump payment', () => {
    const purchases = [
      { id: 'p1', supplier_id: 'v1', supplier_name: 'A', amt_paid: 200, last_payment_date: '2026-08-01', is_deleted: false },
      { id: 'p2', supplier_id: 'v1', supplier_name: 'A', amt_paid: 100, last_payment_date: '2026-08-01', is_deleted: false },
    ] as Purchase[]
    const vouchers = [
      voucher({
        id: 'vp1',
        type: 'PAYMENT',
        ref_id: 'p1_PAY',
        narration: '[ALLOC:p1=200.00|PB-1;p2=100.00|PB-2]',
      }),
    ]

    const plan = planPurchasePaymentClear(purchases[1], purchases, vouchers)
    expect(plan.voucherRefIds).toEqual(['p1_PAY'])
    expect(plan.billIds.sort()).toEqual(['p1', 'p2'])
  })
})
