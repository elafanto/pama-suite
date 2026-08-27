import { normalizePartyName } from '@/services/partyPaymentAllocation'
import { bankLineFingerprint, type ParsedBankLine } from '@/services/bankStatementParse'
import type { Invoice, Party, Purchase } from '@/types/models'

export type ReconcileDocKind = 'purchase' | 'invoice'

export interface ReconcileBillCandidate {
  id: string
  kind: ReconcileDocKind
  refNo: string
  partyId: string | null
  partyName: string
  date: string
  grandTotal: number
  outstanding: number
  score: number
}

export type MatchConfidence = 'high' | 'medium' | 'low' | 'none'

export interface BankMatchSuggestion {
  lineKey: string
  line: ParsedBankLine
  kind: ReconcileDocKind | null
  confidence: MatchConfidence
  candidates: ReconcileBillCandidate[]
  selectedIds: string[]
  ignored: boolean
  alreadyDone: boolean
}

function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function daysBetween(a: string, b: string) {
  const da = new Date(a).getTime()
  const db = new Date(b).getTime()
  if (!Number.isFinite(da) || !Number.isFinite(db)) return 999
  return Math.abs(Math.round((da - db) / 86400000))
}

function fuzzyIncludes(hay: string, needle: string) {
  const h = normalizePartyName(hay)
  const n = normalizePartyName(needle)
  if (!h || !n || n.length < 3) return false
  return h.includes(n) || n.includes(h)
}

function scoreBill(
  line: ParsedBankLine,
  bill: { id: string; kind: ReconcileDocKind; refNo: string; partyId: string | null; partyName: string; date: string; outstanding: number; grandTotal: number },
  parties: Party[],
): number {
  let score = 0
  const out = round2(bill.outstanding)
  if (out <= 0.01) return 0
  const amtDiff = Math.abs(out - line.amount)
  if (amtDiff <= 1) score += 50
  else if (amtDiff <= 5) score += 30
  else if (amtDiff <= Math.max(25, out * 0.02)) score += 15
  else if (line.amount > out + 1 && line.amount - out < out * 0.5) score += 8 // possible lump sum cover

  const dayDiff = daysBetween(line.date, bill.date)
  if (dayDiff <= 2) score += 20
  else if (dayDiff <= 7) score += 12
  else if (dayDiff <= 15) score += 6
  else if (dayDiff > 45) score -= 10

  const narr = `${line.narration} ${line.partyHint} ${line.utr}`
  if (bill.refNo && fuzzyIncludes(narr, bill.refNo)) score += 35
  if (line.utr && fuzzyIncludes(narr, line.utr) && bill.refNo && fuzzyIncludes(line.utr, bill.refNo)) score += 10
  if (fuzzyIncludes(narr, bill.partyName) || fuzzyIncludes(line.partyHint, bill.partyName)) score += 25

  const party = parties.find((p) => p.id === bill.partyId || normalizePartyName(p.name) === normalizePartyName(bill.partyName))
  if (party) {
    if (party.acno && fuzzyIncludes(narr, party.acno)) score += 40
    if (party.ifsc && fuzzyIncludes(narr, party.ifsc)) score += 15
    if (fuzzyIncludes(narr, party.name)) score += 10
  }

  return score
}

function confidenceFromScore(score: number, topGap: number): MatchConfidence {
  if (score >= 70 && topGap >= 15) return 'high'
  if (score >= 45) return 'medium'
  if (score >= 25) return 'low'
  return 'none'
}

export function buildBankMatchSuggestions(opts: {
  lines: ParsedBankLine[]
  invoices: Invoice[]
  purchases: Purchase[]
  parties: Party[]
  doneFingerprints?: Set<string>
}): BankMatchSuggestion[] {
  const done = opts.doneFingerprints || new Set<string>()
  const openPurchases = opts.purchases
    .filter((p) => !p.is_deleted)
    .map((p) => ({
      id: p.id,
      kind: 'purchase' as const,
      refNo: p.bill_no || '',
      partyId: p.supplier_id,
      partyName: p.supplier_name || '',
      date: p.date,
      grandTotal: p.grand_total || 0,
      outstanding: round2(Math.max(0, (p.grand_total || 0) - (p.amt_paid || 0))),
    }))
    .filter((p) => p.outstanding > 0.01)

  const openInvoices = opts.invoices
    .filter((i) => !i.is_deleted && !i.cancelled_at)
    .map((i) => ({
      id: i.id,
      kind: 'invoice' as const,
      refNo: i.bill_no || '',
      partyId: i.party_id,
      partyName: i.party_name || '',
      date: i.date,
      grandTotal: i.grand_total || 0,
      outstanding: round2(Math.max(0, (i.grand_total || 0) - (i.amt_paid || 0))),
    }))
    .filter((i) => i.outstanding > 0.01)

  return opts.lines.map((line) => {
    const fp = bankLineFingerprint(line)
    const pool = line.side === 'debit' ? openPurchases : line.side === 'credit' ? openInvoices : [...openPurchases, ...openInvoices]
    const scored = pool
      .map((bill) => ({ ...bill, score: scoreBill(line, bill, opts.parties) }))
      .filter((b) => b.score >= 20)
      .sort((a, b) => b.score - a.score || a.date.localeCompare(b.date))
      .slice(0, 6)

    const top = scored[0]
    const second = scored[1]
    const conf = top ? confidenceFromScore(top.score, top.score - (second?.score || 0)) : 'none'
    const selectedIds = conf === 'high' && top ? [top.id] : []

    return {
      lineKey: fp,
      line,
      kind: top?.kind || (line.side === 'debit' ? 'purchase' : line.side === 'credit' ? 'invoice' : null),
      confidence: done.has(fp) ? 'none' : conf,
      candidates: scored,
      selectedIds: done.has(fp) ? [] : selectedIds,
      ignored: false,
      alreadyDone: done.has(fp),
    }
  })
}

export function loadDoneFingerprints(firmId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`pama_bank_reconcile_done_${firmId}`)
    const arr = raw ? JSON.parse(raw) as string[] : []
    return new Set(arr)
  } catch {
    return new Set()
  }
}

export function saveDoneFingerprints(firmId: string, fingerprints: Iterable<string>) {
  const set = loadDoneFingerprints(firmId)
  for (const fp of fingerprints) set.add(fp)
  localStorage.setItem(`pama_bank_reconcile_done_${firmId}`, JSON.stringify([...set]))
}
