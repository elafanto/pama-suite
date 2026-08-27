import { describe, expect, it } from 'vitest'
import { normalizePartyName } from '@/services/partyPaymentAllocation'

describe('party merge name normalize', () => {
  it('normalizes party names for matching', () => {
    expect(normalizePartyName('  U K  Paper  ')).toBe('u k paper')
    expect(normalizePartyName('ABC')).toBe('abc')
  })
})
