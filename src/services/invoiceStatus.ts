import type { Invoice } from '@/types/models'

/** Live bill (not hard-deleted, not cancelled). */
export function isInvoiceActive(inv: Pick<Invoice, 'is_deleted' | 'cancelled_at'>): boolean {
  return !inv.is_deleted && !inv.cancelled_at
}

/** Visible cancelled bill (still in Sales History). */
export function isInvoiceCancelled(inv: Pick<Invoice, 'is_deleted' | 'cancelled_at'>): boolean {
  return !inv.is_deleted && !!inv.cancelled_at
}

/** Counts toward GSTR-1 Table 13 Cancelled (cancel or hard delete). */
export function isInvoiceDocsCancelled(inv: Pick<Invoice, 'is_deleted' | 'cancelled_at'>): boolean {
  return !!inv.is_deleted || !!inv.cancelled_at
}

/** Include in B2B / B2C / HSN / CDN sheets. */
export function isInvoiceGstrReportable(inv: Pick<Invoice, 'is_deleted' | 'cancelled_at'>): boolean {
  return isInvoiceActive(inv)
}
