import { normalizePartyName, parseAllocTag } from '@/services/partyPaymentAllocation'
import type { Invoice, Purchase, Voucher } from '@/types/models'

function invoiceParty(inv: Invoice) {
  return { id: inv.party_id, name: inv.party_name || '' }
}

function purchaseParty(pur: Purchase) {
  return { id: pur.supplier_id, name: pur.supplier_name || '' }
}

function sameParty(
  a: { id: string | null | undefined; name: string },
  b: { id: string | null | undefined; name: string },
) {
  if (a.id && b.id) return a.id === b.id
  return normalizePartyName(a.name) === normalizePartyName(b.name)
}

function isPayVoucher(v: Voucher) {
  return !v.is_deleted && (v.type === 'RECEIPT' || v.type === 'PAYMENT')
}

/** Active payment/receipt vouchers that settle this bill (own `_PAY` ref or ALLOC tag). */
export function findCoveringPayVouchers(billId: string, vouchers: Voucher[]): Voucher[] {
  const ownRef = `${billId}_PAY`
  const out: Voucher[] = []
  const seen = new Set<string>()
  for (const v of vouchers) {
    if (!isPayVoucher(v)) continue
    const byRef = v.ref_id === ownRef
    const byAlloc = parseAllocTag(v.narration || '').some((p) => p.id === billId)
    if (!byRef && !byAlloc) continue
    if (seen.has(v.id)) continue
    seen.add(v.id)
    out.push(v)
  }
  return out
}

function uniqIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))]
}

/** Bills likely updated in the same payment event (lump / bank reconcile) — date heuristic fallback. */
export function relatedInvoicePaymentIds(primary: Invoice, invoices: Invoice[], hasPrimaryVoucher: boolean): string[] {
  if (!hasPrimaryVoucher) return [primary.id]
  const paymentDate = String(primary.last_payment_date || '').trim()
  if (!paymentDate) return [primary.id]

  const party = invoiceParty(primary)
  return invoices
    .filter((inv) => {
      if ((inv.amt_paid || 0) <= 0.01) return false
      if (String(inv.last_payment_date || '').trim() !== paymentDate) return false
      return sameParty(party, invoiceParty(inv))
    })
    .map((inv) => inv.id)
}

export function relatedPurchasePaymentIds(primary: Purchase, purchases: Purchase[], hasPrimaryVoucher: boolean): string[] {
  if (!hasPrimaryVoucher) return [primary.id]
  const paymentDate = String(primary.last_payment_date || '').trim()
  if (!paymentDate) return [primary.id]

  const party = purchaseParty(primary)
  return purchases
    .filter((pur) => {
      if (pur.is_deleted || (pur.amt_paid || 0) <= 0.01) return false
      if (String(pur.last_payment_date || '').trim() !== paymentDate) return false
      return sameParty(party, purchaseParty(pur))
    })
    .map((pur) => pur.id)
}

export interface PaymentClearPlan {
  /** Voucher `ref_id`s to soft-delete via reverseLedgerByRef */
  voucherRefIds: string[]
  /** Voucher row ids (fallback delete by id) */
  voucherIds: string[]
  /** Invoice / purchase ids whose amt_paid should be zeroed */
  billIds: string[]
  /** True when any covering payment voucher was found */
  hasCoveringVoucher: boolean
}

/**
 * Plan a payment clear for a customer invoice.
 * Finds the real RECEIPT/PAYMENT voucher even when this bill is only in `[ALLOC:…]`
 * (lump posted on another bill's `_PAY` ref).
 */
export function planInvoicePaymentClear(
  primary: Invoice,
  invoices: Invoice[],
  vouchers: Voucher[],
): PaymentClearPlan {
  const covering = findCoveringPayVouchers(primary.id, vouchers)
  const voucherIds = covering.map((v) => v.id)
  const voucherRefIds = uniqIds(covering.map((v) => String(v.ref_id || '')).filter(Boolean))

  const allocBillIds: string[] = []
  for (const v of covering) {
    for (const part of parseAllocTag(v.narration || '')) {
      allocBillIds.push(part.id)
    }
  }

  let billIds: string[]
  if (allocBillIds.length) {
    // Prefer exact ALLOC membership over same-date heuristic (avoids wiping unrelated same-day receipts).
    billIds = uniqIds([primary.id, ...allocBillIds])
  } else if (covering.length) {
    billIds = relatedInvoicePaymentIds(primary, invoices, true)
  } else {
    billIds = [primary.id]
  }

  return {
    voucherRefIds,
    voucherIds,
    billIds,
    hasCoveringVoucher: covering.length > 0,
  }
}

/** Same as planInvoicePaymentClear for vendor purchases. */
export function planPurchasePaymentClear(
  primary: Purchase,
  purchases: Purchase[],
  vouchers: Voucher[],
): PaymentClearPlan {
  const covering = findCoveringPayVouchers(primary.id, vouchers)
  const voucherIds = covering.map((v) => v.id)
  const voucherRefIds = uniqIds(covering.map((v) => String(v.ref_id || '')).filter(Boolean))

  const allocBillIds: string[] = []
  for (const v of covering) {
    for (const part of parseAllocTag(v.narration || '')) {
      allocBillIds.push(part.id)
    }
  }

  let billIds: string[]
  if (allocBillIds.length) {
    billIds = uniqIds([primary.id, ...allocBillIds])
  } else if (covering.length) {
    billIds = relatedPurchasePaymentIds(primary, purchases, true)
  } else {
    billIds = [primary.id]
  }

  return {
    voucherRefIds,
    voucherIds,
    billIds,
    hasCoveringVoucher: covering.length > 0,
  }
}
