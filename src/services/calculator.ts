// 16 BF only at 90/100 GSM; 18 BF at 90, 100, 120, 140, 150, 180 GSM
const STANDARD_PAPER_PRESETS = [
  { gsm: 90,  bf: 16, rate: 33 },
  { gsm: 90,  bf: 18, rate: 33 },
  { gsm: 100, bf: 16, rate: 33 },
  { gsm: 100, bf: 18, rate: 33 },
  { gsm: 120, bf: 18, rate: 33 },
  { gsm: 140, bf: 18, rate: 33 },
  { gsm: 150, bf: 18, rate: 33 },
  { gsm: 180, bf: 18, rate: 33 },
]

// Indian Paper Library Presets
export const PAPER_LIBRARY = {
  kraftLiner: {
    name: "Kraft Liner",
    typicalRate: 33,
    defaultColor: "Natural Brown",
    presets: [...STANDARD_PAPER_PRESETS],
  },
  testLiner: {
    name: "Test Liner",
    typicalRate: 33,
    defaultColor: "Natural Brown",
    presets: [...STANDARD_PAPER_PRESETS],
  },
  semiKraft: {
    name: "Semi Kraft",
    typicalRate: 33,
    defaultColor: "Natural Brown",
    presets: [...STANDARD_PAPER_PRESETS],
  },
  duplex: {
    name: "Duplex Board",
    typicalRate: 33,
    defaultColor: "White",
    presets: [
      { gsm: 230, bf: 18, rate: 33 },
      { gsm: 250, bf: 18, rate: 33 },
      { gsm: 280, bf: 18, rate: 33 },
      { gsm: 300, bf: 18, rate: 33 },
      { gsm: 350, bf: 18, rate: 33 },
      { gsm: 400, bf: 18, rate: 33 },
      { gsm: 450, bf: 18, rate: 33 },
    ],
  },
  flutingMedium: {
    name: "Fluting Medium",
    typicalRate: 33,
    defaultColor: "Natural Brown",
    presets: [
      { gsm: 90,  bf: 16, rate: 33 },
      { gsm: 100, bf: 16, rate: 33 },
      { gsm: 105, bf: 18, rate: 33 },
      { gsm: 110, bf: 18, rate: 33 },
      { gsm: 120, bf: 18, rate: 33 },
      { gsm: 140, bf: 18, rate: 33 },
      { gsm: 150, bf: 18, rate: 33 },
      { gsm: 180, bf: 18, rate: 33 },
    ],
  },
  highPerformance: {
    name: "High Performance Kraft",
    typicalRate: 33,
    defaultColor: "Golden Yellow",
    presets: [
      { gsm: 150, bf: 24, rate: 33 },
      { gsm: 180, bf: 26, rate: 33 },
      { gsm: 200, bf: 28, rate: 33 },
      { gsm: 200, bf: 32, rate: 33 },
      { gsm: 230, bf: 32, rate: 33 },
      { gsm: 250, bf: 35, rate: 33 },
      { gsm: 300, bf: 35, rate: 33 },
      { gsm: 300, bf: 40, rate: 33 }
    ]
  },
  recycled: {
    name: "Recycled Paper (RP)",
    typicalRate: 33,
    defaultColor: "Natural Brown",
    presets: [...STANDARD_PAPER_PRESETS],
  },
}

// Caliper Lookup (Board Thickness)
export const CALIPER_TABLE: Record<string, number> = {
  "3-ply-A": 5.0,
  "3-ply-B": 3.0,
  "3-ply-C": 3.2,
  "3-ply-E": 1.6,
  "5-ply-BC": 7.0,
  "5-ply-CC": 6.4,
  "5-ply-BE": 4.5,
  "5-ply-EB": 4.5,
  "7-ply-ABC": 11.0,
  "7-ply-BCB": 9.5,
  "7-ply-BCC": 10.5,
  "7-ply-CCC": 9.6
}

// Flute Take-up factors
export const TAKE_UP_FACTORS: Record<string, number> = {
  "A": 1.53,
  "B": 1.32,
  "C": 1.42,
  "E": 1.27,
  "F": 1.23
}

// Glue Flap Defaults
export const GLUE_FLAP_DEFAULTS: Record<string, number> = {
  "3-ply": 35,
  "5-ply": 45,
  "7-ply": 55
}

// Machine Limits
export const MACHINE_LIMITS = {
  maxDeckleMM: 1702,           // 67 inch
  workingDeckleMM: 1702,       // 67 inch (no separate safety buffer)
  sideTrimMM: 10,              // Per side (total 20 mm width trim)
  maxSheetLengthMM: 2286,      // 90 inch — single-piece / per-box blank limit
  maxSheetLength2PieceMM: 4572,// 2 × 90 inch
  maxSheetLength3PieceMM: 6858,// 3 × 90 inch
  lengthTrimMM: 10,            // Cut-off trim per box in feed direction
  clearanceMM: 6,              // Sheet width clearance
  slotBladeWidthMM: 7
}

// Safety Factors
export const SAFETY_FACTORS = {
  shortTerm: 1.6,
  mediumTerm: 2.5,
  longTerm: 4.0,
  multipliers: {
    humid: 1.5,
    transport: 1.65,
    cold: 1.2
  },
  maxEffectiveSF: 6.0
}

// Combined-board bursting strength factor. Summing every ply's BS overstates
// the measured Mullen value because the corrugated medium contributes less than
// a flat sheet — about a 20% fluting loss. Tune to match your lab readings.
export const BS_COMBINED_FACTOR = 0.8

// Adhesive Defaults
export const ADHESIVE_DEFAULTS = {
  starch: {
    gsmPerLine: 7,
    rate: 30
  },
  fevicolCWP: {
    gsm: 150,
    coverage: 0.80,
    rate: 200
  },
  stitching: {
    weightPerPin: {
      single: 0.5,
      double: 1.0
    } as Record<string, number>,
    spacing: {
      single: 60,
      double: 75
    } as Record<string, number>,
    minPins: 3,
    wireRate: 120
  }
}

export const COMMON_PAPER_COLORS = [
  'Natural Brown',
  'Golden Yellow',
]

type PaperLibraryKey = keyof typeof PAPER_LIBRARY

export function getPapersForRole(role: string): Partial<typeof PAPER_LIBRARY> {
  const roleMap: Record<string, PaperLibraryKey[]> = {
    outerLiner: ['kraftLiner', 'duplex', 'highPerformance', 'testLiner', 'semiKraft'],
    innerLiner: ['kraftLiner', 'testLiner', 'semiKraft', 'highPerformance'],
    midLiner: ['kraftLiner', 'testLiner', 'semiKraft', 'recycled'],
    flute: ['flutingMedium', 'recycled', 'semiKraft'],
  }
  const types = roleMap[role] || (Object.keys(PAPER_LIBRARY) as PaperLibraryKey[])
  const result: Partial<typeof PAPER_LIBRARY> = {}
  types.forEach((type) => {
    if (PAPER_LIBRARY[type]) result[type] = PAPER_LIBRARY[type]
  })
  return result
}

// Sizing Utilities
export function getCaliper(ply: string, flute: string, caliperTable?: Record<string, number>): number {
  const table = caliperTable ?? CALIPER_TABLE
  const key = `${ply}-${flute}`
  return table[key] || 4.0
}

export function getTakeUp(flute: string): number {
  if (flute.length === 1) {
    return TAKE_UP_FACTORS[flute] || 1.42
  }
  let sum = 0
  for (const ch of flute) {
    sum += TAKE_UP_FACTORS[ch] || 1.42
  }
  return sum / flute.length
}

export function getIndividualTakeUps(flute: string): Record<string, number> {
  const result: Record<string, number> = {}
  for (const ch of flute) {
    result[ch] = TAKE_UP_FACTORS[ch] || 1.42
  }
  return result
}

export function estimateReelLength(gsm: number): number {
  return Math.round(600000 / gsm)
}

export interface ConversionSlab {
  label: string
  minWeightGm: number
  maxWeightGm: number | null
  ratePerKg: number
}

// Boundaries: [min, max) in grams — e.g. 2000 g stays in 1–2 kg, 2001 g+ is > 2 kg
export const DEFAULT_CONVERSION_SLABS: ConversionSlab[] = [
  { label: '> 2 kg', minWeightGm: 2001, maxWeightGm: null, ratePerKg: 4 },
  { label: '1–2 kg', minWeightGm: 1000, maxWeightGm: 2001, ratePerKg: 5 },
  { label: '500g–1 kg', minWeightGm: 500, maxWeightGm: 1000, ratePerKg: 6 },
  { label: '< 500 g', minWeightGm: 0, maxWeightGm: 500, ratePerKg: 7 },
]

export function resolveConversionSlab(
  paperWeightGm: number,
  slabs: ConversionSlab[] | undefined,
): ConversionSlab {
  const list = slabs?.length ? slabs : DEFAULT_CONVERSION_SLABS
  const sorted = [...list].sort((a, b) => b.minWeightGm - a.minWeightGm)
  for (const slab of sorted) {
    const aboveMin = paperWeightGm >= slab.minWeightGm
    const belowMax = slab.maxWeightGm == null || paperWeightGm < slab.maxWeightGm
    if (aboveMin && belowMax) return slab
  }
  return sorted[sorted.length - 1] ?? DEFAULT_CONVERSION_SLABS[DEFAULT_CONVERSION_SLABS.length - 1]
}

import type { BoxSheetSettings } from '@/services/boxSheetSettings'
import { mergeBoxSheetSettings } from '@/services/boxSheetSettings'

/** One paper layer as fed to {@link calculate}. Form values may still arrive as
 *  strings, so numeric fields accept `number | string` and are parsed inside. */
export interface CalcLayerInput {
  name: string
  gsm: number
  bf: number
  rate: number
  takeUp?: number
  reelLength?: number | string | null
  rctOverride?: number | string | null
}

export interface CalcJoiningInput {
  method?: 'stitching' | 'fevicol' | 'both' | string
  pinHeadType?: 'single' | 'double' | ''
  wireRate?: number | string
  cwpGSM?: number
  coverage?: number
  cwpRate?: number
}

export interface CalcStackCheckInput {
  enabled: boolean
  stackCount: number | string
  contentWeight: number | string
}

export interface CalcStackingConditions {
  storage?: 'short' | 'medium' | 'long'
  humid?: boolean
  transport?: boolean
  cold?: boolean
}

export interface CalcInput {
  length: number | string
  width: number | string
  height: number | string
  dimType?: 'inner' | 'outer'
  ply: string
  flute: string
  caliperOverride?: number | string | null
  glueFlap?: number | string | null
  layers: CalcLayerInput[]
  starchGSM?: number
  starchRate?: number
  joining?: CalcJoiningInput
  quantity?: number | string
  productionWastePercent?: number | string
  marginPercent?: number | string
  priceMode?: 'auto' | 'custom' | 'customPerKg'
  customSellingPrice?: number | string | null
  customSellingPricePerKg?: number | string | null
  printingCost?: number | string
  shippingCostPerKg?: number | string
  shippingCost?: number | string
  conversionSlabs?: ConversionSlab[]
  scrapRate?: number
  stackCheck?: CalcStackCheckInput | null
  stackingConditions?: CalcStackingConditions
  /** Optional overrides for blank / sheet sizing (see Box Sheet Settings module). */
  sheetSettings?: Partial<BoxSheetSettings> | null
}

export interface SheetCalcDetailPart {
  label: string
  mm: number
  formula?: string
}

export interface SheetCalcDetail {
  input: {
    length: number
    width: number
    height: number
    dimType: 'inner' | 'outer'
    ply: string
    flute: string
    glueFlapOverride: number | null
  }
  caliper: {
    value: number
    source: 'override' | 'table' | 'default'
    key: string
  }
  innerOuter: {
    lwFactor: number
    hFactor: number
    inner: { L: number; W: number; H: number }
    outer: { L: number; W: number; H: number }
    steps: string[]
  }
  blank: {
    wrapL: number
    wrapW: number
    wrapH: number
    effectiveT: number
    clearanceMM: number
    glueFlap: number
    lengthParts: SheetCalcDetailPart[]
    lengthTotal: number
    widthParts: SheetCalcDetailPart[]
    widthTotal: number
    areaM2: number
    areaFormula: string
  }
  construction: {
    pieces: number
    type: string
    maxSingleMM: number
    maxTwoPieceMM: number
    maxThreePieceMM: number
  }
  slots: {
    positions: number[]
    glueFlapStart: number
    sheetEnd: number
    slotDepth: number
  }
  nesting: {
    workingDeckleMM: number
    sideTrimMM: number
    usableDeckleMM: number
    sheetsPerWidth: number
    reelWidthMM: number
    reelWidthRawMM: number
    utilizationPercent: number
    lengthTrimMM: number
    effectiveLengthUnitMM: number
    sheetsPerLength: number
    boxesPerBigSheet: number
    bigSheetLengthMM: number
    steps: string[]
  }
}

export function calculate(input: CalcInput) {
  const warnings: string[] = []
  const sheetCfg = mergeBoxSheetSettings(input.sheetSettings)
  const machine = sheetCfg.machine

  // Sizing inputs
  const length = parseFloat(String(input.length))
  const width = parseFloat(String(input.width))
  const height = parseFloat(String(input.height))

  if (!length || !width || !height || length <= 0 || width <= 0 || height <= 0) {
    return { error: 'Box dimensions must be positive numbers', success: false }
  }

  if (!input.layers || input.layers.length === 0) {
    return { error: 'At least one paper layer required', success: false }
  }

  // Determine caliper
  let caliper = input.caliperOverride ? parseFloat(String(input.caliperOverride)) : null
  let caliperSource: SheetCalcDetail['caliper']['source'] = 'override'
  const caliperKey = `${input.ply}-${input.flute}`
  if (!caliper) {
    caliper = getCaliper(input.ply, input.flute, sheetCfg.caliperTable)
    caliperSource = sheetCfg.caliperTable[caliperKey] != null ? 'table' : 'default'
  }

  const glueFlap = input.glueFlap
    ? parseFloat(String(input.glueFlap))
    : (sheetCfg.glueFlapDefaults[input.ply] || 40)

  // Outer vs Inner Sizing
  const isOuter = input.dimType === 'outer'
  const t = caliper
  const lwFactor = sheetCfg.innerOuterLwFactor
  const hFactor = sheetCfg.innerOuterHFactor
  const innerOuterSteps: string[] = []

  let innerL = 0, innerW = 0, innerH = 0
  let outerL = 0, outerW = 0, outerH = 0

  if (isOuter) {
    outerL = length
    outerW = width
    outerH = height
    innerL = outerL - lwFactor * t
    innerW = outerW - lwFactor * t
    innerH = outerH - hFactor * t
    innerOuterSteps.push(
      `Outer entered: ${outerL} × ${outerW} × ${outerH} mm`,
      `Inner L = ${outerL} − ${lwFactor}×${t} = ${innerL.toFixed(2)} mm`,
      `Inner W = ${outerW} − ${lwFactor}×${t} = ${innerW.toFixed(2)} mm`,
      `Inner H = ${outerH} − ${hFactor}×${t} = ${innerH.toFixed(2)} mm`,
    )
  } else {
    innerL = length
    innerW = width
    innerH = height
    outerL = innerL + lwFactor * t
    outerW = innerW + lwFactor * t
    outerH = innerH + hFactor * t
    innerOuterSteps.push(
      `Inner entered: ${innerL} × ${innerW} × ${innerH} mm`,
      `Outer L = ${innerL} + ${lwFactor}×${t} = ${outerL.toFixed(2)} mm`,
      `Outer W = ${innerW} + ${lwFactor}×${t} = ${outerW.toFixed(2)} mm`,
      `Outer H = ${innerH} + ${hFactor}×${t} = ${outerH.toFixed(2)} mm`,
    )
  }

  // Blank & machine setup always work from INNER dimensions plus the standard
  // RSC scoring allowances — roughly one caliper of board take-up per fold
  // (Fibre Box Handbook convention) plus a fold clearance. Outer-entered boxes
  // are converted back to inner above, so a box entered by its inner dims and
  // the same box entered by its outer dims produce an identical, standards-
  // correct sheet, slots and creases.
  const wrapL = innerL
  const wrapW = innerW
  const wrapH = innerH
  const effectiveT = caliper
  const effectiveClearance = sheetCfg.clearanceMM

  // Sheet Size Sizing
  const termL = 2 * (wrapL + effectiveT)
  const termW = 2 * (wrapW + effectiveT)
  const sheetLength = termL + termW + glueFlap
  const sheetWidth = wrapW + wrapH + effectiveT + effectiveClearance
  const sheetAreaM2 = (sheetLength / 1000) * (sheetWidth / 1000)

  const lengthParts: SheetCalcDetailPart[] = [
    { label: '2 × (L + t)', mm: termL, formula: `2 × (${wrapL} + ${effectiveT})` },
    { label: '2 × (W + t)', mm: termW, formula: `2 × (${wrapW} + ${effectiveT})` },
    { label: 'Glue flap', mm: glueFlap },
  ]
  const widthParts: SheetCalcDetailPart[] = [
    { label: 'Width (W)', mm: wrapW },
    { label: 'Height (H)', mm: wrapH },
    { label: 'Caliper (t)', mm: effectiveT },
    { label: 'Clearance', mm: effectiveClearance },
  ]

  if (sheetWidth > (machine.workingDeckleMM - 2 * machine.sideTrimMM)) {
    return {
      error: `Sheet width ${sheetWidth.toFixed(0)}mm exceeds machine deckle limit (${machine.workingDeckleMM - 2 * machine.sideTrimMM}mm usable). Box too wide/tall.`,
      success: false
    }
  }

  // Construction pieces
  let pieces = 1
  let constType = '1-piece RSC'
  let constWarning: string | null = null

  if (sheetLength <= machine.maxSheetLengthMM) {
    pieces = 1
    constType = '1-piece RSC'
  } else if (sheetLength <= machine.maxSheetLength2PieceMM) {
    pieces = 2
    constType = '2-piece (with lap joint)'
    constWarning = 'Box requires 2-piece construction. Extra material & labor needed.'
  } else if (sheetLength <= machine.maxSheetLength3PieceMM) {
    pieces = 3
    constType = '3-piece (complex)'
    constWarning = 'Box requires 3-piece construction. Verify production feasibility.'
  } else {
    return {
      error: 'Box too large. Sheet length exceeds 7500mm limit.',
      success: false
    }
  }

  if (constWarning) warnings.push(constWarning)

  // Machine Setup positions
  const topCrease = wrapW / 2
  const bottomCrease = topCrease + wrapH + effectiveT
  const creases = {
    topCrease,
    bottomCrease,
    topFlap: topCrease,
    bottomFlap: topCrease,
    bodyZone: { start: topCrease, end: bottomCrease }
  }

  const slot1 = wrapL + effectiveT
  const slot2 = wrapL + wrapW + 2 * effectiveT
  const slot3 = 2 * wrapL + wrapW + 3 * effectiveT
  const slot4 = 2 * wrapL + 2 * wrapW + 4 * effectiveT
  const glueFlapStart = slot4
  const sheetEnd = slot4 + glueFlap

  const slots = {
    slots: [slot1, slot2, slot3, slot4],
    panels: [
      { name: 'L1 (Length)', start: 0, end: slot1, width: slot1 },
      { name: 'W1 (Width)', start: slot1, end: slot2, width: slot2 - slot1 },
      { name: 'L2 (Length)', start: slot2, end: slot3, width: slot3 - slot2 },
      { name: 'W2 (Width)', start: slot3, end: slot4, width: slot4 - slot3 },
      { name: 'Glue Flap', start: glueFlapStart, end: sheetEnd, width: glueFlap }
    ],
    slotDepth: wrapW / 2
  }

  // Reel / Nesting — 2-D grid: N_w (across deckle) × N_l (feed direction)
  const workingDeckle = machine.workingDeckleMM
  const sideTrim = machine.sideTrimMM
  const totalTrim = 2 * sideTrim
  const usableDeckle = workingDeckle - totalTrim

  // ── Width direction (deckle) ──────────────────────────────────────────────
  let N_w = Math.floor(workingDeckle / sheetWidth)
  if (N_w < 1) {
    return { error: `Sheet width ${sheetWidth.toFixed(0)}mm exceeds deckle limit`, success: false }
  }

  let reelWidthRaw = N_w * sheetWidth + totalTrim
  let reelWidth = Math.ceil(reelWidthRaw / 5) * 5

  while (reelWidth > workingDeckle && N_w > 1) {
    N_w--
    reelWidthRaw = N_w * sheetWidth + totalTrim
    reelWidth = Math.ceil(reelWidthRaw / 5) * 5
  }

  if (reelWidth > workingDeckle) {
    return { error: `Sheet width + trim exceeds machine limit`, success: false }
  }

  const utilization = (N_w * sheetWidth) / reelWidth * 100
  const totalTrimMM = reelWidth - (N_w * sheetWidth)

  // ── Length direction (feed / cut-off) ─────────────────────────────────────
  // Each box occupies (blank length + 10 mm cut-off trim) in the feed direction.
  // 2-piece boxes cannot be nested in length (their blank already exceeds 90").
  const effectiveLengthUnit = sheetLength + machine.lengthTrimMM
  const N_l = pieces === 1
    ? Math.max(1, Math.floor(machine.maxSheetLengthMM / effectiveLengthUnit))
    : 1

  const boxesPerBig = N_w * N_l
  const bigSheetLength = N_l * effectiveLengthUnit   // total feed-direction length

  const nestingSteps = [
    `Usable deckle = ${workingDeckle} − 2×${sideTrim} = ${usableDeckle} mm`,
    `N_w = floor(${usableDeckle} ÷ ${sheetWidth.toFixed(2)}) = ${N_w}`,
    `Reel width = ${N_w}×${sheetWidth.toFixed(2)} + ${totalTrim} → ${reelWidth} mm (5 mm ceil)`,
    `Feed unit = blank ${sheetLength.toFixed(2)} + cut-off ${machine.lengthTrimMM} = ${effectiveLengthUnit.toFixed(2)} mm`,
    `N_l = floor(${machine.maxSheetLengthMM} ÷ ${effectiveLengthUnit.toFixed(2)}) = ${N_l}`,
    `Boxes per big sheet = ${N_w} × ${N_l} = ${boxesPerBig}`,
  ]

  const reelInfo = {
    feasible: true,
    reelWidthMM: reelWidth,
    reelWidthRawMM: reelWidthRaw,
    sheetsPerWidth: N_w,          // boxes across deckle
    sheetsPerLength: N_l,         // boxes in feed direction
    boxesPerBigSheet: boxesPerBig,
    bigSheetLengthMM: bigSheetLength,
    utilizationPercent: utilization,
    totalTrimMM: totalTrimMM,
    sideTrimMM: sideTrim
  }

  // Slitter Blades Setup (width direction — N_w cuts)
  const slitterBlades = [sideTrim]
  for (let i = 1; i <= N_w; i++) {
    slitterBlades.push(sideTrim + i * sheetWidth)
  }

  // Multi-sheet creasing machine wheels
  const multiSheetCreases = []
  for (let i = 0; i < N_w; i++) {
    const sheetLeftEdge = sideTrim + i * sheetWidth
    multiSheetCreases.push({
      sheetNumber: i + 1,
      sheetLeftEdge: sheetLeftEdge,
      sheetRightEdge: sheetLeftEdge + sheetWidth,
      w1Machine: sheetLeftEdge + topCrease,
      w2Machine: sheetLeftEdge + bottomCrease
    })
  }

  // Strength calculations
  const layerStrengths = input.layers.map((l) => {
    const autoRCT = 0.6 * Math.sqrt(l.gsm * l.bf)
    const rctOverrideNum = l.rctOverride != null ? parseFloat(String(l.rctOverride)) : 0
    const finalRCT = rctOverrideNum > 0 ? rctOverrideNum : autoRCT
    return {
      name: l.name,
      gsm: l.gsm,
      bf: l.bf,
      takeUp: l.takeUp || 1.0,
      bs: (l.bf * l.gsm) / 1000,
      rct: finalRCT,
      rctAuto: autoRCT,
      rctOverridden: rctOverrideNum > 0
    }
  })

  // Combined board burst. Raw = sum of each ply's BS (kg/cm²), then reduced by
  // BS_COMBINED_FACTOR for fluting loss so it tracks the measured Mullen value.
  // BF stays consistent with the (factored) BS: BF = BS × 1000 / Σgsm.
  const rawCombinedBS = layerStrengths.reduce((s, l) => s + l.bs, 0)
  const combinedBS = rawCombinedBS * BS_COMBINED_FACTOR
  const combinedGsmRaw = layerStrengths.reduce((s, l) => s + l.gsm, 0)
  const combinedBF = combinedGsmRaw > 0 ? (combinedBS * 1000) / combinedGsmRaw : 0

  // ECT = 0.0035 * sum(gsm * sqrt(bf) * takeUp)
  let ectSum = 0
  input.layers.forEach((l) => {
    ectSum += l.gsm * Math.sqrt(l.bf) * (l.takeUp || 1.0)
  })
  const ect = 0.0035 * ectSum

  // BCT McKee Formula
  const ectNm = ect * 1000
  const caliperM = caliper / 1000
  const perimeterM = 2 * (innerL + innerW) / 1000
  const bctN = 5.876 * ectNm * Math.sqrt(caliperM * perimeterM)
  const bctKg = bctN / 9.81

  const bct = {
    bctNewtons: bctN,
    bctKg: bctKg,
    perimeterM: perimeterM
  }

  // Safe stacking load
  const stackingConditions: CalcStackingConditions = input.stackingConditions || { storage: 'medium' }
  let baseSF = SAFETY_FACTORS.mediumTerm
  switch (stackingConditions.storage) {
    case 'short': baseSF = SAFETY_FACTORS.shortTerm; break;
    case 'medium': baseSF = SAFETY_FACTORS.mediumTerm; break;
    case 'long': baseSF = SAFETY_FACTORS.longTerm; break;
  }

  let effectiveSF = baseSF
  if (stackingConditions.humid) effectiveSF *= SAFETY_FACTORS.multipliers.humid
  if (stackingConditions.transport) effectiveSF *= SAFETY_FACTORS.multipliers.transport
  if (stackingConditions.cold) effectiveSF *= SAFETY_FACTORS.multipliers.cold

  effectiveSF = Math.min(effectiveSF, SAFETY_FACTORS.maxEffectiveSF)
  const safeLoadKg = bctKg / effectiveSF

  const safeStack = {
    baseSF,
    effectiveSF,
    safeLoadKg
  }

  // Stack check validation
  let stackValidation: any = null
  if (input.stackCheck && input.stackCheck.enabled) {
    const stackCount = parseInt(String(input.stackCheck.stackCount)) || 1
    const contentWeight = parseFloat(String(input.stackCheck.contentWeight)) || 0
    const load = (stackCount - 1) * contentWeight
    const margin = safeLoadKg - load
    const passes = margin >= 0
    const utilPercent = safeLoadKg > 0 ? (load / safeLoadKg) * 100 : 0

    let rating = 'FAIL'
    if (passes) {
      if (utilPercent < 50) rating = 'EXCELLENT'
      else if (utilPercent < 70) rating = 'GOOD'
      else if (utilPercent < 90) rating = 'MARGINAL'
      else rating = 'BORDERLINE'
    }

    stackValidation = {
      loadKg: load,
      safeLoadKg,
      marginKg: margin,
      utilizationPercent: utilPercent,
      passes,
      rating
    }
  }

  // Weight Sizing
  const layerWeights = input.layers.map((l) => {
    const w = sheetAreaM2 * l.gsm * (l.takeUp || 1.0)
    return {
      name: l.name,
      weightGm: w,
      rate: l.rate
    }
  })

  const paperWeightTotal = layerWeights.reduce((sum, l) => sum + l.weightGm, 0)
  const starchGm = sheetAreaM2 * (input.starchGSM || 7) * (input.layers.length - 1)

  let joiningWeightGm = 0
  let pinCost = 0
  let joiningCost = 0
  const joiningMethod: CalcJoiningInput = input.joining || { method: 'stitching' }
  let pinInfo: {
    pins: number; headType: string; spacing: number; weightPerPin: number; wireRate: number
  } | null = null

  if (joiningMethod.method === 'stitching' || joiningMethod.method === 'both') {
    const stitchingDefaults = ADHESIVE_DEFAULTS.stitching
    const wireRate = parseFloat(String(joiningMethod.wireRate)) || stitchingDefaults.wireRate || 120
    const headType = joiningMethod.pinHeadType || (parseInt(input.ply) >= 5 ? 'double' : 'single')
    const spacing = stitchingDefaults.spacing[headType] || 60
    const minPins = stitchingDefaults.minPins || 3
    const pins = Math.max(minPins, Math.ceil(outerH / spacing))
    const weightPerPin = stitchingDefaults.weightPerPin[headType] || 0.5

    pinInfo = {
      pins,
      headType,
      spacing,
      weightPerPin,
      wireRate,
    }

    const stitchGm = pins * weightPerPin
    joiningWeightGm += stitchGm
    pinCost += (stitchGm / 1000) * wireRate
  }

  if (joiningMethod.method === 'fevicol' || joiningMethod.method === 'both') {
    const cwpDefaults = ADHESIVE_DEFAULTS.fevicolCWP
    const flapAreaM2 = (glueFlap / 1000) * (sheetWidth / 1000)
    const fevGm = flapAreaM2 * (joiningMethod.cwpGSM || cwpDefaults.gsm) * (joiningMethod.coverage || cwpDefaults.coverage)

    joiningWeightGm += fevGm
    joiningCost += (fevGm / 1000) * (joiningMethod.cwpRate || cwpDefaults.rate)
  }

  // Big Sheet — 2-D nesting: width N_w × length N_l boxes per big sheet
  const sheetGsmTotal = input.layers.reduce((sum, l) => sum + l.gsm * (l.takeUp || 1.0), 0)
  const starchGsmPerArea = (input.starchGSM || 7) * (input.layers.length - 1)
  const combinedGsmPerArea = sheetGsmTotal + starchGsmPerArea

  const reelWidthM = reelInfo.reelWidthMM / 1000
  const bigSheetLengthM = bigSheetLength / 1000           // N_l × (blank+trim)

  const bigSheetAreaM2 = reelWidthM * bigSheetLengthM     // total board area
  const bigSheetWeightGm = bigSheetAreaM2 * combinedGsmPerArea
  const netSheetWeightGm = sheetAreaM2 * combinedGsmPerArea   // one box blank
  const sheetWeightGm = bigSheetWeightGm / boxesPerBig    // per-box share (÷ N_w×N_l)

  // Trim: side trim (width) + cut-off trim (length) together
  const totalTrimAreaM2 = bigSheetAreaM2 - (boxesPerBig * sheetAreaM2)
  const totalTrimWeightGm = totalTrimAreaM2 * combinedGsmPerArea
  const trimPerBoxGm = totalTrimWeightGm / boxesPerBig
  const trimPercent = bigSheetWeightGm > 0 ? (totalTrimWeightGm / bigSheetWeightGm) * 100 : 0

  // Slot waste
  const slotWasteAreaM2 = (4 * innerW * MACHINE_LIMITS.slotBladeWidthMM) / 1000000
  const slotWasteGm = slotWasteAreaM2 * combinedGsmPerArea

  // Final Box Net weight (net sheet minus slot waste + pins/glues)
  const boxWeightGm = netSheetWeightGm - slotWasteGm + joiningWeightGm

  // Cost Sizing
  const layerCosts = layerWeights.map((l) => ({
    name: l.name,
    weightGm: l.weightGm,
    cost: (l.weightGm / 1000) * l.rate
  }))

  const paperCostTotal = layerCosts.reduce((sum, l) => sum + l.cost, 0)
  const starchCost = (starchGm / 1000) * (input.starchRate || 45)

  const printingCost = parseFloat(String(input.printingCost)) || 0
  const shippingPerKg = parseFloat(String(input.shippingCostPerKg ?? input.shippingCost)) || 0
  const shippingPaperWeightKg = paperWeightTotal / 1000
  const shippingCost = shippingPerKg * shippingPaperWeightKg

  // Conversion slab & charge use finished box weight (net sheet − slot + joining)
  const conversionWeightKg = boxWeightGm / 1000
  const conversionSlab = resolveConversionSlab(boxWeightGm, input.conversionSlabs)
  const conversionPerKg = conversionSlab.ratePerKg
  const conversionCost = conversionPerKg * conversionWeightKg

  const wastagePercent = (parseFloat(String(input.productionWastePercent)) || 3) / 100
  const wastageCost = (paperCostTotal + starchCost + pinCost + joiningCost) * wastagePercent

  const materialSubtotal = paperCostTotal + starchCost + pinCost + joiningCost + wastageCost
  const pricingSubtotal = materialSubtotal + conversionCost + shippingCost
  const subTotal = pricingSubtotal + printingCost

  const joiningLabel =
    joiningMethod.method === 'fevicol' ? 'Fevicol'
    : joiningMethod.method === 'both' ? 'Staple + Fevicol'
    : 'Staple'

  // Margin applies to Material + Conversion + Shipping only
  const priceMode = input.priceMode || 'auto'
  let sellingPrice = 0
  let marginValue = 0
  let marginPercent = (parseFloat(String(input.marginPercent)) || 15) / 100
  let effectiveMarginPercent = marginPercent * 100

  const boxWeightKgForPrice = boxWeightGm / 1000
  if (priceMode === 'custom' && Number(input.customSellingPrice) > 0) {
    sellingPrice = parseFloat(String(input.customSellingPrice))
    marginValue = sellingPrice - subTotal
    effectiveMarginPercent = pricingSubtotal > 0 ? (marginValue / pricingSubtotal) * 100 : 0
    marginPercent = effectiveMarginPercent / 100
  } else if (priceMode === 'customPerKg' && Number(input.customSellingPricePerKg) > 0) {
    sellingPrice = parseFloat(String(input.customSellingPricePerKg)) * boxWeightKgForPrice
    marginValue = sellingPrice - subTotal
    effectiveMarginPercent = pricingSubtotal > 0 ? (marginValue / pricingSubtotal) * 100 : 0
    marginPercent = effectiveMarginPercent / 100
  } else {
    marginValue = pricingSubtotal * marginPercent
    sellingPrice = subTotal + marginValue
  }

  const qty = parseInt(String(input.quantity)) || 1
  const divisorQty = qty > 0 ? qty : 1

  // Order totals
  const orderTotal = {
    quantity: qty,
    totalWeightKg: (boxWeightGm * qty) / 1000,
    paperWeightKg: (paperWeightTotal * qty) / 1000,
    totalValue: sellingPrice * qty,
    totalCost: subTotal * qty,
    totalMargin: marginValue * qty
  }

  // ── Production Plan (single source of truth for all stage quantities) ──────
  const plyNum = parseInt(String(input.ply)) || 3
  const corrugatorPasses = plyNum >= 7 ? 3 : plyNum >= 5 ? 2 : 1  // 2-ply passes

  const Qm = Math.ceil(qty * (1 + wastagePercent))           // boxes to make
  const bigSheets = Math.ceil(Qm / boxesPerBig)              // big board sheets
  const actualBoxes = bigSheets * boxesPerBig                // total boxes made
  const surplus = actualBoxes - Qm                           // extra beyond Qm

  const productionPlan = {
    Q: qty,
    Qm,
    N_w,
    N_l,
    boxesPerBig,
    bigSheets,
    actualBoxes,
    surplus,
    P: corrugatorPasses,
    bigSheetLengthMM: bigSheetLength,
    bigSheetWidthMM: reelWidth,
    // per-stage quantities
    corrugatorBigSheets: corrugatorPasses * bigSheets,  // 2-ply sheets from corrugator
    topLinerSheets: bigSheets,                          // top liner (fed at pasting, separately)
    pastedBoards: bigSheets,                            // full boards after pasting
    blankCount: actualBoxes,                            // box blanks after slitter
  }

  // Reel Orders — use actualBoxes so material covers the full production run
  const reelOrders = input.layers.map((layer) => {
    const wPerSheet = sheetAreaM2 * layer.gsm * (layer.takeUp || 1.0)
    const totalNeeded = (wPerSheet / 1000) * actualBoxes    // covers actual production
    const reelLength = Number(layer.reelLength) || estimateReelLength(layer.gsm)
    const reelWeightKg = (reelInfo.reelWidthMM * reelLength * layer.gsm) / 1000000
    const reelsNeeded = Math.ceil(totalNeeded / reelWeightKg)
    // Running metres this layer needs at corrugator (flute × take-up factor)
    const runningM = bigSheets * (bigSheetLength / 1000) * (layer.takeUp || 1.0)
    return {
      name: layer.name,
      gsm: layer.gsm,
      bf: layer.bf,
      weightNeededKg: totalNeeded,
      reelLengthM: reelLength,
      reelWeightKg: reelWeightKg,
      reelsToOrder: reelsNeeded,
      totalOrderKg: reelsNeeded * reelWeightKg,
      surplusKg: (reelsNeeded * reelWeightKg) - totalNeeded,
      runningM,
    }
  })

  // Scrap recycle value
  const trimWaste = input.layers.map((layer) => {
    const reelLength = Number(layer.reelLength) || estimateReelLength(layer.gsm)
    const trimKg = (reelInfo.totalTrimMM * reelLength * layer.gsm) / 1000000
    return {
      name: layer.name,
      trimKg: trimKg,
      scrapValue: trimKg * (input.scrapRate || 12)
    }
  })

  const paperWeightKg = paperWeightTotal / 1000
  const boxWeightKg = boxWeightGm / 1000
  const sheetWeightKg = sheetWeightGm / 1000

  const sheetKgRate = paperWeightKg > 0 ? (paperCostTotal / paperWeightKg) : 0
  const boxKgRate = boxWeightKg > 0 ? (sellingPrice / boxWeightKg) : 0

  // Box pricing per-kg is expressed per kg of FINISHED BOX (the rate a box is
  // quoted at), so the Grand Total ÷kg equals boxRatePerKg. The "Sheet pricing"
  // block below still divides by sheet weight; the "Sheet ₹/kg" card uses the
  // paper-cost basis (sheetKgRate).
  const perKgDivisor = boxWeightKg > 0 ? boxWeightKg : 1

  const toPerKg = (total: number, weightKg = perKgDivisor) =>
    weightKg > 0 ? total / weightKg : 0
  const toPerBox = (total: number) => total

  const pricing = {
    material: {
      paper: paperCostTotal,
      starch: starchCost,
      pin: pinCost,
      joining: joiningCost,
      joiningLabel,
      wastage: wastageCost,
      subtotal: materialSubtotal,
    },
    conversion: {
      ratePerKg: conversionPerKg,
      slabLabel: conversionSlab.label,
      paperWeightKg: conversionWeightKg,
      total: conversionCost,
    },
    shipping: {
      ratePerKg: shippingPerKg,
      paperWeightKg: shippingPaperWeightKg,
      total: shippingCost,
    },
    pricingSubtotal,
    margin: { percent: effectiveMarginPercent, amount: marginValue },
    printing: printingCost,
    subtotal: subTotal,
    grandTotal: sellingPrice,
    perKg: {
      material: toPerKg(materialSubtotal),
      conversion: toPerKg(conversionCost),
      shipping: toPerKg(shippingCost),
      subtotal: toPerKg(pricingSubtotal),
      margin: toPerKg(marginValue),
      grandTotal: toPerKg(sellingPrice),
    },
    perBox: {
      material: toPerBox(materialSubtotal),
      conversion: toPerBox(conversionCost),
      shipping: toPerBox(shippingCost),
      subtotal: toPerBox(pricingSubtotal),
      margin: toPerBox(marginValue),
      grandTotal: toPerBox(sellingPrice),
    },
    sheet: {
      weightKg: sheetWeightKg,
      perKg: {
        material: sheetWeightKg > 0 ? materialSubtotal / sheetWeightKg : 0,
        conversion: sheetWeightKg > 0 ? conversionCost / sheetWeightKg : 0,
        shipping: sheetWeightKg > 0 ? shippingCost / sheetWeightKg : 0,
        subtotal: sheetWeightKg > 0 ? pricingSubtotal / sheetWeightKg : 0,
        margin: sheetWeightKg > 0 ? marginValue / sheetWeightKg : 0,
        grandTotal: sheetWeightKg > 0 ? sellingPrice / sheetWeightKg : 0,
      },
      perBox: {
        material: materialSubtotal,
        conversion: conversionCost,
        shipping: shippingCost,
        subtotal: pricingSubtotal,
        margin: marginValue,
        grandTotal: sellingPrice,
      },
    },
    orderQty: divisorQty,
  }

  const sheetCalcDetail: SheetCalcDetail = {
    input: {
      length,
      width,
      height,
      dimType: isOuter ? 'outer' : 'inner',
      ply: input.ply,
      flute: input.flute,
      glueFlapOverride: input.glueFlap ? parseFloat(String(input.glueFlap)) : null,
    },
    caliper: { value: caliper, source: caliperSource, key: caliperKey },
    innerOuter: {
      lwFactor,
      hFactor,
      inner: { L: innerL, W: innerW, H: innerH },
      outer: { L: outerL, W: outerW, H: outerH },
      steps: innerOuterSteps,
    },
    blank: {
      wrapL,
      wrapW,
      wrapH,
      effectiveT,
      clearanceMM: effectiveClearance,
      glueFlap,
      lengthParts,
      lengthTotal: sheetLength,
      widthParts,
      widthTotal: sheetWidth,
      areaM2: sheetAreaM2,
      areaFormula: `(${sheetLength.toFixed(2)} ÷ 1000) × (${sheetWidth.toFixed(2)} ÷ 1000) = ${sheetAreaM2.toFixed(6)} m²`,
    },
    construction: {
      pieces,
      type: constType,
      maxSingleMM: machine.maxSheetLengthMM,
      maxTwoPieceMM: machine.maxSheetLength2PieceMM,
      maxThreePieceMM: machine.maxSheetLength3PieceMM,
    },
    slots: {
      positions: [slot1, slot2, slot3, slot4],
      glueFlapStart,
      sheetEnd,
      slotDepth: wrapW / 2,
    },
    nesting: {
      workingDeckleMM: workingDeckle,
      sideTrimMM: sideTrim,
      usableDeckleMM: usableDeckle,
      sheetsPerWidth: N_w,
      reelWidthMM: reelWidth,
      reelWidthRawMM: reelWidthRaw,
      utilizationPercent: utilization,
      lengthTrimMM: machine.lengthTrimMM,
      effectiveLengthUnitMM: effectiveLengthUnit,
      sheetsPerLength: N_l,
      boxesPerBigSheet: boxesPerBig,
      bigSheetLengthMM: bigSheetLength,
      steps: nestingSteps,
    },
  }

  return {
    success: true,
    warnings,
    input,
    caliper,
    glueFlap,
    sheetCalcDetail,
    dimensions: {
      inner: { L: innerL, W: innerW, H: innerH },
      outer: { L: outerL, W: outerW, H: outerH },
      caliper
    },
    sheet: {
      length: sheetLength,
      width: sheetWidth,
      areaM2: sheetAreaM2,
      areaMM2: sheetLength * sheetWidth,
      clearanceMM: effectiveClearance
    },
    construction: {
      pieces,
      type: constType,
      warning: constWarning
    },
    machineSetup: {
      creases,
      slots,
      slitterBlades,
      multiSheetCreases
    },
    reel: reelInfo,
    reelOrders,
    trimWaste,
    pinInfo,
    strength: {
      layers: layerStrengths,
      combinedBS,
      combinedBF,
      ect,
      bct,
      safeStack,
      stackValidation
    },
    weight: {
      layers: layerWeights,
      paperTotal: paperWeightTotal,
      boardGSM: combinedGsmPerArea,
      sheetGsmTotal,
      starch: starchGm,
      joining: joiningWeightGm,
      slotWaste: slotWasteGm,

      bigSheetWeight: bigSheetWeightGm,
      sheetsPerBigSheet: boxesPerBig,   // N_w × N_l
      sheetWeight: sheetWeightGm,
      netSheetWeight: netSheetWeightGm,
      trimPerBox: trimPerBoxGm,
      trimTotalGm: totalTrimWeightGm,
      trimPercent,
      trimAreaM2: totalTrimAreaM2,

      boxTotal: boxWeightGm
    },
    cost: {
      layers: layerCosts,
      paperTotal: paperCostTotal,
      starch: starchCost,
      pin: pinCost,
      joining: joiningCost,
      joiningLabel,
      printing: printingCost,
      shipping: shippingCost,
      shippingPerKg,
      shippingPaperWeightKg,
      conversion: conversionCost,
      conversionPerKg,
      conversionSlabLabel: conversionSlab.label,
      conversionPaperWeightKg: conversionWeightKg,
      conversionBoxWeightKg: boxWeightKg,
      wastage: wastageCost,
      materialSubtotal,
      pricingSubtotal,
      subTotal,
      margin: marginValue,
      marginPercent: effectiveMarginPercent,
      sellingPrice,
      priceMode,
      customSellingPricePerKg: priceMode === 'customPerKg' && Number(input.customSellingPricePerKg) > 0
        ? parseFloat(String(input.customSellingPricePerKg))
        : null,
      sheetRatePerKg: sheetKgRate,
      boxRatePerKg: boxKgRate,
      pricing,
    },
    order: orderTotal,
    productionPlan,
    timestamp: new Date().toISOString()
  }
}
