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
  glue: 'Glue',
  ink: 'Ink',
  stitching_wire: 'Stitching Wire',
  waste: 'Waste',
}

export function newStockMovement(data: Omit<StockMovement, 'id' | 'created_at' | 'updated_at' | 'is_deleted' | '_dirty'>): StockMovement {
  const now = nowISO()
  return plain({ ...data, id: uid(), created_at: now, updated_at: now, is_deleted: false, _dirty: true })
}

const CONSUMABLE_STOCK_TYPES = new Set<ProductionStockType>(['glue', 'ink', 'stitching_wire'])

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
}

function roundWeight(value: number) {
  return Math.round((Number(value) || 0) * 1000) / 1000
}

function reelKey(reelNo: string) {
  return reelNo.trim().toLowerCase()
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
    }
  }).filter((spec) => reelKey(spec.reel_no))
}

export async function createManualReel(data: {
  firm_id: string
  reel_no: string
  paper_type?: PaperType
  deckle_size: string
  gsm: string
  bf: string
  color: string
  opening_weight: number
  rate?: number
  supplier_name: string
  supplier_id?: string | null
  date?: string
}) {
  const reel_no = String(data.reel_no || '').trim()
  const opening_weight = roundWeight(data.opening_weight)
  if (!reel_no) throw new Error('Custom reel number required')
  if (opening_weight <= 0) throw new Error('Reel weight 0 se zyada hona chahiye')
  if (!String(data.deckle_size || '').trim()) throw new Error('Deckle / size required')
  if (!String(data.gsm || '').trim()) throw new Error('GSM required')
  if (!String(data.bf || '').trim()) throw new Error('BF required')
  if (!String(data.supplier_name || '').trim()) throw new Error('Paper mill required')

  await assertUniqueReelNo(data.firm_id, reel_no)

  const now = nowISO()
  const paper_type = normalizePaperType(data.paper_type)
  const color = normalizeReelColor(data.color)
  const mill = String(data.supplier_name || '').trim()
  const reel = plain({
    id: uid(),
    firm_id: data.firm_id,
    reel_no,
    paper_type,
    supplier_id: data.supplier_id ?? null,
    supplier_name: mill,
    deckle_size: String(data.deckle_size || '').trim(),
    gsm: String(data.gsm || '').trim(),
    bf: String(data.bf || '').trim(),
    color,
    opening_weight,
    current_weight: opening_weight,
    rate: Number(data.rate) || 0,
    status: 'active' as const,
    created_at: now,
    updated_at: now,
    is_deleted: false,
    _dirty: true,
  }) as ReelStock

  const movement = newStockMovement({
    firm_id: data.firm_id,
    date: data.date || now.slice(0, 10),
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
    notes: `Manual reel opening — ${reel_no} (${mill})`,
  })

  await db.transaction('rw', db.reel_stocks, db.stock_movements, async () => {
    await db.reel_stocks.add(reel)
    await db.stock_movements.add(movement)
  })

  return reel
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

export async function createConsumablesFromPurchase(purchase: Purchase) {
  const rows = (purchase.items || [])
    .filter((row) => row.is_consumable && row.consumable_type)
    .map((row) => {
      const qty = Number(row.qty) || 0
      const weight = row.unit?.toUpperCase() === 'KG' ? qty : 0
      return {
        firm_id: purchase.firm_id,
        date: purchase.received_date || purchase.date,
        source: 'purchase' as const,
        ref_id: purchase.id,
        stock_type: row.consumable_type!,
        qty_in: qty,
        qty_out: 0,
        weight_in: weight,
        weight_out: 0,
        waste_qty: 0,
        waste_weight: 0,
        notes: `${STOCK_LABELS[row.consumable_type!]} from purchase ${purchase.bill_no}`,
      }
    })

  const existing = await db.stock_movements
    .where('ref_id')
    .equals(purchase.id)
    .filter((m) => m.source === 'purchase' && CONSUMABLE_STOCK_TYPES.has(m.stock_type))
    .toArray()
  const unused = [...existing]
  const now = nowISO()
  let count = 0

  await db.transaction('rw', db.stock_movements, async () => {
    for (const row of rows) {
      const existingIdx = unused.findIndex((movement) =>
        movement.stock_type === row.stock_type &&
        Number(movement.qty_in) === row.qty_in &&
        Number(movement.weight_in) === row.weight_in &&
        movement.date === row.date,
      )
      const movement = existingIdx >= 0 ? unused.splice(existingIdx, 1)[0] : undefined
      if (movement) {
        await db.stock_movements.put(plain({
          ...movement,
          ...row,
          updated_at: now,
          is_deleted: false,
          _dirty: true,
        }))
      } else {
        await db.stock_movements.add(newStockMovement(row))
      }
      count++
    }

    for (const movement of unused) {
      if (!movement.is_deleted) {
        await db.stock_movements.put({ ...movement, is_deleted: true, updated_at: now, _dirty: true })
      }
    }
  })

  return count
}

export async function reversePurchaseReels(purchaseId: string) {
  const reels = await db.reel_stocks.where('purchase_id').equals(purchaseId).toArray()
  const now = nowISO()
  for (const reel of reels) {
    await db.reel_stocks.put({ ...reel, is_deleted: true, updated_at: now, _dirty: true })
  }
  const moves = await db.stock_movements.where('ref_id').equals(purchaseId).toArray()
  for (const m of moves.filter((x) => x.source === 'purchase')) {
    await db.stock_movements.put({ ...m, is_deleted: true, updated_at: now, _dirty: true })
  }
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
