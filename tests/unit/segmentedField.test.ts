import { describe, it, expect } from 'vitest'
import {
  GSTIN_SEGMENT_CONFIG,
  MOBILE_SEGMENT_CONFIG,
  MOBILE_SEGMENT_LENGTHS,
  formatSegments,
  sanitizeCombinedInput,
  totalSegmentLength,
} from '@/utils/segmentedField'

describe('mobile config', () => {
  it('uses 4-2-2-2 grouping totalling 10 digits', () => {
    expect([...MOBILE_SEGMENT_LENGTHS]).toEqual([4, 2, 2, 2])
    expect(totalSegmentLength(MOBILE_SEGMENT_CONFIG)).toBe(10)
  })
})

describe('formatSegments (display with separation)', () => {
  it('formats a full GSTIN as 2-5-5-3', () => {
    expect(formatSegments('07ABCDE1234F1Z5', GSTIN_SEGMENT_CONFIG)).toBe('07 ABCDE 1234F 1Z5')
  })
  it('formats partial input without trailing separators', () => {
    expect(formatSegments('07', GSTIN_SEGMENT_CONFIG)).toBe('07')
    expect(formatSegments('07ABC', GSTIN_SEGMENT_CONFIG)).toBe('07 ABC')
    expect(formatSegments('', GSTIN_SEGMENT_CONFIG)).toBe('')
  })
  it('formats a mobile number as 4-2-2-2', () => {
    expect(formatSegments('9876543210', MOBILE_SEGMENT_CONFIG)).toBe('9876 54 32 10')
    expect(formatSegments('98765', MOBILE_SEGMENT_CONFIG)).toBe('9876 5')
  })
})

describe('sanitizeCombinedInput (raw value to store)', () => {
  it('strips spaces and uppercases', () => {
    expect(sanitizeCombinedInput('07 abcde 1234f 1z5', GSTIN_SEGMENT_CONFIG)).toBe('07ABCDE1234F1Z5')
  })
  it('rejects letters in digit-only segments', () => {
    // GSTIN first segment is digits-only: leading letters are dropped
    expect(sanitizeCombinedInput('ab07ABCDE', GSTIN_SEGMENT_CONFIG)).toBe('07ABCDE')
    // mobile is all digits: letters never make it in
    expect(sanitizeCombinedInput('98ab76', MOBILE_SEGMENT_CONFIG)).toBe('9876')
  })
  it('caps at the total segment length', () => {
    expect(sanitizeCombinedInput('07ABCDE1234F1Z5EXTRA', GSTIN_SEGMENT_CONFIG)).toBe('07ABCDE1234F1Z5')
    expect(sanitizeCombinedInput('98765432109999', MOBILE_SEGMENT_CONFIG)).toBe('9876543210')
  })
})
