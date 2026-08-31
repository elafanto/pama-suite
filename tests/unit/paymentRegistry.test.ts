import { describe, expect, it } from 'vitest'
import { buildPaymentRegistry, paymentRegistryTotals } from '@/services/paymentRegistry'
import type { Invoice, Purchase, Voucher } from '@/types/models'

describe('paymentRegistry', () => {
  const invoices = [{
    id: 'inv-1',
    firm_id: 'f1',
    party_name: 'Buyer Co',
    bill_no: 'INV-1',
    date: '2026-08-01',
    grand_total: 10000,
    amt_paid: 10000,
    last_payment_date: '2026-08-10',
    is_deleted: false,
    cancelled_at: null,
  }] as Invoice[]

  it('lists receipt vouchers and flags duplicate same-bill vouchers', () => {
    const vouchers = [
      {
        id: 'v1',
        firm_id: 'f1',
        voucher_no: 'RV-1',
        date: '2026-08-10',
        type: 'RECEIPT',
        narration: 'Receipt for Bill INV-1',
        ref_id: 'inv-1_PAY',
        ref_type: 'receipt',
        is_deleted: false,
        entries: [{ accountId: 'b', accountName: 'Bank Account', debit: 10000, credit: 0 }],
      },
      {
        id: 'v2',
        firm_id: 'f1',
        voucher_no: 'RV-2',
        date: '2026-08-10',
        type: 'RECEIPT',
        narration: 'Duplicate receipt',
        ref_id: 'inv-1_PAY',
        ref_type: 'receipt',
        is_deleted: false,
        entries: [{ accountId: 'b', accountName: 'Bank Account', debit: 10000, credit: 0 }],
      },
    ] as Voucher[]

    const rows = buildPaymentRegistry({ vouchers, invoices, purchases: [] as Purchase[] })
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.duplicateGroupId)).toBe(true)
    expect(paymentRegistryTotals(rows).duplicateRows).toBe(2)
  })

  it('shows bill-only paid row when voucher missing', () => {
    const rows = buildPaymentRegistry({ vouchers: [] as Voucher[], invoices, purchases: [] as Purchase[] })
    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe('bill_only')
    expect(rows[0].amount).toBe(10000)
  })
})
