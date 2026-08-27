import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/data/db'
import { uid, nowISO } from '@/data/util'
import { useFirmStore } from './firm'
import { logActivity } from '@/services/activityLog'
import {
  consumePaperReel,
  consumeConsumableLot,
  createManualConsumable,
  createManualReels,
  feedConsumable,
  feedPaperReel,
  feedPaperReelsBatch,
  filterReelsForDeletion,
  fullConsumeReels,
  resetAllFirmReelStock,
  saveProductionStage,
  saveStockAdjustment,
  softDeleteReelsWithMovements,
  updateReelRemainingWeight,
  type ConsumableStockType,
} from '@/services/production'
import type { ConsumableLot, PaperType, ProductionJob, ProductionStageEntry, ProductionStockType, ReelStock, StockMovement } from '@/types/models'

const plain = <X>(o: X): X => JSON.parse(JSON.stringify(o))

export const useProductionStore = defineStore('production', () => {
  const jobs = ref<ProductionJob[]>([])
  const stages = ref<ProductionStageEntry[]>([])
  const reels = ref<ReelStock[]>([])
  const consumableLots = ref<ConsumableLot[]>([])
  const movements = ref<StockMovement[]>([])
  const loaded = ref(false)

  async function load() {
    const firm = useFirmStore()
    const firmId = firm.activeFirmId
    const [j, s, r, lots, m] = await Promise.all([
      db.production_jobs.where('firm_id').equals(firmId).filter((x) => !x.is_deleted).toArray(),
      db.production_stages.where('firm_id').equals(firmId).filter((x) => !x.is_deleted).toArray(),
      db.reel_stocks.where('firm_id').equals(firmId).filter((x) => !x.is_deleted).toArray(),
      db.consumable_lots.where('firm_id').equals(firmId).filter((x) => !x.is_deleted).toArray(),
      db.stock_movements.where('firm_id').equals(firmId).filter((x) => !x.is_deleted).toArray(),
    ])
    jobs.value = j.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    stages.value = s.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    reels.value = r.sort((a, b) => a.reel_no.localeCompare(b.reel_no))
    consumableLots.value = lots.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.created_at.localeCompare(a.created_at))
    movements.value = m.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    loaded.value = true
  }

  async function addJob(data: Omit<ProductionJob, 'id' | 'firm_id' | 'created_at' | 'updated_at' | 'is_deleted' | '_dirty'>) {
    const firm = useFirmStore()
    const now = nowISO()
    const rec = plain({
      ...data,
      id: uid(),
      firm_id: firm.activeFirmId,
      created_at: now,
      updated_at: now,
      is_deleted: false,
      _dirty: true,
    }) as ProductionJob
    await db.production_jobs.add(rec)
    await logActivity(rec.firm_id, 'create', 'production_job', rec.id, `Production job ${rec.job_no} created`)
    await load()
    return rec
  }

  async function addStage(data: Omit<ProductionStageEntry, 'id' | 'firm_id' | 'created_at' | 'updated_at' | 'is_deleted' | '_dirty'>) {
    const firm = useFirmStore()
    const rec = await saveProductionStage({ ...data, firm_id: firm.activeFirmId })
    await logActivity(rec.firm_id, 'create', 'production_stage', rec.id, `${rec.stage} entry saved`)
    await load()
    return rec
  }

  async function closeJob(id: string) {
    const job = await db.production_jobs.get(id)
    if (!job) return
    await db.production_jobs.put({ ...job, status: 'closed', updated_at: nowISO(), _dirty: true })
    await load()
  }

  async function addStockAdjustment(data: {
    date: string
    stock_type: ProductionStockType
    mode: 'add' | 'consume'
    qty: number
    weight: number
    notes?: string
  }) {
    const firm = useFirmStore()
    const rec = await saveStockAdjustment({ ...data, firm_id: firm.activeFirmId })
    await logActivity(rec.firm_id, 'create', 'stock_movement', rec.id, rec.notes || `${rec.stock_type} adjustment`)
    await load()
    return rec
  }

  async function addReelConsumption(data: {
    reel_id: string
    date: string
    used_weight: number
    job_id?: string
    reason?: string
    notes?: string
  }) {
    const firm = useFirmStore()
    const rec = await consumePaperReel({ ...data, firm_id: firm.activeFirmId })
    await logActivity(rec.firm_id, 'consume', 'reel_stock', data.reel_id, rec.notes || 'Paper reel consumed')
    await load()
    return rec
  }

  async function addManualReel(data: {
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
    intake_condition?: 'fresh' | 'partial'
    remark?: string
    lines?: Array<{ reel_no: string; opening_weight: number }>
  }) {
    const firm = useFirmStore()
    const created = await createManualReels({ ...data, firm_id: firm.activeFirmId })
    const label = created.length === 1
      ? `Manual reel ${created[0].reel_no} added`
      : `Manual ${created.length} reels added (${created[0].reel_no}…${created[created.length - 1].reel_no})`
    await logActivity(created[0].firm_id, 'create', 'reel_stock', created[0].id, label)
    await load()
    return created
  }

  async function feedReel(data: {
    reel_id: string
    date: string
    mode: 'full' | 'partial'
    used_weight?: number
    job_id?: string
    reason?: string
    notes?: string
  }) {
    const firm = useFirmStore()
    const rec = await feedPaperReel({ ...data, firm_id: firm.activeFirmId })
    await logActivity(rec.firm_id, 'consume', 'reel_stock', data.reel_id, rec.notes || 'Paper reel fed')
    await load()
    return rec
  }

  async function feedReelsBatch(data: {
    reel_ids: string[]
    date: string
    mode: 'full' | 'partial'
    used_weight?: number
    job_id?: string
    reason?: string
    notes?: string
  }) {
    const firm = useFirmStore()
    const recs = await feedPaperReelsBatch({ ...data, firm_id: firm.activeFirmId })
    await logActivity(
      firm.activeFirmId,
      'consume',
      'reel_stock',
      data.reel_ids[0] || '',
      `Batch fed ${recs.length} reels`,
    )
    await load()
    return recs
  }

  async function addManualConsumable(data: {
    date: string
    stock_type: ConsumableStockType
    qty: number
    weight: number
    pack_size_kg?: number
    notes?: string
    remark?: string
  }) {
    const firm = useFirmStore()
    const rec = await createManualConsumable({ ...data, firm_id: firm.activeFirmId })
    await logActivity(firm.activeFirmId, 'create', 'consumable_lot', rec.id, rec.remark || 'Consumable lot added')
    await load()
    return rec
  }

  async function feedConsumableStock(data: {
    date: string
    stock_type: ConsumableStockType
    mode: 'full' | 'partial'
    qty?: number
    weight?: number
    notes?: string
    remark?: string
  }) {
    const firm = useFirmStore()
    const rec = await feedConsumable({
      ...data,
      firm_id: firm.activeFirmId,
      movements: movements.value,
      lots: consumableLots.value,
    })
    await logActivity(rec.firm_id, 'consume', 'stock_movement', rec.id, rec.notes || 'Consumable fed')
    await load()
    return rec
  }

  async function consumeLot(data: {
    lot_id: string
    mode?: 'full' | 'partial'
    packs?: number
    weight?: number
    remark?: string
    date?: string
  }) {
    const firm = useFirmStore()
    const rec = await consumeConsumableLot({ ...data, firm_id: firm.activeFirmId })
    await logActivity(firm.activeFirmId, 'consume', 'consumable_lot', data.lot_id, rec.notes || 'Consumable lot consumed')
    await load()
    return rec
  }

  async function deleteReel(reelId: string) {
    const firm = useFirmStore()
    const reel = reels.value.find((r) => r.id === reelId)
    const result = await softDeleteReelsWithMovements(firm.activeFirmId, [reelId])
    if (result.reelsDeleted > 0) {
      await logActivity(
        firm.activeFirmId,
        'delete',
        'reel_stock',
        reelId,
        `Reel ${reel?.reel_no || reelId} deleted (${result.movementsDeleted} movements)`,
        { movementsDeleted: result.movementsDeleted },
      )
    }
    await load()
    return result
  }

  async function deleteReels(reelIds: string[]) {
    const firm = useFirmStore()
    const result = await softDeleteReelsWithMovements(firm.activeFirmId, reelIds)
    if (result.reelsDeleted > 0) {
      await logActivity(
        firm.activeFirmId,
        'delete',
        'reel_stock',
        result.reelIds[0] || '',
        `Deleted ${result.reelsDeleted} reels (${result.movementsDeleted} movements)`,
        { reelIds: result.reelIds, movementsDeleted: result.movementsDeleted },
      )
    }
    await load()
    return result
  }

  async function deleteConsumedReels() {
    const targets = filterReelsForDeletion(reels.value, { consumedOnly: true })
    return deleteReels(targets.map((r) => r.id))
  }

  async function deleteReelsBeforeDate(beforeDate: string, opts?: { consumedOnly?: boolean }) {
    const targets = filterReelsForDeletion(reels.value, {
      beforeDate,
      consumedOnly: opts?.consumedOnly,
    })
    return deleteReels(targets.map((r) => r.id))
  }

  async function resetAllReelStock() {
    const firm = useFirmStore()
    const result = await resetAllFirmReelStock(firm.activeFirmId)
    if (result.reelsDeleted > 0) {
      await logActivity(
        firm.activeFirmId,
        'delete',
        'reel_stock',
        result.reelIds[0] || '',
        `Reset all reel stock — ${result.reelsDeleted} reels, ${result.movementsDeleted} movements`,
        { reelIds: result.reelIds, movementsDeleted: result.movementsDeleted },
      )
    }
    await load()
    return result
  }

  async function updateReelRemaining(reelId: string, remainingKg: number, date?: string, notes?: string) {
    const firm = useFirmStore()
    const rec = await updateReelRemainingWeight({
      firm_id: firm.activeFirmId,
      reel_id: reelId,
      remaining_kg: remainingKg,
      date,
      notes,
    })
    await logActivity(firm.activeFirmId, 'consume', 'reel_stock', reelId, rec.notes || 'Remaining weight updated')
    await load()
    return rec
  }

  async function fullConsumeSelected(reelIds: string[], date?: string, notes?: string) {
    const firm = useFirmStore()
    const recs = await fullConsumeReels({
      firm_id: firm.activeFirmId,
      reel_ids: reelIds,
      date,
      notes,
    })
    await logActivity(
      firm.activeFirmId,
      'consume',
      'reel_stock',
      reelIds[0] || '',
      `Full consumed ${recs.length} reels`,
    )
    await load()
    return recs
  }

  return {
    jobs,
    stages,
    reels,
    consumableLots,
    movements,
    loaded,
    load,
    addJob,
    addStage,
    closeJob,
    addStockAdjustment,
    addReelConsumption,
    addManualReel,
    feedReel,
    feedReelsBatch,
    addManualConsumable,
    feedConsumableStock,
    consumeLot,
    deleteReel,
    deleteReels,
    deleteConsumedReels,
    deleteReelsBeforeDate,
    resetAllReelStock,
    updateReelRemaining,
    fullConsumeSelected,
  }
})
