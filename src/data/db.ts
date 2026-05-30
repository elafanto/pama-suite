import Dexie, { type Table } from 'dexie'
import type { Party, Item, Firm, Invoice } from '@/types/models'

/**
 * Local-first database (IndexedDB via Dexie).
 * This is the single source of truth on-device. A future Supabase sync layer
 * will mirror these tables to the cloud using each record's _dirty flag +
 * updated_at, without modules needing to change.
 */
export class PamaDB extends Dexie {
  parties!: Table<Party, string>
  items!: Table<Item, string>
  firms!: Table<Firm, string>
  invoices!: Table<Invoice, string>

  constructor() {
    super('PamaSuiteDB')
    this.version(1).stores({
      // indexes (not full schema) — id is primary key
      parties:  'id, firm_id, name, gst, is_deleted, updated_at, _dirty',
      items:    'id, firm_id, name, hsn, is_deleted, updated_at, _dirty',
      firms:    'id, name, is_deleted, updated_at, _dirty',
      invoices: 'id, firm_id, bill_no, party_id, date, pay_status, is_deleted, updated_at, _dirty',
    })
  }
}

export const db = new PamaDB()
