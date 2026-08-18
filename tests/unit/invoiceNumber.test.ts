import { describe, it, expect } from 'vitest'
import type { Firm, Invoice } from '@/types/models'
import {
  formatBillNo,
  maxBillSequence,
  resolveNextSequence,
  allocateBillNo,
  findDuplicateBillNoGroups,
  peekBillNo,
  indianFYShort,
} from '@/services/invoiceNumber'

const firm = (over: Partial<Firm> = {}): Firm =>
  ({ id: 'F1', prefix: 'INV', next_bill_no: 1, bill_no_format: 'dash_4', ...over }) as Firm

const inv = (over: Partial<Invoice> = {}): Invoice =>
  ({ id: Math.random().toString(36).slice(2), firm_id: 'F1', bill_no: '', is_deleted: false, date: '2025-08-01', ...over }) as Invoice

describe('formatBillNo', () => {
  it('pads and uppercases prefix (dash_4 default)', () => {
    expect(formatBillNo('inv', 5)).toBe('INV-0005')
    expect(formatBillNo('', 12)).toBe('INV-0012')
    expect(formatBillNo('PAMA', 1234)).toBe('PAMA-1234')
  })

  it('supports alternate per-firm formats', () => {
    expect(formatBillNo(firm({ prefix: 'PAMA', bill_no_format: 'slash_4' }), 7)).toBe('PAMA/0007')
    expect(formatBillNo(firm({ prefix: 'ABC', bill_no_format: 'compact_4' }), 3)).toBe('ABC0003')
    expect(formatBillNo(firm({ prefix: 'X', bill_no_format: 'dash_plain' }), 9)).toBe('X-9')
    expect(formatBillNo(firm({ prefix: 'INV', bill_no_format: 'fy_slash_4' }), 2, '2025-08-01')).toBe(`INV/${indianFYShort('2025-08-01')}/0002`)
  })
})

describe('maxBillSequence', () => {
  it('finds the highest numeric suffix for the firm + prefix', () => {
    const invoices = [inv({ bill_no: 'INV-0001' }), inv({ bill_no: 'INV-0007' }), inv({ bill_no: 'INV-0003' })]
    expect(maxBillSequence(invoices, firm())).toBe(7)
  })
  it('includes soft-deleted invoices so cancelled numbers stay in the series', () => {
    const invoices = [
      inv({ bill_no: 'INV-0009', is_deleted: true }),
      inv({ bill_no: 'INV-0050', firm_id: 'F2' }),
      inv({ bill_no: 'INV-0004' }),
    ]
    expect(maxBillSequence(invoices, firm())).toBe(9)
  })
  it('matches loose legacy formats', () => {
    expect(maxBillSequence([inv({ bill_no: 'INV/12' })], firm())).toBe(12)
    expect(maxBillSequence([inv({ bill_no: 'inv 8' })], firm())).toBe(8)
  })
  it('scopes financial-year format to the invoice date FY', () => {
    const fy = indianFYShort('2025-08-01')
    const f = firm({ bill_no_format: 'fy_slash_4' })
    const invoices = [
      inv({ bill_no: `INV/${fy}/0005`, date: '2025-08-01' }),
      inv({ bill_no: 'INV/23-24/0099', date: '2024-01-01' }),
    ]
    expect(maxBillSequence(invoices, f, '2025-08-01')).toBe(5)
  })
})

describe('resolveNextSequence', () => {
  it('takes the max of stored counter and history+1', () => {
    expect(resolveNextSequence(firm({ next_bill_no: 5 }), [inv({ bill_no: 'INV-0002' })])).toBe(5)
    expect(resolveNextSequence(firm({ next_bill_no: 1 }), [inv({ bill_no: 'INV-0009' })])).toBe(10)
  })
})

describe('peekBillNo', () => {
  it('previews the next number without consuming it', () => {
    expect(peekBillNo(firm({ next_bill_no: 3 }), [])).toBe('INV-0003')
    expect(peekBillNo(firm({ prefix: 'PAMA', bill_no_format: 'slash_4', next_bill_no: 12 }), [])).toBe('PAMA/0012')
  })
})

describe('allocateBillNo', () => {
  it('skips an already-used number', () => {
    const invoices = [inv({ bill_no: 'INV-0001' })]
    const { billNo, nextSequenceAfter } = allocateBillNo(firm({ next_bill_no: 1 }), invoices)
    expect(billNo).toBe('INV-0002')
    expect(nextSequenceAfter).toBe(3)
  })
  it('returns the stored counter when free', () => {
    const { billNo } = allocateBillNo(firm({ next_bill_no: 10 }), [])
    expect(billNo).toBe('INV-0010')
  })
  it('does not reuse a soft-deleted invoice number', () => {
    const invoices = [inv({ bill_no: 'INV-0005', is_deleted: true })]
    const { billNo } = allocateBillNo(firm({ next_bill_no: 5 }), invoices)
    expect(billNo).toBe('INV-0006')
  })
})

describe('findDuplicateBillNoGroups', () => {
  it('groups invoices that share a bill number within a firm', () => {
    const dups = [inv({ bill_no: 'INV-0001' }), inv({ bill_no: 'INV-0001' }), inv({ bill_no: 'INV-0002' })]
    const groups = findDuplicateBillNoGroups(dups)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(2)
  })
  it('does not flag the same number across different firms', () => {
    const rows = [inv({ bill_no: 'INV-0001' }), inv({ bill_no: 'INV-0001', firm_id: 'F2' })]
    expect(findDuplicateBillNoGroups(rows)).toHaveLength(0)
  })
})
