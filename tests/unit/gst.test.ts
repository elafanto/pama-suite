import { describe, it, expect } from 'vitest'
import {
  getStateName,
  getStateCode,
  isInterstateGst,
  normalizeGstType,
  normalizeStateCode,
  resolvePlaceOfSupplyState,
  detectSupplyGstType,
  isGstinValid,
  isGstinChecksumValid,
  validateGstinForForm,
} from '@/services/gst'

// Independent re-implementation of the GSTIN mod-36 check digit, used to mint a
// genuinely valid GSTIN for the positive tests (no magic constants).
function gstinCheckChar(prefix14: string): string {
  const charset = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const mod = charset.length
  let factor = 2
  let sum = 0
  for (let i = 13; i >= 0; i--) {
    const cp = charset.indexOf(prefix14[i])
    let digit = factor * cp
    factor = factor === 2 ? 1 : 2
    digit = Math.floor(digit / mod) + (digit % mod)
    sum += digit
  }
  return charset[(mod - (sum % mod)) % mod]
}

const PREFIX = '27AAPFU0939F1Z'
const VALID_GSTIN = PREFIX + gstinCheckChar(PREFIX)

describe('state helpers', () => {
  it('maps the first two digits to a state name', () => {
    expect(getStateName('27ABCDE1234F1Z5')).toBe('Maharashtra')
    expect(getStateName('05ABCDE1234F1Z5')).toBe('Uttarakhand')
  })
  it('returns Unknown for unmapped/empty codes', () => {
    expect(getStateName('')).toBe('Unknown')
    expect(getStateName('99XXXXX')).toBe('Unknown')
  })
  it('extracts a numeric state code', () => {
    expect(getStateCode('24ABCDE1234F1Z5')).toBe('24')
    expect(getStateCode('AB')).toBe('')
  })
})

describe('gst type helpers', () => {
  it('treats inter / IGST as interstate', () => {
    expect(isInterstateGst('inter')).toBe(true)
    expect(isInterstateGst('IGST')).toBe(true)
    expect(isInterstateGst('intra')).toBe(false)
    expect(isInterstateGst(undefined)).toBe(false)
  })
  it('normalizes legacy values to the canonical pair', () => {
    expect(normalizeGstType('IGST')).toBe('inter')
    expect(normalizeGstType('CGST')).toBe('intra')
    expect(normalizeGstType(undefined)).toBe('intra')
  })
})

describe('normalizeStateCode / place of supply', () => {
  it('maps Uttarakhand name and aliases to 05 (not first-two-chars Ut)', () => {
    expect(normalizeStateCode('Uttarakhand')).toBe('05')
    expect(normalizeStateCode('uttaranchal')).toBe('05')
    expect(normalizeStateCode('UA')).toBe('05')
    expect(normalizeStateCode('05')).toBe('05')
    expect(normalizeStateCode('5')).toBe('05')
  })

  it('prefers GSTIN prefix over free-text state name', () => {
    expect(resolvePlaceOfSupplyState({ gstin: '05ABCDE1234F1Z5', state: 'Uttar Pradesh' })).toBe('05')
    expect(resolvePlaceOfSupplyState({ gstin: '', state: 'Uttarakhand' })).toBe('05')
  })

  it('keeps Uttarakhand firm + Uttarakhand party as intra even when state fields are names', () => {
    expect(
      detectSupplyGstType(
        { gstin: '05AAAAA0000A1Z5', state: 'Uttarakhand' },
        { gstin: '05BBBBB0000B1Z5', state: 'Uttarakhand' },
      ),
    ).toBe('intra')
  })

  it('does not treat firm.state name vs party code 05 as inter', () => {
    // Old billing bug: firm.state "Uttarakhand" → "Ut", party "05" → IGST
    expect(
      detectSupplyGstType(
        { gstin: '', state: 'Uttarakhand' },
        { gstin: '05BBBBB0000B1Z5', state: '05' },
      ),
    ).toBe('intra')
  })

  it('detects real inter-state (UK firm vs UP party)', () => {
    expect(
      detectSupplyGstType(
        { gstin: '05AAAAA0000A1Z5', state: '05' },
        { gstin: '09BBBBB0000B1Z5', state: '09' },
      ),
    ).toBe('inter')
  })
})

describe('GSTIN format', () => {
  it('accepts a well-formed GSTIN', () => {
    expect(isGstinValid(VALID_GSTIN)).toBe(true)
  })
  it('rejects wrong length / shape', () => {
    expect(isGstinValid('27AAPFU0939F1Z')).toBe(false) // 14 chars
    expect(isGstinValid('ABCDEFGHIJKLMNO')).toBe(false)
    expect(isGstinValid(undefined)).toBe(false)
  })
})

describe('GSTIN checksum', () => {
  it('passes for a correctly check-summed GSTIN', () => {
    expect(isGstinChecksumValid(VALID_GSTIN)).toBe(true)
  })
  it('fails when the check digit is wrong', () => {
    const wrongChar = VALID_GSTIN.endsWith('0') ? '1' : '0'
    expect(isGstinChecksumValid(PREFIX + wrongChar)).toBe(false)
  })
})

describe('validateGstinForForm', () => {
  it('treats empty input as valid (optional field)', () => {
    expect(validateGstinForForm('').valid).toBe(true)
  })
  it('flags short input with progress message', () => {
    const r = validateGstinForForm('27AAP')
    expect(r.valid).toBe(false)
    expect(r.message).toMatch(/15/)
  })
  it('accepts a fully valid GSTIN and reports the state', () => {
    const r = validateGstinForForm(VALID_GSTIN)
    expect(r.valid).toBe(true)
    expect(r.stateName).toBe('Maharashtra')
  })
  it('accepts a real GSTIN from GST portal (RTL checksum)', () => {
    const r = validateGstinForForm('09BTIPJ8146C2ZK')
    expect(r.valid).toBe(true)
    expect(r.stateName).toBe('Uttar Pradesh')
  })
})
