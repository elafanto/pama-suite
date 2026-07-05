import { describe, expect, it } from 'vitest'
import { calculate } from '@/services/calculator'
import { DEFAULT_BOX_SHEET_SETTINGS, mergeBoxSheetSettings } from '@/services/boxSheetSettings'

const baseInput = {
  length: 300,
  width: 200,
  height: 150,
  dimType: 'inner' as const,
  ply: '3-ply',
  flute: 'C',
  layers: [
    { name: 'Top', gsm: 120, bf: 18, rate: 50 },
    { name: 'Flute', gsm: 120, bf: 18, rate: 45, takeUp: 1.42 },
    { name: 'Bottom', gsm: 120, bf: 18, rate: 50 },
  ],
}

describe('boxSheetSettings', () => {
  it('merges partial overrides onto defaults', () => {
    const merged = mergeBoxSheetSettings({ clearanceMM: 10 })
    expect(merged.clearanceMM).toBe(10)
    expect(merged.innerOuterLwFactor).toBe(DEFAULT_BOX_SHEET_SETTINGS.innerOuterLwFactor)
  })
})

describe('calculate with sheetSettings', () => {
  it('returns sheetCalcDetail with blank breakdown', () => {
    const res = calculate(baseInput)
    expect(res.success).toBe(true)
    expect(res.sheetCalcDetail?.blank.lengthTotal).toBe(res.sheet?.length)
    expect(res.sheetCalcDetail?.blank.widthTotal).toBe(res.sheet?.width)
    expect(res.sheetCalcDetail?.nesting.boxesPerBigSheet).toBe(res.reel?.boxesPerBigSheet)
  })

  it('applies custom clearance to sheet width', () => {
    const def = calculate(baseInput)
    const wide = calculate({
      ...baseInput,
      sheetSettings: { clearanceMM: 20 },
    })
    expect(wide.sheet?.width).toBe((def.sheet?.width ?? 0) + 14)
    expect(wide.sheetCalcDetail?.blank.clearanceMM).toBe(20)
  })
})
