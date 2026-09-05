import { isInvoiceActive } from '@/services/invoiceStatus'
import type { Invoice, Purchase } from '@/types/models'

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

export function normalizePartyName(name: string | null | undefined) {
  return (name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export function invoiceDocKind(inv: Invoice) {
  return String(inv.doc_type || 'INVOICE').toUpperCase()
}

export function isCustomerDebitDoc(inv: Invoice) {
  const kind = invoiceDocKind(inv)
  return kind === 'INVOICE' || kind === 'BILL_OF_SUPPLY' || kind === 'DEBIT_NOTE'
}

export function isCustomerCreditDoc(inv: Invoice) {
  return invoiceDocKind(inv) === 'CREDIT_NOTE'
}

export function payStatusFromPaid(grandTotal: number, amtPaid: number) {
  if (Math.abs(round2(grandTotal) - round2(amtPaid)) < 0.01 || amtPaid > grandTotal) return 'PAID'
  if (amtPaid > 0.01) return 'PARTIAL'
  return 'UNPAID'
}

export function payStatusFromPaidPurchase(grandTotal: number, amtPaid: number) {
  return payStatusFromPaid(grandTotal, amtPaid)
}

function matchesPartyRecord(
  recordPartyId: string | null | undefined,
  recordPartyName: string,
  targetPartyId: string | null | undefined,
  targetPartyName: string,
) {
  if (targetPartyId && recordPartyId) return recordPartyId === targetPartyId
  return normalizePartyName(recordPartyName) === normalizePartyName(targetPartyName)
}

export interface PaymentAllocation {
  id: string
  amount: number
}

/** fifo = oldest open first; primary_then_fifo = clicked bill first then oldest; primary_only = only clicked bill */
export type PaymentAllocMode = 'fifo' | 'primary_then_fifo' | 'primary_only'

/** Excess after bills: create party advance, ignore (apply only), or block save */
export type PaymentExcessAction = 'advance' | 'ignore' | 'block'

export type PaymentSettleReason = 'settlement' | 'bad_debt' | 'round_off'

export interface AllocatePaymentOptions {
  onlyBillIds?: string[]
  mode?: PaymentAllocMode
}

function normalizeAllocateOpts(arg?: string[] | AllocatePaymentOptions): {
  onlyBillIds?: string[]
  mode: PaymentAllocMode
} {
  if (Array.isArray(arg)) {
    return { onlyBillIds: arg, mode: 'primary_then_fifo' }
  }
  return {
    onlyBillIds: arg?.onlyBillIds,
    mode: arg?.mode ?? 'fifo',
  }
}

function orderOpenBills<T extends { id: string }>(
  open: T[],
  primaryId: string,
  mode: PaymentAllocMode,
): T[] {
  if (mode === 'primary_only') {
    return open.filter((row) => row.id === primaryId)
  }
  if (mode === 'primary_then_fifo') {
    return [...open.filter((row) => row.id === primaryId), ...open.filter((row) => row.id !== primaryId)]
  }
  // fifo — already sorted oldest-first by caller
  return open
}

export function allocateCustomerReceipt(
  invoices: Invoice[],
  primaryId: string,
  totalAmount: number,
  onlyBillIdsOrOpts?: string[] | AllocatePaymentOptions,
): PaymentAllocation[] {
  const primary = invoices.find((inv) => inv.id === primaryId)
  if (!primary) return []

  const { onlyBillIds, mode } = normalizeAllocateOpts(onlyBillIdsOrOpts)
  const allow = onlyBillIds?.length ? new Set(onlyBillIds) : null
  const open = invoices
    .filter((inv) => isInvoiceActive(inv) && isCustomerDebitDoc(inv))
    .filter((inv) => matchesPartyRecord(inv.party_id, inv.party_name, primary.party_id, primary.party_name))
    .filter((inv) => round2(inv.grand_total - (inv.amt_paid || 0)) > 0.01)
    .filter((inv) => !allow || allow.has(inv.id))
    .sort((a, b) => a.date.localeCompare(b.date) || a.bill_no.localeCompare(b.bill_no))

  const ordered = orderOpenBills(open, primaryId, mode)

  let remaining = round2(Math.max(0, totalAmount))
  const allocations: PaymentAllocation[] = []

  for (const inv of ordered) {
    if (remaining <= 0.01) break
    const outstanding = round2(Math.max(0, inv.grand_total - (inv.amt_paid || 0)))
    if (outstanding <= 0.01) continue
    const pay = round2(Math.min(remaining, outstanding))
    allocations.push({ id: inv.id, amount: pay })
    remaining = round2(remaining - pay)
  }

  return allocations
}

export function allocateVendorPayment(
  purchases: Purchase[],
  primaryId: string,
  totalAmount: number,
  onlyBillIdsOrOpts?: string[] | AllocatePaymentOptions,
): PaymentAllocation[] {
  const primary = purchases.find((pur) => pur.id === primaryId)
  if (!primary || primary.is_deleted) return []

  const { onlyBillIds, mode } = normalizeAllocateOpts(onlyBillIdsOrOpts)
  const allow = onlyBillIds?.length ? new Set(onlyBillIds) : null
  const open = purchases
    .filter((pur) => !pur.is_deleted)
    .filter((pur) => matchesPartyRecord(pur.supplier_id, pur.supplier_name, primary.supplier_id, primary.supplier_name))
    .filter((pur) => round2(pur.grand_total - (pur.amt_paid || 0)) > 0.01)
    .filter((pur) => !allow || allow.has(pur.id))
    .sort((a, b) => {
      const da = a.received_date || a.date
      const db = b.received_date || b.date
      return da.localeCompare(db) || (a.bill_no || '').localeCompare(b.bill_no || '')
    })

  const ordered = orderOpenBills(open, primaryId, mode)

  let remaining = round2(Math.max(0, totalAmount))
  const allocations: PaymentAllocation[] = []

  for (const pur of ordered) {
    if (remaining <= 0.01) break
    const outstanding = round2(Math.max(0, pur.grand_total - (pur.amt_paid || 0)))
    if (outstanding <= 0.01) continue
    const pay = round2(Math.min(remaining, outstanding))
    allocations.push({ id: pur.id, amount: pay })
    remaining = round2(remaining - pay)
  }

  return allocations
}

export function allocationAppliedTotal(allocations: PaymentAllocation[]) {
  return round2(allocations.reduce((sum, row) => sum + row.amount, 0))
}

/** Structured tag for voucher/notes — ledger can parse for clear party statements */
export function buildAllocTag(
  allocations: PaymentAllocation[],
  billNos: Record<string, string>,
): string {
  if (!allocations.length) return ''
  const body = allocations
    .map((a) => `${a.id}=${a.amount.toFixed(2)}|${billNos[a.id] || a.id.slice(0, 8)}`)
    .join(';')
  return `[ALLOC:${body}]`
}

export function formatAllocBreakdown(
  allocations: PaymentAllocation[],
  billNos: Record<string, string>,
): string {
  return allocations
    .map((a) => `${billNos[a.id] || a.id.slice(0, 8)} ₹${a.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    .join(' + ')
}

export interface ParsedAllocPart {
  id: string
  amount: number
  billNo: string
}

export function parseAllocTag(text: string | null | undefined): ParsedAllocPart[] {
  if (!text) return []
  const m = text.match(/\[ALLOC:([^\]]+)\]/)
  if (!m) return []
  return m[1].split(';').map((part) => {
    const [left, billNo = ''] = part.split('|')
    const [id, amt] = left.split('=')
    return { id: id || '', amount: round2(Number(amt) || 0), billNo: billNo || id || '' }
  }).filter((p) => p.id && p.amount > 0)
}

export function settleReasonLabel(reason: PaymentSettleReason) {
  if (reason === 'bad_debt') return 'Bad debt write-off'
  if (reason === 'settlement') return 'Settlement discount'
  return 'Round-off'
}
