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
  created_at: string
  updated_at: string
  is_deleted: boolean
  _dirty?: boolean
}

export interface InvoiceItemLine {
  item_id: string | null
  name: string
  hsn: string
  size: string
  qty: number
  unit: ItemUnit
  rate: number
  gst: number                 // %
}

export type GstType = 'IGST' | 'CGST_SGST'
export type PayStatus = 'PAID' | 'PARTIAL' | 'UNPAID'

export interface Invoice extends BaseRecord {
  doc_type: 'invoice'
  bill_no: string
  date: string
  party_id: string | null
  party_name: string
  party_snapshot: Partial<Party>   // frozen at bill time
  gst_type: GstType
  items: InvoiceItemLine[]
  sub: number
  total_tax: number
  round_off: number
  grand_total: number
  amt_paid: number
  pay_status: PayStatus
  notes: string
}
