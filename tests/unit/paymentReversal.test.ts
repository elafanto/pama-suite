import { describe, expect, it } from 'vitest'
import { relatedInvoicePaymentIds, relatedPurchasePaymentIds } from '@/services/paymentReversal'
import type { Invoice, Purchase } from '@/types/models'

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
})
