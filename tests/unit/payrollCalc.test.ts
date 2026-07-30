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
  buildAdvanceItemsInRange,
  buildPayrollLine,
  calcEarnedFromHours,
  dayFromPreset,
  defaultAdvanceRangeForPeriod,
  deriveWageRates,
  formatPayrollMoney,
  isStaffInPeriod,
  lineBalanceDue,
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

describe('deriveWageRates', () => {
  it('divides monthly by 26 and 8 with ceil to rupee', () => {
    expect(deriveWageRates(26000)).toEqual({ daily_wage: 1000, hourly_wage: 125 })
    expect(deriveWageRates(25000)).toEqual({ daily_wage: 962, hourly_wage: 121 })
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
  it('derives wage rates from period salary', () => {
    const staff = {
      id: '1',
      monthly_amount: 30000,
      salary_history: [
        { effective_period: '2026-01', monthly_amount: 26000 },
        { effective_period: '2026-06', monthly_amount: 30000 },
      ],
    } as Staff
    const may = staffWithSalaryForPeriod(staff, '2026-05')
    expect(may.monthly_amount).toBe(26000)
    expect(may.daily_wage).toBe(1000)
    const jul = staffWithSalaryForPeriod(staff, '2026-07')
    expect(jul.monthly_amount).toBe(30000)
    expect(jul.daily_wage).toBe(1154)
  })
})

describe('calcEarnedFromHours — monthly', () => {
  const monthly = 26000
  const { hourly_wage } = deriveWageRates(monthly)

  it('pays full monthly when no absences or unpaid hours', () => {
    const summary = summarizeDayHours(hoursForDays(26), 30)
    expect(calcEarnedFromHours('monthly', monthly, hourly_wage, summary)).toBe(26000)
  })

  it('deducts only one daily wage per absent day (no double cut)', () => {
    const summary = summarizeDayHours(hoursForDays(25, 1), 30)
    expect(summary.days_absent).toBe(1)
    expect(summary.total_off_unpaid_hours).toBe(8)
    expect(calcEarnedFromHours('monthly', monthly, hourly_wage, summary)).toBe(25000)
  })

  it('deducts partial unpaid off-duty hours at hourly rate', () => {
    const summary = summarizeDayHours(hoursForDays(25, 0, 1), 30)
    expect(summary.total_off_unpaid_hours).toBe(4)
    expect(calcEarnedFromHours('monthly', monthly, hourly_wage, summary)).toBe(25500)
  })

  it('does not cut paid leave / holiday', () => {
    const summary = summarizeDayHours(hoursForDays(25, 0, 0, 1), 30)
    expect(summary.days_leave).toBe(1)
    expect(summary.total_off_unpaid_hours).toBe(0)
    expect(calcEarnedFromHours('monthly', monthly, hourly_wage, summary)).toBe(26000)
  })

  it('adds OT on top of monthly base', () => {
    const dayHours = hoursForDays(26)
    dayHours['01'] = { duty_hours: 8, off_paid: false, ot_hours: 2, kind: 'work' }
    const summary = summarizeDayHours(dayHours, 30)
    expect(calcEarnedFromHours('monthly', monthly, hourly_wage, summary)).toBe(26250)
  })

  it('handles absent + half unpaid without double-counting absent hours', () => {
    const summary = summarizeDayHours(hoursForDays(24, 1, 1), 30)
    expect(calcEarnedFromHours('monthly', monthly, hourly_wage, summary)).toBe(24500)
  })
})

describe('calcEarnedFromHours — daily_wage', () => {
  const daily = 1000
  const hourly = 125

  it('pays only marked paid hours', () => {
    const summary = summarizeDayHours(hoursForDays(20), 30)
    expect(calcEarnedFromHours('daily_wage', daily, hourly, summary)).toBe(20000)
  })

  it('pays nothing for absent days', () => {
    const summary = summarizeDayHours(hoursForDays(0, 5), 30)
    expect(calcEarnedFromHours('daily_wage', daily, hourly, summary)).toBe(0)
  })

  it('pays leave days (off paid)', () => {
    const summary = summarizeDayHours(hoursForDays(0, 0, 0, 2), 30)
    expect(calcEarnedFromHours('daily_wage', daily, hourly, summary)).toBe(2000)
  })

  it('does not pay Sunday weekly off (already in ÷26)', () => {
    const dayHours: Record<string, DayAttendance> = {}
    for (let d = 1; d <= 30; d++) {
      const key = String(d).padStart(2, '0')
      dayHours[key] = d % 7 === 0 ? dayFromPreset('sunday') : dayFromPreset('full')
    }
    const summary = summarizeDayHours(dayHours, 30)
    expect(calcEarnedFromHours('daily_wage', daily, hourly, summary)).toBeLessThan(30000)
  })

  it('pays duty/OT if someone works on Sunday', () => {
    const dayHours = hoursForDays(4)
    dayHours['07'] = { duty_hours: 8, off_paid: false, ot_hours: 2, kind: 'work' }
    const summary = summarizeDayHours(dayHours, 30)
    expect(calcEarnedFromHours('daily_wage', daily, hourly, summary)).toBe(5250)
  })
})

describe('Sunday weekly off — monthly', () => {
  const monthly = 26000
  const { hourly_wage } = deriveWageRates(monthly)

  it('does not cut monthly salary for Sunday rest days', () => {
    const dayHours: Record<string, DayAttendance> = {}
    for (let d = 1; d <= 30; d++) {
      const key = String(d).padStart(2, '0')
      dayHours[key] = d % 7 === 0 ? dayFromPreset('sunday') : dayFromPreset('full')
    }
    const summary = summarizeDayHours(dayHours, 30)
    expect(summary.days_absent).toBe(0)
    expect(summary.total_off_unpaid_hours).toBe(0)
    expect(calcEarnedFromHours('monthly', monthly, hourly_wage, summary)).toBe(26000)
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
    monthly_amount: 26000,
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
    expect(line.earned).toBe(25000)
    expect(line.advance_deduction).toBe(30000)
    expect(line.net_pay).toBe(-5000)
    expect(advanceExceedsEarned(line)).toBe(true)
    expect(advanceOverEarnedAmount(line)).toBe(5000)
    expect(formatPayrollMoney(lineBalanceDue(line))).toBe('− ₹5,000')
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
    expect(defaultAdvanceRangeForPeriod('2026-06')).toEqual({ from: '2026-06-01', to: '2026-06-30' })
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

describe('advance period — no carry to next month', () => {
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

  it('only counts advances in the same payroll month', () => {
    expect(advanceTotalForPeriod(advances, 's1', '2026-03')).toBe(5000)
    expect(advanceTotalForPeriod(advances, 's1', '2026-04')).toBe(3000)
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
        daily_wage: 385, hourly_wage: 49, day_hours: {}, days_present: 26, days_half: 0, days_absent: 0,
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

  it('counts unpaid weekdays before joining for monthly deduction', () => {
    // July 2026: join on 3rd (Fri). Days 1=Wed, 2=Thu unpaid; no Sunday in 1–2.
    expect(unpaidDaysOutsideEmployment({ joining_date: '2026-07-03' }, 2026, 7)).toBe(2)
  })

  it('deducts pre-join weekdays from monthly earned pay', () => {
    const monthly = 26000
    const { daily_wage, hourly_wage } = deriveWageRates(monthly)
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
    // Mark only from join day onward as present for a few days — pre-join weekdays still cut pay.
    const hours = hoursForDays(20)
    const line = buildPayrollLine(staff, hours, undefined, 2026, 7, 0, 0)
    const fullMonth = calcEarnedFromHours('monthly', monthly, hourly_wage, summarizeDayHours(hoursForDays(26), 31))
    expect(line.earned).toBeLessThan(fullMonth)
    expect(line.earned).toBe(monthly - 2 * daily_wage)
  })
})
