import { isCustomerDebitDoc, normalizePartyName } from '@/services/partyPaymentAllocation'
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
  /** Resolved master party id from narration / bank hint. */
  partyId?: string | null
  partyName?: string
  reason?: string
}

export interface GeminiPartyResolution {
  lineIndex: number
  partyId: string | null
  partyName?: string
  extractedName?: string
  confidence: 'high' | 'medium' | 'low' | 'none'
  reason?: string
}

export interface GeminiPartyResolutionResponse {
  resolutions: GeminiPartyResolution[]
}

export interface GeminiBankMatchResponse {
  matches: GeminiBankMatchLine[]
}

interface BillCatalogRow {
  id: string
  kind: ReconcileDocKind
  refNo: string
  partyId: string | null
  partyName: string
  date: string
  outstanding: number
  acno?: string
}

export interface PartyCatalogRow {
  id: string
  name: string
  roles: string[]
  acno?: string
  ifsc?: string
  acname?: string
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

const VALID_KINDS = new Set<BankMatchKind>(['exact', 'partial', 'lump', 'advance', 'unmatched'])

function amountNear(a: number, b: number, tol = 5) {
  return Math.abs(round2(a) - round2(b)) <= tol
}

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

export function buildPartyCatalog(parties: Party[]): PartyCatalogRow[] {
  return parties
    .filter((p) => !p.is_deleted)
    .map((p) => ({
      id: p.id,
      name: p.name,
      roles: p.roles || [],
      acno: p.acno || undefined,
      ifsc: p.ifsc || undefined,
      acname: p.acname || undefined,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
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
      partyId: p.supplier_id || null,
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
      partyId: inv.party_id || null,
      partyName: inv.party_name || '',
      date: inv.date,
      outstanding,
      acno: party?.acno || undefined,
    })
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date))
}

export function catalogForParty(
  catalog: BillCatalogRow[],
  partyId: string | null | undefined,
  partyName?: string,
): BillCatalogRow[] {
  if (partyId) {
    const byId = catalog.filter((b) => b.partyId === partyId)
    if (byId.length) return byId
  }
  if (partyName) {
    const target = normalizePartyName(partyName)
    return catalog.filter((b) => normalizePartyName(b.partyName) === target)
  }
  return []
}

/** Suggest bill ids for a bank line amount within one party's open bills. */
export function suggestBillIdsForAmount(line: ParsedBankLine, bills: BillCatalogRow[]): string[] {
  const pool = bills
    .filter((b) => {
      if (line.side === 'debit') return b.kind === 'purchase'
      if (line.side === 'credit') return b.kind === 'invoice'
      return true
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.refNo.localeCompare(b.refNo))

  if (!pool.length) return []

  const exact = pool.find((b) => amountNear(b.outstanding, line.amount))
  if (exact) return [exact.id]

  if (line.amount < pool[0].outstanding - 5) return [pool[0].id]

  let remaining = line.amount
  const ids: string[] = []
  for (const bill of pool) {
    if (remaining <= 0.01) break
    ids.push(bill.id)
    remaining = round2(remaining - bill.outstanding)
  }
  const covered = round2(pool.filter((b) => ids.includes(b.id)).reduce((s, b) => s + b.outstanding, 0))
  if (ids.length >= 2 && covered >= line.amount - 5) return ids
  if (ids.length === 1) return ids
  return []
}

function validatePartyId(partyId: string | null | undefined, partyCatalog: PartyCatalogRow[]) {
  if (!partyId) return null
  return partyCatalog.some((p) => p.id === partyId) ? partyId : null
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
      partyId: b.partyId,
      partyName: b.partyName,
      date: b.date,
      grandTotal: b.outstanding,
      outstanding: b.outstanding,
      score: 90,
    }))
}

function partyBillsToCandidates(bills: BillCatalogRow[]) {
  return bills.map((b) => ({
    id: b.id,
    kind: b.kind,
    refNo: b.refNo,
    partyId: b.partyId,
    partyName: b.partyName,
    date: b.date,
    grandTotal: b.outstanding,
    outstanding: b.outstanding,
    score: 75,
  }))
}

/** Merge Gemini picks into rule-based suggestions (validated against open bills). */
export function applyGeminiBankMatches(
  suggestions: BankMatchSuggestion[],
  geminiMatches: GeminiBankMatchLine[],
  catalog: BillCatalogRow[],
  partyCatalog: PartyCatalogRow[] = [],
  partyResolutions: GeminiPartyResolution[] = [],
): BankMatchSuggestion[] {
  const byIndex = new Map(geminiMatches.map((m) => [m.lineIndex, m]))
  const partyByLine = new Map(partyResolutions.map((r) => [r.lineIndex, r]))

  return suggestions.map((row) => {
    const gem = byIndex.get(row.line.rowIndex)
    const partyRes = partyByLine.get(row.line.rowIndex)
    if ((!gem && !partyRes) || row.alreadyDone || row.ignored) return row

    const partyId = validatePartyId(gem?.partyId ?? partyRes?.partyId, partyCatalog)
    const partyName = gem?.partyName || partyRes?.partyName
    const partyReason = partyRes?.reason || gem?.reason
    const partyLabel = partyName || partyCatalog.find((p) => p.id === partyId)?.name

    const basePartyFields = {
      geminiEnhanced: true as const,
      geminiPartyId: partyId,
      geminiPartyName: partyLabel,
    }

    if (!gem) {
      if (!partyId && !partyName) return row
      const partyBills = catalogForParty(catalog, partyId, partyName)
      if (!partyBills.length) {
        return {
          ...row,
          ...basePartyFields,
          geminiReason: partyReason || `Party match: ${partyLabel || '?'}`,
        }
      }
      const suggestedIds = suggestBillIdsForAmount(row.line, partyBills)
      const matchKind: BankMatchKind = suggestedIds.length >= 2 ? 'lump' : suggestedIds.length === 1 ? 'exact' : 'unmatched'
      return {
        ...row,
        ...basePartyFields,
        matchKind: suggestedIds.length ? matchKind : row.matchKind,
        selectedIds: suggestedIds.length ? suggestedIds : row.selectedIds,
        candidates: partyBillsToCandidates(partyBills).slice(0, 8),
        confidence: suggestedIds.length ? (matchKind === 'lump' ? 'medium' : 'high') : 'low',
        geminiReason: partyReason || `Party: ${partyLabel}`,
      }
    }

    const matchKind = VALID_KINDS.has(gem.matchKind) ? gem.matchKind : row.matchKind
    let selectedIds = validateSelectedIds(row.line, gem.selectedBillIds || [], catalog)

    if (!selectedIds.length && (partyId || partyName)) {
      const partyBills = catalogForParty(catalog, partyId, partyName)
      selectedIds = suggestBillIdsForAmount(row.line, partyBills)
    }

    if (matchKind === 'advance' || (matchKind === 'unmatched' && !selectedIds.length)) {
      const partyBills = partyId || partyName ? catalogForParty(catalog, partyId, partyName) : []
      return {
        ...row,
        ...basePartyFields,
        matchKind,
        selectedIds: [],
        candidates: partyBills.length ? partyBillsToCandidates(partyBills).slice(0, 8) : row.candidates,
        confidence: matchKind === 'unmatched' ? 'low' : 'none',
        geminiReason: gem.reason || partyReason,
      }
    }

    if (!selectedIds.length) return { ...row, ...basePartyFields, geminiReason: gem.reason || partyReason }

    const mergedCandidates = [
      ...catalogCandidates(selectedIds, catalog),
      ...partyBillsToCandidates(catalogForParty(catalog, partyId, partyName)),
      ...row.candidates.filter((c) => !selectedIds.includes(c.id)),
    ]
      .filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i)
      .slice(0, 8)

    const kind = mergedCandidates[0]?.kind ?? row.kind

    return {
      ...row,
      ...basePartyFields,
      kind,
      matchKind,
      selectedIds,
      candidates: mergedCandidates,
      confidence: matchKind === 'lump' ? 'medium' : 'high',
      geminiReason: gem.reason || (partyLabel ? `Party: ${partyLabel}` : partyReason),
    }
  })
}

function buildPartyResolutionPrompt(lines: ParsedBankLine[], partyCatalog: PartyCatalogRow[]): string {
  return `You match Indian bank statement narrations to known parties in Pama ERP.

Party master (ONLY use these ids — never invent):
${JSON.stringify(partyCatalog.slice(0, 200), null, 0)}

Name matching tips:
- Ignore case, extra spaces, punctuation (U K Paper = UK PAPER = U.K.Paper)
- PVT LTD / PRIVATE LIMITED / PVT. LTD. are the same
- NEFT/RTGS/UPI text may truncate names — match best partial name
- Bank debit (money out) → usually vendor (roles includes vendor)
- Bank credit (money in) → usually customer (roles includes customer)
- acno / ifsc in narration is strong signal
- If no confident match, partyId null

Bank lines:
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
  "resolutions": [
    {
      "lineIndex": 1,
      "partyId": "uuid-or-null",
      "partyName": "matched master name",
      "extractedName": "name seen in narration",
      "confidence": "high|medium|low|none",
      "reason": "short note"
    }
  ]
}
One entry per bank line.`
}

function buildBillMatchPrompt(
  lines: ParsedBankLine[],
  catalog: BillCatalogRow[],
  partyCatalog: PartyCatalogRow[],
  resolutions: GeminiPartyResolution[],
): string {
  const byLine = new Map(resolutions.map((r) => [r.lineIndex, r]))
  return `You are an Indian accounts assistant reconciling bank statement lines to open bills in Pama ERP.

STEP 1 — Party is already resolved per line (use partyId to filter bills).
STEP 2 — Pick bill id(s) from open bills for that party.

Direction rules:
- Bank DEBIT → PURCHASE bills (vendor payment)
- Bank CREDIT → INVOICE bills (customer receipt)
- Payment date must be on or after bill date (else "advance")
- "exact": amount matches one bill outstanding within ₹5
- "partial": amount is less than the best bill outstanding
- "lump": one payment clears multiple open bills of the SAME party (FIFO by date)
- "advance": party matched but all their bills are dated AFTER the payment
- "unmatched": party known but no bill fits amount/date

Parties:
${JSON.stringify(partyCatalog.slice(0, 120), null, 0)}

Open bills (only use these ids):
${JSON.stringify(catalog.slice(0, 150), null, 0)}

Bank lines with resolved party:
${JSON.stringify(lines.map((l) => {
  const res = byLine.get(l.rowIndex)
  return {
    lineIndex: l.rowIndex,
    date: l.date,
    amount: l.amount,
    side: l.side,
    narration: l.narration,
    utr: l.utr,
    partyId: res?.partyId ?? null,
    partyName: res?.partyName ?? null,
  }
}), null, 0)}

Return JSON only:
{
  "matches": [
    {
      "lineIndex": 1,
      "matchKind": "exact|partial|lump|advance|unmatched",
      "partyId": "same as resolution",
      "partyName": "master party name",
      "selectedBillIds": ["bill-id-from-catalog"],
      "reason": "short Hindi/English note"
    }
  ]
}
Include one entry per bank line. selectedBillIds empty for advance/unmatched.`
}

export async function geminiResolveParties(opts: {
  apiKey: string
  lines: ParsedBankLine[]
  parties: Party[]
  onProgress?: (message: string) => void
}): Promise<GeminiPartyResolution[]> {
  const partyCatalog = buildPartyCatalog(opts.parties)
  if (!opts.lines.length || !partyCatalog.length) return []

  const all: GeminiPartyResolution[] = []
  const batches: ParsedBankLine[][] = []
  for (let i = 0; i < opts.lines.length; i += BATCH_SIZE) {
    batches.push(opts.lines.slice(i, i + BATCH_SIZE))
  }

  for (let i = 0; i < batches.length; i += 1) {
    opts.onProgress?.(`Gemini party name match ${i + 1}/${batches.length}…`)
    const prompt = buildPartyResolutionPrompt(batches[i], partyCatalog)
    const result = await geminiTextJson<GeminiPartyResolutionResponse>(opts.apiKey, prompt)
    if (Array.isArray(result?.resolutions)) {
      for (const row of result.resolutions) {
        all.push({
          ...row,
          partyId: validatePartyId(row.partyId, partyCatalog),
        })
      }
    }
    if (i < batches.length - 1) await sleep(400)
  }

  return all
}

export async function geminiEnhanceBankMatches(opts: {
  apiKey: string
  suggestions: BankMatchSuggestion[]
  invoices: Invoice[]
  purchases: Purchase[]
  parties: Party[]
  onProgress?: (message: string) => void
}): Promise<BankMatchSuggestion[]> {
  const partyCatalog = buildPartyCatalog(opts.parties)
  const catalog = buildBillCatalog({
    invoices: opts.invoices,
    purchases: opts.purchases,
    parties: opts.parties,
  })

  const pending = opts.suggestions.filter((s) => !s.alreadyDone && !s.ignored)
  if (!pending.length) return opts.suggestions

  const allLines = pending.map((s) => s.line)

  opts.onProgress?.('Gemini: party name match…')
  const partyResolutions = await geminiResolveParties({
    apiKey: opts.apiKey,
    lines: allLines,
    parties: opts.parties,
    onProgress: opts.onProgress,
  })

  const resolutionByLine = new Map(partyResolutions.map((r) => [r.lineIndex, r]))
  const allGemini: GeminiBankMatchLine[] = []
  const batches: ParsedBankLine[][] = []
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    batches.push(pending.slice(i, i + BATCH_SIZE).map((s) => s.line))
  }

  for (let i = 0; i < batches.length; i += 1) {
    opts.onProgress?.(`Gemini bill match ${i + 1}/${batches.length}…`)
    const batchRes = batches[i]
      .map((l) => resolutionByLine.get(l.rowIndex))
      .filter((r): r is GeminiPartyResolution => !!r)
    const prompt = buildBillMatchPrompt(batchRes.length ? batches[i] : allLines, catalog, partyCatalog, batchRes.length ? batchRes : partyResolutions)
    const result = await geminiTextJson<GeminiBankMatchResponse>(opts.apiKey, prompt)
    if (Array.isArray(result?.matches)) {
      allGemini.push(...result.matches)
    }
    if (i < batches.length - 1) await sleep(400)
  }

  return applyGeminiBankMatches(opts.suggestions, allGemini, catalog, partyCatalog, partyResolutions)
}
