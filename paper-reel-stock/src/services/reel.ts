import { db } from '@/data/db'
import { uid, nowISO } from '@/data/util'
import type { PaperType, ReelStock, StockMovement } from '@/types/models'

const plain = <X>(o: X): X => JSON.parse(JSON.stringify(o))

function roundWeight(value: number | undefined | null) {
  return Math.round((Number(value) || 0) * 1000) / 1000
}

export function normalizePaperType(value: unknown): PaperType {
  return String(value || '').trim().toUpperCase() === 'DUPLEX' ? 'DUPLEX' : 'KRAFT'
}

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

export type ReelIntakeCondition = 'fresh' | 'partial'
export const REEL_CORE_DIA_MM = 76
export const REEL_LOW_STOCK_KG = 75
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

export function deckleFromMm(mm: number) {
  const deckle_mm = roundDec(mm, 1)
  const deckle_inch = roundDec(deckle_mm / MM_PER_INCH, 3)
  return { deckle_mm, deckle_inch, deckle_size: formatDeckleDisplay(deckle_mm, deckle_inch) }
}

export function deckleFromInch(inch: number) {
  const deckle_inch = roundDec(inch, 3)
  const deckle_mm = roundDec(deckle_inch * MM_PER_INCH, 1)
  return { deckle_mm, deckle_inch, deckle_size: formatDeckleDisplay(deckle_mm, deckle_inch) }
}

export function resolveDecklePair(input: {
  deckle_mm?: number | null
  deckle_inch?: number | null
  deckle_size?: string | null
}) {
  const mm = Number(input.deckle_mm)
  const inch = Number(input.deckle_inch)
  if (Number.isFinite(mm) && mm > 0) return deckleFromMm(mm)
  if (Number.isFinite(inch) && inch > 0) return deckleFromInch(inch)
  const raw = String(input.deckle_size || '').trim()
  const asNum = Number(raw.replace(/[^\d.]/g, ''))
  if (Number.isFinite(asNum) && asNum > 0) {
    return asNum >= 100 ? deckleFromMm(asNum) : deckleFromInch(asNum)
  }
  return { deckle_mm: 0, deckle_inch: 0, deckle_size: raw }
}

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
  return roundWeight((Math.PI / 4) * (od * od - core * core) * widthMm * gsm / 1e9)
}

export function normalizeReelNoKey(reelNo: string) {
  return String(reelNo || '').trim().toLowerCase()
}

export function findDuplicateReelNosInList(reelNos: Array<string | undefined | null>): string[] {
  const counts = new Map<string, { count: number; sample: string }>()
  for (const raw of reelNos) {
    const sample = String(raw || '').trim()
    const key = normalizeReelNoKey(sample)
    if (!key) continue
    const prev = counts.get(key)
    if (prev) prev.count += 1
    else counts.set(key, { count: 1, sample })
  }
  return [...counts.values()].filter((row) => row.count > 1).map((row) => row.sample)
}

export function findReelNosAlreadyInStock(
  proposed: Array<string | undefined | null>,
  existingReelNos: Array<string | undefined | null>,
): string[] {
  const taken = new Set(existingReelNos.map((r) => normalizeReelNoKey(String(r || ''))).filter(Boolean))
  const clashes: string[] = []
  const seen = new Set<string>()
  for (const raw of proposed) {
    const sample = String(raw || '').trim()
    const key = normalizeReelNoKey(sample)
    if (!key || seen.has(key)) continue
    seen.add(key)
    if (taken.has(key)) clashes.push(sample)
  }
  return clashes
}

function newStockMovement(
  data: Omit<StockMovement, 'id' | 'created_at' | 'updated_at' | 'is_deleted' | '_dirty'>,
): StockMovement {
  const now = nowISO()
  return plain({ ...data, id: uid(), created_at: now, updated_at: now, is_deleted: false, _dirty: true })
}

async function assertUniqueReelNos(firmId: string, reelNos: string[], excludeId?: string) {
  const seen = new Set<string>()
  for (const raw of reelNos) {
    const key = normalizeReelNoKey(raw)
    if (!key) throw new Error('Har reel ka number required hai')
    if (seen.has(key)) throw new Error(`Duplicate reel number in list: ${raw.trim()}`)
    seen.add(key)
  }
  const existing = await db.reel_stocks
    .where('firm_id')
    .equals(firmId)
    .filter((reel) => !reel.is_deleted && reel.id !== excludeId)
    .toArray()
  const taken = new Set(existing.map((r) => normalizeReelNoKey(r.reel_no)))
  for (const raw of reelNos) {
    const key = normalizeReelNoKey(raw)
    if (taken.has(key)) throw new Error(`Reel number "${raw.trim()}" already exists in stock`)
  }
}

export async function createManualReels(data: {
  firm_id: string
  paper_type?: PaperType
  deckle_mm?: number
  deckle_inch?: number
  deckle_size?: string
  gsm: string
  bf: string
  color: string
  supplier_name: string
  date?: string
  intake_condition?: ReelIntakeCondition
  remark?: string
  lines: Array<{ reel_no: string; opening_weight: number }>
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

  if (!data.lines?.length) throw new Error('Kam se kam ek reel row chahiye')
  if (data.lines.length > 50) throw new Error('Ek baar me max 50 reels')

  const lines = data.lines.map((l) => ({
    reel_no: String(l.reel_no || '').trim(),
    opening_weight: roundWeight(l.opening_weight),
  }))
  for (const line of lines) {
    if (!line.reel_no) throw new Error('Har row me reel number required')
    if (line.opening_weight <= 0) throw new Error(`Reel ${line.reel_no}: Opening KG 0 se zyada`)
  }
  await assertUniqueReelNos(data.firm_id, lines.map((l) => l.reel_no))

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
      const reel = plain({
        id: uid(),
        firm_id: data.firm_id,
        reel_no: line.reel_no,
        paper_type,
        supplier_id: null,
        supplier_name: mill,
        deckle_size: deckle.deckle_size,
        deckle_mm: deckle.deckle_mm || undefined,
        deckle_inch: deckle.deckle_inch || undefined,
        gsm: String(data.gsm || '').trim(),
        bf: String(data.bf || '').trim(),
        color,
        opening_weight: line.opening_weight,
        current_weight: line.opening_weight,
        rate: 0,
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
        weight_in: line.opening_weight,
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

export async function consumePaperReel(data: {
  firm_id: string
  reel_id: string
  date: string
  used_weight: number
  reason?: string
  notes?: string
}) {
  const usedWeight = roundWeight(data.used_weight)
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
    const current = Math.max(0, roundWeight(available - usedWeight))
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

export function resolveRemainingWeightUpdate(currentWeight: number, remainingKg: number) {
  const current = roundWeight(currentWeight)
  const remaining = roundWeight(remainingKg)
  if (current <= 0) throw new Error('Reel already consumed')
  if (remaining < 0) throw new Error('Remaining weight negative nahi ho sakti')
  if (remaining > current) throw new Error(`Remaining ${remaining} KG, current ${current} KG se zyada nahi`)
  if (remaining === current) throw new Error('Koi change nahi — remaining current ke barabar hai')
  return { used: roundWeight(current - remaining), remaining }
}

export async function updateReelRemainingWeight(data: {
  firm_id: string
  reel_id: string
  remaining_kg: number
  date?: string
  notes?: string
}) {
  const reel = await db.reel_stocks.get(data.reel_id)
  if (!reel || reel.is_deleted || reel.firm_id !== data.firm_id) throw new Error('Selected reel stock nahi mila')
  const { used, remaining } = resolveRemainingWeightUpdate(Number(reel.current_weight) || 0, data.remaining_kg)
  return consumePaperReel({
    firm_id: data.firm_id,
    reel_id: data.reel_id,
    date: data.date || nowISO().slice(0, 10),
    used_weight: used,
    reason: remaining <= 0 ? 'Full consume via remaining update' : 'Partial via remaining weight',
    notes: data.notes || `Remaining set to ${remaining} KG (was ${roundWeight(Number(reel.current_weight) || 0)})`,
  })
}

export async function fullConsumeReels(data: {
  firm_id: string
  reel_ids: string[]
  date?: string
  notes?: string
}) {
  const ids = [...new Set((data.reel_ids || []).filter(Boolean))]
  if (!ids.length) throw new Error('Kam se kam ek reel select karo')
  const date = data.date || nowISO().slice(0, 10)
  const results = []
  for (const reel_id of ids) {
    const reel = await db.reel_stocks.get(reel_id)
    if (!reel || reel.is_deleted || reel.firm_id !== data.firm_id) continue
    const avail = Number(reel.current_weight) || 0
    if (avail <= 0) continue
    results.push(await consumePaperReel({
      firm_id: data.firm_id,
      reel_id,
      date,
      used_weight: avail,
      reason: 'Full consume selected',
      notes: data.notes,
    }))
  }
  return results
}

export async function updateReelSpecification(data: {
  firm_id: string
  reel_id: string
  reel_no: string
  paper_type?: PaperType
  supplier_name: string
  deckle_mm?: number
  deckle_inch?: number
  deckle_size?: string
  gsm: string
  bf: string
  color: string
  intake_condition?: ReelIntakeCondition
  remark?: string
}) {
  const reel = await db.reel_stocks.get(data.reel_id)
  if (!reel || reel.is_deleted || reel.firm_id !== data.firm_id) throw new Error('Selected reel stock nahi mila')
  const reel_no = String(data.reel_no || '').trim()
  if (!reel_no) throw new Error('Reel number required')
  await assertUniqueReelNos(data.firm_id, [reel_no], data.reel_id)
  const mill = String(data.supplier_name || '').trim()
  if (!mill) throw new Error('Paper mill required')
  const gsm = String(data.gsm || '').trim()
  const bf = String(data.bf || '').trim()
  if (!gsm || !bf) throw new Error('GSM / BF required')
  const deckle = resolveDecklePair({
    deckle_mm: data.deckle_mm,
    deckle_inch: data.deckle_inch,
    deckle_size: data.deckle_size || reel.deckle_size,
  })
  const remark = String(data.remark || '').trim()
  const updated = plain({
    ...reel,
    reel_no,
    paper_type: normalizePaperType(data.paper_type ?? reel.paper_type),
    supplier_name: mill,
    deckle_size: deckle.deckle_size || reel.deckle_size,
    deckle_mm: deckle.deckle_mm || undefined,
    deckle_inch: deckle.deckle_inch || undefined,
    gsm,
    bf,
    color: normalizeReelColor(data.color),
    intake_condition: data.intake_condition === 'partial' ? 'partial' : 'fresh',
    remark: remark || undefined,
    updated_at: nowISO(),
    _dirty: true,
  }) as ReelStock
  await db.reel_stocks.put(updated)
  return updated
}

export function filterReelLinkedMovements(movements: StockMovement[], reelIds: Iterable<string>) {
  const ids = new Set([...reelIds].filter(Boolean))
  if (!ids.size) return []
  return movements.filter((m) => !m.is_deleted && !!m.stock_ref_id && ids.has(m.stock_ref_id))
}

export function extractReelUseFromMovementNotes(notes?: string): string {
  const raw = String(notes || '').trim()
  if (!raw) return ''
  const afterRemaining = raw.match(/Remaining set to [\d.]+ KG \(was [\d.]+\)\s*[·•\-–—]\s*(.+)$/i)
  if (afterRemaining) return afterRemaining[1].trim()
  let s = raw.replace(
    /^(?:Manual reel consumption|Full consume via remaining update|Partial via remaining weight|Full consume selected)\s*[-–—]\s*/i,
    '',
  ).trim()
  if (/^Remaining set to [\d.]+ KG \(was [\d.]+\)\s*$/i.test(s)) return ''
  return s.replace(/^Remaining set to [\d.]+ KG \(was [\d.]+\)(?:\s*[-–—]\s*)?/i, '').trim()
}

export function formatReelConsumptionSummary(
  movements: StockMovement[],
  reelId: string,
): { short: string; detail: string; count: number } {
  const entries = filterReelLinkedMovements(movements, [reelId])
    .filter((m) => m.source === 'consumption' && (Number(m.weight_out) || 0) > 0)
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.created_at || '').localeCompare(String(b.created_at || '')))
    .map((m) => {
      const use = extractReelUseFromMovementNotes(m.notes)
      const parts = [String(m.date || '').slice(0, 10), `${roundWeight(m.weight_out).toFixed(2)} KG`]
      if (use) parts.push(use)
      return parts.join(' · ')
    })
  if (!entries.length) return { short: '—', detail: '', count: 0 }
  const short = entries.length <= 2 ? entries.join('; ') : `${entries.slice(-2).join('; ')} (+${entries.length - 2} more)`
  return { short, detail: entries.join('\n'), count: entries.length }
}

export async function softDeleteReelsWithMovements(firmId: string, reelIds: string[]) {
  const ids = [...new Set((reelIds || []).filter(Boolean))]
  if (!ids.length) return { reelsDeleted: 0, movementsDeleted: 0 }
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
  return { reelsDeleted, movementsDeleted }
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
  stockStatus: ReelBreakdownStockStatus
}

export function reelInventorySummary(reels: ReelStock[]) {
  let totalReels = 0
  let activeReels = 0
  let consumedReels = 0
  let lowStockReels = 0
  let zeroStockReels = 0
  let openingWeight = 0
  let currentWeight = 0
  const breakdownMap = new Map<string, ReelInventoryBreakdownRow>()

  for (const reel of reels) {
    const paper_type = normalizePaperType(reel.paper_type)
    const open = Number(reel.opening_weight) || 0
    const cur = Number(reel.current_weight) || 0
    totalReels += 1
    openingWeight += open
    currentWeight += cur
    if (reel.status === 'active') {
      activeReels += 1
      if (cur <= 0) zeroStockReels += 1
      else if (cur < REEL_LOW_STOCK_KG || (open > 0 && cur / open < 0.15)) lowStockReels += 1
    } else {
      consumedReels += 1
    }
    const deckle = reel.deckle_size || formatDeckleDisplay(Number(reel.deckle_mm) || 0, Number(reel.deckle_inch) || 0) || '—'
    const color = normalizeReelColor(reel.color)
    const key = `${paper_type}|${reel.gsm}|${reel.bf}|${deckle}|${color}`
    let row = breakdownMap.get(key)
    if (!row) {
      row = {
        key,
        paper_type,
        gsm: reel.gsm || '—',
        bf: reel.bf || '—',
        deckle,
        color,
        reels: 0,
        activeReels: 0,
        openingWeight: 0,
        currentWeight: 0,
        consumedWeight: 0,
        stockStatus: 'zero',
      }
      breakdownMap.set(key, row)
    }
    row.reels += 1
    row.openingWeight += open
    row.currentWeight += cur
    row.consumedWeight += Math.max(0, open - cur)
    if (reel.status === 'active' && cur > 0) row.activeReels += 1
  }

  const breakdown = [...breakdownMap.values()].map((row) => {
    const stockStatus: ReelBreakdownStockStatus =
      row.activeReels === 0 || row.currentWeight <= 0
        ? 'zero'
        : row.currentWeight < REEL_LOW_STOCK_KG || (row.openingWeight > 0 && row.currentWeight / row.openingWeight < 0.15)
          ? 'low'
          : 'ok'
    return { ...row, stockStatus }
  })

  return {
    totalReels,
    activeReels,
    consumedReels,
    zeroStockReels,
    lowStockReels,
    openingWeight,
    currentWeight,
    consumedWeight: Math.max(0, openingWeight - currentWeight),
    breakdown,
  }
}
