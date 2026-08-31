import { isCustomerDebitDoc } from '@/services/partyPaymentAllocation'
import { isInvoiceActive } from '@/services/invoiceStatus'
import type { BankMatchKind, BankMatchSuggestion, ReconcileDocKind } from '@/services/bankStatementMatch'
import type { ParsedBankLine } from '@/services/bankStatementParse'
import type { Invoice, Party, Purchase } from '@/types/models'

const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const GEMINI_TIMEOUT_MS = 90_000
const BATCH_SIZE = 20

export interface GeminiBankMatchLine {
  lineIndex: number
  matchKind: BankMatchKind
  selectedBillIds: string[]
  reason?: string
}

export interface GeminiBankMatchResponse {
  matches: GeminiBankMatchLine[]
}

interface BillCatalogRow {
  id: string
  kind: ReconcileDocKind
  refNo: string
  partyName: string
  date: string
  outstanding: number
  acno?: string
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

const VALID_KINDS = new Set<BankMatchKind>(['exact', 'partial', 'lump', 'advance', 'unmatched'])

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

function extractJsonPayload(text: string): unknown {
  const unfenced = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const direct = tryParseJson(unfenced)
  if (direct.ok) return direct.value

  const start = unfenced.indexOf('{')
  if (start >= 0) {
    const end = unfenced.lastIndexOf('}')
    if (end > start) {
      const parsed = tryParseJson(unfenced.slice(start, end + 1))
      if (parsed.ok) return parsed.value
    }
  }
  throw new Error('Gemini bank match: JSON parse fail')
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

async function geminiTextJson<T>(apiKey: string, prompt: string): Promise<T> {
  if (!apiKey) throw new Error('Gemini API key missing — Settings me save karo')

  const url = `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { response_mime_type: 'application/json' },
    }),
  }

  const res = await fetchWithTimeout(url, init, GEMINI_TIMEOUT_MS)
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini error ${res.status}: ${err.slice(0, 240)}`)
  }

  const json = await res.json()
  const text = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p?.text || '').join('\n') || ''
  return extractJsonPayload(text) as T
}

export function buildBillCatalog(opts: {
  invoices: Invoice[]
  purchases: Purchase[]
  parties: Party[]
}): BillCatalogRow[] {
  const partyById = new Map(opts.parties.map((p) => [p.id, p]))
  const rows: BillCatalogRow[] = []

  for (const p of opts.purchases) {
    if (p.is_deleted) continue
    const outstanding = round2(Math.max(0, (p.grand_total || 0) - (p.amt_paid || 0)))
    if (outstanding <= 0.01) continue
    const party = p.supplier_id ? partyById.get(p.supplier_id) : undefined
    rows.push({
      id: p.id,
      kind: 'purchase',
      refNo: p.bill_no || '',
      partyName: p.supplier_name || '',
      date: p.received_date || p.date,
      outstanding,
      acno: party?.acno || undefined,
    })
  }

  for (const inv of opts.invoices) {
    if (!isInvoiceActive(inv) || !isCustomerDebitDoc(inv)) continue
    const outstanding = round2(Math.max(0, (inv.grand_total || 0) - (inv.amt_paid || 0)))
    if (outstanding <= 0.01) continue
    const party = inv.party_id ? partyById.get(inv.party_id) : undefined
    rows.push({
      id: inv.id,
      kind: 'invoice',
      refNo: inv.bill_no || '',
      partyName: inv.party_name || '',
      date: inv.date,
      outstanding,
      acno: party?.acno || undefined,
    })
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date))
}

function allowedBillIds(line: ParsedBankLine, catalog: BillCatalogRow[]): Set<string> {
  const ids = new Set<string>()
  for (const bill of catalog) {
    if (line.side === 'debit' && bill.kind !== 'purchase') continue
    if (line.side === 'credit' && bill.kind !== 'invoice') continue
    ids.add(bill.id)
  }
  return ids
}

function validateSelectedIds(
  line: ParsedBankLine,
  ids: string[],
  catalog: BillCatalogRow[],
): string[] {
  const allow = allowedBillIds(line, catalog)
  return ids.filter((id) => allow.has(id))
}

function catalogCandidates(ids: string[], catalog: BillCatalogRow[]) {
  const byId = new Map(catalog.map((b) => [b.id, b]))
  return ids
    .map((id) => byId.get(id))
    .filter((b): b is BillCatalogRow => !!b)
    .map((b) => ({
      id: b.id,
      kind: b.kind,
      refNo: b.refNo,
      partyId: null as string | null,
      partyName: b.partyName,
      date: b.date,
      grandTotal: b.outstanding,
      outstanding: b.outstanding,
      score: 90,
    }))
}

/** Merge Gemini picks into rule-based suggestions (validated against open bills). */
export function applyGeminiBankMatches(
  suggestions: BankMatchSuggestion[],
  geminiMatches: GeminiBankMatchLine[],
  catalog: BillCatalogRow[],
): BankMatchSuggestion[] {
  const byIndex = new Map(geminiMatches.map((m) => [m.lineIndex, m]))
  return suggestions.map((row) => {
    const gem = byIndex.get(row.line.rowIndex)
    if (!gem || row.alreadyDone || row.ignored) return row

    const matchKind = VALID_KINDS.has(gem.matchKind) ? gem.matchKind : row.matchKind
    const selectedIds = validateSelectedIds(row.line, gem.selectedBillIds || [], catalog)

    if (matchKind === 'advance' || matchKind === 'unmatched') {
      return {
        ...row,
        matchKind,
        selectedIds: [],
        candidates: row.candidates,
        confidence: matchKind === 'unmatched' ? 'low' : 'none',
        geminiEnhanced: true,
        geminiReason: gem.reason,
      }
    }

    if (!selectedIds.length) return row

    const mergedCandidates = [
      ...catalogCandidates(selectedIds, catalog),
      ...row.candidates.filter((c) => !selectedIds.includes(c.id)),
    ].slice(0, 8)

    const kind = mergedCandidates[0]?.kind ?? row.kind

    return {
      ...row,
      kind,
      matchKind,
      selectedIds,
      candidates: mergedCandidates,
      confidence: matchKind === 'lump' ? 'medium' : 'high',
      geminiEnhanced: true,
      geminiReason: gem.reason,
    }
  })
}

function buildPrompt(lines: ParsedBankLine[], catalog: BillCatalogRow[]): string {
  return `You are an Indian accounts assistant reconciling bank statement lines to open bills in Pama ERP.

Direction rules:
- Bank DEBIT (money out / withdrawal) → match PURCHASE bills (vendor payment)
- Bank CREDIT (money in / deposit) → match INVOICE bills (customer receipt)
- Payment date must be on or after bill date (else "advance")
- "exact": amount matches one bill outstanding within ₹5
- "partial": amount is less than the best bill outstanding
- "lump": one payment clears multiple open bills of the SAME party (FIFO by date)
- "advance": strong party in narration but all their bills are dated AFTER the payment
- "unmatched": no confident match

Open bills (id is authoritative — only use these ids):
${JSON.stringify(catalog.slice(0, 120), null, 0)}

Bank lines to reconcile:
${JSON.stringify(lines.map((l) => ({
  lineIndex: l.rowIndex,
  date: l.date,
  amount: l.amount,
  side: l.side,
  narration: l.narration,
  utr: l.utr,
  partyHint: l.partyHint,
})), null, 0)}

Return JSON only:
{
  "matches": [
    {
      "lineIndex": 1,
      "matchKind": "exact|partial|lump|advance|unmatched",
      "selectedBillIds": ["bill-id-from-catalog"],
      "reason": "short Hindi/English note"
    }
  ]
}
Include one entry per bank line. selectedBillIds empty for advance/unmatched.`
}

export async function geminiEnhanceBankMatches(opts: {
  apiKey: string
  suggestions: BankMatchSuggestion[]
  invoices: Invoice[]
  purchases: Purchase[]
  parties: Party[]
  onProgress?: (message: string) => void
}): Promise<BankMatchSuggestion[]> {
  const catalog = buildBillCatalog({
    invoices: opts.invoices,
    purchases: opts.purchases,
    parties: opts.parties,
  })

  const pending = opts.suggestions.filter((s) => !s.alreadyDone && !s.ignored)
  if (!pending.length) return opts.suggestions

  const allGemini: GeminiBankMatchLine[] = []
  const batches: ParsedBankLine[][] = []
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    batches.push(pending.slice(i, i + BATCH_SIZE).map((s) => s.line))
  }

  for (let i = 0; i < batches.length; i += 1) {
    opts.onProgress?.(`Gemini matching batch ${i + 1}/${batches.length}…`)
    const prompt = buildPrompt(batches[i], catalog)
    const result = await geminiTextJson<GeminiBankMatchResponse>(opts.apiKey, prompt)
    if (Array.isArray(result?.matches)) {
      allGemini.push(...result.matches)
    }
    if (i < batches.length - 1) await sleep(400)
  }

  return applyGeminiBankMatches(opts.suggestions, allGemini, catalog)
}
