import Dexie, { type Table } from 'dexie'
import type { Party, Item, Firm, Invoice, Recipe, Purchase, Voucher, Account, ActivityLog } from '@/types/models'

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
  }
}

export const db = new PamaDB()
