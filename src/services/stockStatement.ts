import { db } from '@/data/db'
import { nowISO, uid } from '@/data/util'
import type {
  StockStatement,
  StockStatementLine,
  StockStatementPaperLine,
  StockStatementSegment,
  StockStatementSimpleLine,
} from '@/types/models'

export const STOCK_SEGMENT_LABELS: Record<StockStatementSegment, string> = {
  paper: 'Paper',
  gum: 'Gum',
  stitching_wire: 'Stitching Wire',
  consumables: 'Consumables',
}

export const STOCK_SEGMENTS: StockStatementSegment[] = ['paper', 'gum', 'stitching_wire', 'consumables']

export function newPaperLine(): StockStatementPaperLine {
  return {
    id: uid(),
    segment: 'paper',
    paper_name: '',
    bf: '',
    gsm: '',
    qty: 0,
    unit: 'KG',
    rate: 0,
    amount: 0,
  }
}

export function newSimpleLine(segment: Exclude<StockStatementSegment, 'paper'>): StockStatementSimpleLine {
  return {
    id: uid(),
    segment,
    item_name: '',
    qty: 0,
    unit: segment === 'stitching_wire' ? 'KG' : 'KG',
    rate: 0,
    amount: 0,
  }
}

export function newStatementNo(dateIso: string) {
  const d = (dateIso || '').slice(0, 10).replace(/-/g, '')
  return `SS-${d || 'DRAFT'}`
}

export function createBlankStockStatement(firmId: string): StockStatement {
  const now = nowISO()
  const statementDate = now.slice(0, 10)
  return {
    id: uid(),
    firm_id: firmId,
    created_at: now,
    updated_at: now,
    is_deleted: false,
    _dirty: true,
    statement_no: newStatementNo(statementDate),
    statement_date: statementDate,
    bank_name: '',
    branch_name: '',
    remarks: '',
    lines: [
      newPaperLine(),
      newSimpleLine('gum'),
      newSimpleLine('stitching_wire'),
      newSimpleLine('consumables'),
    ],
  }
}

export function computeLineAmount<T extends Pick<StockStatementLine, 'qty' | 'rate'>>(line: T) {
  return Math.round((Number(line.qty) || 0) * (Number(line.rate) || 0) * 100) / 100
}

export function normalizeStockStatement(statement: StockStatement): StockStatement {
  const lines = (statement.lines || []).map((line) => {
    const amount = computeLineAmount(line)
    if (line.segment === 'paper') {
      return {
        ...line,
        paper_name: line.paper_name || '',
        bf: line.bf || '',
        gsm: line.gsm || '',
        unit: line.unit || 'KG',
        qty: Number(line.qty) || 0,
        rate: Number(line.rate) || 0,
        amount,
      }
    }
    return {
      ...line,
      item_name: line.item_name || '',
      unit: line.unit || 'KG',
      qty: Number(line.qty) || 0,
      rate: Number(line.rate) || 0,
      amount,
    }
  })
  return {
    ...statement,
    statement_no: statement.statement_no || newStatementNo(statement.statement_date),
    lines,
  }
}

export function segmentTotal(lines: StockStatementLine[], segment: StockStatementSegment) {
  return Math.round(lines.filter((line) => line.segment === segment).reduce((sum, line) => sum + computeLineAmount(line), 0) * 100) / 100
}

export function grandTotal(lines: StockStatementLine[]) {
  return Math.round(lines.reduce((sum, line) => sum + computeLineAmount(line), 0) * 100) / 100
}

export async function listStockStatements(firmId: string): Promise<StockStatement[]> {
  const rows = await db.stock_statements.where('firm_id').equals(firmId).filter((row) => !row.is_deleted).toArray()
  return rows
    .map((row) => normalizeStockStatement(row))
    .sort((a, b) => (b.statement_date || '').localeCompare(a.statement_date || '') || (b.updated_at || '').localeCompare(a.updated_at || ''))
}

export async function saveStockStatement(statement: StockStatement): Promise<StockStatement> {
  const now = nowISO()
  const normalized = normalizeStockStatement({
    ...statement,
    updated_at: now,
    _dirty: true,
  })
  const existing = await db.stock_statements.get(normalized.id)
  const payload = existing
    ? normalized
    : { ...normalized, created_at: now, updated_at: now, is_deleted: false, _dirty: true }
  await db.stock_statements.put(payload)
  return payload
}

export async function softDeleteStockStatement(id: string) {
  const existing = await db.stock_statements.get(id)
  if (!existing) return
  await db.stock_statements.put({ ...existing, is_deleted: true, updated_at: nowISO(), _dirty: true })
}
