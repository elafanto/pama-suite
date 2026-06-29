import { describe, it, expect } from 'vitest'
import { computePlainSheetWeight, type BoxCalcForm } from '@/services/boxcalcUi'

function sheetForm(over: Partial<BoxCalcForm> = {}): BoxCalcForm {
  return {
    customerName: 'Test',
    boxName: 'Sheet',
    calcMode: 'plainSheet',
    printType: 'non-printed',
    dimensionUnit: 'mm',
    dimType: 'inner',
    length: 1200,
    width: 300,
    height: 150,
    ply: '3-ply',
    flute: 'C',
    caliperOverride: null,
    glueFlap: null,
    layers: [
      { name: 'Top Liner', paperType: 'kraftLiner', gsm: 150, bf: 18, rate: 56, color: 'NS', takeUp: 1, reelLength: null, rctOverride: null },
      { name: 'Flute', paperType: 'flutingMedium', gsm: 120, bf: 16, rate: 45, color: 'NS', takeUp: 1.42, reelLength: null, rctOverride: null },
      { name: 'Bottom Liner', paperType: 'kraftLiner', gsm: 150, bf: 18, rate: 56, color: 'NS', takeUp: 1, reelLength: null, rctOverride: null },
    ],
    starchGSM: 7,
    starchRate: 45,
    joining: { method: 'stitching', pinHeadType: '', wireRate: 120, cwpGSM: 150, coverage: 0.8, cwpRate: 200 },
    quantity: 1,
    productionWastePercent: 0,
    marginPercent: 0,
    printingCost: 0,
    shippingCostPerKg: 0,
    conversionSlabs: [],
    scrapRate: 0,
    priceMode: 'auto',
    customSellingPrice: null,
    customSellingPricePerKg: null,
    stackCheck: { enabled: false, stackCount: 1, contentWeight: 0 },
    stackingConditions: { storage: 'medium', humid: false, transport: false, cold: false },
    ...over,
  } as BoxCalcForm
}

describe('computePlainSheetWeight', () => {
  it('computes weight for 1200×300 mm 3-ply sheet', () => {
    const res = computePlainSheetWeight(sheetForm())
    expect(res).not.toHaveProperty('error')
    if (!res || 'error' in res) throw new Error('expected result')
    expect(res.calcMode).toBe('plainSheet')
    expect(res.sheet.lengthMm).toBe(1200)
    expect(res.sheet.widthMm).toBe(300)
    expect(res.sheet.areaM2).toBeCloseTo(0.36, 4)
    expect(res.weight.totalGm).toBeGreaterThan(0)
    expect(res.weight.layerWeights).toHaveLength(3)
  })
})
