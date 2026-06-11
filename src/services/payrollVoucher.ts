import { db } from '@/data/db'
import { nowISO } from '@/data/util'
import { createRepo } from '@/data/repo'
import { useAccountingStore } from '@/stores/accounting'
import type { LedgerEntry, PayrollPaymentMode, StaffAdvance } from '@/types/models'

const accountsRepo = createRepo(db.accounts)

export async function ensureStaffAdvanceAccount(firmId: string): Promise<string> {
  const id = `${firmId}_1010`
  const existing = await db.accounts.get(id)
  if (existing && !existing.is_deleted) return id

  const now = nowISO()
  if (existing) {
    await accountsRepo.update(id, { is_deleted: false, name: 'Staff Advances', updated_at: now })
    return id
  }

  await accountsRepo.create({
    firm_id: firmId,
    code: '1010',
    name: 'Staff Advances',
    group: 'Current Assets',
    normal: 'Dr',
    open_bal_dr: 0,
    open_bal_cr: 0,
    is_system: true,
  } as any)
  return id
}

function payAccountId(firmId: string, mode: PayrollPaymentMode): { id: string; name: string } {
  return mode === 'cash'
    ? { id: `${firmId}_1001`, name: 'Cash in Hand' }
    : { id: `${firmId}_1002`, name: 'Bank Account (Primary)' }
}

/** Advance given to staff: Dr Staff Advances, Cr Cash/Bank. */
export async function postAdvanceVoucher(
  firmId: string,
  advance: StaffAdvance,
): Promise<string> {
  const accounting = useAccountingStore()
  await ensureStaffAdvanceAccount(firmId)
  const advAcc = `${firmId}_1010`
  const pay = payAccountId(firmId, advance.mode)
  const refId = `${advance.id}_ADV`

  await accounting.reverseLedgerByRef(refId)
  const entries: LedgerEntry[] = [
    { accountId: advAcc, accountName: 'Staff Advances', debit: advance.amount, credit: 0 },
    { accountId: pay.id, accountName: pay.name, debit: 0, credit: advance.amount },
  ]
  const v = await accounting.postVoucher(
    advance.date,
    'PAYMENT',
    `Staff advance — ${advance.staff_name}${advance.narration ? ` (${advance.narration})` : ''}`,
    entries,
    refId,
    'staff_advance',
  )
  return v.id
}

/** Combined monthly salary: Dr 5101, Cr Staff Advances (recovery), Cr Misc, Cr Bank/Cash. */
export async function postSalaryVoucher(
  firmId: string,
  runId: string,
  period: string,
  paymentDate: string,
  paymentMode: PayrollPaymentMode,
  totals: { earned: number; advance: number; other: number; net: number },
): Promise<string> {
  const accounting = useAccountingStore()
  await ensureStaffAdvanceAccount(firmId)
  const salaryAcc = `${firmId}_5101`
  const advAcc = `${firmId}_1010`
  const miscAcc = `${firmId}_5207`
  const pay = payAccountId(firmId, paymentMode)
  const refId = runId

  await accounting.reverseLedgerByRef(refId)

  const entries: LedgerEntry[] = [
    { accountId: salaryAcc, accountName: 'Salary & Wages', debit: totals.earned, credit: 0 },
  ]
  if (totals.advance > 0) {
    entries.push({ accountId: advAcc, accountName: 'Staff Advances', debit: 0, credit: totals.advance })
  }
  if (totals.other > 0) {
    entries.push({ accountId: miscAcc, accountName: 'Miscellaneous Expense', debit: 0, credit: totals.other })
  }
  if (totals.net > 0) {
    entries.push({ accountId: pay.id, accountName: pay.name, debit: 0, credit: totals.net })
  }

  const v = await accounting.postVoucher(
    paymentDate,
    'PAYMENT',
    `Salary ${period} — net ₹${totals.net.toLocaleString('en-IN')}`,
    entries,
    refId,
    'payroll',
  )
  return v.id
}
