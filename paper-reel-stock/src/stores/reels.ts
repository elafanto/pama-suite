import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/data/db'
import { nowISO } from '@/data/util'
import { STANDALONE_FIRM_ID, type ReelStock, type StockMovement } from '@/types/models'
import {
  createManualReels,
  fullConsumeReels,
  softDeleteReelsWithMovements,
  updateReelRemainingWeight,
  updateReelSpecification,
  type ReelIntakeCondition,
} from '@/services/reel'
import type { PaperType } from '@/types/models'

export const useReelStore = defineStore('reels', () => {
  const firmId = STANDALONE_FIRM_ID
  const firmName = ref('Paper Reel Stock')
  const reels = ref<ReelStock[]>([])
  const movements = ref<StockMovement[]>([])
  const loaded = ref(false)

  async function load() {
    const [r, m, settings] = await Promise.all([
      db.reel_stocks.where('firm_id').equals(firmId).filter((x) => !x.is_deleted).toArray(),
      db.stock_movements.where('firm_id').equals(firmId).filter((x) => !x.is_deleted).toArray(),
      db.settings.get('app'),
    ])
    reels.value = r.sort((a, b) => (a.reel_no || '').localeCompare(b.reel_no || '', undefined, { numeric: true }))
    movements.value = m.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created_at).localeCompare(String(a.created_at)))
    if (settings?.firm_name) firmName.value = settings.firm_name
    else {
      await db.settings.put({ id: 'app', firm_name: firmName.value, updated_at: nowISO() })
    }
    loaded.value = true
  }

  async function setFirmName(name: string) {
    firmName.value = String(name || '').trim() || 'Paper Reel Stock'
    await db.settings.put({ id: 'app', firm_name: firmName.value, updated_at: nowISO() })
  }

  async function addReels(data: {
    paper_type?: PaperType
    deckle_mm?: number
    deckle_inch?: number
    gsm: string
    bf: string
    color: string
    supplier_name: string
    date?: string
    intake_condition?: ReelIntakeCondition
    remark?: string
    lines: Array<{ reel_no: string; opening_weight: number }>
  }) {
    await createManualReels({ ...data, firm_id: firmId })
    await load()
  }

  async function updateRemaining(reelId: string, remainingKg: number, notes?: string) {
    await updateReelRemainingWeight({
      firm_id: firmId,
      reel_id: reelId,
      remaining_kg: remainingKg,
      notes,
    })
    await load()
  }

  async function fullConsume(reelIds: string[], notes?: string) {
    await fullConsumeReels({ firm_id: firmId, reel_ids: reelIds, notes })
    await load()
  }

  async function updateSpecs(data: Parameters<typeof updateReelSpecification>[0]) {
    await updateReelSpecification({ ...data, firm_id: firmId })
    await load()
  }

  async function removeReels(reelIds: string[]) {
    await softDeleteReelsWithMovements(firmId, reelIds)
    await load()
  }

  return {
    firmId,
    firmName,
    reels,
    movements,
    loaded,
    load,
    setFirmName,
    addReels,
    updateRemaining,
    fullConsume,
    updateSpecs,
    removeReels,
  }
})
