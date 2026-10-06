import { describe, expect, it } from 'vitest'
import { allocateCustomerReceipt } from '@/services/partyPaymentAllocation'
import { buildPartyLedger, resolvePaymentLedgerDate, resolvePaymentLedgerAmount } from '@/services/partyLedger'
import type { Invoice, PartyAdvance, Purchase, Voucher } from '@/types/models'

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

function purchase(partial: Partial<Purchase> & Pick<Purchase, 'id' | 'bill_no' | 'date' | 'grand_total'>): Purchase {
  return {
    firm_id: firmId,
    supplier_id: partyId,
    supplier_name: 'U K Paper Converters PVT LTD',
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

function advance(partial: Partial<PartyAdvance> & Pick<PartyAdvance, 'id' | 'amount' | 'remaining' | 'direction'>): PartyAdvance {
  return {
    firm_id: firmId,
    party_id: partyId,
    party_name: 'U K Paper Converters PVT LTD',
    date: '2026-07-01',
    mode: 'bank',
    narration: '',
    status: partial.remaining <= 0.01 ? 'applied' : partial.remaining < partial.amount - 0.01 ? 'partial' : 'open',
    applications: [],
    is_deleted: false,
    created_at: '',
    updated_at: '',
    _dirty: false,
    ...partial,
  } as PartyAdvance
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

  it('shows payment on payment date, not bill date', () => {
    const vouchers = [{
      id: 'v1',
      firm_id: firmId,
      ref_id: 'inv-18_PAY',
      type: 'RECEIPT',
      date: '2026-08-15',
      is_deleted: false,
      updated_at: '2026-08-15T00:00:00.000Z',
      entries: [{ accountId: 'b', accountName: 'Bank Account', debit: 100000, credit: 0 }],
    }] as Voucher[]

    expect(resolvePaymentLedgerDate('inv-18', '2026-07-13', '', vouchers)).toBe('2026-08-15')
    expect(resolvePaymentLedgerAmount('inv-18', 37643, 'customer', vouchers)).toBe(100000)

    const result = buildPartyLedger(
      [invoice({ id: 'inv-18', bill_no: 'INV-0018', date: '2026-07-13', grand_total: 37643, amt_paid: 100000, pay_status: 'PAID' })],
      [],
      { firmId, mode: 'customer', partyId, from: '2026-08-01', to: '2026-08-31' },
      vouchers,
    )

    const paid = result.rows.find((r) => r.id === 'v1:paid' || r.id === 'inv-18:paid')
    expect(paid?.date).toBe('2026-08-15')
    expect(paid?.credit).toBe(100000)
    expect(result.rows.find((r) => r.id === 'inv-18:bill')).toBeUndefined()
  })

  it('keeps correct outstanding when payment month differs from bill month', () => {
    const invoices = [
      invoice({ id: 'inv-18', bill_no: 'INV-0018', date: '2026-07-13', grand_total: 37643, amt_paid: 100000, pay_status: 'PAID', last_payment_date: '2026-08-15' }),
      invoice({ id: 'inv-19', bill_no: 'INV-0019', date: '2026-07-16', grand_total: 142800 }),
      invoice({ id: 'inv-21', bill_no: 'INV-0021', date: '2026-07-22', grand_total: 50190 }),
    ]

    const aug = buildPartyLedger(invoices, [], {
      firmId,
      mode: 'customer',
      partyId,
      from: '2026-08-01',
      to: '2026-08-31',
    })

    expect(aug.totals.outstanding).toBe(130633)
    expect(aug.rows).toHaveLength(1)
    expect(aug.rows[0].id.endsWith(':paid')).toBe(true)
    expect(aug.rows[0].credit).toBe(100000)
  })

  it('does not double-count lump sum — one receipt for voucher cash on payment date', () => {
    const vouchers = [{
      id: 'v1',
      firm_id: firmId,
      ref_id: 'inv-18_PAY',
      type: 'RECEIPT',
      date: '2026-08-15',
      narration: 'Lump | [ALLOC:inv-18=37643.00|INV-0018;inv-19=62357.00|INV-0019]',
      is_deleted: false,
      updated_at: '2026-08-15T00:00:00.000Z',
      entries: [{ accountId: 'b', accountName: 'Bank Account', debit: 100000, credit: 0 }],
    }] as Voucher[]

    const split = [
      invoice({ id: 'inv-18', bill_no: 'INV-0018', date: '2026-07-13', grand_total: 37643, amt_paid: 37643, pay_status: 'PAID', last_payment_date: '2026-08-15' }),
      invoice({ id: 'inv-19', bill_no: 'INV-0019', date: '2026-07-16', grand_total: 142800, amt_paid: 62357, pay_status: 'PARTIAL', last_payment_date: '2026-08-15' }),
      invoice({ id: 'inv-21', bill_no: 'INV-0021', date: '2026-07-22', grand_total: 50190 }),
    ]

    const result = buildPartyLedger(split, [], { firmId, mode: 'customer', partyId }, vouchers)

    expect(result.totals.credit).toBe(100000)
    expect(result.totals.outstanding).toBe(130633)
    const receipt = result.rows.find((r) => r.id === 'v1:paid')
    expect(receipt?.credit).toBe(100000)
    expect(receipt?.date).toBe('2026-08-15')
    expect(result.rows.filter((r) => r.id.endsWith(':paid'))).toHaveLength(1)
  })

  it('write-off shows cash receipt separately from settlement amount', () => {
    const vouchers = [{
      id: 'v-wo',
      firm_id: firmId,
      ref_id: 'inv-18_PAY',
      type: 'RECEIPT',
      date: '2026-08-20',
      is_deleted: false,
      updated_at: '',
      entries: [
        { accountId: 'b', accountName: 'Bank Account', debit: 9000, credit: 0 },
        { accountId: 'r', accountName: 'Round Off Expense', debit: 1000, credit: 0 },
        { accountId: 'd', accountName: 'Sundry Debtors', debit: 0, credit: 10000 },
      ],
    }] as Voucher[]

    const result = buildPartyLedger(
      [invoice({
        id: 'inv-18',
        bill_no: 'INV-0018',
        date: '2026-07-13',
        grand_total: 10000,
        amt_paid: 10000,
        pay_status: 'PAID',
        notes: '[Write-off: ₹1000.00 — Settlement discount]',
      })],
      [],
      { firmId, mode: 'customer', partyId },
      vouchers,
    )

    expect(result.rows.find((r) => r.id === 'v-wo:paid')?.credit).toBe(9000)
    expect(result.rows.find((r) => r.id === 'v-wo:writeoff')?.credit).toBe(1000)
    expect(result.rows.find((r) => r.id === 'v-wo:paid')?.date).toBe('2026-08-20')
  })
})

describe('party ledger open advances vs outstanding', () => {
  it('nets open customer advance into outstanding so it matches balance', () => {
    const invoices = [
      invoice({ id: 'inv-1', bill_no: 'INV-0001', date: '2026-07-10', grand_total: 10000 }),
    ]
    const advances = [
      advance({ id: 'adv-1', date: '2026-07-15', amount: 3000, remaining: 3000, direction: 'in' }),
    ]

    const result = buildPartyLedger(invoices, [], {
      firmId,
      mode: 'customer',
      partyId,
    }, [], advances)

    expect(result.totals.balance).toBe(7000)
    expect(result.totals.outstanding).toBe(7000)
    expect(result.rows.find((r) => r.id === 'inv-1:bill')?.outstanding).toBe(7000)
    expect(result.rows.find((r) => r.id === 'adv-1:adv')?.outstanding).toBe(3000)
  })

  it('applies earlier open advance when computing bill outstanding', () => {
    const invoices = [
      invoice({ id: 'inv-1b', bill_no: 'INV-0001B', date: '2026-07-20', grand_total: 10000 }),
    ]
    const advances = [
      advance({ id: 'adv-1b', date: '2026-07-05', amount: 3000, remaining: 3000, direction: 'in' }),
    ]

    const result = buildPartyLedger(invoices, [], {
      firmId,
      mode: 'customer',
      partyId,
    }, [], advances)

    expect(result.totals.balance).toBe(7000)
    expect(result.totals.outstanding).toBe(7000)
    expect(result.rows.find((r) => r.id === 'inv-1b:bill')?.outstanding).toBe(7000)
  })

  it('nets open vendor advance into purchase outstanding', () => {
    const purchases = [
      purchase({ id: 'pur-1', bill_no: 'PO-0001', date: '2026-07-12', grand_total: 8000 }),
    ]
    const advances = [
      advance({ id: 'adv-v1', date: '2026-07-01', amount: 2500, remaining: 2500, direction: 'out' }),
    ]

    const result = buildPartyLedger([], purchases, {
      firmId,
      mode: 'vendor',
      partyId,
    }, [], advances)

    expect(result.totals.balance).toBe(5500)
    expect(result.totals.outstanding).toBe(5500)
    expect(result.rows.find((r) => r.id === 'pur-1:bill')?.outstanding).toBe(5500)
  })

  it('does not double-count advance already applied via amt_paid fallback', () => {
    const invoices = [
      invoice({
        id: 'inv-2',
        bill_no: 'INV-0002',
        date: '2026-07-10',
        grand_total: 10000,
        amt_paid: 4000,
        pay_status: 'PARTIAL',
        last_payment_date: '2026-07-15',
      }),
    ]
    const advances = [
      advance({ id: 'adv-2', date: '2026-07-01', amount: 5000, remaining: 1000, direction: 'in' }),
    ]

    const result = buildPartyLedger(invoices, [], {
      firmId,
      mode: 'customer',
      partyId,
    }, [], advances)

    // Credits: applied 4000 (fallback paid) + open advance 1000 = 5000 → outstanding 5000
    expect(result.totals.balance).toBe(5000)
    expect(result.totals.outstanding).toBe(5000)
    expect(result.rows.find((r) => r.id === 'inv-2:bill')?.outstanding).toBe(5000)
  })

  it('shows zero outstanding when open advance exceeds bills', () => {
    const invoices = [
      invoice({ id: 'inv-3', bill_no: 'INV-0003', date: '2026-07-20', grand_total: 2000 }),
    ]
    const advances = [
      advance({ id: 'adv-3', date: '2026-07-01', amount: 5000, remaining: 5000, direction: 'in' }),
    ]

    const result = buildPartyLedger(invoices, [], {
      firmId,
      mode: 'customer',
      partyId,
    }, [], advances)

    expect(result.totals.balance).toBe(-3000)
    expect(result.totals.outstanding).toBe(0)
    expect(result.rows.find((r) => r.id === 'inv-3:bill')?.outstanding).toBe(0)
  })
})
