import Dexie, { type Table } from 'dexie'
import type { AppSettings, ReelStock, StockMovement } from '@/types/models'

/**
 * Separate IndexedDB from Pama Suite (`PamaSuiteDB`).
 * Name must stay distinct so browsers never mix the two apps.
 */
export class ReelStockDB extends Dexie {
  reel_stocks!: Table<ReelStock, string>
  stock_movements!: Table<StockMovement, string>
  settings!: Table<AppSettings, string>

  constructor() {
    super('ReelStockStandaloneDB')
    this.version(1).stores({
      reel_stocks: 'id, firm_id, reel_no, status, is_deleted, updated_at',
      stock_movements: 'id, firm_id, date, source, stock_type, stock_ref_id, is_deleted, updated_at',
      settings: 'id',
    })
  }
}

export const db = new ReelStockDB()
