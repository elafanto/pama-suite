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
  const paperTotal = segmentTotal(lines, 'paper')
  const gumTotal = segmentTotal(lines, 'gum')
  const wireTotal = segmentTotal(lines, 'stitching_wire')
  const consumablesTotal = segmentTotal(lines, 'consumables')
  const stockGrandTotal = grandTotal(lines)

  pdf.setFont('helvetica', 'bold').setFontSize(14)
  const bankLines = pdf.splitTextToSize((statement.bank_name || 'UNION BANK OF INDIA').toUpperCase(), W)
  bankLines.forEach((line: string) => {
    pdf.text(line, PW / 2, y, { align: 'center' })
    y += 6
  })
  pdf.setFont('helvetica', 'bold').setFontSize(12)
  pdf.text('STATEMENT OF STOCK POSITION', PW / 2, y, { align: 'center' })
  y += 7

  pdf.setFont('helvetica', 'normal').setFontSize(8.5)
  const accountLines = pdf.splitTextToSize(`Name of the Account: ${firm?.name || '-'}`, 98)
  const branchLines = pdf.splitTextToSize(`Branch: ${statement.branch_name || '-'}`, 82)
  const headerRows = Math.max(accountLines.length, branchLines.length)
  accountLines.forEach((line: string, idx: number) => pdf.text(line, L, y + idx * 4))
  branchLines.forEach((line: string, idx: number) => pdf.text(line, L + 105, y + idx * 4))
  y += headerRows * 4 + 0.5
  const officeAddrLines = pdf.splitTextToSize(`Address of Contact Office: ${firm?.addr || '-'}`, W)
  officeAddrLines.forEach((line: string) => {
    pdf.text(line, L, y)
    y += 4
  })
  pdf.text(`Tel No: ${firm?.phone || '-'}`, L, y)
  y += 4.5
  const contactLines = pdf.splitTextToSize(`Contact Person: ${statement.remarks || 'Authorized Signatory'}`, W)
  contactLines.forEach((line: string) => {
    pdf.text(line, L, y)
    y += 4.5
  })
  const asOnLines = pdf.splitTextToSize(
    `We give below the particulars of goods held in your name on your account as on ${statement.statement_date || '-'}`,
    W,
  )
  asOnLines.forEach((line: string) => {
    pdf.text(line, L, y)
    y += 4.5
  })

  const cDesc = 88
  const cStore = 35
  const cPkg = 22
  const cQty = 22
  const cRate = 20

  pdf.rect(L, y, W, 12)
  let x = L
  pdf.line(x + cDesc, y, x + cDesc, y + 12)
  pdf.line(x + cDesc + cStore, y, x + cDesc + cStore, y + 12)
  pdf.line(x + cDesc + cStore + cPkg, y, x + cDesc + cStore + cPkg, y + 12)
  pdf.line(x + cDesc + cStore + cPkg + cQty, y, x + cDesc + cStore + cPkg + cQty, y + 12)
  pdf.line(x + cDesc + cStore + cPkg + cQty + cRate, y, x + cDesc + cStore + cPkg + cQty + cRate, y + 12)
  pdf.setFont('helvetica', 'bold').setFontSize(7.5)
  pdf.text('Description of Material', L + 2, y + 4)
  pdf.text('(Major items to be specified individually / divisionwise)', L + 2, y + 8.5)
  pdf.text('Place of Storage', L + cDesc + 2, y + 6)
  pdf.text('No. of Package', L + cDesc + cStore + 2, y + 6)
  pdf.text('Quantity', L + cDesc + cStore + cPkg + 2, y + 6)
  pdf.text('Rate', L + cDesc + cStore + cPkg + cQty + 2, y + 6)
  pdf.text('Value', R - 2, y + 6, { align: 'right' })
  y += 12

  const drawSummaryRow = (label: string, value?: number | null, bold = false) => {
    ensurePage(7)
    pdf.rect(L, y, W, 7)
    if (bold) pdf.setFont('helvetica', 'bold').setFontSize(8.5)
    else pdf.setFont('helvetica', 'normal').setFontSize(8.2)
    pdf.text(label, L + 2, y + 4.5)
    if (value !== undefined && value !== null) pdf.text(`Rs ${n2(value)}`, R - 2, y + 4.5, { align: 'right' })
    y += 7
  }

  drawSummaryRow('Raw Material*', undefined, true)
  drawSummaryRow('Imported', 0)
  drawSummaryRow('Indigenous', paperTotal)
  drawSummaryRow('SUBTOTAL', paperTotal, true)
  drawSummaryRow('ii) STOCK IN PROCESS @', gumTotal)
  drawSummaryRow('FINISHED GOODS *', consumablesTotal)
  drawSummaryRow('STORES / SPARES *', wireTotal)
  drawSummaryRow('I. GRAND TOTAL', stockGrandTotal, true)
  drawSummaryRow('Stock Procured under LC/LG But not paid', 0)
  drawSummaryRow("Other unpaid Stocks (Under Creditors / Supplier's Credit / Co-acceptance)", 0)
  drawSummaryRow('Total of Unpaid Stocks (A+B)', 0, true)
  drawSummaryRow('Slow Moving / Dead Stocks', 0)
  drawSummaryRow('Stock meant for Packing Credit', 0)
  drawSummaryRow('II. TOTAL STOCK to be excluded for calculation of DRAWING POWER', 0, true)
  drawSummaryRow('III. Stock eligible for calculation of DRAWING POWER (I - II)', stockGrandTotal, true)

  y += 4
  pdf.setFont('helvetica', 'normal').setFontSize(7.5)
  pdf.text('* Cost or Market Value whichever is less. @ Furnish basis of valuation separately.', L, y)
  y += 6

  const drawSection = (segment: StockStatementSegment) => {
    const rows = lines.filter((line) => line.segment === segment)
    ensurePage(18 + Math.max(rows.length, 1) * 7)

    pdf.setFillColor(240, 240, 240)
    pdf.rect(L, y, W, 7, 'F')
    pdf.setFont('helvetica', 'bold').setFontSize(10)
    pdf.text(`${STOCK_SEGMENT_LABELS[segment]} - Details`, L + 2, y + 4.8)
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
      const name = isPaper
        ? (line && line.segment === 'paper' ? (line.paper_name || '-') : '-')
        : (line && line.segment !== 'paper' ? (line.item_name || '-') : '-')
      const nameW = (isPaper ? colsP.name : colsS.name) - 4
      const nameLines = pdf.splitTextToSize(name, nameW) as string[]
      const rowH = Math.max(7, nameLines.length * 3.5 + 2)
      ensurePage(rowH)
      pdf.rect(L, y, W, rowH)
      const textY = y + 4.5
      if (isPaper) {
        let x = L
        nameLines.forEach((nl: string, idx: number) => pdf.text(nl, x + 2, textY + idx * 3.5))
        x += colsP.name
        pdf.line(x, y, x, y + rowH); pdf.text(line && line.segment === 'paper' ? (line.bf || '-') : '-', x + 2, textY)
        x += colsP.bf
        pdf.line(x, y, x, y + rowH); pdf.text(line && line.segment === 'paper' ? (line.gsm || '-') : '-', x + 2, textY)
        x += colsP.gsm
        pdf.line(x, y, x, y + rowH); pdf.text(line ? n2(line.qty) : '-', x + colsP.qty - 2, textY, { align: 'right' })
        x += colsP.qty
        pdf.line(x, y, x, y + rowH); pdf.text(line?.unit || '-', x + colsP.unit / 2, textY, { align: 'center' })
        x += colsP.unit
        pdf.line(x, y, x, y + rowH); pdf.text(line ? n2(line.rate) : '-', x + colsP.rate - 2, textY, { align: 'right' })
        x += colsP.rate
        pdf.line(x, y, x, y + rowH); pdf.text(line ? n2(line.amount) : '-', x + colsP.amount - 2, textY, { align: 'right' })
      } else {
        let x = L
        nameLines.forEach((nl: string, idx: number) => pdf.text(nl, x + 2, textY + idx * 3.5))
        x += colsS.name
        pdf.line(x, y, x, y + rowH); pdf.text(line ? n2(line.qty) : '-', x + colsS.qty - 2, textY, { align: 'right' })
        x += colsS.qty
        pdf.line(x, y, x, y + rowH); pdf.text(line?.unit || '-', x + colsS.unit / 2, textY, { align: 'center' })
        x += colsS.unit
        pdf.line(x, y, x, y + rowH); pdf.text(line ? n2(line.rate) : '-', x + colsS.rate - 2, textY, { align: 'right' })
        x += colsS.rate
        pdf.line(x, y, x, y + rowH); pdf.text(line ? n2(line.amount) : '-', x + colsS.amount - 2, textY, { align: 'right' })
      }
      y += rowH
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
