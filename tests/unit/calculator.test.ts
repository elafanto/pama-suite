import { describe, it, expect } from 'vitest'
import {
  calculate,
  getCaliper,
  getTakeUp,
  estimateReelLength,
  resolveConversionSlab,
  DEFAULT_CONVERSION_SLABS,
} from '@/services/calculator'

describe('getCaliper', () => {
  it('returns table value for known ply+flute', () => {
    expect(getCaliper('3-ply', 'C')).toBe(3.2)
    expect(getCaliper('5-ply', 'BC')).toBe(7.0)
  })
  it('falls back to 4.0 for unknown combos', () => {
    expect(getCaliper('9-ply', 'Z')).toBe(4.0)
  })
})

describe('getTakeUp', () => {
  it('returns single-flute factor', () => {
    expect(getTakeUp('C')).toBe(1.42)
    expect(getTakeUp('B')).toBe(1.32)
  })
  it('averages multi-flute factors', () => {
    expect(getTakeUp('BC')).toBeCloseTo((1.32 + 1.42) / 2, 5)
  })
  it('falls back to 1.42 for unknown flute', () => {
    expect(getTakeUp('Z')).toBe(1.42)
  })
})

describe('estimateReelLength', () => {
  it('is inversely proportional to gsm', () => {
    expect(estimateReelLength(120)).toBe(5000)
    expect(estimateReelLength(150)).toBe(4000)
  })
})

describe('resolveConversionSlab', () => {
  const slabs = DEFAULT_CONVERSION_SLABS
  it('picks the < 500 g slab', () => {
    expect(resolveConversionSlab(300, slabs).ratePerKg).toBe(7)
  })
  it('picks the 1–2 kg slab (inclusive of 2000 g)', () => {
    expect(resolveConversionSlab(1500, slabs).ratePerKg).toBe(5)
    expect(resolveConversionSlab(2000, slabs).ratePerKg).toBe(5)
  })
  it('rolls 2001 g into the > 2 kg slab', () => {
    expect(resolveConversionSlab(2001, slabs).ratePerKg).toBe(4)
    expect(resolveConversionSlab(5000, slabs).ratePerKg).toBe(4)
  })
  it('handles the 500g–1kg boundary', () => {
    expect(resolveConversionSlab(500, slabs).ratePerKg).toBe(6)
    expect(resolveConversionSlab(999, slabs).ratePerKg).toBe(6)
    expect(resolveConversionSlab(1000, slabs).ratePerKg).toBe(5)
  })
})

describe('calculate — 3-ply RSC (inner dims)', () => {
  const input = {
    length: 300,
    width: 200,
    height: 150,
    dimType: 'inner',
    ply: '3-ply',
    flute: 'C',
    caliperOverride: null,
    glueFlap: null,
    layers: [
      { name: 'Top Liner', gsm: 120, bf: 18, rate: 52, takeUp: 1.0, reelLength: null, rctOverride: null },
      { name: 'Flute', gsm: 120, bf: 18, rate: 45, takeUp: 1.42, reelLength: null, rctOverride: null },
      { name: 'Bottom Liner', gsm: 120, bf: 18, rate: 52, takeUp: 1.0, reelLength: null, rctOverride: null },
    ],
    starchGSM: 7,
    starchRate: 30,
    joining: { method: 'stitching', pinHeadType: '', wireRate: 120 },
    quantity: 1000,
    productionWastePercent: 3,
    marginPercent: 15,
    priceMode: 'auto',
    customSellingPrice: null,
    printingCost: 0,
    shippingCostPerKg: 0,
    conversionSlabs: DEFAULT_CONVERSION_SLABS,
    scrapRate: 12,
    stackCheck: null,
    stackingConditions: { storage: 'medium' },
  }

  const res = calculate(input)

  it('succeeds', () => {
    expect(res.success).toBe(true)
  })

  it('resolves caliper from the table', () => {
    expect(res.caliper).toBe(3.2)
  })

  it('derives outer dimensions from inner + caliper allowances', () => {
    // outerL = innerL + 1.5*t ; outerH = innerH + 2.7*t
    expect(res.dimensions.outer.L).toBeCloseTo(300 + 1.5 * 3.2, 5)
    expect(res.dimensions.outer.H).toBeCloseTo(150 + 2.7 * 3.2, 5)
  })

  it('computes the blank from inner dims + standard scoring allowances', () => {
    const t = 3.2
    // each panel + ~1 caliper of fold take-up, + glueFlap(3-ply=35)
    expect(res.sheet.length).toBeCloseTo(2 * (300 + t) + 2 * (200 + t) + 35, 4)
    // sheetWidth = innerW + innerH + caliper + fold clearance(6)
    expect(res.sheet.width).toBeCloseTo(200 + 150 + t + 6, 4)
  })

  it('uses 1-piece construction for a small box', () => {
    expect(res.construction.pieces).toBe(1)
  })

  it('produces a feasible reel and positive paper weight', () => {
    expect(res.reel.feasible).toBe(true)
    expect(res.reel.reelWidthMM).toBeGreaterThan(0)
    expect(res.weight.paperTotal).toBeGreaterThan(0)
  })

  it('adds a positive margin so selling price exceeds cost', () => {
    expect(res.cost.sellingPrice).toBeGreaterThan(res.cost.subTotal)
    expect(res.cost.margin).toBeGreaterThan(0)
  })

  it('reports combined sheet BS and BF with the fluting-loss factor', () => {
    // 3 plies, each BS = 18×120/1000 = 2.16 → raw 6.48 × 0.8 = 5.184 kg/cm²
    expect(res.strength.combinedBS).toBeCloseTo(5.184, 4)
    // BF stays consistent with factored BS: 5.184×1000/360 = 14.4
    expect(res.strength.combinedBF).toBeCloseTo(14.4, 4)
  })

  it('keeps debit/credit-free order totals consistent with quantity', () => {
    expect(res.order.quantity).toBe(1000)
    expect(res.order.totalValue).toBeCloseTo(res.cost.sellingPrice * 1000, 4)
  })
})

describe('calculate — validation', () => {
  it('rejects non-positive dimensions', () => {
    const r = calculate({ length: 0, width: 200, height: 150, layers: [{ gsm: 120, bf: 18, rate: 50 }] })
    expect(r.success).toBe(false)
    expect(r.error).toBeTruthy()
  })
  it('rejects missing layers', () => {
    const r = calculate({ length: 300, width: 200, height: 150, layers: [] })
    expect(r.success).toBe(false)
  })
})

describe('calculate — inner/outer entry consistency (C3)', () => {
  const base = {
    ply: '3-ply',
    flute: 'C',
    layers: [
      { name: 'Top Liner', gsm: 120, bf: 18, rate: 52 },
      { name: 'Flute', gsm: 120, bf: 18, rate: 45, takeUp: 1.42 },
      { name: 'Bottom Liner', gsm: 120, bf: 18, rate: 52 },
    ],
  }
  const t = 3.2 // caliper for 3-ply C

  it('same physical box gives the same blank whether entered by inner or outer dims', () => {
    const inner = calculate({ ...base, dimType: 'inner', length: 300, width: 200, height: 150 })
    // outer = inner + the standard conversion (1.5t L/W, 2.7t H)
    const outer = calculate({
      ...base,
      dimType: 'outer',
      length: 300 + 1.5 * t,
      width: 200 + 1.5 * t,
      height: 150 + 2.7 * t,
    })
    expect(inner.success && outer.success).toBe(true)
    expect(inner.sheet.length).toBeCloseTo(outer.sheet.length, 4)
    expect(inner.sheet.width).toBeCloseTo(outer.sheet.width, 4)
    expect(inner.weight.boxTotal).toBeCloseTo(outer.weight.boxTotal, 4)
  })
})
