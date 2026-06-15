import { normalizePhone } from '@/services/boxcalcUi'
import { breakdownDay, daysInMonth, normalizeDayHours, periodLabel } from '@/services/payrollCalc'
import type { DayAttendance, PayrollLine, Staff } from '@/types/models'

function weekdayShort(year: number, month: number, dayKey: string): string {
  const d = Number(dayKey)
  if (!d) return ''
  return new Date(year, month - 1, d).toLocaleDateString('en-IN', { weekday: 'short' })
}

/** One readable line per marked day; unmarked days are skipped. */
export function formatDayHoursLine(
  dayKey: string,
  day: DayAttendance | undefined,
  year: number,
  month: number,
): string | null {
  if (!day || day.duty_hours === null) return null

  const label = `${dayKey} ${weekdayShort(year, month, dayKey)}`
  const b = breakdownDay(day)

  if (day.kind === 'holiday') return `${label}: Holiday (${b.paid}h paid)`
  if (day.kind === 'sunday') return `${label}: Sunday (${b.paid}h paid)`
  if (day.kind === 'leave') return `${label}: Leave (${b.paid}h paid)`
  if (day.duty_hours === 0 && !day.off_paid) return `${label}: Absent`
  if (day.duty_hours === 0 && day.off_paid) return `${label}: Paid off (${b.paid}h paid)`

  const parts: string[] = [`${day.duty_hours}h duty`]
  if (b.unpaid > 0) parts.push(`${b.unpaid}h off unpaid`)
  else if (day.off_paid && b.off > 0) parts.push(`${b.off}h off paid`)
  if (b.ot > 0) parts.push(`${b.ot}h OT`)
  parts.push(`= ${b.paid}h paid`)
  return `${label}: ${parts.join(', ')}`
}

export function hasMarkedAttendance(line: PayrollLine | undefined): boolean {
  if (!line) return false
  const hours = normalizeDayHours(line)
  return Object.values(hours).some((d) => d.duty_hours !== null)
}

export function generateStaffHoursMessage(
  firmName: string,
  staff: Pick<Staff, 'name' | 'pay_type' | 'monthly_amount'>,
  line: PayrollLine,
  year: number,
  month: number,
): string {
  const hours = normalizeDayHours(line)
  const dim = daysInMonth(year, month)
  const dayLines: string[] = []

  for (let d = 1; d <= dim; d++) {
    const key = String(d).padStart(2, '0')
    const row = formatDayHoursLine(key, hours[key], year, month)
    if (row) dayLines.push(row)
  }

  const payLabel = staff.pay_type === 'monthly' ? 'Monthly salary' : 'Daily wage (÷26)'
  const lines: string[] = [
    `*${firmName}*`,
    `Work hours — ${periodLabel(`${year}-${String(month).padStart(2, '0')}`)}`,
    '',
    `*${staff.name}*`,
    payLabel,
    '',
  ]

  if (dayLines.length) {
    lines.push(...dayLines)
  } else {
    lines.push('(Is month me koi din mark nahi)')
  }

  lines.push(
    '',
    '---',
    `Duty: ${line.total_duty_hours ?? 0}h | OT: ${line.total_ot_hours ?? 0}h | Paid: ${line.total_paid_hours ?? 0}h`,
  )
  if ((line.total_off_unpaid_hours ?? 0) > 0) {
    lines.push(`Off unpaid: ${line.total_off_unpaid_hours}h`)
  }
  lines.push(
    `Days: ${line.days_present} present · ${line.days_half} partial · ${line.days_absent} absent · ${line.days_leave} leave`,
  )

  if (line.earned > 0) {
    lines.push(`Earned: ₹${line.earned.toLocaleString('en-IN')}`)
    if (line.advance_deduction > 0) {
      lines.push(`Advance: −₹${line.advance_deduction.toLocaleString('en-IN')}`)
    }
    if (line.other_deduction > 0) {
      lines.push(`Other ded.: −₹${line.other_deduction.toLocaleString('en-IN')}`)
    }
    lines.push(`*Net pay: ₹${line.net_pay.toLocaleString('en-IN')}*`)
  }

  return lines.join('\n')
}

export function openStaffHoursWhatsApp(phone: string, message: string): void {
  const encoded = encodeURIComponent(message)
  const normalized = normalizePhone(phone)
  const url = normalized
    ? `https://wa.me/${normalized}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`
  window.open(url, '_blank', 'noopener,noreferrer')
}
