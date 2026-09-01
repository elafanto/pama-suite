import { describe, it, expect } from 'vitest'
import type { Purchase, ReelStock } from '@/types/models'
import {
  findSameConfigActiveReels,
  filterReelLinkedMovements,
  filterReelsForDeletion,
  generateCopyReelNumbers,
  normalizeReelColor,
  proposePurchaseConsumableSpecs,
  proposePurchaseReelSpecs,
  purchaseHasConsumableLines,
  purchaseHasReelLines,
  reelColorLabel,
  reelConfigKey,
  reelInventorySummary,
  resolveConsumableFeed,
  resolveReelFeedWeight,
  resolveRemainingWeightUpdate,
  deckleFromMm,
  deckleFromInch,
  resolveDecklePair,
  formatDeckleDisplay,
  estimateReelWeightKg,
  REEL_CORE_DIA_MM,
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
    reel_no: 'R-1',
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

describe('generateCopyReelNumbers', () => {
  it('returns the base alone when copies is 1', () => {
    expect(generateCopyReelNumbers('R-101', 1)).toEqual(['R-101'])
  })

  it('auto-increments trailing digits with padding', () => {
    expect(generateCopyReelNumbers('R-101', 3)).toEqual(['R-101', 'R-102', 'R-103'])
    expect(generateCopyReelNumbers('REEL009', 2)).toEqual(['REEL009', 'REEL010'])
  })

  it('suffixes -2, -3 when base has no trailing digits', () => {
    expect(generateCopyReelNumbers('ABC', 3)).toEqual(['ABC', 'ABC-2', 'ABC-3'])
  })

  it('rejects blank base and oversized copy counts', () => {
    expect(() => generateCopyReelNumbers('  ', 2)).toThrow(/required/)
    expect(() => generateCopyReelNumbers('R-1', 51)).toThrow(/50/)
  })
})

describe('findSameConfigActiveReels / reelConfigKey', () => {
  it('matches active reels with same type/deckle/gsm/bf/color', () => {
    const selected = reel({ id: 'a', reel_no: 'R-1', color: 'NATURAL_BROWN' })
    const reels = [
      selected,
      reel({ id: 'b', reel_no: 'R-2', color: 'NS' }),
      reel({ id: 'c', reel_no: 'R-3', gsm: '150' }),
      reel({ id: 'd', reel_no: 'R-4', status: 'consumed', current_weight: 0 }),
      reel({ id: 'e', reel_no: 'R-5', color: 'GY' }),
    ]
    expect(reelConfigKey(selected)).toBe(reelConfigKey(reels[1]))
    const matched = findSameConfigActiveReels(reels, selected)
    expect(matched.map((r) => r.reel_no)).toEqual(['R-1', 'R-2'])
  })
})

describe('resolveConsumableFeed', () => {
  it('returns full available for full mode', () => {
    expect(resolveConsumableFeed('full', { qty: 10, weight: 25 })).toEqual({ qty: 10, weight: 25 })
  })

  it('accepts partial qty/weight within available', () => {
    expect(resolveConsumableFeed('partial', { qty: 10, weight: 25 }, { qty: 2, weight: 5 }))
      .toEqual({ qty: 2, weight: 5 })
  })

  it('rejects empty stock and over-feed', () => {
    expect(() => resolveConsumableFeed('full', { qty: 0, weight: 0 })).toThrow(/khali/)
    expect(() => resolveConsumableFeed('partial', { qty: 5, weight: 10 }, { qty: 6 })).toThrow(/qty/)
  })
})

describe('proposePurchaseConsumableSpecs', () => {
  const purchase = {
    id: 'p2',
    firm_id: 'f1',
    bill_no: 'C-1',
    items: [
      {
        item_id: 'i1',
        name: 'Glue',
        hsn: '',
        qty: 50,
        unit: 'KG',
        rate: 40,
        gst: 18,
        is_consumable: true,
        consumable_type: 'glue',
      },
    ],
  } as Purchase

  it('detects consumable lines and proposes specs', () => {
    expect(purchaseHasConsumableLines(purchase)).toBe(true)
    const specs = proposePurchaseConsumableSpecs(purchase)
    expect(specs).toHaveLength(1)
    expect(specs[0].stock_type).toBe('glue')
    // KG purchase line → 1 bulk pack, total weight = line qty
    expect(specs[0].qty).toBe(1)
    expect(specs[0].packs).toBe(1)
    expect(specs[0].pack_size_kg).toBe(50)
    expect(specs[0].weight).toBe(50)
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

describe('filterReelsForDeletion / filterReelLinkedMovements', () => {
  it('selects consumed reels only when consumedOnly is set', () => {
    const reels = [
      reel({ id: 'a', status: 'consumed', current_weight: 0 }),
      reel({ id: 'b', status: 'active', current_weight: 50 }),
      reel({ id: 'c', status: 'consumed', current_weight: 0, is_deleted: true }),
    ]
    expect(filterReelsForDeletion(reels, { consumedOnly: true }).map((r) => r.id)).toEqual(['a'])
  })

  it('selects reels created on/before beforeDate', () => {
    const reels = [
      reel({ id: 'old', created_at: '2025-01-10T10:00:00.000Z', status: 'consumed', current_weight: 0 }),
      reel({ id: 'mid', created_at: '2025-06-01T10:00:00.000Z', status: 'active' }),
      reel({ id: 'new', created_at: '2026-01-01T10:00:00.000Z', status: 'consumed', current_weight: 0 }),
    ]
    expect(filterReelsForDeletion(reels, { beforeDate: '2025-06-01' }).map((r) => r.id)).toEqual(['old', 'mid'])
    expect(filterReelsForDeletion(reels, { beforeDate: '2025-06-01', consumedOnly: true }).map((r) => r.id)).toEqual(['old'])
  })

  it('returns empty when no cleanup filter is provided', () => {
    expect(filterReelsForDeletion([reel()], {})).toEqual([])
  })

  it('counts non-deleted movements linked by stock_ref_id', () => {
    const moves = [
      { id: 'm1', stock_ref_id: 'a', is_deleted: false },
      { id: 'm2', stock_ref_id: 'a', is_deleted: true },
      { id: 'm3', stock_ref_id: 'b', is_deleted: false },
      { id: 'm4', stock_ref_id: 'c', is_deleted: false },
    ] as any
    expect(filterReelLinkedMovements(moves, ['a', 'b'])).toHaveLength(2)
  })
})

describe('resolveRemainingWeightUpdate', () => {
  it('computes used weight from remaining', () => {
    expect(resolveRemainingWeightUpdate(120, 85)).toEqual({ used: 35, remaining: 85 })
  })

  it('treats remaining 0 as full consume used = current', () => {
    expect(resolveRemainingWeightUpdate(120, 0)).toEqual({ used: 120, remaining: 0 })
  })

  it('rejects remaining above current, negative, empty, or no-op', () => {
    expect(() => resolveRemainingWeightUpdate(100, 110)).toThrow(/zyada/)
    expect(() => resolveRemainingWeightUpdate(100, -1)).toThrow(/negative/)
    expect(() => resolveRemainingWeightUpdate(0, 0)).toThrow(/consumed/)
    expect(() => resolveRemainingWeightUpdate(100, 100)).toThrow(/barabar/)
  })
})

describe('deckle mm ↔ inch', () => {
  it('converts mm to inch and formats display', () => {
    const pair = deckleFromMm(1270)
    expect(pair.deckle_mm).toBe(1270)
    expect(pair.deckle_inch).toBeCloseTo(50, 2)
    expect(formatDeckleDisplay(pair.deckle_mm, pair.deckle_inch)).toMatch(/in/)
    expect(formatDeckleDisplay(pair.deckle_mm, pair.deckle_inch)).toMatch(/mm/)
  })

  it('converts inch to mm (× 25.4)', () => {
    const pair = deckleFromInch(50)
    expect(pair.deckle_mm).toBeCloseTo(1270, 0)
    expect(pair.deckle_inch).toBe(50)
  })

  it('resolveDecklePair prefers mm, then inch, then legacy size heuristic', () => {
    expect(resolveDecklePair({ deckle_mm: 1400 }).deckle_mm).toBe(1400)
    expect(resolveDecklePair({ deckle_inch: 55 }).deckle_mm).toBeCloseTo(1397, 0)
    expect(resolveDecklePair({ deckle_size: '1400' }).deckle_mm).toBe(1400)
    expect(resolveDecklePair({ deckle_size: '48' }).deckle_inch).toBe(48)
  })
})

describe('estimateReelWeightKg (dia → weight)', () => {
  it('uses industry core default 76 mm', () => {
    expect(REEL_CORE_DIA_MM).toBe(76)
  })

  it('matches π/4 × (OD² − core²) × width × GSM / 1e9', () => {
    const od = 1000
    const core = 76
    const width = 1400
    const gsm = 120
    const expected = (Math.PI / 4) * (od * od - core * core) * width * gsm / 1e9
    const got = estimateReelWeightKg({ deckleMm: width, diaMm: od, gsm })
    expect(got).toBeCloseTo(expected, 2)
  })

  it('allows core override', () => {
    const withDefault = estimateReelWeightKg({ deckleMm: 1400, diaMm: 800, gsm: 100 })
    const withCustom = estimateReelWeightKg({ deckleMm: 1400, diaMm: 800, gsm: 100, coreMm: 100 })
    expect(withCustom).toBeLessThan(withDefault)
  })

  it('rejects invalid dia / deckle / gsm', () => {
    expect(() => estimateReelWeightKg({ deckleMm: 0, diaMm: 500, gsm: 120 })).toThrow(/Deckle/)
    expect(() => estimateReelWeightKg({ deckleMm: 1400, diaMm: 50, gsm: 120 })).toThrow(/core/)
    expect(() => estimateReelWeightKg({ deckleMm: 1400, diaMm: 500, gsm: 0 })).toThrow(/GSM/)
  })

  it('feeds remaining-weight update path when dia yields lower remaining', () => {
    const remaining = estimateReelWeightKg({ deckleMm: 1400, diaMm: 600, gsm: 120 })
    expect(remaining).toBeGreaterThan(0)
    expect(resolveRemainingWeightUpdate(200, remaining).remaining).toBe(remaining)
  })
})
