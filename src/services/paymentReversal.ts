import { normalizePartyName } from '@/services/partyPaymentAllocation'
import type { Invoice, Purchase } from '@/types/models'

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

/** Bills likely updated in the same payment event (lump / bank reconcile). */
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
