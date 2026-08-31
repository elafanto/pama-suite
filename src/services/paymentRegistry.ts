import { isInvoiceActive } from '@/services/invoiceStatus'
import { normalizePartyName } from '@/services/partyPaymentAllocation'
import type { Invoice, Purchase, Voucher } from '@/types/models'

export type PaymentDirection = 'in' | 'out'
export type PaymentBillKind = 'invoice' | 'purchase'

export interface PaymentRegistryRow {
  id: string
  date: string
  amount: number
  direction: PaymentDirection
  partyName: string
  billNo: string
  billId: string | null
  billKind: PaymentBillKind | null
  voucherId: string | null
  voucherNo: string
  narration: string
  source: 'voucher' | 'bill_only'
  duplicateGroupId: string | null
  duplicateLabel: string
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

function voucherCashAmount(v: Voucher): number {
  const bankEntries = (v.entries || []).filter((e) => /bank|cash/i.test(e.accountName || ''))
  if (v.type === 'RECEIPT') {
    return round2(bankEntries.reduce((s, e) => s + (e.debit || 0), 0))
  }
  if (v.type === 'PAYMENT') {
    return round2(bankEntries.reduce((s, e) => s + (e.credit || 0), 0))
  }
  return round2((v.entries || []).reduce((s, e) => s + Math.max(e.debit || 0, e.credit || 0), 0))
}

function parseBillFromVoucher(v: Voucher): { billId: string; billKind: PaymentBillKind } | null {
  const ref = String(v.ref_id || '')
  if (!ref.endsWith('_PAY')) return null
  const billId = ref.slice(0, -4)
  if (!billId) return null
  const billKind: PaymentBillKind = v.type === 'RECEIPT' ? 'invoice' : 'purchase'
  return { billId, billKind }
}

function partyAmountKey(partyName: string, date: string, amount: number, direction: PaymentDirection) {
  return `${direction}|${date}|${round2(amount).toFixed(2)}|${normalizePartyName(partyName)}`
}

function markDuplicateGroups(rows: PaymentRegistryRow[]) {
  const byRef = new Map<string, PaymentRegistryRow[]>()
  const byPam = new Map<string, PaymentRegistryRow[]>()

  for (const row of rows) {
    if (row.voucherId && row.billId) {
      const key = `${row.billKind}:${row.billId}`
      const list = byRef.get(key) || []
      list.push(row)
      byRef.set(key, list)
    }
    const pam = partyAmountKey(row.partyName, row.date, row.amount, row.direction)
    const pamList = byPam.get(pam) || []
    pamList.push(row)
    byPam.set(pam, pamList)
  }

  for (const [, list] of byRef) {
    if (list.length < 2) continue
    const gid = `dup-bill-${list[0].billKind}-${list[0].billId}`
    list.forEach((row) => {
      row.duplicateGroupId = gid
      row.duplicateLabel = 'Same bill — multiple payment vouchers'
    })
  }

  for (const [, list] of byPam) {
    if (list.length < 2) continue
    const gid = `dup-pam-${list[0].direction}-${list[0].date}-${list[0].amount}-${normalizePartyName(list[0].partyName)}`
    for (const row of list) {
      if (row.duplicateGroupId) {
        row.duplicateLabel = `${row.duplicateLabel}; Same party+date+amount`
        continue
      }
      row.duplicateGroupId = gid
      row.duplicateLabel = 'Same party, date & amount'
    }
  }
}

export function buildPaymentRegistry(opts: {
  vouchers: Voucher[]
  invoices: Invoice[]
  purchases: Purchase[]
}): PaymentRegistryRow[] {
  const invoiceById = new Map(opts.invoices.map((i) => [i.id, i]))
  const purchaseById = new Map(opts.purchases.map((p) => [p.id, p]))
  const rows: PaymentRegistryRow[] = []
  const billsWithVoucher = new Set<string>()

  for (const v of opts.vouchers) {
    if (v.is_deleted) continue
    if (v.type !== 'PAYMENT' && v.type !== 'RECEIPT') continue

    const amount = voucherCashAmount(v)
    if (amount <= 0) continue

    const billRef = parseBillFromVoucher(v)
    let partyName = ''
    let billNo = ''
    let billId: string | null = null
    let billKind: PaymentBillKind | null = null

    if (billRef) {
      billId = billRef.billId
      billKind = billRef.billKind
      billsWithVoucher.add(`${billKind}:${billId}`)
      if (billKind === 'invoice') {
        const inv = invoiceById.get(billId)
        partyName = inv?.party_name || ''
        billNo = inv?.bill_no || billId.slice(0, 8)
      } else {
        const pur = purchaseById.get(billId)
        partyName = pur?.supplier_name || ''
        billNo = pur?.bill_no || billId.slice(0, 8)
      }
    }

    rows.push({
      id: `v:${v.id}`,
      date: v.date,
      amount,
      direction: v.type === 'RECEIPT' ? 'in' : 'out',
      partyName,
      billNo: billNo || '—',
      billId,
      billKind,
      voucherId: v.id,
      voucherNo: v.voucher_no,
      narration: v.narration || '',
      source: 'voucher',
      duplicateGroupId: null,
      duplicateLabel: '',
    })
  }

  for (const inv of opts.invoices) {
    if (!isInvoiceActive(inv) || (inv.amt_paid || 0) <= 0.01) continue
    if (billsWithVoucher.has(`invoice:${inv.id}`)) continue
    rows.push({
      id: `b:invoice:${inv.id}`,
      date: inv.last_payment_date || inv.date,
      amount: round2(inv.amt_paid),
      direction: 'in',
      partyName: inv.party_name || '',
      billNo: inv.bill_no,
      billId: inv.id,
      billKind: 'invoice',
      voucherId: null,
      voucherNo: '—',
      narration: 'Paid on bill (no payment voucher)',
      source: 'bill_only',
      duplicateGroupId: null,
      duplicateLabel: '',
    })
  }

  for (const pur of opts.purchases) {
    if (pur.is_deleted || (pur.amt_paid || 0) <= 0.01) continue
    if (billsWithVoucher.has(`purchase:${pur.id}`)) continue
    rows.push({
      id: `b:purchase:${pur.id}`,
      date: pur.last_payment_date || pur.received_date || pur.date,
      amount: round2(pur.amt_paid),
      direction: 'out',
      partyName: pur.supplier_name || '',
      billNo: pur.bill_no || pur.id.slice(0, 8),
      billId: pur.id,
      billKind: 'purchase',
      voucherId: null,
      voucherNo: '—',
      narration: 'Paid on bill (no payment voucher)',
      source: 'bill_only',
      duplicateGroupId: null,
      duplicateLabel: '',
    })
  }

  rows.sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount)
  markDuplicateGroups(rows)
  return rows
}

export function paymentRegistryTotals(rows: PaymentRegistryRow[]) {
  const receipts = round2(rows.filter((r) => r.direction === 'in').reduce((s, r) => s + r.amount, 0))
  const payments = round2(rows.filter((r) => r.direction === 'out').reduce((s, r) => s + r.amount, 0))
  const duplicateRows = rows.filter((r) => r.duplicateGroupId).length
  const duplicateGroups = new Set(rows.map((r) => r.duplicateGroupId).filter(Boolean)).size
  return { receipts, payments, count: rows.length, duplicateRows, duplicateGroups }
}
