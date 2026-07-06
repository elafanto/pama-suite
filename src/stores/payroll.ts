import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db } from '@/data/db'
import { createRepo } from '@/data/repo'
import { useFirmStore } from '@/stores/firm'
import { logActivity } from '@/services/activityLog'
import {
  MAX_STAFF,
  advancePayrollPeriod,
  advanceTotalForPeriod,
  advancesForStaffInPeriod,
  buildPayrollLine,
  currentPeriod,
  dayFromPreset,
  deriveLinePayStatus,
  deriveWageRates,
  filterStaffForPeriod,
  lineBalanceDue,
  normalizeDayHours,
  normalizePayrollLine,
  periodLabel,
  sumLinePayments,
  sumPayrollLines,
} from '@/services/payrollCalc'
import { postAdvanceVoucher, postSalaryVoucher } from '@/services/payrollVoucher'
import { dedupeAllPayrollRuns, pickBestPayrollRun } from '@/services/payrollRuns'
import { syncPayrollToCloudIfReady } from '@/services/sync'
import type {
  DayAttendance,
  PayrollLine,
  PayrollPaymentMode,
  PayrollRun,
  PayrollRunStatus,
  Staff,
  StaffAdvance,
} from '@/types/models'

function normalizeRunLines(run: PayrollRun): PayrollLine[] {
  return run.lines.map((line) => normalizePayrollLine(line, run.status))
}

function deriveRunStatus(lines: PayrollLine[]): PayrollRunStatus {
  if (!lines.length) return 'draft'
  if (lines.every((l) => l.pay_status === 'paid')) return 'paid'
  if (lines.some((l) => l.pay_status === 'partial' || l.pay_status === 'paid')) return 'partial'
  return 'draft'
}

function preserveLinePayFields(line: PayrollLine) {
  return {
    payments: line.payments ?? [],
    paid_amount: line.paid_amount ?? 0,
    pay_status: line.pay_status,
    payment_date: line.payment_date,
    payment_mode: line.payment_mode,
  }
}

const staffRepo = createRepo<Staff>(db.staff)
const advanceRepo = createRepo<StaffAdvance>(db.staff_advances)
const runRepo = createRepo<PayrollRun>(db.payroll_runs)

export type NewStaff = Omit<Staff, 'id' | 'firm_id' | 'created_at' | 'updated_at' | 'is_deleted' | '_dirty' | 'daily_wage' | 'hourly_wage'>

export const usePayrollStore = defineStore('payroll', () => {
  const staffList = ref<Staff[]>([])
  const advances = ref<StaffAdvance[]>([])
  const runs = ref<PayrollRun[]>([])
  const loaded = ref(false)

  const activeStaff = computed(() =>
    staffList.value.filter((s) => s.is_active && !s.leaving_date),
  )

  function staffForPeriod(period: string): Staff[] {
    return filterStaffForPeriod(staffList.value, period)
  }

  async function load() {
    const firm = useFirmStore()
    if (!firm.activeFirmId) return
    await dedupeAllPayrollRuns(firm.activeFirmId)
    staffList.value = (await staffRepo.all(firm.activeFirmId)).sort((a, b) => a.name.localeCompare(b.name))
    advances.value = await advanceRepo.all(firm.activeFirmId)
    runs.value = (await runRepo.all(firm.activeFirmId))
      .map((run) => {
        const lines = normalizeRunLines(run)
        return { ...run, lines, status: deriveRunStatus(lines) }
      })
      .sort((a, b) => b.period.localeCompare(a.period))
    loaded.value = true
  }

  function advancesForPeriod(staffId: string, period: string) {
    return advancesForStaffInPeriod(advances.value, staffId, period)
  }

  function periodAdvanceTotal(staffId: string, period: string): number {
    return advanceTotalForPeriod(advances.value, staffId, period)
  }

  function openAdvancesForStaff(staffId: string) {
    return advances.value.filter((a) => a.staff_id === staffId && !a.applied_period)
  }

  function openAdvanceTotal(staffId: string): number {
    return openAdvancesForStaff(staffId).reduce((s, a) => s + a.amount, 0)
  }

  async function persistRunLines(run: PayrollRun, lines: PayrollLine[], status?: PayrollRunStatus) {
    const normalized = lines.map((line) => normalizePayrollLine(line))
    const totals = sumPayrollLines(normalized)
    await runRepo.update(run.id, {
      lines: normalized,
      ...totals,
      total_earned: totals.total_earned,
      total_advance: totals.total_advance,
      total_other: totals.total_other,
      total_net: totals.total_net,
      status: status ?? deriveRunStatus(normalized),
    })
    await load()
  }

  async function addStaff(data: NewStaff): Promise<Staff | { error: string }> {
    const firm = useFirmStore()
    if (staffList.value.filter((s) => !s.is_deleted).length >= MAX_STAFF) {
      return { error: `Maximum ${MAX_STAFF} staff allowed.` }
    }
    const rates = deriveWageRates(data.monthly_amount)
    const leaving_date = (data.leaving_date || '').trim()
    const rec = await staffRepo.create({
      ...data,
      firm_id: firm.activeFirmId,
      daily_wage: rates.daily_wage,
      hourly_wage: rates.hourly_wage,
      leaving_date,
      is_active: leaving_date ? false : data.is_active !== false,
    } as any)
    await logActivity(firm.activeFirmId, 'create', 'staff', rec.id, `Staff ${rec.name} added`)
    await load()
    void syncPayrollToCloudIfReady()
    return rec
  }

  async function updateStaff(id: string, patch: Partial<Staff>) {
    const existing = await staffRepo.get(id)
    if (!existing) return
    const monthly = patch.monthly_amount ?? existing.monthly_amount
    const rates = deriveWageRates(monthly)
    const leaving_date =
      patch.leaving_date !== undefined ? (patch.leaving_date || '').trim() : (existing.leaving_date || '')
    const is_active = leaving_date
      ? false
      : patch.is_active !== undefined
        ? patch.is_active
        : existing.is_active
    await staffRepo.update(id, {
      ...patch,
      leaving_date,
      is_active,
      daily_wage: rates.daily_wage,
      hourly_wage: rates.hourly_wage,
    })
    await load()
    void syncPayrollToCloudIfReady()
  }

  async function removeStaff(id: string) {
    const existing = await staffRepo.get(id)
    await staffRepo.remove(id)
    if (existing) {
      await logActivity(existing.firm_id, 'delete', 'staff', id, `Staff ${existing.name} removed`)
    }
    await load()
    void syncPayrollToCloudIfReady()
  }

  async function recordAdvance(data: {
    staff_id: string
    date: string
    amount: number
    mode: PayrollPaymentMode
    narration: string
    postVoucher: boolean
    payroll_period?: string
  }): Promise<StaffAdvance | { error: string }> {
    const firm = useFirmStore()
    const staff = staffList.value.find((s) => s.id === data.staff_id)
    if (!staff) return { error: 'Staff not found' }
    const amount = Math.max(0, Number(data.amount) || 0)
    if (amount <= 0) return { error: 'Amount required' }
    const payroll_period = (data.payroll_period || advancePayrollPeriod({ date: data.date })).slice(0, 7)

    const rec = await advanceRepo.create({
      firm_id: firm.activeFirmId,
      staff_id: staff.id,
      staff_name: staff.name,
      date: data.date,
      amount,
      mode: data.mode,
      narration: data.narration || '',
      payroll_period,
    } as any)

    if (data.postVoucher) {
      const voucherId = await postAdvanceVoucher(firm.activeFirmId, rec)
      await advanceRepo.update(rec.id, { voucher_id: voucherId })
    }

    await logActivity(firm.activeFirmId, 'create', 'staff_advance', rec.id, `Advance ₹${amount} — ${staff.name}`)
    await load()
    void syncPayrollToCloudIfReady()
    return (await advanceRepo.get(rec.id))!
  }

  async function updateAdvance(
    id: string,
    patch: Partial<Pick<StaffAdvance, 'date' | 'amount' | 'mode' | 'narration' | 'payroll_period'>>,
    postVoucher = false,
  ): Promise<{ ok: true } | { error: string }> {
    const firm = useFirmStore()
    const existing = await advanceRepo.get(id)
    if (!existing) return { error: 'Advance not found' }
    if (existing.applied_period) return { error: 'Adjusted advance edit nahi ho sakta' }

    const amount = patch.amount !== undefined ? Math.max(0, Number(patch.amount) || 0) : existing.amount
    if (amount <= 0) return { error: 'Amount required' }
    const date = patch.date ?? existing.date
    const payroll_period = (patch.payroll_period
      || advancePayrollPeriod({ date, payroll_period: patch.payroll_period ?? existing.payroll_period })).slice(0, 7)

    const updated = await advanceRepo.update(id, { ...patch, amount, date, payroll_period })
    if (postVoucher && updated) {
      const voucherId = await postAdvanceVoucher(firm.activeFirmId, updated)
      await advanceRepo.update(id, { voucher_id: voucherId })
    }

    await logActivity(firm.activeFirmId, 'update', 'staff_advance', id, `Advance updated — ${existing.staff_name}`)
    await load()
    void syncPayrollToCloudIfReady()
    return { ok: true }
  }

  async function removeAdvance(id: string): Promise<{ ok: true } | { error: string }> {
    const firm = useFirmStore()
    const existing = await advanceRepo.get(id)
    if (!existing) return { error: 'Advance not found' }
    if (existing.applied_period) return { error: 'Adjusted advance delete nahi ho sakta' }

    await advanceRepo.remove(id)
    await logActivity(firm.activeFirmId, 'delete', 'staff_advance', id, `Advance removed — ${existing.staff_name}`)
    await load()
    void syncPayrollToCloudIfReady()
    return { ok: true }
  }

  async function getRunForPeriod(period: string): Promise<PayrollRun | undefined> {
    const firm = useFirmStore()
    const matches = await db.payroll_runs
      .where('[firm_id+period]')
      .equals([firm.activeFirmId, period])
      .filter((r) => !r.is_deleted)
      .toArray()
    if (!matches.length) return undefined
    const run = pickBestPayrollRun(matches)
    const lines = normalizeRunLines(run)
    return { ...run, lines, status: deriveRunStatus(lines) }
  }

  async function syncRunStaff(run: PayrollRun): Promise<PayrollRun> {
    if (run.status === 'paid') return run
    const eligible = staffForPeriod(run.period)
    const eligibleIds = new Set(eligible.map((s) => s.id))
    const kept = run.lines.filter((l) => eligibleIds.has(l.staff_id))
    const missing = eligible.filter((s) => !kept.some((l) => l.staff_id === s.id))
    if (kept.length === run.lines.length && missing.length === 0) return run

    const lines: PayrollLine[] = [
      ...kept.map((line) => {
        const staff = eligible.find((s) => s.id === line.staff_id)!
        return buildPayrollLine(
          staff,
          normalizeDayHours(line),
          line.attendance,
          run.year,
          run.month,
          periodAdvanceTotal(line.staff_id, run.period),
          line.other_deduction,
          preserveLinePayFields(line),
        )
      }),
      ...missing.map((s) =>
        buildPayrollLine(s, {}, undefined, run.year, run.month, periodAdvanceTotal(s.id, run.period), 0),
      ),
    ]
    await persistRunLines(run, lines)
    return (await getRunForPeriod(run.period)) || run
  }

  async function ensureRun(period: string): Promise<PayrollRun> {
    const firm = useFirmStore()
    await dedupeAllPayrollRuns(firm.activeFirmId)
    const matches = await db.payroll_runs
      .where('[firm_id+period]')
      .equals([firm.activeFirmId, period])
      .filter((r) => !r.is_deleted)
      .toArray()
    const existing = matches.length ? pickBestPayrollRun(matches) : undefined
    if (existing) return syncRunStaff({ ...existing, lines: normalizeRunLines(existing) })

    const [y, m] = period.split('-').map(Number)
    const lines: PayrollLine[] = staffForPeriod(period).map((s) =>
      buildPayrollLine(s, {}, undefined, y, m, periodAdvanceTotal(s.id, period), 0),
    )
    const totals = sumPayrollLines(lines)
    const rec = await runRepo.create({
      firm_id: firm.activeFirmId,
      period,
      year: y,
      month: m,
      lines,
      ...totals,
      total_earned: totals.total_earned,
      total_advance: totals.total_advance,
      total_other: totals.total_other,
      total_net: totals.total_net,
      status: 'draft',
      payment_mode: 'transfer',
      payment_date: new Date(y, m, 0).toISOString().slice(0, 10),
    } as any)
    await load()
    return rec
  }

  async function bulkMarkDays(
    period: string,
    days: string[],
    preset: 'full' | 'holiday' | 'sunday',
  ) {
    const run = await ensureRun(period)
    if (run.status === 'paid') return { error: 'Month already paid' }
    if (!days.length) return { error: 'Select at least one day' }

    const stamp = dayFromPreset(preset)
    const eligible = staffForPeriod(period)
    const staffById = new Map(eligible.map((s) => [s.id, s]))

    const lines = run.lines
      .filter((line) => staffById.has(line.staff_id))
      .map((line) => {
        const staff = staffById.get(line.staff_id)!
        const day_hours = { ...normalizeDayHours(line) }
        for (const d of days) day_hours[d] = { ...stamp }
        return buildPayrollLine(
          staff,
          day_hours,
          line.attendance,
          run.year,
          run.month,
          periodAdvanceTotal(line.staff_id, period),
          line.other_deduction,
          preserveLinePayFields(line),
        )
      })

    for (const staff of eligible) {
      if (lines.some((l) => l.staff_id === staff.id)) continue
      const day_hours: Record<string, DayAttendance> = {}
      for (const d of days) day_hours[d] = { ...stamp }
      lines.push(
        buildPayrollLine(staff, day_hours, undefined, run.year, run.month, periodAdvanceTotal(staff.id, period), 0),
      )
    }

    await persistRunLines(run, lines)
    void syncPayrollToCloudIfReady()
    return { ok: true }
  }

  async function updateRunLine(
    period: string,
    staffId: string,
    patch: Partial<Pick<PayrollLine, 'day_hours' | 'other_deduction'>>,
  ) {
    const run = await ensureRun(period)
    if (run.status === 'paid') return { error: 'Month already paid' }

    const eligible = staffForPeriod(period)
    const staff = eligible.find((s) => s.id === staffId)
    if (!staff) return { error: 'Staff not found or already left' }
    const eligibleIds = new Set(eligible.map((s) => s.id))

    const lines = run.lines
      .filter((line) => eligibleIds.has(line.staff_id))
      .map((line) => {
        if (line.staff_id !== staffId) return line
        if (line.pay_status === 'paid') return line
        const day_hours = patch.day_hours ?? normalizeDayHours(line)
        const other = patch.other_deduction ?? line.other_deduction
        return buildPayrollLine(
          staff,
          day_hours,
          line.attendance,
          run.year,
          run.month,
          periodAdvanceTotal(staffId, period),
          other,
          preserveLinePayFields(line),
        )
      })

    await persistRunLines(run, lines)
    void syncPayrollToCloudIfReady()
    return { ok: true }
  }

  async function recalculateRun(period: string) {
    const run = await ensureRun(period)
    if (run.status === 'paid') return { error: 'Month already paid' }

    const lines = staffForPeriod(period).map((s) => {
      const existing = run.lines.find((l) => l.staff_id === s.id)
      if (existing?.pay_status === 'paid') return existing
      return buildPayrollLine(
        s,
        existing ? normalizeDayHours(existing) : {},
        existing?.attendance,
        run.year,
        run.month,
        periodAdvanceTotal(s.id, period),
        existing?.other_deduction || 0,
        existing ? preserveLinePayFields(existing) : undefined,
      )
    })
    await persistRunLines(run, lines, 'finalized')
    void syncPayrollToCloudIfReady()
    return { ok: true }
  }

  async function markPeriodAdvancesApplied(staffId: string, period: string, amount: number) {
    const open = advancesForPeriod(staffId, period)
    let remaining = amount
    for (const adv of open) {
      if (remaining <= 0) break
      await advanceRepo.update(adv.id, { applied_period: period })
      remaining -= adv.amount
    }
  }

  async function payStaffLine(
    period: string,
    staffId: string,
    amount: number,
    paymentMode: PayrollPaymentMode,
    paymentDate: string,
  ) {
    const firm = useFirmStore()
    const run = await ensureRun(period)
    const line = run.lines.find((l) => l.staff_id === staffId)
    if (!line) return { error: 'Staff line not found' }
    if (line.pay_status === 'paid') return { error: 'Already fully paid' }

    const balance = lineBalanceDue(line)
    const payAmt = Math.min(Math.max(0, Number(amount) || 0), balance)
    if (payAmt <= 0) return { error: 'Enter payment amount' }

    const payments = [...(line.payments || []), { date: paymentDate, amount: payAmt, mode: paymentMode }]
    const paid_amount = sumLinePayments({ payments, paid_amount: 0 })
    const pay_status = deriveLinePayStatus({ ...line, payments, paid_amount })

    const lines = run.lines.map((l) => {
      if (l.staff_id !== staffId) return l
      return normalizePayrollLine({
        ...l,
        payments,
        paid_amount,
        pay_status,
        payment_date: paymentDate,
        payment_mode: paymentMode,
      })
    })

    if (pay_status === 'paid' && line.advance_deduction > 0) {
      await markPeriodAdvancesApplied(staffId, period, line.advance_deduction)
    }

    await persistRunLines(run, lines)

    await logActivity(
      firm.activeFirmId,
      'payroll',
      'payroll_run',
      run.id,
      `${line.staff_name} paid ₹${payAmt} — ${periodLabel(period)}`,
    )
    void syncPayrollToCloudIfReady()
    return { ok: true, paid: payAmt, balance: Math.max(0, line.net_pay - paid_amount) }
  }

  async function payRun(period: string, paymentMode: PayrollPaymentMode, paymentDate: string) {
    const firm = useFirmStore()
    const run = await getRunForPeriod(period)
    if (!run) return { error: 'No payroll run for this month' }
    if (run.status === 'paid') return { error: 'Already paid' }
    if (run.total_net <= 0 && run.total_earned <= 0) return { error: 'Nothing to pay' }

    for (const line of run.lines) {
      const balance = lineBalanceDue(line)
      if (balance <= 0) continue
      const res = await payStaffLine(period, line.staff_id, balance, paymentMode, paymentDate)
      if ('error' in res) return res
    }

    const fresh = await getRunForPeriod(period)
    if (!fresh) return { error: 'Run missing after pay' }

    const voucherId = await postSalaryVoucher(
      firm.activeFirmId,
      fresh.id,
      period,
      paymentDate,
      paymentMode,
      {
        earned: fresh.total_earned,
        advance: fresh.total_advance,
        other: fresh.total_other,
        net: fresh.total_net,
      },
    )

    await runRepo.update(fresh.id, {
      status: 'paid',
      payment_mode: paymentMode,
      payment_date: paymentDate,
      voucher_id: voucherId,
      paid_at: new Date().toISOString(),
    })

    await logActivity(
      firm.activeFirmId,
      'payroll',
      'payroll_run',
      fresh.id,
      `Salary paid ${periodLabel(period)} — ₹${fresh.total_net}`,
    )
    await load()
    void syncPayrollToCloudIfReady()
    return { ok: true, voucherId }
  }

  return {
    staffList,
    activeStaff,
    staffForPeriod,
    advances,
    runs,
    loaded,
    load,
    addStaff,
    updateStaff,
    removeStaff,
    recordAdvance,
    updateAdvance,
    removeAdvance,
    advancesForPeriod,
    periodAdvanceTotal,
    openAdvancesForStaff,
    openAdvanceTotal,
    getRunForPeriod,
    ensureRun,
    bulkMarkDays,
    updateRunLine,
    recalculateRun,
    payStaffLine,
    payRun,
    currentPeriod,
  }
})
