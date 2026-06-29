import { getTakeUp } from '@/services/calculator'
import {
  computeBoxCalcResults,
  defaultConversionSlabs,
  type BoxCalcForm,
  type BoxCalcLayer,
} from '@/services/boxcalcUi'

export interface CompareScenario {
  id: string
  label: string
  enabled: boolean
  ply: string
  flute: string
  /** Top liner */
  outerGsm: number
  outerBf: number
  outerRate: number
  /** Bottom liner (defaults to top when unset in saved rows) */
  bottomGsm?: number
  bottomBf?: number
  bottomRate?: number
  midGsm: number
  midBf: number
  midRate: number
  fluteGsm: number
  fluteBf: number
  fluteRate: number
  marginPercent: number | null
  convRatePerKg: number | null
}

export interface CompareRowResult {
  scenario: CompareScenario
  comboLabel: string
  error: string | null
  weightGm: number | null
  material: number | null
  conversion: number | null
  subtotal: number | null
  sellingPrice: number | null
  perKg: number | null
  orderTotal: number | null
  bct: number | null
  stackUtil: number | null
}

const PLY_LAYER_NAMES: Record<string, string[]> = {
  '3-ply': ['Top Liner', 'Flute', 'Bottom Liner'],
  '5-ply': ['Top Liner', 'Flute 1', 'Mid Liner', 'Flute 2', 'Bottom Liner'],
  '7-ply': ['Top Liner', 'Flute 1', 'Mid Liner 1', 'Flute 2', 'Mid Liner 2', 'Flute 3', 'Bottom Liner'],
}

const FLUTE_OPTIONS: Record<string, string[]> = {
  '3-ply': ['A', 'B', 'C', 'E'],
  '5-ply': ['BC', 'CC', 'BE', 'EB'],
  '7-ply': ['ABC', 'BCB', 'BCC'],
}

const COMPARE_STORAGE_KEY = 'boxapp_compare_scenarios'

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function cloneForm(form: BoxCalcForm): BoxCalcForm {
  return JSON.parse(JSON.stringify(form)) as BoxCalcForm
}

function layerKind(idx: number, name: string, total: number): 'top' | 'bottom' | 'mid' | 'flute' {
  if (name.toLowerCase().includes('flute')) return 'flute'
  if (idx === 0) return 'top'
  if (idx === total - 1) return 'bottom'
  return 'mid'
}

function getTakeUpForLayer(ply: string, flute: string, layerIdx: number): number {
  if (flute.length === 1) return getTakeUp(flute)
  const plySlots: Record<string, string[]> = {
    '3-ply': ['', 'B', ''],
    '5-ply': ['', 'F1', '', 'F2', ''],
    '7-ply': ['', 'F1', '', 'F2', '', 'F3', ''],
  }
  const slots = plySlots[ply] || []
  const fluteChars = flute.split('')
  let count = 0
  for (let i = 0; i <= layerIdx; i++) {
    if (slots[i]?.startsWith('F')) count++
  }
  return getTakeUp(fluteChars[count - 1] || 'C')
}

function resolveFlute(ply: string, flute: string): string {
  const opts = FLUTE_OPTIONS[ply] || ['C']
  return opts.includes(flute) ? flute : opts[0]
}

/** Fill bottom liner fields for rows saved before bottom liner was tracked. */
export function normalizeScenario(scenario: CompareScenario): CompareScenario {
  return {
    ...scenario,
    bottomGsm: scenario.bottomGsm ?? scenario.outerGsm,
    bottomBf: scenario.bottomBf ?? scenario.outerBf,
    bottomRate: scenario.bottomRate ?? scenario.outerRate,
  }
}

function layerPaperSpec(
  kind: ReturnType<typeof layerKind>,
  scenario: CompareScenario,
): { gsm: number; bf: number; rate: number } {
  const s = normalizeScenario(scenario)
  if (kind === 'flute') return { gsm: s.fluteGsm, bf: s.fluteBf, rate: s.fluteRate }
  if (kind === 'mid') return { gsm: s.midGsm, bf: s.midBf, rate: s.midRate }
  if (kind === 'bottom') return { gsm: s.bottomGsm!, bf: s.bottomBf!, rate: s.bottomRate! }
  return { gsm: s.outerGsm, bf: s.outerBf, rate: s.outerRate }
}

function sameConstruction(
  basePly: string,
  baseFlute: string,
  baseLayers: BoxCalcLayer[],
  ply: string,
  flute: string,
): boolean {
  const names = PLY_LAYER_NAMES[ply] || []
  return (
    basePly === ply
    && resolveFlute(basePly, baseFlute) === resolveFlute(ply, flute)
    && baseLayers.length === names.length
    && baseLayers.every((l, i) => l.name === names[i])
  )
}

function buildLayersForScenario(
  ply: string,
  flute: string,
  scenario: CompareScenario,
  seedLayers: BoxCalcLayer[],
  basePly: string,
  baseFlute: string,
): BoxCalcLayer[] {
  const names = PLY_LAYER_NAMES[ply] || PLY_LAYER_NAMES['3-ply']
  const constructionChanged = !sameConstruction(basePly, baseFlute, seedLayers, ply, flute)

  // Same ply/flute as calculator — patch paper only, keep takeUp/RCT/reel exactly.
  if (!constructionChanged) {
    return seedLayers.map((seed, idx) => {
      const kind = layerKind(idx, seed.name, seedLayers.length)
      const spec = layerPaperSpec(kind, scenario)
      return {
        ...seed,
        gsm: spec.gsm,
        bf: spec.bf,
        rate: spec.rate,
      }
    })
  }

  const seedByName = new Map(seedLayers.map((l) => [l.name, l]))
  return names.map((name, idx) => {
    const kind = layerKind(idx, name, names.length)
    const seed = seedByName.get(name)
    const isFlute = kind === 'flute'
    const spec = layerPaperSpec(kind, scenario)

    let takeUp = 1
    if (isFlute) {
      takeUp = seed?.takeUp && basePly === ply && resolveFlute(basePly, baseFlute) === resolveFlute(ply, flute)
        ? seed.takeUp
        : getTakeUpForLayer(ply, flute, idx)
    } else if (seed?.takeUp) {
      takeUp = seed.takeUp
    }

    return {
      name,
      paperType: seed?.paperType || (isFlute ? 'flutingMedium' : (kind === 'mid' ? 'testLiner' : 'kraftLiner')),
      gsm: spec.gsm,
      bf: spec.bf,
      rate: spec.rate,
      color: seed?.color || 'Natural Brown',
      takeUp,
      reelLength: seed?.reelLength ?? null,
      rctOverride: seed?.rctOverride ?? null,
      showAdvanced: seed?.showAdvanced ?? false,
    }
  })
}

export function scenarioFromForm(form: BoxCalcForm, label = 'Option'): CompareScenario {
  const layers = form.layers
  const top = layers[0]
  const bottom = layers[layers.length - 1]
  const mid = layers.find((l, i) => layerKind(i, l.name, layers.length) === 'mid')
  const flute = layers.find((l) => l.name.toLowerCase().includes('flute'))

  return normalizeScenario({
    id: uid(),
    label,
    enabled: true,
    ply: form.ply,
    flute: form.flute,
    outerGsm: Number(top?.gsm) || 150,
    outerBf: Number(top?.bf) || 18,
    outerRate: Number(top?.rate) || 33,
    bottomGsm: Number(bottom?.gsm) || Number(top?.gsm) || 150,
    bottomBf: Number(bottom?.bf) || Number(top?.bf) || 18,
    bottomRate: Number(bottom?.rate) || Number(top?.rate) || 33,
    midGsm: Number(mid?.gsm) || Number(top?.gsm) || 120,
    midBf: Number(mid?.bf) || Number(top?.bf) || 18,
    midRate: Number(mid?.rate) || Number(top?.rate) || 33,
    fluteGsm: Number(flute?.gsm) || 120,
    fluteBf: Number(flute?.bf) || 18,
    fluteRate: Number(flute?.rate) || 33,
    marginPercent: form.marginPercent,
    convRatePerKg: form.conversionSlabs?.[0]?.ratePerKg ?? null,
  })
}

export function defaultCompareScenario(label: string, base?: BoxCalcForm): CompareScenario {
  if (base) return scenarioFromForm(base, label)
  return normalizeScenario({
    id: uid(),
    label,
    enabled: true,
    ply: '3-ply',
    flute: 'C',
    outerGsm: 150,
    outerBf: 18,
    outerRate: 33,
    midGsm: 120,
    midBf: 18,
    midRate: 33,
    fluteGsm: 120,
    fluteBf: 18,
    fluteRate: 33,
    marginPercent: 15,
    convRatePerKg: 14,
  })
}

export function buildCompareForm(base: BoxCalcForm, scenario: CompareScenario): BoxCalcForm {
  const form = cloneForm(base)
  const basePly = base.ply
  const baseFlute = base.flute
  const seedLayers = form.layers

  form.customerName = form.customerName || 'Compare'
  form.boxName = form.boxName || 'Compare'
  form.ply = scenario.ply || form.ply
  form.flute = resolveFlute(form.ply, scenario.flute || form.flute)

  const constructionChanged = !sameConstruction(basePly, baseFlute, seedLayers, form.ply, form.flute)
  if (constructionChanged) {
    form.caliperOverride = null
    if (basePly !== form.ply) form.glueFlap = null
  }

  form.layers = buildLayersForScenario(form.ply, form.flute, scenario, seedLayers, basePly, baseFlute)

  if (scenario.marginPercent != null && Number.isFinite(scenario.marginPercent)) {
    form.marginPercent = scenario.marginPercent
    form.priceMode = 'auto'
    form.customSellingPrice = null
    form.customSellingPricePerKg = null
  }
  if (scenario.convRatePerKg != null && Number.isFinite(scenario.convRatePerKg)) {
    const rate = Number(scenario.convRatePerKg)
    form.conversionSlabs = (form.conversionSlabs?.length ? form.conversionSlabs : defaultConversionSlabs())
      .map((s) => ({ ...s, ratePerKg: rate }))
  }
  form.calcMode = 'box'
  return form
}

export function comboLabel(scenario: CompareScenario): string {
  const s = normalizeScenario(scenario)
  const ply = s.ply || '3-ply'
  const flute = s.flute || 'C'
  const mid = ply !== '3-ply' ? ` M${s.midGsm}/${s.midBf}` : ''
  const bottomDiff = s.bottomGsm !== s.outerGsm || s.bottomBf !== s.outerBf
  const bottom = bottomDiff ? ` B${s.bottomGsm}/${s.bottomBf}` : ''
  return `${ply}/${flute} · T${s.outerGsm}/${s.outerBf}${bottom} · F${s.fluteGsm}/${s.fluteBf}${mid}`
}

export function computeCompareRow(base: BoxCalcForm, scenario: CompareScenario): CompareRowResult {
  const normalized = normalizeScenario(scenario)
  const combo = comboLabel(normalized)
  if (!normalized.enabled) {
    return {
      scenario: normalized,
      comboLabel: combo,
      error: null,
      weightGm: null,
      material: null,
      conversion: null,
      subtotal: null,
      sellingPrice: null,
      perKg: null,
      orderTotal: null,
      bct: null,
      stackUtil: null,
    }
  }

  const form = buildCompareForm(base, normalized)
  const res = computeBoxCalcResults(form)
  if (!res || 'error' in res) {
    return {
      scenario: normalized,
      comboLabel: combo,
      error: res && 'error' in res ? (res.error ?? 'Cannot calculate') : 'Cannot calculate',
      weightGm: null,
      material: null,
      conversion: null,
      subtotal: null,
      sellingPrice: null,
      perKg: null,
      orderTotal: null,
      bct: null,
      stackUtil: null,
    }
  }

  const pricing = res.cost?.pricing
  const weightGm = res.weight?.boxTotal ?? null
  const boxKg = weightGm ? weightGm / 1000 : 0

  return {
    scenario: normalized,
    comboLabel: combo,
    error: null,
    weightGm,
    material: pricing?.perBox?.material ?? res.cost?.materialSubtotal ?? null,
    conversion: pricing?.perBox?.conversion ?? res.cost?.conversion ?? null,
    subtotal: pricing?.perBox?.subtotal ?? res.cost?.subTotal ?? null,
    sellingPrice: res.cost?.sellingPrice ?? null,
    perKg: res.cost?.boxRatePerKg ?? (boxKg > 0 && res.cost?.sellingPrice ? res.cost.sellingPrice / boxKg : null),
    orderTotal: res.order?.totalValue ?? (res.cost?.sellingPrice != null ? res.cost.sellingPrice * (base.quantity || 0) : null),
    bct: res.strength?.bct?.bctKg ?? null,
    stackUtil: res.strength?.stackValidation?.utilizationPercent ?? null,
  }
}

export function computeAllCompareRows(base: BoxCalcForm, scenarios: CompareScenario[]): CompareRowResult[] {
  return scenarios.map((s) => computeCompareRow(base, normalizeScenario(s)))
}

export function loadCompareScenarios(base: BoxCalcForm): CompareScenario[] {
  try {
    const raw = localStorage.getItem(COMPARE_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((s: CompareScenario) => normalizeScenario(s))
      }
    }
  } catch { /* */ }
  return [
    defaultCompareScenario('A — Standard', base),
    defaultCompareScenario('B — Heavier liner', base),
    {
      ...defaultCompareScenario('C — Budget', base),
      outerGsm: 140,
      outerBf: 16,
      outerRate: 31,
      fluteGsm: 110,
      fluteBf: 16,
      fluteRate: 30,
      marginPercent: 12,
      convRatePerKg: 13,
    },
  ]
}

export function saveCompareScenarios(scenarios: CompareScenario[]): void {
  try {
    localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(scenarios.map(normalizeScenario)))
  } catch { /* */ }
}

export function applyScenarioToMainForm(form: BoxCalcForm, scenario: CompareScenario): void {
  const built = buildCompareForm(form, normalizeScenario(scenario))
  form.ply = built.ply
  form.flute = built.flute
  form.layers = built.layers
  form.caliperOverride = built.caliperOverride
  form.glueFlap = built.glueFlap
  if (scenario.marginPercent != null) form.marginPercent = scenario.marginPercent
  if (scenario.convRatePerKg != null) {
    form.conversionSlabs = built.conversionSlabs
  }
}

/** Weight from calculator form — for parity check in Compare UI. */
export function calcWeightFromBaseForm(form: BoxCalcForm): number | null {
  const res = computeBoxCalcResults(form)
  if (!res || 'error' in res) return null
  return res.weight?.boxTotal ?? null
}
