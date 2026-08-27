import { db } from '@/data/db'
import { uid, nowISO } from '@/data/util'
import type {
  PaperType,
  ProductionJob,
  ProductionStageEntry,
  ProductionStockType,
  Purchase,
  ReelStock,
  StockMovement,
  ConsumableLot,
} from '@/types/models'

const plain = <X>(o: X): X => JSON.parse(JSON.stringify(o))

export function normalizePaperType(value: unknown): PaperType {
  return String(value || '').trim().toUpperCase() === 'DUPLEX' ? 'DUPLEX' : 'KRAFT'
}

/** Canonical reel colour. NS (Natural Shade) and the legacy NATURAL_BROWN are
 *  the same physical shade, so both — plus any natural/neutral/brown wording or
 *  a blank colour — collapse to 'NS'. Golden Yellow variants collapse to 'GY'.
 *  Used for grouping/filtering so the same shade never splits into two rows. */
export function normalizeReelColor(value: unknown): string {
  const key = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  if (!key) return 'NS'
  if (key === 'GY' || (key.includes('GOLDEN') && key.includes('YELLOW'))) return 'GY'
  if (key === 'NS' || key.includes('NATURAL') || key.includes('NEUTRAL') || key.includes('BROWN')) return 'NS'
  return key
}

export function reelColorLabel(value: unknown): string {
  const code = normalizeReelColor(value)
  if (code === 'NS') return 'NS — Natural Shade / Brown'
  if (code === 'GY') return 'Golden Yellow'
  return code
}

export const STAGE_LABELS: Record<ProductionStageEntry['stage'], string> = {
  corrugation: 'Corrugation',
  paper_cutting: 'Paper Cutting',
  pasting: 'Pasting',
  thin_blade: 'Thin Blade / Trimming',
  printer_slotter: 'Printer Slotter',
  stitching: 'Stitching',
  dispatch: 'Dispatch',
}

export const STOCK_LABELS: Record<ProductionStockType, string> = {
  raw_reel: 'Raw Reel',
  '2ply': '2 Ply Sheet',
  cut_sheet: 'Cut Sheet',
  pasted_sheet: 'Pasted Sheet',
  trimmed_sheet: 'Trimmed Sheet',
  printed_sheet: 'Printed / Slotted Sheet',
  finished_box: 'Finished Box',
  glue: 'Gum',
  ink: 'Ink',
  stitching_wire: 'Stitching Wire',
  strapping_roll: 'Strapping Roll',
  waste: 'Waste',
}

export function newStockMovement(data: Omit<StockMovement, 'id' | 'created_at' | 'updated_at' | 'is_deleted' | '_dirty'>): StockMovement {
  const now = nowISO()
  return plain({ ...data, id: uid(), created_at: now, updated_at: now, is_deleted: false, _dirty: true })
}

const CONSUMABLE_STOCK_TYPES = new Set<ProductionStockType>(['glue', 'ink', 'stitching_wire', 'strapping_roll'])

export const CONSUMABLE_TYPES = ['glue', 'ink', 'stitching_wire', 'strapping_roll'] as const

export interface PurchaseReelSpec {
  reel_no: string
  paper_type: PaperType
  deckle_size: string
  gsm: string
  bf: string
  color: string
  opening_weight: number
  rate: number
  note: string
  remark?: string
}

function roundWeight(value: number | undefined | null) {
  return Math.round((Number(value) || 0) * 1000) / 1000
}

function reelKey(reelNo: string) {
  return reelNo.trim().toLowerCase()
}

/** Config fingerprint for batch feed (same deckle/GSM/BF/color/type). */
export function reelConfigKey(reel: Pick<ReelStock, 'paper_type' | 'deckle_size' | 'gsm' | 'bf' | 'color'>): string {
  return [
    normalizePaperType(reel.paper_type),
    String(reel.deckle_size || '').trim(),
    String(reel.gsm || '').trim(),
    String(reel.bf || '').trim(),
    normalizeReelColor(reel.color),
  ].join('|')
}

/** Active reels matching selected reel’s paper config (for one-shot batch feed). */
export function findSameConfigActiveReels(
  reels: ReelStock[],
  selected: Pick<ReelStock, 'paper_type' | 'deckle_size' | 'gsm' | 'bf' | 'color' | 'firm_id'>,
  opts?: { firmId?: string },
): ReelStock[] {
  const key = reelConfigKey(selected)
  const firmId = opts?.firmId || selected.firm_id
  return reels
    .filter((reel) =>
      !reel.is_deleted &&
      reel.status === 'active' &&
      (Number(reel.current_weight) || 0) > 0 &&
      (!firmId || reel.firm_id === firmId) &&
      reelConfigKey(reel) === key,
    )
    .sort((a, b) => a.reel_no.localeCompare(b.reel_no))
}

/**
 * Generate N reel numbers from a base (e.g. R-101 → R-101, R-102…).
 * Trailing digits auto-increment with zero-padding; otherwise base, base-2, base-3…
 */
export function generateCopyReelNumbers(baseReelNo: string, count: number): string[] {
  const base = String(baseReelNo || '').trim()
  const n = Math.max(1, Math.floor(Number(count) || 1))
  if (!base) throw new Error('Custom reel number required')
  if (n === 1) return [base]
  if (n > 50) throw new Error('Ek baar me max 50 reels add kar sakte ho')

  const match = base.match(/^(.*?)(\d+)$/)
  let nos: string[]
  if (match) {
    const prefix = match[1]
    const startNum = Number(match[2])
    const width = match[2].length
    nos = Array.from({ length: n }, (_, i) => `${prefix}${String(startNum + i).padStart(width, '0')}`)
  } else {
    nos = Array.from({ length: n }, (_, i) => (i === 0 ? base : `${base}-${i + 1}`))
  }

  const seen = new Set<string>()
  for (const no of nos) {
    const key = reelKey(no)
    if (seen.has(key)) throw new Error(`Duplicate generated reel number: ${no}`)
    seen.add(key)
  }
  return nos
}

export type ReelIntakeCondition = 'fresh' | 'partial'

export const REEL_CORE_DIA_MM = 76
const MM_PER_INCH = 25.4

function roundDec(n: number, places: number): number {
  const f = 10 ** places
  return Math.round((Number(n) || 0) * f) / f
}

export function formatDeckleDisplay(deckleMm: number, deckleInch: number): string {
  const mm = roundDec(deckleMm, 1)
  const inch = roundDec(deckleInch, 3)
  if (mm <= 0 && inch <= 0) return ''
  if (mm <= 0) return `${inch} in`
  if (inch <= 0) return `${mm} mm`
  return `${inch} in / ${mm} mm`
}

/** Enter mm → derive inch + display string. */
export function deckleFromMm(mm: number): { deckle_mm: number; deckle_inch: number; deckle_size: string } {
  const deckle_mm = roundDec(mm, 1)
  const deckle_inch = roundDec(deckle_mm / MM_PER_INCH, 3)
  return { deckle_mm, deckle_inch, deckle_size: formatDeckleDisplay(deckle_mm, deckle_inch) }
}

/** Enter inch → derive mm + display string. */
export function deckleFromInch(inch: number): { deckle_mm: number; deckle_inch: number; deckle_size: string } {
  const deckle_inch = roundDec(inch, 3)
  const deckle_mm = roundDec(deckle_inch * MM_PER_INCH, 1)
  return { deckle_mm, deckle_inch, deckle_size: formatDeckleDisplay(deckle_mm, deckle_inch) }
}

/** Resolve deckle from whichever unit is provided (mm preferred if both). */
export function resolveDecklePair(input: {
  deckle_mm?: number | null
  deckle_inch?: number | null
  deckle_size?: string | null
}): { deckle_mm: number; deckle_inch: number; deckle_size: string } {
  const mm = Number(input.deckle_mm)
  const inch = Number(input.deckle_inch)
  if (Number.isFinite(mm) && mm > 0) return deckleFromMm(mm)
  if (Number.isFinite(inch) && inch > 0) return deckleFromInch(inch)
  const raw = String(input.deckle_size || '').trim()
  const asNum = Number(raw.replace(/[^\d.]/g, ''))
  if (Number.isFinite(asNum) && asNum > 0) {
    // Heuristic: values >= 100 treated as mm (typical deckle 900–1800 mm).
    return asNum >= 100 ? deckleFromMm(asNum) : deckleFromInch(asNum)
  }
  return { deckle_mm: 0, deckle_inch: 0, deckle_size: raw }
}

/**
 * Estimate remaining reel weight from outer diameter, deckle width, and GSM.
 * weightKg = π/4 × (OD² − core²) × widthMm × GSM / 1e9
 */
export function estimateReelWeightKg(opts: {
  deckleMm: number
  diaMm: number
  gsm: number | string
  coreMm?: number
}): number {
  const widthMm = Number(opts.deckleMm) || 0
  const od = Number(opts.diaMm) || 0
  const core = Number(opts.coreMm) > 0 ? Number(opts.coreMm) : REEL_CORE_DIA_MM
  const gsm = Number(opts.gsm) || 0
  if (widthMm <= 0) throw new Error('Deckle (mm) required for dia→weight')
  if (od <= 0) throw new Error('Reel dia required')
  if (od <= core) throw new Error('Outer dia core se badi honi chahiye')
  if (gsm <= 0) throw new Error('GSM required for dia→weight')
  const weight = (Math.PI / 4) * (od * od - core * core) * widthMm * gsm / 1e9
  return roundWeight(weight)
}

export function purchaseHasReelLines(purchase: Pick<Purchase, 'items'>): boolean {
  return (purchase.items || []).some((row) => row.is_kraft_reel)
}

/** Proposed reel rows from a purchase bill (editable before confirming into stock). */
export function proposePurchaseReelSpecs(purchase: Purchase): PurchaseReelSpec[] {
  return purchaseReelSpecs(purchase)
}

function purchaseReelSpecs(purchase: Purchase): PurchaseReelSpec[] {
  const specs: PurchaseReelSpec[] = []
  let autoSeq = 1

  for (const row of purchase.items) {
    if (!row.is_kraft_reel) continue
    const reelCount = Math.max(1, Math.floor(Number(row.reel_count) || 1))
    const totalWeight = Number(row.reel_weight || row.qty || 0)
    // P0 stores one line-level reel weight; split it evenly until per-reel weights exist.
    const perReelWeight = reelCount > 0 ? roundWeight(totalWeight / reelCount) : roundWeight(totalWeight)
    const manualBase = (row.reel_no || '').trim()

    for (let reelIdx = 0; reelIdx < reelCount; reelIdx++) {
      const autoNo = `${purchase.bill_no}-R${String(autoSeq).padStart(2, '0')}`
      const reelNo = manualBase
        ? (reelCount === 1 ? manualBase : `${manualBase}-R${String(reelIdx + 1).padStart(2, '0')}`)
        : autoNo
      autoSeq++

      if (!reelKey(reelNo)) continue
      const paperType = normalizePaperType(row.paper_type)
      specs.push({
        reel_no: reelNo,
        paper_type: paperType,
        deckle_size: row.deckle_size || '',
        gsm: row.gsm || '',
        bf: row.bf || '',
        color: normalizeReelColor(row.color),
        opening_weight: perReelWeight,
        rate: Number(row.rate) || 0,
        note: `${paperType} reel ${reelNo} from purchase ${purchase.bill_no}${reelCount > 1 ? ` (${reelIdx + 1}/${reelCount}, split from ${totalWeight} KG line weight)` : ''}`,
      })
    }
  }

  return specs
}

export function purchaseReelStockChanged(before: Purchase, after: Purchase) {
  const signature = (purchase: Purchase) => JSON.stringify(purchaseReelSpecs(purchase).map((spec) => ({
    reel_no: spec.reel_no,
    paper_type: spec.paper_type,
    deckle_size: spec.deckle_size,
    gsm: spec.gsm,
    bf: spec.bf,
    color: spec.color,
    opening_weight: spec.opening_weight,
    rate: spec.rate,
  })))
  return signature(before) !== signature(after)
}

export async function getPurchaseReelConsumptionHistory(purchaseId: string) {
  const reels = await db.reel_stocks.where('purchase_id').equals(purchaseId).toArray().catch(() => [])
  const reelIds = new Set(reels.map((r) => r.id))
  if (reelIds.size === 0) return []

  return db.stock_movements
    .filter((movement) =>
      !movement.is_deleted &&
      movement.source !== 'purchase' &&
      !!movement.stock_ref_id &&
      reelIds.has(movement.stock_ref_id),
    )
    .toArray()
}

export async function assertPurchaseReelsHaveNoConsumptionHistory(purchaseId: string, action: 'update' | 'delete') {
  const history = await getPurchaseReelConsumptionHistory(purchaseId)
  if (history.length === 0) return
  const verb = action === 'delete' ? 'delete this purchase' : 'edit these paper reel lines'
  throw new Error(`Cannot ${verb}: one or more reels from this purchase already have production/consumption history. Adjust the reel usage first, or make a non-stock purchase edit.`)
}

export async function assertUniqueReelNo(firmId: string, reelNo: string, excludeId?: string) {
  const key = reelKey(reelNo)
  if (!key) throw new Error('Custom reel number required')
  const clash = await db.reel_stocks
    .where('firm_id')
    .equals(firmId)
    .filter((reel) => !reel.is_deleted && reel.id !== excludeId && reelKey(reel.reel_no) === key)
    .first()
  if (clash) throw new Error(`Reel number "${reelNo.trim()}" already exists in stock`)
}

export async function assertUniqueReelNosForPurchase(
  firmId: string,
  specs: Pick<PurchaseReelSpec, 'reel_no'>[],
  purchaseId?: string,
) {
  const seen = new Set<string>()
  for (const spec of specs) {
    const key = reelKey(spec.reel_no)
    if (!key) throw new Error('Har reel ka custom reel number required hai')
    if (seen.has(key)) throw new Error(`Duplicate reel number in list: ${spec.reel_no.trim()}`)
    seen.add(key)
  }

  const existing = await db.reel_stocks
    .where('firm_id')
    .equals(firmId)
    .filter((reel) => !reel.is_deleted && (!purchaseId || reel.purchase_id !== purchaseId))
    .toArray()
  const taken = new Set(existing.map((reel) => reelKey(reel.reel_no)))
  for (const spec of specs) {
    const key = reelKey(spec.reel_no)
    if (taken.has(key)) throw new Error(`Reel number "${spec.reel_no.trim()}" already exists in stock`)
  }
}

function normalizeConfirmedSpecs(specs: PurchaseReelSpec[]): PurchaseReelSpec[] {
  return specs.map((spec, idx) => {
    const reel_no = String(spec.reel_no || '').trim()
    const opening_weight = roundWeight(spec.opening_weight)
    const paper_type = normalizePaperType(spec.paper_type)
    return {
      reel_no,
      paper_type,
      deckle_size: String(spec.deckle_size || '').trim(),
      gsm: String(spec.gsm || '').trim(),
      bf: String(spec.bf || '').trim(),
      color: normalizeReelColor(spec.color),
      opening_weight,
      rate: Number(spec.rate) || 0,
      note: spec.note || `${paper_type} reel ${reel_no || `#${idx + 1}`}`,
      remark: String(spec.remark || '').trim() || undefined,
    }
  }).filter((spec) => reelKey(spec.reel_no))
}

export async function createManualReel(data: {
  firm_id: string
  reel_no?: string
  paper_type?: PaperType
  deckle_size?: string
  deckle_mm?: number
  deckle_inch?: number
  gsm: string
  bf: string
  color: string
  opening_weight?: number
  rate?: number
  supplier_name: string
  supplier_id?: string | null
  date?: string
  copies?: number
  intake_condition?: ReelIntakeCondition
  lines?: Array<{ reel_no: string; opening_weight: number }>
}) {
  const created = await createManualReels(data)
  return created[0]
}

/** Create one or more reels — either `lines` (per reel no + opening KG) or legacy copies. */
export async function createManualReels(data: {
  firm_id: string
  paper_type?: PaperType
  deckle_size?: string
  deckle_mm?: number
  deckle_inch?: number
  gsm: string
  bf: string
  color: string
  supplier_name: string
  supplier_id?: string | null
  date?: string
  rate?: number
  intake_condition?: ReelIntakeCondition
  remark?: string
  /** Legacy: base reel no + copies + shared opening_weight */
  reel_no?: string
  opening_weight?: number
  copies?: number
  /** Preferred: explicit rows */
  lines?: Array<{ reel_no: string; opening_weight: number }>
}) {
  if (!String(data.gsm || '').trim()) throw new Error('GSM required')
  if (!String(data.bf || '').trim()) throw new Error('BF required')
  if (!String(data.supplier_name || '').trim()) throw new Error('Paper mill required')

  const deckle = resolveDecklePair({
    deckle_mm: data.deckle_mm,
    deckle_inch: data.deckle_inch,
    deckle_size: data.deckle_size,
  })
  if (deckle.deckle_mm <= 0 && !deckle.deckle_size) throw new Error('Deckle / size required')

  let lines: Array<{ reel_no: string; opening_weight: number }>
  if (data.lines && data.lines.length) {
    if (data.lines.length > 50) throw new Error('Ek baar me max 50 reels add kar sakte ho')
    lines = data.lines.map((l) => ({
      reel_no: String(l.reel_no || '').trim(),
      opening_weight: roundWeight(l.opening_weight),
    }))
    for (const line of lines) {
      if (!line.reel_no) throw new Error('Har row me reel number required')
      if (line.opening_weight <= 0) throw new Error(`Reel ${line.reel_no}: Opening KG 0 se zyada hona chahiye`)
    }
  } else {
    const opening_weight = roundWeight(data.opening_weight)
    if (opening_weight <= 0) throw new Error('Reel weight 0 se zyada hona chahiye')
    if (!String(data.reel_no || '').trim()) throw new Error('Custom reel number required')
    const reelNos = generateCopyReelNumbers(String(data.reel_no).trim(), data.copies ?? 1)
    lines = reelNos.map((reel_no) => ({ reel_no, opening_weight }))
  }

  await assertUniqueReelNosForPurchase(data.firm_id, lines.map((l) => ({ reel_no: l.reel_no })))

  const now = nowISO()
  const paper_type = normalizePaperType(data.paper_type)
  const color = normalizeReelColor(data.color)
  const mill = String(data.supplier_name || '').trim()
  const date = data.date || now.slice(0, 10)
  const intake_condition: ReelIntakeCondition = data.intake_condition === 'partial' ? 'partial' : 'fresh'
  const remark = String(data.remark || '').trim()
  const created: ReelStock[] = []

  await db.transaction('rw', db.reel_stocks, db.stock_movements, async () => {
    for (const line of lines) {
      const opening_weight = line.opening_weight
      const reel = plain({
        id: uid(),
        firm_id: data.firm_id,
        reel_no: line.reel_no,
        paper_type,
        supplier_id: data.supplier_id ?? null,
        supplier_name: mill,
        deckle_size: deckle.deckle_size || String(data.deckle_size || '').trim(),
        deckle_mm: deckle.deckle_mm || undefined,
        deckle_inch: deckle.deckle_inch || undefined,
        gsm: String(data.gsm || '').trim(),
        bf: String(data.bf || '').trim(),
        color,
        opening_weight,
        current_weight: opening_weight,
        rate: Number(data.rate) || 0,
        status: 'active' as const,
        intake_condition,
        remark: remark || undefined,
        created_at: now,
        updated_at: now,
        is_deleted: false,
        _dirty: true,
      }) as ReelStock

      const movement = newStockMovement({
        firm_id: data.firm_id,
        date,
        source: 'adjustment',
        ref_id: reel.id,
        stock_type: 'raw_reel',
        stock_ref_id: reel.id,
        qty_in: 1,
        qty_out: 0,
        weight_in: opening_weight,
        weight_out: 0,
        waste_qty: 0,
        waste_weight: 0,
        notes: remark
          ? `Manual reel opening — ${line.reel_no} (${mill}, ${intake_condition}) · ${remark}`
          : `Manual reel opening — ${line.reel_no} (${mill}, ${intake_condition})`,
      })

      await db.reel_stocks.add(reel)
      await db.stock_movements.add(movement)
      created.push(reel)
    }
  })

  return created
}

export async function feedPaperReel(data: {
  firm_id: string
  reel_id: string
  date: string
  mode: 'full' | 'partial'
  used_weight?: number
  job_id?: string
  reason?: string
  notes?: string
}) {
  if (!data.reel_id) throw new Error('Reel select karo')
  const reel = await db.reel_stocks.get(data.reel_id)
  if (!reel || reel.is_deleted || reel.firm_id !== data.firm_id) {
    throw new Error('Selected reel stock nahi mila')
  }
  const used_weight = resolveReelFeedWeight(data.mode, Number(reel.current_weight) || 0, data.used_weight)

  return consumePaperReel({
    firm_id: data.firm_id,
    reel_id: data.reel_id,
    date: data.date,
    used_weight,
    job_id: data.job_id,
    reason: data.reason || (data.mode === 'full' ? 'Full reel feed' : 'Partial reel feed'),
    notes: data.notes,
  })
}

/**
 * Feed several reels in one shot (same KG each for partial, or full-consume each).
 * Prefer same-config reel ids from findSameConfigActiveReels.
 */
export async function feedPaperReelsBatch(data: {
  firm_id: string
  reel_ids: string[]
  date: string
  mode: 'full' | 'partial'
  used_weight?: number
  job_id?: string
  reason?: string
  notes?: string
}) {
  const ids = [...new Set((data.reel_ids || []).filter(Boolean))]
  if (!ids.length) throw new Error('Kam se kam ek reel select karo')

  const results = []
  for (const reel_id of ids) {
    const rec = await feedPaperReel({
      firm_id: data.firm_id,
      reel_id,
      date: data.date,
      mode: data.mode,
      used_weight: data.used_weight,
      job_id: data.job_id,
      reason: data.reason || (data.mode === 'full' ? 'Batch full reel feed' : 'Batch partial reel feed'),
      notes: data.notes,
    })
    results.push(rec)
  }
  return results
}

/** Resolve how much KG to cut for a full or partial feed. */
export function resolveReelFeedWeight(mode: 'full' | 'partial', available: number, used_weight?: number): number {
  const avail = roundWeight(available)
  if (avail <= 0) throw new Error('Reel already consumed')
  if (mode === 'full') return avail
  const used = roundWeight(used_weight)
  if (used <= 0) throw new Error('Used weight 0 se zyada hona chahiye')
  if (used > avail) {
    throw new Error(`Selected reel me sirf ${avail.toFixed(2)} KG available hai.`)
  }
  return used
}

export async function createReelsFromPurchase(purchase: Purchase, confirmedSpecs?: PurchaseReelSpec[]) {
  const specs = confirmedSpecs?.length
    ? normalizeConfirmedSpecs(confirmedSpecs)
    : purchaseReelSpecs(purchase)
  if (!specs.length) return 0

  await assertUniqueReelNosForPurchase(purchase.firm_id, specs, purchase.id)
  const existing = await db.reel_stocks.where('purchase_id').equals(purchase.id).toArray().catch(() => [])
  const existingByNo = new Map<string, ReelStock[]>()
  for (const reel of existing) {
    const key = reelKey(reel.reel_no)
    if (!key) continue
    existingByNo.set(key, [...(existingByNo.get(key) || []), reel])
  }
  for (const reels of existingByNo.values()) {
    reels.sort((a, b) => Number(a.is_deleted) - Number(b.is_deleted))
  }

  const existingMovements = await db.stock_movements
    .where('ref_id')
    .equals(purchase.id)
    .filter((m) => m.source === 'purchase' && m.stock_type === 'raw_reel')
    .toArray()
  const usedMovementIds = new Set<string>()
  const now = nowISO()
  let count = 0

  await db.transaction('rw', db.reel_stocks, db.stock_movements, async () => {
    for (const spec of specs) {
      const candidates = existingByNo.get(reelKey(spec.reel_no)) || []
      const matched = candidates.shift()
      let reel: ReelStock

      if (matched) {
        const currentWeight = matched.is_deleted ? spec.opening_weight : Number(matched.current_weight) || 0
        reel = plain({
          ...matched,
          firm_id: purchase.firm_id,
          reel_no: spec.reel_no,
          paper_type: spec.paper_type,
          supplier_id: purchase.supplier_id,
          supplier_name: purchase.supplier_name,
          purchase_id: purchase.id,
          purchase_bill_no: purchase.bill_no,
          deckle_size: spec.deckle_size,
          gsm: spec.gsm,
          bf: spec.bf,
          color: spec.color,
          opening_weight: spec.opening_weight,
          current_weight: currentWeight,
          rate: spec.rate,
          status: currentWeight > 0 ? 'active' : 'consumed',
          remark: String(spec.remark || matched.remark || '').trim() || undefined,
          updated_at: now,
          is_deleted: false,
          _dirty: true,
        }) as ReelStock
        await db.reel_stocks.put(reel)
      } else {
        reel = plain({
          id: uid(),
          firm_id: purchase.firm_id,
          reel_no: spec.reel_no,
          paper_type: spec.paper_type,
          supplier_id: purchase.supplier_id,
          supplier_name: purchase.supplier_name,
          purchase_id: purchase.id,
          purchase_bill_no: purchase.bill_no,
          deckle_size: spec.deckle_size,
          gsm: spec.gsm,
          bf: spec.bf,
          color: spec.color,
          opening_weight: spec.opening_weight,
          current_weight: spec.opening_weight,
          rate: spec.rate,
          status: spec.opening_weight > 0 ? 'active' : 'consumed',
          remark: String(spec.remark || '').trim() || undefined,
          created_at: now,
          updated_at: now,
          is_deleted: false,
          _dirty: true,
        }) as ReelStock
        await db.reel_stocks.add(reel)
      }

      const matchingMovements = existingMovements.filter((movement) => movement.stock_ref_id === reel.id)
      const movement = matchingMovements[0]
      if (movement) {
        usedMovementIds.add(movement.id)
        await db.stock_movements.put(plain({
          ...movement,
          firm_id: purchase.firm_id,
          date: purchase.received_date || purchase.date,
          source: 'purchase',
          ref_id: purchase.id,
          stock_type: 'raw_reel',
          stock_ref_id: reel.id,
          qty_in: 1,
          qty_out: 0,
          weight_in: spec.opening_weight,
          weight_out: 0,
          waste_qty: 0,
          waste_weight: 0,
          notes: spec.note,
          updated_at: now,
          is_deleted: false,
          _dirty: true,
        }))
      } else {
        const created = newStockMovement({
        firm_id: purchase.firm_id,
        date: purchase.received_date || purchase.date,
        source: 'purchase',
        ref_id: purchase.id,
        stock_type: 'raw_reel',
        stock_ref_id: reel.id,
        qty_in: 1,
        qty_out: 0,
          weight_in: spec.opening_weight,
        weight_out: 0,
        waste_qty: 0,
        waste_weight: 0,
          notes: spec.note,
        })
        await db.stock_movements.add(created)
        usedMovementIds.add(created.id)
      }
      for (const duplicate of matchingMovements.slice(1)) {
        usedMovementIds.add(duplicate.id)
        await db.stock_movements.put({ ...duplicate, is_deleted: true, updated_at: now, _dirty: true })
      }
      count++
    }

    for (const movement of existingMovements) {
      if (!usedMovementIds.has(movement.id) && !movement.is_deleted) {
        await db.stock_movements.put({ ...movement, is_deleted: true, updated_at: now, _dirty: true })
      }
    }
  })

  return count
}

export async function consumePaperReel(data: {
  firm_id: string
  reel_id: string
  date: string
  used_weight: number
  job_id?: string
  reason?: string
  notes?: string
}) {
  const usedWeight = Math.round((Number(data.used_weight) || 0) * 1000) / 1000
  if (!data.reel_id) throw new Error('Reel select karo')
  if (usedWeight <= 0) throw new Error('Used weight 0 se zyada hona chahiye')

  const now = nowISO()
  const movement = newStockMovement({
    firm_id: data.firm_id,
    date: data.date,
    source: 'consumption',
    ref_id: uid(),
    stock_type: 'raw_reel',
    stock_ref_id: data.reel_id,
    job_id: data.job_id || undefined,
    qty_in: 0,
    qty_out: 0,
    weight_in: 0,
    weight_out: usedWeight,
    waste_qty: 0,
    waste_weight: 0,
    notes: [data.reason || 'Manual reel consumption', data.notes].filter(Boolean).join(' - '),
  })

  await db.transaction('rw', db.reel_stocks, db.stock_movements, async () => {
    const reel = await db.reel_stocks.get(data.reel_id)
    if (!reel || reel.is_deleted || reel.firm_id !== data.firm_id) throw new Error('Selected reel stock nahi mila')

    const available = Number(reel.current_weight) || 0
    if (usedWeight > available) {
      throw new Error(`Selected reel ${reel.reel_no} me sirf ${available.toFixed(2)} KG available hai.`)
    }

    const current = Math.max(0, Math.round((available - usedWeight) * 1000) / 1000)
    await db.reel_stocks.put(plain({
      ...reel,
      paper_type: normalizePaperType(reel.paper_type),
      current_weight: current,
      status: current <= 0 ? 'consumed' : 'active',
      updated_at: now,
      _dirty: true,
    }))
    await db.stock_movements.add(movement)
  })

  return movement
}

export async function reversePurchaseReels(purchaseId: string) {
  const reels = await db.reel_stocks.where('purchase_id').equals(purchaseId).toArray()
  const now = nowISO()
  for (const reel of reels) {
    await db.reel_stocks.put({ ...reel, is_deleted: true, updated_at: now, _dirty: true })
  }
  const moves = await db.stock_movements.where('ref_id').equals(purchaseId).toArray()
  for (const m of moves.filter((x) => x.source === 'purchase' && x.stock_type === 'raw_reel')) {
    await db.stock_movements.put({ ...m, is_deleted: true, updated_at: now, _dirty: true })
  }
}

/** Active (non-deleted) stock_movements linked to the given reel ids via stock_ref_id. */
export function filterReelLinkedMovements(movements: StockMovement[], reelIds: Iterable<string>): StockMovement[] {
  const ids = new Set([...reelIds].filter(Boolean))
  if (!ids.size) return []
  return movements.filter((m) => !m.is_deleted && !!m.stock_ref_id && ids.has(m.stock_ref_id))
}

/**
 * Select reels for cleanup / bulk soft-delete.
 * - consumedOnly: status === 'consumed'
 * - beforeDate (YYYY-MM-DD): reel created_at date on or before this day
 * Both filters can combine (AND). At least one filter must be set.
 */
export function filterReelsForDeletion(
  reels: ReelStock[],
  opts: { consumedOnly?: boolean; beforeDate?: string },
): ReelStock[] {
  const before = String(opts.beforeDate || '').trim().slice(0, 10)
  const consumedOnly = !!opts.consumedOnly
  if (!consumedOnly && !before) return []

  return reels.filter((reel) => {
    if (reel.is_deleted) return false
    if (consumedOnly && reel.status !== 'consumed') return false
    if (before) {
      const created = String(reel.created_at || '').slice(0, 10)
      if (!created || created > before) return false
    }
    return true
  })
}

export interface SoftDeleteReelsResult {
  reelIds: string[]
  reelsDeleted: number
  movementsDeleted: number
}

/**
 * Soft-delete paper reels and all stock_movements linked by stock_ref_id.
 * Purchase bills stay intact — only reel register + movement ledger rows.
 */
export async function softDeleteReelsWithMovements(
  firmId: string,
  reelIds: string[],
): Promise<SoftDeleteReelsResult> {
  const ids = [...new Set((reelIds || []).filter(Boolean))]
  if (!ids.length) return { reelIds: [], reelsDeleted: 0, movementsDeleted: 0 }

  const now = nowISO()
  let reelsDeleted = 0
  let movementsDeleted = 0

  await db.transaction('rw', db.reel_stocks, db.stock_movements, async () => {
    for (const id of ids) {
      const reel = await db.reel_stocks.get(id)
      if (!reel || reel.is_deleted || reel.firm_id !== firmId) continue
      await db.reel_stocks.put({ ...reel, is_deleted: true, updated_at: now, _dirty: true })
      reelsDeleted++

      const moves = await db.stock_movements
        .filter((m) => !m.is_deleted && m.firm_id === firmId && m.stock_ref_id === id)
        .toArray()
      for (const m of moves) {
        await db.stock_movements.put({ ...m, is_deleted: true, updated_at: now, _dirty: true })
        movementsDeleted++
      }
    }
  })

  return { reelIds: ids, reelsDeleted, movementsDeleted }
}

/** Soft-delete every non-deleted reel for a firm (+ linked movements). Purchase bills untouched. */
export async function resetAllFirmReelStock(firmId: string): Promise<SoftDeleteReelsResult> {
  const reels = await db.reel_stocks
    .where('firm_id')
    .equals(firmId)
    .filter((r) => !r.is_deleted)
    .toArray()
  return softDeleteReelsWithMovements(firmId, reels.map((r) => r.id))
}

/**
 * Resolve partial consume from a new remaining weight.
 * used = current - remaining; remaining === current is a no-op error.
 */
export function resolveRemainingWeightUpdate(currentWeight: number, remainingKg: number): {
  used: number
  remaining: number
} {
  const current = roundWeight(currentWeight)
  const remaining = roundWeight(remainingKg)
  if (current <= 0) throw new Error('Reel already consumed')
  if (remaining < 0) throw new Error('Remaining weight negative nahi ho sakti')
  if (remaining > current) {
    throw new Error(`Remaining ${remaining} KG, current ${current} KG se zyada nahi ho sakti`)
  }
  if (remaining === current) throw new Error('Koi change nahi — remaining current ke barabar hai')
  return { used: roundWeight(current - remaining), remaining }
}

/** Partial consume by setting the new remaining KG on a reel. */
export async function updateReelRemainingWeight(data: {
  firm_id: string
  reel_id: string
  remaining_kg: number
  date?: string
  notes?: string
}) {
  if (!data.reel_id) throw new Error('Reel select karo')
  const reel = await db.reel_stocks.get(data.reel_id)
  if (!reel || reel.is_deleted || reel.firm_id !== data.firm_id) {
    throw new Error('Selected reel stock nahi mila')
  }
  const { used, remaining } = resolveRemainingWeightUpdate(
    Number(reel.current_weight) || 0,
    data.remaining_kg,
  )
  const date = data.date || nowISO().slice(0, 10)
  return consumePaperReel({
    firm_id: data.firm_id,
    reel_id: data.reel_id,
    date,
    used_weight: used,
    reason: remaining <= 0 ? 'Full consume via remaining update' : 'Partial via remaining weight',
    notes: data.notes || `Remaining set to ${remaining} KG (was ${roundWeight(Number(reel.current_weight) || 0)})`,
  })
}

/** Full-consume many reels in one batch. */
export async function fullConsumeReels(data: {
  firm_id: string
  reel_ids: string[]
  date?: string
  notes?: string
}) {
  return feedPaperReelsBatch({
    firm_id: data.firm_id,
    reel_ids: data.reel_ids,
    date: data.date || nowISO().slice(0, 10),
    mode: 'full',
    reason: 'Full consume selected',
    notes: data.notes,
  })
}

export type ConsumableStockType = 'glue' | 'ink' | 'stitching_wire' | 'strapping_roll'

export interface PurchaseConsumableSpec {
  stock_type: ConsumableStockType
  /** Bags / rolls count (stored as qty_in on movements). */
  qty: number
  /** Total KG. */
  weight: number
  /** KG per bag/roll. */
  pack_size_kg?: number
  /** Alias for qty when entering as packs. */
  packs?: number
  note: string
  remark?: string
  rate?: number
}

export function purchaseHasConsumableLines(purchase: Pick<Purchase, 'items'>): boolean {
  return (purchase.items || []).some((row) => row.is_consumable && row.consumable_type)
}

export function proposePurchaseConsumableSpecs(purchase: Purchase): PurchaseConsumableSpec[] {
  return (purchase.items || [])
    .filter((row) => row.is_consumable && row.consumable_type && CONSUMABLE_STOCK_TYPES.has(row.consumable_type))
    .map((row) => {
      const qty = Math.max(0, Number(row.qty) || 0)
      const unit = String(row.unit || '').trim().toUpperCase()
      const stock_type = row.consumable_type as ConsumableStockType
      const pack_size_kg = unit === 'KG' ? (qty > 0 ? qty : 25) : 25
      const packs = unit === 'KG' ? 1 : Math.max(1, Math.round(qty) || 0)
      const weight = unit === 'KG' ? qty : roundWeight(packs * pack_size_kg)
      return {
        stock_type,
        qty: packs,
        packs,
        pack_size_kg,
        weight,
        rate: Number(row.rate) || 0,
        note: `${STOCK_LABELS[stock_type]} from purchase ${purchase.bill_no}`,
        remark: '',
      }
    })
    .filter((row) => row.qty > 0 || row.weight > 0)
}

export async function reversePurchaseConsumables(purchaseId: string) {
  const now = nowISO()
  await db.transaction('rw', db.stock_movements, db.consumable_lots, async () => {
    const moves = await db.stock_movements.where('ref_id').equals(purchaseId).toArray()
    for (const m of moves.filter((x) => x.source === 'purchase' && CONSUMABLE_STOCK_TYPES.has(x.stock_type))) {
      await db.stock_movements.put({ ...m, is_deleted: true, updated_at: now, _dirty: true })
    }
    const lots = await db.consumable_lots.where('purchase_id').equals(purchaseId).toArray()
    for (const lot of lots) {
      await db.consumable_lots.put({ ...lot, is_deleted: true, updated_at: now, _dirty: true })
    }
  })
}

export function getConsumableBalance(
  movements: StockMovement[],
  firmId: string,
  stockType: ConsumableStockType,
): { qty: number; weight: number } {
  const bal = productionBalance(movements, firmId)[stockType]
  return {
    qty: Math.max(0, Math.round((Number(bal.qty) || 0) * 1000) / 1000),
    weight: Math.max(0, Math.round((Number(bal.weight) || 0) * 1000) / 1000),
  }
}

export function consumableLotTotals(
  lots: ConsumableLot[],
  firmId: string,
  stockType?: ConsumableStockType,
): { packs: number; weight: number; lots: number } {
  const rows = lots.filter((lot) =>
    !lot.is_deleted
    && lot.firm_id === firmId
    && lot.status === 'active'
    && (!stockType || lot.stock_type === stockType),
  )
  return {
    packs: roundWeight(rows.reduce((s, lot) => s + (Number(lot.packs_remaining) || 0), 0)),
    weight: roundWeight(rows.reduce((s, lot) => s + (Number(lot.weight_remaining) || 0), 0)),
    lots: rows.length,
  }
}

/** Resolve qty/weight to feed for partial or full consumable consume. */
export function resolveConsumableFeed(
  mode: 'full' | 'partial',
  available: { qty: number; weight: number },
  requested?: { qty?: number; weight?: number },
): { qty: number; weight: number } {
  const availQty = Math.max(0, roundWeight(available.qty))
  const availWeight = Math.max(0, roundWeight(available.weight))
  if (availQty <= 0 && availWeight <= 0) throw new Error('Is consumable ka stock already khali hai')

  if (mode === 'full') {
    return { qty: availQty, weight: availWeight }
  }

  const qty = roundWeight(requested?.qty)
  const weight = roundWeight(requested?.weight)
  if (qty <= 0 && weight <= 0) throw new Error('Feed qty ya weight 0 se zyada hona chahiye')
  if (qty > availQty) throw new Error(`Sirf ${availQty} qty available hai`)
  if (weight > availWeight) throw new Error(`Sirf ${availWeight} KG available hai`)
  return { qty, weight }
}

function normalizeConsumableLotInput(data: {
  stock_type: ConsumableStockType
  pack_size_kg?: number
  packs?: number
  qty?: number
  weight?: number
}) {
  if (!CONSUMABLE_STOCK_TYPES.has(data.stock_type)) throw new Error('Consumable type select karo')
  const packs = roundWeight(data.packs ?? data.qty)
  let pack_size_kg = roundWeight(data.pack_size_kg)
  let weight = roundWeight(data.weight)
  if (packs <= 0 && weight <= 0) throw new Error('Bags / rolls ya weight enter karo')
  if (pack_size_kg <= 0 && packs > 0 && weight > 0) {
    pack_size_kg = roundWeight(weight / packs)
  }
  if (pack_size_kg <= 0 && weight > 0 && packs <= 0) {
    pack_size_kg = weight
  }
  if (pack_size_kg <= 0) pack_size_kg = 25
  const finalPacks = packs > 0 ? packs : 1
  if (weight <= 0) weight = roundWeight(finalPacks * pack_size_kg)
  return { packs: finalPacks, pack_size_kg, weight }
}

export async function createConsumableLot(data: {
  firm_id: string
  date: string
  stock_type: ConsumableStockType
  pack_size_kg?: number
  packs?: number
  qty?: number
  weight?: number
  rate?: number
  remark?: string
  notes?: string
  supplier_name?: string
  supplier_id?: string | null
  purchase_id?: string
  purchase_bill_no?: string
  source?: StockMovement['source']
}) {
  const { packs, pack_size_kg, weight } = normalizeConsumableLotInput(data)
  const remark = String(data.remark || data.notes || '').trim()
  const now = nowISO()
  const date = data.date || now.slice(0, 10)
  const lot = plain({
    id: uid(),
    firm_id: data.firm_id,
    stock_type: data.stock_type,
    date,
    supplier_id: data.supplier_id ?? null,
    supplier_name: data.supplier_name || '',
    purchase_id: data.purchase_id,
    purchase_bill_no: data.purchase_bill_no,
    pack_size_kg,
    packs_total: packs,
    packs_remaining: packs,
    weight_total: weight,
    weight_remaining: weight,
    rate: Number(data.rate) || 0,
    status: 'active' as const,
    remark: remark || undefined,
    created_at: now,
    updated_at: now,
    is_deleted: false,
    _dirty: true,
  }) as ConsumableLot

  const movement = newStockMovement({
    firm_id: data.firm_id,
    date,
    source: data.source || (data.purchase_id ? 'purchase' : 'adjustment'),
    ref_id: data.purchase_id || lot.id,
    stock_type: data.stock_type,
    stock_ref_id: lot.id,
    qty_in: packs,
    qty_out: 0,
    weight_in: weight,
    weight_out: 0,
    waste_qty: 0,
    waste_weight: 0,
    notes: remark
      ? `${STOCK_LABELS[data.stock_type]} lot — ${packs} × ${pack_size_kg} KG · ${remark}`
      : `${STOCK_LABELS[data.stock_type]} lot — ${packs} × ${pack_size_kg} KG`,
  })

  await db.transaction('rw', db.consumable_lots, db.stock_movements, async () => {
    await db.consumable_lots.add(lot)
    await db.stock_movements.add(movement)
  })
  return lot
}

export async function consumeConsumableLot(data: {
  firm_id: string
  lot_id: string
  date?: string
  mode?: 'full' | 'partial'
  packs?: number
  weight?: number
  remark?: string
  notes?: string
}) {
  const lot = await db.consumable_lots.get(data.lot_id)
  if (!lot || lot.is_deleted || lot.firm_id !== data.firm_id) {
    throw new Error('Consumable lot nahi mila')
  }
  if (lot.status !== 'active' || (Number(lot.packs_remaining) || 0) <= 0 && (Number(lot.weight_remaining) || 0) <= 0) {
    throw new Error('Lot already consumed')
  }

  const availPacks = roundWeight(lot.packs_remaining)
  const availWeight = roundWeight(lot.weight_remaining)
  const packSize = roundWeight(lot.pack_size_kg) || (availPacks > 0 ? roundWeight(availWeight / availPacks) : 0)

  let usePacks = 0
  let useWeight = 0
  if (data.mode === 'full') {
    usePacks = availPacks
    useWeight = availWeight
  } else {
    usePacks = roundWeight(data.packs)
    useWeight = roundWeight(data.weight)
    if (usePacks <= 0 && useWeight <= 0) throw new Error('Bags ya KG enter karo')
    if (usePacks > 0 && useWeight <= 0 && packSize > 0) useWeight = roundWeight(usePacks * packSize)
    if (useWeight > 0 && usePacks <= 0 && packSize > 0) {
      usePacks = Math.min(availPacks, roundWeight(useWeight / packSize))
    }
    if (usePacks > availPacks) throw new Error(`Sirf ${availPacks} bags/rolls bache hain`)
    if (useWeight > availWeight) throw new Error(`Sirf ${availWeight} KG available hai`)
  }

  const remainingPacks = roundWeight(availPacks - usePacks)
  const remainingWeight = roundWeight(availWeight - useWeight)
  const remark = String(data.remark || data.notes || '').trim()
  const date = data.date || nowISO().slice(0, 10)
  const now = nowISO()

  const movement = newStockMovement({
    firm_id: data.firm_id,
    date,
    source: 'consumption',
    ref_id: lot.id,
    stock_type: lot.stock_type,
    stock_ref_id: lot.id,
    qty_in: 0,
    qty_out: usePacks,
    weight_in: 0,
    weight_out: useWeight,
    waste_qty: 0,
    waste_weight: 0,
    notes: remark
      ? `Consumed ${usePacks} pack / ${useWeight} KG — ${STOCK_LABELS[lot.stock_type]} · ${remark}`
      : `Consumed ${usePacks} pack / ${useWeight} KG — ${STOCK_LABELS[lot.stock_type]}`,
  })

  await db.transaction('rw', db.consumable_lots, db.stock_movements, async () => {
    await db.consumable_lots.put(plain({
      ...lot,
      packs_remaining: remainingPacks,
      weight_remaining: remainingWeight,
      status: remainingPacks <= 0.001 && remainingWeight <= 0.001 ? 'consumed' : 'active',
      updated_at: now,
      _dirty: true,
    }))
    await db.stock_movements.add(movement)
  })
  return movement
}

/** Legacy aggregate add — also creates a lot so register stays consistent. */
export async function createManualConsumable(data: {
  firm_id: string
  date: string
  stock_type: ConsumableStockType
  qty: number
  weight: number
  pack_size_kg?: number
  notes?: string
  remark?: string
}) {
  return createConsumableLot({
    firm_id: data.firm_id,
    date: data.date,
    stock_type: data.stock_type,
    packs: data.qty,
    qty: data.qty,
    weight: data.weight,
    pack_size_kg: data.pack_size_kg,
    remark: data.remark || data.notes,
    notes: data.notes,
  })
}

export async function feedConsumable(data: {
  firm_id: string
  date: string
  stock_type: ConsumableStockType
  mode: 'full' | 'partial'
  qty?: number
  weight?: number
  notes?: string
  remark?: string
  movements: StockMovement[]
  lots?: ConsumableLot[]
}) {
  if (!CONSUMABLE_STOCK_TYPES.has(data.stock_type)) throw new Error('Consumable type select karo')
  const lots = (data.lots || await db.consumable_lots.where('firm_id').equals(data.firm_id).toArray())
    .filter((lot) =>
      !lot.is_deleted
      && lot.stock_type === data.stock_type
      && lot.status === 'active'
      && ((Number(lot.packs_remaining) || 0) > 0 || (Number(lot.weight_remaining) || 0) > 0),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at))

  const lotTotals = consumableLotTotals(lots, data.firm_id, data.stock_type)
  const legacy = getConsumableBalance(data.movements, data.firm_id, data.stock_type)
  // Prefer lot-based remaining; if lots cover the balance, use lot totals for feed resolve.
  const available = lotTotals.weight > 0 || lotTotals.packs > 0
    ? { qty: lotTotals.packs, weight: lotTotals.weight }
    : legacy

  const feed = resolveConsumableFeed(data.mode, available, { qty: data.qty, weight: data.weight })
  const remark = String(data.remark || data.notes || '').trim()

  if (lots.length) {
    let remainingPacks = feed.qty
    let remainingWeight = feed.weight
    let lastMove: StockMovement | null = null
    for (const lot of lots) {
      if (remainingPacks <= 0.001 && remainingWeight <= 0.001) break
      const takePacks = Math.min(Number(lot.packs_remaining) || 0, remainingPacks)
      const takeWeight = Math.min(Number(lot.weight_remaining) || 0, remainingWeight)
      if (takePacks <= 0 && takeWeight <= 0) continue
      lastMove = await consumeConsumableLot({
        firm_id: data.firm_id,
        lot_id: lot.id,
        date: data.date,
        mode: 'partial',
        packs: takePacks,
        weight: takeWeight,
        remark,
      })
      remainingPacks = roundWeight(remainingPacks - takePacks)
      remainingWeight = roundWeight(remainingWeight - takeWeight)
    }
    if (!lastMove) throw new Error('Consumable lot se feed nahi ho paya')
    return lastMove
  }

  return saveStockAdjustment({
    firm_id: data.firm_id,
    date: data.date,
    stock_type: data.stock_type,
    mode: 'consume',
    qty: feed.qty,
    weight: feed.weight,
    notes: remark
      || (data.mode === 'full'
        ? `Full consumable feed — ${STOCK_LABELS[data.stock_type]}`
        : `Partial consumable feed — ${STOCK_LABELS[data.stock_type]}`),
  })
}

export async function createConsumablesFromPurchase(purchase: Purchase, confirmedSpecs?: PurchaseConsumableSpec[]) {
  const specs = (confirmedSpecs !== undefined
    ? confirmedSpecs
    : proposePurchaseConsumableSpecs(purchase)
  ).map((row) => {
    const packs = Math.max(0, Number(row.packs ?? row.qty) || 0)
    const pack_size_kg = Math.max(0, Number(row.pack_size_kg) || 0)
    const weight = Math.max(0, Number(row.weight) || 0) || roundWeight(packs * (pack_size_kg || 25))
    return {
      stock_type: row.stock_type,
      packs,
      qty: packs,
      pack_size_kg: pack_size_kg || (packs > 0 ? roundWeight(weight / packs) : 25),
      weight,
      rate: Number(row.rate) || 0,
      note: row.note || `${STOCK_LABELS[row.stock_type]} from purchase ${purchase.bill_no}`,
      remark: String(row.remark || '').trim(),
    }
  }).filter((row) => row.packs > 0 || row.weight > 0)

  let count = 0
  for (const row of specs) {
    await createConsumableLot({
      firm_id: purchase.firm_id,
      date: purchase.received_date || purchase.date,
      stock_type: row.stock_type,
      packs: row.packs,
      pack_size_kg: row.pack_size_kg,
      weight: row.weight,
      rate: row.rate,
      remark: row.remark || row.note,
      notes: row.note,
      supplier_name: purchase.supplier_name,
      supplier_id: purchase.supplier_id,
      purchase_id: purchase.id,
      purchase_bill_no: purchase.bill_no,
      source: 'purchase',
    })
    count++
  }
  return count
}

export async function saveProductionStage(entry: Omit<ProductionStageEntry, 'id' | 'created_at' | 'updated_at' | 'is_deleted' | '_dirty'>) {
  const now = nowISO()
  const rec = plain({ ...entry, id: uid(), created_at: now, updated_at: now, is_deleted: false, _dirty: true }) as ProductionStageEntry
  await db.transaction('rw', db.production_stages, db.stock_movements, db.reel_stocks, db.production_jobs, async () => {
    await db.production_stages.add(rec)
    if (rec.input_stock_type === 'raw_reel' && rec.input_ref_id && rec.input_weight > 0) {
      const reel = await db.reel_stocks.get(rec.input_ref_id)
      if (reel) {
        if (rec.input_weight > (Number(reel.current_weight) || 0)) {
          throw new Error(`Selected reel ${reel.reel_no} has only ${Number(reel.current_weight).toFixed(2)} KG available.`)
        }
        const current = Math.max(0, (Number(reel.current_weight) || 0) - rec.input_weight)
        await db.reel_stocks.put({
          ...reel,
          current_weight: current,
          status: current <= 0 ? 'consumed' : 'active',
          updated_at: now,
          _dirty: true,
        })
      }
    }
    await db.stock_movements.add(newStockMovement({
      firm_id: rec.firm_id,
      date: rec.date,
      source: rec.stage === 'dispatch' ? 'dispatch' : 'production',
      ref_id: rec.id,
      stock_type: rec.input_stock_type,
      stock_ref_id: rec.input_ref_id,
      job_id: rec.job_id,
      qty_in: 0,
      qty_out: rec.input_qty,
      weight_in: 0,
      weight_out: rec.input_weight,
      waste_qty: 0,
      waste_weight: 0,
      notes: `${STAGE_LABELS[rec.stage]} input`,
    }))
    await db.stock_movements.add(newStockMovement({
      firm_id: rec.firm_id,
      date: rec.date,
      source: rec.stage === 'dispatch' ? 'dispatch' : 'production',
      ref_id: rec.id,
      stock_type: rec.output_stock_type,
      job_id: rec.job_id,
      qty_in: rec.output_qty,
      qty_out: 0,
      weight_in: rec.output_weight,
      weight_out: 0,
      waste_qty: rec.waste_qty,
      waste_weight: rec.waste_weight,
      notes: `${STAGE_LABELS[rec.stage]} output`,
    }))
    const job = await db.production_jobs.get(rec.job_id)
    if (job) {
      const status: ProductionJob['status'] =
        rec.stage === 'dispatch' ? 'dispatched' : rec.stage === 'stitching' ? 'ready' : 'in_progress'
      await db.production_jobs.put({ ...job, status, updated_at: now, _dirty: true })
    }
  })
  return rec
}

export async function saveStockAdjustment(data: {
  firm_id: string
  date: string
  stock_type: ProductionStockType
  mode: 'add' | 'consume'
  qty: number
  weight: number
  notes?: string
}) {
  const qty = Number(data.qty) || 0
  const weight = Number(data.weight) || 0
  const rec = newStockMovement({
    firm_id: data.firm_id,
    date: data.date,
    source: 'adjustment',
    ref_id: uid(),
    stock_type: data.stock_type,
    qty_in: data.mode === 'add' ? qty : 0,
    qty_out: data.mode === 'consume' ? qty : 0,
    weight_in: data.mode === 'add' ? weight : 0,
    weight_out: data.mode === 'consume' ? weight : 0,
    waste_qty: 0,
    waste_weight: 0,
    notes: data.notes || `${STOCK_LABELS[data.stock_type]} ${data.mode}`,
  })
  await db.stock_movements.add(rec)
  return rec
}

export function productionBalance(movements: StockMovement[], firmId: string, jobId?: string) {
  const rows = movements.filter((m) => !m.is_deleted && m.firm_id === firmId && (!jobId || m.job_id === jobId))
  const out: Record<ProductionStockType, { qty: number; weight: number; wasteQty: number; wasteWeight: number }> = {
    raw_reel: { qty: 0, weight: 0, wasteQty: 0, wasteWeight: 0 },
    '2ply': { qty: 0, weight: 0, wasteQty: 0, wasteWeight: 0 },
    cut_sheet: { qty: 0, weight: 0, wasteQty: 0, wasteWeight: 0 },
    pasted_sheet: { qty: 0, weight: 0, wasteQty: 0, wasteWeight: 0 },
    trimmed_sheet: { qty: 0, weight: 0, wasteQty: 0, wasteWeight: 0 },
    printed_sheet: { qty: 0, weight: 0, wasteQty: 0, wasteWeight: 0 },
    finished_box: { qty: 0, weight: 0, wasteQty: 0, wasteWeight: 0 },
    glue: { qty: 0, weight: 0, wasteQty: 0, wasteWeight: 0 },
    ink: { qty: 0, weight: 0, wasteQty: 0, wasteWeight: 0 },
    stitching_wire: { qty: 0, weight: 0, wasteQty: 0, wasteWeight: 0 },
    strapping_roll: { qty: 0, weight: 0, wasteQty: 0, wasteWeight: 0 },
    waste: { qty: 0, weight: 0, wasteQty: 0, wasteWeight: 0 },
  }
  for (const m of rows) {
    out[m.stock_type].qty += (Number(m.qty_in) || 0) - (Number(m.qty_out) || 0)
    out[m.stock_type].weight += (Number(m.weight_in) || 0) - (Number(m.weight_out) || 0)
    out[m.stock_type].wasteQty += Number(m.waste_qty) || 0
    out[m.stock_type].wasteWeight += Number(m.waste_weight) || 0
  }
  return out
}

export const REEL_LOW_STOCK_KG = 75

export interface ReelPaperTypeTotals {
  paper_type: PaperType
  reels: number
  activeReels: number
  openingWeight: number
  currentWeight: number
  consumedWeight: number
}

export type ReelBreakdownStockStatus = 'ok' | 'low' | 'zero'

export interface ReelInventoryBreakdownRow {
  key: string
  paper_type: PaperType
  gsm: string
  bf: string
  deckle: string
  color: string
  reels: number
  activeReels: number
  openingWeight: number
  currentWeight: number
  consumedWeight: number
  movementOut: number
  stockStatus: ReelBreakdownStockStatus
}

export interface ReelInventorySummary {
  totalReels: number
  activeReels: number
  consumedReels: number
  zeroStockReels: number
  lowStockReels: number
  openingWeight: number
  currentWeight: number
  consumedWeight: number
  movementConsumed: number
  byPaperType: ReelPaperTypeTotals[]
  breakdown: ReelInventoryBreakdownRow[]
}

function reelBreakdownStockStatus(currentWeight: number, openingWeight: number, activeReels: number): ReelBreakdownStockStatus {
  if (activeReels === 0 || currentWeight <= 0) return 'zero'
  if (currentWeight < REEL_LOW_STOCK_KG || (openingWeight > 0 && currentWeight / openingWeight < 0.15)) return 'low'
  return 'ok'
}

export function reelInventorySummary(reels: ReelStock[], movements: StockMovement[] = []): ReelInventorySummary {
  const movementOutByReel = new Map<string, number>()
  let movementConsumed = 0
  for (const m of movements) {
    if (m.is_deleted || m.stock_type !== 'raw_reel') continue
    const out = Number(m.weight_out) || 0
    movementConsumed += out
    const ref = m.stock_ref_id || ''
    if (ref) movementOutByReel.set(ref, (movementOutByReel.get(ref) || 0) + out)
  }

  const breakdownMap = new Map<string, ReelInventoryBreakdownRow>()
  const byType = new Map<PaperType, ReelPaperTypeTotals>()
  const ensureType = (paperType: PaperType) => {
    if (!byType.has(paperType)) {
      byType.set(paperType, {
        paper_type: paperType,
        reels: 0,
        activeReels: 0,
        openingWeight: 0,
        currentWeight: 0,
        consumedWeight: 0,
      })
    }
    return byType.get(paperType)!
  }

  let totalReels = 0
  let activeReels = 0
  let consumedReels = 0
  let zeroStockReels = 0
  let lowStockReels = 0
  let openingWeight = 0
  let currentWeight = 0

  for (const reel of reels) {
    const paper_type = normalizePaperType(reel.paper_type)
    const open = Number(reel.opening_weight) || 0
    const cur = Number(reel.current_weight) || 0
    const consumed = Math.max(0, open - cur)
    const isActive = reel.status === 'active'
    const hasStock = isActive && cur > 0

    totalReels += 1
    openingWeight += open
    currentWeight += cur

    const typeRow = ensureType(paper_type)
    typeRow.reels += 1
    typeRow.openingWeight += open
    typeRow.currentWeight += cur
    typeRow.consumedWeight += consumed
    if (hasStock) typeRow.activeReels += 1

    if (isActive) {
      activeReels += 1
      if (cur <= 0) zeroStockReels += 1
      else if (cur < REEL_LOW_STOCK_KG || (open > 0 && cur / open < 0.15)) lowStockReels += 1
    } else {
      consumedReels += 1
    }

    const dims = {
      paper_type,
      gsm: reel.gsm || '-',
      bf: reel.bf || '-',
      deckle: reel.deckle_size || '-',
      color: normalizeReelColor(reel.color),
    }
    const key = [dims.paper_type, dims.gsm, dims.bf, dims.deckle, dims.color].join('|')
    if (!breakdownMap.has(key)) {
      breakdownMap.set(key, {
        key,
        ...dims,
        reels: 0,
        activeReels: 0,
        openingWeight: 0,
        currentWeight: 0,
        consumedWeight: 0,
        movementOut: 0,
        stockStatus: 'ok',
      })
    }
    const row = breakdownMap.get(key)!
    row.reels += 1
    row.openingWeight += open
    row.currentWeight += cur
    row.consumedWeight += consumed
    row.movementOut += movementOutByReel.get(reel.id) || 0
    if (hasStock) row.activeReels += 1
  }

  const breakdown = [...breakdownMap.values()]
    .map((row) => ({
      ...row,
      stockStatus: reelBreakdownStockStatus(row.currentWeight, row.openingWeight, row.activeReels),
    }))
    .sort((a, b) =>
      a.paper_type.localeCompare(b.paper_type) ||
      a.gsm.localeCompare(b.gsm, undefined, { numeric: true }) ||
      a.bf.localeCompare(b.bf, undefined, { numeric: true }) ||
      a.deckle.localeCompare(b.deckle, undefined, { numeric: true }) ||
      a.color.localeCompare(b.color),
    )

  const paperTypes: PaperType[] = ['KRAFT', 'DUPLEX']
  const byPaperType = paperTypes
    .map((paper_type) => byType.get(paper_type) || {
      paper_type,
      reels: 0,
      activeReels: 0,
      openingWeight: 0,
      currentWeight: 0,
      consumedWeight: 0,
    })
    .filter((row) => row.reels > 0 || row.openingWeight > 0)

  return {
    totalReels,
    activeReels,
    consumedReels,
    zeroStockReels,
    lowStockReels,
    openingWeight,
    currentWeight,
    consumedWeight: Math.max(0, openingWeight - currentWeight),
    movementConsumed,
    byPaperType: byPaperType.length ? byPaperType : paperTypes.map((paper_type) => ({
      paper_type,
      reels: 0,
      activeReels: 0,
      openingWeight: 0,
      currentWeight: 0,
      consumedWeight: 0,
    })),
    breakdown,
  }
}
