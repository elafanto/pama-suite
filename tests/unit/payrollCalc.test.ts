import { describe, expect, it } from 'vitest'
import {
  advancePayrollPeriod,
  advanceTotalForPeriod,
  advanceTotalForAdjustment,
  advanceTotalForSalaryCycle,
  advancesForStaffInPeriod,
  advancesForAdjustment,
  advancesForSalaryCycle,
  advanceAdjustedInLabel,
  buildAdvanceItemsForAdjustment,
  buildAdvanceItems,
  buildPayrollLine,
  calcEarnedFromHours,
  dayFromPreset,
  defaultSalaryDateForPeriod,
  deriveWageRates,
  isStaffInPeriod,
  lineBalanceDue,
  salaryCycleStartDate,
  summarizeDayHours,
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

describe('calcEarnedFromHours — monthly', () => {
  const monthly = 26000
  const { hourly_wage } = deriveWageRates(monthly)

  it('pays full monthly when no absences or unpaid hours', () => {
    const summary = summarizeDayHours(hoursForDays(26), 30)
    expect(calcEarnedFromHours('monthly', monthly, hourly_wage, summary)).toBe(26000)
  })

  it('deducts only one daily wage per absent day (no double cut)', () => {
    const summary = summarizeDayHours(hoursForDays(25, 1), 30)
    // Bug was: absent day cut daily (1000) AND 8 unpaid hours (1000) = 2000
    expect(summary.days_absent).toBe(1)
    expect(summary.total_off_unpaid_hours).toBe(8)
    expect(calcEarnedFromHours('monthly', monthly, hourly_wage, summary)).toBe(25000)
  })

  it('deducts partial unpaid off-duty hours at hourly rate', () => {
    const summary = summarizeDayHours(hoursForDays(25, 0, 1), 30)
    // half day unpaid: 4 unpaid hours × 125 = 500
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
    expect(calcEarnedFromHours('monthly', monthly, hourly_wage, summary)).toBe(26000 + 2 * 125)
  })

  it('handles absent + half unpaid without double-counting absent hours', () => {
    const summary = summarizeDayHours(hoursForDays(24, 1, 1), 30)
    // absent 1000 + half unpaid 500 = 1500 cut
    expect(calcEarnedFromHours('monthly', monthly, hourly_wage, summary)).toBe(24500)
  })
})

describe('calcEarnedFromHours — daily_wage', () => {
  const monthly = 26000
  const { hourly_wage } = deriveWageRates(monthly)

  it('pays only marked paid hours', () => {
    const summary = summarizeDayHours(hoursForDays(26), 30)
    expect(calcEarnedFromHours('daily_wage', monthly, hourly_wage, summary)).toBe(26 * 8 * 125)
  })

  it('pays nothing for absent days', () => {
    const summary = summarizeDayHours(hoursForDays(25, 1), 30)
    expect(calcEarnedFromHours('daily_wage', monthly, hourly_wage, summary)).toBe(25 * 8 * 125)
  })

  it('pays leave days (off paid)', () => {
    const summary = summarizeDayHours(hoursForDays(25, 0, 0, 1), 30)
    expect(calcEarnedFromHours('daily_wage', monthly, hourly_wage, summary)).toBe(26 * 8 * 125)
  })

  it('does not pay Sunday weekly off (already in ÷26)', () => {
    const dayHours = hoursForDays(26)
    dayHours['27'] = dayFromPreset('sunday')
    dayHours['28'] = dayFromPreset('sunday')
    const summary = summarizeDayHours(dayHours, 30)
    expect(summary.days_leave).toBe(2)
    expect(summary.total_paid_hours).toBe(26 * 8)
    expect(summary.total_off_unpaid_hours).toBe(0)
    expect(calcEarnedFromHours('daily_wage', monthly, hourly_wage, summary)).toBe(26 * 8 * 125)
  })

  it('pays duty/OT if someone works on Sunday', () => {
    const dayHours = hoursForDays(25)
    dayHours['26'] = { duty_hours: 8, off_paid: false, ot_hours: 2, kind: 'sunday' }
    const summary = summarizeDayHours(dayHours, 30)
    expect(summary.total_paid_hours).toBe(25 * 8 + 8 + 2)
    expect(calcEarnedFromHours('daily_wage', monthly, hourly_wage, summary)).toBe((25 * 8 + 10) * 125)
  })
})

describe('Sunday weekly off — monthly', () => {
  const monthly = 26000
  const { hourly_wage } = deriveWageRates(monthly)

  it('does not cut monthly salary for Sunday rest days', () => {
    const dayHours = hoursForDays(26)
    dayHours['27'] = dayFromPreset('sunday')
    dayHours['28'] = dayFromPreset('sunday')
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

  it('nets advance against earned without exceeding earned', () => {
    const line = buildPayrollLine(staff, hoursForDays(25, 1), undefined, 2026, 6, 30000, 0)
    expect(line.earned).toBe(25000)
    expect(line.advance_deduction).toBe(25000)
    expect(line.net_pay).toBe(0)
    expect(line.pay_status).toBe('pending')
    expect(lineBalanceDue(line)).toBe(0)
  })
})

describe('adjustment advances (from/to + month)', () => {
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
    { ...base, id: 'a0', date: '2026-06-09', amount: 1000, payroll_period: '2026-06' },
    { ...base, id: 'a1', date: '2026-06-10', amount: 2000, payroll_period: '2026-06' },
    { ...base, id: 'a2', date: '2026-07-05', amount: 3000, payroll_period: '2026-06' },
    { ...base, id: 'a3', date: '2026-07-11', amount: 5000, payroll_period: '2026-06' },
    { ...base, id: 'a5', date: '2026-06-15', amount: 800, payroll_period: '2026-07' },
    { ...base, id: 'a4', date: '2026-06-20', amount: 1500, applied_period: '2026-05', payroll_period: '2026-06' },
  ]

  const from = '2026-06-10'
  const to = '2026-07-10'
  const month = '2026-06'

  it('includes advances in date range for adjustment month only', () => {
    expect(advancesForAdjustment(advances, 's1', month, from, to).map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(advanceTotalForAdjustment(advances, 's1', month, from, to)).toBe(5000)
    expect(buildAdvanceItemsForAdjustment(advances, 's1', month, from, to)).toEqual([
      { advance_id: 'a1', date: '2026-06-10', amount: 2000, narration: '' },
      { advance_id: 'a2', date: '2026-07-05', amount: 3000, narration: '' },
    ])
  })

  it('excludes advances tagged for another adjustment month', () => {
    expect(advancesForAdjustment(advances, 's1', month, '2026-06-01', '2026-07-31').some((a) => a.id === 'a5')).toBe(false)
  })

  it('keeps advances applied to the same adjustment month on re-calc', () => {
    const adjusted = advances.map((a) => (a.id === 'a1' ? { ...a, applied_period: '2026-06' } : a))
    expect(advancesForAdjustment(adjusted, 's1', month, from, to).map((a) => a.id)).toEqual(['a1', 'a2'])
  })
})

describe('salary cycle advances', () => {
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

  const salaryDate = '2026-07-10'

  it('defaults June salary to 10 July and cycle start 10 June', () => {
    expect(defaultSalaryDateForPeriod('2026-06')).toBe('2026-07-10')
    expect(salaryCycleStartDate(salaryDate)).toBe('2026-06-10')
  })

  it('includes only unapplied advances from cycle start through salary day', () => {
    expect(advancesForSalaryCycle(advances, 's1', salaryDate).map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(advanceTotalForSalaryCycle(advances, 's1', salaryDate)).toBe(5000)
    expect(buildAdvanceItems(advances, 's1', salaryDate)).toEqual([
      { advance_id: 'a1', date: '2026-06-10', amount: 2000, narration: '' },
      { advance_id: 'a2', date: '2026-07-05', amount: 3000, narration: '' },
    ])
  })

  it('keeps advances applied to the same payroll month in the cycle', () => {
    const adjusted = advances.map((a) => (a.id === 'a1' ? { ...a, applied_period: '2026-06' } : a))
    expect(advancesForSalaryCycle(adjusted, 's1', salaryDate, '2026-06').map((a) => a.id)).toEqual(['a1', 'a2'])
  })

  it('formats adjusted-in label for display', () => {
    expect(advanceAdjustedInLabel('2026-06')).toBe('Adjusted in salary of June 2026')
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
