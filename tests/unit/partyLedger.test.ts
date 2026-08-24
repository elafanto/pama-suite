import { describe, expect, it } from 'vitest'
import { allocateCustomerReceipt } from '@/services/partyPaymentAllocation'
import { buildPartyLedger } from '@/services/partyLedger'
import type { Invoice } from '@/types/models'

const firmId = 'firm-1'
const partyId = 'party-uk'

function invoice(partial: Partial<Invoice> & Pick<Invoice, 'id' | 'bill_no' | 'date' | 'grand_total'>): Invoice {
  return {
    firm_id: firmId,
    party_id: partyId,
    party_name: 'U K Paper Converters PVT LTD',
    doc_type: 'INVOICE',
    amt_paid: 0,
    pay_status: 'UNPAID',
    is_deleted: false,
    cancelled_at: null,
    items: [],
    sub_total: partial.grand_total,
    total_tax: 0,
    notes: '',
    created_at: '',
    updated_at: '',
    _dirty: false,
    ...partial,
  } as Invoice
}

describe('party ledger lump sum allocation', () => {
  const invoices = [
    invoice({ id: 'inv-18', bill_no: 'INV-0018', date: '2026-07-13', grand_total: 37643, amt_paid: 100000, pay_status: 'PAID' }),
    invoice({ id: 'inv-19', bill_no: 'INV-0019', date: '2026-07-16', grand_total: 142800 }),
    invoice({ id: 'inv-21', bill_no: 'INV-0021', date: '2026-07-22', grand_total: 50190 }),
  ]

  it('allocates lump sum receipt across party invoices FIFO in display', () => {
    const result = buildPartyLedger(invoices, [], {
      firmId,
      mode: 'both',
      partyId,
      from: '2026-05-31',
      to: '2026-08-24',
    })

    expect(result.totals.debit).toBe(230633)
    expect(result.totals.credit).toBe(100000)
    expect(result.totals.balance).toBe(130633)
    expect(result.totals.outstanding).toBe(130633)

    const inv19Bill = result.rows.find((row) => row.id === 'inv-19:bill')
    const inv21Bill = result.rows.find((row) => row.id === 'inv-21:bill')
    expect(inv19Bill?.outstanding).toBe(80443)
    expect(inv21Bill?.outstanding).toBe(50190)
    expect(inv19Bill?.payStatus).toBe('PARTIAL')
  })

  it('splits future lump sum payments across open invoices', () => {
    const openInvoices = [
      invoice({ id: 'inv-18', bill_no: 'INV-0018', date: '2026-07-13', grand_total: 37643 }),
      invoice({ id: 'inv-19', bill_no: 'INV-0019', date: '2026-07-16', grand_total: 142800 }),
      invoice({ id: 'inv-21', bill_no: 'INV-0021', date: '2026-07-22', grand_total: 50190 }),
    ]

    const allocations = allocateCustomerReceipt(openInvoices, 'inv-18', 100000)
    expect(allocations).toEqual([
      { id: 'inv-18', amount: 37643 },
      { id: 'inv-19', amount: 62357 },
    ])
  })
})
