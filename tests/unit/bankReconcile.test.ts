import { describe, expect, it } from 'vitest'
import { suggestBankColumnMapping, bankLineFingerprint } from '@/services/bankStatementParse'
import { buildBankMatchSuggestions } from '@/services/bankStatementMatch'
import { resolvePaymentLedgerDate, buildPartyLedger } from '@/services/partyLedger'
import type { Invoice, Party, Purchase, Voucher } from '@/types/models'

describe('bank statement reconcile helpers', () => {
  it('suggests common bank export columns', () => {
    const map = suggestBankColumnMapping(['Txn Date', 'Withdrawal', 'Deposit', 'Narration', 'Ref No'])
    expect(map.date).toBe('Txn Date')
    expect(map.debitAmount).toBe('Withdrawal')
    expect(map.creditAmount).toBe('Deposit')
    expect(map.narration).toBe('Narration')
  })

  it('classifies exact debit match to purchase (payment after bill)', () => {
    const parties = [{ id: 'v1', name: 'ABC Traders', acno: '123456', ifsc: 'HDFC0001', roles: ['vendor'] }] as Party[]
    const purchases = [{
      id: 'p1',
      firm_id: 'f1',
      supplier_id: 'v1',
      supplier_name: 'ABC Traders',
      bill_no: 'B-10',
      date: '2026-08-01',
      grand_total: 10000,
      amt_paid: 0,
      is_deleted: false,
    }] as Purchase[]

    const suggestions = buildBankMatchSuggestions({
      lines: [{
        rowIndex: 1,
        date: '2026-08-02',
        amount: 10000,
        side: 'debit',
        narration: 'NEFT to ABC Traders 123456',
        utr: '',
        partyHint: '',
        raw: {},
      }],
      invoices: [] as Invoice[],
      purchases,
      parties,
    })

    expect(suggestions[0].matchKind).toBe('exact')
    expect(suggestions[0].confidence).toBe('high')
    expect(suggestions[0].selectedIds).toContain('p1')
    expect(bankLineFingerprint(suggestions[0].line)).toContain('10000.00')
  })

  it('rejects bill dated after payment (advance, not exact)', () => {
    const parties = [{ id: 'v1', name: 'ABC Traders', acno: '123456', roles: ['vendor'] }] as Party[]
    const purchases = [{
      id: 'p1',
      firm_id: 'f1',
      supplier_id: 'v1',
      supplier_name: 'ABC Traders',
      bill_no: 'B-10',
      date: '2026-08-10',
      grand_total: 10000,
      amt_paid: 0,
      is_deleted: false,
    }] as Purchase[]

    const suggestions = buildBankMatchSuggestions({
      lines: [{
        rowIndex: 1,
        date: '2026-08-02',
        amount: 10000,
        side: 'debit',
        narration: 'NEFT ABC Traders 123456',
        utr: '',
        partyHint: '',
        raw: {},
      }],
      invoices: [] as Invoice[],
      purchases,
      parties,
    })

    expect(suggestions[0].matchKind).toBe('advance')
    expect(suggestions[0].selectedIds).toEqual([])
  })

  it('classifies lump sum across two open purchases', () => {
    const parties = [{ id: 'v1', name: 'ABC Traders', acno: '123456', roles: ['vendor'] }] as Party[]
    const purchases = [
      {
        id: 'p1',
        firm_id: 'f1',
        supplier_id: 'v1',
        supplier_name: 'ABC Traders',
        bill_no: 'B-1',
        date: '2026-08-01',
        grand_total: 4000,
        amt_paid: 0,
        is_deleted: false,
      },
      {
        id: 'p2',
        firm_id: 'f1',
        supplier_id: 'v1',
        supplier_name: 'ABC Traders',
        bill_no: 'B-2',
        date: '2026-08-05',
        grand_total: 6000,
        amt_paid: 0,
        is_deleted: false,
      },
    ] as Purchase[]

    const suggestions = buildBankMatchSuggestions({
      lines: [{
        rowIndex: 1,
        date: '2026-08-08',
        amount: 10000,
        side: 'debit',
        narration: 'RTGS ABC Traders 123456',
        utr: '',
        partyHint: '',
        raw: {},
      }],
      invoices: [] as Invoice[],
      purchases,
      parties,
    })

    expect(suggestions[0].matchKind).toBe('lump')
    expect(suggestions[0].confidence).toBe('medium')
    expect(suggestions[0].selectedIds).toEqual(['p1', 'p2'])
  })
})

describe('party ledger payment date', () => {
  it('uses last_payment_date over bill date', () => {
    expect(resolvePaymentLedgerDate('inv1', '2026-07-01', '2026-08-15')).toBe('2026-08-15')
  })

  it('falls back to payment voucher date', () => {
    const vouchers = [{
      id: 'v1',
      firm_id: 'f1',
      ref_id: 'inv1_PAY',
      type: 'RECEIPT',
      date: '2026-08-20',
      is_deleted: false,
      updated_at: '2026-08-20T00:00:00.000Z',
    }] as Voucher[]
    expect(resolvePaymentLedgerDate('inv1', '2026-07-01', '', vouchers)).toBe('2026-08-20')
  })

  it('shows receipt row on payment date in ledger', () => {
    const invoices = [{
      id: 'inv-1',
      firm_id: 'firm-1',
      party_id: 'p1',
      party_name: 'Buyer',
      doc_type: 'INVOICE',
      bill_no: 'INV-1',
      date: '2026-07-01',
      grand_total: 1000,
      amt_paid: 1000,
      pay_status: 'PAID',
      last_payment_date: '2026-08-10',
      is_deleted: false,
      cancelled_at: null,
    }] as Invoice[]

    const result = buildPartyLedger(invoices, [], {
      firmId: 'firm-1',
      mode: 'customer',
      partyId: 'p1',
      from: '2026-07-01',
      to: '2026-08-31',
    })

    const paid = result.rows.find((r) => r.id === 'inv-1:paid')
    expect(paid?.date).toBe('2026-08-10')
    const bill = result.rows.find((r) => r.id === 'inv-1:bill')
    expect(bill?.date).toBe('2026-07-01')
  })
})
