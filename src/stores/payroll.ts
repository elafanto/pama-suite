import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db } from '@/data/db'
import { createRepo } from '@/data/repo'
import { useFirmStore } from '@/stores/firm'
import { logActivity } from '@/services/activityLog'
import {
  MAX_STAFF,
  buildPayrollLine,
  currentPeriod,
  deriveWageRates,
  periodLabel,
  sumPayrollLines,
} from '@/services/payrollCalc'
import { postAdvanceVoucher, postSalaryVoucher } from '@/services/payrollVoucher'
import type {
  PayrollLine,
  PayrollPaymentMode,
  PayrollRun,
  Staff,
  StaffAdvance,
} from '@/types/models'

const staffRepo = createRepo<Staff>(db.staff)
const advanceRepo = createRepo<StaffAdvance>(db.staff_advances)
const runRepo = createRepo<PayrollRun>(db.payroll_runs)

export type NewStaff = Omit<Staff, 'id' | 'firm_id' | 'created_at' | 'updated_at' | 'is_deleted' | '_dirty' | 'daily_wage' | 'hourly_wage'>

export const usePayrollStore = defineStore('payroll', () => {
  const staffList = ref<Staff[]>([])
  const advances = ref<StaffAdvance[]>([])
  const runs = ref<PayrollRun[]>([])
  const loaded = ref(false)

  const activeStaff = computed(() => staffList.value.filter((s) => s.is_active))

  async function load() {
    const firm = useFirmStore()
    if (!firm.activeFirmId) return
    staffList.value = (await staffRepo.all(firm.activeFirmId)).sort((a, b) => a.name.localeCompare(b.name))
    advances.value = await advanceRepo.all(firm.activeFirmId)
    runs.value = (await runRepo.all(firm.activeFirmId)).sort((a, b) => b.period.localeCompare(a.period))
    loaded.value = true
  }

  function openAdvancesForStaff(staffId: string) {
    return advances.value.filter((a) => a.staff_id === staffId && !a.applied_period)
  }

  function openAdvanceTotal(staffId: string): number {
    return openAdvancesForStaff(staffId).reduce((s, a) => s + a.amount, 0)
  }

  async function addStaff(data: NewStaff): Promise<Staff | { error: string }> {
    const firm = useFirmStore()
    if (staffList.value.filter((s) => !s.is_deleted).length >= MAX_STAFF) {
      return { error: `Maximum ${MAX_STAFF} staff allowed.` }
    }
    const rates = deriveWageRates(data.monthly_amount)
    const rec = await staffRepo.create({
      ...data,
      firm_id: firm.activeFirmId,
      daily_wage: rates.daily_wage,
      hourly_wage: rates.hourly_wage,
      is_active: data.is_active !== false,
    } as any)
    await logActivity(firm.activeFirmId, 'create', 'staff', rec.id, `Staff ${rec.name} added`)
    await load()
    return rec
  }

  async function updateStaff(id: string, patch: Partial<Staff>) {
    const existing = await staffRepo.get(id)
    if (!existing) return
    const monthly = patch.monthly_amount ?? existing.monthly_amount
    const rates = deriveWageRates(monthly)
    await staffRepo.update(id, {
      ...patch,
      daily_wage: rates.daily_wage,
      hourly_wage: rates.hourly_wage,
    })
    await load()
  }

  async function removeStaff(id: string) {
    const existing = await staffRepo.get(id)
    await staffRepo.remove(id)
    if (existing) {
      await logActivity(existing.firm_id, 'delete', 'staff', id, `Staff ${existing.name} removed`)
    }
    await load()
  }

  async function recordAdvance(data: {
    staff_id: string
    date: string
    amount: number
    mode: PayrollPaymentMode
    narration: string
    postVoucher: boolean
  }): Promise<StaffAdvance | { error: string }> {
    const firm = useFirmStore()
    const staff = staffList.value.find((s) => s.id === data.staff_id)
    if (!staff) return { error: 'Staff not found' }
    const amount = Math.max(0, Number(data.amount) || 0)
    if (amount <= 0) return { error: 'Amount required' }

    const rec = await advanceRepo.create({
      firm_id: firm.activeFirmId,
      staff_id: staff.id,
      staff_name: staff.name,
      date: data.date,
      amount,
      mode: data.mode,
      narration: data.narration || '',
    } as any)

    if (data.postVoucher) {
      const voucherId = await postAdvanceVoucher(firm.activeFirmId, rec)
      await advanceRepo.update(rec.id, { voucher_id: voucherId })
    }

    await logActivity(firm.activeFirmId, 'create', 'staff_advance', rec.id, `Advance ₹${amount} — ${staff.name}`)
    await load()
    return (await advanceRepo.get(rec.id))!
  }

  async function getRunForPeriod(period: string): Promise<PayrollRun | undefined> {
    return runs.value.find((r) => r.period === period && !r.is_deleted)
  }

  async function ensureRun(period: string): Promise<PayrollRun> {
    const firm = useFirmStore()
    const existing = await db.payroll_runs
      .where('[firm_id+period]')
      .equals([firm.activeFirmId, period])
      .filter((r) => !r.is_deleted)
      .first()
    if (existing) return existing

    const [y, m] = period.split('-').map(Number)
    const lines: PayrollLine[] = activeStaff.value.map((s) =>
      buildPayrollLine(s, {}, y, m, 0, openAdvanceTotal(s.id), 0),
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

  async function updateRunLine(
    period: string,
    staffId: string,
    patch: Partial<Pick<PayrollLine, 'attendance' | 'ot_hours' | 'other_deduction'>>,
  ) {
    const run = await ensureRun(period)
    if (run.status === 'paid') return { error: 'Month already paid' }

    const staff = activeStaff.value.find((s) => s.id === staffId)
    if (!staff) return { error: 'Staff not found' }

    const lines = run.lines.map((line) => {
      if (line.staff_id !== staffId) return line
      const attendance = patch.attendance ?? line.attendance
      const ot = patch.ot_hours ?? line.ot_hours
      const other = patch.other_deduction ?? line.other_deduction
      return buildPayrollLine(staff, attendance, run.year, run.month, ot, openAdvanceTotal(staffId), other)
    })

    const totals = sumPayrollLines(lines)
    await runRepo.update(run.id, {
      lines,
      ...totals,
      total_earned: totals.total_earned,
      total_advance: totals.total_advance,
      total_other: totals.total_other,
      total_net: totals.total_net,
      status: 'draft',
    })
    await load()
    return { ok: true }
  }

  async function recalculateRun(period: string) {
    const run = await ensureRun(period)
    if (run.status === 'paid') return { error: 'Month already paid' }

    const lines = activeStaff.value.map((s) => {
      const existing = run.lines.find((l) => l.staff_id === s.id)
      return buildPayrollLine(
        s,
        existing?.attendance || {},
        run.year,
        run.month,
        existing?.ot_hours || 0,
        openAdvanceTotal(s.id),
        existing?.other_deduction || 0,
      )
    })
    const totals = sumPayrollLines(lines)
    await runRepo.update(run.id, { lines, ...totals, status: 'finalized' })
    await load()
    return { ok: true }
  }

  async function payRun(period: string, paymentMode: PayrollPaymentMode, paymentDate: string) {
    const firm = useFirmStore()
    const run = await getRunForPeriod(period)
    if (!run) return { error: 'No payroll run for this month' }
    if (run.status === 'paid') return { error: 'Already paid' }
    if (run.total_net <= 0 && run.total_earned <= 0) return { error: 'Nothing to pay' }

    const voucherId = await postSalaryVoucher(
      firm.activeFirmId,
      run.id,
      period,
      paymentDate,
      paymentMode,
      {
        earned: run.total_earned,
        advance: run.total_advance,
        other: run.total_other,
        net: run.total_net,
      },
    )

    for (const line of run.lines) {
      if (line.advance_deduction <= 0) continue
      const open = openAdvancesForStaff(line.staff_id)
      let remaining = line.advance_deduction
      for (const adv of open) {
        if (remaining <= 0) break
        await advanceRepo.update(adv.id, { applied_period: period })
        remaining -= adv.amount
      }
    }

    await runRepo.update(run.id, {
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
      run.id,
      `Salary paid ${periodLabel(period)} — ₹${run.total_net}`,
    )
    await load()
    return { ok: true, voucherId }
  }

  return {
    staffList,
    activeStaff,
    advances,
    runs,
    loaded,
    load,
    addStaff,
    updateStaff,
    removeStaff,
    recordAdvance,
    openAdvancesForStaff,
    openAdvanceTotal,
    getRunForPeriod,
    ensureRun,
    updateRunLine,
    recalculateRun,
    payRun,
    currentPeriod,
  }
})
