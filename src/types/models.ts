// ── Sync-ready base: every record carries these so a cloud sync layer can
//    plug in later without changing modules. ────────────────────────────────
export interface BaseRecord {
  id: string            // uuid
  firm_id: string       // owning company (multi-firm)
  created_at: string    // ISO
  updated_at: string    // ISO
  is_deleted: boolean   // soft delete
  _dirty?: boolean      // pending push to cloud (used by future sync queue)
}

export type PartyRole = 'customer' | 'vendor'

// Unified Party — replaces separate Customer / Vendor / Beneficiary.
export interface Party extends BaseRecord {
  name: string
  roles: PartyRole[]          // ['customer'], ['vendor'], or both
  gst: string
  phone: string
  email: string
  addr: string
  city: string
  pin: string
  state: string               // GST state code, e.g. "05"
  is_consumer: boolean        // B2C (no GST)
  // Bank details (for RTGS/NEFT payments) — lives on the party itself
  bank: string
  acno: string
  ifsc: string
  acname: string
}

export type ItemUnit = 'PCS' | 'KG' | 'MTR' | 'NOS' | 'BOX' | 'SET' | string

export interface Item extends BaseRecord {
  name: string
  unit: ItemUnit
  hsn: string
  gst: number                 // %
  rate: number                // default selling rate
  // box attributes (optional)
  size: string
  gsm: string
  bf: string
  // inventory (optional)
  track_stock?: boolean       // include in stock tracking
  opening_stock?: number      // qty on hand before first recorded txn
  reorder_level?: number      // low-stock threshold
  purchase_rate?: number      // last/standard buy rate (for stock value)
}

export interface Firm {
  id: string
  name: string
  gst: string
  addr: string
  city: string
  state: string
  pin: string
  phone: string
  email: string
  bank_name: string
  bank_acno: string
  bank_ifsc: string
  logo?: string
  signature?: string
  prefix?: string
  next_bill_no?: number
  decl?: string
  terms?: string
  created_at: string
  updated_at: string
  is_deleted: boolean
  _dirty?: boolean
}

export interface InvoiceItemLine {
  item_id: string | null
  name: string
  hsn: string
  size?: string
  gsm?: string
  bf?: string
  extra?: string
  qty: number
  unit: ItemUnit
  rate: number
  gst: number                 // %
}

export type GstType = 'intra' | 'inter' | 'IGST' | 'CGST_SGST'
export type PayStatus = 'PAID' | 'PARTIAL' | 'UNPAID'

export interface ShipDetails {
  name: string
  addr: string
  city: string
  pin: string
  email: string
  gstin: string
  state: string
}

export interface Invoice extends BaseRecord {
  doc_type: 'INVOICE' | 'BILL_OF_SUPPLY' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'invoice'
  bill_no: string
  date: string
  ref?: string
  party_id: string | null
  party_name: string
  party_snapshot: Partial<Party>   // frozen at bill time
  sameAsBuyer?: boolean
  ship?: ShipDetails | null
  dispatch?: string
  lr?: string
  vehicle?: string
  transMode?: string
  transporterName?: string
  transporterId?: string
  eway?: string
  dest?: string
  distance?: number
  docNo?: string
  payment?: string
  gst_type: GstType
  taxBuckets?: Record<number, { taxable: number; tax: number }>
  items: InvoiceItemLine[]
  sub: number
  total_tax: number
  round_off: number
  grand_total: number
  amt_paid: number
  pay_status: PayStatus
  notes: string
  editReason?: string
  deletedAt?: string
  deleteReason?: string
}

export interface Recipe extends BaseRecord {
  name: string
  customer_name: string
  box_name: string
  print_type: 'printed' | 'non-printed'
  dimension_unit: 'mm' | 'inch'
  ply: string
  flute: string
  form: any          // Dynamic inputs object
  results: any       // Dynamic outputs object
}

export interface PurchaseItemLine {
  item_id: string | null
  name: string
  hsn: string
  qty: number
  unit: string
  rate: number
  gst: number                 // %
}

export interface Purchase extends BaseRecord {
  supplier_name: string
  supplier_id: string | null
  bill_no: string
  date: string
  received_date?: string
  payment?: string
  gst_type: GstType
  items: PurchaseItemLine[]
  sub: number
  total_tax: number
  round_off: number
  grand_total: number
  amt_paid: number
  pay_status: PayStatus
  notes: string
}

export interface LedgerEntry {
  accountId: string
  accountName: string
  debit: number
  credit: number
}

export interface Voucher extends BaseRecord {
  voucher_no: string
  date: string
  type: 'SALE' | 'PURCHASE' | 'PAYMENT' | 'RECEIPT' | 'JOURNAL' | 'CONTRA'
  narration: string
  entries: LedgerEntry[]
  ref_id?: string
  ref_type?: string
}

export interface Account extends BaseRecord {
  code: string
  name: string
  group: string
  normal: 'Dr' | 'Cr'
  open_bal_dr: number
  open_bal_cr: number
  is_system: boolean
}

export interface ActivityLog extends BaseRecord {
  action: string
  entity_type: string
  entity_id: string
  summary: string
  meta?: Record<string, unknown>
}

