import { describe, it, expect } from 'vitest'
import type { Firm, Invoice } from '@/types/models'
import {
  formatBillNo,
  maxBillSequence,
  resolveNextSequence,
  allocateBillNo,
  findDuplicateBillNoGroups,
  peekBillNo,
} from '@/services/invoiceNumber'

const firm = (over: Partial<Firm> = {}): Firm =>
  ({ id: 'F1', prefix: 'INV', next_bill_no: 1, ...over }) as Firm

const inv = (over: Partial<Invoice> = {}): Invoice =>
  ({ id: Math.random().toString(36).slice(2), firm_id: 'F1', bill_no: '', is_deleted: false, ...over }) as Invoice

describe('formatBillNo', () => {
  it('pads and uppercases prefix', () => {
    expect(formatBillNo('inv', 5)).toBe('INV-0005')
    expect(formatBillNo('', 12)).toBe('INV-0012')
    expect(formatBillNo('PAMA', 1234)).toBe('PAMA-1234')
  })
})

describe('maxBillSequence', () => {
  it('finds the highest numeric suffix for the firm + prefix', () => {
    const invoices = [inv({ bill_no: 'INV-0001' }), inv({ bill_no: 'INV-0007' }), inv({ bill_no: 'INV-0003' })]
    expect(maxBillSequence(invoices, 'F1', 'INV')).toBe(7)
  })
  it('ignores deleted invoices and other firms', () => {
    const invoices = [
      inv({ bill_no: 'INV-0009', is_deleted: true }),
      inv({ bill_no: 'INV-0050', firm_id: 'F2' }),
      inv({ bill_no: 'INV-0004' }),
    ]
    expect(maxBillSequence(invoices, 'F1', 'INV')).toBe(4)
  })
  it('matches loose formats (spaces, slashes, no padding)', () => {
    expect(maxBillSequence([inv({ bill_no: 'INV/12' })], 'F1', 'INV')).toBe(12)
    expect(maxBillSequence([inv({ bill_no: 'inv 8' })], 'F1', 'INV')).toBe(8)
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
