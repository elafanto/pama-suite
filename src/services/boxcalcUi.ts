import {
  PAPER_LIBRARY,
  calculate as runCalculator,
  getCaliper,
  getPapersForRole,
  DEFAULT_CONVERSION_SLABS,
  type ConversionSlab,
} from '@/services/calculator'
import { loadBoxSheetSettings, type BoxSheetSettings } from '@/services/boxSheetSettings'

export { COMMON_PAPER_COLORS, getPapersForRole, DEFAULT_CONVERSION_SLABS, type ConversionSlab } from '@/services/calculator'

export interface BoxCalcLayer {
  name: string
  paperType: string
  gsm: number
  bf: number
  rate: number
  color: string
  takeUp: number
  reelLength: number | null
  rctOverride: number | null
  showAdvanced?: boolean
}

export interface BoxCalcJobCard {
  jobNumber: string
  companyName: string
  customerContact: string
  customerPhone: string
  customerAddress: string
  orderDate: string
  deliveryDate: string
  priority: string
  bundleSize: number
  pastingTime: string
  cureDurationHours: number
  materialLoss: Record<string, number | string>
  operators: Record<string, string>
  supervisor: string
  notes: string
}

export interface BoxCalcForm {
  customerName: string
  boxName: string
  /** Box RSC calc vs flat plain sheet weight (e.g. 1200×300 mm). */
  calcMode: 'box' | 'plainSheet'
  printType: 'printed' | 'non-printed'
  dimensionUnit: 'mm' | 'inch'
  dimType: 'inner' | 'outer'
  length: number
  width: number
  height: number
  ply: string
  flute: string
  caliperOverride: number | null
  glueFlap: number | null
  layers: BoxCalcLayer[]
  starchGSM: number
  starchRate: number
  joining: {
    method: 'stitching' | 'fevicol' | 'both'
    pinHeadType: 'single' | 'double' | ''
    wireRate: number
    cwpGSM: number
    coverage: number
    cwpRate: number
  }
  quantity: number
  productionWastePercent: number
  marginPercent: number
  printingCost: number
  /** Freight/shipping charge in ₹ per kg of paper weight (same basis as layer paper rates) */
  shippingCostPerKg: number
  /** Weight-based conversion slab rates (₹/kg × paper weight) */
  conversionSlabs: ConversionSlab[]
  scrapRate: number
  priceMode: 'auto' | 'custom' | 'customPerKg'
  customSellingPrice: number | null
  customSellingPricePerKg: number | null
  stackCheck: { enabled: boolean; stackCount: number; contentWeight: number }
  stackingConditions: {
    storage: 'short' | 'medium' | 'long'
    humid: boolean
    transport: boolean
    cold: boolean
  }
  jobCard?: BoxCalcJobCard
}

export interface VendorPhone {
  name: string
  phone: string
  displayPhone?: string
  useCount: number
  lastUsed?: string
}

export interface CureStatus {
  status: 'not_started' | 'curing' | 'ready'
  message: string
  color: 'gray' | 'yellow' | 'green'
  percent: number | string
  readyAt?: string
}

// ============ FORMATTERS ============

export function fmt(num: unknown, decimals = 2): string {
  if (num === null || num === undefined || Number.isNaN(Number(num))) return '-'
  return Number(num).toFixed(decimals)
}

export function fmtInt(num: unknown): string {
  if (num === null || num === undefined || Number.isNaN(Number(num))) return '-'
  return Math.round(Number(num)).toString()
}

export function fmtMoney(num: unknown): string {
  if (num === null || num === undefined || Number.isNaN(Number(num))) return '₹0.00'
  return '₹' + Number(num).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function fmtWeight(gm: unknown): string {
  if (gm === null || gm === undefined || Number.isNaN(Number(gm))) return '-'
  const n = Number(gm)
  if (n < 1000) return fmt(n, 2) + ' gm'
  return fmt(n / 1000, 3) + ' kg'
}

export function fmtPercent(pct: unknown): string {
  if (pct === null || pct === undefined || Number.isNaN(Number(pct))) return '-'
  return fmt(pct, 1) + '%'
}

export function fmtDate(isoString: string | null | undefined): string {
  if (!isoString) return '_______________'
  const d = new Date(isoString)
  if (Number.isNaN(d.getTime())) return isoString
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

export function todayISO(): string {
  return new Date().toISOString().split('T')[0]
}

// ============ LAYER HELPERS ============

export function getLayerBS(layer: BoxCalcLayer | null | undefined): number {
  if (!layer || !layer.gsm || !layer.bf) return 0
  return (layer.bf * layer.gsm) / 1000
}

export function getAutoRCT(layer: BoxCalcLayer | null | undefined): number {
  if (!layer || !layer.gsm || !layer.bf) return 0
  return 0.6 * Math.sqrt(layer.gsm * layer.bf)
}

export function getLayerRCT(layer: BoxCalcLayer | null | undefined): number {
  if (!layer) return 0
  if (layer.rctOverride && layer.rctOverride > 0) return parseFloat(String(layer.rctOverride))
  return getAutoRCT(layer)
}

export function getPaperTypesForLayer(
  layerIdx: number,
  layers: BoxCalcLayer[],
): Partial<typeof PAPER_LIBRARY> {
  const layer = layers[layerIdx]
  if (!layer) return {}
  const isFlute = layer.name.toLowerCase().includes('flute')
  if (isFlute) return getPapersForRole('flute')
  if (layerIdx === 0 || layerIdx === layers.length - 1) return getPapersForRole('outerLiner')
  return getPapersForRole('midLiner')
}

export function getPresetsForLayer(layerIdx: number, layers: BoxCalcLayer[]) {
  const layer = layers[layerIdx]
  if (!layer) return []
  const paperData = PAPER_LIBRARY[layer.paperType as keyof typeof PAPER_LIBRARY]
  return paperData?.presets ?? []
}

export function formToMM(form: Pick<BoxCalcForm, 'dimensionUnit' | 'length' | 'width' | 'height'>) {
  const mult = form.dimensionUnit === 'inch' ? 25.4 : 1
  return {
    length: parseFloat(String(form.length)) * mult,
    width: parseFloat(String(form.width)) * mult,
    height: parseFloat(String(form.height)) * mult,
  }
}

export function buildCalcInputs(form: BoxCalcForm) {
  const dimsMM = formToMM(form)
  return {
    length: dimsMM.length,
    width: dimsMM.width,
    height: dimsMM.height,
    dimType: form.dimType,
    ply: form.ply,
    flute: form.flute,
    caliperOverride: form.caliperOverride,
    glueFlap: form.glueFlap,
    layers: form.layers.map((l) => ({
      name: l.name,
      gsm: parseFloat(String(l.gsm)),
      bf: parseFloat(String(l.bf)),
      rate: parseFloat(String(l.rate)),
      takeUp: parseFloat(String(l.takeUp)),
      reelLength: l.reelLength ? parseFloat(String(l.reelLength)) : null,
      rctOverride: l.rctOverride ? parseFloat(String(l.rctOverride)) : null,
    })),
    starchGSM: parseFloat(String(form.starchGSM)),
    starchRate: parseFloat(String(form.starchRate)),
    joining: form.joining,
    quantity: parseInt(String(form.quantity)),
    productionWastePercent: parseFloat(String(form.productionWastePercent)),
    marginPercent: parseFloat(String(form.marginPercent)),
    priceMode: form.priceMode,
    customSellingPrice: form.customSellingPrice,
    customSellingPricePerKg: form.customSellingPricePerKg,
    printingCost: parseFloat(String(form.printingCost)),
    shippingCostPerKg: parseFloat(String(form.shippingCostPerKg ?? (form as { shippingCost?: number }).shippingCost)),
    conversionSlabs: form.conversionSlabs?.length
      ? form.conversionSlabs.map((s) => ({
          label: s.label,
          minWeightGm: parseFloat(String(s.minWeightGm)),
          maxWeightGm: s.maxWeightGm != null ? parseFloat(String(s.maxWeightGm)) : null,
          ratePerKg: parseFloat(String(s.ratePerKg)),
        }))
      : DEFAULT_CONVERSION_SLABS,
    scrapRate: parseFloat(String(form.scrapRate)),
    stackCheck: form.stackCheck.enabled ? {
      enabled: true,
      stackCount: parseInt(String(form.stackCheck.stackCount)),
      contentWeight: parseFloat(String(form.stackCheck.contentWeight)),
    } : null,
    stackingConditions: form.stackingConditions,
  }
}

export function computeBoxCalcResults(form: BoxCalcForm, sheetSettings?: BoxSheetSettings | null) {
  if (!form.layers.length) return null
  const dimsMM = formToMM(form)
  if (!dimsMM.length || !dimsMM.width || !dimsMM.height) return null
  const res = runCalculator({
    ...buildCalcInputs(form),
    sheetSettings: sheetSettings ?? loadBoxSheetSettings(),
  })
  if (res.error) return { error: res.error } as const
  return res
}

/** Flat corrugated sheet: area × layer GSM (with flute take-up) + starch. */
export function computePlainSheetWeight(form: BoxCalcForm) {
  const dimsMM = formToMM(form)
  const lengthMm = dimsMM.length
  const widthMm = dimsMM.width
  if (!lengthMm || !widthMm || lengthMm <= 0 || widthMm <= 0) {
    return { error: 'Sheet length aur width positive hona chahiye' } as const
  }

  const areaM2 = (lengthMm * widthMm) / 1_000_000
  const layerWeights = form.layers.map((l) => {
    const gsm = parseFloat(String(l.gsm)) || 0
    const takeUp = parseFloat(String(l.takeUp)) || 1
    const rate = parseFloat(String(l.rate)) || 0
    const weightGm = areaM2 * gsm * takeUp
    return { name: l.name, gsm, bf: parseFloat(String(l.bf)) || 0, takeUp, weightGm, rate }
  })

  const paperGm = layerWeights.reduce((sum, l) => sum + l.weightGm, 0)
  const starchGsm = parseFloat(String(form.starchGSM)) || 7
  const starchGm = areaM2 * starchGsm * Math.max(0, form.layers.length - 1)
  const totalGm = paperGm + starchGm
  const boardGSM = areaM2 > 0 ? totalGm / areaM2 : 0

  let bsWeighted = 0
  let bfWeighted = 0
  let gsmForBf = 0
  for (const l of form.layers) {
    const gsm = parseFloat(String(l.gsm)) || 0
    const takeUp = parseFloat(String(l.takeUp)) || 1
    const effectiveGsm = gsm * takeUp
    bsWeighted += getLayerBS(l) * effectiveGsm
    bfWeighted += (parseFloat(String(l.bf)) || 0) * effectiveGsm
    gsmForBf += effectiveGsm
  }
  const combinedBS = gsmForBf > 0 ? bsWeighted / gsmForBf : 0
  const combinedBF = gsmForBf > 0 ? bfWeighted / gsmForBf : 0

  const paperCost = layerWeights.reduce((sum, l) => sum + (l.weightGm / 1000) * l.rate, 0)
  const starchCost = (starchGm / 1000) * (parseFloat(String(form.starchRate)) || 45)
  const materialCost = paperCost + starchCost
  const totalKg = totalGm / 1000

  return {
    success: true,
    calcMode: 'plainSheet' as const,
    sheet: { lengthMm, widthMm, areaM2 },
    weight: {
      boardGSM,
      paperGm,
      starchGm,
      totalGm,
      totalKg,
      sheetWeight: totalGm,
      layerWeights,
    },
    strength: { combinedBS, combinedBF },
    cost: {
      paperCost,
      starchCost,
      materialCost,
      sheetRatePerKg: totalKg > 0 ? materialCost / totalKg : 0,
    },
  }
}

export function joiningMethodLabel(method: BoxCalcForm['joining']['method']): string {
  if (method === 'fevicol') return 'Fevicol'
  if (method === 'both') return 'Staple + Fevicol'
  return 'Staple'
}

export function defaultConversionSlabs(): ConversionSlab[] {
  return DEFAULT_CONVERSION_SLABS.map((s) => ({ ...s }))
}

export function paperTypeLabel(paperType: string): string {
  const paper = PAPER_LIBRARY[paperType as keyof typeof PAPER_LIBRARY]
  return paper?.name ?? paperType
}

export function getCurrentCaliper(form: Pick<BoxCalcForm, 'caliperOverride' | 'ply' | 'flute'>): number {
  if (form.caliperOverride) return form.caliperOverride
  return getCaliper(form.ply, form.flute) || 4.0
}

export function unitLabel(unit: 'mm' | 'inch'): string {
  return unit === 'inch' ? 'in' : 'mm'
}

export function displayDim(mmValue: number | null | undefined, dimensionUnit: 'mm' | 'inch'): string {
  if (mmValue === null || mmValue === undefined) return '-'
  if (dimensionUnit === 'inch') return (mmValue / 25.4).toFixed(2)
  return Math.round(mmValue).toString()
}

export function setDimensionUnit(form: BoxCalcForm, newUnit: 'mm' | 'inch'): void {
  if (newUnit === form.dimensionUnit) return
  if (newUnit === 'inch') {
    form.length = Math.round((form.length / 25.4) * 100) / 100
    form.width = Math.round((form.width / 25.4) * 100) / 100
    form.height = Math.round((form.height / 25.4) * 100) / 100
  } else {
    form.length = Math.round(form.length * 25.4)
    form.width = Math.round(form.width * 25.4)
    form.height = Math.round(form.height * 25.4)
  }
  form.dimensionUnit = newUnit
}

export function getStrengthRating(util: number) {
  if (util < 50) return { stars: 5, text: 'EXCELLENT', color: 'text-green-600' }
  if (util < 70) return { stars: 4, text: 'GOOD', color: 'text-green-500' }
  if (util < 90) return { stars: 3, text: 'MARGINAL', color: 'text-yellow-500' }
  if (util <= 100) return { stars: 2, text: 'BORDERLINE', color: 'text-orange-500' }
  return { stars: 1, text: 'FAIL', color: 'text-red-600' }
}

// ============ JOB CARD HELPERS ============

export function generateJobNumber(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const xx = String(Math.floor(Math.random() * 90) + 10)
  return `${yyyy}-${mm}${dd}-${xx}`
}

export function getCureStatus(jobCard: BoxCalcJobCard | undefined): CureStatus {
  const jc = jobCard
  if (!jc?.pastingTime) {
    return { status: 'not_started', message: 'पेस्टिंग अभी शुरू नहीं', color: 'gray', percent: 0 }
  }
  const pasted = new Date(jc.pastingTime)
  const cureMs = (jc.cureDurationHours || 24) * 3600 * 1000
  const ready = new Date(pasted.getTime() + cureMs)
  const now = new Date()
  const elapsed = now.getTime() - pasted.getTime()
  const percent = Math.min(100, (elapsed / cureMs) * 100)

  if (now >= ready) {
    return {
      status: 'ready',
      message: '✅ Cure पूरा — Next stage के लिए तैयार',
      color: 'green',
      percent: 100,
      readyAt: ready.toLocaleString('en-IN'),
    }
  }
  const remainHr = Math.ceil((ready.getTime() - now.getTime()) / 3600000)
  return {
    status: 'curing',
    message: `🟡 Cure में... ${remainHr} घंटे बाकी`,
    color: 'yellow',
    percent: percent.toFixed(0),
    readyAt: ready.toLocaleString('en-IN'),
  }
}

export function getTotalBundles(quantity: number, bundleSize: number): number {
  const qty = parseInt(String(quantity)) || 0
  const bs = parseInt(String(bundleSize)) || 25
  return Math.ceil(qty / bs)
}

export function getTwoPlyCount(ply: string): number {
  const plyMap: Record<string, number> = { '3-ply': 1, '5-ply': 2, '7-ply': 3 }
  return plyMap[ply] || 1
}

export function defaultJobCard(companyName = 'My Box Plant'): BoxCalcJobCard {
  return {
    jobNumber: '',
    companyName,
    customerContact: '',
    customerPhone: '',
    customerAddress: '',
    orderDate: '',
    deliveryDate: '',
    priority: 'सामान्य',
    bundleSize: 25,
    pastingTime: '',
    cureDurationHours: 24,
    materialLoss: {
      corrugatorSetupKg: 0,
      corrugatorTrimKg: 0,
      corrugatorRejectKg: 0,
      sheetCutterRejectNos: 0,
      sheetCutterReason: '',
      pastingRejectNos: 0,
      pastingRejectReason: '',
      slitterTrimKg: 0,
      slitterRejectNos: 0,
      printerRejectNos: 0,
      slotterRejectNos: 0,
      stitchingRejectNos: 0,
      bundlingRejectNos: 0,
    },
    operators: {
      paperIssue: '',
      corrugator: '',
      sheetCutter: '',
      pasting: '',
      slitterScorer: '',
      printerSlotter: '',
      stitching: '',
      bundling: '',
      dispatch: '',
    },
    supervisor: '',
    notes: '',
  }
}

// ============ WHATSAPP / VENDOR PHONES ============

const VENDOR_PHONES_KEY = 'boxapp_vendor_phones'
const BOX_NAMES_KEY = 'boxapp_box_names'

export function loadRecentVendorPhones(): VendorPhone[] {
  try {
    const stored = localStorage.getItem(VENDOR_PHONES_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      return Array.isArray(parsed) ? parsed : []
    }
  } catch { /* */ }
  return []
}

export function saveVendorPhone(phones: VendorPhone[], phone: string, name = ''): VendorPhone[] {
  if (!phone) return phones
  const normalized = normalizePhone(phone)
  if (!normalized) return phones

  const list = [...phones]
  const existing = list.find((v) => v.phone === normalized)
  if (existing) {
    existing.useCount = (existing.useCount || 0) + 1
    existing.lastUsed = new Date().toISOString()
    if (name && !existing.name) existing.name = name
  } else {
    list.push({
      name: name || '',
      phone: normalized,
      displayPhone: phone,
      useCount: 1,
      lastUsed: new Date().toISOString(),
    })
  }
  list.sort((a, b) => (b.useCount || 0) - (a.useCount || 0))
  const trimmed = list.slice(0, 20)
  try {
    localStorage.setItem(VENDOR_PHONES_KEY, JSON.stringify(trimmed))
  } catch { /* */ }
  return trimmed
}

export function normalizePhone(phone: string): string {
  if (!phone) return ''
  let digits = String(phone).replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('0')) digits = digits.substring(1)
  if (digits.length === 10) digits = '91' + digits
  return digits
}

export function generateReelOrderMessage(form: BoxCalcForm, results: any): string {
  if (!results) return ''
  const today = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })

  const grouped: Record<string, {
    gsm: number
    bf: number
    color: string
    reelsToOrder: number
    layerNames: string[]
  }> = {}
  const groupOrder: string[] = []

  results.reelOrders.forEach((order: any, idx: number) => {
    const layer = form.layers[idx]
    const color = (layer && layer.color) || 'Natural Brown'
    const key = `${order.gsm}_${order.bf}_${color}`
    if (!grouped[key]) {
      grouped[key] = {
        gsm: order.gsm,
        bf: order.bf,
        color,
        reelsToOrder: 0,
        layerNames: [],
      }
      groupOrder.push(key)
    }
    grouped[key].reelsToOrder += order.reelsToOrder
    grouped[key].layerNames.push(order.name)
  })

  const groups = groupOrder.map((k) => grouped[k])
  const deckleMM = results.reel.reelWidthMM

  let msg = '🏭 *PAPER REEL ORDER*\n'
  msg += '━━━━━━━━━━━━━━━━━━━\n'
  msg += `📅 ${today}\n`
  msg += '━━━━━━━━━━━━━━━━━━━\n\n'
  msg += '*Reels Required:*\n\n'

  groups.forEach((g, i) => {
    msg += `*${i + 1})* GSM ${g.gsm}, BF ${g.bf}, ${g.color}\n`
    msg += `   *Reels: ${g.reelsToOrder}, size ${deckleMM} mm*\n\n`
  })

  const totalReels = groups.reduce((s, g) => s + g.reelsToOrder, 0)
  msg += '━━━━━━━━━━━━━━━━━━━\n'
  msg += `*TOTAL: ${totalReels} reel${totalReels > 1 ? 's' : ''}*\n`
  msg += '━━━━━━━━━━━━━━━━━━━\n\n'
  msg += '📱 _Sent from BoxCalc Pro_'
  return msg
}

// ============ BOX NAME AUTOCOMPLETE ============

export function loadSavedBoxNames(recipeBoxNames: string[] = []): string[] {
  const names = new Set<string>()
  recipeBoxNames.forEach((n) => {
    if (n?.trim()) names.add(n.trim())
  })
  try {
    const stored = localStorage.getItem(BOX_NAMES_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) parsed.forEach((n: string) => names.add(n))
    }
  } catch { /* */ }
  return Array.from(names).sort()
}

export function saveBoxName(name: string): void {
  if (!name?.trim()) return
  const existing = loadSavedBoxNames()
  if (!existing.includes(name.trim())) {
    existing.push(name.trim())
    try {
      localStorage.setItem(BOX_NAMES_KEY, JSON.stringify(existing))
    } catch { /* */ }
  }
}

// ============ SHEET DIAGRAM SVG ============

export function getSheetDiagramSVG(results: any): string {
  const r = results
  if (!r || !r.sheet || !r.machineSetup || !r.sheet.length || !r.sheet.width) {
    return `<div class="text-center py-8 text-slate-400 text-sm">
              <div class="text-4xl mb-2">📋</div>
              <p>Calculate karne ke baad diagram dikhega</p>
            </div>`
  }

  const sheetL = r.sheet.length
  const sheetW = r.sheet.width
  const clearance = r.sheet?.clearanceMM ?? 6
  const W1 = r.machineSetup.creases.topCrease
  const W2 = r.machineSetup.creases.bottomCrease
  const slots = r.machineSetup.slots.slots || []
  const panels = r.machineSetup.slots.panels || []

  const drawX = 60, drawY = 40, drawW = 700, drawH = 320
  const scaleX = drawW / sheetL
  const scaleY = drawH / sheetW
  const w1Y = drawY + W1 * scaleY
  const w2Y = drawY + W2 * scaleY

  let inner = ''
  inner += `<rect x="0" y="0" width="800" height="420" fill="#fefce8"/>`
  inner += `<rect x="${drawX}" y="${drawY}" width="${drawW}" height="${drawH}" fill="#fef3c7" stroke="#d97706" stroke-width="1.5"/>`
  inner += `<rect x="${drawX}" y="${drawY}" width="${drawW}" height="${W1 * scaleY}" fill="#fde68a" opacity="0.6"/>`
  inner += `<rect x="${drawX}" y="${w1Y}" width="${drawW}" height="${(W2 - W1) * scaleY}" fill="#dbeafe" opacity="0.5"/>`
  inner += `<rect x="${drawX}" y="${w2Y}" width="${drawW}" height="${drawH - W2 * scaleY}" fill="#fde68a" opacity="0.6"/>`

  const lastPanel = panels[panels.length - 1]
  if (lastPanel?.name?.includes('Glue')) {
    inner += `<rect x="${drawX + lastPanel.start * scaleX}" y="${drawY}" width="${lastPanel.width * scaleX}" height="${drawH}" fill="#fbbf24" opacity="0.3"/>`
  }

  inner += `<line x1="${drawX}" y1="${w1Y}" x2="${drawX + drawW}" y2="${w1Y}" stroke="#2563eb" stroke-width="1.5" stroke-dasharray="6 3"/>`
  inner += `<line x1="${drawX}" y1="${w2Y}" x2="${drawX + drawW}" y2="${w2Y}" stroke="#2563eb" stroke-width="1.5" stroke-dasharray="6 3"/>`

  slots.forEach((slot: number) => {
    const x = drawX + slot * scaleX
    inner += `<line x1="${x}" y1="${drawY}" x2="${x}" y2="${w1Y}" stroke="#1e40af" stroke-width="2.5"/>`
    inner += `<line x1="${x}" y1="${w2Y}" x2="${x}" y2="${drawY + drawH}" stroke="#1e40af" stroke-width="2.5"/>`
    inner += `<line x1="${x}" y1="${w1Y}" x2="${x}" y2="${w2Y}" stroke="#2563eb" stroke-width="1.5" stroke-dasharray="6 3"/>`
    inner += `<text x="${x}" y="${drawY - 10}" font-size="11" fill="#1e40af" text-anchor="middle" font-weight="bold" font-family="monospace">${Math.round(slot)}</text>`
  })

  panels.forEach((panel: { name?: string; start: number; width: number }) => {
    if (!panel?.name) return
    const cx = drawX + (panel.start + panel.width / 2) * scaleX
    const cy = drawY + (W1 + (W2 - W1) / 2) * scaleY
    const label = panel.name.split(' ')[0]
    inner += `<text x="${cx}" y="${cy - 2}" font-size="13" fill="#0f172a" text-anchor="middle" font-weight="bold" font-family="sans-serif">${label}</text>`
    inner += `<text x="${cx}" y="${cy + 14}" font-size="10" fill="#475569" text-anchor="middle" font-family="monospace">${Math.round(panel.width)}mm</text>`
  })

  inner += `<text x="${drawX - 8}" y="${w1Y + 4}" font-size="10" fill="#1d4ed8" text-anchor="end" font-weight="bold" font-family="monospace">W1: ${Math.round(W1)}</text>`
  inner += `<text x="${drawX - 8}" y="${w2Y + 4}" font-size="10" fill="#1d4ed8" text-anchor="end" font-weight="bold" font-family="monospace">W2: ${Math.round(W2)}</text>`
  inner += `<text x="${drawX + drawW + 8}" y="${drawY + (W1 * scaleY) / 2 + 4}" font-size="9" fill="#92400e" text-anchor="start" font-family="monospace">Top Flap ${Math.round(W1)}</text>`
  inner += `<text x="${drawX + drawW + 8}" y="${w2Y + (drawH - W2 * scaleY) / 2 + 4}" font-size="9" fill="#92400e" text-anchor="start" font-family="monospace">Bot Flap ${Math.round(sheetW - W2 - clearance)}</text>`

  if (lastPanel?.name?.includes('Glue')) {
    const cx = drawX + (lastPanel.start + lastPanel.width / 2) * scaleX
    inner += `<text x="${cx}" y="${drawY + drawH / 2 + 32}" font-size="9" fill="#92400e" text-anchor="middle" font-style="italic" font-family="sans-serif">Glue Flap</text>`
  }

  inner += `<text x="${drawX + drawW / 2}" y="${drawY + drawH + 30}" font-size="12" fill="#0f172a" text-anchor="middle" font-weight="bold" font-family="monospace">↔ Length: ${Math.round(sheetL)} mm</text>`
  inner += `<text x="20" y="${drawY + drawH / 2}" font-size="12" fill="#0f172a" text-anchor="middle" font-weight="bold" font-family="monospace" transform="rotate(-90, 20, ${drawY + drawH / 2})">↕ Width: ${Math.round(sheetW)} mm</text>`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 420" class="w-full max-w-3xl mx-auto border border-slate-200 rounded">${inner}</svg>`
}
