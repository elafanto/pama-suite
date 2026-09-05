import { db } from '@/data/db'
import { nowISO } from '@/data/util'
import { createRepo } from '@/data/repo'
import { useAccountingStore } from '@/stores/accounting'
import { payStatusFromPaid, payStatusFromPaidPurchase } from '@/services/partyPaymentAllocation'
import type {
  LedgerEntry,
  PartyAdvance,
  PartyAdvanceApplication,
  PartyAdvanceDirection,
  PartyAdvanceMode,
  PartyAdvanceStatus,
} from '@/types/models'

const accountsRepo = createRepo(db.accounts)
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

export function partyAdvanceStatus(amount: number, remaining: number): PartyAdvanceStatus {
  const a = round2(amount)
  const r = round2(remaining)
  if (r <= 0.01) return 'applied'
  if (r + 0.01 < a) return 'partial'
  return 'open'
}

export function openPartyAdvances(
  advances: PartyAdvance[],
  partyId: string | null | undefined,
  partyName: string,
  direction: PartyAdvanceDirection,
): PartyAdvance[] {
  const nameKey = (partyName || '').trim().toLowerCase()
  return advances
    .filter((a) => {
      if (a.is_deleted || a.direction !== direction) return false
      if (a.status === 'reversed' || a.status === 'applied') return false
      if (round2(a.remaining) <= 0.01) return false
      if (partyId && a.party_id) return a.party_id === partyId
      return (a.party_name || '').trim().toLowerCase() === nameKey
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}

export function totalOpenAdvance(
  advances: PartyAdvance[],
  partyId: string | null | undefined,
  partyName: string,
  direction: PartyAdvanceDirection,
): number {
  return round2(openPartyAdvances(advances, partyId, partyName, direction).reduce((s, a) => s + a.remaining, 0))
}

/** FIFO consume open advances up to `amount`. Returns per-advance slices. */
export function allocateAdvanceFifo(
  advances: PartyAdvance[],
  amount: number,
): { advanceId: string; amount: number }[] {
  let remaining = round2(Math.max(0, amount))
  const out: { advanceId: string; amount: number }[] = []
  for (const adv of advances) {
    if (remaining <= 0.01) break
    const take = round2(Math.min(remaining, adv.remaining))
    if (take <= 0.01) continue
    out.push({ advanceId: adv.id, amount: take })
    remaining = round2(remaining - take)
  }
  return out
}

export async function ensureCustomerAdvanceAccount(firmId: string): Promise<string> {
  const id = `${firmId}_2006`
  const existing = await db.accounts.get(id)
  if (existing && !existing.is_deleted) return id
  const now = nowISO()
  if (existing) {
    await accountsRepo.update(id, { is_deleted: false, name: 'Customer Advances', updated_at: now })
    return id
  }
  await accountsRepo.create({
    firm_id: firmId,
    code: '2006',
    name: 'Customer Advances',
    group: 'Current Liabilities',
    normal: 'Cr',
    open_bal_dr: 0,
    open_bal_cr: 0,
    is_system: true,
  } as any)
  return id
}

export async function ensureVendorAdvanceAccount(firmId: string): Promise<string> {
  const id = `${firmId}_1011`
  const existing = await db.accounts.get(id)
  if (existing && !existing.is_deleted) return id
  const now = nowISO()
  if (existing) {
    await accountsRepo.update(id, { is_deleted: false, name: 'Vendor Advances', updated_at: now })
    return id
  }
  await accountsRepo.create({
    firm_id: firmId,
    code: '1011',
    name: 'Vendor Advances',
    group: 'Current Assets',
    normal: 'Dr',
    open_bal_dr: 0,
    open_bal_cr: 0,
    is_system: true,
  } as any)
  return id
}

function payAccount(firmId: string, mode: PartyAdvanceMode): { id: string; name: string } {
  return mode === 'cash'
    ? { id: `${firmId}_1001`, name: 'Cash in Hand' }
    : { id: `${firmId}_1002`, name: 'Bank Account (Primary)' }
}

/** Record cash movement into advance GL. */
export async function postPartyAdvanceVoucher(firmId: string, advance: PartyAdvance): Promise<string> {
  const accounting = useAccountingStore()
  const pay = payAccount(firmId, advance.mode)
  const refId = `${advance.id}_PADV`
  await accounting.reverseLedgerByRef(refId)

  let entries: LedgerEntry[]
  let type: 'RECEIPT' | 'PAYMENT'
  let narration: string

  if (advance.direction === 'in') {
    await ensureCustomerAdvanceAccount(firmId)
    type = 'RECEIPT'
    narration = `Customer advance — ${advance.party_name}${advance.narration ? ` (${advance.narration})` : ''}`
    entries = [
      { accountId: pay.id, accountName: pay.name, debit: advance.amount, credit: 0 },
      { accountId: `${firmId}_2006`, accountName: 'Customer Advances', debit: 0, credit: advance.amount },
    ]
  } else {
    await ensureVendorAdvanceAccount(firmId)
    type = 'PAYMENT'
    narration = `Vendor advance — ${advance.party_name}${advance.narration ? ` (${advance.narration})` : ''}`
    entries = [
      { accountId: `${firmId}_1011`, accountName: 'Vendor Advances', debit: advance.amount, credit: 0 },
      { accountId: pay.id, accountName: pay.name, debit: 0, credit: advance.amount },
    ]
  }

  const v = await accounting.postVoucher(advance.date, type, narration, entries, refId, 'party_advance')
  return v.id
}

export async function reversePartyAdvanceVoucher(advanceId: string) {
  const accounting = useAccountingStore()
  await accounting.reverseLedgerByRef(`${advanceId}_PADV`)
}

/** Apply advance slice to bill: move from advance GL to debtor/creditor. */
export async function postAdvanceApplyVoucher(opts: {
  firmId: string
  advance: PartyAdvance
  applyAmount: number
  billId: string
  billKind: 'invoice' | 'purchase'
  billNo: string
  partyName: string
  date: string
}): Promise<string> {
  const accounting = useAccountingStore()
  const amount = round2(opts.applyAmount)
  if (amount <= 0) return ''
  const refId = `${opts.advance.id}_APP_${opts.billId}`
  await accounting.reverseLedgerByRef(refId)

  let entries: LedgerEntry[]
  if (opts.advance.direction === 'in') {
    await ensureCustomerAdvanceAccount(opts.firmId)
    entries = [
      { accountId: `${opts.firmId}_2006`, accountName: 'Customer Advances', debit: amount, credit: 0 },
      { accountId: `${opts.firmId}_1003`, accountName: 'Sundry Debtors', debit: 0, credit: amount },
    ]
  } else {
    await ensureVendorAdvanceAccount(opts.firmId)
    entries = [
      { accountId: `${opts.firmId}_2001`, accountName: 'Sundry Creditors', debit: amount, credit: 0 },
      { accountId: `${opts.firmId}_1011`, accountName: 'Vendor Advances', debit: 0, credit: amount },
    ]
  }

  const narration = `Advance applied to ${opts.billNo} — ${opts.partyName}`
  const v = await accounting.postVoucher(opts.date, 'JOURNAL', narration, entries, refId, 'party_advance_apply')
  return v.id
}

export function applySlicesToAdvance(
  advance: PartyAdvance,
  slices: { amount: number; bill_id: string; bill_kind: 'invoice' | 'purchase'; bill_no: string; date: string }[],
): PartyAdvance {
  let remaining = round2(advance.remaining)
  const applications = [...(advance.applications || [])]
  for (const s of slices) {
    const amt = round2(s.amount)
    if (amt <= 0.01) continue
    remaining = round2(Math.max(0, remaining - amt))
    applications.push({
      bill_id: s.bill_id,
      bill_kind: s.bill_kind,
      bill_no: s.bill_no,
      amount: amt,
      date: s.date,
    } satisfies PartyAdvanceApplication)
  }
  return {
    ...advance,
    remaining,
    applications,
    status: partyAdvanceStatus(advance.amount, remaining),
  }
}

export { payStatusFromPaid, payStatusFromPaidPurchase, round2 }
