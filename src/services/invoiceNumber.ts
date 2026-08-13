import type { Firm, Invoice } from '@/types/models'

export function formatBillNo(prefix: string, seq: number): string {
  const p = (prefix || 'INV').trim().toUpperCase() || 'INV'
  return `${p}-${String(seq).padStart(4, '0')}`
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function billNoKeys(billNo: string, prefix: string): string[] {
  const keys = new Set<string>()
  const raw = (billNo || '').trim()
  if (!raw) return []
  keys.add(raw.toUpperCase())
  const p = (prefix || 'INV').trim().toUpperCase() || 'INV'
  const m = raw.match(new RegExp(`^${escapeRegex(p)}[-/\\s_]*0*(\\d+)`, 'i'))
  if (m) {
    const n = parseInt(m[1], 10)
    keys.add(formatBillNo(p, n).toUpperCase())
    keys.add(`${p}-${n}`)
    keys.add(`${p}-${String(n).padStart(4, '0')}`)
  }
  return [...keys]
}

/** Highest numeric suffix used for this firm's bill prefix (includes soft-deleted). */
export function maxBillSequence(invoices: Invoice[], firmId: string, prefix: string): number {
  const p = (prefix || 'INV').trim().toUpperCase() || 'INV'
  const prefixRe = new RegExp(`^${escapeRegex(p)}[-/\\s_]*0*(\\d+)`, 'i')
  let max = 0
  for (const inv of invoices) {
    if (inv.firm_id !== firmId) continue
    const no = (inv.bill_no || '').trim()
    if (!no) continue
    const m = no.match(prefixRe)
    if (m) {
      max = Math.max(max, parseInt(m[1], 10))
      continue
    }
  }
  return max
}

/** Next sequence = max(stored counter, highest existing invoice + 1). */
export function resolveNextSequence(firm: Firm, invoices: Invoice[]): number {
  const prefix = firm.prefix || 'INV'
  const stored = firm.next_bill_no || 1
  const fromHistory = maxBillSequence(invoices, firm.id, prefix) + 1
  return Math.max(stored, fromHistory, 1)
}

export function peekBillNo(firm: Firm, invoices: Invoice[]): string {
  return formatBillNo(firm.prefix || 'INV', resolveNextSequence(firm, invoices))
}

export function allocateBillNo(
  firm: Firm,
  invoices: Invoice[],
): { billNo: string; nextSequenceAfter: number } {
  const prefix = firm.prefix || 'INV'
  let seq = resolveNextSequence(firm, invoices)
  const existing = new Set<string>()
  for (const b of invoices) {
    // Soft-deleted numbers stay reserved (GSTR Table 13 serial continuity).
    if (b.firm_id !== firm.id) continue
    for (const k of billNoKeys(b.bill_no || '', prefix)) existing.add(k)
  }

  for (let guard = 0; guard < 5000; guard++) {
    const billNo = formatBillNo(prefix, seq)
    const keys = billNoKeys(billNo, prefix)
    if (!keys.some((k) => existing.has(k))) {
      return { billNo, nextSequenceAfter: seq + 1 }
    }
    seq++
  }

  throw new Error('Could not allocate a unique invoice number')
}

export function syncFirmBillCounter(firm: Firm, invoices: Invoice[]): number {
  return resolveNextSequence(firm, invoices)
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
