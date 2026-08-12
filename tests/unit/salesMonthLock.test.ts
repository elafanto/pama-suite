import { describe, expect, it } from 'vitest'
import {
  isSalesMonthLocked,
  normalizeLockedSalesMonths,
  salesMonthLockMessage,
  salesPeriodFromDate,
  withLockedSalesMonth,
} from '@/services/salesMonthLock'

describe('salesPeriodFromDate', () => {
  it('extracts YYYY-MM', () => {
    expect(salesPeriodFromDate('2026-08-15')).toBe('2026-08')
    expect(salesPeriodFromDate('2026-08')).toBe('2026-08')
    expect(salesPeriodFromDate('')).toBe('')
  })
})

describe('isSalesMonthLocked', () => {
  const firm = { locked_sales_months: ['2026-07', '2026-08'] }

  it('locks dates in listed months', () => {
    expect(isSalesMonthLocked(firm, '2026-08-01')).toBe(true)
    expect(isSalesMonthLocked(firm, '2026-07-31')).toBe(true)
    expect(isSalesMonthLocked(firm, '2026-09-01')).toBe(false)
  })

  it('handles missing firm / months', () => {
    expect(isSalesMonthLocked(null, '2026-08-01')).toBe(false)
    expect(isSalesMonthLocked({ locked_sales_months: [] }, '2026-08-01')).toBe(false)
  })
})

describe('withLockedSalesMonth', () => {
  it('adds and removes months sorted', () => {
    expect(withLockedSalesMonth({ locked_sales_months: ['2026-08'] }, '2026-07', true)).toEqual([
      '2026-07',
      '2026-08',
    ])
    expect(withLockedSalesMonth({ locked_sales_months: ['2026-07', '2026-08'] }, '2026-08', false)).toEqual([
      '2026-07',
    ])
  })
})

describe('normalizeLockedSalesMonths', () => {
  it('dedupes and sorts', () => {
    expect(normalizeLockedSalesMonths(['2026-08', '2026-07', '2026-08', 'bad'])).toEqual([
      '2026-07',
      '2026-08',
    ])
  })
})

describe('salesMonthLockMessage', () => {
  it('mentions the period', () => {
    expect(salesMonthLockMessage('2026-08')).toContain('2026-08')
  })
})
