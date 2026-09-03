import { describe, expect, it } from 'vitest'
import { resolvePaymentClearAction } from '@/services/paymentClear'

describe('resolvePaymentClearAction', () => {
  it('full clears when bill has paid amount', () => {
    expect(resolvePaymentClearAction(5000, true)).toBe('full_clear')
    expect(resolvePaymentClearAction(5000, false)).toBe('full_clear')
  })

  it('removes orphan voucher when bill amt_paid is already 0', () => {
    expect(resolvePaymentClearAction(0, true)).toBe('voucher_only')
  })

  it('returns none when nothing to clear', () => {
    expect(resolvePaymentClearAction(0, false)).toBe('none')
  })
})
