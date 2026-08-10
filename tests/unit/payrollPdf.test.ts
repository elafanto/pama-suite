import { describe, expect, it } from 'vitest'
import { dayFromPreset } from '@/services/payrollCalc'
import { buildPayslipDayRows } from '@/services/payrollPdf'
import type { PayrollLine } from '@/types/models'

function baseLine(day_hours: PayrollLine['day_hours']): PayrollLine {
  return {
    staff_id: 's1',
    staff_name: 'Ravi',
    pay_type: 'monthly',
    monthly_amount: 26000,
    daily_wage: 1000,
    hourly_wage: 125,
    day_hours,
    days_present: 0,
    days_half: 0,
    days_absent: 0,
    days_leave: 0,
    total_duty_hours: 0,
    total_off_unpaid_hours: 0,
    total_ot_hours: 0,
    total_paid_hours: 0,
    earned: 0,
    advance_deduction: 0,
    advance_items: [],
    other_deduction: 0,
    net_pay: 0,
    paid_amount: 0,
    pay_status: 'pending',
    payments: [],
  }
}

describe('buildPayslipDayRows', () => {
  it('skips unmarked days and breaks down OT / unpaid / day pay', () => {
    const line = baseLine({
      '01': dayFromPreset('full'),
      '02': { duty_hours: 6, off_paid: false, ot_hours: 2, kind: 'work' },
      '03': dayFromPreset('absent'),
    })
    const rows = buildPayslipDayRows(line, 2026, 8)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ dayKey: '01', status: 'Full', duty: 8, offUnpaid: 0, ot: 0, paid: 8, dayPay: 1000 })
    expect(rows[1]).toMatchObject({
      dayKey: '02',
      duty: 6,
      offUnpaid: 2,
      ot: 2,
      paid: 8,
      dayPay: 1000,
    })
    expect(rows[2]).toMatchObject({ dayKey: '03', status: 'Absent', duty: 0, paid: 0, dayPay: 0 })
  })

  it('returns empty when no days marked', () => {
    expect(buildPayslipDayRows(baseLine({}), 2026, 8)).toEqual([])
  })
})
