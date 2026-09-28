export interface BaseRecord {
  id: string
  firm_id: string
  created_at: string
  updated_at: string
  is_deleted: boolean
  _dirty?: boolean
}

export type PaperType = 'KRAFT' | 'DUPLEX'
export type ReelColor = string
export type ReelStatus = 'active' | 'consumed'

export interface ReelStock extends BaseRecord {
  reel_no: string
  paper_type?: PaperType
  supplier_id: string | null
  supplier_name: string
  purchase_id?: string
  purchase_bill_no?: string
  deckle_size: string
  deckle_mm?: number
  deckle_inch?: number
  gsm: string
  bf: string
  color: ReelColor
  opening_weight: number
  current_weight: number
  rate: number
  status: ReelStatus
  intake_condition?: 'fresh' | 'partial'
  remark?: string
}

export type ProductionStockType = 'raw_reel'

export interface StockMovement extends BaseRecord {
  date: string
  source: 'purchase' | 'production' | 'dispatch' | 'adjustment' | 'consumption'
  ref_id: string
  stock_type: ProductionStockType
  stock_ref_id?: string
  job_id?: string
  customer_id?: string | null
  qty_in: number
  qty_out: number
  weight_in: number
  weight_out: number
  waste_qty: number
  waste_weight: number
  notes?: string
}

export interface AppSettings {
  id: string
  firm_name: string
  updated_at: string
}

/** Fixed local firm scope — this app is single-tenant. */
export const STANDALONE_FIRM_ID = 'reel-app-local'
