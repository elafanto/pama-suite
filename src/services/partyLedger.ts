import type { Invoice, Party, Purchase } from '@/types/models'

export type PartyLedgerMode = 'customer' | 'vendor' | 'both'
export type PartyLedgerDocType = 'invoice' | 'purchase'

export interface PartyLedgerFilters {
  firmId: string
  mode: PartyLedgerMode
  partyId?: string
  partyName?: string
  from?: string
  to?: string
  month?: string
  pendingOnly?: boolean
  minAmount?: number | null
  maxAmount?: number | null
  minOutstanding?: number | null
  maxOutstanding?: number | null
}

export interface PartyLedgerPartyOption {
  id: string
  name: string
  roles: PartyLedgerMode[]
  source: 'party' | 'document'
}

export interface PartyLedgerRow {
  id: string
  docId: string
  docType: PartyLedgerDocType
  mode: Exclude<PartyLedgerMode, 'both'>
  date: string
  refNo: string
  type: string
  partyId: string | null
  partyName: string
  narration: string
  debit: number
  credit: number
  balance: number
  amount: number
  paid: number
  outstanding: number
  payStatus: string
}

export interface PartyLedgerTotals {
  debit: number
  credit: number
  balance: number
  billed: number
  received: number
  payable: number
  paid: number
  outstanding: number
  rows: number
  documents: number
}

export interface PartyLedgerResult {
  rows: PartyLedgerRow[]
  totals: PartyLedgerTotals
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

export function normalizePartyName(name: string | null | undefined) {
  return (name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function hasRole(party: Party, mode: PartyLedgerMode) {
  if (mode === 'both') return true
  return party.roles.includes(mode)
}

function matchesParty(
  recordPartyId: string | null | undefined,
  recordPartyName: string,
  filters: PartyLedgerFilters,
) {
  if (!filters.partyId && !filters.partyName) return true
  if (filters.partyId && recordPartyId === filters.partyId) return true
  if (!filters.partyName) return false
  return normalizePartyName(recordPartyName) === normalizePartyName(filters.partyName)
}

function inDateRange(date: string, filters: PartyLedgerFilters) {
  const from = filters.month ? `${filters.month}-01` : filters.from
  const to = filters.month ? `${filters.month}-31` : filters.to
  if (from && date < from) return false
  if (to && date > to) return false
  return true
}

function inAmountRange(amount: number, outstanding: number, filters: PartyLedgerFilters) {
  if (filters.minAmount != null && amount < filters.minAmount) return false
  if (filters.maxAmount != null && amount > filters.maxAmount) return false
  if (filters.minOutstanding != null && outstanding < filters.minOutstanding) return false
  if (filters.maxOutstanding != null && outstanding > filters.maxOutstanding) return false
  return true
}

export function buildPartyLedger(
  invoices: Invoice[],
  purchases: Purchase[],
  filters: PartyLedgerFilters,
): PartyLedgerResult {
  const entries: Omit<PartyLedgerRow, 'balance'>[] = []
  const seenDocs = new Set<string>()

  if (filters.mode === 'customer' || filters.mode === 'both') {
    for (const inv of invoices) {
      if (inv.firm_id !== filters.firmId || inv.is_deleted) continue
      if (inv.doc_type !== 'INVOICE' && inv.doc_type !== 'invoice') continue
      if (!inDateRange(inv.date, filters)) continue
      if (!matchesParty(inv.party_id, inv.party_name, filters)) continue

      const amount = round2(inv.grand_total)
      const paid = round2(inv.amt_paid)
      const outstanding = round2(Math.max(0, amount - paid))
      if (filters.pendingOnly && outstanding <= 0.01) continue
      if (!inAmountRange(amount, outstanding, filters)) continue

      seenDocs.add(`invoice:${inv.id}`)
      const writeOffNote = /write-off/i.test(inv.notes || '') ? ' Includes write-off.' : ''
      const base = {
        docId: inv.id,
        docType: 'invoice' as const,
        mode: 'customer' as const,
        date: inv.date,
        refNo: inv.bill_no,
        partyId: inv.party_id,
        partyName: inv.party_name || 'Unknown',
        amount,
        paid,
        outstanding,
        payStatus: inv.pay_status,
      }

      entries.push({
        ...base,
        id: `${inv.id}:bill`,
        type: 'Invoice',
        narration: `Billed to ${base.partyName}`,
        debit: amount,
        credit: 0,
      })

      if (paid > 0) {
        entries.push({
          ...base,
          id: `${inv.id}:paid`,
          type: /write-off/i.test(inv.notes || '') ? 'Receipt / Write-off' : 'Receipt',
          narration: `Received against ${inv.bill_no}.${writeOffNote}`,
          debit: 0,
          credit: paid,
        })
      }
    }
  }

  if (filters.mode === 'vendor' || filters.mode === 'both') {
    for (const pur of purchases) {
      const date = pur.received_date || pur.date
      if (pur.firm_id !== filters.firmId || pur.is_deleted) continue
      if (!inDateRange(date, filters)) continue
      if (!matchesParty(pur.supplier_id, pur.supplier_name, filters)) continue

      const amount = round2(pur.grand_total)
      const paid = round2(pur.amt_paid)
      const outstanding = round2(Math.max(0, amount - paid))
      if (filters.pendingOnly && outstanding <= 0.01) continue
      if (!inAmountRange(amount, outstanding, filters)) continue

      seenDocs.add(`purchase:${pur.id}`)
      const writeOffNote = /write-off/i.test(pur.notes || '') ? ' Includes write-off.' : ''
      const base = {
        docId: pur.id,
        docType: 'purchase' as const,
        mode: 'vendor' as const,
        date,
        refNo: pur.bill_no || pur.id.slice(0, 8),
        partyId: pur.supplier_id,
        partyName: pur.supplier_name || 'Unknown',
        amount,
        paid,
        outstanding,
        payStatus: pur.pay_status,
      }

      entries.push({
        ...base,
        id: `${pur.id}:bill`,
        type: 'Purchase',
        narration: `Payable to ${base.partyName}`,
        debit: 0,
        credit: amount,
      })

      if (paid > 0) {
        entries.push({
          ...base,
          id: `${pur.id}:paid`,
          type: /write-off/i.test(pur.notes || '') ? 'Payment / Write-off' : 'Payment',
          narration: `Paid against ${base.refNo}.${writeOffNote}`,
          debit: paid,
          credit: 0,
        })
      }
    }
  }

  let balance = 0
  const rows = entries
    .sort((a, b) => a.date.localeCompare(b.date) || a.refNo.localeCompare(b.refNo) || a.id.localeCompare(b.id))
    .map((row) => {
      balance = round2(row.mode === 'customer' ? balance + row.debit - row.credit : balance + row.credit - row.debit)
      return { ...row, balance }
    })

  const totals = rows.reduce<PartyLedgerTotals>(
    (acc, row) => {
      acc.debit = round2(acc.debit + row.debit)
      acc.credit = round2(acc.credit + row.credit)
      acc.balance = row.balance
      if (row.mode === 'customer' && row.type === 'Invoice') acc.billed = round2(acc.billed + row.amount)
      if (row.mode === 'customer' && row.credit > 0) acc.received = round2(acc.received + row.credit)
      if (row.mode === 'vendor' && row.type === 'Purchase') acc.payable = round2(acc.payable + row.amount)
      if (row.mode === 'vendor' && row.debit > 0) acc.paid = round2(acc.paid + row.debit)
      acc.outstanding = round2(acc.outstanding + (row.type === 'Invoice' || row.type === 'Purchase' ? row.outstanding : 0))
      acc.rows += 1
      return acc
    },
    { debit: 0, credit: 0, balance: 0, billed: 0, received: 0, payable: 0, paid: 0, outstanding: 0, rows: 0, documents: seenDocs.size },
  )

  return { rows, totals }
}

export function partyLedgerOptions(
  parties: Party[],
  invoices: Invoice[],
  purchases: Purchase[],
  firmId: string,
  mode: PartyLedgerMode = 'both',
): PartyLedgerPartyOption[] {
  const options = new Map<string, PartyLedgerPartyOption>()

  for (const party of parties) {
    if (party.firm_id !== firmId || party.is_deleted || !hasRole(party, mode)) continue
    const roles = party.roles.filter((role) => role === 'customer' || role === 'vendor') as PartyLedgerMode[]
    options.set(`id:${party.id}`, { id: party.id, name: party.name, roles, source: 'party' })
  }

  const addDocOption = (name: string, role: Exclude<PartyLedgerMode, 'both'>) => {
    const normalized = normalizePartyName(name)
    if (!normalized) return
    if (mode !== 'both' && mode !== role) return
    const hasExisting = [...options.values()].some((opt) => normalizePartyName(opt.name) === normalized)
    if (hasExisting) return
    options.set(`name:${normalized}`, { id: '', name, roles: [role], source: 'document' })
  }

  invoices
    .filter((inv) => inv.firm_id === firmId && !inv.is_deleted)
    .forEach((inv) => addDocOption(inv.party_name, 'customer'))

  purchases
    .filter((pur) => pur.firm_id === firmId && !pur.is_deleted)
    .forEach((pur) => addDocOption(pur.supplier_name, 'vendor'))

  return [...options.values()].sort((a, b) => a.name.localeCompare(b.name))
}
