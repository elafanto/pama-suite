import { normalizePartyName } from '@/services/partyPaymentAllocation'
import { bankLineFingerprint, type ParsedBankLine } from '@/services/bankStatementParse'
import type { Invoice, Party, Purchase } from '@/types/models'

export type ReconcileDocKind = 'purchase' | 'invoice'

/** Exact vs Lump decision-tree label (see product playbook). */
export type BankMatchKind = 'exact' | 'partial' | 'lump' | 'advance' | 'unmatched'

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
  matchKind: BankMatchKind
  confidence: MatchConfidence
  candidates: ReconcileBillCandidate[]
  selectedIds: string[]
  ignored: boolean
  alreadyDone: boolean
}

function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function dayMs(date: string) {
  const t = new Date(date).getTime()
  return Number.isFinite(t) ? t : NaN
}

/** Calendar days of payment − bill (negative = payment before bill). */
function daysAfterBill(paymentDate: string, billDate: string) {
  const a = dayMs(paymentDate)
  const b = dayMs(billDate)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 999
  return Math.round((a - b) / 86400000)
}

function fuzzyIncludes(hay: string, needle: string) {
  const h = normalizePartyName(hay)
  const n = normalizePartyName(needle)
  if (!h || !n || n.length < 3) return false
  return h.includes(n) || n.includes(h)
}

function partyKey(id: string | null | undefined, name: string) {
  if (id) return `id:${id}`
  const n = normalizePartyName(name)
  return n ? `name:${n}` : ''
}

function amountNear(a: number, b: number, tol = 5) {
  return Math.abs(round2(a) - round2(b)) <= tol
}

function partyStrength(
  line: ParsedBankLine,
  bill: { partyId: string | null; partyName: string; refNo: string },
  parties: Party[],
): number {
  let score = 0
  const narr = `${line.narration} ${line.partyHint} ${line.utr}`
  if (bill.refNo && fuzzyIncludes(narr, bill.refNo)) score += 35
  if (fuzzyIncludes(narr, bill.partyName) || fuzzyIncludes(line.partyHint, bill.partyName)) score += 25

  const party = parties.find(
    (p) => p.id === bill.partyId || normalizePartyName(p.name) === normalizePartyName(bill.partyName),
  )
  if (party) {
    if (party.acno && fuzzyIncludes(narr, party.acno)) score += 40
    if (party.ifsc && fuzzyIncludes(narr, party.ifsc)) score += 15
    if (fuzzyIncludes(narr, party.name)) score += 10
  }
  return score
}

function scoreBill(
  line: ParsedBankLine,
  bill: {
    id: string
    kind: ReconcileDocKind
    refNo: string
    partyId: string | null
    partyName: string
    date: string
    outstanding: number
    grandTotal: number
  },
  parties: Party[],
): number {
  const out = round2(bill.outstanding)
  if (out <= 0.01) return 0

  // Hard rule: payment must be on/after bill date (else advance, not this bill).
  const after = daysAfterBill(line.date, bill.date)
  if (after < 0) return 0

  let score = partyStrength(line, bill, parties)
  if (score < 15) return 0 // weak party → don't propose

  const amtDiff = Math.abs(out - line.amount)
  if (amtDiff <= 1) score += 50
  else if (amtDiff <= 5) score += 30
  else if (amtDiff <= Math.max(25, out * 0.02)) score += 15
  else if (line.amount < out - 5) score += 12 // partial
  else if (line.amount > out + 1) score += 8 // possible lump spill from this primary

  if (after <= 2) score += 20
  else if (after <= 7) score += 12
  else if (after <= 15) score += 6
  else if (after > 45) score -= 8

  return score
}

function confidenceFromScore(score: number, topGap: number, matchKind: BankMatchKind): MatchConfidence {
  if (matchKind === 'advance' || matchKind === 'unmatched') return 'none'
  if (matchKind === 'lump') {
    // Lump always needs human review — never auto-high
    if (score >= 45) return 'medium'
    if (score >= 25) return 'low'
    return 'none'
  }
  if (matchKind === 'exact' && score >= 70 && topGap >= 15) return 'high'
  if (score >= 45) return 'medium'
  if (score >= 25) return 'low'
  return 'none'
}

type OpenBill = {
  id: string
  kind: ReconcileDocKind
  refNo: string
  partyId: string | null
  partyName: string
  date: string
  grandTotal: number
  outstanding: number
}

/**
 * Exact vs Lump decision tree:
 * 1) side → purchase/sale pool
 * 2) payment_date >= bill_date
 * 3) party strong?
 * 4) exact / partial / lump / advance / unmatched
 */
export function classifyBankMatch(opts: {
  line: ParsedBankLine
  pool: OpenBill[]
  parties: Party[]
}): {
  matchKind: BankMatchKind
  confidence: MatchConfidence
  candidates: ReconcileBillCandidate[]
  selectedIds: string[]
  kind: ReconcileDocKind | null
} {
  const { line, pool, parties } = opts
  const defaultKind: ReconcileDocKind | null =
    line.side === 'debit' ? 'purchase' : line.side === 'credit' ? 'invoice' : null

  if (!line.side || line.amount <= 0) {
    return { matchKind: 'unmatched', confidence: 'none', candidates: [], selectedIds: [], kind: defaultKind }
  }

  const scored = pool
    .map((bill) => ({ ...bill, score: scoreBill(line, bill, parties) }))
    .filter((b) => b.score >= 20)
    .sort((a, b) => b.score - a.score || a.date.localeCompare(b.date))

  // Same-party open bills (date OK) for lump / advance analysis
  const byParty = new Map<string, OpenBill[]>()
  for (const bill of pool) {
    if (daysAfterBill(line.date, bill.date) < 0) continue
    const key = partyKey(bill.partyId, bill.partyName)
    if (!key) continue
    const strength = partyStrength(line, bill, parties)
    if (strength < 15) continue
    const list = byParty.get(key) || []
    list.push(bill)
    byParty.set(key, list)
  }

  // Prefer party group that best matches narration
  let bestPartyBills: OpenBill[] = []
  let bestPartyScore = 0
  for (const bills of byParty.values()) {
    const s = Math.max(...bills.map((b) => partyStrength(line, b, parties)))
    if (s > bestPartyScore) {
      bestPartyScore = s
      bestPartyBills = bills
    }
  }
  bestPartyBills = [...bestPartyBills].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))

  const top = scored[0]
  const second = scored[1]
  const topGap = top ? top.score - (second?.score || 0) : 0

  // Advance: strong party hint but every open bill is dated after the payment
  const futurePartyBills = pool.filter((b) => {
    if (daysAfterBill(line.date, b.date) >= 0) return false
    return partyStrength(line, b, parties) >= 15
  })
  if (!scored.length && futurePartyBills.length > 0) {
    return {
      matchKind: 'advance',
      confidence: 'none',
      candidates: [],
      selectedIds: [],
      kind: defaultKind,
    }
  }

  if (!scored.length) {
    return {
      matchKind: 'unmatched',
      confidence: 'none',
      candidates: [],
      selectedIds: [],
      kind: defaultKind,
    }
  }

  // Exact: one bill outstanding ≈ payment
  const exactHits = scored.filter((b) => amountNear(b.outstanding, line.amount, 5))
  if (exactHits.length >= 1) {
    const hit = exactHits[0]
    const ambiguous = exactHits.length > 1 && (hit.score - (exactHits[1]?.score || 0) < 20)
    const matchKind: BankMatchKind = 'exact'
    const confidence = ambiguous
      ? 'medium'
      : confidenceFromScore(hit.score, topGap, matchKind)
    return {
      matchKind,
      confidence,
      candidates: scored.slice(0, 6),
      selectedIds: !ambiguous && (confidence === 'high' || confidence === 'medium') ? [hit.id] : [],
      kind: hit.kind,
    }
  }

  // Lump: payment covers ≥2 open bills of same party (FIFO), or clears all + leftover
  if (bestPartyBills.length >= 1) {
    const totalOpen = round2(bestPartyBills.reduce((s, b) => s + b.outstanding, 0))
    const firstOut = bestPartyBills[0]?.outstanding || 0
    const coversMulti =
      bestPartyBills.length >= 2
      && line.amount > firstOut + 5
      && totalOpen >= line.amount - 5
    const clearsAllWithAdvance =
      bestPartyBills.length >= 1
      && line.amount > totalOpen + 5
      && bestPartyScore >= 25
      && line.amount > firstOut + 5

    if (coversMulti || clearsAllWithAdvance) {
      let remaining = line.amount
      const selectedIds: string[] = []
      for (const bill of bestPartyBills) {
        if (remaining <= 0.01) break
        selectedIds.push(bill.id)
        remaining = round2(remaining - bill.outstanding)
      }
      const lumpCandidates = bestPartyBills
        .map((bill) => ({
          ...bill,
          score: Math.max(scoreBill(line, bill, parties), partyStrength(line, bill, parties) + 20),
        }))
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 8)

      return {
        matchKind: 'lump',
        confidence: 'medium',
        candidates: lumpCandidates.length ? lumpCandidates : scored.slice(0, 6),
        selectedIds,
        kind: bestPartyBills[0].kind,
      }
    }
  }

  // Partial: payment < top bill outstanding
  if (top && line.amount < top.outstanding - 5) {
    const matchKind: BankMatchKind = 'partial'
    const confidence = confidenceFromScore(top.score, topGap, matchKind)
    return {
      matchKind,
      confidence,
      candidates: scored.slice(0, 6),
      selectedIds: confidence === 'high' || confidence === 'medium' ? [top.id] : [],
      kind: top.kind,
    }
  }

  return {
    matchKind: 'unmatched',
    confidence: 'low',
    candidates: scored.slice(0, 6),
    selectedIds: [],
    kind: top.kind,
  }
}

export function buildBankMatchSuggestions(opts: {
  lines: ParsedBankLine[]
  invoices: Invoice[]
  purchases: Purchase[]
  parties: Party[]
  doneFingerprints?: Set<string>
}): BankMatchSuggestion[] {
  const done = opts.doneFingerprints || new Set<string>()
  const openPurchases: OpenBill[] = opts.purchases
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

  const openInvoices: OpenBill[] = opts.invoices
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
    const pool =
      line.side === 'debit'
        ? openPurchases
        : line.side === 'credit'
          ? openInvoices
          : [...openPurchases, ...openInvoices]

    const classified = classifyBankMatch({ line, pool, parties: opts.parties })
    const alreadyDone = done.has(fp)

    return {
      lineKey: fp,
      line,
      kind: classified.kind,
      matchKind: alreadyDone ? 'unmatched' : classified.matchKind,
      confidence: alreadyDone ? 'none' : classified.confidence,
      candidates: classified.candidates,
      selectedIds: alreadyDone ? [] : classified.selectedIds,
      ignored: false,
      alreadyDone,
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

export function matchKindLabel(kind: BankMatchKind): string {
  switch (kind) {
    case 'exact': return 'Exact'
    case 'partial': return 'Partial'
    case 'lump': return 'Lump sum'
    case 'advance': return 'Advance'
    default: return 'Unmatched'
  }
}
