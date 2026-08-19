import type { BillNoFormat, Firm, Invoice } from '@/types/models'
import { CHALLAN_PREFIX, isDeliveryChallan } from '@/services/invoiceDoc'

export type { BillNoFormat }

export const BILL_NO_FORMAT_OPTIONS: { value: BillNoFormat; label: string; hint: string }[] = [
  { value: 'dash_4', label: 'PREFIX-0001', hint: 'Default — INV-0001, PAMA-0042' },
  { value: 'slash_4', label: 'PREFIX/0001', hint: 'Slash separator — INV/0001' },
  { value: 'compact_4', label: 'PREFIX0001', hint: 'No separator — INV0001' },
  { value: 'dash_5', label: 'PREFIX-00001', hint: 'Five digits — INV-00001' },
  { value: 'dash_3', label: 'PREFIX-001', hint: 'Three digits — INV-001' },
  { value: 'dash_plain', label: 'PREFIX-1', hint: 'No zero padding — INV-1, INV-2' },
  { value: 'fy_slash_4', label: 'PREFIX/FY/0001', hint: 'Financial year — INV/24-25/0001 (resets each April)' },
]

export function normalizeBillNoFormat(format?: string | null): BillNoFormat {
  if (format && BILL_NO_FORMAT_OPTIONS.some((o) => o.value === format)) {
    return format as BillNoFormat
  }
  return 'dash_4'
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function firmPrefix(firm: Pick<Firm, 'prefix'>): string {
  return (firm.prefix || 'INV').trim().toUpperCase() || 'INV'
}

function padSeq(seq: number, width: number): string {
  if (width <= 0) return String(seq)
  return String(seq).padStart(width, '0')
}

/** Indian financial year label e.g. 24-25 for Apr 2024 – Mar 2025. */
export function indianFYShort(refDate?: string): string {
  const d = refDate ? new Date(`${refDate.slice(0, 10)}T12:00:00`) : new Date()
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const startYear = m >= 4 ? y : y - 1
  const endYear = startYear + 1
  return `${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`
}

export function formatBillNo(
  firmOrPrefix: Firm | Pick<Firm, 'prefix' | 'bill_no_format'> | string,
  seq: number,
  refDate?: string,
): string {
  const firm: Pick<Firm, 'prefix' | 'bill_no_format'> = typeof firmOrPrefix === 'string'
    ? { prefix: firmOrPrefix }
    : firmOrPrefix
  const p = firmPrefix(firm)
  const fmt = normalizeBillNoFormat(firm.bill_no_format)

  switch (fmt) {
    case 'slash_4':
      return `${p}/${padSeq(seq, 4)}`
    case 'compact_4':
      return `${p}${padSeq(seq, 4)}`
    case 'dash_5':
      return `${p}-${padSeq(seq, 5)}`
    case 'dash_3':
      return `${p}-${padSeq(seq, 3)}`
    case 'dash_plain':
      return `${p}-${seq}`
    case 'fy_slash_4':
      return `${p}/${indianFYShort(refDate)}/${padSeq(seq, 4)}`
    default:
      return `${p}-${padSeq(seq, 4)}`
  }
}

function buildBillNoRegex(firm: Pick<Firm, 'prefix' | 'bill_no_format'>): RegExp {
  const p = escapeRegex(firmPrefix(firm))
  const fmt = normalizeBillNoFormat(firm.bill_no_format)
  if (fmt === 'fy_slash_4') {
    return new RegExp(`^${p}/\\d{2}-\\d{2}[-/\\s_]*0*(\\d+)`, 'i')
  }
  if (fmt === 'slash_4') {
    return new RegExp(`^${p}/0*(\\d+)`, 'i')
  }
  if (fmt === 'compact_4') {
    return new RegExp(`^${p}(\\d+)`, 'i')
  }
  return new RegExp(`^${p}[-/\\s_]*0*(\\d+)`, 'i')
}

export function parseBillSequence(
  billNo: string,
  firm: Pick<Firm, 'prefix' | 'bill_no_format'>,
): number | null {
  const raw = (billNo || '').trim()
  if (!raw) return null
  const m = raw.match(buildBillNoRegex(firm))
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) ? n : null
}

function invoiceInFinancialYear(inv: Invoice, firm: Firm, refDate?: string): boolean {
  if (normalizeBillNoFormat(firm.bill_no_format) !== 'fy_slash_4') return true
  const fy = indianFYShort(refDate || inv.date)
  const p = escapeRegex(firmPrefix(firm))
  return new RegExp(`^${p}/${fy.replace('-', '\\-')}/`, 'i').test((inv.bill_no || '').trim())
}

export function billNoKeys(
  billNo: string,
  firm: Pick<Firm, 'prefix' | 'bill_no_format'> | string,
  refDate?: string,
): string[] {
  const keys = new Set<string>()
  const raw = (billNo || '').trim()
  if (!raw) return []
  keys.add(raw.toUpperCase())

  const firmObj: Pick<Firm, 'prefix' | 'bill_no_format'> = typeof firm === 'string'
    ? { prefix: firm }
    : firm
  const p = firmPrefix(firmObj)
  const parsed = parseBillSequence(raw, firmObj)
  if (parsed != null) {
    keys.add(formatBillNo(firmObj, parsed, refDate).toUpperCase())
    keys.add(`${p}-${parsed}`)
    keys.add(`${p}-${String(parsed).padStart(4, '0')}`)
    keys.add(`${p}/${String(parsed).padStart(4, '0')}`)
  }
  return [...keys]
}

/** Highest numeric suffix used for this firm's bill format (includes soft-deleted). */
export function maxBillSequence(invoices: Invoice[], firm: Firm, refDate?: string): number {
  let max = 0
  for (const inv of invoices) {
    if (inv.firm_id !== firm.id) continue
    if (!invoiceInFinancialYear(inv, firm, refDate)) continue
    const seq = parseBillSequence(inv.bill_no || '', firm)
    if (seq != null) max = Math.max(max, seq)
  }
  return max
}

/** Next sequence = max(stored counter, highest existing invoice + 1). */
export function resolveNextSequence(firm: Firm, invoices: Invoice[], refDate?: string): number {
  const stored = firm.next_bill_no || 1
  const fromHistory = maxBillSequence(invoices, firm, refDate) + 1
  const fmt = normalizeBillNoFormat(firm.bill_no_format)

  if (fmt === 'fy_slash_4') {
    const hasThisFy = invoices.some((inv) =>
      inv.firm_id === firm.id && invoiceInFinancialYear(inv, firm, refDate),
    )
    if (!hasThisFy) return Math.max(stored, 1)
    return Math.max(fromHistory, 1)
  }

  return Math.max(stored, fromHistory, 1)
}

export function peekBillNo(firm: Firm, invoices: Invoice[], refDate?: string): string {
  return formatBillNo(firm, resolveNextSequence(firm, invoices, refDate), refDate)
}

export function allocateBillNo(
  firm: Firm,
  invoices: Invoice[],
  refDate?: string,
): { billNo: string; nextSequenceAfter: number } {
  let seq = resolveNextSequence(firm, invoices, refDate)
  const existing = new Set<string>()
  for (const b of invoices) {
    // Soft-deleted numbers stay reserved (GSTR Table 13 serial continuity).
    if (b.firm_id !== firm.id) continue
    if (!invoiceInFinancialYear(b, firm, refDate)) continue
    for (const k of billNoKeys(b.bill_no || '', firm, refDate)) existing.add(k)
  }

  for (let guard = 0; guard < 5000; guard++) {
    const billNo = formatBillNo(firm, seq, refDate)
    const keys = billNoKeys(billNo, firm, refDate)
    if (!keys.some((k) => existing.has(k))) {
      return { billNo, nextSequenceAfter: seq + 1 }
    }
    seq++
  }

  throw new Error('Could not allocate a unique invoice number')
}

export function syncFirmBillCounter(firm: Firm, invoices: Invoice[], refDate?: string): number {
  return resolveNextSequence(firm, invoices, refDate)
}

export function findDuplicateBillNoGroups(invoices: Invoice[]): Invoice[][] {
  const groups = new Map<string, Invoice[]>()
  for (const inv of invoices) {
    if (inv.is_deleted || !inv.bill_no?.trim()) continue
    const key = `${inv.firm_id}:${inv.bill_no.trim().toUpperCase()}`
    const arr = groups.get(key) || []
    arr.push(inv)
    groups.set(key, arr)
  }
  return [...groups.values()].filter((arr) => arr.length > 1)
}

function challanNumberFirm(firm: Firm): Firm {
  return { ...firm, prefix: CHALLAN_PREFIX, next_bill_no: 1 }
}

function challanDocsForFirm(invoices: Invoice[], firmId: string): Invoice[] {
  return invoices.filter((inv) => inv.firm_id === firmId && isDeliveryChallan(inv))
}

/** Separate DC- series for job-work delivery challans (does not consume invoice numbers). */
export function peekChallanNo(firm: Firm, invoices: Invoice[], refDate?: string): string {
  return peekBillNo(challanNumberFirm(firm), challanDocsForFirm(invoices, firm.id), refDate)
}

export function allocateChallanNo(
  firm: Firm,
  invoices: Invoice[],
  refDate?: string,
): { billNo: string; nextSequenceAfter: number } {
  return allocateBillNo(challanNumberFirm(firm), challanDocsForFirm(invoices, firm.id), refDate)
}
