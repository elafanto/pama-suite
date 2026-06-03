import { describe, it, expect } from 'vitest'
import type { ReelStock } from '@/types/models'
import { normalizeReelColor, reelColorLabel, reelInventorySummary } from '@/services/production'

describe('normalizeReelColor', () => {
  it('treats NS and the legacy NATURAL_BROWN as the same shade', () => {
    expect(normalizeReelColor('NS')).toBe('NS')
    expect(normalizeReelColor('NATURAL_BROWN')).toBe('NS')
    expect(normalizeReelColor('Natural Brown')).toBe('NS')
    expect(normalizeReelColor('natural-brown')).toBe('NS')
    expect(normalizeReelColor('Neutral')).toBe('NS')
  })
  it('defaults blank colour to NS', () => {
    expect(normalizeReelColor('')).toBe('NS')
    expect(normalizeReelColor(null)).toBe('NS')
    expect(normalizeReelColor(undefined)).toBe('NS')
  })
  it('collapses Golden Yellow variants to GY', () => {
    expect(normalizeReelColor('GY')).toBe('GY')
    expect(normalizeReelColor('Golden Yellow')).toBe('GY')
  })
})

describe('reelColorLabel', () => {
  it('labels the canonical codes (legacy value included)', () => {
    expect(reelColorLabel('NATURAL_BROWN')).toMatch(/Natural/)
    expect(reelColorLabel('GY')).toBe('Golden Yellow')
  })
})

const reel = (over: Partial<ReelStock> = {}): ReelStock =>
  ({
    id: 'R' + Math.random(), firm_id: 'F1', paper_type: 'KRAFT', is_deleted: false,
    gsm: '120', bf: '18', deckle_size: '1400', color: 'NS',
    opening_weight: 100, current_weight: 100, status: 'active',
    ...over,
  }) as ReelStock

describe('reelInventorySummary — colour grouping', () => {
  it('merges NS and NATURAL_BROWN reels into a single breakdown row', () => {
    const reels = [
      reel({ color: 'NS' }),
      reel({ color: 'NATURAL_BROWN' }),
    ]
    const summary = reelInventorySummary(reels, [])
    expect(summary.breakdown).toHaveLength(1)
    expect(summary.breakdown[0].color).toBe('NS')
    expect(summary.breakdown[0].reels).toBe(2)
  })

  it('keeps a genuinely different shade (GY) in its own row', () => {
    const reels = [reel({ color: 'NS' }), reel({ color: 'GY' })]
    const summary = reelInventorySummary(reels, [])
    expect(summary.breakdown).toHaveLength(2)
  })
})
