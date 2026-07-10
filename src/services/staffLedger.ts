import {
  advancePayrollPeriod,
  advanceAdjustedInLabel,
  periodLabel,
  sumLinePayments,
} from '@/services/payrollCalc'
import type { PayrollRun, StaffAdvance } from '@/types/models'

export interface StaffLedgerRow {
  id: string
  date: string
  period?: string
  type: 'advance' | 'earning' | 'advance_deduction' | 'other_deduction' | 'salary_payment'
  label: string
  debit: number
  credit: number
  balance: number
}

export interface StaffLedgerTotals {
  advancesGiven: number
  earned: number
  advanceDeducted: number
  otherDeducted: number
  paid: number
  balanceDue: number
  rows: number
}

export interface StaffLedgerResult {
  rows: StaffLedgerRow[]
  totals: StaffLedgerTotals
}

const round0 = (n: number) => Math.round(Number(n) || 0)

export function buildStaffLedger(
  staffId: string,
  advances: StaffAdvance[],
  runs: PayrollRun[],
  options?: { from?: string; to?: string },
): StaffLedgerResult {
  const events: Array<{
    sortKey: string
    date: string
    period?: string
    type: StaffLedgerRow['type']
    label: string
    debit: number
    credit: number
  }> = []

  for (const adv of advances.filter((a) => a.staff_id === staffId && !a.is_deleted)) {
    const period = advancePayrollPeriod(adv)
    if (options?.from && period < options.from) continue
    if (options?.to && period > options.to) continue
    events.push({
      sortKey: `${adv.date}#adv#${adv.id}`,
      date: adv.date,
      period,
      type: 'advance',
      label: `Advance${adv.narration ? ` — ${adv.narration}` : ''}${adv.applied_period ? ` (${advanceAdjustedInLabel(adv.applied_period)})` : ''}`,
      debit: adv.amount,
      credit: 0,
    })
  }

  for (const run of runs.filter((r) => !r.is_deleted)) {
    if (options?.from && run.period < options.from) continue
    if (options?.to && run.period > options.to) continue
    const line = run.lines.find((l) => l.staff_id === staffId)
    if (!line) continue

    const monthLabel = periodLabel(run.period)
    if (line.earned > 0) {
      events.push({
        sortKey: `${run.period}-31#earn#${run.id}`,
        date: `${run.period}-28`,
        period: run.period,
        type: 'earning',
        label: `Salary earned — ${monthLabel}`,
        debit: 0,
        credit: line.earned,
      })
    }
    if (line.other_deduction > 0) {
      events.push({
        sortKey: `${run.period}-31#oth#${run.id}`,
        date: `${run.period}-28`,
        period: run.period,
        type: 'other_deduction',
        label: `Other deduction — ${monthLabel}`,
        debit: line.other_deduction,
        credit: 0,
      })
    }

    const payments = line.payments?.length
      ? line.payments
      : sumLinePayments(line) > 0
        ? [{ date: line.payment_date || `${run.period}-28`, amount: sumLinePayments(line), mode: line.payment_mode || 'transfer' as const }]
        : []

    payments.forEach((p, idx) => {
      events.push({
        sortKey: `${p.date}#pay#${run.id}#${idx}`,
        date: p.date,
        period: run.period,
        type: 'salary_payment',
        label: `Salary paid — ${monthLabel} (${p.mode})`,
        debit: p.amount,
        credit: 0,
      })
    })
  }

  events.sort((a, b) => a.sortKey.localeCompare(b.sortKey))

  let balance = 0
  const rows: StaffLedgerRow[] = events.map((e) => {
    balance += e.credit - e.debit
    return {
      id: e.sortKey,
      date: e.date,
      period: e.period,
      type: e.type,
      label: e.label,
      debit: round0(e.debit),
      credit: round0(e.credit),
      balance: round0(balance),
    }
  })

  const totals = rows.reduce<StaffLedgerTotals>(
    (acc, row) => {
      if (row.type === 'advance') acc.advancesGiven += row.debit
      if (row.type === 'earning') acc.earned += row.credit
      if (row.type === 'other_deduction') acc.otherDeducted += row.debit
      if (row.type === 'salary_payment') acc.paid += row.debit
      acc.rows += 1
      return acc
    },
    {
      advancesGiven: 0,
      earned: 0,
      advanceDeducted: 0,
      otherDeducted: 0,
      paid: 0,
      balanceDue: 0,
      rows: 0,
    },
  )
  totals.balanceDue = round0(totals.earned - totals.advancesGiven - totals.otherDeducted - totals.paid)
  return { rows, totals }
}
