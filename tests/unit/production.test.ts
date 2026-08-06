import { describe, it, expect } from 'vitest'
import type { Purchase, ReelStock } from '@/types/models'
import {
  normalizeReelColor,
  proposePurchaseReelSpecs,
  purchaseHasReelLines,
  reelColorLabel,
  reelInventorySummary,
  resolveConsumableFeed,
  resolveReelFeedWeight,
} from '@/services/production'

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

describe('resolveReelFeedWeight', () => {
  it('uses full available weight for full mode', () => {
    expect(resolveReelFeedWeight('full', 125.5)).toBe(125.5)
  })

  it('uses partial weight when within available', () => {
    expect(resolveReelFeedWeight('partial', 100, 40)).toBe(40)
  })

  it('rejects over-feed and empty reels', () => {
    expect(() => resolveReelFeedWeight('partial', 50, 60)).toThrow(/available/)
    expect(() => resolveReelFeedWeight('full', 0)).toThrow(/consumed/)
    expect(() => resolveReelFeedWeight('partial', 50, 0)).toThrow(/0 se zyada/)
  })
})

describe('resolveConsumableFeed', () => {
  it('uses full available qty/weight for full mode', () => {
    expect(resolveConsumableFeed('full', { qty: 10, weight: 25 })).toEqual({ qty: 10, weight: 25 })
  })

  it('uses partial amounts when within available', () => {
    expect(resolveConsumableFeed('partial', { qty: 10, weight: 25 }, { qty: 3, weight: 5 }))
      .toEqual({ qty: 3, weight: 5 })
  })

  it('rejects over-feed and empty stock', () => {
    expect(() => resolveConsumableFeed('full', { qty: 0, weight: 0 })).toThrow(/khali/)
    expect(() => resolveConsumableFeed('partial', { qty: 5, weight: 10 }, { qty: 6, weight: 0 })).toThrow(/qty/)
    expect(() => resolveConsumableFeed('partial', { qty: 5, weight: 10 }, { qty: 0, weight: 12 })).toThrow(/KG/)
  })
})

describe('proposePurchaseReelSpecs', () => {
  const purchase = {
    id: 'p1',
    firm_id: 'f1',
    bill_no: 'B-9',
    supplier_name: 'Test Mill',
    supplier_id: null,
    items: [
      {
        item_id: 'i1',
        name: 'Kraft',
        hsn: '',
        qty: 200,
        unit: 'KG',
        rate: 30,
        gst: 12,
        is_kraft_reel: true,
        paper_type: 'KRAFT',
        deckle_size: '1400',
        gsm: '120',
        bf: '18',
        color: 'NS',
        reel_weight: 200,
        reel_count: 2,
        reel_no: 'R-CUSTOM',
      },
    ],
  } as Purchase

  it('detects reel lines and proposes custom / split reel numbers', () => {
    expect(purchaseHasReelLines(purchase)).toBe(true)
    const specs = proposePurchaseReelSpecs(purchase)
    expect(specs).toHaveLength(2)
    expect(specs[0].reel_no).toBe('R-CUSTOM-R01')
    expect(specs[1].reel_no).toBe('R-CUSTOM-R02')
    expect(specs[0].opening_weight).toBe(100)
    expect(specs[0].gsm).toBe('120')
    expect(specs[0].bf).toBe('18')
  })
})
