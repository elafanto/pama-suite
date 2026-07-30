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
  StaffSalaryEntry,
} from '@/types/models'

export const PAYROLL_WORKING_DAYS = 26
export const PAYROLL_HOURS_PER_DAY = 8
export const MAX_STAFF = 50

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

const SALARY_HISTORY_FALLBACK_PERIOD = '0000-01'

/** Ordered salary revisions; legacy staff without history get one synthetic entry. */
export function normalizeSalaryHistory(
  staff: Pick<Staff, 'monthly_amount' | 'salary_history'>,
): StaffSalaryEntry[] {
  const raw = (staff.salary_history ?? []).filter((e) => e.effective_period?.length >= 7)
  if (raw.length) {
    return [...raw].sort((a, b) => a.effective_period.localeCompare(b.effective_period))
  }
  const monthly = Math.max(0, Number(staff.monthly_amount) || 0)
  if (monthly > 0) {
    return [{ effective_period: SALARY_HISTORY_FALLBACK_PERIOD, monthly_amount: monthly }]
  }
  return []
}

/** Monthly salary effective for a payroll period (latest revision on or before that month). */
export function staffSalaryForPeriod(
  staff: Pick<Staff, 'monthly_amount' | 'salary_history'>,
  period: string,
): number {
  const p = period.slice(0, 7)
  const history = normalizeSalaryHistory(staff)
  let best: StaffSalaryEntry | undefined
  for (const entry of history) {
    if (entry.effective_period <= p) {
      if (!best || entry.effective_period > best.effective_period) best = entry
    }
  }
  if (best) return best.monthly_amount
  if (history.length) return history[0].monthly_amount
  return Math.max(0, Number(staff.monthly_amount) || 0)
}

/** Staff record with monthly/daily/hourly rates resolved for a payroll month. */
export function staffWithSalaryForPeriod(staff: Staff, period: string): Staff {
  const monthly_amount = staffSalaryForPeriod(staff, period)
  const rates = deriveWageRates(monthly_amount)
  return { ...staff, monthly_amount, daily_wage: rates.daily_wage, hourly_wage: rates.hourly_wage }
}

export function staffDisplayRates(
  staff: Pick<Staff, 'monthly_amount' | 'salary_history'>,
  refPeriod = currentPeriod(),
): { monthly_amount: number; daily_wage: number; hourly_wage: number } {
  const monthly_amount = staffSalaryForPeriod(staff, refPeriod)
  return { monthly_amount, ...deriveWageRates(monthly_amount) }
}

export function upsertSalaryHistoryEntry(
  history: StaffSalaryEntry[],
  entry: StaffSalaryEntry,
): StaffSalaryEntry[] {
  const period = entry.effective_period.slice(0, 7)
  const next = history.filter((e) => e.effective_period !== SALARY_HISTORY_FALLBACK_PERIOD)
  const idx = next.findIndex((e) => e.effective_period === period)
  const row: StaffSalaryEntry = {
    effective_period: period,
    monthly_amount: Math.max(0, Number(entry.monthly_amount) || 0),
    note: (entry.note || '').trim() || undefined,
  }
  if (idx >= 0) next[idx] = row
  else next.push(row)
  return next.sort((a, b) => a.effective_period.localeCompare(b.effective_period))
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

/** YYYY-MM from joining_date, or null if not set. */
export function staffJoiningPeriod(joiningDate: string | undefined | null): string | null {
  if (!joiningDate || joiningDate.length < 7) return null
  return joiningDate.slice(0, 7)
}

/**
 * Staff appears in a payroll period if employed that month.
 * Joining month is included (from joining day); months before join are hidden.
 * Leaving month is included; from the next month they are hidden.
 */
export function isStaffInPeriod(
  staff: Pick<Staff, 'is_active' | 'joining_date' | 'leaving_date' | 'is_deleted'>,
  period: string,
): boolean {
  if (staff.is_deleted) return false
  const joinPeriod = staffJoiningPeriod(staff.joining_date)
  if (joinPeriod && period < joinPeriod) return false
  const leavePeriod = staffLeavingPeriod(staff.leaving_date)
  if (leavePeriod) return period <= leavePeriod
  return staff.is_active !== false
}

export function filterStaffForPeriod<T extends Pick<Staff, 'is_active' | 'joining_date' | 'leaving_date' | 'is_deleted'>>(
  staffList: T[],
  period: string,
): T[] {
  return staffList.filter((s) => isStaffInPeriod(s, period))
}

/** Full calendar date YYYY-MM-DD for a payroll day key. */
export function periodDayDate(year: number, month: number, dayKey: string): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(dayKey).padStart(2, '0')}`
}

/**
 * True when staff can work / mark attendance on this calendar day.
 * Days before joining_date and after leaving_date are excluded.
 */
export function isStaffEmployedOnDay(
  staff: Pick<Staff, 'joining_date' | 'leaving_date'>,
  year: number,
  month: number,
  dayKey: string,
): boolean {
  const date = periodDayDate(year, month, dayKey)
  const join = (staff.joining_date || '').trim()
  if (join && date < join.slice(0, 10)) return false
  const leave = (staff.leaving_date || '').trim()
  if (leave && date > leave.slice(0, 10)) return false
  return true
}

/** Drop attendance marks outside the joining–leaving window. */
export function filterDayHoursToEmployment(
  dayHours: Record<string, DayAttendance>,
  staff: Pick<Staff, 'joining_date' | 'leaving_date'>,
  year: number,
  month: number,
): Record<string, DayAttendance> {
  const out: Record<string, DayAttendance> = {}
  for (const [day, mark] of Object.entries(dayHours)) {
    if (isStaffEmployedOnDay(staff, year, month, day)) out[day] = mark
  }
  return out
}

/**
 * Weekdays in this month outside employment (before join / after leave).
 * Used so monthly salary deducts those days (÷26 daily), without counting Sundays.
 */
export function unpaidDaysOutsideEmployment(
  staff: Pick<Staff, 'joining_date' | 'leaving_date'>,
  year: number,
  month: number,
): number {
  const dim = daysInMonth(year, month)
  let count = 0
  for (let d = 1; d <= dim; d++) {
    const key = String(d).padStart(2, '0')
    if (isStaffEmployedOnDay(staff, year, month, key)) continue
    if (isSunday(year, month, key)) continue
    count++
  }
  return count
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

/** Last calendar day of payroll month (YYYY-MM-DD). */
export function periodLastDate(period: string): string {
  const [y, m] = period.split('-').map(Number)
  if (!y || !m) return period
  const last = new Date(y, m, 0).getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}

export function defaultAdvanceRangeForPeriod(period: string): { from: string; to: string } {
  return { from: `${period}-01`, to: periodLastDate(period) }
}

export function resolveRunAdvanceRange(
  run: Pick<PayrollRun, 'period' | 'advance_from' | 'advance_to'>,
): { advanceFrom: string; advanceTo: string } {
  const defaults = defaultAdvanceRangeForPeriod(run.period)
  return {
    advanceFrom: run.advance_from || defaults.from,
    advanceTo: run.advance_to || defaults.to,
  }
}

/** Unapplied advances in date range; includes same-month applied on re-calc. */
export function advancesInRange(
  advances: AdvanceCalcRow[],
  staffId: string,
  salaryPeriod: string,
  fromDate: string,
  toDate: string,
) {
  if (!fromDate || !toDate) return []
  return advances
    .filter((a) => {
      if (a.staff_id !== staffId || a.date < fromDate || a.date > toDate) return false
      if (!a.applied_period) return true
      return a.applied_period === salaryPeriod
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}

export function advanceTotalInRange(
  advances: AdvanceCalcRow[],
  staffId: string,
  salaryPeriod: string,
  fromDate: string,
  toDate: string,
): number {
  return advancesInRange(advances, staffId, salaryPeriod, fromDate, toDate).reduce((s, a) => s + a.amount, 0)
}

export function buildAdvanceItemsInRange(
  advances: AdvanceCalcRow[],
  staffId: string,
  salaryPeriod: string,
  fromDate: string,
  toDate: string,
): PayrollAdvanceItem[] {
  return advancesInRange(advances, staffId, salaryPeriod, fromDate, toDate).map((a) => ({
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
  return line.net_pay - sumLinePayments(line)
}

export function advanceExceedsEarned(line: Pick<PayrollLine, 'earned' | 'advance_deduction'>): boolean {
  return (line.advance_deduction || 0) > (line.earned || 0)
}

export function advanceOverEarnedAmount(line: Pick<PayrollLine, 'earned' | 'advance_deduction'>): number {
  return Math.max(0, (line.advance_deduction || 0) - (line.earned || 0))
}

export function formatPayrollMoney(amount: number): string {
  const n = Math.round(Number(amount) || 0)
  if (n < 0) return `− ₹${Math.abs(n).toLocaleString('en-IN')}`
  return `₹${n.toLocaleString('en-IN')}`
}

export type AdvanceSortMode = 'date' | 'amount'

export function sortAdvanceItems<T extends { date: string; amount: number; advance_id?: string }>(
  items: T[],
  mode: AdvanceSortMode,
): T[] {
  const copy = [...items]
  if (mode === 'amount') {
    return copy.sort((a, b) => b.amount - a.amount || a.date.localeCompare(b.date))
  }
  return copy.sort(
    (a, b) => a.date.localeCompare(b.date) || (a.advance_id || '').localeCompare(b.advance_id || ''),
  )
}

export function sortStaffAdvances<T extends { date: string; amount: number; id: string }>(
  items: T[],
  mode: AdvanceSortMode,
): T[] {
  const copy = [...items]
  if (mode === 'amount') {
    return copy.sort((a, b) => b.amount - a.amount || a.date.localeCompare(b.date))
  }
  return copy.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}

export function deriveLinePayStatus(line: Pick<PayrollLine, 'net_pay' | 'payments' | 'paid_amount'>): StaffLinePayStatus {
  const paid = sumLinePayments(line)
  if (line.net_pay <= 0) {
    if (paid <= 0) return line.net_pay === 0 ? 'paid' : 'pending'
    return 'partial'
  }
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
  const rawHours =
    dayHoursInput && Object.keys(dayHoursInput).length > 0
      ? { ...dayHoursInput }
      : migrateMarksToDayHours(legacyMarks)
  const day_hours = filterDayHoursToEmployment(rawHours, staff, year, month)

  const summary = summarizeDayHours(day_hours, dim)
  const outsideDays = unpaidDaysOutsideEmployment(staff, year, month)
  const summaryForPay =
    outsideDays > 0 && staff.pay_type === 'monthly'
      ? {
          ...summary,
          days_absent: summary.days_absent + outsideDays,
          total_off_unpaid_hours: summary.total_off_unpaid_hours + outsideDays * PAYROLL_HOURS_PER_DAY,
        }
      : summary
  const earned = calcEarnedFromHours(staff.pay_type, staff.monthly_amount, staff.hourly_wage, summaryForPay)
  const adv = Math.max(0, advanceDeduction)
  const other = Math.min(Math.max(0, otherDeduction), Math.max(0, earned))
  const net = earned - adv - other
  const payments = existing?.payments ? [...existing.payments] : []
  const paid_amount = payments.length ? sumLinePayments({ payments, paid_amount: 0 }) : Math.max(0, existing?.paid_amount || 0)
  const cappedPaid = net > 0 ? Math.min(paid_amount, net) : 0
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
