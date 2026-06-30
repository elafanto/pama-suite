import { jsPDF } from 'jspdf'
import { STOCK_SEGMENT_LABELS, grandTotal, segmentTotal } from '@/services/stockStatement'
import type { Firm, StockStatement, StockStatementSegment } from '@/types/models'

function n2(v: number) {
  return (v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const SEGMENTS: StockStatementSegment[] = ['paper', 'gum', 'stitching_wire', 'consumables']

export function downloadStockStatementPdf(statement: StockStatement, firm?: Firm | null) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const PW = pdf.internal.pageSize.getWidth()
  const PH = pdf.internal.pageSize.getHeight()
  const L = 10
  const R = PW - 10
  const W = R - L
  let y = 12

  const ensurePage = (extra = 10) => {
    if (y + extra <= PH - 12) return
    pdf.addPage()
    y = 12
  }

  const lines = statement.lines || []

  pdf.setFont('helvetica', 'bold').setFontSize(15)
  pdf.text((firm?.name || 'Stock Statement').toUpperCase(), PW / 2, y, { align: 'center' })
  y += 6
  pdf.setFont('helvetica', 'bold').setFontSize(13)
  pdf.text('STOCK STATEMENT', PW / 2, y, { align: 'center' })
  y += 7

  pdf.setFont('helvetica', 'normal').setFontSize(9)
  if (firm?.addr) {
    const addrLines = pdf.splitTextToSize(firm.addr, W - 20)
    addrLines.forEach((line: string) => {
      pdf.text(line, PW / 2, y, { align: 'center' })
      y += 4
    })
  }
  y += 1

  pdf.setDrawColor(0, 0, 0)
  pdf.rect(L, y, W, 18)
  pdf.line(L + 65, y, L + 65, y + 18)
  pdf.line(L + 130, y, L + 130, y + 18)
  pdf.setFont('helvetica', 'bold').setFontSize(9)
  pdf.text('Statement No', L + 2, y + 5)
  pdf.text('Date', L + 67, y + 5)
  pdf.text('Bank / Branch', L + 132, y + 5)
  pdf.setFont('helvetica', 'normal').setFontSize(9)
  pdf.text(statement.statement_no || '-', L + 2, y + 11)
  pdf.text(statement.statement_date || '-', L + 67, y + 11)
  const bankText = [statement.bank_name, statement.branch_name].filter(Boolean).join(' / ') || '-'
  pdf.splitTextToSize(bankText, W - 133).forEach((line: string, idx: number) => {
    pdf.text(line, L + 132, y + 11 + idx * 4)
  })
  y += 24

  const drawSection = (segment: StockStatementSegment) => {
    const rows = lines.filter((line) => line.segment === segment)
    ensurePage(18 + Math.max(rows.length, 1) * 7)

    pdf.setFillColor(240, 240, 240)
    pdf.rect(L, y, W, 7, 'F')
    pdf.setFont('helvetica', 'bold').setFontSize(10)
    pdf.text(STOCK_SEGMENT_LABELS[segment], L + 2, y + 4.8)
    y += 7

    const isPaper = segment === 'paper'
    const colsP = { name: 64, bf: 20, gsm: 20, qty: 24, unit: 18, rate: 24, amount: 30 }
    const colsS = { name: 104, qty: 28, unit: 20, rate: 28, amount: 30 }

    pdf.setFont('helvetica', 'bold').setFontSize(8)
    pdf.rect(L, y, W, 6)
    if (isPaper) {
      let x = L
      pdf.text('Paper', x + 2, y + 4)
      x += colsP.name
      pdf.line(x, y, x, y + 6); pdf.text('BF', x + 2, y + 4)
      x += colsP.bf
      pdf.line(x, y, x, y + 6); pdf.text('GSM', x + 2, y + 4)
      x += colsP.gsm
      pdf.line(x, y, x, y + 6); pdf.text('Qty', x + colsP.qty - 2, y + 4, { align: 'right' })
      x += colsP.qty
      pdf.line(x, y, x, y + 6); pdf.text('Unit', x + colsP.unit / 2, y + 4, { align: 'center' })
      x += colsP.unit
      pdf.line(x, y, x, y + 6); pdf.text('Rate', x + colsP.rate - 2, y + 4, { align: 'right' })
      x += colsP.rate
      pdf.line(x, y, x, y + 6); pdf.text('Amount', x + colsP.amount - 2, y + 4, { align: 'right' })
    } else {
      let x = L
      pdf.text('Item', x + 2, y + 4)
      x += colsS.name
      pdf.line(x, y, x, y + 6); pdf.text('Qty', x + colsS.qty - 2, y + 4, { align: 'right' })
      x += colsS.qty
      pdf.line(x, y, x, y + 6); pdf.text('Unit', x + colsS.unit / 2, y + 4, { align: 'center' })
      x += colsS.unit
      pdf.line(x, y, x, y + 6); pdf.text('Rate', x + colsS.rate - 2, y + 4, { align: 'right' })
      x += colsS.rate
      pdf.line(x, y, x, y + 6); pdf.text('Amount', x + colsS.amount - 2, y + 4, { align: 'right' })
    }
    y += 6

    pdf.setFont('helvetica', 'normal').setFontSize(8)
    const printableRows = rows.length ? rows : [null]
    printableRows.forEach((line) => {
      ensurePage(7)
      pdf.rect(L, y, W, 7)
      if (isPaper) {
        let x = L
        pdf.text(line && line.segment === 'paper' ? (line.paper_name || '-') : '-', x + 2, y + 4.5)
        x += colsP.name
        pdf.line(x, y, x, y + 7); pdf.text(line && line.segment === 'paper' ? (line.bf || '-') : '-', x + 2, y + 4.5)
        x += colsP.bf
        pdf.line(x, y, x, y + 7); pdf.text(line && line.segment === 'paper' ? (line.gsm || '-') : '-', x + 2, y + 4.5)
        x += colsP.gsm
        pdf.line(x, y, x, y + 7); pdf.text(line ? n2(line.qty) : '-', x + colsP.qty - 2, y + 4.5, { align: 'right' })
        x += colsP.qty
        pdf.line(x, y, x, y + 7); pdf.text(line?.unit || '-', x + colsP.unit / 2, y + 4.5, { align: 'center' })
        x += colsP.unit
        pdf.line(x, y, x, y + 7); pdf.text(line ? n2(line.rate) : '-', x + colsP.rate - 2, y + 4.5, { align: 'right' })
        x += colsP.rate
        pdf.line(x, y, x, y + 7); pdf.text(line ? n2(line.amount) : '-', x + colsP.amount - 2, y + 4.5, { align: 'right' })
      } else {
        let x = L
        pdf.text(line && line.segment !== 'paper' ? (line.item_name || '-') : '-', x + 2, y + 4.5)
        x += colsS.name
        pdf.line(x, y, x, y + 7); pdf.text(line ? n2(line.qty) : '-', x + colsS.qty - 2, y + 4.5, { align: 'right' })
        x += colsS.qty
        pdf.line(x, y, x, y + 7); pdf.text(line?.unit || '-', x + colsS.unit / 2, y + 4.5, { align: 'center' })
        x += colsS.unit
        pdf.line(x, y, x, y + 7); pdf.text(line ? n2(line.rate) : '-', x + colsS.rate - 2, y + 4.5, { align: 'right' })
        x += colsS.rate
        pdf.line(x, y, x, y + 7); pdf.text(line ? n2(line.amount) : '-', x + colsS.amount - 2, y + 4.5, { align: 'right' })
      }
      y += 7
    })

    pdf.setFont('helvetica', 'bold').setFontSize(8.5)
    pdf.rect(L, y, W, 7)
    pdf.text(`${STOCK_SEGMENT_LABELS[segment]} Total`, R - 40, y + 4.5, { align: 'right' })
    pdf.text(n2(segmentTotal(lines, segment)), R - 2, y + 4.5, { align: 'right' })
    y += 10
  }

  SEGMENTS.forEach(drawSection)

  ensurePage(20)
  pdf.setFillColor(250, 250, 250)
  pdf.rect(L, y, W, 9, 'F')
  pdf.rect(L, y, W, 9)
  pdf.setFont('helvetica', 'bold').setFontSize(11)
  pdf.text('Grand Total', L + 3, y + 5.8)
  pdf.text(`Rs. ${n2(grandTotal(lines))}`, R - 2, y + 5.8, { align: 'right' })
  y += 12

  if (statement.remarks) {
    pdf.setFont('helvetica', 'bold').setFontSize(9)
    pdf.text('Remarks:', L, y)
    y += 4
    pdf.setFont('helvetica', 'normal').setFontSize(8.5)
    pdf.splitTextToSize(statement.remarks, W).forEach((line: string) => {
      ensurePage(4)
      pdf.text(line, L, y)
      y += 4
    })
  }

  const filename = `${statement.statement_no || 'stock-statement'}.pdf`.replace(/[^\w.-]+/g, '_')
  pdf.save(filename)
}
