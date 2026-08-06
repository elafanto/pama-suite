import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/data/db'
import { uid, nowISO } from '@/data/util'
import { useFirmStore } from './firm'
import { logActivity } from '@/services/activityLog'
import { consumePaperReel, createManualReel, feedPaperReel, saveProductionStage, saveStockAdjustment } from '@/services/production'
import type { PaperType, ProductionJob, ProductionStageEntry, ProductionStockType, ReelStock, StockMovement } from '@/types/models'

const plain = <X>(o: X): X => JSON.parse(JSON.stringify(o))

export const useProductionStore = defineStore('production', () => {
  const jobs = ref<ProductionJob[]>([])
  const stages = ref<ProductionStageEntry[]>([])
  const reels = ref<ReelStock[]>([])
  const movements = ref<StockMovement[]>([])
  const loaded = ref(false)

  async function load() {
    const firm = useFirmStore()
    const firmId = firm.activeFirmId
    const [j, s, r, m] = await Promise.all([
      db.production_jobs.where('firm_id').equals(firmId).filter((x) => !x.is_deleted).toArray(),
      db.production_stages.where('firm_id').equals(firmId).filter((x) => !x.is_deleted).toArray(),
      db.reel_stocks.where('firm_id').equals(firmId).filter((x) => !x.is_deleted).toArray(),
      db.stock_movements.where('firm_id').equals(firmId).filter((x) => !x.is_deleted).toArray(),
    ])
    jobs.value = j.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    stages.value = s.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    reels.value = r.sort((a, b) => a.reel_no.localeCompare(b.reel_no))
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
    const firm = useFirmStore()
    const rec = await createManualReel({ ...data, firm_id: firm.activeFirmId })
    await logActivity(rec.firm_id, 'create', 'reel_stock', rec.id, `Manual reel ${rec.reel_no} added`)
    await load()
    return rec
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

  return {
    jobs,
    stages,
    reels,
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
  }
})
