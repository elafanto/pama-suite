import { describe, expect, it } from 'vitest'
import {
  allocateCustomerReceipt,
  allocateVendorPayment,
  buildAllocTag,
  formatAllocBreakdown,
  parseAllocTag,
} from '@/services/partyPaymentAllocation'
import { resolvePaymentLedgerNarration } from '@/services/partyLedger'
import type { Invoice, Purchase, Voucher } from '@/types/models'

const firmId = 'firm-1'
const partyId = 'party-a'

function invoice(partial: Partial<Invoice> & Pick<Invoice, 'id' | 'bill_no' | 'date' | 'grand_total'>): Invoice {
  return {
    firm_id: firmId,
    party_id: partyId,
    party_name: 'Acme',
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

function purchase(partial: Partial<Purchase> & Pick<Purchase, 'id' | 'bill_no' | 'date' | 'grand_total'>): Purchase {
  return {
    firm_id: firmId,
    supplier_id: partyId,
    supplier_name: 'Vendor Co',
    amt_paid: 0,
    pay_status: 'UNPAID',
    is_deleted: false,
    items: [],
    sub_total: partial.grand_total,
    total_tax: 0,
    notes: '',
    created_at: '',
    updated_at: '',
    _dirty: false,
    ...partial,
  } as Purchase
}

const openInvoices = [
  invoice({ id: 'inv-old', bill_no: 'INV-01', date: '2026-01-01', grand_total: 1000 }),
  invoice({ id: 'inv-mid', bill_no: 'INV-02', date: '2026-02-01', grand_total: 2000 }),
  invoice({ id: 'inv-new', bill_no: 'INV-03', date: '2026-03-01', grand_total: 3000 }),
]

describe('payment allocation modes', () => {
  it('fifo applies oldest open bills first even when newer bill is clicked', () => {
    expect(allocateCustomerReceipt(openInvoices, 'inv-new', 2500, { mode: 'fifo' })).toEqual([
      { id: 'inv-old', amount: 1000 },
      { id: 'inv-mid', amount: 1500 },
    ])
  })

  it('primary_then_fifo clears clicked bill first then oldest', () => {
    expect(allocateCustomerReceipt(openInvoices, 'inv-new', 2500, { mode: 'primary_then_fifo' })).toEqual([
      { id: 'inv-new', amount: 2500 },
    ])
    expect(allocateCustomerReceipt(openInvoices, 'inv-mid', 2500, { mode: 'primary_then_fifo' })).toEqual([
      { id: 'inv-mid', amount: 2000 },
      { id: 'inv-old', amount: 500 },
    ])
  })

  it('primary_only never spills to other bills', () => {
    expect(allocateCustomerReceipt(openInvoices, 'inv-old', 5000, { mode: 'primary_only' })).toEqual([
      { id: 'inv-old', amount: 1000 },
    ])
  })

  it('legacy onlyBillIds array keeps primary_then_fifo among selected', () => {
    expect(allocateCustomerReceipt(openInvoices, 'inv-mid', 5000, ['inv-mid', 'inv-new'])).toEqual([
      { id: 'inv-mid', amount: 2000 },
      { id: 'inv-new', amount: 3000 },
    ])
  })

  it('vendor fifo uses received_date then date', () => {
    const rows = [
      purchase({ id: 'p1', bill_no: 'P-1', date: '2026-01-10', received_date: '2026-01-05', grand_total: 400 }),
      purchase({ id: 'p2', bill_no: 'P-2', date: '2026-01-01', grand_total: 600 }),
    ]
    // p2 bill date 01-01 is older than p1 received 01-05
    expect(allocateVendorPayment(rows, 'p1', 700, { mode: 'fifo' })).toEqual([
      { id: 'p2', amount: 600 },
      { id: 'p1', amount: 100 },
    ])
  })

  it('build/parse ALLOC tag round-trips for ledger', () => {
    const allocations = [
      { id: 'inv-old', amount: 1000 },
      { id: 'inv-mid', amount: 1500 },
    ]
    const billNos = { 'inv-old': 'INV-01', 'inv-mid': 'INV-02' }
    const tag = buildAllocTag(allocations, billNos)
    expect(parseAllocTag(`Note | ${tag}`)).toEqual([
      { id: 'inv-old', amount: 1000, billNo: 'INV-01' },
      { id: 'inv-mid', amount: 1500, billNo: 'INV-02' },
    ])
    expect(formatAllocBreakdown(allocations, billNos)).toContain('INV-01')
  })
})

describe('ledger lump narration', () => {
  it('shows FIFO breakdown from ALLOC tag on primary and linked bills', () => {
    const vouchers = [{
      id: 'v1',
      firm_id: firmId,
      ref_id: 'inv-old_PAY',
      type: 'RECEIPT',
      date: '2026-03-15',
      narration: 'Lump | [ALLOC:inv-old=1000.00|INV-01;inv-mid=1500.00|INV-02]',
      is_deleted: false,
      updated_at: '',
      entries: [{ accountId: 'b', accountName: 'Bank', debit: 2500, credit: 0 }],
    }] as Voucher[]

    const primary = resolvePaymentLedgerNarration({
      docId: 'inv-old',
      billNo: 'INV-01',
      paid: 1000,
      billAmount: 1000,
      voucherTotal: 2500,
      mode: 'customer',
      vouchers,
    })
    expect(primary).toContain('lump')
    expect(primary).toContain('INV-01')
    expect(primary).toContain('INV-02')

    const secondary = resolvePaymentLedgerNarration({
      docId: 'inv-mid',
      billNo: 'INV-02',
      paid: 1500,
      billAmount: 2000,
      voucherTotal: 1500,
      mode: 'customer',
      vouchers,
    })
    expect(secondary).toContain('Part of lump')
    expect(secondary).toContain('this bill')
  })

  it('includes settlement reason from write-off notes', () => {
    const text = resolvePaymentLedgerNarration({
      docId: 'inv-old',
      billNo: 'INV-01',
      paid: 900,
      billAmount: 1000,
      voucherTotal: 900,
      mode: 'customer',
      billNotes: '[Write-off: ₹100.00 — Settlement discount]',
    })
    expect(text).toContain('Settlement discount')
    expect(text).toContain('100')
  })
})
