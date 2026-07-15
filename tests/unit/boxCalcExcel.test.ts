import { describe, expect, it } from 'vitest'
import { buildBoxCalcWorkbook } from '@/services/boxCalcExcel'
import {
  computeBoxCalcResults,
  defaultConversionSlabs,
  type BoxCalcForm,
} from '@/services/boxcalcUi'
import { mergeBoxSheetSettings } from '@/services/boxSheetSettings'

const form: BoxCalcForm = {
  customerName: 'Test Customer',
  boxName: 'RSC Box',
  calcMode: 'box',
  printType: 'non-printed',
  dimensionUnit: 'mm',
  dimType: 'inner',
  length: 300,
  width: 200,
  height: 150,
  ply: '3-ply',
  flute: 'C',
  caliperOverride: null,
  glueFlap: null,
  layers: [
    { name: 'Top Liner', paperType: 'Kraft', gsm: 120, bf: 18, rate: 52, color: '', takeUp: 1, reelLength: null, rctOverride: null },
    { name: 'Flute', paperType: 'Fluting', gsm: 120, bf: 18, rate: 45, color: '', takeUp: 1.42, reelLength: null, rctOverride: null },
    { name: 'Bottom Liner', paperType: 'Kraft', gsm: 120, bf: 18, rate: 52, color: '', takeUp: 1, reelLength: null, rctOverride: null },
  ],
  starchGSM: 7,
  starchRate: 45,
  joining: { method: 'stitching', pinHeadType: '', wireRate: 120, cwpGSM: 150, coverage: 0.8, cwpRate: 200 },
  quantity: 1000,
  productionWastePercent: 3,
  marginPercent: 15,
  printingCost: 0.5,
  shippingCostPerKg: 0.3,
  conversionSlabs: defaultConversionSlabs(),
  scrapRate: 12,
  priceMode: 'auto',
  customSellingPrice: null,
  customSellingPricePerKg: null,
  stackCheck: { enabled: false, stackCount: 1, contentWeight: 0 },
  stackingConditions: { storage: 'medium', humid: false, transport: false, cold: false },
}

describe('buildBoxCalcWorkbook', () => {
  const settings = mergeBoxSheetSettings()
  const results = computeBoxCalcResults(form, settings)

  it('creates calculation, layers and snapshot sheets', () => {
    expect(results && !('error' in results)).toBe(true)
    const workbook = buildBoxCalcWorkbook(form, results as Record<string, any>, settings)
    expect(workbook.SheetNames).toEqual(['Box Calculation', 'Layers', 'Result Snapshot'])
  })

  it('uses the same 400 g auto-pin and physical pin-count formulas', () => {
    const workbook = buildBoxCalcWorkbook(form, results as Record<string, any>, settings)
    const sheet = workbook.Sheets['Box Calculation']
    expect(sheet.B55.f).toContain('IF(B54>400,"double","single")')
    expect(sheet.B58.f).toBe('B57*IF(B55="double",2,1)')
  })

  it('links each paper layer to blank-area weight and cost formulas', () => {
    const workbook = buildBoxCalcWorkbook(form, results as Record<string, any>, settings)
    const layers = workbook.Sheets.Layers
    expect(layers.G2.f).toBe("'Box Calculation'!$B$49*C2*F2")
    expect(layers.H2.f).toBe('G2/1000*E2')
  })
})
