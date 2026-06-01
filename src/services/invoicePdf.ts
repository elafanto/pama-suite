import { jsPDF } from 'jspdf'
import { getStateName, getStateCode } from '@/services/gst'
import { numberToWords } from '@/services/numberToWords'
import { fmtDate } from '@/services/boxcalcUi'
import type { Firm, Invoice, Party } from '@/types/models'

function n2(n: number) {
  return (n || 0).toFixed(2)
}

function isInterGst(gstType: string | undefined) {
  return gstType === 'inter' || gstType === 'IGST'
}

function firmBankText(f: Firm): string {
  const lines: string[] = []
  if (f.bank_name) lines.push(`Bank Name: ${f.bank_name}`)
  if (f.bank_acno) lines.push(`A/c No: ${f.bank_acno}`)
  if (f.bank_ifsc) lines.push(`IFSC: ${f.bank_ifsc}`)
  return lines.length ? lines.join('\n') : '-'
}

export function resolveFirmSignature(firm: Firm): string {
  if (firm.signature) return firm.signature
  return localStorage.getItem(`pama_firm_signature_${firm.id}`) || ''
}

interface PdfFirm {
  name: string
  addr: string
  pin: string
  phone: string
  email: string
  gst: string
  state: string
  bank: string
  decl: string
  terms: string
  signature: string
}

interface PdfBill {
  docType: string
  billNo: string
  date: string
  ref?: string
  payment?: string
  payStatus: string
  amtPaid: number
  custName: string
  custDetails: Partial<Party>
  sameAsBuyer?: boolean
  ship?: Invoice['ship']
  dispatch?: string
  lr?: string
  vehicle?: string
  eway?: string
  dest?: string
  distance?: number
  gstType: string
  items: Invoice['items']
  taxBuckets?: Record<string, { taxable: number; tax: number }>
  sub: number
  roundOff: number
  grandTotal: number
}

function toPdfFirm(firm: Firm): PdfFirm {
  return {
    name: firm.name || 'Firm',
    addr: firm.addr || '',
    pin: firm.pin || '',
    phone: firm.phone || '',
    email: firm.email || '',
    gst: firm.gst || '',
    state: firm.state || '',
    bank: firmBankText(firm),
    decl: firm.decl || 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
    terms: firm.terms || '',
    signature: resolveFirmSignature(firm),
  }
}

function toPdfBill(inv: Invoice): PdfBill {
  const buckets: Record<string, { taxable: number; tax: number }> = {}
  if (inv.taxBuckets) {
    for (const [k, v] of Object.entries(inv.taxBuckets)) {
      buckets[String(k)] = v
    }
  }
  return {
    docType: (inv.doc_type || 'INVOICE').toUpperCase(),
    billNo: inv.bill_no,
    date: inv.date,
    ref: inv.ref,
    payment: inv.payment,
    payStatus: inv.pay_status,
    amtPaid: inv.amt_paid || 0,
    custName: inv.party_name,
    custDetails: inv.party_snapshot || {},
    sameAsBuyer: inv.sameAsBuyer,
    ship: inv.ship,
    dispatch: inv.dispatch,
    lr: inv.lr,
    vehicle: inv.vehicle,
    eway: inv.eway,
    dest: inv.dest,
    distance: inv.distance,
    gstType: inv.gst_type || 'intra',
    items: inv.items || [],
    taxBuckets: buckets,
    sub: inv.sub || 0,
    roundOff: inv.round_off || 0,
    grandTotal: inv.grand_total || 0,
  }
}

function pdfFilename(inv: Invoice): string {
  const docPrefix =
    inv.doc_type === 'CREDIT_NOTE' ? 'CN' : inv.doc_type === 'DEBIT_NOTE' ? 'DN' : 'Invoice'
  const safeName = (inv.party_name || '').replace(/[^a-z0-9]/gi, '_').substring(0, 20)
  return `${docPrefix}_${inv.bill_no}_${safeName}.pdf`
}

function drawInvoiceOnPDF(pdf: jsPDF, b: PdfBill, f: PdfFirm, copyLabel = '', copySub = '') {
  const PW = 210
  const PH = 297
  const M = 6
  const P = 4
  const L = M + P
  const R = PW - M - P
  const W = R - L
  let y = M + P

  pdf.setLineWidth(0.6)
  pdf.setDrawColor(0, 0, 0)
  pdf.rect(M, M, PW - 2 * M, PH - 2 * M)

  if (copyLabel) {
    const badgeW = 42
    const badgeH = 8
    const badgeX = R - badgeW
    const badgeY = M
    pdf.setFillColor(30, 58, 95)
    pdf.rect(badgeX, badgeY, badgeW, badgeH, 'F')
    pdf.setFont('helvetica', 'bold').setFontSize(7.5)
    pdf.setTextColor(255, 255, 255)
    pdf.text(copyLabel, badgeX + badgeW / 2, badgeY + 3.2, { align: 'center' })
    pdf.setFont('helvetica', 'normal').setFontSize(6)
    pdf.text(copySub, badgeX + badgeW / 2, badgeY + 6.2, { align: 'center' })
    pdf.setTextColor(0, 0, 0)
  }

  const docTitle =
    b.docType === 'CREDIT_NOTE'
      ? 'CREDIT NOTE'
      : b.docType === 'DEBIT_NOTE'
        ? 'DEBIT NOTE'
        : b.docType === 'BILL_OF_SUPPLY'
          ? 'BILL OF SUPPLY'
          : 'TAX INVOICE'

  pdf.setFont('helvetica', 'bold').setFontSize(15)
  pdf.text(String(f.name || '').toUpperCase(), PW / 2, y + 5, { align: 'center' })
  y += 6

  pdf.setFont('helvetica', 'normal').setFontSize(9)
  const addrLines = pdf.splitTextToSize(f.addr || '', W - 30)
  addrLines.forEach((line: string) => {
    pdf.text(line, PW / 2, y + 3, { align: 'center' })
    y += 3.5
  })
  const contactLine = `PIN: ${f.pin || '-'}${f.phone ? ' | Mob: ' + f.phone : ''} | Email: ${f.email || '-'}`
  pdf.text(contactLine, PW / 2, y + 3, { align: 'center' })
  y += 4
  pdf.setFont('helvetica', 'bold').setFontSize(9)
  pdf.text(
    `GSTIN: ${f.gst || '-'}  |  State: ${getStateName(f.gst)} (${getStateCode(f.gst) || f.state || '-'})`,
    PW / 2,
    y + 3,
    { align: 'center' },
  )
  y += 5

  pdf.setFillColor(0, 0, 0)
  pdf.rect(L, y, W, 6, 'F')
  pdf.setFont('helvetica', 'bold').setFontSize(12)
  pdf.setTextColor(255, 255, 255)
  pdf.text(docTitle, PW / 2, y + 4.2, { align: 'center' })
  pdf.setTextColor(0, 0, 0)
  y += 6
  pdf.line(L, y, R, y)

  const colW = W / 3
  const buyer = b.custDetails || {}

  pdf.line(L + colW, y, L + colW, y + 30)
  pdf.line(L + 2 * colW, y, L + 2 * colW, y + 30)

  pdf.setFont('helvetica', 'bold').setFontSize(8)
  pdf.text('BILL TO (BUYER):', L + 1, y + 4)
  pdf.setFont('helvetica', 'bold').setFontSize(9)
  pdf.text(b.custName || '', L + 1, y + 8)
  pdf.setFont('helvetica', 'normal').setFontSize(8)
  let ty = y + 11
  const buyerAddrLines = pdf.splitTextToSize(buyer.addr || '', colW - 2)
  buyerAddrLines.forEach((line: string) => {
    pdf.text(line, L + 1, ty)
    ty += 3.2
  })
  const bAddrL = (buyer.addr || '').toLowerCase()
  if (buyer.city && !bAddrL.includes(buyer.city.toLowerCase())) {
    pdf.text(`${buyer.city}${buyer.pin ? ' - ' + buyer.pin : ''}`, L + 1, ty)
    ty += 3.2
  } else if (buyer.pin && !bAddrL.includes(buyer.pin)) {
    pdf.text(buyer.pin, L + 1, ty)
    ty += 3.2
  }
  if (buyer.is_consumer) {
    pdf.setFont('helvetica', 'bold').setFontSize(7.5)
    pdf.setTextColor(22, 163, 74)
    pdf.text('Consumer (B2C)', L + 1, ty)
    ty += 3.2
    pdf.setTextColor(0, 0, 0)
    pdf.setFont('helvetica', 'normal').setFontSize(8)
  } else if (buyer.gst) {
    pdf.text(`GSTIN: ${buyer.gst}`, L + 1, ty)
    ty += 3.2
  }
  pdf.text(
    `State: ${getStateName(buyer.gst || buyer.state)} (${getStateCode(buyer.gst) || buyer.state || '-'})`,
    L + 1,
    ty,
  )

  pdf.setFont('helvetica', 'bold').setFontSize(8)
  pdf.text('SHIP TO (CONSIGNEE):', L + colW + 1, y + 4)
  ty = y + 8
  const ship = b.sameAsBuyer !== false ? null : b.ship || null
  if (ship) {
    pdf.setFont('helvetica', 'bold').setFontSize(9)
    pdf.text(ship.name || b.custName || '', L + colW + 1, ty)
    pdf.setFont('helvetica', 'normal').setFontSize(8)
    ty += 3
    const shipAddrLines = pdf.splitTextToSize(ship.addr || '', colW - 2)
    shipAddrLines.forEach((line: string) => {
      pdf.text(line, L + colW + 1, ty)
      ty += 3.2
    })
    const sAddrL = (ship.addr || '').toLowerCase()
    if (ship.city && !sAddrL.includes(ship.city.toLowerCase())) {
      pdf.text(`${ship.city}${ship.pin ? ' - ' + ship.pin : ''}`, L + colW + 1, ty)
      ty += 3.2
    } else if (ship.pin && !sAddrL.includes(ship.pin)) {
      pdf.text(ship.pin, L + colW + 1, ty)
      ty += 3.2
    }
    if (ship.gstin) {
      pdf.text(`GSTIN: ${ship.gstin}`, L + colW + 1, ty)
      ty += 3.2
    }
    pdf.text(
      `State: ${getStateName(ship.gstin || ship.state)} (${getStateCode(ship.gstin) || ship.state || '-'})`,
      L + colW + 1,
      ty,
    )
  } else {
    pdf.setFont('helvetica', 'italic').setFontSize(8)
    pdf.text('— Same as Buyer Address —', L + colW + 1, ty)
  }

  pdf.setFont('helvetica', 'bold').setFontSize(8)
  pdf.text('INVOICE DETAILS:', L + 2 * colW + 1, y + 4)
  pdf.setFont('helvetica', 'normal').setFontSize(8)
  ty = y + 8
  const infoLines = [
    `Invoice No: ${b.billNo}`,
    `Date: ${fmtDate(b.date)}`,
    `Ref: ${b.ref || '-'}`,
    `Payment: ${b.payment || '-'}`,
    `Status: ${b.payStatus}${b.payStatus === 'PARTIAL' ? ` (₹${n2(b.amtPaid)})` : ''}`,
  ]
  infoLines.forEach((line) => {
    pdf.text(line, L + 2 * colW + 1, ty)
    ty += 3.5
  })

  y += 30
  pdf.line(L, y, R, y)

  pdf.setFont('helvetica', 'normal').setFontSize(8)
  pdf.text(`Dispatch: ${b.dispatch || '-'}`, L + 1, y + 4)
  pdf.text(`LR/RR: ${b.lr || '-'}`, L + colW + 1, y + 4)
  pdf.text(`Vehicle: ${b.vehicle || '-'}`, L + 2 * colW + 1, y + 4)
  pdf.line(L + colW, y, L + colW, y + 11)
  pdf.line(L + 2 * colW, y, L + 2 * colW, y + 11)
  y += 5
  pdf.line(L, y, R, y)
  pdf.text(`E-Way: ${b.eway || '-'}`, L + 1, y + 4)
  pdf.text(`Destination: ${b.dest || '-'}`, L + colW + 1, y + 4)
  pdf.text(`Distance: ${b.distance || 0} km`, L + 2 * colW + 1, y + 4)
  pdf.line(L + colW, y, L + colW, y + 6)
  pdf.line(L + 2 * colW, y, L + 2 * colW, y + 6)
  y += 6
  pdf.line(L, y, R, y)

  const cSl = 8
  const cHsn = 18
  const cQty = 20
  const cRate = 20
  const cGstPct = 12
  const cGstAmt = 20
  const cAmt = 24
  const cDesc = W - cSl - cHsn - cQty - cRate - cGstPct - cGstAmt - cAmt
  const colsX = [
    L,
    L + cSl,
    L + cSl + cDesc,
    L + cSl + cDesc + cHsn,
    L + cSl + cDesc + cHsn + cQty,
    L + cSl + cDesc + cHsn + cQty + cRate,
    L + cSl + cDesc + cHsn + cQty + cRate + cGstPct,
    L + cSl + cDesc + cHsn + cQty + cRate + cGstPct + cGstAmt,
    R,
  ]

  pdf.setFillColor(240, 240, 240)
  pdf.rect(L, y, W, 6, 'F')
  pdf.setFont('helvetica', 'bold').setFontSize(8)
  pdf.text('Sl', L + cSl / 2, y + 4, { align: 'center' })
  pdf.text('Description of Goods', L + cSl + 2, y + 4)
  pdf.text('HSN', colsX[2] + cHsn / 2, y + 4, { align: 'center' })
  pdf.text('Qty/Unit', colsX[3] + cQty / 2, y + 4, { align: 'center' })
  pdf.text('Rate', colsX[4] + cRate - 1, y + 4, { align: 'right' })
  pdf.text('GST%', colsX[5] + cGstPct / 2, y + 4, { align: 'center' })
  pdf.text('GST Amt', colsX[6] + cGstAmt - 1, y + 4, { align: 'right' })
  pdf.text('Amount', R - 1, y + 4, { align: 'right' })
  for (let i = 1; i < colsX.length - 1; i++) pdf.line(colsX[i], y, colsX[i], y + 6)
  y += 6
  pdf.line(L, y, R, y)

  pdf.setFont('helvetica', 'normal').setFontSize(8)
  let rowStartY = y
  const items = b.items || []

  items.forEach((r, i) => {
    const specs = [r.size, r.gsm ? r.gsm + 'gsm' : '', r.bf ? r.bf + 'bf' : '', r.extra]
      .filter(Boolean)
      .join(' | ')
    const descMain = String(r.name || '')
    const nameLines = pdf.splitTextToSize(descMain, cDesc - 4)
    const specLines = specs ? pdf.splitTextToSize(specs, cDesc - 4) : []
    const lineCount = Math.max(1, nameLines.length + specLines.length)
    const rowH = Math.max(7, 3.2 * lineCount + 3)

    if (y + rowH > PH - M - 90) {
      for (let ci = 1; ci < colsX.length - 1; ci++) pdf.line(colsX[ci], rowStartY, colsX[ci], y)
      pdf.addPage()
      pdf.setLineWidth(0.6)
      pdf.rect(M, M, PW - 2 * M, PH - 2 * M)
      y = M + P
      pdf.setFillColor(240, 240, 240)
      pdf.rect(L, y, W, 6, 'F')
      pdf.setFont('helvetica', 'bold').setFontSize(8)
      pdf.text('Sl', L + cSl / 2, y + 4, { align: 'center' })
      pdf.text('Description of Goods (contd.)', L + cSl + 2, y + 4)
      pdf.text('HSN', colsX[2] + cHsn / 2, y + 4, { align: 'center' })
      pdf.text('Qty/Unit', colsX[3] + cQty / 2, y + 4, { align: 'center' })
      pdf.text('Rate', colsX[4] + cRate - 1, y + 4, { align: 'right' })
      pdf.text('GST%', colsX[5] + cGstPct / 2, y + 4, { align: 'center' })
      pdf.text('GST Amt', colsX[6] + cGstAmt - 1, y + 4, { align: 'right' })
      pdf.text('Amount', R - 1, y + 4, { align: 'right' })
      for (let ci = 1; ci < colsX.length - 1; ci++) pdf.line(colsX[ci], y, colsX[ci], y + 6)
      y += 6
      pdf.line(L, y, R, y)
      rowStartY = y
      pdf.setFont('helvetica', 'normal').setFontSize(8)
    }

    pdf.text(String(i + 1), L + cSl / 2, y + 4, { align: 'center' })
    let tyy = y + 3.5
    pdf.setFont('helvetica', 'bold').setFontSize(8)
    nameLines.forEach((line: string) => {
      pdf.text(line, L + cSl + 2, tyy)
      tyy += 3.2
    })
    pdf.setFont('helvetica', 'normal').setFontSize(7)
    specLines.forEach((line: string) => {
      pdf.text(line, L + cSl + 2, tyy)
      tyy += 3
    })
    pdf.setFont('helvetica', 'normal').setFontSize(8)
    const itemGstPct = r.gst || 0
    const itemGstAmt = Math.round(((r.qty * r.rate * itemGstPct) / 100) * 100) / 100
    pdf.text(String(r.hsn || '-'), colsX[2] + cHsn / 2, y + 4, { align: 'center' })
    pdf.text(`${n2(r.qty)} ${r.unit || ''}`, colsX[3] + cQty - 1, y + 4, { align: 'right' })
    pdf.text(n2(r.rate), colsX[4] + cRate - 1, y + 4, { align: 'right' })
    pdf.text(`${itemGstPct}%`, colsX[5] + cGstPct / 2, y + 4, { align: 'center' })
    pdf.text(itemGstPct > 0 ? n2(itemGstAmt) : '-', colsX[6] + cGstAmt - 1, y + 4, { align: 'right' })
    pdf.text(n2(r.qty * r.rate), R - 1, y + 4, { align: 'right' })

    y += rowH
    pdf.line(L, y, R, y)
  })

  for (let i = 1; i < colsX.length - 1; i++) pdf.line(colsX[i], rowStartY, colsX[i], y)
  pdf.line(L, y, R, y)

  const BOTTOM_RESERVED = 100
  let totalsStartY = PH - M - BOTTOM_RESERVED
  if (y > totalsStartY - 25) {
    pdf.addPage()
    pdf.setLineWidth(0.6)
    pdf.rect(M, M, PW - 2 * M, PH - 2 * M)
    totalsStartY = M + 40
  }

  y = totalsStartY
  pdf.setLineWidth(0.3)
  pdf.setDrawColor(0, 0, 0)
  pdf.setFillColor(245, 245, 245)
  pdf.rect(L, y, W, 6.5, 'F')
  pdf.line(L, y, R, y)
  pdf.setFont('helvetica', 'bold').setFontSize(9)
  pdf.text('Sub Total', R - cAmt - 2, y + 4.5, { align: 'right' })
  pdf.text(n2(b.sub), R - 2, y + 4.5, { align: 'right' })
  pdf.line(R - cAmt, y, R - cAmt, y + 6.5)
  y += 6.5
  pdf.line(L, y, R, y)

  const isInter = isInterGst(b.gstType)
  const tC1 = L + 20
  const tC2 = L + 65
  const tC3 = L + 107
  const tC4 = L + 149

  pdf.setFillColor(215, 215, 215)
  pdf.rect(L, y, W, 5.5, 'F')
  pdf.setFont('helvetica', 'bold').setFontSize(7.5)
  pdf.text('GST Rate', (L + tC1) / 2, y + 3.8, { align: 'center' })
  pdf.text('Taxable Value', tC2 - 2, y + 3.8, { align: 'right' })
  if (isInter) {
    pdf.text('IGST Amount', (tC2 + tC4) / 2, y + 3.8, { align: 'center' })
  } else {
    pdf.text('CGST Amount', (tC2 + tC3) / 2, y + 3.8, { align: 'center' })
    pdf.text('SGST Amount', (tC3 + tC4) / 2, y + 3.8, { align: 'center' })
    pdf.line(tC3, y, tC3, y + 5.5)
  }
  pdf.text('Total Tax', R - 2, y + 3.8, { align: 'right' })
  pdf.line(tC1, y, tC1, y + 5.5)
  pdf.line(tC2, y, tC2, y + 5.5)
  pdf.line(tC4, y, tC4, y + 5.5)
  y += 5.5
  pdf.line(L, y, R, y)

  const buckets = b.taxBuckets || {}
  const taxKeys = Object.keys(buckets)
    .sort((a, c) => parseFloat(a) - parseFloat(c))
    .filter((g) => parseFloat(g) > 0)

  if (taxKeys.length === 0) {
    pdf.setFont('helvetica', 'normal').setFontSize(8)
    pdf.text('No Tax (0%)', L + 3, y + 3.5)
    y += 5
    pdf.line(L, y, R, y)
  }

  taxKeys.forEach((g) => {
    const t = buckets[g]
    const halfR = parseFloat(g) / 2
    const rH = 5.5
    pdf.setFont('helvetica', 'normal').setFontSize(8)
    pdf.text(g + '%', (L + tC1) / 2, y + 3.8, { align: 'center' })
    pdf.text(n2(t.taxable), tC2 - 2, y + 3.8, { align: 'right' })
    if (isInter) {
      pdf.text(`IGST @${g}% =`, tC2 + 3, y + 3.8)
      pdf.setFont('helvetica', 'bold').setFontSize(8)
      pdf.text(n2(t.tax), tC4 - 2, y + 3.8, { align: 'right' })
    } else {
      pdf.text(`CGST @${halfR}% =`, tC2 + 3, y + 3.8)
      pdf.setFont('helvetica', 'bold').setFontSize(8)
      pdf.text(n2(t.tax / 2), tC3 - 2, y + 3.8, { align: 'right' })
      pdf.setFont('helvetica', 'normal').setFontSize(8)
      pdf.text(`SGST @${halfR}% =`, tC3 + 3, y + 3.8)
      pdf.setFont('helvetica', 'bold').setFontSize(8)
      pdf.text(n2(t.tax / 2), tC4 - 2, y + 3.8, { align: 'right' })
    }
    pdf.setFont('helvetica', 'bold').setFontSize(8)
    pdf.text(n2(t.tax), R - 2, y + 3.8, { align: 'right' })
    pdf.setLineWidth(0.3)
    pdf.line(tC1, y, tC1, y + rH)
    pdf.line(tC2, y, tC2, y + rH)
    if (!isInter) pdf.line(tC3, y, tC3, y + rH)
    pdf.line(tC4, y, tC4, y + rH)
    y += rH
    pdf.line(L, y, R, y)
  })

  pdf.setFont('helvetica', 'normal').setFontSize(8)
  pdf.text('Round Off:', R - cAmt - 2, y + 3.5, { align: 'right' })
  pdf.text(n2(b.roundOff), R - 2, y + 3.5, { align: 'right' })
  pdf.line(R - cAmt, y, R - cAmt, y + 5)
  y += 5
  pdf.line(L, y, R, y)

  pdf.setFillColor(30, 58, 95)
  pdf.rect(L, y, W, 8, 'F')
  pdf.setTextColor(255, 255, 255)
  pdf.setFont('helvetica', 'bold').setFontSize(10.5)
  pdf.text('GRAND TOTAL', L + 5, y + 5.5)
  pdf.text(`Rs. ${n2(b.grandTotal)}`, R - 2, y + 5.5, { align: 'right' })
  pdf.setTextColor(0, 0, 0)
  y += 8
  pdf.line(L, y, R, y)

  pdf.setFillColor(250, 250, 250)
  pdf.rect(L, y, W, 9, 'F')
  pdf.setFont('helvetica', 'bold').setFontSize(8)
  pdf.text('Amount in Words:', L + 3, y + 5)
  pdf.setFont('helvetica', 'italic').setFontSize(8)
  const wordsText = numberToWords(b.grandTotal)
  const wordsLines = pdf.splitTextToSize(wordsText, W - 44)
  let wy = y + 5
  wordsLines.forEach((line: string) => {
    pdf.text(line, L + 40, wy)
    wy += 3.3
  })
  y += Math.max(9, wordsLines.length * 3.3 + 5)
  pdf.line(L, y, R, y)

  const footHalf = W / 2
  const footStart = y
  pdf.line(L + footHalf, footStart, L + footHalf, PH - M)

  pdf.setFont('helvetica', 'bold').setFontSize(8)
  pdf.setFillColor(240, 240, 240)
  pdf.rect(L, y, footHalf, 5, 'F')
  pdf.text('Bank Details', L + 3, y + 3.5)
  pdf.setFont('helvetica', 'normal').setFontSize(7.5)
  let by = y + 8
  ;(f.bank || '-').split('\n').forEach((line) => {
    pdf.splitTextToSize(line, footHalf - 6).forEach((ww: string) => {
      pdf.text(ww, L + 3, by)
      by += 3
    })
  })
  by += 3
  pdf.setFont('helvetica', 'bold').setFontSize(7.5)
  pdf.text('Declaration:', L + 3, by)
  by += 3.5
  pdf.setFont('helvetica', 'normal').setFontSize(7)
  pdf.splitTextToSize(f.decl || '', footHalf - 6).forEach((line: string) => {
    pdf.text(line, L + 3, by)
    by += 2.8
  })
  by += 3
  pdf.setFont('helvetica', 'bold').setFontSize(7.5)
  pdf.text('Terms & Conditions:', L + 3, by)
  by += 3.5
  pdf.setFont('helvetica', 'normal').setFontSize(7)
  ;(f.terms || '').split('\n').forEach((line) => {
    pdf.splitTextToSize(line, footHalf - 6).forEach((ww: string) => {
      pdf.text(ww, L + 3, by)
      by += 2.8
    })
  })

  const sigX = L + footHalf
  pdf.setFillColor(240, 240, 240)
  pdf.rect(sigX, y, footHalf, 5, 'F')
  pdf.setFont('helvetica', 'bold').setFontSize(8)
  pdf.text(`For ${f.name}`, sigX + footHalf / 2, y + 3.5, { align: 'center' })
  if (f.signature) {
    try {
      const fmt = f.signature.startsWith('data:image/png') ? 'PNG' : 'JPEG'
      const sigW = 50
      const sigH = 18
      const sigImgX = sigX + (footHalf - sigW) / 2
      pdf.addImage(f.signature, fmt, sigImgX, PH - M - 26, sigW, sigH, undefined, 'FAST')
    } catch {
      pdf.line(sigX + 15, PH - M - 11, R - 15, PH - M - 11)
    }
  } else {
    pdf.line(sigX + 15, PH - M - 11, R - 15, PH - M - 11)
  }
  pdf.setFont('helvetica', 'normal').setFontSize(8)
  pdf.text('Authorised Signatory', sigX + footHalf / 2, PH - M - 5, { align: 'center' })
}

export function generateInvoicePdf(invoice: Invoice, firm: Firm): jsPDF {
  const b = toPdfBill(invoice)
  const f = toPdfFirm(firm)
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true })
  const copies = [
    { label: 'ORIGINAL', sub: 'For Buyer' },
    { label: 'DUPLICATE', sub: 'For Transporter' },
    { label: 'TRIPLICATE', sub: 'For Office Use' },
  ]
  copies.forEach((copy, i) => {
    if (i > 0) pdf.addPage()
    drawInvoiceOnPDF(pdf, b, f, copy.label, copy.sub)
  })
  return pdf
}

export function downloadInvoicePdf(invoice: Invoice, firm: Firm): void {
  const pdf = generateInvoicePdf(invoice, firm)
  const filename = pdfFilename(invoice)
  try {
    pdf.save(filename)
  } catch {
    const blob = pdf.output('blob')
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }
}

export async function bulkDownloadInvoicePdf(invoices: Invoice[], firm: Firm): Promise<number> {
  if (!invoices.length) return 0
  const f = toPdfFirm(firm)
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true })
  let firstPage = true
  for (const inv of invoices) {
    const b = toPdfBill(inv)
    const copies = [
      { label: 'ORIGINAL', sub: 'For Buyer' },
      { label: 'DUPLICATE', sub: 'For Transporter' },
      { label: 'TRIPLICATE', sub: 'For Office Use' },
    ]
    for (const copy of copies) {
      if (!firstPage) pdf.addPage()
      firstPage = false
      drawInvoiceOnPDF(pdf, b, f, copy.label, copy.sub)
    }
  }
  const n = new Date().toISOString().slice(0, 10)
  pdf.save(`Invoices_Bulk_${n}_${invoices.length}.pdf`)
  return invoices.length
}
