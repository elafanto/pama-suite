import { isInvoiceActive } from '@/services/invoiceStatus'
import { listRecentIndianFYLabels, type IndianFYRange } from '@/services/documentAuditExport'
import type { Invoice, Purchase } from '@/types/models'

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

export type SalesPurchasePeriodPreset =
  | 'all'
  | 'this_month'
  | 'last_month'
  | 'this_fy'
  | 'last_fy'
  | 'this_calendar_year'
  | 'custom'

export interface PeriodBounds {
  from?: string
  to?: string
  label: string
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function ymd(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`
}

function lastDayOfMonth(y: number, m: number) {
  return new Date(y, m, 0).getDate()
}

export function indianFyRanges(count = 6, ref = new Date()): IndianFYRange[] {
  return listRecentIndianFYLabels(count, ref)
}

export function resolvePeriodBounds(
  preset: SalesPurchasePeriodPreset,
  opts?: { from?: string; to?: string; month?: string; ref?: Date },
): PeriodBounds {
  const ref = opts?.ref || new Date()
  const y = ref.getFullYear()
  const m = ref.getMonth() + 1

  if (preset === 'all') return { label: 'All time' }

  if (preset === 'this_month') {
    return {
      from: ymd(y, m, 1),
      to: ymd(y, m, lastDayOfMonth(y, m)),
      label: `${y}-${pad2(m)}`,
    }
  }

  if (preset === 'last_month') {
    const lm = m === 1 ? 12 : m - 1
    const ly = m === 1 ? y - 1 : y
    return {
      from: ymd(ly, lm, 1),
      to: ymd(ly, lm, lastDayOfMonth(ly, lm)),
      label: `${ly}-${pad2(lm)}`,
    }
  }

  if (preset === 'this_calendar_year') {
    return { from: ymd(y, 1, 1), to: ymd(y, 12, 31), label: String(y) }
  }

  if (preset === 'this_fy' || preset === 'last_fy') {
    const fys = indianFyRanges(2, ref)
    const fy = preset === 'this_fy' ? fys[0] : fys[1]
    return { from: fy.from, to: fy.to, label: fy.label }
  }

  // custom
  const from = (opts?.from || '').trim() || undefined
  const to = (opts?.to || '').trim() || undefined
  if (opts?.month && /^\d{4}-\d{2}$/.test(opts.month)) {
    const [my, mm] = opts.month.split('-').map(Number)
    return {
      from: ymd(my, mm, 1),
      to: ymd(my, mm, lastDayOfMonth(my, mm)),
      label: opts.month,
    }
  }
  const label = from || to ? `${from || '…'} → ${to || '…'}` : 'Custom'
  return { from, to, label }
}

function salesDocKind(inv: Invoice) {
  return String(inv.doc_type || 'INVOICE').toUpperCase()
}

/** Sales register docs: invoices, BOS, debit notes (exclude challan / credit note from revenue totals). */
export function isSalesRegisterDoc(inv: Invoice) {
  const kind = salesDocKind(inv)
  return kind === 'INVOICE' || kind === 'BILL_OF_SUPPLY' || kind === 'DEBIT_NOTE'
}

export function filterSalesInvoices(
  invoices: Invoice[],
  firmId: string,
  from?: string,
  to?: string,
): Invoice[] {
  return invoices
    .filter((i) => isInvoiceActive(i) && i.firm_id === firmId && isSalesRegisterDoc(i))
    .filter((i) => !from || i.date >= from)
    .filter((i) => !to || i.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.bill_no.localeCompare(b.bill_no))
}

export function filterPurchases(
  purchases: Purchase[],
  firmId: string,
  from?: string,
  to?: string,
): Purchase[] {
  return purchases
    .filter((p) => !p.is_deleted && p.firm_id === firmId)
    .filter((p) => {
      const d = p.date || p.received_date || ''
      if (from && d < from) return false
      if (to && d > to) return false
      return true
    })
    .sort((a, b) => {
      const da = a.date || a.received_date || ''
      const db = b.date || b.received_date || ''
      return da.localeCompare(db) || (a.bill_no || '').localeCompare(b.bill_no || '')
    })
}

export interface MoneyTotals {
  billCount: number
  taxable: number
  tax: number
  grandTotal: number
  paid: number
  outstanding: number
}

export interface PeriodBucket extends MoneyTotals {
  key: string
  label: string
}

export interface PartyBucket extends MoneyTotals {
  partyName: string
}

export interface SalesPurchaseSummary {
  period: PeriodBounds
  sales: MoneyTotals
  purchases: MoneyTotals
  net: number
  salesByMonth: PeriodBucket[]
  purchasesByMonth: PeriodBucket[]
  salesByYear: PeriodBucket[]
  purchasesByYear: PeriodBucket[]
  salesByParty: PartyBucket[]
  purchasesByParty: PartyBucket[]
  salesRegister: Invoice[]
  purchaseRegister: Purchase[]
}

function emptyTotals(): MoneyTotals {
  return { billCount: 0, taxable: 0, tax: 0, grandTotal: 0, paid: 0, outstanding: 0 }
}

function addInvoiceTotals(t: MoneyTotals, inv: Invoice) {
  t.billCount += 1
  t.taxable = round2(t.taxable + (inv.sub || 0))
  t.tax = round2(t.tax + (inv.total_tax || 0))
  t.grandTotal = round2(t.grandTotal + (inv.grand_total || 0))
  t.paid = round2(t.paid + (inv.amt_paid || 0))
  t.outstanding = round2(t.outstanding + Math.max(0, (inv.grand_total || 0) - (inv.amt_paid || 0)))
}

function addPurchaseTotals(t: MoneyTotals, pur: Purchase) {
  t.billCount += 1
  t.taxable = round2(t.taxable + (pur.sub || 0))
  t.tax = round2(t.tax + (pur.total_tax || 0))
  t.grandTotal = round2(t.grandTotal + (pur.grand_total || 0))
  t.paid = round2(t.paid + (pur.amt_paid || 0))
  t.outstanding = round2(t.outstanding + Math.max(0, (pur.grand_total || 0) - (pur.amt_paid || 0)))
}

function monthKey(date: string) {
  return (date || '').slice(0, 7)
}

function fyKey(date: string) {
  if (!date || date.length < 7) return 'unknown'
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  const start = m >= 4 ? y : y - 1
  return `FY${start}-${String(start + 1).slice(-2)}`
}

function monthLabel(key: string) {
  if (!/^\d{4}-\d{2}$/.test(key)) return key
  const [y, m] = key.split('-')
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[Number(m) - 1] || m} ${y}`
}

function accumulateByKey<T>(
  rows: T[],
  keyFn: (row: T) => string,
  labelFn: (key: string) => string,
  addFn: (t: MoneyTotals, row: T) => void,
): PeriodBucket[] {
  const map = new Map<string, MoneyTotals>()
  for (const row of rows) {
    const key = keyFn(row)
    if (!map.has(key)) map.set(key, emptyTotals())
    addFn(map.get(key)!, row)
  }
  return [...map.entries()]
    .map(([key, totals]) => ({ key, label: labelFn(key), ...totals }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

function accumulateByParty<T>(
  rows: T[],
  nameFn: (row: T) => string,
  addFn: (t: MoneyTotals, row: T) => void,
): PartyBucket[] {
  const map = new Map<string, MoneyTotals>()
  for (const row of rows) {
    const name = (nameFn(row) || 'Unknown').trim() || 'Unknown'
    if (!map.has(name)) map.set(name, emptyTotals())
    addFn(map.get(name)!, row)
  }
  return [...map.entries()]
    .map(([partyName, totals]) => ({ partyName, ...totals }))
    .sort((a, b) => b.grandTotal - a.grandTotal || a.partyName.localeCompare(b.partyName))
}

export function buildSalesPurchaseSummary(opts: {
  invoices: Invoice[]
  purchases: Purchase[]
  firmId: string
  period: PeriodBounds
}): SalesPurchaseSummary {
  const salesRegister = filterSalesInvoices(opts.invoices, opts.firmId, opts.period.from, opts.period.to)
  const purchaseRegister = filterPurchases(opts.purchases, opts.firmId, opts.period.from, opts.period.to)

  const sales = emptyTotals()
  for (const inv of salesRegister) addInvoiceTotals(sales, inv)

  const purchases = emptyTotals()
  for (const pur of purchaseRegister) addPurchaseTotals(purchases, pur)

  return {
    period: opts.period,
    sales,
    purchases,
    net: round2(sales.grandTotal - purchases.grandTotal),
    salesByMonth: accumulateByKey(salesRegister, (i) => monthKey(i.date), monthLabel, addInvoiceTotals),
    purchasesByMonth: accumulateByKey(
      purchaseRegister,
      (p) => monthKey(p.date || p.received_date || ''),
      monthLabel,
      addPurchaseTotals,
    ),
    salesByYear: accumulateByKey(salesRegister, (i) => fyKey(i.date), (k) => k, addInvoiceTotals),
    purchasesByYear: accumulateByKey(
      purchaseRegister,
      (p) => fyKey(p.date || p.received_date || ''),
      (k) => k,
      addPurchaseTotals,
    ),
    salesByParty: accumulateByParty(salesRegister, (i) => i.party_name, addInvoiceTotals),
    purchasesByParty: accumulateByParty(purchaseRegister, (p) => p.supplier_name, addPurchaseTotals),
    salesRegister,
    purchaseRegister,
  }
}
