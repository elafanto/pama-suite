import * as XLSX from 'xlsx'

export type BankLineSide = 'debit' | 'credit' | 'unknown'

export interface ParsedBankLine {
  rowIndex: number
  date: string
  amount: number
  side: BankLineSide
  narration: string
  utr: string
  partyHint: string
  raw: Record<string, string>
}

export interface BankColumnMapping {
  date: string
  amount: string
  /** Optional: column with Dr/Cr or Withdrawal/Deposit */
  side?: string
  /** Optional separate debit amount column */
  debitAmount?: string
  /** Optional separate credit amount column */
  creditAmount?: string
  narration?: string
  utr?: string
  partyHint?: string
}

export interface BankSheetPreview {
  sheetName: string
  headers: string[]
  rows: Record<string, string>[]
  /** Total data rows after detected header (full sheet, not preview slice). */
  totalDataRows: number
  /** 0-based index of the header row in the Excel sheet. */
  headerRowIndex: number
  suggestedMapping: BankColumnMapping
}

const DATE_KEYS = ['date', 'txn date', 'transaction date', 'value date', 'tran date', 'posting date']
const AMOUNT_KEYS = ['amount', 'txn amount', 'transaction amount', 'amt']
const DEBIT_KEYS = ['debit', 'withdrawal', 'dr', 'debit amount', 'withdrawals']
const CREDIT_KEYS = ['credit', 'deposit', 'cr', 'credit amount', 'deposits']
const SIDE_KEYS = ['dr/cr', 'type', 'txn type', 'transaction type', 'debit/credit']
const NARR_KEYS = ['narration', 'description', 'particulars', 'remarks', 'details', 'transaction remarks']
const UTR_KEYS = ['utr', 'ref no', 'reference', 'cheque no', 'chq/ref no', 'transaction id']
const PARTY_KEYS = ['party', 'beneficiary', 'counterparty', 'payee', 'name']

function normHeader(h: string) {
  return String(h || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function findHeader(headers: string[], candidates: string[]) {
  const map = new Map(headers.map((h) => [normHeader(h), h]))
  for (const c of candidates) {
    const hit = map.get(c)
    if (hit) return hit
  }
  for (const h of headers) {
    const n = normHeader(h)
    if (candidates.some((c) => n.includes(c))) return h
  }
  return ''
}

export function suggestBankColumnMapping(headers: string[]): BankColumnMapping {
  return {
    date: findHeader(headers, DATE_KEYS),
    amount: findHeader(headers, AMOUNT_KEYS),
    debitAmount: findHeader(headers, DEBIT_KEYS),
    creditAmount: findHeader(headers, CREDIT_KEYS),
    side: findHeader(headers, SIDE_KEYS),
    narration: findHeader(headers, NARR_KEYS),
    utr: findHeader(headers, UTR_KEYS),
    partyHint: findHeader(headers, PARTY_KEYS),
  }
}

function parseExcelDate(value: unknown): string {
  if (value == null || value === '') return ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) {
      const mm = String(parsed.m).padStart(2, '0')
      const dd = String(parsed.d).padStart(2, '0')
      return `${parsed.y}-${mm}-${dd}`
    }
  }
  const s = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/)
  if (dmy) {
    const d = dmy[1].padStart(2, '0')
    const m = dmy[2].padStart(2, '0')
    let y = dmy[3]
    if (y.length === 2) y = Number(y) > 50 ? `19${y}` : `20${y}`
    return `${y}-${m}-${d}`
  }
  const dt = new Date(s)
  if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10)
  return ''
}

function parseAmount(value: unknown): number {
  if (value == null || value === '') return 0
  if (typeof value === 'number') return Math.round(Math.abs(value) * 100) / 100
  const cleaned = String(value).replace(/[,₹\s]/g, '').replace(/^\((.*)\)$/, '-$1')
  const n = Number(cleaned)
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) / 100 : 0
}

function rowHeaderScore(cells: string[]): number {
  const headers = cells.map((c) => normHeader(String(c)))
  let score = 0
  if (headers.some((h) => DATE_KEYS.some((k) => h === k || h.includes(k)))) score += 4
  if (headers.some((h) => DEBIT_KEYS.some((k) => h === k || h.includes(k)))) score += 3
  if (headers.some((h) => CREDIT_KEYS.some((k) => h === k || h.includes(k)))) score += 3
  if (headers.some((h) => AMOUNT_KEYS.some((k) => h === k || h.includes(k)))) score += 3
  if (headers.some((h) => NARR_KEYS.some((k) => h === k || h.includes(k)))) score += 1
  if (headers.some((h) => UTR_KEYS.some((k) => h === k || h.includes(k)))) score += 1
  return score
}

export interface BankSheetLayout {
  headerRowIndex: number
  headers: string[]
  dataRows: Record<string, unknown>[]
}

/** Find header row (banks often put account info in first 5–15 rows) and read all data below. */
export function layoutBankSheetRows(matrix: unknown[][]): BankSheetLayout {
  if (!matrix.length) {
    return { headerRowIndex: 0, headers: [], dataRows: [] }
  }

  let headerRowIndex = 0
  let bestScore = 0
  const scanLimit = Math.min(matrix.length, 50)
  for (let i = 0; i < scanLimit; i += 1) {
    const cells = (matrix[i] || []).map((c) => String(c ?? '').trim())
    const score = rowHeaderScore(cells)
    if (score > bestScore) {
      bestScore = score
      headerRowIndex = i
    }
  }

  const headerCells = (matrix[headerRowIndex] || []).map((c, i) => {
    const name = String(c ?? '').trim()
    return name || `Column ${i + 1}`
  })

  const dataRows: Record<string, unknown>[] = []
  for (let r = headerRowIndex + 1; r < matrix.length; r += 1) {
    const row = matrix[r] || []
    const hasValue = row.some((c) => c != null && String(c).trim() !== '')
    if (!hasValue) continue
    const obj: Record<string, unknown> = {}
    headerCells.forEach((h, i) => {
      obj[h] = row[i] ?? ''
    })
    dataRows.push(obj)
  }

  return { headerRowIndex, headers: headerCells, dataRows }
}

function readSheetLayout(sheet: XLSX.WorkSheet): BankSheetLayout {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true }) as unknown[][]
  return layoutBankSheetRows(matrix)
}

function rowsToStringRecords(rows: Record<string, unknown>[], headers: string[]) {
  return rows.map((row) => {
    const out: Record<string, string> = {}
    for (const h of headers) out[h] = String(row[h] ?? '')
    return out
  })
}

function detectSide(
  row: Record<string, string>,
  mapping: BankColumnMapping,
  signedAmount: number,
): BankLineSide {
  if (mapping.debitAmount && parseAmount(row[mapping.debitAmount]) > 0) return 'debit'
  if (mapping.creditAmount && parseAmount(row[mapping.creditAmount]) > 0) return 'credit'
  if (mapping.side) {
    const s = String(row[mapping.side] || '').trim().toLowerCase()
    if (s.startsWith('dr') || s.includes('debit') || s.includes('withdraw')) return 'debit'
    if (s.startsWith('cr') || s.includes('credit') || s.includes('deposit')) return 'credit'
  }
  if (signedAmount < 0) return 'debit'
  if (signedAmount > 0) return 'credit'
  return 'unknown'
}

function parseRowsToLines(json: Record<string, unknown>[], mapping: BankColumnMapping): ParsedBankLine[] {
  const lines: ParsedBankLine[] = []

  json.forEach((row, idx) => {
    const raw: Record<string, string> = {}
    for (const [k, v] of Object.entries(row)) raw[k] = String(v ?? '')

    const date = parseExcelDate(row[mapping.date])
    let amount = 0
    let signed = 0
    if (mapping.debitAmount || mapping.creditAmount) {
      const dr = mapping.debitAmount ? parseAmount(row[mapping.debitAmount]) : 0
      const cr = mapping.creditAmount ? parseAmount(row[mapping.creditAmount]) : 0
      if (dr > 0) {
        amount = dr
        signed = -dr
      } else if (cr > 0) {
        amount = cr
        signed = cr
      }
    } else if (mapping.amount) {
      const rawAmt = row[mapping.amount]
      const n = typeof rawAmt === 'number' ? rawAmt : Number(String(rawAmt).replace(/[,₹\s]/g, '').replace(/^\((.*)\)$/, '-$1'))
      signed = Number.isFinite(n) ? n : 0
      amount = Math.abs(signed)
    }
    if (!date || amount <= 0) return

    const side = detectSide(raw, mapping, signed)
    lines.push({
      rowIndex: idx + 1,
      date,
      amount: Math.round(amount * 100) / 100,
      side,
      narration: mapping.narration ? String(row[mapping.narration] || '').trim() : '',
      utr: mapping.utr ? String(row[mapping.utr] || '').trim() : '',
      partyHint: mapping.partyHint ? String(row[mapping.partyHint] || '').trim() : '',
      raw,
    })
  })

  return lines
}

export async function previewBankStatementFile(file: File): Promise<BankSheetPreview> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('Excel/CSV me koi sheet nahi mili')
  const sheet = wb.Sheets[sheetName]
  const layout = readSheetLayout(sheet)
  if (!layout.headers.length || !layout.dataRows.length) throw new Error('File empty hai ya header row detect nahi hui')

  const stringRows = rowsToStringRecords(layout.dataRows, layout.headers)
  return {
    sheetName,
    headers: layout.headers,
    rows: stringRows.slice(0, 8),
    totalDataRows: layout.dataRows.length,
    headerRowIndex: layout.headerRowIndex,
    suggestedMapping: suggestBankColumnMapping(layout.headers),
  }
}

export async function parseBankStatementFile(file: File, mapping: BankColumnMapping): Promise<ParsedBankLine[]> {
  if (!mapping.date) throw new Error('Date column map karo')
  if (!mapping.amount && !mapping.debitAmount && !mapping.creditAmount) {
    throw new Error('Amount / Debit / Credit column map karo')
  }

  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const sheetName = wb.SheetNames[0]
  const sheet = wb.Sheets[sheetName]
  const layout = readSheetLayout(sheet)
  const lines = parseRowsToLines(layout.dataRows, mapping)

  if (!lines.length) throw new Error('Koi valid bank line nahi mili — mapping check karo')
  return lines
}

export function bankLineFingerprint(line: Pick<ParsedBankLine, 'date' | 'amount' | 'side' | 'narration' | 'utr'>) {
  return [
    line.date,
    line.side,
    line.amount.toFixed(2),
    (line.utr || '').toLowerCase(),
    (line.narration || '').toLowerCase().slice(0, 80),
  ].join('|')
}
