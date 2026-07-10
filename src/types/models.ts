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

export type PurchaseLineKind = 'inventory' | 'reel' | 'consumable' | 'capital' | 'expense'
export type ExpenseCategory = 'building_material' | 'utilities' | 'repairs' | 'freight' | 'professional' | 'other'
export type CapitalAssetSource = 'purchase' | 'inventory'

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
  line_kind?: PurchaseLineKind
  is_kraft_reel?: boolean
  paper_type?: PaperType
  reel_no?: string
  deckle_size?: string
  gsm?: string
  bf?: string
  color?: 'NS' | 'GY' | 'NATURAL_BROWN' | string
  reel_weight?: number
  reel_count?: number
  is_consumable?: boolean
  consumable_type?: 'glue' | 'ink' | 'stitching_wire'
  is_capital?: boolean
  capital_category?: CapitalCategory
  asset_tag?: string
  is_expense?: boolean
  expense_category?: ExpenseCategory
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

export interface DashboardTodo extends BaseRecord {
  text: string
  completed: boolean
}

/** Payroll — staff master, attendance, salary (Phase 1). */
export type StaffPayType = 'monthly' | 'daily_wage'
export type AttendanceMark = 'P' | 'A' | 'H' | 'L'

/** Per-day hours: duty (0–8+), off-duty below 8 hr paid/unpaid, overtime. */
export type DayAttendanceKind = 'work' | 'holiday' | 'sunday' | 'leave' | 'absent'

export interface DayAttendance {
  /** Hours on duty; null = day not marked. */
  duty_hours: number | null
  /** Off-duty hours (8 − duty) — paid or unpaid. */
  off_paid: boolean
  /** Overtime hours (beyond 8 hr day). */
  ot_hours: number
  kind?: DayAttendanceKind
}
export type PayrollRunStatus = 'draft' | 'finalized' | 'partial' | 'paid'
export type PayrollPaymentMode = 'cash' | 'transfer'
export type StaffLinePayStatus = 'pending' | 'partial' | 'paid'

export interface StaffLinePayment {
  date: string
  amount: number
  mode: PayrollPaymentMode
}

export interface Staff extends BaseRecord {
  name: string
  phone: string
  designation: string
  pay_type: StaffPayType
  /** Monthly salary (monthly staff) or monthly equivalent for daily wage (÷26). */
  monthly_amount: number
  daily_wage: number
  hourly_wage: number
  bank: string
  acno: string
  ifsc: string
  acname: string
  is_active: boolean
  /** Last working day (YYYY-MM-DD). Staff stays in that month's payroll, hidden from later months. */
  leaving_date?: string
}

export interface StaffAdvance extends BaseRecord {
  staff_id: string
  staff_name: string
  date: string
  amount: number
  mode: PayrollPaymentMode
  narration: string
  /** Payroll month this advance belongs to (YYYY-MM). Defaults from date. */
  payroll_period?: string
  /** Set when deducted from a salary run (YYYY-MM). */
  applied_period?: string
  voucher_id?: string
}

export interface PayrollAdvanceItem {
  advance_id: string
  date: string
  amount: number
  narration: string
}

export interface PayrollLine {
  staff_id: string
  staff_name: string
  pay_type: StaffPayType
  monthly_amount: number
  daily_wage: number
  hourly_wage: number
  /** Day key "01".."31" → hour breakdown */
  day_hours: Record<string, DayAttendance>
  /** @deprecated legacy marks — migrated to day_hours on load */
  attendance?: Record<string, AttendanceMark | ''>
  days_present: number
  days_half: number
  days_absent: number
  days_leave: number
  total_duty_hours: number
  total_off_unpaid_hours: number
  total_ot_hours: number
  total_paid_hours: number
  earned: number
  advance_deduction: number
  /** Advances in this salary cycle, date-wise (for payslip breakdown). */
  advance_items: PayrollAdvanceItem[]
  other_deduction: number
  net_pay: number
  /** Salary actually paid to staff (sum of payments). */
  paid_amount: number
  pay_status: StaffLinePayStatus
  payments: StaffLinePayment[]
  payment_date?: string
  payment_mode?: PayrollPaymentMode
}

export interface PayrollRun extends BaseRecord {
  period: string
  year: number
  month: number
  lines: PayrollLine[]
  total_earned: number
  total_advance: number
  total_other: number
  total_net: number
  status: PayrollRunStatus
  /** Include advances with date on or after this (YYYY-MM-DD). */
  advance_from?: string
  /** Include advances with date on or before this (YYYY-MM-DD). */
  advance_to?: string
  payment_mode: PayrollPaymentMode
  payment_date: string
  voucher_id?: string
  paid_at?: string
}

export type DocumentEntityType = 'purchase' | 'invoice' | 'voucher'
export type DocumentUploadStatus = 'pending' | 'uploaded' | 'failed'

export interface DocumentAttachment extends BaseRecord {
  firm_id: string
  entity_type: DocumentEntityType
  entity_id: string
  party_name: string
  doc_no: string
  doc_date: string
  storage_path: string
  stored_name: string
  virtual_path: string
  mime_type: string
  size_bytes: number
  original_name: string
  upload_status: DocumentUploadStatus
  upload_error?: string
  has_local_blob?: boolean
}

export type ReelColor = 'NS' | 'GY' | 'NATURAL_BROWN' | string
export type ReelStatus = 'active' | 'consumed'
export type PaperType = 'KRAFT' | 'DUPLEX'

export type CapitalCategory = 'plant_machinery' | 'furniture' | 'vehicle' | 'computer' | 'other'
export type CapitalAssetStatus = 'active' | 'disposed' | 'written_off'

export interface CapitalAsset extends BaseRecord {
  name: string
  item_id: string | null
  category: CapitalCategory
  asset_tag?: string
  supplier_id: string | null
  supplier_name: string
  purchase_id?: string
  purchase_bill_no?: string
  purchase_line_index?: number
  purchase_date: string
  source?: CapitalAssetSource
  qty: number
  unit: string
  rate: number
  amount: number
  hsn?: string
  status: CapitalAssetStatus
  notes?: string
}

export type StockStatementSegment = 'paper' | 'gum' | 'stitching_wire' | 'consumables'

export interface StockStatementPaperLine {
  id: string
  segment: 'paper'
  paper_name: string
  bf: string
  gsm: string
  qty: number
  unit: string
  rate: number
  amount: number
}

export interface StockStatementSimpleLine {
  id: string
  segment: 'gum' | 'stitching_wire' | 'consumables'
  item_name: string
  qty: number
  unit: string
  rate: number
  amount: number
}

export type StockStatementLine = StockStatementPaperLine | StockStatementSimpleLine

export interface StockStatement extends BaseRecord {
  statement_no: string
  statement_date: string
  bank_name: string
  branch_name?: string
  remarks?: string
  lines: StockStatementLine[]
}

export interface ReelStock extends BaseRecord {
  reel_no: string
  paper_type?: PaperType
  supplier_id: string | null
  supplier_name: string
  purchase_id?: string
  purchase_bill_no?: string
  deckle_size: string
  gsm: string
  bf: string
  color: ReelColor
  opening_weight: number
  current_weight: number
  rate: number
  status: ReelStatus
}

export type ProductionJobStatus = 'open' | 'in_progress' | 'ready' | 'dispatched' | 'closed'
export interface ProductionJob extends BaseRecord {
  date: string
  customer_id: string | null
  customer_name: string
  job_no: string
  item_id: string | null
  box_name: string
  box_size: string
  target_qty: number
  status: ProductionJobStatus
  notes: string
}

export type ProductionStage =
  | 'corrugation'
  | 'paper_cutting'
  | 'pasting'
  | 'thin_blade'
  | 'printer_slotter'
  | 'stitching'
  | 'dispatch'

export type ProductionStockType =
  | 'raw_reel'
  | '2ply'
  | 'cut_sheet'
  | 'pasted_sheet'
  | 'trimmed_sheet'
  | 'printed_sheet'
  | 'finished_box'
  | 'glue'
  | 'ink'
  | 'stitching_wire'
  | 'waste'

export interface ProductionStageEntry extends BaseRecord {
  job_id: string
  date: string
  stage: ProductionStage
  input_stock_type: ProductionStockType
  input_ref_id?: string
  input_qty: number
  input_weight: number
  output_stock_type: ProductionStockType
  output_qty: number
  output_weight: number
  waste_qty: number
  waste_weight: number
  notes: string
}

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

export type ItemStockMovementSource = 'manual' | 'purchase' | 'invoice' | 'production' | 'import'

export interface ItemStockMovement extends BaseRecord {
  item_id: string
  date: string
  source: ItemStockMovementSource
  ref_type: 'manual_adjustment' | 'purchase' | 'invoice' | 'production' | 'opening' | string
  ref_id?: string
  qty_delta: number
  unit: ItemUnit
  rate?: number
  reason_code: string
  notes?: string
}

