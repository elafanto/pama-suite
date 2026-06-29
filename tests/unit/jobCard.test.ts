import { describe, it, expect } from 'vitest'
import { generateJobCard, type JobCardData } from '@/services/jobCard'
import {
  computeBoxCalcResults,
  defaultJobCard,
  getCureStatus,
  getTotalBundles,
  getTwoPlyCount,
  type BoxCalcForm,
} from '@/services/boxcalcUi'

function makeForm(over: Partial<BoxCalcForm> = {}): BoxCalcForm {
  return {
    customerName: 'Test Party',
    boxName: 'Test Box',
    calcMode: 'box',
    printType: 'printed',
    dimensionUnit: 'mm',
    dimType: 'inner',
    length: 300, width: 200, height: 150,
    ply: '3-ply', flute: 'C',
    caliperOverride: null, glueFlap: null,
    layers: [
      { name: 'Top Liner', paperType: 'kraftLiner', gsm: 150, bf: 18, rate: 56, color: 'NS', takeUp: 1, reelLength: null, rctOverride: null },
      { name: 'Flute', paperType: 'flutingMedium', gsm: 120, bf: 16, rate: 45, color: 'NS', takeUp: 1.42, reelLength: null, rctOverride: null },
      { name: 'Bottom Liner', paperType: 'kraftLiner', gsm: 150, bf: 18, rate: 56, color: 'NS', takeUp: 1, reelLength: null, rctOverride: null },
    ],
    starchGSM: 7, starchRate: 30,
    joining: { method: 'stitching', pinHeadType: '', wireRate: 120, cwpGSM: 150, coverage: 0.8, cwpRate: 200 },
    quantity: 1000, productionWastePercent: 3, marginPercent: 15,
    printingCost: 0, shippingCostPerKg: 0,
    conversionSlabs: [], scrapRate: 12,
    priceMode: 'auto', customSellingPrice: null,
    stackCheck: { enabled: false, stackCount: 5, contentWeight: 1 },
    stackingConditions: { storage: 'medium', humid: false, transport: false, cold: false },
    jobCard: defaultJobCard('Test Plant'),
    ...over,
  } as BoxCalcForm
}

function buildData(form: BoxCalcForm): JobCardData {
  const results = computeBoxCalcResults(form)
  if (!results || 'error' in results) throw new Error('calc failed: ' + JSON.stringify(results))
  return {
    form: form as BoxCalcForm & { jobCard: ReturnType<typeof defaultJobCard> },
    results,
    cureStatus: getCureStatus(form.jobCard),
    totalBundles: getTotalBundles(form.quantity, form.jobCard!.bundleSize),
    twoPlyCount: getTwoPlyCount(form.ply),
  }
}

describe('job card — production plan wiring (end-to-end)', () => {
  const form = makeForm()
  const data = buildData(form)
  const plan = data.results.productionPlan
  const html = generateJobCard(data)

  it('calculator output carries a productionPlan with nesting', () => {
    expect(plan).toBeTruthy()
    expect(plan.boxesPerBig).toBe(plan.N_w * plan.N_l)
    expect(plan.N_l).toBeGreaterThanOrEqual(2) // this box nests in length
    expect(plan.bigSheets).toBeGreaterThan(0)
  })

  it('job card HTML renders the nesting summary (N_w × N_l)', () => {
    expect(html).toContain(`${plan.N_w}w × ${plan.N_l}l`)
    expect(html).toContain('box/big')
  })

  it('job card shows the big-sheet count, not raw per-box count', () => {
    expect(html).toContain(String(plan.bigSheets))
    expect(html).toContain('Cross-cut') // N_l > 1 → length cut section appears
  })

  it('job card shows actualBoxes at finishing stages', () => {
    expect(html).toContain(String(plan.actualBoxes))
  })

  it('no undefined / NaN leaked into the printed card', () => {
    expect(html).not.toContain('undefined')
    expect(html).not.toContain('NaN')
  })
})

describe('job card — single-up box (no length nesting)', () => {
  // Big box: blank length > 90", forces 2-piece and N_l = 1
  const form = makeForm({ length: 1200, width: 400, height: 400 })
  const data = buildData(form)
  const html = generateJobCard(data)

  it('reports N_l = 1 and no cross-cut section', () => {
    expect(data.results.productionPlan.N_l).toBe(1)
    expect(html).not.toContain('Cross-cut')
  })
})
