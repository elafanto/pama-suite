import { isInvoiceActive } from '@/services/invoiceStatus'
import {
  isCustomerCreditDoc,
  isCustomerDebitDoc,
  normalizePartyName as normalizePartyNameShared,
  parseAllocTag,
} from '@/services/partyPaymentAllocation'
import type { Invoice, Party, PartyAdvance, Purchase, Voucher } from '@/types/models'

export type PartyLedgerMode = 'customer' | 'vendor' | 'both'
export type PartyLedgerDocType = 'invoice' | 'purchase' | 'advance'

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
  balance: number | null
  amount: number
  paid: number
  outstanding: number
  payStatus: string
}

export interface PartyLedgerTotals {
  debit: number
  credit: number
  balance: number | null
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

function invoiceDocKind(inv: Invoice) {
  return String(inv.doc_type || 'INVOICE').toUpperCase()
}

function customerDocLabel(inv: Invoice) {
  const kind = invoiceDocKind(inv)
  if (kind === 'CREDIT_NOTE') return 'Credit Note'
  if (kind === 'DEBIT_NOTE') return 'Debit Note'
  if (kind === 'BILL_OF_SUPPLY') return 'Bill of Supply'
  if (kind === 'DELIVERY_CHALLAN') return 'Delivery Challan'
  return 'Invoice'
}

export function normalizePartyName(name: string | null | undefined) {
  return normalizePartyNameShared(name)
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

/** Prefer recorded payment date, then PAY/RECEIPT voucher date, else bill date. */
export function resolvePaymentLedgerDate(
  docId: string,
  billDate: string,
  lastPaymentDate?: string | null,
  vouchers?: Voucher[],
): string {
  const stored = String(lastPaymentDate || '').trim()
  if (stored) return stored.slice(0, 10)
  if (vouchers?.length) {
    const payRef = `${docId}_PAY`
    const matches = vouchers
      .filter((v) => !v.is_deleted && v.ref_id === payRef && (v.type === 'PAYMENT' || v.type === 'RECEIPT'))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.updated_at || '').localeCompare(a.updated_at || ''))
    if (matches[0]?.date) return matches[0].date.slice(0, 10)
  }
  return billDate
}

/** Receipt / payment amount from voucher when available (lump-sum safe). */
export function resolvePaymentLedgerAmount(
  docId: string,
  recordedPaid: number,
  mode: 'customer' | 'vendor',
  vouchers?: Voucher[],
): number {
  const payRef = `${docId}_PAY`
  const voucher = vouchers
    ?.filter((v) => !v.is_deleted && v.ref_id === payRef && (v.type === 'PAYMENT' || v.type === 'RECEIPT'))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.updated_at || '').localeCompare(a.updated_at || ''))[0]
  if (!voucher?.entries?.length) return round2(recordedPaid)

  const bankDebit = round2(
    voucher.entries
      .filter((e) => /bank|cash/i.test(e.accountName || '') && (e.debit || 0) > 0)
      .reduce((s, e) => s + (e.debit || 0), 0),
  )
  const bankCredit = round2(
    voucher.entries
      .filter((e) => /bank|cash/i.test(e.accountName || '') && (e.credit || 0) > 0)
      .reduce((s, e) => s + (e.credit || 0), 0),
  )
  const fromVoucher = mode === 'customer' ? bankDebit : bankCredit
  if (fromVoucher > 0) return fromVoucher
  return round2(recordedPaid)
}

function findPayVoucher(docId: string, vouchers?: Voucher[]) {
  const payRef = `${docId}_PAY`
  return vouchers
    ?.filter((v) => !v.is_deleted && v.ref_id === payRef && (v.type === 'PAYMENT' || v.type === 'RECEIPT'))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.updated_at || '').localeCompare(a.updated_at || ''))[0]
}

function findAllocPartsForDoc(docId: string, vouchers?: Voucher[]) {
  if (!vouchers?.length) return [] as ReturnType<typeof parseAllocTag>
  const own = parseAllocTag(findPayVoucher(docId, vouchers)?.narration || '')
  if (own.length) return own
  for (const v of vouchers) {
    if (v.is_deleted || (v.type !== 'PAYMENT' && v.type !== 'RECEIPT')) continue
    const parts = parseAllocTag(v.narration || '')
    if (parts.some((p) => p.id === docId)) return parts
  }
  return []
}

/** Clear lump / settlement text for party statements */
export function resolvePaymentLedgerNarration(opts: {
  docId: string
  billNo: string
  paid: number
  billAmount: number
  voucherTotal: number
  mode: 'customer' | 'vendor'
  billNotes?: string
  vouchers?: Voucher[]
}): string {
  const verb = opts.mode === 'customer' ? 'Received' : 'Paid'
  const writeOffMatch = (opts.billNotes || '').match(/\[Write-off:\s*₹?([\d,.]+)\s*—\s*([^\]]+)\]/i)
    || (opts.billNotes || '').match(/\[Write-off:\s*₹?([\d,.]+)\]/i)
  const writeOffNote = writeOffMatch
    ? writeOffMatch[2]
      ? ` Includes ${writeOffMatch[2].trim()} ₹${writeOffMatch[1]}.`
      : ` Includes write-off ₹${writeOffMatch[1]}.`
    : /write-off/i.test(opts.billNotes || '')
      ? ' Includes write-off.'
      : ''

  const allocParts = findAllocPartsForDoc(opts.docId, opts.vouchers)
  if (allocParts.length > 1) {
    const breakdown = allocParts
      .map((p) => `${p.billNo} ₹${p.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
      .join(' + ')
    const lumpTotal = round2(allocParts.reduce((s, p) => s + p.amount, 0))
    const thisPart = allocParts.find((p) => p.id === opts.docId)
    if (thisPart && thisPart.id !== allocParts[0].id) {
      return `Part of lump ${verb.toLowerCase()} ₹${lumpTotal.toLocaleString('en-IN')} (${breakdown}) — this bill ₹${thisPart.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.${writeOffNote}`
    }
    return `${verb} ₹${Math.max(opts.voucherTotal, lumpTotal).toLocaleString('en-IN')} lump · ${breakdown}.${writeOffNote}`
  }

  if (opts.voucherTotal > opts.paid + 0.01 || opts.paid > opts.billAmount + 0.01) {
    return `${verb} ₹${Math.max(opts.voucherTotal, opts.paid).toLocaleString('en-IN')} against ${opts.billNo} (lump sum).${writeOffNote}`
  }
  return `${verb} against ${opts.billNo}.${writeOffNote}`
}

function compareLedgerRows(a: Omit<PartyLedgerRow, 'balance'>, b: Omit<PartyLedgerRow, 'balance'>) {
  const byDate = a.date.localeCompare(b.date)
  if (byDate !== 0) return byDate
  const byRef = a.refNo.localeCompare(b.refNo)
  if (byRef !== 0) return byRef
  const aBill = a.id.endsWith(':bill')
  const bBill = b.id.endsWith(':bill')
  if (aBill && !bBill) return -1
  if (!aBill && bBill) return 1
  return a.id.localeCompare(b.id)
}

function inAmountRange(amount: number, outstanding: number, filters: PartyLedgerFilters) {
  if (filters.minAmount != null && amount < filters.minAmount) return false
  if (filters.maxAmount != null && amount > filters.maxAmount) return false
  if (filters.minOutstanding != null && outstanding < filters.minOutstanding) return false
  if (filters.maxOutstanding != null && outstanding > filters.maxOutstanding) return false
  return true
}

function shouldComputeBalance(filters: PartyLedgerFilters) {
  return filters.mode !== 'both' || Boolean(filters.partyId || filters.partyName)
}

function partyGroupKey(row: Omit<PartyLedgerRow, 'balance'>) {
  const party = row.partyId || normalizePartyName(row.partyName)
  return `${row.mode}:${party}`
}

interface FifoAllocState {
  billOrder: string[]
  billRemaining: Map<string, number>
  creditPool: number
}

function createFifoState(): FifoAllocState {
  return { billOrder: [], billRemaining: new Map(), creditPool: 0 }
}

function applyFifoCredits(state: FifoAllocState) {
  while (state.creditPool > 0.01 && state.billOrder.length > 0) {
    const billId = state.billOrder[0]
    const remaining = state.billRemaining.get(billId) || 0
    const applied = Math.min(state.creditPool, remaining)
    const nextRemaining = round2(remaining - applied)
    state.creditPool = round2(state.creditPool - applied)
    if (nextRemaining <= 0.01) {
      state.billRemaining.delete(billId)
      state.billOrder.shift()
    } else {
      state.billRemaining.set(billId, nextRemaining)
    }
  }
}

function addBillToFifo(state: FifoAllocState, billId: string, amount: number) {
  if (amount <= 0.01) return
  state.billOrder.push(billId)
  state.billRemaining.set(billId, round2(amount))
  applyFifoCredits(state)
}

function addCreditToFifo(state: FifoAllocState, amount: number) {
  if (amount <= 0.01) return
  state.creditPool = round2(state.creditPool + amount)
  applyFifoCredits(state)
}

function partyOutstandingFromFifo(state: FifoAllocState) {
  return round2(state.billOrder.reduce((sum, billId) => sum + (state.billRemaining.get(billId) || 0), 0))
}

function billOutstandingFromFifo(state: FifoAllocState, billId: string) {
  return round2(state.billRemaining.get(billId) || 0)
}

function payStatusFromOutstanding(docAmount: number, outstanding: number) {
  if (outstanding <= 0.01) return 'PAID'
  if (outstanding < docAmount - 0.01) return 'PARTIAL'
  return 'UNPAID'
}

function enrichRowsWithBalanceAndOutstanding(
  rows: Omit<PartyLedgerRow, 'balance'>[],
  filters: PartyLedgerFilters,
): PartyLedgerRow[] {
  const computeBalance = shouldComputeBalance(filters)
  const balanceByGroup = new Map<string, number>()
  const fifoByGroup = new Map<string, FifoAllocState>()

  return rows.map((row) => {
    const groupKey = partyGroupKey(row)
    let balance: number | null = null

    if (computeBalance) {
      const prev = balanceByGroup.get(groupKey) || 0
      const next = row.mode === 'customer'
        ? round2(prev + row.debit - row.credit)
        : round2(prev + row.credit - row.debit)
      balanceByGroup.set(groupKey, next)
      balance = next
    }

    if (!fifoByGroup.has(groupKey)) fifoByGroup.set(groupKey, createFifoState())
    const fifo = fifoByGroup.get(groupKey)!

    const isBillRow = row.id.endsWith(':bill')
    const isPaymentRow = row.id.endsWith(':paid') || row.id.endsWith(':writeoff')

    if (isBillRow) {
      if (row.mode === 'customer') {
        if (row.debit > 0) addBillToFifo(fifo, row.id, row.debit)
        else if (row.credit > 0) addCreditToFifo(fifo, row.credit)
      } else if (row.credit > 0) {
        addBillToFifo(fifo, row.id, row.credit)
      }
    } else if (isPaymentRow) {
      const paymentAmount = row.mode === 'customer' ? row.credit : row.debit
      addCreditToFifo(fifo, paymentAmount)
    }

    let outstanding = row.outstanding
    let payStatus = row.payStatus

    if (isBillRow) {
      outstanding = billOutstandingFromFifo(fifo, row.id)
      payStatus = payStatusFromOutstanding(row.amount, outstanding)
    } else if (isPaymentRow) {
      outstanding = partyOutstandingFromFifo(fifo)
      payStatus = outstanding <= 0.01 ? 'PAID' : 'PARTIAL'
    }

    return { ...row, balance, outstanding, payStatus }
  })
}

function voucherBankCash(v: Voucher, mode: 'customer' | 'vendor') {
  if (mode === 'customer') {
    return round2(
      (v.entries || [])
        .filter((e) => /bank|cash/i.test(e.accountName || '') && (e.debit || 0) > 0)
        .reduce((s, e) => s + (e.debit || 0), 0),
    )
  }
  return round2(
    (v.entries || [])
      .filter((e) => /bank|cash/i.test(e.accountName || '') && (e.credit || 0) > 0)
      .reduce((s, e) => s + (e.credit || 0), 0),
  )
}

function voucherWriteOffAmount(v: Voucher) {
  return round2(
    (v.entries || [])
      .filter((e) => /round\s*off/i.test(e.accountName || ''))
      .reduce((s, e) => s + Math.max(e.debit || 0, e.credit || 0), 0),
  )
}

function parsePayRef(refId: string | null | undefined): string | null {
  const ref = String(refId || '')
  if (!ref.endsWith('_PAY')) return null
  return ref.slice(0, -4) || null
}

export function buildPartyLedger(
  invoices: Invoice[],
  purchases: Purchase[],
  filters: PartyLedgerFilters,
  vouchers?: Voucher[],
  advances: PartyAdvance[] = [],
): PartyLedgerResult {
  const entries: Omit<PartyLedgerRow, 'balance'>[] = []
  const seenDocs = new Set<string>()
  const invoiceById = new Map(invoices.map((i) => [i.id, i]))
  const purchaseById = new Map(purchases.map((p) => [p.id, p]))
  const billsCoveredByVoucher = new Set<string>()

  // ── Bill rows (invoice / purchase) ──────────────────────────────────────
  if (filters.mode === 'customer' || filters.mode === 'both') {
    for (const inv of invoices) {
      if (inv.firm_id !== filters.firmId || !isInvoiceActive(inv)) continue
      if (!isCustomerDebitDoc(inv) && !isCustomerCreditDoc(inv)) continue
      if (!matchesParty(inv.party_id, inv.party_name, filters)) continue

      const amount = round2(inv.grand_total)
      const paid = round2(inv.amt_paid)
      const isCreditNote = isCustomerCreditDoc(inv)
      const docOutstanding = isCreditNote ? round2(-amount) : round2(Math.max(0, amount - Math.min(paid, amount)))
      const filterOutstanding = Math.abs(docOutstanding)
      if (filters.pendingOnly && filterOutstanding <= 0.01) continue
      if (!inAmountRange(amount, filterOutstanding, filters)) continue

      seenDocs.add(`invoice:${inv.id}`)
      const docLabel = customerDocLabel(inv)
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
        outstanding: docOutstanding,
        payStatus: inv.pay_status,
      }

      entries.push({
        ...base,
        id: `${inv.id}:bill`,
        type: docLabel,
        narration: isCreditNote ? `Credit note to ${base.partyName}` : `${docLabel} to ${base.partyName}`,
        debit: isCreditNote ? 0 : amount,
        credit: isCreditNote ? amount : 0,
      })
    }
  }

  if (filters.mode === 'vendor' || filters.mode === 'both') {
    for (const pur of purchases) {
      const billDate = pur.received_date || pur.date
      if (pur.firm_id !== filters.firmId || pur.is_deleted) continue
      if (!matchesParty(pur.supplier_id, pur.supplier_name, filters)) continue

      const amount = round2(pur.grand_total)
      const paid = round2(pur.amt_paid)
      const outstanding = round2(Math.max(0, amount - Math.min(paid, amount)))
      if (filters.pendingOnly && outstanding <= 0.01) continue
      if (!inAmountRange(amount, outstanding, filters)) continue

      seenDocs.add(`purchase:${pur.id}`)
      const base = {
        docId: pur.id,
        docType: 'purchase' as const,
        mode: 'vendor' as const,
        date: billDate,
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
    }
  }

  // ── Payment rows from actual RECEIPT/PAYMENT vouchers (cash + voucher date) ──
  const activeVouchers = (vouchers || []).filter((v) => !v.is_deleted && (v.type === 'RECEIPT' || v.type === 'PAYMENT'))
  for (const v of activeVouchers) {
    const primaryId = parsePayRef(v.ref_id)
    const allocParts = parseAllocTag(v.narration || '')
    const mode: 'customer' | 'vendor' = v.type === 'RECEIPT' ? 'customer' : 'vendor'
    if (filters.mode !== 'both' && filters.mode !== mode) continue

    let partyId: string | null = null
    let partyName = ''
    let refNo = ''
    let docId = primaryId || v.id
    let coveredIds: string[] = []

    if (mode === 'customer') {
      const primary = primaryId ? invoiceById.get(primaryId) : undefined
      const allocInvs = allocParts
        .map((p) => invoiceById.get(p.id))
        .filter((x): x is Invoice => !!x)
      const sample = primary || allocInvs[0]
      if (!sample) continue
      if (sample.firm_id !== filters.firmId || !isInvoiceActive(sample)) continue
      if (!matchesParty(sample.party_id, sample.party_name, filters)) continue
      partyId = sample.party_id
      partyName = sample.party_name || 'Unknown'
      const payDateEarly = (v.date || '').slice(0, 10)
      if (allocParts.length) {
        coveredIds = allocParts.map((p) => p.id)
      } else if (primaryId) {
        coveredIds = [primaryId]
        for (const inv of invoices) {
          if (inv.id === primaryId || !isInvoiceActive(inv) || inv.firm_id !== filters.firmId) continue
          if (!matchesParty(inv.party_id, inv.party_name, {
            firmId: filters.firmId,
            mode: 'customer',
            partyId: sample.party_id || undefined,
            partyName: sample.party_name,
          })) continue
          if ((inv.amt_paid || 0) > 0.01 && String(inv.last_payment_date || '').slice(0, 10) === payDateEarly) {
            coveredIds.push(inv.id)
          }
        }
      }
      const billNos = coveredIds
        .map((id) => invoiceById.get(id)?.bill_no || id.slice(0, 8))
        .join(', ')
      refNo = coveredIds.length > 1 ? `LUMP-${(primaryId || v.id).slice(0, 6)}` : (primary?.bill_no || billNos || v.voucher_no)
      docId = primaryId || sample.id
    } else {
      const primary = primaryId ? purchaseById.get(primaryId) : undefined
      const allocPurs = allocParts
        .map((p) => purchaseById.get(p.id))
        .filter((x): x is Purchase => !!x)
      const sample = primary || allocPurs[0]
      if (!sample || sample.is_deleted) continue
      if (sample.firm_id !== filters.firmId) continue
      if (!matchesParty(sample.supplier_id, sample.supplier_name, filters)) continue
      partyId = sample.supplier_id
      partyName = sample.supplier_name || 'Unknown'
      const payDateEarly = (v.date || '').slice(0, 10)
      if (allocParts.length) {
        coveredIds = allocParts.map((p) => p.id)
      } else if (primaryId) {
        coveredIds = [primaryId]
        for (const pur of purchases) {
          if (pur.id === primaryId || pur.is_deleted || pur.firm_id !== filters.firmId) continue
          if (!matchesParty(pur.supplier_id, pur.supplier_name, {
            firmId: filters.firmId,
            mode: 'vendor',
            partyId: sample.supplier_id || undefined,
            partyName: sample.supplier_name,
          })) continue
          if ((pur.amt_paid || 0) > 0.01 && String(pur.last_payment_date || '').slice(0, 10) === payDateEarly) {
            coveredIds.push(pur.id)
          }
        }
      }
      const billNos = coveredIds
        .map((id) => purchaseById.get(id)?.bill_no || id.slice(0, 8))
        .join(', ')
      refNo = coveredIds.length > 1 ? `LUMP-${(primaryId || v.id).slice(0, 6)}` : (primary?.bill_no || billNos || v.voucher_no)
      docId = primaryId || sample.id
    }

    for (const id of coveredIds) billsCoveredByVoucher.add(`${mode}:${id}`)

    const cash = voucherBankCash(v, mode)
    const writeOff = voucherWriteOffAmount(v)
    const payDate = (v.date || '').slice(0, 10)
    if (cash <= 0.01 && writeOff <= 0.01) continue

    const breakdown = allocParts.length > 1
      ? allocParts
        .map((p) => `${p.billNo} ₹${p.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
        .join(' + ')
      : ''

    if (cash > 0.01) {
      const narration = breakdown
        ? `${mode === 'customer' ? 'Received' : 'Paid'} ₹${cash.toLocaleString('en-IN')} · ${breakdown}`
        : `${mode === 'customer' ? 'Received' : 'Paid'} ₹${cash.toLocaleString('en-IN')}${refNo ? ` against ${refNo}` : ''}`
      entries.push({
        id: `${v.id}:paid`,
        docId,
        docType: mode === 'customer' ? 'invoice' : 'purchase',
        mode,
        date: payDate,
        refNo,
        type: mode === 'customer' ? 'Receipt' : 'Payment',
        partyId,
        partyName,
        narration,
        debit: mode === 'vendor' ? cash : 0,
        credit: mode === 'customer' ? cash : 0,
        amount: cash,
        paid: cash,
        outstanding: 0,
        payStatus: 'PAID',
      })
    }

    if (writeOff > 0.01) {
      entries.push({
        id: `${v.id}:writeoff`,
        docId,
        docType: mode === 'customer' ? 'invoice' : 'purchase',
        mode,
        date: payDate,
        refNo,
        type: 'Write-off',
        partyId,
        partyName,
        narration: `Settlement / write-off ₹${writeOff.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        debit: mode === 'vendor' ? writeOff : 0,
        credit: mode === 'customer' ? writeOff : 0,
        amount: writeOff,
        paid: writeOff,
        outstanding: 0,
        payStatus: 'PAID',
      })
    }
  }

  // ── Fallback: bill amt_paid with no payment voucher (legacy / advance-only) ──
  if (filters.mode === 'customer' || filters.mode === 'both') {
    for (const inv of invoices) {
      if (inv.firm_id !== filters.firmId || !isInvoiceActive(inv) || isCustomerCreditDoc(inv)) continue
      if (!isCustomerDebitDoc(inv)) continue
      if (!matchesParty(inv.party_id, inv.party_name, filters)) continue
      const paid = round2(inv.amt_paid)
      if (paid <= 0.01) continue
      if (billsCoveredByVoucher.has(`customer:${inv.id}`)) continue

      const amount = round2(inv.grand_total)
      const paymentDate = resolvePaymentLedgerDate(inv.id, inv.date, inv.last_payment_date, vouchers)
      const writeOffMatch = (inv.notes || '').match(/\[Write-off:\s*₹?([\d,.]+)/i)
      const writeOff = writeOffMatch ? round2(Number(String(writeOffMatch[1]).replace(/,/g, '')) || 0) : 0
      // Without voucher: show recorded paid (incl. overpayment). Write-off cash = bill − write-off.
      const cash = writeOff > 0.01
        ? round2(Math.max(0, Math.min(paid, amount) - writeOff))
        : paid

      if (cash > 0.01) {
        entries.push({
          id: `${inv.id}:paid`,
          docId: inv.id,
          docType: 'invoice',
          mode: 'customer',
          date: paymentDate,
          refNo: inv.bill_no,
          type: 'Receipt',
          partyId: inv.party_id,
          partyName: inv.party_name || 'Unknown',
          narration: `Received ₹${cash.toLocaleString('en-IN')} against ${inv.bill_no}`,
          debit: 0,
          credit: cash,
          amount: cash,
          paid: cash,
          outstanding: round2(Math.max(0, amount - Math.min(paid, amount))),
          payStatus: inv.pay_status,
        })
      }
      if (writeOff > 0.01) {
        entries.push({
          id: `${inv.id}:writeoff`,
          docId: inv.id,
          docType: 'invoice',
          mode: 'customer',
          date: paymentDate,
          refNo: inv.bill_no,
          type: 'Write-off',
          partyId: inv.party_id,
          partyName: inv.party_name || 'Unknown',
          narration: `Settlement / write-off ₹${writeOff.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          debit: 0,
          credit: writeOff,
          amount: writeOff,
          paid: writeOff,
          outstanding: 0,
          payStatus: 'PAID',
        })
      }
    }
  }

  if (filters.mode === 'vendor' || filters.mode === 'both') {
    for (const pur of purchases) {
      if (pur.firm_id !== filters.firmId || pur.is_deleted) continue
      if (!matchesParty(pur.supplier_id, pur.supplier_name, filters)) continue
      const paid = round2(pur.amt_paid)
      if (paid <= 0.01) continue
      if (billsCoveredByVoucher.has(`vendor:${pur.id}`)) continue

      const amount = round2(pur.grand_total)
      const billDate = pur.received_date || pur.date
      const paymentDate = resolvePaymentLedgerDate(pur.id, billDate, pur.last_payment_date, vouchers)
      const writeOffMatch = (pur.notes || '').match(/\[Write-off:\s*₹?([\d,.]+)/i)
      const writeOff = writeOffMatch ? round2(Number(String(writeOffMatch[1]).replace(/,/g, '')) || 0) : 0
      const cash = writeOff > 0.01
        ? round2(Math.max(0, Math.min(paid, amount) - writeOff))
        : paid
      const refNo = pur.bill_no || pur.id.slice(0, 8)

      if (cash > 0.01) {
        entries.push({
          id: `${pur.id}:paid`,
          docId: pur.id,
          docType: 'purchase',
          mode: 'vendor',
          date: paymentDate,
          refNo,
          type: 'Payment',
          partyId: pur.supplier_id,
          partyName: pur.supplier_name || 'Unknown',
          narration: `Paid ₹${cash.toLocaleString('en-IN')} against ${refNo}`,
          debit: cash,
          credit: 0,
          amount: cash,
          paid: cash,
          outstanding: round2(Math.max(0, amount - Math.min(paid, amount))),
          payStatus: pur.pay_status,
        })
      }
      if (writeOff > 0.01) {
        entries.push({
          id: `${pur.id}:writeoff`,
          docId: pur.id,
          docType: 'purchase',
          mode: 'vendor',
          date: paymentDate,
          refNo,
          type: 'Write-off',
          partyId: pur.supplier_id,
          partyName: pur.supplier_name || 'Unknown',
          narration: `Settlement / write-off ₹${writeOff.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          debit: writeOff,
          credit: 0,
          amount: writeOff,
          paid: writeOff,
          outstanding: 0,
          payStatus: 'PAID',
        })
      }
    }
  }

  for (const adv of advances) {
    if (adv.firm_id !== filters.firmId || adv.is_deleted || adv.status === 'reversed') continue
    const rem = round2(adv.remaining)
    if (rem <= 0.01 && filters.pendingOnly) continue
    const mode = adv.direction === 'in' ? 'customer' as const : 'vendor' as const
    if (filters.mode !== 'both' && filters.mode !== mode) continue
    if (!matchesParty(adv.party_id, adv.party_name, filters)) continue
    if (!inAmountRange(adv.amount, rem, filters)) continue

    seenDocs.add(`advance:${adv.id}`)
    entries.push({
      id: `${adv.id}:adv`,
      docId: adv.id,
      docType: 'advance',
      mode,
      date: adv.date,
      refNo: `ADV-${adv.id.slice(0, 6)}`,
      type: adv.direction === 'in' ? 'Customer Advance' : 'Vendor Advance',
      partyId: adv.party_id,
      partyName: adv.party_name || 'Unknown',
      narration: adv.narration
        ? `Advance open ₹${rem.toLocaleString('en-IN')} — ${adv.narration}`
        : `Advance open ₹${rem.toLocaleString('en-IN')} (of ₹${round2(adv.amount).toLocaleString('en-IN')})`,
      debit: adv.direction === 'out' ? rem : 0,
      credit: adv.direction === 'in' ? rem : 0,
      amount: round2(adv.amount),
      paid: round2(adv.amount - rem),
      outstanding: rem,
      payStatus: adv.status.toUpperCase(),
    })
  }

  const sorted = entries.sort(compareLedgerRows)
  const enriched = enrichRowsWithBalanceAndOutstanding(sorted, filters)
  const rows = enriched.filter((row) => inDateRange(row.date, filters))

  const totals = rows.reduce<PartyLedgerTotals>(
    (acc, row) => {
      acc.debit = round2(acc.debit + row.debit)
      acc.credit = round2(acc.credit + row.credit)
      if (row.balance != null) acc.balance = row.balance
      if (row.mode === 'customer' && row.id.endsWith(':bill') && row.debit > 0) acc.billed = round2(acc.billed + row.debit)
      if (row.mode === 'customer' && row.type.includes('Receipt')) acc.received = round2(acc.received + row.credit)
      if (row.mode === 'customer' && row.type === 'Write-off') acc.received = round2(acc.received + row.credit)
      if (row.mode === 'vendor' && row.type === 'Purchase') acc.payable = round2(acc.payable + row.amount)
      if (row.mode === 'vendor' && (row.type === 'Payment' || row.type === 'Write-off') && row.debit > 0) {
        acc.paid = round2(acc.paid + row.debit)
      }
      acc.rows += 1
      return acc
    },
    {
      debit: 0,
      credit: 0,
      balance: shouldComputeBalance(filters) ? 0 : null,
      billed: 0,
      received: 0,
      payable: 0,
      paid: 0,
      outstanding: 0,
      rows: 0,
      documents: seenDocs.size,
    },
  )

  if (shouldComputeBalance(filters)) {
    const fifoByGroup = new Map<string, FifoAllocState>()
    for (const row of enriched) {
      const groupKey = partyGroupKey(row)
      if (!fifoByGroup.has(groupKey)) fifoByGroup.set(groupKey, createFifoState())
      const fifo = fifoByGroup.get(groupKey)!
      const isBillRow = row.id.endsWith(':bill')
      const isPaymentRow = row.id.endsWith(':paid') || row.id.endsWith(':writeoff')
      if (isBillRow) {
        if (row.mode === 'customer') {
          if (row.debit > 0) addBillToFifo(fifo, row.id, row.debit)
          else if (row.credit > 0) addCreditToFifo(fifo, row.credit)
        } else if (row.credit > 0) {
          addBillToFifo(fifo, row.id, row.credit)
        }
      } else if (isPaymentRow) {
        addCreditToFifo(fifo, row.mode === 'customer' ? row.credit : row.debit)
      }
    }
    totals.outstanding = round2(
      [...fifoByGroup.values()].reduce((sum, state) => sum + partyOutstandingFromFifo(state), 0),
    )
  } else {
    totals.outstanding = round2(enriched.reduce((sum, row) => sum + (row.id.endsWith(':bill') ? row.outstanding : 0), 0))
  }

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
    .filter((inv) => inv.firm_id === firmId && isInvoiceActive(inv))
    .forEach((inv) => addDocOption(inv.party_name, 'customer'))

  purchases
    .filter((pur) => pur.firm_id === firmId && !pur.is_deleted)
    .forEach((pur) => addDocOption(pur.supplier_name, 'vendor'))

  return [...options.values()].sort((a, b) => a.name.localeCompare(b.name))
}
