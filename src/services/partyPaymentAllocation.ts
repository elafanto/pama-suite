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

export function allocateCustomerReceipt(
  invoices: Invoice[],
  primaryId: string,
  totalAmount: number,
  onlyBillIds?: string[],
): PaymentAllocation[] {
  const primary = invoices.find((inv) => inv.id === primaryId)
  if (!primary) return []

  const allow = onlyBillIds?.length ? new Set(onlyBillIds) : null
  const open = invoices
    .filter((inv) => isInvoiceActive(inv) && isCustomerDebitDoc(inv))
    .filter((inv) => matchesPartyRecord(inv.party_id, inv.party_name, primary.party_id, primary.party_name))
    .filter((inv) => round2(inv.grand_total - (inv.amt_paid || 0)) > 0.01)
    .filter((inv) => !allow || allow.has(inv.id))
    .sort((a, b) => a.date.localeCompare(b.date) || a.bill_no.localeCompare(b.bill_no))

  const ordered = [...open.filter((inv) => inv.id === primaryId), ...open.filter((inv) => inv.id !== primaryId)]

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
  onlyBillIds?: string[],
): PaymentAllocation[] {
  const primary = purchases.find((pur) => pur.id === primaryId)
  if (!primary || primary.is_deleted) return []

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

  const ordered = [...open.filter((pur) => pur.id === primaryId), ...open.filter((pur) => pur.id !== primaryId)]

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
