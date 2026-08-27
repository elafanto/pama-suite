import { describe, expect, it } from 'vitest'
import { customerReceivableSummary, outstandingAging, totalVendorPayable } from '@/services/reports'
import type { Invoice } from '@/types/models'

function invoice(partial: Partial<Invoice> & Pick<Invoice, 'id' | 'bill_no' | 'date' | 'grand_total'>): Invoice {
  return {
    firm_id: 'firm-1',
    party_id: 'party-uk',
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

describe('dashboard receivable / payable with lump sum', () => {
  const invoices = [
    invoice({ id: 'inv-18', bill_no: 'INV-0018', date: '2026-07-13', grand_total: 37643, amt_paid: 100000, pay_status: 'PAID' }),
    invoice({ id: 'inv-19', bill_no: 'INV-0019', date: '2026-07-16', grand_total: 142800 }),
    invoice({ id: 'inv-21', bill_no: 'INV-0021', date: '2026-07-22', grand_total: 50190 }),
  ]

  it('applies overpayment across party bills in outstanding aging', () => {
    const rows = outstandingAging(invoices)
    expect(rows).toHaveLength(1)
    expect(rows[0].total).toBe(130633)
    expect(rows[0].billCount).toBe(2)
  })

  it('nets overpayment in customer receivable summary', () => {
    const rows = customerReceivableSummary(invoices)
    expect(rows[0].outstanding).toBe(130633)
    expect(rows[0].received).toBe(100000)
  })

  it('nets supplier overpayment in payable total', () => {
    const payable = totalVendorPayable([
      { supplier_name: 'Vendor A', grand_total: 10000, amt_paid: 15000 },
      { supplier_name: 'Vendor A', grand_total: 8000, amt_paid: 0 },
      { supplier_name: 'Vendor B', grand_total: 5000, amt_paid: 0 },
    ])
    expect(payable).toBe(8000)
  })
})
