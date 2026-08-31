import { describe, expect, it } from 'vitest'
import {
  applyGeminiBankMatches,
  buildBillCatalog,
  buildPartyCatalog,
  catalogForParty,
  suggestBillIdsForAmount,
} from '@/services/bankStatementGemini'
import { bankLineFingerprint } from '@/services/bankStatementParse'
import type { BankMatchSuggestion } from '@/services/bankStatementMatch'
import type { Invoice, Party, Purchase } from '@/types/models'

function suggestion(line: Partial<BankMatchSuggestion['line']> & Pick<BankMatchSuggestion['line'], 'rowIndex' | 'date' | 'amount' | 'side'>): BankMatchSuggestion {
  const fullLine = {
    narration: '',
    utr: '',
    partyHint: '',
    raw: {},
    ...line,
  }
  return {
    lineKey: bankLineFingerprint(fullLine),
    line: fullLine,
    kind: 'purchase',
    matchKind: 'unmatched',
    confidence: 'none',
    candidates: [],
    selectedIds: [],
    ignored: false,
    alreadyDone: false,
  }
}

describe('bankStatementGemini', () => {
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

  const catalog = buildBillCatalog({ invoices: [] as Invoice[], purchases, parties: [] })

  it('builds open purchase catalog', () => {
    expect(catalog).toHaveLength(1)
    expect(catalog[0].id).toBe('p1')
    expect(catalog[0].outstanding).toBe(10000)
  })

  it('applies validated gemini exact match on debit line', () => {
    const rows = [suggestion({
      rowIndex: 1,
      date: '2026-08-02',
      amount: 10000,
      side: 'debit',
      narration: 'NEFT ABC',
    })]

    const merged = applyGeminiBankMatches(rows, [{
      lineIndex: 1,
      matchKind: 'exact',
      selectedBillIds: ['p1'],
      reason: 'Amount + vendor name match',
    }], catalog)

    expect(merged[0].matchKind).toBe('exact')
    expect(merged[0].selectedIds).toEqual(['p1'])
    expect(merged[0].geminiEnhanced).toBe(true)
    expect(merged[0].confidence).toBe('high')
  })

  it('rejects gemini bill ids on wrong side', () => {
    const rows = [suggestion({
      rowIndex: 2,
      date: '2026-08-02',
      amount: 10000,
      side: 'credit',
      narration: 'deposit',
    })]

    const merged = applyGeminiBankMatches(rows, [{
      lineIndex: 2,
      matchKind: 'exact',
      selectedBillIds: ['p1'],
      reason: 'wrong side',
    }], catalog)

    expect(merged[0].selectedIds).toEqual([])
    expect(merged[0].matchKind).toBe('exact')
  })

  it('resolves party name only then suggests bill by amount', () => {
    const parties = [{ id: 'v1', name: 'U K Paper Converters PVT LTD', roles: ['vendor'], is_deleted: false }] as Party[]
    const partyCatalog = buildPartyCatalog(parties)
    const cat = buildBillCatalog({ invoices: [] as Invoice[], purchases, parties })

    const rows = [suggestion({
      rowIndex: 3,
      date: '2026-08-02',
      amount: 10000,
      side: 'debit',
      narration: 'NEFT UK PAPER CONVERTERS',
    })]

    const merged = applyGeminiBankMatches(rows, [], cat, partyCatalog, [{
      lineIndex: 3,
      partyId: 'v1',
      partyName: 'U K Paper Converters PVT LTD',
      extractedName: 'UK PAPER CONVERTERS',
      confidence: 'high',
      reason: 'Truncated NEFT name matches master party',
    }])

    expect(merged[0].geminiPartyName).toContain('U K Paper')
    expect(merged[0].selectedIds).toEqual(['p1'])
    expect(catalogForParty(cat, 'v1')).toHaveLength(1)
    expect(suggestBillIdsForAmount(rows[0].line, cat)).toEqual(['p1'])
  })
})
