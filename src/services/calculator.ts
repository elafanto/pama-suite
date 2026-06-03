// Indian Paper Library Presets
export const PAPER_LIBRARY = {
  kraftLiner: {
    name: "Kraft Liner",
    typicalRate: 33,
    defaultColor: "Natural Brown",
    presets: [
      { gsm: 90,  bf: 16, rate: 48 },
      { gsm: 100, bf: 16, rate: 50 },
      { gsm: 120, bf: 16, rate: 52 },
      { gsm: 120, bf: 18, rate: 54 },
      { gsm: 140, bf: 18, rate: 55 },
      { gsm: 150, bf: 18, rate: 56 },
      { gsm: 150, bf: 20, rate: 58 },
      { gsm: 180, bf: 20, rate: 60 },
      { gsm: 180, bf: 22, rate: 62 },
      { gsm: 200, bf: 22, rate: 64 },
      { gsm: 200, bf: 24, rate: 66 },
      { gsm: 230, bf: 24, rate: 68 },
      { gsm: 250, bf: 26, rate: 72 },
      { gsm: 300, bf: 28, rate: 78 },
      { gsm: 300, bf: 32, rate: 85 }
    ]
  },
  testLiner: {
    name: "Test Liner",
    typicalRate: 42,
    defaultColor: "Natural Brown",
    presets: [
      { gsm: 90,  bf: 16, rate: 38 },
      { gsm: 100, bf: 16, rate: 40 },
      { gsm: 120, bf: 16, rate: 42 },
      { gsm: 140, bf: 16, rate: 44 },
      { gsm: 150, bf: 16, rate: 45 },
      { gsm: 150, bf: 18, rate: 47 },
      { gsm: 180, bf: 18, rate: 50 },
      { gsm: 180, bf: 20, rate: 52 },
      { gsm: 200, bf: 20, rate: 54 }
    ]
  },
  semiKraft: {
    name: "Semi Kraft",
    typicalRate: 48,
    defaultColor: "Natural Brown",
    presets: [
      { gsm: 90,  bf: 16, rate: 42 },
      { gsm: 100, bf: 16, rate: 44 },
      { gsm: 120, bf: 16, rate: 45 },
      { gsm: 140, bf: 16, rate: 47 },
      { gsm: 150, bf: 18, rate: 50 },
      { gsm: 180, bf: 18, rate: 52 },
      { gsm: 180, bf: 20, rate: 55 },
      { gsm: 200, bf: 20, rate: 57 }
    ]
  },
  duplex: {
    name: "Duplex Board",
    typicalRate: 50,
    defaultColor: "White",
    presets: [
      { gsm: 230, bf: 16, rate: 68 },
      { gsm: 250, bf: 16, rate: 72 },
      { gsm: 280, bf: 16, rate: 76 },
      { gsm: 300, bf: 18, rate: 80 },
      { gsm: 350, bf: 18, rate: 88 },
      { gsm: 400, bf: 20, rate: 95 },
      { gsm: 450, bf: 20, rate: 105 }
    ]
  },
  flutingMedium: {
    name: "Fluting Medium",
    typicalRate: 44,
    defaultColor: "Natural Brown",
    presets: [
      { gsm: 90,  bf: 16, rate: 40 },
      { gsm: 100, bf: 16, rate: 42 },
      { gsm: 105, bf: 16, rate: 43 },
      { gsm: 110, bf: 16, rate: 44 },
      { gsm: 120, bf: 16, rate: 45 },
      { gsm: 120, bf: 18, rate: 48 },
      { gsm: 140, bf: 18, rate: 50 },
      { gsm: 150, bf: 18, rate: 52 }
    ]
  },
  highPerformance: {
    name: "High Performance Kraft",
    typicalRate: 85,
    defaultColor: "Golden Yellow",
    presets: [
      { gsm: 150, bf: 24, rate: 72 },
      { gsm: 180, bf: 26, rate: 78 },
      { gsm: 200, bf: 28, rate: 82 },
      { gsm: 200, bf: 32, rate: 88 },
      { gsm: 230, bf: 32, rate: 92 },
      { gsm: 250, bf: 35, rate: 98 },
      { gsm: 300, bf: 35, rate: 105 },
      { gsm: 300, bf: 40, rate: 115 }
    ]
  },
  recycled: {
    name: "Recycled Paper (RP)",
    typicalRate: 35,
    defaultColor: "Natural Brown",
    presets: [
      { gsm: 90,  bf: 16, rate: 35 },
      { gsm: 100, bf: 16, rate: 38 },
      { gsm: 120, bf: 16, rate: 40 },
      { gsm: 150, bf: 16, rate: 40 },
      { gsm: 180, bf: 16, rate: 42 }
    ]
  }
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
  maxDeckleMM: 1727,          // 68 inch
  workingDeckleMM: 1720,      // Safety buffer
  sideTrimMM: 10,             // Per side
  maxSheetLengthMM: 2500,     // Single piece limit
  maxSheetLength2PieceMM: 5000,
  maxSheetLength3PieceMM: 7500,
  clearanceMM: 6,             // Sheet width clearance
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
export function getCaliper(ply: string, flute: string): number {
  const key = `${ply}-${flute}`
  return CALIPER_TABLE[key] || 4.0
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

// Costing Calculations
export function calculate(input: any) {
  const warnings: string[] = []

  // Sizing inputs
  const length = parseFloat(input.length)
  const width = parseFloat(input.width)
  const height = parseFloat(input.height)

  if (!length || !width || !height || length <= 0 || width <= 0 || height <= 0) {
    return { error: 'Box dimensions must be positive numbers', success: false }
  }

  if (!input.layers || input.layers.length === 0) {
    return { error: 'At least one paper layer required', success: false }
  }

  // Determine caliper
  let caliper = input.caliperOverride ? parseFloat(input.caliperOverride) : null
  if (!caliper) {
    caliper = getCaliper(input.ply, input.flute)
  }

  const glueFlap = input.glueFlap ? parseFloat(input.glueFlap) : (GLUE_FLAP_DEFAULTS[input.ply] || 40)

  // Outer vs Inner Sizing
  const isOuter = input.dimType === 'outer'
  const t = caliper

  let innerL = 0, innerW = 0, innerH = 0
  let outerL = 0, outerW = 0, outerH = 0

  if (isOuter) {
    outerL = length
    outerW = width
    outerH = height
    innerL = outerL - 1.5 * t
    innerW = outerW - 1.5 * t
    innerH = outerH - 2.7 * t
  } else {
    innerL = length
    innerW = width
    innerH = height
    outerL = innerL + 1.5 * t
    outerW = innerW + 1.5 * t
    outerH = innerH + 2.7 * t
  }

  const wrapL = isOuter ? outerL : innerL
  const wrapW = isOuter ? outerW : innerW
  const wrapH = isOuter ? outerH : innerH
  const effectiveT = isOuter ? 0 : caliper
  const effectiveClearance = isOuter ? 0 : MACHINE_LIMITS.clearanceMM

  // Sheet Size Sizing
  const sheetLength = 2 * (wrapL + effectiveT) + 2 * (wrapW + effectiveT) + glueFlap
  const sheetWidth = wrapW + wrapH + effectiveT + effectiveClearance
  const sheetAreaM2 = (sheetLength / 1000) * (sheetWidth / 1000)

  if (sheetWidth > (MACHINE_LIMITS.workingDeckleMM - 2 * MACHINE_LIMITS.sideTrimMM)) {
    return {
      error: `Sheet width ${sheetWidth.toFixed(0)}mm exceeds machine deckle limit (${MACHINE_LIMITS.workingDeckleMM - 2 * MACHINE_LIMITS.sideTrimMM}mm usable). Box too wide/tall.`,
      success: false
    }
  }

  // Construction pieces
  let pieces = 1
  let constType = '1-piece RSC'
  let constWarning: string | null = null

  if (sheetLength <= MACHINE_LIMITS.maxSheetLengthMM) {
    pieces = 1
    constType = '1-piece RSC'
  } else if (sheetLength <= MACHINE_LIMITS.maxSheetLength2PieceMM) {
    pieces = 2
    constType = '2-piece (with lap joint)'
    constWarning = 'Box requires 2-piece construction. Extra material & labor needed.'
  } else if (sheetLength <= MACHINE_LIMITS.maxSheetLength3PieceMM) {
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

  // Reel Recommendation
  const workingDeckle = MACHINE_LIMITS.workingDeckleMM
  const sideTrim = MACHINE_LIMITS.sideTrimMM
  const totalTrim = 2 * sideTrim

  let N = Math.floor(workingDeckle / sheetWidth)
  if (N < 1) {
    return { error: `Sheet width ${sheetWidth.toFixed(0)}mm exceeds deckle limit`, success: false }
  }

  let reelWidthRaw = N * sheetWidth + totalTrim
  let reelWidth = Math.ceil(reelWidthRaw / 5) * 5

  while (reelWidth > workingDeckle && N > 1) {
    N--
    reelWidthRaw = N * sheetWidth + totalTrim
    reelWidth = Math.ceil(reelWidthRaw / 5) * 5
  }

  if (reelWidth > workingDeckle) {
    return { error: `Sheet width + trim exceeds machine limit`, success: false }
  }

  const utilization = (N * sheetWidth) / reelWidth * 100
  const totalTrimMM = reelWidth - (N * sheetWidth)

  const reelInfo = {
    feasible: true,
    reelWidthMM: reelWidth,
    reelWidthRawMM: reelWidthRaw,
    sheetsPerWidth: N,
    utilizationPercent: utilization,
    totalTrimMM: totalTrimMM,
    sideTrimMM: sideTrim
  }

  // Slitter Blades Setup
  const slitterBlades = [sideTrim]
  for (let i = 1; i <= N; i++) {
    slitterBlades.push(sideTrim + i * sheetWidth)
  }

  // Multi-sheet creasing machine wheels
  const multiSheetCreases = []
  for (let i = 0; i < N; i++) {
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
  const layerStrengths = input.layers.map((l: any) => {
    const autoRCT = 0.6 * Math.sqrt(l.gsm * l.bf)
    const finalRCT = l.rctOverride && l.rctOverride > 0 ? l.rctOverride : autoRCT
    return {
      name: l.name,
      gsm: l.gsm,
      bf: l.bf,
      takeUp: l.takeUp || 1.0,
      bs: (l.bf * l.gsm) / 1000,
      rct: finalRCT,
      rctAuto: autoRCT,
      rctOverridden: l.rctOverride && l.rctOverride > 0
    }
  })

  // ECT = 0.0035 * sum(gsm * sqrt(bf) * takeUp)
  let ectSum = 0
  input.layers.forEach((l: any) => {
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
  const stackingConditions = input.stackingConditions || { storage: 'medium' }
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
    const stackCount = parseInt(input.stackCheck.stackCount) || 1
    const contentWeight = parseFloat(input.stackCheck.contentWeight) || 0
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
  const layerWeights = input.layers.map((l: any) => {
    const w = sheetAreaM2 * l.gsm * (l.takeUp || 1.0)
    return {
      name: l.name,
      weightGm: w,
      rate: l.rate
    }
  })

  const paperWeightTotal = layerWeights.reduce((sum: number, l: any) => sum + l.weightGm, 0)
  const starchGm = sheetAreaM2 * (input.starchGSM || 7) * (input.layers.length - 1)

  let joiningWeightGm = 0
  let joiningCost = 0
  const joiningMethod = input.joining || { method: 'stitching' }
  let pinInfo: any = null

  if (joiningMethod.method === 'stitching' || joiningMethod.method === 'both') {
    // Pin calculation
    const stitchingDefaults = ADHESIVE_DEFAULTS.stitching
    const headType = joiningMethod.pinHeadType || (parseInt(input.ply) >= 5 ? 'double' : 'single')
    const spacing = stitchingDefaults.spacing[headType] || 60
    const minPins = stitchingDefaults.minPins || 3
    const pins = Math.max(minPins, Math.ceil(outerH / spacing))
    const weightPerPin = stitchingDefaults.weightPerPin[headType] || 0.5

    pinInfo = {
      pins,
      headType,
      spacing,
      weightPerPin
    }

    const stitchGm = pins * weightPerPin
    joiningWeightGm += stitchGm
    joiningCost += (stitchGm / 1000) * (stitchingDefaults.wireRate || 120)
  }

  if (joiningMethod.method === 'fevicol' || joiningMethod.method === 'both') {
    const cwpDefaults = ADHESIVE_DEFAULTS.fevicolCWP
    const flapAreaM2 = (glueFlap / 1000) * (sheetWidth / 1000)
    const fevGm = flapAreaM2 * (joiningMethod.cwpGSM || cwpDefaults.gsm) * (joiningMethod.coverage || cwpDefaults.coverage)

    joiningWeightGm += fevGm
    joiningCost += (fevGm / 1000) * (joiningMethod.cwpRate || cwpDefaults.rate)
  }

  // Big Sheet Approach - Allocated corrugator trim waste
  const sheetGsmTotal = input.layers.reduce((sum: number, l: any) => sum + l.gsm * (l.takeUp || 1.0), 0)
  const starchGsmPerArea = (input.starchGSM || 7) * (input.layers.length - 1)
  const combinedGsmPerArea = sheetGsmTotal + starchGsmPerArea

  const reelWidthM = reelInfo.reelWidthMM / 1000
  const sheetLengthM = sheetLength / 1000

  const bigSheetAreaM2 = reelWidthM * sheetLengthM
  const bigSheetWeightGm = bigSheetAreaM2 * combinedGsmPerArea
  const netSheetWeightGm = sheetAreaM2 * combinedGsmPerArea
  const sheetWeightGm = bigSheetWeightGm / N

  // Trim weights
  const totalTrimAreaM2 = bigSheetAreaM2 - (N * sheetAreaM2)
  const totalTrimWeightGm = totalTrimAreaM2 * combinedGsmPerArea
  const trimPerBoxGm = totalTrimWeightGm / N
  const trimPercent = bigSheetWeightGm > 0 ? (totalTrimWeightGm / bigSheetWeightGm) * 100 : 0

  // Slot waste
  const slotWasteAreaM2 = (4 * innerW * MACHINE_LIMITS.slotBladeWidthMM) / 1000000
  const slotWasteGm = slotWasteAreaM2 * combinedGsmPerArea

  // Final Box Net weight (net sheet minus slot waste + pins/glues)
  const boxWeightGm = netSheetWeightGm - slotWasteGm + joiningWeightGm

  // Cost Sizing
  const layerCosts = layerWeights.map((l: any) => ({
    name: l.name,
    weightGm: l.weightGm,
    cost: (l.weightGm / 1000) * l.rate
  }))

  const paperCostTotal = layerCosts.reduce((sum: number, l: any) => sum + l.cost, 0)
  const starchCost = (starchGm / 1000) * (input.starchRate || 30)

  const printingCost = parseFloat(input.printingCost) || 0
  const shippingPerKg = parseFloat(input.shippingCostPerKg ?? input.shippingCost) || 0
  const shippingPaperWeightKg = paperWeightTotal / 1000
  const shippingCost = shippingPerKg * shippingPaperWeightKg
  const conversionPerKg = parseFloat(input.conversionCostPerKg ?? input.conversionCost) || 0
  const conversionCost = conversionPerKg * (boxWeightGm / 1000)
  const wastagePercent = (parseFloat(input.productionWastePercent) || 3) / 100

  const subTotalBeforeWaste = paperCostTotal + starchCost + joiningCost + printingCost + shippingCost + conversionCost
  const wastageCost = (paperCostTotal + starchCost + joiningCost) * wastagePercent
  const subTotal = subTotalBeforeWaste + wastageCost

  // Price pricing modes
  const priceMode = input.priceMode || 'auto'
  let sellingPrice = 0
  let marginValue = 0
  let marginPercent = (parseFloat(input.marginPercent) || 30) / 100
  let effectiveMarginPercent = marginPercent * 100

  if (priceMode === 'custom' && input.customSellingPrice && input.customSellingPrice > 0) {
    sellingPrice = parseFloat(input.customSellingPrice)
    marginValue = sellingPrice - subTotal
    effectiveMarginPercent = subTotal > 0 ? (marginValue / subTotal) * 100 : 0
    marginPercent = effectiveMarginPercent / 100
  } else {
    marginValue = subTotal * marginPercent
    sellingPrice = subTotal + marginValue
  }

  // Order totals
  const qty = parseInt(input.quantity) || 1
  const orderTotal = {
    quantity: qty,
    totalWeightKg: (boxWeightGm * qty) / 1000,
    paperWeightKg: (paperWeightTotal * qty) / 1000,
    totalValue: sellingPrice * qty,
    totalCost: subTotal * qty,
    totalMargin: marginValue * qty
  }

  // Reel Orders
  const reelOrders = input.layers.map((layer: any) => {
    const wPerSheet = sheetAreaM2 * layer.gsm * (layer.takeUp || 1.0)
    const totalNeeded = (wPerSheet / 1000) * qty * (1 + wastagePercent)
    const reelLength = layer.reelLength || estimateReelLength(layer.gsm)
    const reelWeightKg = (reelInfo.reelWidthMM * reelLength * layer.gsm) / 1000000
    const reelsNeeded = Math.ceil(totalNeeded / reelWeightKg)
    return {
      name: layer.name,
      gsm: layer.gsm,
      bf: layer.bf,
      weightNeededKg: totalNeeded,
      reelLengthM: reelLength,
      reelWeightKg: reelWeightKg,
      reelsToOrder: reelsNeeded,
      totalOrderKg: reelsNeeded * reelWeightKg,
      surplusKg: (reelsNeeded * reelWeightKg) - totalNeeded
    }
  })

  // Scrap recycle value
  const trimWaste = input.layers.map((layer: any) => {
    const reelLength = layer.reelLength || estimateReelLength(layer.gsm)
    const trimKg = (reelInfo.totalTrimMM * reelLength * layer.gsm) / 1000000
    return {
      name: layer.name,
      trimKg: trimKg,
      scrapValue: trimKg * (input.scrapRate || 12)
    }
  })

  const sheetKgRate = paperWeightTotal > 0 ? (paperCostTotal / (paperWeightTotal / 1000)) : 0
  const boxKgRate = boxWeightGm > 0 ? (sellingPrice / (boxWeightGm / 1000)) : 0

  return {
    success: true,
    warnings,
    input,
    caliper,
    glueFlap,
    dimensions: {
      inner: { L: innerL, W: innerW, H: innerH },
      outer: { L: outerL, W: outerW, H: outerH },
      caliper
    },
    sheet: {
      length: sheetLength,
      width: sheetWidth,
      areaM2: sheetAreaM2,
      areaMM2: sheetLength * sheetWidth
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
      sheetsPerBigSheet: N,
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
      joining: joiningCost,
      printing: printingCost,
      shipping: shippingCost,
      shippingPerKg,
      shippingPaperWeightKg,
      conversion: conversionCost,
      conversionPerKg,
      conversionBoxWeightKg: boxWeightGm / 1000,
      wastage: wastageCost,
      subTotal,
      margin: marginValue,
      marginPercent: effectiveMarginPercent,
      sellingPrice,
      priceMode,
      sheetRatePerKg: sheetKgRate,
      boxRatePerKg: boxKgRate
    },
    order: orderTotal,
    timestamp: new Date().toISOString()
  }
}
