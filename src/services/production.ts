import { db } from '@/data/db'
import { uid, nowISO } from '@/data/util'
import type {
  ProductionJob,
  ProductionStageEntry,
  ProductionStockType,
  Purchase,
  ReelStock,
  StockMovement,
} from '@/types/models'

const plain = <X>(o: X): X => JSON.parse(JSON.stringify(o))

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
  waste: 'Waste',
}

export function newStockMovement(data: Omit<StockMovement, 'id' | 'created_at' | 'updated_at' | 'is_deleted' | '_dirty'>): StockMovement {
  const now = nowISO()
  return plain({ ...data, id: uid(), created_at: now, updated_at: now, is_deleted: false, _dirty: true })
}

export async function createReelsFromPurchase(purchase: Purchase) {
  const existing = await db.reel_stocks.where('purchase_id').equals(purchase.id).toArray().catch(() => [])
  const existingIds = new Set(existing.filter((r) => !r.is_deleted).map((r) => r.reel_no))
  const now = nowISO()
  let count = 0

  for (const [idx, row] of purchase.items.entries()) {
    if (!row.is_kraft_reel) continue
    const reelNo = (row.reel_no || `${purchase.bill_no}-${idx + 1}`).trim()
    if (existingIds.has(reelNo)) continue
    const weight = Number(row.reel_weight || row.qty || 0)
    const reel: ReelStock = plain({
      id: uid(),
      firm_id: purchase.firm_id,
      reel_no: reelNo,
      supplier_id: purchase.supplier_id,
      supplier_name: purchase.supplier_name,
      purchase_id: purchase.id,
      purchase_bill_no: purchase.bill_no,
      deckle_size: row.deckle_size || '',
      gsm: row.gsm || '',
      bf: row.bf || '',
      color: row.color || 'NATURAL_BROWN',
      opening_weight: weight,
      current_weight: weight,
      rate: Number(row.rate) || 0,
      status: weight > 0 ? 'active' : 'consumed',
      created_at: now,
      updated_at: now,
      is_deleted: false,
      _dirty: true,
    }) as ReelStock
    await db.reel_stocks.add(reel)
    await db.stock_movements.add(newStockMovement({
      firm_id: purchase.firm_id,
      date: purchase.received_date || purchase.date,
      source: 'purchase',
      ref_id: purchase.id,
      stock_type: 'raw_reel',
      stock_ref_id: reel.id,
      qty_in: 0,
      qty_out: 0,
      weight_in: weight,
      weight_out: 0,
      waste_qty: 0,
      waste_weight: 0,
      notes: `Reel ${reelNo} from purchase ${purchase.bill_no}`,
    }))
    count++
  }
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
