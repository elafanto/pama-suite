import { describe, expect, it } from 'vitest'
import { suggestBankColumnMapping, bankLineFingerprint } from '@/services/bankStatementParse'
import { buildBankMatchSuggestions } from '@/services/bankStatementMatch'
import type { Invoice, Party, Purchase } from '@/types/models'

describe('bank statement reconcile helpers', () => {
  it('suggests common bank export columns', () => {
    const map = suggestBankColumnMapping(['Txn Date', 'Withdrawal', 'Deposit', 'Narration', 'Ref No'])
    expect(map.date).toBe('Txn Date')
    expect(map.debitAmount).toBe('Withdrawal')
    expect(map.creditAmount).toBe('Deposit')
    expect(map.narration).toBe('Narration')
  })

  it('matches debit line to purchase by amount and party', () => {
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

    expect(suggestions[0].confidence).toBe('high')
    expect(suggestions[0].selectedIds).toContain('p1')
    expect(bankLineFingerprint(suggestions[0].line)).toContain('10000.00')
  })
})
