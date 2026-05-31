import type { Invoice } from '@/types/models'

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
    i => !i.is_deleted && i.firm_id === firmId && (i.doc_type === 'INVOICE' || i.doc_type === 'invoice')
  )
  if (from) list = list.filter(i => i.date >= from)
  if (to) list = list.filter(i => i.date <= to)
  return list
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
  const byCust = new Map<string, AgingRow>()

  for (const b of invoices) {
    const out = (b.grand_total || 0) - (b.amt_paid || 0)
    if (out <= 0.01) continue
    const name = b.party_name || 'Unknown'
    if (!byCust.has(name)) {
      byCust.set(name, { customer: name, d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0, billCount: 0 })
    }
    const row = byCust.get(name)!
    const billDate = new Date(b.date)
    const days = Math.floor((today.getTime() - billDate.getTime()) / 86400000)
    if (days <= 30) row.d0_30 += out
    else if (days <= 60) row.d31_60 += out
    else if (days <= 90) row.d61_90 += out
    else row.d90plus += out
    row.total += out
    row.billCount++
  }
  return [...byCust.values()].sort((a, b) => b.total - a.total)
}

export interface CashBookRow {
  date: string
  voucher_no: string
  narration: string
  debit: number
  credit: number
  balance: number
}

export function cashBookFromVouchers(
  vouchers: { date: string; voucher_no: string; narration: string; entries: { accountName: string; debit: number; credit: number }[] }[],
  accountNames: string[] = ['Cash in Hand', 'Bank Account (Primary)']
): CashBookRow[] {
  const rows: CashBookRow[] = []
  let balance = 0
  const sorted = [...vouchers].sort((a, b) => a.date.localeCompare(b.date))
  for (const v of sorted) {
    for (const e of v.entries) {
      if (!accountNames.some(n => e.accountName.includes(n.split(' ')[0]))) continue
      balance += e.debit - e.credit
      rows.push({
        date: v.date,
        voucher_no: v.voucher_no,
        narration: v.narration,
        debit: e.debit,
        credit: e.credit,
        balance,
      })
    }
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
