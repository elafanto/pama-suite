import { jsPDF } from 'jspdf'
import { formatGstin, getStateName, getStateCode } from '@/services/gst'
import { numberToWords } from '@/services/numberToWords'
import { fmtDate } from '@/services/boxcalcUi'
import {
  resolveLivePartyDetails,
  resolveLiveShipDetails,
  resolvePartyById,
  type PartyLookup,
} from '@/services/invoiceDisplay'
import { resolveFirmSignature } from '@/services/firmSignature'
import {
  docFilenamePrefix,
  docNoLabel,
  docPdfSubtitle,
  docPdfTitle,
  isDeliveryChallan,
  JOB_WORK_CHALLAN_NOTE,
} from '@/services/invoiceDoc'
import type { Firm, Invoice, Party } from '@/types/models'

function n2(n: number) {
  return (n || 0).toFixed(2)
}

type PdfAlign = 'left' | 'center' | 'right'

export function wrapPdfText(pdf: jsPDF, text: string, maxWidth: number): string[] {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim()
  if (!raw) return []
  const width = Math.max(6, maxWidth)
  const out: string[] = []
  for (const para of raw.split('\n')) {
    const line = para.replace(/[ \t]+/g, ' ').trim()
    if (!line) continue
    out.push(...(pdf.splitTextToSize(line, width) as string[]))
  }
  return out
}

function drawWrappedText(
  pdf: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineH: number,
  align: PdfAlign = 'left',
): number {
  const lines = wrapPdfText(pdf, text, maxWidth)
  if (!lines.length) return y
  for (const line of lines) {
    pdf.text(line, x, y, align === 'left' ? undefined : { align })
    y += lineH
  }
  return y
}

function wrappedBlockHeight(pdf: jsPDF, texts: Array<{ text: string; font?: 'bold' | 'normal' | 'italic'; size?: number }>, maxWidth: number, lineH: number): number {
  let h = 0
  for (const row of texts) {
    if (!row.text) continue
    pdf.setFont('helvetica', row.font || 'normal').setFontSize(row.size || 8)
    const n = Math.max(1, wrapPdfText(pdf, row.text, maxWidth).length)
    h += n * lineH
  }
  return h
}

function formatPayStatusForPdf(payStatus: string, amtPaid: number): string {
  const key = (payStatus || '').toUpperCase()
  if (key === 'PAID') return 'Paid'
  if (key === 'UNPAID') return 'Unpaid'
  if (key === 'PARTIAL') {
    const paid = Number(amtPaid) || 0
    return `Partial (paid Rs. ${paid.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
  }
  return payStatus || '-'
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

export { resolveFirmSignature }

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
  cancelled?: boolean
}

function toPdfFirm(firm: Firm): PdfFirm {
  return {
    name: firm.name || 'Firm',
    addr: firm.addr || '',
    pin: firm.pin || '',
    phone: firm.phone || '',
    email: firm.email || '',
    gst: formatGstin(firm.gst),
    state: firm.state || '',
    bank: firmBankText(firm),
    decl: firm.decl || 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
    terms: firm.terms || '',
    signature: resolveFirmSignature(firm),
  }
}

function toPdfBill(inv: Invoice, partyLookup?: PartyLookup): PdfBill {
  const liveParty = resolvePartyById(partyLookup, inv.party_id)
  const custDetails = resolveLivePartyDetails(inv, liveParty)
  const ship = resolveLiveShipDetails(inv, liveParty)
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
    custDetails,
    sameAsBuyer: inv.sameAsBuyer,
    ship,
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
    cancelled: !!inv.cancelled_at,
  }
}

function pdfFilename(inv: Invoice): string {
  const docPrefix = docFilenamePrefix(inv)
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

  const isChallan = isDeliveryChallan(b.docType)
  const docTitle = docPdfTitle(b.docType)
  const docSub = docPdfSubtitle(b.docType)

  pdf.setFont('helvetica', 'bold').setFontSize(15)
  y = drawWrappedText(pdf, String(f.name || '').toUpperCase(), PW / 2, y + 5, W - 8, 5.5, 'center')

  pdf.setFont('helvetica', 'normal').setFontSize(9)
  y = drawWrappedText(pdf, f.addr || '', PW / 2, y + 1, W - 16, 3.6, 'center')
  const contactLine = `PIN: ${f.pin || '-'}${f.phone ? ' | Mob: ' + f.phone : ''} | Email: ${f.email || '-'}`
  y = drawWrappedText(pdf, contactLine, PW / 2, y + 0.5, W - 16, 3.6, 'center')
  pdf.setFont('helvetica', 'bold').setFontSize(10)
  y = drawWrappedText(
    pdf,
    `GSTIN: ${f.gst || '-'}  |  State: ${getStateName(f.gst)} (${getStateCode(f.gst) || f.state || '-'})`,
    PW / 2,
    y + 0.5,
    W - 16,
    4,
    'center',
  )
  y += 2

  pdf.setFillColor(0, 0, 0)
  const titleH = isChallan ? 10 : 6
  pdf.rect(L, y, W, titleH, 'F')
  pdf.setFont('helvetica', 'bold').setFontSize(isChallan ? 11 : 12)
  pdf.setTextColor(255, 255, 255)
  pdf.text(docTitle, PW / 2, y + (isChallan ? 4 : 4.2), { align: 'center' })
  if (docSub) {
    pdf.setFont('helvetica', 'normal').setFontSize(7)
    pdf.text(docSub, PW / 2, y + 8, { align: 'center' })
  }
  pdf.setTextColor(0, 0, 0)
  y += titleH
  pdf.line(L, y, R, y)

  const colW = W / 3
  const buyer = b.custDetails || {}
  const innerW = colW - 3
  const lineH = 3.3
  const ship = b.sameAsBuyer !== false ? null : b.ship || null
  const cityPin = (city?: string, pin?: string, addr?: string) => {
    const addrL = (addr || '').toLowerCase()
    if (city && !addrL.includes(city.toLowerCase())) return `${city}${pin ? ' - ' + pin : ''}`
    if (pin && !addrL.includes(pin)) return pin
    return ''
  }

  pdf.setFont('helvetica', 'bold').setFontSize(8)
  const buyerRows: Array<{ text: string; font?: 'bold' | 'normal' | 'italic'; size?: number }> = [
    { text: isChallan ? 'JOB WORKER / CONSIGNEE:' : 'BILL TO (BUYER):', font: 'bold', size: 8 },
    { text: b.custName || '', font: 'bold', size: 9 },
    { text: buyer.addr || '', font: 'normal', size: 8 },
    { text: cityPin(buyer.city, buyer.pin, buyer.addr), font: 'normal', size: 8 },
    buyer.is_consumer
      ? { text: 'Consumer (B2C)', font: 'bold', size: 7.5 }
      : { text: buyer.gst ? `GSTIN: ${buyer.gst}` : '', font: 'bold', size: 8.5 },
    { text: `State: ${getStateName(buyer.gst || buyer.state)} (${getStateCode(buyer.gst) || buyer.state || '-'})`, font: 'normal', size: 8 },
  ]
  const shipRows: Array<{ text: string; font?: 'bold' | 'normal' | 'italic'; size?: number }> = ship
    ? [
      { text: 'SHIP TO (CONSIGNEE):', font: 'bold', size: 8 },
      { text: ship.name || b.custName || '', font: 'bold', size: 9 },
      { text: ship.addr || '', font: 'normal', size: 8 },
      { text: cityPin(ship.city, ship.pin, ship.addr), font: 'normal', size: 8 },
      { text: ship.gstin ? `GSTIN: ${ship.gstin}` : '', font: 'bold', size: 8.5 },
      { text: `State: ${getStateName(ship.gstin || ship.state)} (${getStateCode(ship.gstin) || ship.state || '-'})`, font: 'normal', size: 8 },
    ]
    : [
      { text: 'SHIP TO (CONSIGNEE):', font: 'bold', size: 8 },
      { text: '— Same as Buyer Address —', font: 'italic', size: 8 },
    ]
  const infoRows: Array<{ text: string; font?: 'bold' | 'normal' | 'italic'; size?: number }> = isChallan
    ? [
      { text: 'CHALLAN DETAILS:', font: 'bold', size: 8 },
      { text: `${docNoLabel(b.docType)}: ${b.billNo}`, font: 'normal', size: 8 },
      { text: `Date: ${fmtDate(b.date)}`, font: 'normal', size: 8 },
      { text: `Ref: ${b.ref || '-'}`, font: 'normal', size: 8 },
      { text: 'Purpose: Job Work', font: 'normal', size: 8 },
    ]
    : [
      { text: 'INVOICE DETAILS:', font: 'bold', size: 8 },
      { text: `Invoice No: ${b.billNo}`, font: 'normal', size: 8 },
      { text: `Date: ${fmtDate(b.date)}`, font: 'normal', size: 8 },
      { text: `Ref: ${b.ref || '-'}`, font: 'normal', size: 8 },
      { text: `Payment: ${b.payment || '-'}`, font: 'normal', size: 8 },
      { text: `Status: ${formatPayStatusForPdf(b.payStatus, b.amtPaid)}`, font: 'normal', size: 8 },
    ]

  const partyH = Math.max(
    wrappedBlockHeight(pdf, buyerRows, innerW, lineH),
    wrappedBlockHeight(pdf, shipRows, innerW, lineH),
    wrappedBlockHeight(pdf, infoRows, innerW, lineH),
    22,
  ) + 4

  pdf.line(L + colW, y, L + colW, y + partyH)
  pdf.line(L + 2 * colW, y, L + 2 * colW, y + partyH)

  const drawPartyCol = (rows: typeof buyerRows, x: number) => {
    let ty = y + 4
    for (const row of rows) {
      if (!row.text) continue
      pdf.setFont('helvetica', row.font || 'normal').setFontSize(row.size || 8)
      if (row.text === 'Consumer (B2C)') pdf.setTextColor(22, 163, 74)
      ty = drawWrappedText(pdf, row.text, x, ty, innerW, lineH)
      pdf.setTextColor(0, 0, 0)
    }
  }
  drawPartyCol(buyerRows, L + 1)
  drawPartyCol(shipRows, L + colW + 1)
  drawPartyCol(infoRows, L + 2 * colW + 1)

  y += partyH
  pdf.line(L, y, R, y)

  const transportRows = [
    [`Dispatch: ${b.dispatch || '-'}`, `LR/RR: ${b.lr || '-'}`, `Vehicle: ${b.vehicle || '-'}`],
    [`E-Way: ${b.eway || '-'}`, `Destination: ${b.dest || '-'}`, `Distance: ${b.distance || 0} km`],
  ]
  pdf.setFont('helvetica', 'normal').setFontSize(8)
  for (const row of transportRows) {
    const rowH = Math.max(
      ...row.map((cell) => wrappedBlockHeight(pdf, [{ text: cell, size: 8 }], innerW, 3.2)),
      6,
    ) + 2
    pdf.line(L + colW, y, L + colW, y + rowH)
    pdf.line(L + 2 * colW, y, L + 2 * colW, y + rowH)
    row.forEach((cell, idx) => {
      drawWrappedText(pdf, cell, L + idx * colW + 1, y + 4, innerW, 3.2)
    })
    y += rowH
    pdf.line(L, y, R, y)
  }

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

  pdf.setFillColor(255, 255, 255)
  pdf.rect(L, y, W, 8, 'FD')
  pdf.setDrawColor(0, 0, 0)
  pdf.setLineWidth(0.4)
  pdf.rect(L, y, W, 8, 'S')
  pdf.setTextColor(0, 0, 0)
  pdf.setFont('helvetica', 'bold').setFontSize(10.5)
  pdf.text('GRAND TOTAL', L + 5, y + 5.5)
  pdf.text(`Rs. ${n2(b.grandTotal)}`, R - 2, y + 5.5, { align: 'right' })
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

  pdf.setFont('helvetica', 'bold').setFontSize(10)
  pdf.setFillColor(240, 240, 240)
  pdf.rect(L, y, footHalf, 5, 'F')
  pdf.text(isChallan ? 'Job Work Note' : 'Bank Details', L + 3, y + 3.5)
  pdf.setFont('helvetica', 'bold').setFontSize(10)
  let by = y + 8
  if (isChallan) {
    pdf.setFont('helvetica', 'normal').setFontSize(7)
    pdf.splitTextToSize(JOB_WORK_CHALLAN_NOTE, footHalf - 6).forEach((line: string) => {
      pdf.text(line, L + 3, by)
      by += 3.2
    })
  } else {
    ;(f.bank || '-').split('\n').forEach((line) => {
      pdf.splitTextToSize(line, footHalf - 6).forEach((ww: string) => {
        pdf.text(ww, L + 3, by)
        by += 3.8
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
  }

  const sigX = L + footHalf
  pdf.setFillColor(240, 240, 240)
  pdf.rect(sigX, y, footHalf, 5, 'F')
  pdf.setFont('helvetica', 'bold').setFontSize(8)
  pdf.setFont('helvetica', 'bold').setFontSize(9)
  drawWrappedText(pdf, `For ${f.name}`, sigX + footHalf / 2, y + 3.5, footHalf - 4, 3.5, 'center')
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

  if (b.cancelled) {
    pdf.setTextColor(200, 80, 80)
    pdf.setFont('helvetica', 'bold').setFontSize(54)
    // Diagonal watermark — low visual weight via light color (print-visible).
    pdf.text('CANCELLED', PW / 2, PH / 2, { align: 'center', angle: -28 })
    pdf.setTextColor(0, 0, 0)
  }
}

export type InvoicePdfCopy = 'office' | 'transporter' | 'recipient'

export const INVOICE_PDF_COPY_OPTIONS: { value: InvoicePdfCopy; label: string }[] = [
  { value: 'office', label: 'Office copy' },
  { value: 'transporter', label: 'Transporter copy' },
  { value: 'recipient', label: 'Recipient copy' },
]

const INVOICE_PDF_COPY_META: Record<InvoicePdfCopy, { label: string; sub: string }> = {
  recipient: { label: 'ORIGINAL', sub: 'For Buyer' },
  transporter: { label: 'DUPLICATE', sub: 'For Transporter' },
  office: { label: 'TRIPLICATE', sub: 'For Office Use' },
}

const CHALLAN_PDF_COPY_META: Record<InvoicePdfCopy, { label: string; sub: string }> = {
  recipient: { label: 'ORIGINAL', sub: 'For Job Worker' },
  transporter: { label: 'DUPLICATE', sub: 'For Transporter' },
  office: { label: 'TRIPLICATE', sub: 'For Office Use' },
}

const INVOICE_PDF_ALL_COPIES = [
  INVOICE_PDF_COPY_META.recipient,
  INVOICE_PDF_COPY_META.transporter,
  INVOICE_PDF_COPY_META.office,
]

const CHALLAN_PDF_ALL_COPIES = [
  CHALLAN_PDF_COPY_META.recipient,
  CHALLAN_PDF_COPY_META.transporter,
  CHALLAN_PDF_COPY_META.office,
]

export function invoicePdfCopyMeta(copy: InvoicePdfCopy = 'office', docType?: string) {
  if (docType && isDeliveryChallan(docType)) return CHALLAN_PDF_COPY_META[copy]
  return INVOICE_PDF_COPY_META[copy]
}

export function generateInvoicePdf(invoice: Invoice, firm: Firm, partyLookup?: PartyLookup): jsPDF {
  const b = toPdfBill(invoice, partyLookup)
  const f = toPdfFirm(firm)
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true })
  const copies = isDeliveryChallan(invoice) ? CHALLAN_PDF_ALL_COPIES : INVOICE_PDF_ALL_COPIES
  copies.forEach((copy, i) => {
    if (i > 0) pdf.addPage()
    drawInvoiceOnPDF(pdf, b, f, copy.label, copy.sub)
  })
  return pdf
}

export function downloadInvoicePdf(invoice: Invoice, firm: Firm, partyLookup?: PartyLookup): void {
  const pdf = generateInvoicePdf(invoice, firm, partyLookup)
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

export async function bulkDownloadInvoicePdf(
  invoices: Invoice[],
  firm: Firm,
  partyLookup?: PartyLookup,
  copy: InvoicePdfCopy = 'office',
): Promise<number> {
  if (!invoices.length) return 0
  const f = toPdfFirm(firm)
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true })
  let firstPage = true
  for (const inv of invoices) {
    const b = toPdfBill(inv, partyLookup)
    const copyMeta = invoicePdfCopyMeta(copy, inv.doc_type)
    if (!firstPage) pdf.addPage()
    firstPage = false
    drawInvoiceOnPDF(pdf, b, f, copyMeta.label, copyMeta.sub)
  }
  const n = new Date().toISOString().slice(0, 10)
  pdf.save(`Invoices_Bulk_${copy}_${n}_${invoices.length}.pdf`)
  return invoices.length
}
