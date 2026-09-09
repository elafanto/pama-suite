import { describe, expect, it, vi } from 'vitest'
import { calculate } from '@/services/calculator'
import { DEFAULT_BOX_SHEET_SETTINGS, loadBoxSheetSettings, mergeBoxSheetSettings, saveBoxSheetSettings } from '@/services/boxSheetSettings'

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

  it('persists custom settings to localStorage', () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
      removeItem: (key: string) => { storage.delete(key) },
    })

    saveBoxSheetSettings(mergeBoxSheetSettings({
      clearanceMM: 12,
      widthCaliperFactor: 2,
      heightAllowanceDefaults: { '3-ply': 5, '5-ply': 10, '7-ply': 0 },
    }))
    const loaded = loadBoxSheetSettings()
    expect(loaded.clearanceMM).toBe(12)
    expect(loaded.heightAllowanceDefaults['3-ply']).toBe(5)
    expect(loaded.heightAllowanceDefaults['5-ply']).toBe(10)

    vi.unstubAllGlobals()
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

  it('stores clearance in detail but blank width ignores it (H+W+allowance only)', () => {
    const def = calculate(baseInput)
    const wide = calculate({
      ...baseInput,
      sheetSettings: { clearanceMM: 20 },
    })
    expect(wide.sheetCalcDetail?.blank.clearanceMM).toBe(20)
    // Clearance no longer changes blank width
    expect(wide.sheet?.width).toBe(def.sheet?.width)
  })

  it('blank width = Outer H + Outer W + height allowance', () => {
    const res = calculate(baseInput)
    const t = res.caliper ?? 0
    const outerW = 200 + 1.5 * t
    const outerH = 150 + 2.7 * t
    const raw = outerH + outerW + 3
    expect(res.sheet?.width).toBe(Math.ceil(raw / 5) * 5)
    expect(res.sheetCalcDetail?.blank.heightAllowanceMM).toBe(3)
  })

  it('adds 8 mm height allowance for 5-ply', () => {
    const res = calculate({ ...baseInput, ply: '5-ply', flute: 'BC' })
    const t = res.caliper ?? 0
    const outerW = 200 + 1.5 * t
    const outerH = 150 + 2.7 * t
    const raw = outerH + outerW + 8
    expect(res.sheet?.width).toBe(Math.ceil(raw / 5) * 5)
    expect(res.sheetCalcDetail?.blank.heightAllowanceMM).toBe(8)
  })
})
