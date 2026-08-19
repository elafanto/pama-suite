import type { Invoice } from '@/types/models'

export const CHALLAN_PREFIX = 'DC'

export const JOB_WORK_CHALLAN_NOTE =
  'Goods sent for job work under section 143 of the CGST Act, 2017 read with rules 45 and 55. This is not a tax invoice. GST is not charged on this document.'

export const DOC_TYPE_OPTIONS: { value: Exclude<Invoice['doc_type'], 'invoice'>; label: string }[] = [
  { value: 'INVOICE', label: 'Tax Invoice' },
  { value: 'BILL_OF_SUPPLY', label: 'Bill of Supply' },
  { value: 'CREDIT_NOTE', label: 'Credit Note' },
  { value: 'DEBIT_NOTE', label: 'Debit Note' },
  { value: 'DELIVERY_CHALLAN', label: 'Delivery Challan (Job Work)' },
]

export function docKind(inv: Pick<Invoice, 'doc_type'> | string | null | undefined): string {
  const raw = typeof inv === 'string' || inv == null ? inv : inv.doc_type
  return String(raw || 'INVOICE').toUpperCase()
}

export function isDeliveryChallan(inv: Pick<Invoice, 'doc_type'> | string | null | undefined): boolean {
  return docKind(inv) === 'DELIVERY_CHALLAN'
}

export function isTaxInvoiceDoc(inv: Pick<Invoice, 'doc_type'> | string | null | undefined): boolean {
  const k = docKind(inv)
  return k === 'INVOICE' || k === 'BILL_OF_SUPPLY'
}

export function isCreditOrDebitNote(inv: Pick<Invoice, 'doc_type'> | string | null | undefined): boolean {
  const k = docKind(inv)
  return k === 'CREDIT_NOTE' || k === 'DEBIT_NOTE'
}

export function isGstrMonthDoc(inv: Pick<Invoice, 'doc_type'> | string | null | undefined): boolean {
  return isTaxInvoiceDoc(inv) || isCreditOrDebitNote(inv) || isDeliveryChallan(inv)
}

export function docPdfTitle(inv: Pick<Invoice, 'doc_type'> | string | null | undefined): string {
  const k = docKind(inv)
  if (k === 'CREDIT_NOTE') return 'CREDIT NOTE'
  if (k === 'DEBIT_NOTE') return 'DEBIT NOTE'
  if (k === 'BILL_OF_SUPPLY') return 'BILL OF SUPPLY'
  if (k === 'DELIVERY_CHALLAN') return 'DELIVERY CHALLAN'
  return 'TAX INVOICE'
}

export function docPdfSubtitle(inv: Pick<Invoice, 'doc_type'> | string | null | undefined): string {
  return isDeliveryChallan(inv) ? 'FOR JOB WORK (Sec. 143 / Rule 45 & 55)' : ''
}

export function docNoLabel(inv: Pick<Invoice, 'doc_type'> | string | null | undefined): string {
  return isDeliveryChallan(inv) ? 'Challan No' : 'Invoice No'
}

export function docShortLabel(inv: Pick<Invoice, 'doc_type'> | string | null | undefined): string {
  const k = docKind(inv)
  if (k === 'CREDIT_NOTE') return 'CN'
  if (k === 'DEBIT_NOTE') return 'DN'
  if (k === 'BILL_OF_SUPPLY') return 'BOS'
  if (k === 'DELIVERY_CHALLAN') return 'DC'
  return 'INV'
}

export function docFilenamePrefix(inv: Pick<Invoice, 'doc_type'> | string | null | undefined): string {
  const k = docKind(inv)
  if (k === 'CREDIT_NOTE') return 'CN'
  if (k === 'DEBIT_NOTE') return 'DN'
  if (k === 'DELIVERY_CHALLAN') return 'Challan'
  return 'Invoice'
}

export function docTypeLabel(inv: Pick<Invoice, 'doc_type'> | string | null | undefined): string {
  const k = docKind(inv)
  return DOC_TYPE_OPTIONS.find((o) => o.value === k)?.label || 'Tax Invoice'
}
