import type { Account, Invoice } from '@/types/models'
import { isInvoiceActive } from '@/services/invoiceStatus'

const STATE_NAMES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura',
  '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
  '34': 'Puducherry', '35': 'Andaman & Nicobar', '36': 'Telangana', '37': 'Andhra Pradesh',
  '38': 'Ladakh', '97': 'Other Territory',
}

export function getStateCode(gstin: string): string {
  if (!gstin || gstin.length < 2) return ''
  return gstin.slice(0, 2)
}

export function getStateName(gstinOrCode: string): string {
  const code = gstinOrCode?.length === 2 ? gstinOrCode : getStateCode(gstinOrCode)
  return STATE_NAMES[code] || code || 'Unknown'
}

export function filterInvoices(
  invoices: Invoice[],
  firmId: string,
  from?: string,
  to?: string
): Invoice[] {
  let list = invoices.filter(
    i => isInvoiceActive(i) && i.firm_id === firmId && (i.doc_type === 'INVOICE' || i.doc_type === 'invoice')
  )
  if (from) list = list.filter(i => i.date >= from)
  if (to) list = list.filter(i => i.date <= to)
  return list
}

function salesDocKind(invoice: Invoice) {
  return String(invoice.doc_type || 'INVOICE').toUpperCase()
}

function isReceivableDebitDoc(invoice: Invoice) {
  const kind = salesDocKind(invoice)
  return kind === 'INVOICE' || kind === 'BILL_OF_SUPPLY' || kind === 'DEBIT_NOTE'
}

function isReceivableCreditDoc(invoice: Invoice) {
  return salesDocKind(invoice) === 'CREDIT_NOTE'
}

function roundMoney(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function receivableDebitOutstanding(invoice: Invoice) {
  return Math.max(0, roundMoney((invoice.grand_total || 0) - (invoice.amt_paid || 0)))
}

/** Excess payment parked on one bill — treat as party credit for FIFO allocation. */
function receivableOverpayment(invoice: Invoice) {
  return Math.max(0, roundMoney((invoice.amt_paid || 0) - (invoice.grand_total || 0)))
}

function receivableCreditAmount(invoice: Invoice) {
  return Math.max(0, invoice.grand_total || 0)
}

export function gstrB2B(invoices: Invoice[]) {
  return invoices.filter(b => {
    const snap = b.party_snapshot || {}
    const gst = snap.gst || b.ship?.gstin || ''
    return !snap.is_consumer && gst.length >= 10
  })
}

export function gstrB2C(invoices: Invoice[]) {
  return invoices.filter(b => {
    const snap = b.party_snapshot || {}
    const gst = snap.gst || b.ship?.gstin || ''
    return snap.is_consumer || !gst || gst.length < 10
  })
}

export interface HsnRow {
  hsn: string
  desc: string
  uqc: string
  qty: number
  taxable: number
  tax: number
}

export function gstrHsnSummary(invoices: Invoice[]): HsnRow[] {
  const map = new Map<string, HsnRow>()
  for (const inv of invoices) {
    for (const line of inv.items || []) {
      const hsn = line.hsn || 'NA'
      if (!map.has(hsn)) map.set(hsn, { hsn, desc: line.name, uqc: line.unit || 'PCS', qty: 0, taxable: 0, tax: 0 })
      const row = map.get(hsn)!
      const taxable = line.qty * line.rate
      const tax = taxable * (line.gst / 100)
      row.qty += line.qty
      row.taxable += taxable
      row.tax += tax
    }
  }
  return [...map.values()].sort((a, b) => b.taxable - a.taxable)
}

export interface AgingRow {
  customer: string
  d0_30: number
  d31_60: number
  d61_90: number
  d90plus: number
  total: number
  billCount: number
}

export function outstandingAging(invoices: Invoice[]): AgingRow[] {
  const today = new Date()
  const byCust = new Map<string, { row: AgingRow; debits: { date: string; amount: number }[]; credit: number }>()

  for (const b of invoices) {
    const name = b.party_name || 'Unknown'
    if (!byCust.has(name)) {
      byCust.set(name, {
        row: { customer: name, d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0, billCount: 0 },
        debits: [],
        credit: 0,
      })
    }
    const bucket = byCust.get(name)!
    if (isReceivableCreditDoc(b)) {
      bucket.credit += receivableCreditAmount(b)
      continue
    }
    if (!isReceivableDebitDoc(b)) continue
    const over = receivableOverpayment(b)
    if (over > 0.01) bucket.credit += over
    const out = receivableDebitOutstanding(b)
    if (out <= 0.01) continue
    bucket.debits.push({ date: b.date, amount: out })
  }

  for (const bucket of byCust.values()) {
    let credit = bucket.credit
    const row = bucket.row
    const debits = bucket.debits.sort((a, b) => a.date.localeCompare(b.date))

    for (const debit of debits) {
      const appliedCredit = Math.min(credit, debit.amount)
      credit -= appliedCredit
      const out = debit.amount - appliedCredit
      if (out <= 0.01) continue

      const billDate = new Date(debit.date)
      const days = Math.floor((today.getTime() - billDate.getTime()) / 86400000)
      if (days <= 30) row.d0_30 += out
      else if (days <= 60) row.d31_60 += out
      else if (days <= 90) row.d61_90 += out
      else row.d90plus += out
      row.total += out
      row.billCount++
    }

    row.d0_30 = Math.round(row.d0_30 * 100) / 100
    row.d31_60 = Math.round(row.d31_60 * 100) / 100
    row.d61_90 = Math.round(row.d61_90 * 100) / 100
    row.d90plus = Math.round(row.d90plus * 100) / 100
    row.total = Math.round(row.total * 100) / 100
  }

  return [...byCust.values()].map(({ row }) => row).filter(r => r.total > 0.01).sort((a, b) => b.total - a.total)
}

export function customerReceivableSummary(invoices: Invoice[]) {
  const map = new Map<string, { customer: string; billed: number; received: number; credits: number; outstanding: number; bills: number }>()
  for (const inv of invoices) {
    const key = inv.party_name || 'Unknown'
    const row = map.get(key) || { customer: key, billed: 0, received: 0, credits: 0, outstanding: 0, bills: 0 }
    if (isReceivableCreditDoc(inv)) {
      row.credits += receivableCreditAmount(inv)
    } else if (isReceivableDebitDoc(inv)) {
      row.billed += inv.grand_total || 0
      row.received += inv.amt_paid || 0
    } else {
      continue
    }
    row.bills += 1
    map.set(key, row)
  }
  return [...map.values()]
    .map((row) => ({
      ...row,
      billed: roundMoney(row.billed),
      received: roundMoney(row.received),
      credits: roundMoney(row.credits),
      outstanding: Math.max(0, roundMoney(row.billed - row.received - row.credits)),
    }))
    .sort((a, b) => b.outstanding - a.outstanding)
}

/** Vendor payables with lump-sum overpayment applied per supplier. */
export function totalVendorPayable(purchases: Array<{ supplier_name?: string | null; grand_total?: number; amt_paid?: number; is_deleted?: boolean }>) {
  const bySupplier = new Map<string, { billed: number; paid: number }>()
  for (const pur of purchases) {
    if (pur.is_deleted) continue
    const key = pur.supplier_name || 'Unknown'
    const row = bySupplier.get(key) || { billed: 0, paid: 0 }
    row.billed += pur.grand_total || 0
    row.paid += pur.amt_paid || 0
    bySupplier.set(key, row)
  }
  let total = 0
  for (const row of bySupplier.values()) {
    total += Math.max(0, roundMoney(row.billed - row.paid))
  }
  return roundMoney(total)
}

export interface CashBookRow {
  date: string
  voucher_no: string
  narration: string
  debit: number
  credit: number
  balance: number
}

export interface CashBookOptions {
  accounts?: Pick<Account, 'id' | 'name' | 'open_bal_dr' | 'open_bal_cr'>[]
  accountIds?: string[]
  accountNames?: string[]
  from?: string
  to?: string
  includeOpening?: boolean
}

function resolveCashBookOptions(optionsOrNames?: CashBookOptions | string[]): CashBookOptions {
  if (Array.isArray(optionsOrNames)) return { accountNames: optionsOrNames }
  return optionsOrNames || {}
}

function cashBookAccountMatches(
  entry: { accountId?: string; accountName: string },
  accountIds: Set<string>,
  accountNames: Set<string>,
) {
  if (accountIds.size > 0) return !!entry.accountId && accountIds.has(entry.accountId)
  return accountNames.has(entry.accountName)
}

function cashBookOpening(accounts: CashBookOptions['accounts'] = [], accountIds: Set<string>, accountNames: Set<string>) {
  return accounts.reduce((sum, account) => {
    if (accountIds.size > 0 && !accountIds.has(account.id)) return sum
    if (accountIds.size === 0 && accountNames.size > 0 && !accountNames.has(account.name)) return sum
    return sum + (account.open_bal_dr || 0) - (account.open_bal_cr || 0)
  }, 0)
}

export function cashBookFromVouchers(
  vouchers: { date: string; voucher_no: string; narration: string; entries: { accountId?: string; accountName: string; debit: number; credit: number }[] }[],
  optionsOrNames?: CashBookOptions | string[]
): CashBookRow[] {
  const options = resolveCashBookOptions(optionsOrNames)
  const accountIds = new Set(options.accountIds || [])
  const accountNames = new Set(options.accountNames || options.accounts?.map(a => a.name) || ['Cash in Hand', 'Bank Account (Primary)'])
  const rows: CashBookRow[] = []
  let balance = options.includeOpening === false ? 0 : cashBookOpening(options.accounts, accountIds, accountNames)
  const openingStart = balance
  let rangeOpening = balance
  const sorted = [...vouchers].sort((a, b) => a.date.localeCompare(b.date) || a.voucher_no.localeCompare(b.voucher_no))

  for (const v of sorted) {
    for (const e of v.entries) {
      if (!cashBookAccountMatches(e, accountIds, accountNames)) continue
      if (options.from && v.date < options.from) {
        balance += e.debit - e.credit
        rangeOpening = balance
        continue
      }
      if (options.to && v.date > options.to) continue

      balance += e.debit - e.credit
      rows.push({
        date: v.date,
        voucher_no: v.voucher_no,
        narration: v.narration,
        debit: e.debit,
        credit: e.credit,
        balance: Math.round(balance * 100) / 100,
      })
    }
  }

  if (options.includeOpening !== false && (Math.abs(openingStart) > 0.01 || options.from)) {
    const openingBalance = Math.round((options.from ? rangeOpening : openingStart) * 100) / 100
    rows.unshift({
      date: options.from || '',
      voucher_no: 'OPENING',
      narration: 'Opening Balance',
      debit: openingBalance >= 0 ? openingBalance : 0,
      credit: openingBalance < 0 ? Math.abs(openingBalance) : 0,
      balance: openingBalance,
    })
  }

  return rows
}

export function ewayInvoices(invoices: Invoice[]) {
  return invoices.filter(i => (i.eway || '').trim().length > 0)
}

export function itemSalesReport(invoices: Invoice[]) {
  const map = new Map<string, { name: string; qty: number; value: number; count: number }>()
  for (const b of invoices) {
    for (const r of b.items || []) {
      const key = (r.name || '').toLowerCase()
      if (!map.has(key)) map.set(key, { name: r.name, qty: 0, value: 0, count: 0 })
      const row = map.get(key)!
      row.qty += r.qty
      row.value += r.qty * r.rate
      row.count++
    }
  }
  return [...map.values()].sort((a, b) => b.value - a.value)
}
