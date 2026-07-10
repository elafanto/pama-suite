import type {
  AttendanceMark,
  DayAttendance,
  PayrollLine,
  Staff,
  StaffAdvance,
  StaffLinePayStatus,
  StaffPayType,
  PayrollAdvanceItem,
  PayrollRun,
} from '@/types/models'

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

/** e.g. "Adjusted in salary of June 2026" */
export function advanceAdjustedInLabel(appliedPeriod: string): string {
  if (!appliedPeriod) return ''
  return `Adjusted in salary of ${periodLabel(appliedPeriod)}`
}

/** YYYY-MM from leaving_date, or null if not set. */
export function staffLeavingPeriod(leavingDate: string | undefined | null): string | null {
  if (!leavingDate || leavingDate.length < 7) return null
  return leavingDate.slice(0, 7)
}

/**
 * Staff appears in a payroll period if still employed that month.
 * Leaving month is included; from the next month they are hidden.
 */
export function isStaffInPeriod(
  staff: Pick<Staff, 'is_active' | 'leaving_date' | 'is_deleted'>,
  period: string,
): boolean {
  if (staff.is_deleted) return false
  const leavePeriod = staffLeavingPeriod(staff.leaving_date)
  if (leavePeriod) return period <= leavePeriod
  return staff.is_active !== false
}

export function filterStaffForPeriod<T extends Pick<Staff, 'is_active' | 'leaving_date' | 'is_deleted'>>(
  staffList: T[],
  period: string,
): T[] {
  return staffList.filter((s) => isStaffInPeriod(s, period))
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export function currentPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** YYYY-MM from advance date or explicit payroll_period. */
export function advancePayrollPeriod(advance: Pick<StaffAdvance, 'date' | 'payroll_period'>): string {
  if (advance.payroll_period && advance.payroll_period.length >= 7) return advance.payroll_period.slice(0, 7)
  if (!advance.date || advance.date.length < 7) return ''
  return advance.date.slice(0, 7)
}

type AdvanceCalcRow = Pick<StaffAdvance, 'id' | 'staff_id' | 'date' | 'payroll_period' | 'amount' | 'applied_period' | 'narration'>

/** Open advances for one staff in one payroll month only — no carry to next month. */
export function advancesForStaffInPeriod(
  advances: AdvanceCalcRow[],
  staffId: string,
  period: string,
) {
  return advances.filter(
    (a) => a.staff_id === staffId
      && advancePayrollPeriod(a) === period
      && !a.applied_period,
  )
}

export function advanceTotalForPeriod(
  advances: AdvanceCalcRow[],
  staffId: string,
  period: string,
): number {
  return advancesForStaffInPeriod(advances, staffId, period).reduce((s, a) => s + a.amount, 0)
}

/** Default salary pay date: 10th of the month after the payroll period (June → 10 July). */
export function defaultSalaryDateForPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number)
  if (!y || !m) return new Date().toISOString().slice(0, 10)
  const d = new Date(y, m, 10)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function resolveRunSalaryDate(run: Pick<PayrollRun, 'period' | 'salary_date' | 'payment_date'>): string {
  if (run.salary_date) return run.salary_date
  if (run.payment_date) return run.payment_date
  return defaultSalaryDateForPeriod(run.period)
}

/** Cycle start = same day-of-month, one month before salary date (10 Jul → 10 Jun). */
export function salaryCycleStartDate(salaryDate: string): string {
  const [y, m, d] = salaryDate.split('-').map(Number)
  if (!y || !m || !d) return salaryDate.slice(0, 7) + '-01'
  const prev = new Date(y, m - 2, d)
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`
}

/** Unapplied advances from cycle start through salary date (inclusive).
 *  Also includes advances already applied to payrollPeriod (same month re-calc). */
export function advancesForSalaryCycle(
  advances: AdvanceCalcRow[],
  staffId: string,
  salaryDate: string,
  payrollPeriod?: string,
) {
  if (!salaryDate) return []
  const start = salaryCycleStartDate(salaryDate)
  return advances
    .filter((a) => {
      if (a.staff_id !== staffId || a.date < start || a.date > salaryDate) return false
      if (!a.applied_period) return true
      return payrollPeriod ? a.applied_period === payrollPeriod : false
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}

export function advanceTotalForSalaryCycle(
  advances: AdvanceCalcRow[],
  staffId: string,
  salaryDate: string,
  payrollPeriod?: string,
): number {
  return advancesForSalaryCycle(advances, staffId, salaryDate, payrollPeriod).reduce((s, a) => s + a.amount, 0)
}

export function buildAdvanceItems(
  advances: AdvanceCalcRow[],
  staffId: string,
  salaryDate: string,
  payrollPeriod?: string,
): PayrollAdvanceItem[] {
  return advancesForSalaryCycle(advances, staffId, salaryDate, payrollPeriod).map((a) => ({
    advance_id: a.id,
    date: a.date,
    amount: a.amount,
    narration: a.narration || '',
  }))
}

export function sumLinePayments(line: Pick<PayrollLine, 'payments' | 'paid_amount'>): number {
  if (line.payments?.length) return line.payments.reduce((s, p) => s + p.amount, 0)
  return Math.max(0, line.paid_amount || 0)
}

export function lineBalanceDue(line: Pick<PayrollLine, 'net_pay' | 'payments' | 'paid_amount'>): number {
  return Math.max(0, line.net_pay - sumLinePayments(line))
}

export function deriveLinePayStatus(line: Pick<PayrollLine, 'net_pay' | 'payments' | 'paid_amount'>): StaffLinePayStatus {
  const paid = sumLinePayments(line)
  if (paid <= 0) return 'pending'
  if (paid >= line.net_pay) return 'paid'
  return 'partial'
}

export function normalizePayrollLine(line: PayrollLine, runStatus?: string): PayrollLine {
  const payments = line.payments ?? []
  const paidFromLegacy = runStatus === 'paid' && !payments.length && !line.paid_amount
    ? line.net_pay
    : Math.max(0, line.paid_amount || 0)
  const paid_amount = payments.length ? sumLinePayments({ payments, paid_amount: 0 }) : paidFromLegacy
  const normalized: PayrollLine = {
    ...line,
    payments,
    paid_amount,
    pay_status: line.pay_status || deriveLinePayStatus({ ...line, paid_amount, payments }),
    advance_items: line.advance_items ?? [],
  }
  normalized.pay_status = deriveLinePayStatus(normalized)
  return normalized
}

export function emptyDay(): DayAttendance {
  return { duty_hours: null, off_paid: false, ot_hours: 0, kind: undefined }
}

export function isSunday(year: number, month: number, dayKey: string): boolean {
  const day = Number(dayKey)
  if (!day) return false
  return new Date(year, month - 1, day).getDay() === 0
}

export function sundayDayKeys(year: number, month: number): string[] {
  const dim = daysInMonth(year, month)
  const keys: string[] = []
  for (let d = 1; d <= dim; d++) {
    const key = String(d).padStart(2, '0')
    if (isSunday(year, month, key)) keys.push(key)
  }
  return keys
}

/** Off-duty hours when duty &lt; 8 (e.g. 6 hr duty → 2 hr off). */
export function calcOffDutyHours(dutyHours: number | null): number {
  if (dutyHours === null || dutyHours < 0) return 0
  const duty = Math.min(PAYROLL_HOURS_PER_DAY, dutyHours)
  return Math.max(0, PAYROLL_HOURS_PER_DAY - duty)
}

export type DayBulkPreset = 'full' | 'half' | 'absent' | 'leave' | 'holiday' | 'sunday'

export function dayFromPreset(preset: DayBulkPreset): DayAttendance {
  if (preset === 'full') return { duty_hours: 8, off_paid: false, ot_hours: 0, kind: 'work' }
  if (preset === 'half') return { duty_hours: 4, off_paid: false, ot_hours: 0, kind: 'work' }
  if (preset === 'absent') return { duty_hours: 0, off_paid: false, ot_hours: 0, kind: 'absent' }
  if (preset === 'holiday') return { duty_hours: 0, off_paid: true, ot_hours: 0, kind: 'holiday' }
  // Sunday is already excluded from ÷26 daily wage — rest day, no pay / no cut.
  if (preset === 'sunday') return { duty_hours: 0, off_paid: false, ot_hours: 0, kind: 'sunday' }
  return { duty_hours: 0, off_paid: true, ot_hours: 0, kind: 'leave' }
}

/** Legacy P/A/H/L → day_hours. */
export function markToDay(mark: AttendanceMark | '' | undefined): DayAttendance {
  if (mark === 'P') return dayFromPreset('full')
  if (mark === 'A') return dayFromPreset('absent')
  if (mark === 'H') return dayFromPreset('half')
  if (mark === 'L') return dayFromPreset('leave')
  return emptyDay()
}

export function migrateMarksToDayHours(
  marks: Record<string, AttendanceMark | ''> | undefined,
): Record<string, DayAttendance> {
  const out: Record<string, DayAttendance> = {}
  if (!marks) return out
  for (const [day, mark] of Object.entries(marks)) {
    if (mark) out[day] = markToDay(mark)
  }
  return out
}

export function normalizeDayHours(line: Pick<PayrollLine, 'day_hours' | 'attendance'>): Record<string, DayAttendance> {
  if (line.day_hours && Object.keys(line.day_hours).length > 0) return { ...line.day_hours }
  return migrateMarksToDayHours(line.attendance)
}

export interface DayHourBreakdown {
  paid: number
  unpaid: number
  duty: number
  off: number
  ot: number
}

export function breakdownDay(day: DayAttendance | undefined): DayHourBreakdown {
  if (!day || day.duty_hours === null) {
    return { paid: 0, unpaid: 0, duty: 0, off: 0, ot: 0 }
  }

  const dutyRaw = Math.max(0, Number(day.duty_hours) || 0)
  const dutyRegular = Math.min(PAYROLL_HOURS_PER_DAY, dutyRaw)
  const ot = Math.max(0, Number(day.ot_hours) || 0)

  // Weekly off is outside the ÷26 working-day model: no pay and no salary cut.
  // If someone actually works on Sunday (duty > 0), normal duty/OT pay applies.
  if (day.kind === 'sunday' && dutyRegular === 0) {
    return { paid: ot, unpaid: 0, duty: 0, off: PAYROLL_HOURS_PER_DAY, ot }
  }

  const off = calcOffDutyHours(dutyRegular)
  const offPaid = day.off_paid ? off : 0
  const offUnpaid = day.off_paid ? 0 : off

  const paid = dutyRegular + offPaid + ot
  const unpaid = offUnpaid

  return { paid, unpaid, duty: dutyRegular, off, ot }
}

export function summarizeDayHours(
  dayHours: Record<string, DayAttendance>,
  daysInPeriod: number,
): {
  days_present: number
  days_half: number
  days_absent: number
  days_leave: number
  total_duty_hours: number
  total_off_unpaid_hours: number
  total_ot_hours: number
  total_paid_hours: number
} {
  let days_present = 0
  let days_half = 0
  let days_absent = 0
  let days_leave = 0
  let total_duty_hours = 0
  let total_off_unpaid_hours = 0
  let total_ot_hours = 0
  let total_paid_hours = 0

  for (let d = 1; d <= daysInPeriod; d++) {
    const key = String(d).padStart(2, '0')
    const day = dayHours[key]
    if (!day || day.duty_hours === null) continue

    const b = breakdownDay(day)
    total_duty_hours += b.duty
    total_off_unpaid_hours += b.unpaid
    total_ot_hours += b.ot
    total_paid_hours += b.paid

    if (day.kind === 'holiday' || day.kind === 'sunday' || (day.duty_hours === 0 && day.off_paid)) days_leave++
    else if (day.duty_hours === 0) days_absent++
    else if (day.duty_hours >= PAYROLL_HOURS_PER_DAY) days_present++
    else if (day.duty_hours >= PAYROLL_HOURS_PER_DAY / 2) days_half++
    else days_half++
  }

  return {
    days_present,
    days_half,
    days_absent,
    days_leave,
    total_duty_hours,
    total_off_unpaid_hours,
    total_ot_hours,
    total_paid_hours,
  }
}

export function calcEarnedFromHours(
  payType: StaffPayType,
  monthlyAmount: number,
  hourlyWage: number,
  summary: ReturnType<typeof summarizeDayHours>,
): number {
  const hourly = Math.max(0, hourlyWage)
  const otPay = summary.total_ot_hours * hourly

  if (payType === 'daily_wage') {
    return ceilRupee(summary.total_paid_hours * hourly)
  }

  // Monthly: fixed salary − full-day absences − partial unpaid off-duty + OT.
  // Absent days already contribute 8 unpaid hours in the summary; deduct those
  // only once via daily wage (not again as hourly unpaid).
  const base = Math.max(0, Number(monthlyAmount) || 0)
  const daily = ceilRupee(base / PAYROLL_WORKING_DAYS)
  const absentDeduction = summary.days_absent * daily
  const unpaidHoursExAbsent = Math.max(
    0,
    summary.total_off_unpaid_hours - summary.days_absent * PAYROLL_HOURS_PER_DAY,
  )
  const unpaidDeduction = unpaidHoursExAbsent * hourly
  return Math.max(0, ceilRupee(base - absentDeduction - unpaidDeduction + otPay))
}

/** Salary expense for one staff on one day (paid hours × hourly wage). */
export function calcDaySalaryExpense(
  staff: Pick<Staff, 'hourly_wage'>,
  day: DayAttendance | undefined,
): number {
  if (!day || day.duty_hours === null) return 0
  const hourly = Math.max(0, staff.hourly_wage)
  const paidHours = breakdownDay(day).paid
  if (paidHours <= 0) return 0
  return ceilRupee(paidHours * hourly)
}

/** Total salary expense for all staff on one calendar day. */
export function sumDaySalaryExpense(
  dayKey: string,
  staffList: Staff[],
  lines: PayrollLine[] | undefined,
): number {
  const lineByStaff = new Map((lines ?? []).map((l) => [l.staff_id, l]))
  let total = 0
  for (const staff of staffList) {
    const line = lineByStaff.get(staff.id)
    const dayHours = line ? normalizeDayHours(line) : {}
    total += calcDaySalaryExpense(staff, dayHours[dayKey])
  }
  return total
}

export function buildPayrollLine(
  staff: Staff,
  dayHoursInput: Record<string, DayAttendance> | undefined,
  legacyMarks: Record<string, AttendanceMark | ''> | undefined,
  year: number,
  month: number,
  advanceDeduction: number,
  otherDeduction: number,
  existing?: Pick<PayrollLine, 'payments' | 'paid_amount' | 'pay_status' | 'payment_date' | 'payment_mode'>,
  advanceItems: PayrollAdvanceItem[] = [],
): PayrollLine {
  const dim = daysInMonth(year, month)
  const day_hours =
    dayHoursInput && Object.keys(dayHoursInput).length > 0
      ? { ...dayHoursInput }
      : migrateMarksToDayHours(legacyMarks)

  const summary = summarizeDayHours(day_hours, dim)
  const earned = calcEarnedFromHours(staff.pay_type, staff.monthly_amount, staff.hourly_wage, summary)
  const adv = Math.min(Math.max(0, advanceDeduction), earned)
  const other = Math.min(Math.max(0, otherDeduction), Math.max(0, earned - adv))
  const net = Math.max(0, earned - adv - other)
  const payments = existing?.payments ? [...existing.payments] : []
  const paid_amount = payments.length ? sumLinePayments({ payments, paid_amount: 0 }) : Math.max(0, existing?.paid_amount || 0)
  const cappedPaid = Math.min(paid_amount, net)
  const pay_status = deriveLinePayStatus({ net_pay: net, paid_amount: cappedPaid, payments })

  return {
    staff_id: staff.id,
    staff_name: staff.name,
    pay_type: staff.pay_type,
    monthly_amount: staff.monthly_amount,
    daily_wage: staff.daily_wage,
    hourly_wage: staff.hourly_wage,
    day_hours,
    days_present: summary.days_present,
    days_half: summary.days_half,
    days_absent: summary.days_absent,
    days_leave: summary.days_leave,
    total_duty_hours: summary.total_duty_hours,
    total_off_unpaid_hours: summary.total_off_unpaid_hours,
    total_ot_hours: summary.total_ot_hours,
    total_paid_hours: summary.total_paid_hours,
    earned,
    advance_deduction: adv,
    advance_items: advanceItems,
    other_deduction: other,
    net_pay: net,
    paid_amount: cappedPaid,
    pay_status,
    payments,
    payment_date: existing?.payment_date,
    payment_mode: existing?.payment_mode,
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

/** Short label for attendance grid cell. */
export function dayCellLabel(day: DayAttendance | undefined): string {
  if (!day || day.duty_hours === null) return '·'
  if (day.kind === 'holiday') return 'H'
  if (day.kind === 'sunday') return '☀'
  if (day.duty_hours >= PAYROLL_HOURS_PER_DAY && !day.ot_hours && !calcOffDutyHours(day.duty_hours)) return '8'
  const off = calcOffDutyHours(day.duty_hours)
  const parts: string[] = [String(day.duty_hours)]
  if (off > 0) parts.push(day.off_paid ? '✓' : '−')
  if (day.ot_hours > 0) parts.push(`+${day.ot_hours}`)
  return parts.join('')
}

export function dayCellClass(day: DayAttendance | undefined): string {
  if (!day || day.duty_hours === null) return 'bg-slate-100 text-slate-400'
  if (day.kind === 'holiday') return 'bg-violet-500 text-white'
  if (day.kind === 'sunday') return 'bg-indigo-400 text-white'
  if (day.duty_hours === 0 && day.off_paid) return 'bg-sky-500 text-white'
  if (day.duty_hours === 0) return 'bg-rose-500 text-white'
  if (day.duty_hours >= PAYROLL_HOURS_PER_DAY) return 'bg-emerald-500 text-white'
  if (day.off_paid) return 'bg-teal-500 text-white'
  return 'bg-amber-400 text-navy'
}
