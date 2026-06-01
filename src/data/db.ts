import Dexie, { type Table } from 'dexie'
import type {
  Party, Item, Firm, Invoice, Recipe, Purchase, Voucher, Account, ActivityLog,
  ReelStock, ProductionJob, ProductionStageEntry, StockMovement,
} from '@/types/models'

export class PamaDB extends Dexie {
  parties!: Table<Party, string>
  items!: Table<Item, string>
  firms!: Table<Firm, string>
  invoices!: Table<Invoice, string>
  recipes!: Table<Recipe, string>
  purchases!: Table<Purchase, string>
  accounts!: Table<Account, string>
  vouchers!: Table<Voucher, string>
  activity_log!: Table<ActivityLog, string>
  reel_stocks!: Table<ReelStock, string>
  production_jobs!: Table<ProductionJob, string>
  production_stages!: Table<ProductionStageEntry, string>
  stock_movements!: Table<StockMovement, string>

  constructor() {
    super('PamaSuiteDB')
    this.version(2).stores({
      parties:  'id, firm_id, name, gst, is_deleted, updated_at, _dirty',
      items:    'id, firm_id, name, hsn, is_deleted, updated_at, _dirty',
      firms:    'id, name, is_deleted, updated_at, _dirty',
      invoices: 'id, firm_id, bill_no, party_id, date, pay_status, is_deleted, updated_at, _dirty',
      recipes:  'id, firm_id, name, customer_name, box_name, is_deleted, updated_at, _dirty',
      purchases: 'id, firm_id, bill_no, party_id, date, pay_status, is_deleted, updated_at, _dirty',
      accounts: 'id, firm_id, code, name, is_deleted, updated_at, _dirty',
      vouchers: 'id, firm_id, voucher_no, date, type, is_deleted, updated_at, _dirty',
    })
    this.version(3).stores({
      parties:  'id, firm_id, name, gst, is_deleted, updated_at, _dirty',
      items:    'id, firm_id, name, hsn, is_deleted, updated_at, _dirty',
      firms:    'id, name, is_deleted, updated_at, _dirty',
      invoices: 'id, firm_id, bill_no, party_id, date, pay_status, is_deleted, updated_at, _dirty',
      recipes:  'id, firm_id, name, customer_name, box_name, is_deleted, updated_at, _dirty',
      purchases: 'id, firm_id, bill_no, party_id, date, pay_status, is_deleted, updated_at, _dirty',
      accounts: 'id, firm_id, code, name, is_deleted, updated_at, _dirty',
      vouchers: 'id, firm_id, voucher_no, date, type, is_deleted, updated_at, _dirty',
      activity_log: 'id, firm_id, entity_type, created_at, is_deleted, updated_at, _dirty',
    })
    this.version(4).stores({
      parties:  'id, firm_id, name, gst, is_deleted, updated_at, _dirty',
      items:    'id, firm_id, name, hsn, is_deleted, updated_at, _dirty',
      firms:    'id, name, is_deleted, updated_at, _dirty',
      invoices: 'id, firm_id, bill_no, party_id, date, pay_status, is_deleted, updated_at, _dirty',
      recipes:  'id, firm_id, name, customer_name, box_name, is_deleted, updated_at, _dirty',
      purchases: 'id, firm_id, bill_no, party_id, date, pay_status, is_deleted, updated_at, _dirty',
      accounts: 'id, firm_id, code, name, is_deleted, updated_at, _dirty',
      vouchers: 'id, firm_id, voucher_no, date, type, is_deleted, updated_at, _dirty',
      activity_log: 'id, firm_id, entity_type, created_at, is_deleted, updated_at, _dirty',
      reel_stocks: 'id, firm_id, reel_no, supplier_id, purchase_id, status, is_deleted, updated_at, _dirty',
      production_jobs: 'id, firm_id, date, customer_id, job_no, status, is_deleted, updated_at, _dirty',
      production_stages: 'id, firm_id, job_id, date, stage, is_deleted, updated_at, _dirty',
      stock_movements: 'id, firm_id, date, source, ref_id, stock_type, job_id, is_deleted, updated_at, _dirty',
    })
  }
}

export const db = new PamaDB()
