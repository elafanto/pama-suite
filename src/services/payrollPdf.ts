import { jsPDF } from 'jspdf'
import { advanceExceedsEarned, advanceOverEarnedAmount, lineBalanceDue, periodLabel, sortAdvanceItems, type AdvanceSortMode } from '@/services/payrollCalc'
import type { Firm, PayrollLine } from '@/types/models'

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
  const L = 15
  const W = PW - 30
  let y = 16

  pdf.setDrawColor(148, 163, 184)
  pdf.setLineWidth(0.3)
  pdf.roundedRect(L, 10, W, PH - 20, 3, 3)

  pdf.setFont('helvetica', 'bold').setFontSize(15)
  pdf.text((firm?.name || 'Firm').toUpperCase(), PW / 2, y, { align: 'center' })
  y += 6
  pdf.setFont('helvetica', 'normal').setFontSize(9)
  if (firm?.addr) {
    pdf.text(firm.addr, PW / 2, y, { align: 'center', maxWidth: W - 20 })
    y += 5
  }
  if (firm?.phone) {
    pdf.text(`Phone: ${firm.phone}`, PW / 2, y, { align: 'center' })
    y += 5
  }

  pdf.setFont('helvetica', 'bold').setFontSize(12)
  pdf.text(`PAYSLIP - ${periodLabel(period).toUpperCase()}`, PW / 2, y + 2, { align: 'center' })
  y += 6
  if (advanceRange?.from && advanceRange?.to) {
    pdf.setFont('helvetica', 'normal').setFontSize(8)
    pdf.text(`Advances ${advanceRange.from} to ${advanceRange.to}`, PW / 2, y, { align: 'center' })
    y += 4
  }
  y += 4

  pdf.setFont('helvetica', 'normal').setFontSize(10)
  pdf.text(`Employee: ${line.staff_name}`, L + 4, y)
  pdf.text(`Type: ${payrollPayTypeLabel(line.pay_type)}`, PW - L - 4, y, { align: 'right' })
  y += 6
  pdf.text(`Duty Hours: ${line.total_duty_hours || 0}`, L + 4, y)
  pdf.text(`Paid Hours: ${line.total_paid_hours || 0}`, PW - L - 4, y, { align: 'right' })
  y += 6
  pdf.text(`Off Unpaid: ${line.total_off_unpaid_hours || 0} hr`, L + 4, y)
  pdf.text(`OT Hours: ${line.total_ot_hours || 0}`, PW - L - 4, y, { align: 'right' })
  y += 6
  pdf.text(
    `Days: ${line.days_present} present, ${line.days_half} partial, ${line.days_absent} absent, ${line.days_leave} leave`,
    L + 4,
    y,
  )
  y += 8

  const rows: Array<[string, string, boolean?]> = [
    ['Gross earned', money(line.earned)],
  ]
  if (line.advance_items?.length) {
    const items = sortAdvanceItems(line.advance_items, advanceSort)
    for (const adv of items) {
      const label = adv.narration
        ? `Advance ${adv.date} (${adv.narration})`
        : `Advance ${adv.date}`
      rows.push([label, `- ${money(adv.amount)}`])
    }
    if (items.length > 1) {
      const advTotal = items.reduce((s, a) => s + a.amount, 0)
      rows.push(['Total advance', `- ${money(advTotal)}`, true])
    }
  } else if (line.advance_deduction) {
    rows.push(['Advance deduction', `- ${money(line.advance_deduction)}`])
  }
  if (advanceExceedsEarned(line)) {
    rows.push(['Advance exceeds salary', `${money(advanceOverEarnedAmount(line))} recovery`, true])
  }
  if (line.other_deduction) rows.push(['Other deduction', `- ${money(line.other_deduction)}`])
  rows.push(['Net pay', moneySigned(line.net_pay), true])
  if (line.paid_amount) rows.push(['Paid', money(line.paid_amount)])
  const balance = lineBalanceDue(line)
  if (balance !== 0) {
    rows.push([balance < 0 ? 'Staff recovery due' : 'Balance due', moneySigned(balance), true])
  }

  const rowH = 10
  const labelW = 95
  const valueW = W - labelW
  pdf.setDrawColor(203, 213, 225)
  for (const [label, value, bold] of rows) {
    pdf.rect(L, y, labelW, rowH)
    pdf.rect(L + labelW, y, valueW, rowH)
    pdf.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(bold ? 11 : 10)
    pdf.text(label, L + 3, y + 6.5)
    pdf.text(value, PW - L - 3, y + 6.5, { align: 'right' })
    y += rowH
  }

  y += 8
  pdf.setFont('helvetica', 'normal').setFontSize(9)
  pdf.text(`Generated on ${new Date().toLocaleString('en-IN')}`, L + 2, y)
  pdf.text('Authorized Signatory', PW - L - 2, y, { align: 'right' })
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
  pdf.save(filename || `Payslips_${period}_${validLines.length}.pdf`)
}
