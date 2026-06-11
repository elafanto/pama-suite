import type { AttendanceMark, PayrollLine, Staff, StaffPayType } from '@/types/models'

export const PAYROLL_WORKING_DAYS = 26
export const PAYROLL_HOURS_PER_DAY = 8
export const MAX_STAFF = 15

export function ceilRupee(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.ceil(n)
}

/** Monthly amount ÷ 26 rounded up → daily; daily ÷ 8 rounded up → hourly. */
export function deriveWageRates(monthlyAmount: number): { daily_wage: number; hourly_wage: number } {
  const monthly = Math.max(0, Number(monthlyAmount) || 0)
  const daily_wage = monthly > 0 ? ceilRupee(monthly / PAYROLL_WORKING_DAYS) : 0
  const hourly_wage = daily_wage > 0 ? ceilRupee(daily_wage / PAYROLL_HOURS_PER_DAY) : 0
  return { daily_wage, hourly_wage }
}

export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number)
  if (!y || !m) return period
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export function currentPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function cycleAttendanceMark(current: AttendanceMark | '' | undefined): AttendanceMark | '' {
  const order: (AttendanceMark | '')[] = ['', 'P', 'A', 'H', 'L']
  const idx = order.indexOf(current || '')
  return order[(idx + 1) % order.length]
}

export function countAttendance(
  attendance: Record<string, AttendanceMark | ''>,
  daysInPeriod: number,
): { present: number; half: number; absent: number; leave: number; marked: number } {
  let present = 0
  let half = 0
  let absent = 0
  let leave = 0
  let marked = 0
  for (let d = 1; d <= daysInPeriod; d++) {
    const key = String(d).padStart(2, '0')
    const mark = attendance[key]
    if (!mark) continue
    marked++
    if (mark === 'P') present++
    else if (mark === 'H') half++
    else if (mark === 'A') absent++
    else if (mark === 'L') leave++
  }
  return { present, half, absent, leave, marked }
}

export function calcEarned(
  payType: StaffPayType,
  monthlyAmount: number,
  dailyWage: number,
  hourlyWage: number,
  attendance: Record<string, AttendanceMark | ''>,
  daysInPeriod: number,
  otHours: number,
): number {
  const { present, half, leave } = countAttendance(attendance, daysInPeriod)
  const dayUnits = present + leave + half * 0.5
  const ot = Math.max(0, Number(otHours) || 0) * hourlyWage

  if (payType === 'daily_wage') {
    return ceilRupee(dayUnits * dailyWage + ot)
  }

  const { absent, half: halfDays } = countAttendance(attendance, daysInPeriod)
  const base = Math.max(0, Number(monthlyAmount) || 0)
  const deduction = absent * dailyWage + halfDays * dailyWage * 0.5
  return Math.max(0, ceilRupee(base - deduction + ot))
}

export function buildPayrollLine(
  staff: Staff,
  attendance: Record<string, AttendanceMark | ''>,
  year: number,
  month: number,
  otHours: number,
  advanceDeduction: number,
  otherDeduction: number,
): PayrollLine {
  const dim = daysInMonth(year, month)
  const counts = countAttendance(attendance, dim)
  const earned = calcEarned(
    staff.pay_type,
    staff.monthly_amount,
    staff.daily_wage,
    staff.hourly_wage,
    attendance,
    dim,
    otHours,
  )
  const adv = Math.min(Math.max(0, advanceDeduction), earned)
  const other = Math.min(Math.max(0, otherDeduction), Math.max(0, earned - adv))
  const net = Math.max(0, earned - adv - other)

  return {
    staff_id: staff.id,
    staff_name: staff.name,
    pay_type: staff.pay_type,
    monthly_amount: staff.monthly_amount,
    daily_wage: staff.daily_wage,
    hourly_wage: staff.hourly_wage,
    attendance: { ...attendance },
    days_present: counts.present + counts.leave,
    days_half: counts.half,
    days_absent: counts.absent,
    days_leave: counts.leave,
    ot_hours: Math.max(0, Number(otHours) || 0),
    earned,
    advance_deduction: adv,
    other_deduction: other,
    net_pay: net,
  }
}

export function sumPayrollLines(lines: PayrollLine[]) {
  return lines.reduce(
    (acc, l) => ({
      total_earned: acc.total_earned + l.earned,
      total_advance: acc.total_advance + l.advance_deduction,
      total_other: acc.total_other + l.other_deduction,
      total_net: acc.total_net + l.net_pay,
    }),
    { total_earned: 0, total_advance: 0, total_other: 0, total_net: 0 },
  )
}
