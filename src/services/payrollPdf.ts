import { jsPDF } from 'jspdf'
import {
  advanceExceedsEarned,
  advanceOverEarnedAmount,
  breakdownDay,
  calcDaySalaryExpense,
  ceilRupee,
  daysInMonth,
  lineBalanceDue,
  normalizeDayHours,
  periodLabel,
  sortAdvanceItems,
  type AdvanceSortMode,
} from '@/services/payrollCalc'
import type { DayAttendance, Firm, PayrollLine } from '@/types/models'

function money(n: number) {
  return `Rs ${Math.round(Number(n) || 0).toLocaleString('en-IN')}`
}

function moneySigned(n: number) {
  const v = Math.round(Number(n) || 0)
  if (v < 0) return `- Rs ${Math.abs(v).toLocaleString('en-IN')}`
  return money(v)
}

export function payrollPayTypeLabel(payType: PayrollLine['pay_type']): string {
  return payType === 'daily_wage' ? 'DW' : 'Monthly'
}

function parsePeriod(period: string): { year: number; month: number } {
  const [y, m] = period.split('-').map(Number)
  return { year: y || new Date().getFullYear(), month: m || 1 }
}

function weekdayShort(year: number, month: number, dayKey: string): string {
  const d = Number(dayKey)
  if (!d) return ''
  return new Date(year, month - 1, d).toLocaleDateString('en-IN', { weekday: 'short' })
}

export interface PayslipDayRow {
  dayKey: string
  weekday: string
  status: string
  duty: number
  offUnpaid: number
  ot: number
  paid: number
  dayPay: number
}

/** Day-wise rows for payslip PDF (marked days only). */
export function buildPayslipDayRows(line: PayrollLine, year: number, month: number): PayslipDayRow[] {
  const hours = normalizeDayHours(line)
  const dim = daysInMonth(year, month)
  const rows: PayslipDayRow[] = []
  const staffWage = { hourly_wage: line.hourly_wage }

  for (let d = 1; d <= dim; d++) {
    const dayKey = String(d).padStart(2, '0')
    const day = hours[dayKey]
    if (!day || day.duty_hours === null) continue
    rows.push(buildOneDayRow(dayKey, day, year, month, staffWage))
  }
  return rows
}

function dayStatusLabel(day: DayAttendance, b: ReturnType<typeof breakdownDay>): string {
  if (day.kind === 'holiday') return 'Holiday'
  if (day.kind === 'sunday') return day.duty_hours === 0 ? 'Sunday off' : 'Sunday work'
  if (day.kind === 'leave') return 'Leave'
  if (day.duty_hours === 0 && !day.off_paid) return 'Absent'
  if (day.duty_hours === 0 && day.off_paid) return 'Paid off'
  if (b.unpaid > 0) return 'Partial'
  if (b.ot > 0) return 'Full+OT'
  if ((day.duty_hours ?? 0) >= 8) return 'Full'
  return 'Work'
}

function buildOneDayRow(
  dayKey: string,
  day: DayAttendance,
  year: number,
  month: number,
  staffWage: { hourly_wage: number },
): PayslipDayRow {
  const b = breakdownDay(day)
  return {
    dayKey,
    weekday: weekdayShort(year, month, dayKey),
    status: dayStatusLabel(day, b),
    duty: b.duty,
    offUnpaid: b.unpaid,
    ot: b.ot,
    paid: b.paid,
    dayPay: calcDaySalaryExpense(staffWage, day),
  }
}

function ensureSpace(pdf: jsPDF, y: number, need: number, bottom: number, onNewPage: () => number): number {
  if (y + need <= bottom) return y
  pdf.addPage()
  return onNewPage()
}

function addPayslipPage(
  pdf: jsPDF,
  line: PayrollLine,
  period: string,
  firm?: Firm | null,
  advanceRange?: { from: string; to: string },
  advanceSort: AdvanceSortMode = 'date',
) {
  const PW = pdf.internal.pageSize.getWidth()
  const PH = pdf.internal.pageSize.getHeight()
  const L = 12
  const R = PW - 12
  const W = R - L
  const bottom = PH - 14
  let y = 14

  const { year, month } = parsePeriod(period)
  const dayRows = buildPayslipDayRows(line, year, month)
  const hourly = Math.max(0, Number(line.hourly_wage) || 0)
  const otPay = ceilRupee((line.total_ot_hours || 0) * hourly)

  const drawContinuingHeader = (): number => {
    let hy = 12
    pdf.setFont('helvetica', 'bold').setFontSize(10)
    pdf.text(`${firm?.name || 'Firm'} — ${line.staff_name}`, L, hy)
    hy += 5
    pdf.setFont('helvetica', 'normal').setFontSize(8)
    pdf.text(`Day-wise detail continued — ${periodLabel(period)}`, L, hy)
    hy += 6
    return hy
  }

  // —— Summary header ——
  pdf.setFont('helvetica', 'bold').setFontSize(14)
  pdf.text((firm?.name || 'Firm').toUpperCase(), PW / 2, y, { align: 'center' })
  y += 5
  pdf.setFont('helvetica', 'normal').setFontSize(8)
  if (firm?.addr) {
    pdf.text(firm.addr, PW / 2, y, { align: 'center', maxWidth: W - 10 })
    y += 4
  }
  if (firm?.phone) {
    pdf.text(`Phone: ${firm.phone}`, PW / 2, y, { align: 'center' })
    y += 4
  }

  pdf.setFont('helvetica', 'bold').setFontSize(11)
  pdf.text(`PAYSLIP — ${periodLabel(period).toUpperCase()}`, PW / 2, y + 1, { align: 'center' })
  y += 5
  if (advanceRange?.from && advanceRange?.to) {
    pdf.setFont('helvetica', 'normal').setFontSize(7)
    pdf.text(`Advances ${advanceRange.from} to ${advanceRange.to}`, PW / 2, y, { align: 'center' })
    y += 4
  }
  y += 2

  pdf.setFont('helvetica', 'normal').setFontSize(9)
  pdf.text(`Employee: ${line.staff_name}`, L, y)
  pdf.text(`Type: ${payrollPayTypeLabel(line.pay_type)}`, R, y, { align: 'right' })
  y += 5
  pdf.text(`Monthly: ${money(line.monthly_amount)}`, L, y)
  pdf.text(`Daily: ${money(line.daily_wage)}  |  Hourly: ${money(line.hourly_wage)}`, R, y, { align: 'right' })
  y += 5
  pdf.text(`Duty: ${line.total_duty_hours || 0}h`, L, y)
  pdf.text(`Paid: ${line.total_paid_hours || 0}h`, L + 40, y)
  pdf.text(`Off unpaid: ${line.total_off_unpaid_hours || 0}h`, L + 80, y)
  pdf.text(`OT: ${line.total_ot_hours || 0}h (${money(otPay)})`, R, y, { align: 'right' })
  y += 5
  pdf.setFontSize(8)
  pdf.text(
    `Days: ${line.days_present} present, ${line.days_half} partial, ${line.days_absent} absent, ${line.days_leave} leave`,
    L,
    y,
  )
  y += 6

  const moneyRows: Array<[string, string, boolean?]> = [['Gross earned', money(line.earned)]]
  if (line.advance_items?.length) {
    const items = sortAdvanceItems(line.advance_items, advanceSort)
    for (const adv of items) {
      const label = adv.narration
        ? `Advance ${adv.date} (${adv.narration})`
        : `Advance ${adv.date}`
      moneyRows.push([label, `- ${money(adv.amount)}`])
    }
    if (items.length > 1) {
      const advTotal = items.reduce((s, a) => s + a.amount, 0)
      moneyRows.push(['Total advance', `- ${money(advTotal)}`, true])
    }
  } else if (line.advance_deduction) {
    moneyRows.push(['Advance deduction', `- ${money(line.advance_deduction)}`])
  }
  if (advanceExceedsEarned(line)) {
    moneyRows.push(['Advance exceeds salary', `${money(advanceOverEarnedAmount(line))} recovery`, true])
  }
  if (line.other_deduction) moneyRows.push(['Other deduction', `- ${money(line.other_deduction)}`])
  moneyRows.push(['Net pay', moneySigned(line.net_pay), true])
  if (line.paid_amount) moneyRows.push(['Paid', money(line.paid_amount)])
  const balance = lineBalanceDue(line)
  if (balance !== 0) {
    moneyRows.push([balance < 0 ? 'Staff recovery due' : 'Balance due', moneySigned(balance), true])
  }

  const rowH = 7
  const labelW = 110
  const valueW = W - labelW
  pdf.setDrawColor(203, 213, 225)
  for (const [label, value, bold] of moneyRows) {
    y = ensureSpace(pdf, y, rowH + 2, bottom, drawContinuingHeader)
    pdf.rect(L, y, labelW, rowH)
    pdf.rect(L + labelW, y, valueW, rowH)
    pdf.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(bold ? 9 : 8)
    pdf.text(label, L + 2, y + 5)
    pdf.text(value, R - 2, y + 5, { align: 'right' })
    y += rowH
  }

  // —— Day-wise table ——
  y += 6
  y = ensureSpace(pdf, y, 20, bottom, drawContinuingHeader)
  pdf.setFont('helvetica', 'bold').setFontSize(10)
  pdf.text('Day-wise salary detail', L, y)
  y += 4
  pdf.setFont('helvetica', 'normal').setFontSize(7)
  pdf.setTextColor(100)
  pdf.text('Off unpaid = baki hours. Day Rs = paid hours x hourly (approx). Gross earned monthly formula se.', L, y)
  pdf.setTextColor(0)
  y += 5

  const cols = {
    date: L,
    status: L + 22,
    duty: L + 52,
    off: L + 68,
    ot: L + 90,
    paid: L + 108,
    pay: R,
  }
  const headH = 6
  const bodyH = 5.2

  const drawTableHeader = (atY: number): number => {
    pdf.setFillColor(241, 245, 249)
    pdf.rect(L, atY, W, headH, 'F')
    pdf.setDrawColor(203, 213, 225)
    pdf.rect(L, atY, W, headH)
    pdf.setFont('helvetica', 'bold').setFontSize(7)
    pdf.text('Date', cols.date + 1, atY + 4)
    pdf.text('Status', cols.status, atY + 4)
    pdf.text('Duty', cols.duty, atY + 4, { align: 'right' })
    pdf.text('Off unpaid', cols.off, atY + 4, { align: 'right' })
    pdf.text('OT', cols.ot, atY + 4, { align: 'right' })
    pdf.text('Paid h', cols.paid, atY + 4, { align: 'right' })
    pdf.text('Day Rs', cols.pay - 1, atY + 4, { align: 'right' })
    return atY + headH
  }

  if (!dayRows.length) {
    y = ensureSpace(pdf, y, 10, bottom, drawContinuingHeader)
    pdf.setFont('helvetica', 'italic').setFontSize(8)
    pdf.text('Is month me koi din mark nahi.', L, y)
    y += 6
  } else {
    y = drawTableHeader(y)
    let sumDuty = 0
    let sumOff = 0
    let sumOt = 0
    let sumPaid = 0
    let sumPay = 0

    for (const row of dayRows) {
      y = ensureSpace(pdf, y, bodyH + 1, bottom, () => {
        const ny = drawContinuingHeader()
        return drawTableHeader(ny)
      })

      sumDuty += row.duty
      sumOff += row.offUnpaid
      sumOt += row.ot
      sumPaid += row.paid
      sumPay += row.dayPay

      pdf.setDrawColor(226, 232, 240)
      pdf.line(L, y + bodyH, R, y + bodyH)
      pdf.setFont('helvetica', 'normal').setFontSize(7)
      pdf.text(`${row.dayKey} ${row.weekday}`, cols.date + 1, y + 3.6)
      pdf.text(row.status, cols.status, y + 3.6)
      pdf.text(String(row.duty), cols.duty, y + 3.6, { align: 'right' })
      pdf.text(row.offUnpaid ? String(row.offUnpaid) : '—', cols.off, y + 3.6, { align: 'right' })
      pdf.text(row.ot ? String(row.ot) : '—', cols.ot, y + 3.6, { align: 'right' })
      pdf.text(String(row.paid), cols.paid, y + 3.6, { align: 'right' })
      pdf.text(row.dayPay ? money(row.dayPay) : '—', cols.pay - 1, y + 3.6, { align: 'right' })
      y += bodyH
    }

    y = ensureSpace(pdf, y, bodyH + 2, bottom, () => {
      const ny = drawContinuingHeader()
      return drawTableHeader(ny)
    })
    pdf.setFillColor(248, 250, 252)
    pdf.rect(L, y, W, bodyH, 'F')
    pdf.setFont('helvetica', 'bold').setFontSize(7)
    pdf.text('TOTAL', cols.date + 1, y + 3.6)
    pdf.text(String(sumDuty), cols.duty, y + 3.6, { align: 'right' })
    pdf.text(String(sumOff), cols.off, y + 3.6, { align: 'right' })
    pdf.text(String(sumOt), cols.ot, y + 3.6, { align: 'right' })
    pdf.text(String(sumPaid), cols.paid, y + 3.6, { align: 'right' })
    pdf.text(money(sumPay), cols.pay - 1, y + 3.6, { align: 'right' })
    y += bodyH + 4
  }

  y = ensureSpace(pdf, y, 10, bottom, drawContinuingHeader)
  pdf.setFont('helvetica', 'normal').setFontSize(8)
  pdf.text(`Generated on ${new Date().toLocaleString('en-IN')}`, L, y)
  pdf.text('Authorized Signatory', R, y, { align: 'right' })
}

export function downloadPayrollPayslipsPdf(
  lines: PayrollLine[],
  period: string,
  firm?: Firm | null,
  filename?: string,
  advanceRange?: { from: string; to: string },
  advanceSort: AdvanceSortMode = 'date',
) {
  const validLines = lines.filter(Boolean)
  if (!validLines.length) return

  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  validLines.forEach((line, idx) => {
    if (idx > 0) pdf.addPage()
    addPayslipPage(pdf, line, period, firm, advanceRange, advanceSort)
  })
  pdf.save(filename || `Payslips_Daywise_${period}_${validLines.length}.pdf`)
}
