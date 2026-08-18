import { describe, expect, it } from 'vitest'
import {
  normalizeHsn4,
  lookupHsnGstLocal,
  buildBillGstConfirmMessage,
  commonBillingHsn4Options,
} from '@/services/hsnGst'

describe('normalizeHsn4', () => {
  it('takes first 4 digits from longer HSN', () => {
    expect(normalizeHsn4('48043100')).toBe('4804')
  })
  it('rejects short codes', () => {
    expect(normalizeHsn4('480')).toBeNull()
  })
})

describe('lookupHsnGstLocal', () => {
  it('returns 12% for kraft paper heading 4804', () => {
    expect(lookupHsnGstLocal('4804')?.gst).toBe(12)
  })
  it('returns 12% for cartons heading 4819', () => {
    expect(lookupHsnGstLocal('4819')?.gst).toBe(12)
  })
})

describe('buildBillGstConfirmMessage', () => {
  it('lists each line for confirmation', () => {
    const msg = buildBillGstConfirmMessage(
      [{ name: 'Kraft', hsn: '4804', gst: 12 }],
      new Map(),
    )
    expect(msg).toMatch(/4804/)
    expect(msg).toMatch(/12%/)
    expect(msg).toMatch(/Continue/)
  })
})

describe('commonBillingHsn4Options', () => {
  it('includes paper chapter codes', () => {
    expect(commonBillingHsn4Options()).toContain('4804')
    expect(commonBillingHsn4Options()).toContain('4819')
  })
})
