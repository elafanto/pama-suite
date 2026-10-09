import { describe, expect, it } from 'vitest'
import {
  advanceAdjustedInLabel,
  advanceExceedsEarned,
  advanceOverEarnedAmount,
  advancePayrollPeriod,
  advanceTotalForPeriod,
  advanceTotalInRange,
  advancesForStaffInPeriod,
  advancesInRange,
  allocateEmployeeCode,
  applyDayPresetPreservingHours,
  backfillEmployeeCodes,
  buildAdvanceItemsInRange,
  buildPayrollLine,
  calcEarnedFromHours,
  dayFromPreset,
  dayHasFedHours,
  defaultAdvanceRangeForPeriod,
  deriveWageRates,
  deriveLinePayStatus,
  formatEmployeeCode,
  formatPayrollMoney,
  hasCompleteWorkingDuty,
  isStaffInPeriod,
  lineBalanceDue,
  lineHasRecordedPayment,
  periodLastDate,
  sortAdvanceItems,
  staffSalaryForPeriod,
  staffWithSalaryForPeriod,
  summarizeDayHours,
  isStaffEmployedOnDay,
  unpaidDaysOutsideEmployment,
} from '@/services/payrollCalc'
import { buildStaffLedger } from '@/services/staffLedger'
import type { DayAttendance, Staff, StaffAdvance } from '@/types/models'

function hoursForDays(
  presentDays: number,
  absentDays = 0,
  halfUnpaidDays = 0,
  leaveDays = 0,
): Record<string, DayAttendance> {
  const out: Record<string, DayAttendance> = {}
  let d = 1
  for (let i = 0; i < presentDays; i++, d++) {
    out[String(d).padStart(2, '0')] = dayFromPreset('full')
  }
  for (let i = 0; i < absentDays; i++, d++) {
    out[String(d).padStart(2, '0')] = dayFromPreset('absent')
  }
  for (let i = 0; i < halfUnpaidDays; i++, d++) {
    out[String(d).padStart(2, '0')] = dayFromPreset('half')
  }
  for (let i = 0; i < leaveDays; i++, d++) {
    out[String(d).padStart(2, '0')] = dayFromPreset('leave')
  }
  return out
}

describe('deriveWageRates — calendar days', () => {
  it('divides monthly by calendar days and 8 with ceil to rupee', () => {
    expect(deriveWageRates(30000, 30)).toEqual({ daily_wage: 1000, hourly_wage: 125 })
    expect(deriveWageRates(31000, 31)).toEqual({ daily_wage: 1000, hourly_wage: 125 })
    expect(deriveWageRates(26000, 31)).toEqual({ daily_wage: 839, hourly_wage: 105 })
  })
})

describe('employee_code from joining date', () => {
  it('formats EMP-YYYYMMDD-NN', () => {
    expect(formatEmployeeCode('2026-09-15', 1)).toBe('EMP-20260915-01')
    expect(formatEmployeeCode('2026-09-15', 12)).toBe('EMP-20260915-12')
  })

  it('allocates next sequence for same joining date', () => {
    const existing = [{ employee_code: 'EMP-20260915-01' }]
    expect(allocateEmployeeCode(existing, '2026-09-15')).toBe('EMP-20260915-02')
    expect(allocateEmployeeCode([], '2026-10-01')).toBe('EMP-20261001-01')
  })

  it('backfills missing codes stably by joining date', () => {
    const staff = [
      { id: 'b', name: 'B', joining_date: '2026-09-10', employee_code: undefined as string | undefined },
      { id: 'a', name: 'A', joining_date: '2026-09-01', employee_code: undefined as string | undefined },
      { id: 'c', name: 'C', joining_date: '2026-09-01', employee_code: undefined as string | undefined },
    ]
    const filled = backfillEmployeeCodes(staff)
    expect(filled.find((s) => s.id === 'a')?.employee_code).toBe('EMP-20260901-01')
    expect(filled.find((s) => s.id === 'c')?.employee_code).toBe('EMP-20260901-02')
    expect(filled.find((s) => s.id === 'b')?.employee_code).toBe('EMP-20260910-01')
  })
})

describe('staffSalaryForPeriod', () => {
  const staff: Pick<Staff, 'monthly_amount' | 'salary_history'> = {
    monthly_amount: 30000,
    salary_history: [
      { effective_period: '2026-01', monthly_amount: 25000 },
      { effective_period: '2026-04', monthly_amount: 28000 },
      { effective_period: '2026-07', monthly_amount: 30000 },
    ],
  }

  it('uses salary before first revision from fallback / earliest entry', () => {
    expect(staffSalaryForPeriod(staff, '2025-12')).toBe(25000)
    expect(staffSalaryForPeriod(staff, '2026-01')).toBe(25000)
    expect(staffSalaryForPeriod(staff, '2026-03')).toBe(25000)
  })

  it('uses revised salary from effective month onward', () => {
    expect(staffSalaryForPeriod(staff, '2026-04')).toBe(28000)
    expect(staffSalaryForPeriod(staff, '2026-06')).toBe(28000)
    expect(staffSalaryForPeriod(staff, '2026-07')).toBe(30000)
    expect(staffSalaryForPeriod(staff, '2026-12')).toBe(30000)
  })

  it('supports salary decrease', () => {
    const decreased = {
      monthly_amount: 22000,
      salary_history: [
        { effective_period: '2026-01', monthly_amount: 25000 },
        { effective_period: '2026-05', monthly_amount: 22000 },
      ],
    }
    expect(staffSalaryForPeriod(decreased, '2026-04')).toBe(25000)
    expect(staffSalaryForPeriod(decreased, '2026-05')).toBe(22000)
  })

  it('falls back to monthly_amount for legacy staff without history', () => {
    expect(staffSalaryForPeriod({ monthly_amount: 18000 }, '2026-06')).toBe(18000)
  })
})

describe('staffWithSalaryForPeriod', () => {
  it('derives wage rates from period salary and calendar days', () => {
    const staff = {
      id: '1',
      monthly_amount: 30000,
      salary_history: [
        { effective_period: '2026-01', monthly_amount: 31000 },
        { effective_period: '2026-06', monthly_amount: 30000 },
      ],
    } as Staff
    const may = staffWithSalaryForPeriod(staff, '2026-05')
    expect(may.monthly_amount).toBe(31000)
    expect(may.daily_wage).toBe(1000) // 31 days
    const jun = staffWithSalaryForPeriod(staff, '2026-06')
    expect(jun.monthly_amount).toBe(30000)
    expect(jun.daily_wage).toBe(1000) // 30 days
  })
})

describe('calcEarnedFromHours — monthly', () => {
  const monthly = 30000
  const days = 30
  const { hourly_wage } = deriveWageRates(monthly, days)

  it('pays full monthly when no absences or unpaid hours', () => {
    const summary = summarizeDayHours(hoursForDays(26), days)
    expect(calcEarnedFromHours('monthly', monthly, hourly_wage, summary, days)).toBe(30000)
  })

  it('deducts only one daily wage per absent day (no double cut)', () => {
    const summary = summarizeDayHours(hoursForDays(25, 1), days)
    expect(summary.days_absent).toBe(1)
    expect(summary.total_off_unpaid_hours).toBe(8)
    expect(calcEarnedFromHours('monthly', monthly, hourly_wage, summary, days)).toBe(29000)
  })

  it('deducts partial unpaid off-duty hours at hourly rate', () => {
    const summary = summarizeDayHours(hoursForDays(25, 0, 1), days)
    expect(summary.total_off_unpaid_hours).toBe(4)
    expect(calcEarnedFromHours('monthly', monthly, hourly_wage, summary, days)).toBe(29500)
  })

  it('does not cut paid leave / holiday', () => {
    const summary = summarizeDayHours(hoursForDays(25, 0, 0, 1), days)
    expect(summary.days_leave).toBe(1)
    expect(summary.total_off_unpaid_hours).toBe(0)
    expect(calcEarnedFromHours('monthly', monthly, hourly_wage, summary, days)).toBe(30000)
  })

  it('adds OT on top of monthly base', () => {
    const dayHours = hoursForDays(26)
    dayHours['01'] = { duty_hours: 8, off_paid: false, ot_hours: 2, kind: 'work' }
    const summary = summarizeDayHours(dayHours, days)
    expect(calcEarnedFromHours('monthly', monthly, hourly_wage, summary, days)).toBe(30250)
  })

  it('handles absent + half unpaid without double-counting absent hours', () => {
    const summary = summarizeDayHours(hoursForDays(24, 1, 1), days)
    expect(calcEarnedFromHours('monthly', monthly, hourly_wage, summary, days)).toBe(28500)
  })
})

describe('calcEarnedFromHours — daily_wage', () => {
  const daily = 1000
  const hourly = 125
  const days = 30

  it('pays only marked paid hours', () => {
    const summary = summarizeDayHours(hoursForDays(20), days)
    expect(calcEarnedFromHours('daily_wage', daily, hourly, summary, days)).toBe(20000)
  })

  it('pays nothing for absent days', () => {
    const summary = summarizeDayHours(hoursForDays(0, 5), days)
    expect(calcEarnedFromHours('daily_wage', daily, hourly, summary, days)).toBe(0)
  })

  it('pays leave days (off paid)', () => {
    const summary = summarizeDayHours(hoursForDays(0, 0, 0, 2), days)
    expect(calcEarnedFromHours('daily_wage', daily, hourly, summary, days)).toBe(2000)
  })

  it('pays Sunday weekly off as full day', () => {
    const dayHours: Record<string, DayAttendance> = {
      '01': dayFromPreset('full'),
      '07': dayFromPreset('sunday'),
    }
    const summary = summarizeDayHours(dayHours, days)
    expect(summary.total_paid_hours).toBe(16)
    expect(calcEarnedFromHours('daily_wage', daily, hourly, summary, days)).toBe(2000)
  })

  it('pays normal daily wage + OT when Sunday has full duty + OT', () => {
    const dayHours = hoursForDays(4)
    dayHours['07'] = { duty_hours: 8, off_paid: false, ot_hours: 2, kind: 'sunday' }
    const summary = summarizeDayHours(dayHours, days)
    // 4×8 present + Sunday 8 daily + 2 OT = 42h × 125
    expect(calcEarnedFromHours('daily_wage', daily, hourly, summary, days)).toBe(5250)
  })

  it('pays full daily + OT even if Sunday duty is partial', () => {
    const dayHours: Record<string, DayAttendance> = {
      '07': { duty_hours: 4, off_paid: false, ot_hours: 2, kind: 'sunday' },
    }
    const summary = summarizeDayHours(dayHours, days)
    // Weekly off work: daily 8h + OT 2h (not only 4+2)
    expect(summary.total_paid_hours).toBe(10)
    expect(calcEarnedFromHours('daily_wage', daily, hourly, summary, days)).toBe(1250)
  })

  it('pays full daily + OT when Sunday has only OT (no duty hours)', () => {
    const dayHours: Record<string, DayAttendance> = {
      '07': { duty_hours: 0, off_paid: true, ot_hours: 3, kind: 'sunday' },
    }
    const summary = summarizeDayHours(dayHours, days)
    expect(summary.total_paid_hours).toBe(11)
    expect(calcEarnedFromHours('daily_wage', daily, hourly, summary, days)).toBe(1375)
  })

  it('pays nothing for blank unmarked days', () => {
    const summary = summarizeDayHours({}, days)
    expect(calcEarnedFromHours('daily_wage', daily, hourly, summary, days)).toBe(0)
  })
})

describe('Sunday weekly off — monthly', () => {
  const monthly = 30000
  const days = 30
  const { hourly_wage } = deriveWageRates(monthly, days)

  it('does not cut monthly salary for Sunday rest days', () => {
    const dayHours: Record<string, DayAttendance> = {}
    for (let d = 1; d <= 30; d++) {
      const key = String(d).padStart(2, '0')
      dayHours[key] = d % 7 === 0 ? dayFromPreset('sunday') : dayFromPreset('full')
    }
    const summary = summarizeDayHours(dayHours, days)
    expect(summary.days_absent).toBe(0)
    expect(summary.total_off_unpaid_hours).toBe(0)
    expect(calcEarnedFromHours('monthly', monthly, hourly_wage, summary, days)).toBe(30000)
  })
})

describe('buildPayrollLine', () => {
  const staff: Staff = {
    id: 's1',
    firm_id: 'f1',
    name: 'Ramesh',
    phone: '',
    designation: 'Operator',
    pay_type: 'monthly',
    monthly_amount: 30000,
    daily_wage: 1000,
    hourly_wage: 125,
    bank: '',
    acno: '',
    ifsc: '',
    acname: '',
    is_active: true,
    created_at: '',
    updated_at: '',
    is_deleted: false,
  }

  it('nets full advance when equal to earned', () => {
    const line = buildPayrollLine(staff, hoursForDays(25, 1), undefined, 2026, 6, 30000, 0)
    expect(line.earned).toBe(29000)
    expect(line.advance_deduction).toBe(30000)
    expect(line.net_pay).toBe(-1000)
    expect(advanceExceedsEarned(line)).toBe(true)
    expect(advanceOverEarnedAmount(line)).toBe(1000)
    expect(formatPayrollMoney(lineBalanceDue(line))).toBe('− ₹1,000')
  })
})

describe('advance date range for salary month', () => {
  const base = {
    firm_id: 'f1',
    staff_id: 's1',
    staff_name: 'R',
    mode: 'cash' as const,
    narration: '',
    created_at: '',
    updated_at: '',
    is_deleted: false,
  }
  const advances: StaffAdvance[] = [
    { ...base, id: 'a0', date: '2026-06-09', amount: 1000 },
    { ...base, id: 'a1', date: '2026-06-10', amount: 2000 },
    { ...base, id: 'a2', date: '2026-07-05', amount: 3000 },
    { ...base, id: 'a3', date: '2026-07-11', amount: 5000 },
    { ...base, id: 'a4', date: '2026-06-20', amount: 1500, applied_period: '2026-05' },
  ]

  const from = '2026-06-10'
  const to = '2026-07-10'
  const month = '2026-06'

  it('defaults range to full salary month', () => {
    expect(defaultAdvanceRangeForPeriod('2026-06')).toEqual({ from: '2026-06-09', to: '2026-07-08' })
    expect(defaultAdvanceRangeForPeriod('2026-12')).toEqual({ from: '2026-12-09', to: '2027-01-08' })
    expect(periodLastDate('2026-06')).toBe('2026-06-30')
  })

  it('includes only unapplied advances in the date range', () => {
    expect(advancesInRange(advances, 's1', month, from, to).map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(advanceTotalInRange(advances, 's1', month, from, to)).toBe(5000)
    expect(buildAdvanceItemsInRange(advances, 's1', month, from, to)).toEqual([
      { advance_id: 'a1', date: '2026-06-10', amount: 2000, narration: '' },
      { advance_id: 'a2', date: '2026-07-05', amount: 3000, narration: '' },
    ])
  })

  it('keeps advances applied to the same salary month on re-calc', () => {
    const adjusted = advances.map((a) => (a.id === 'a1' ? { ...a, applied_period: '2026-06' } : a))
    expect(advancesInRange(adjusted, 's1', month, from, to).map((a) => a.id)).toEqual(['a1', 'a2'])
  })

  it('formats adjusted-in label for display', () => {
    expect(advanceAdjustedInLabel('2026-06')).toBe('Adjusted in salary of June 2026')
  })

  it('sorts advances by date or amount', () => {
    const items = [
      { advance_id: 'a', date: '2026-06-20', amount: 1000, narration: '' },
      { advance_id: 'b', date: '2026-06-05', amount: 3000, narration: '' },
    ]
    expect(sortAdvanceItems(items, 'date').map((i) => i.advance_id)).toEqual(['b', 'a'])
    expect(sortAdvanceItems(items, 'amount').map((i) => i.advance_id)).toEqual(['b', 'a'])
  })
})

describe('advance period — cutoff day 8 → previous month salary', () => {
  const advances: StaffAdvance[] = [
    {
      id: 'a1', firm_id: 'f1', staff_id: 's1', staff_name: 'R', date: '2026-03-10', amount: 5000,
      mode: 'cash', narration: '', created_at: '', updated_at: '', is_deleted: false,
    },
    {
      id: 'a2', firm_id: 'f1', staff_id: 's1', staff_name: 'R', date: '2026-04-05', amount: 3000,
      mode: 'cash', narration: '', created_at: '', updated_at: '', is_deleted: false,
    },
  ]

  it('maps day 1–8 advances to the previous payroll month', () => {
    expect(advancePayrollPeriod({ date: '2026-04-01' })).toBe('2026-03')
    expect(advancePayrollPeriod({ date: '2026-04-08' })).toBe('2026-03')
    expect(advancePayrollPeriod({ date: '2026-04-09' })).toBe('2026-04')
    expect(advancePayrollPeriod({ date: '2026-01-05' })).toBe('2025-12')
  })

  it('only counts advances in the same payroll month (after cutoff mapping)', () => {
    expect(advanceTotalForPeriod(advances, 's1', '2026-03')).toBe(8000)
    expect(advanceTotalForPeriod(advances, 's1', '2026-04')).toBe(0)
    expect(advanceTotalForPeriod(advances, 's1', '2026-05')).toBe(0)
  })

  it('uses payroll_period when set', () => {
    const adv = { ...advances[0], date: '2026-03-28', payroll_period: '2026-04' }
    expect(advancePayrollPeriod(adv)).toBe('2026-04')
    expect(advancesForStaffInPeriod([adv], 's1', '2026-04')).toHaveLength(1)
    expect(advancesForStaffInPeriod([adv], 's1', '2026-03')).toHaveLength(0)
  })
})

describe('staff ledger', () => {
  it('builds running balance for advances and salary', () => {
    const advances: StaffAdvance[] = [{
      id: 'a1', firm_id: 'f1', staff_id: 's1', staff_name: 'R', date: '2026-06-05', amount: 2000,
      mode: 'cash', narration: '', payroll_period: '2026-06', created_at: '', updated_at: '', is_deleted: false,
    }]
    const runs = [{
      id: 'r1', firm_id: 'f1', period: '2026-06', year: 2026, month: 6, status: 'partial' as const,
      lines: [{
        staff_id: 's1', staff_name: 'R', pay_type: 'monthly' as const, monthly_amount: 10000,
        daily_wage: 334, hourly_wage: 42, day_hours: {}, days_present: 26, days_half: 0, days_absent: 0,
        days_leave: 0, total_duty_hours: 208, total_off_unpaid_hours: 0, total_ot_hours: 0, total_paid_hours: 208,
        earned: 10000, advance_deduction: 2000, other_deduction: 0, net_pay: 8000,
        paid_amount: 5000, pay_status: 'partial' as const, payments: [{ date: '2026-06-28', amount: 5000, mode: 'transfer' as const }],
      }],
      total_earned: 10000, total_advance: 2000, total_other: 0, total_net: 8000,
      payment_mode: 'transfer' as const, payment_date: '2026-06-28', created_at: '', updated_at: '', is_deleted: false,
    }]
    const ledger = buildStaffLedger('s1', advances, runs as any)
    expect(ledger.totals.earned).toBe(10000)
    expect(ledger.totals.advancesGiven).toBe(2000)
    expect(ledger.totals.paid).toBe(5000)
    expect(ledger.totals.balanceDue).toBe(3000)
  })
})

describe('isStaffInPeriod — leaving date', () => {
  const base = {
    is_active: true,
    is_deleted: false,
    leaving_date: '2026-06-15',
  }

  it('includes staff in leaving month and earlier months', () => {
    expect(isStaffInPeriod(base, '2026-05')).toBe(true)
    expect(isStaffInPeriod(base, '2026-06')).toBe(true)
  })

  it('hides staff from the month after leaving', () => {
    expect(isStaffInPeriod(base, '2026-07')).toBe(false)
    expect(isStaffInPeriod(base, '2026-08')).toBe(false)
  })

  it('keeps active staff without leaving date', () => {
    expect(isStaffInPeriod({ is_active: true, is_deleted: false }, '2026-07')).toBe(true)
  })

  it('hides inactive staff without leaving date', () => {
    expect(isStaffInPeriod({ is_active: false, is_deleted: false }, '2026-07')).toBe(false)
  })

  it('still includes left staff in leaving month even if inactive', () => {
    expect(
      isStaffInPeriod({ is_active: false, is_deleted: false, leaving_date: '2026-06-20' }, '2026-06'),
    ).toBe(true)
  })
})

describe('joining date — mid-month staff', () => {
  it('hides staff from months before joining', () => {
    const s = { is_active: true, is_deleted: false, joining_date: '2026-07-03' }
    expect(isStaffInPeriod(s, '2026-06')).toBe(false)
    expect(isStaffInPeriod(s, '2026-07')).toBe(true)
  })

  it('blocks attendance before joining day', () => {
    const s = { joining_date: '2026-07-03' }
    expect(isStaffEmployedOnDay(s, 2026, 7, '01')).toBe(false)
    expect(isStaffEmployedOnDay(s, 2026, 7, '02')).toBe(false)
    expect(isStaffEmployedOnDay(s, 2026, 7, '03')).toBe(true)
    expect(isStaffEmployedOnDay(s, 2026, 7, '30')).toBe(true)
  })

  it('counts calendar days before joining for monthly deduction (incl. Sundays)', () => {
    // July 2026: join on 3rd. Days 1–2 unpaid.
    expect(unpaidDaysOutsideEmployment({ joining_date: '2026-07-03' }, 2026, 7)).toBe(2)
  })

  it('deducts pre-join calendar days from monthly earned pay', () => {
    const monthly = 31000
    const { daily_wage, hourly_wage } = deriveWageRates(monthly, 31)
    const staff = {
      id: 's1',
      name: 'New',
      phone: '',
      designation: '',
      pay_type: 'monthly' as const,
      monthly_amount: monthly,
      daily_wage,
      hourly_wage,
      bank: '',
      acno: '',
      ifsc: '',
      acname: '',
      is_active: true,
      joining_date: '2026-07-03',
      firm_id: 'f1',
      created_at: '',
      updated_at: '',
      is_deleted: false,
    }
    const hours = hoursForDays(20)
    const line = buildPayrollLine(staff, hours, undefined, 2026, 7, 0, 0)
    expect(line.earned).toBe(monthly - 2 * daily_wage)
  })
})

describe('deriveLinePayStatus', () => {
  it('keeps zero net without payments as pending (not paid)', () => {
    expect(deriveLinePayStatus({ net_pay: 0, payments: [], paid_amount: 0 })).toBe('pending')
    expect(lineHasRecordedPayment({ pay_status: 'pending', payments: [], paid_amount: 0 })).toBe(false)
  })

  it('marks paid only when recorded payment covers net', () => {
    expect(deriveLinePayStatus({
      net_pay: 8000,
      payments: [{ date: '2026-07-28', amount: 8000, mode: 'transfer' }],
      paid_amount: 8000,
    })).toBe('paid')
    expect(lineHasRecordedPayment({
      pay_status: 'paid',
      payments: [{ date: '2026-07-28', amount: 8000, mode: 'transfer' }],
      paid_amount: 8000,
    })).toBe(true)
  })
})

describe('holiday/sunday preserve fed hours', () => {
  it('keeps duty and OT when applying holiday or sunday preset', () => {
    const existing = { duty_hours: 8, off_paid: false, ot_hours: 2, kind: 'work' as const }
    expect(dayHasFedHours(existing)).toBe(true)
    expect(applyDayPresetPreservingHours(existing, 'holiday')).toEqual({
      duty_hours: 8,
      ot_hours: 2,
      off_paid: false,
      kind: 'holiday',
    })
    expect(applyDayPresetPreservingHours(existing, 'sunday')).toEqual({
      duty_hours: 8,
      ot_hours: 2,
      off_paid: false,
      kind: 'sunday',
    })
  })

  it('keeps OT-only Sunday work when marking sunday rest', () => {
    const existing = { duty_hours: 0, off_paid: false, ot_hours: 3, kind: 'work' as const }
    expect(applyDayPresetPreservingHours(existing, 'sunday')).toEqual({
      duty_hours: 0,
      ot_hours: 3,
      off_paid: true,
      kind: 'sunday',
    })
  })

  it('applies blank rest stamp when day has no fed hours', () => {
    expect(applyDayPresetPreservingHours(undefined, 'holiday')).toEqual(dayFromPreset('holiday'))
    expect(applyDayPresetPreservingHours(dayFromPreset('absent'), 'sunday')).toEqual(dayFromPreset('sunday'))
  })
})

describe('Sunday/holiday pay only when duty complete', () => {
  const year = 2026
  const month = 9 // 30 days; Sundays 6,13,20,27
  const dim = 30

  function fullMonthWithSundays(absentDay?: string): Record<string, DayAttendance> {
    const out: Record<string, DayAttendance> = {}
    for (let d = 1; d <= dim; d++) {
      const key = String(d).padStart(2, '0')
      const sunday = [6, 13, 20, 27].includes(d)
      if (absentDay && key === absentDay) out[key] = dayFromPreset('absent')
      else out[key] = sunday ? dayFromPreset('sunday') : dayFromPreset('full')
    }
    return out
  }

  it('detects complete vs incomplete working duty', () => {
    expect(hasCompleteWorkingDuty(fullMonthWithSundays(), year, month)).toBe(true)
    expect(hasCompleteWorkingDuty(fullMonthWithSundays('10'), year, month)).toBe(false)
    expect(hasCompleteWorkingDuty({}, year, month)).toBe(false)
  })

  it('denies paid Sunday rest when duty incomplete', () => {
    const dayHours: Record<string, DayAttendance> = {
      '01': dayFromPreset('full'),
      '06': dayFromPreset('sunday'),
    }
    const paid = summarizeDayHours(dayHours, dim, { grantPaidOffs: true })
    const unpaid = summarizeDayHours(dayHours, dim, { grantPaidOffs: false })
    expect(paid.total_paid_hours).toBe(16)
    expect(unpaid.total_paid_hours).toBe(8) // only the full working day
  })

  it('still pays Sunday work (duty/OT) even if duty incomplete', () => {
    const dayHours: Record<string, DayAttendance> = {
      '06': { duty_hours: 8, off_paid: false, ot_hours: 2, kind: 'sunday' },
    }
    const summary = summarizeDayHours(dayHours, dim, { grantPaidOffs: false })
    expect(summary.total_paid_hours).toBe(10)
  })

  it('buildPayrollLine grants Sunday rest by default; toggle grant_paid_offs to deny', () => {
    const staff: Staff = {
      id: 's1',
      firm_id: 'f1',
      name: 'Ramesh',
      phone: '',
      designation: 'Operator',
      pay_type: 'daily_wage',
      monthly_amount: 30000,
      daily_wage: 1000,
      hourly_wage: 125,
      bank: '',
      acno: '',
      ifsc: '',
      acname: '',
      is_active: true,
      created_at: '',
      updated_at: '',
      is_deleted: false,
    }
    const complete = buildPayrollLine(staff, fullMonthWithSundays(), undefined, year, month, 0, 0)
    expect(complete.duty_complete).toBe(true)
    expect(complete.grant_paid_offs).toBe(true)
    // 26 work days × 8 + 4 Sundays × 8 = 240 paid hours
    expect(complete.total_paid_hours).toBe(240)

    const withAbsentStillGranted = buildPayrollLine(
      staff,
      fullMonthWithSundays('10'),
      undefined,
      year,
      month,
      0,
      0,
    )
    expect(withAbsentStillGranted.duty_complete).toBe(false)
    expect(withAbsentStillGranted.grant_paid_offs).toBe(true)
    // 25 work × 8 + 4 Sunday rest = 232 (absent day unpaid)
    expect(withAbsentStillGranted.total_paid_hours).toBe(232)

    const denied = buildPayrollLine(
      staff,
      fullMonthWithSundays('10'),
      undefined,
      year,
      month,
      0,
      0,
      { grant_paid_offs: false, payments: [], paid_amount: 0, pay_status: 'pending' },
    )
    expect(denied.grant_paid_offs).toBe(false)
    // 25 work × 8, Sundays denied = 200
    expect(denied.total_paid_hours).toBe(200)
  })
})
