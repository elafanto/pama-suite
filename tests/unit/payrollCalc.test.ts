import { describe, expect, it } from 'vitest'
import {
  buildPayrollLine,
  calcEarnedFromHours,
  dayFromPreset,
  deriveWageRates,
  isStaffInPeriod,
  summarizeDayHours,
} from '@/services/payrollCalc'
import type { DayAttendance, Staff } from '@/types/models'

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
