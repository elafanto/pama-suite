import { jsPDF } from 'jspdf'
import { formatDeckleDisplay, normalizePaperType, normalizeReelColor, resolveDecklePair, type ReelInventoryBreakdownRow } from '@/services/production'
import type { ReelStock } from '@/types/models'

function n2(v: number): string {
  return (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

function deckleOf(reel: ReelStock): string {
  if (reel.deckle_mm || reel.deckle_inch) {
    return formatDeckleDisplay(Number(reel.deckle_mm) || 0, Number(reel.deckle_inch) || 0)
  }
  const pair = resolveDecklePair({
    deckle_mm: reel.deckle_mm,
    deckle_inch: reel.deckle_inch,
    deckle_size: reel.deckle_size,
  })
  return pair.deckle_size || reel.deckle_size || '—'
}

export interface ReelWisePdfRow {
  reelNo: string
  paperType: string
  mill: string
  deckle: string
  gsm: string
  bf: string
  color: string
  condition: string
  openingKg: number
  currentKg: number
  status: string
  date: string
}

export interface ReelAbstractPdfRow {
  paperType: string
  gsm: string
  bf: string
  deckle: string
  color: string
  reels: number
  activeReels: number
  openingKg: number
  availableKg: number
  consumedKg: number
  status: string
}

const STATUS_LABEL: Record<string, string> = {
  ok: 'In stock',
  low: 'Low stock',
  zero: 'Zero stock',
  active: 'active',
  consumed: 'consumed',
}

export function buildReelWisePdfRows(reels: ReelStock[]): ReelWisePdfRow[] {
  return [...reels]
    .sort((a, b) => (a.reel_no || '').localeCompare(b.reel_no || '', undefined, { numeric: true }))
    .map((r) => ({
      reelNo: r.reel_no || '—',
      paperType: normalizePaperType(r.paper_type),
      mill: r.supplier_name || '—',
      deckle: deckleOf(r),
      gsm: r.gsm || '—',
      bf: r.bf || '—',
      color: normalizeReelColor(r.color),
      condition: r.intake_condition === 'partial' ? 'partial' : 'fresh',
      openingKg: Number(r.opening_weight) || 0,
      currentKg: Number(r.current_weight) || 0,
      status: r.status || '—',
      date: (r.created_at || '').slice(0, 10) || '—',
    }))
}

export function buildReelAbstractPdfRows(breakdown: ReelInventoryBreakdownRow[]): ReelAbstractPdfRow[] {
  return breakdown.map((row) => ({
    paperType: row.paper_type,
    gsm: row.gsm,
    bf: row.bf,
    deckle: row.deckle,
    color: row.color,
    reels: row.reels,
    activeReels: row.activeReels,
    openingKg: row.openingWeight,
    availableKg: row.currentWeight,
    consumedKg: row.consumedWeight,
    status: STATUS_LABEL[row.stockStatus] || row.stockStatus,
  }))
}

function drawHeader(
  pdf: jsPDF,
  opts: { title: string; firmName?: string; subtitle?: string; pageW: number },
): number {
  const { title, firmName, subtitle, pageW } = opts
  let y = 12
  pdf.setFont('helvetica', 'bold').setFontSize(13)
  const nameLines = pdf.splitTextToSize(firmName || 'Pama Suite', pageW - 20)
  nameLines.forEach((line: string) => {
    pdf.text(line, pageW / 2, y, { align: 'center' })
    y += 5.5
  })
  pdf.setFontSize(11)
  const titleLines = pdf.splitTextToSize(title, pageW - 20)
  titleLines.forEach((line: string) => {
    pdf.text(line, pageW / 2, y, { align: 'center' })
    y += 5
  })
  pdf.setFont('helvetica', 'normal').setFontSize(8)
  const sub = `As on ${todayStamp()}${subtitle ? ` · ${subtitle}` : ''}`
  const subLines = pdf.splitTextToSize(sub, pageW - 20)
  subLines.forEach((line: string) => {
    pdf.text(line, pageW / 2, y, { align: 'center' })
    y += 4
  })
  y += 2
  return y
}

function ensurePage(pdf: jsPDF, y: number, need: number, pageH: number, marginTop = 12): number {
  if (y + need <= pageH - 10) return y
  pdf.addPage()
  return marginTop
}

/** Landscape A4 — one row per reel. */
export function downloadReelWiseStockPdf(opts: {
  reels: ReelStock[]
  firmName?: string
  filterNote?: string
  filename?: string
}): { file: string; rows: number } {
  const rows = buildReelWisePdfRows(opts.reels)
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const L = 8
  const R = pageW - 8
  let y = drawHeader(pdf, {
    title: 'Paper Reel Stock — Reel Number Wise',
    firmName: opts.firmName,
    subtitle: opts.filterNote,
    pageW,
  })

  const cols = [
    { key: 'reelNo', label: 'Reel No', w: 22 },
    { key: 'paperType', label: 'Type', w: 16 },
    { key: 'mill', label: 'Mill', w: 36 },
    { key: 'deckle', label: 'Deckle', w: 28 },
    { key: 'gsm', label: 'GSM', w: 12 },
    { key: 'bf', label: 'BF', w: 10 },
    { key: 'color', label: 'Color', w: 12 },
    { key: 'condition', label: 'Cond.', w: 14 },
    { key: 'openingKg', label: 'Open KG', w: 20, num: true },
    { key: 'currentKg', label: 'Curr KG', w: 20, num: true },
    { key: 'status', label: 'Status', w: 18 },
    { key: 'date', label: 'Date', w: 20 },
  ] as const

  const drawTableHeader = () => {
    pdf.setFillColor(241, 245, 249)
    pdf.rect(L, y, R - L, 7, 'F')
    pdf.setFont('helvetica', 'bold').setFontSize(7)
    let x = L + 1
    for (const c of cols) {
      if ('num' in c && c.num) pdf.text(c.label, x + c.w - 2, y + 4.5, { align: 'right' })
      else pdf.text(c.label, x, y + 4.5)
      x += c.w
    }
    y += 7
  }

  drawTableHeader()

  let sumOpen = 0
  let sumCur = 0
  pdf.setFont('helvetica', 'normal').setFontSize(6.5)
  for (const row of rows) {
    const millLines = pdf.splitTextToSize(row.mill || '—', 33) as string[]
    const deckleLines = pdf.splitTextToSize(row.deckle || '—', 25) as string[]
    const rowH = Math.max(5.5, Math.max(millLines.length, deckleLines.length) * 3.2 + 1.4)
    y = ensurePage(pdf, y, rowH + 1, pageH)
    if (y === 12) drawTableHeader()
    sumOpen += row.openingKg
    sumCur += row.currentKg
    let x = L + 1
    const cells: Record<string, string> = {
      reelNo: row.reelNo,
      paperType: row.paperType,
      mill: row.mill,
      deckle: row.deckle,
      gsm: row.gsm,
      bf: row.bf,
      color: row.color,
      condition: row.condition,
      openingKg: n2(row.openingKg),
      currentKg: n2(row.currentKg),
      status: row.status,
      date: row.date,
    }
    for (const c of cols) {
      const val = cells[c.key] || ''
      if (c.key === 'mill' || c.key === 'deckle') {
        const lines = pdf.splitTextToSize(val, c.w - 3) as string[]
        lines.forEach((line: string, idx: number) => pdf.text(line, x, y + 4 + idx * 3.2))
      } else if ('num' in c && c.num) pdf.text(val, x + c.w - 2, y + 4, { align: 'right' })
      else pdf.text(val, x, y + 4)
      x += c.w
    }
    y += rowH
  }

  y = ensurePage(pdf, y, 10, pageH)
  pdf.setFont('helvetica', 'bold').setFontSize(8)
  pdf.text(
    `Total reels: ${rows.length}    Opening: ${n2(sumOpen)} KG    Current: ${n2(sumCur)} KG`,
    L,
    y + 5,
  )

  const file = opts.filename || `Reel_Stock_ReelWise_${todayStamp()}.pdf`
  pdf.save(file)
  return { file, rows: rows.length }
}

/** Portrait A4 — GSM/BF/Deckle/Color abstract. */
export function downloadReelAbstractStockPdf(opts: {
  breakdown: ReelInventoryBreakdownRow[]
  firmName?: string
  totals?: {
    totalReels: number
    availableKg: number
    consumedKg: number
    lowStockReels?: number
    zeroStockReels?: number
  }
  title?: string
  filterNote?: string
  filename?: string
}): { file: string; rows: number } {
  const rows = buildReelAbstractPdfRows(opts.breakdown)
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const L = 10
  const R = pageW - 10
  let y = drawHeader(pdf, {
    title: opts.title || 'Paper Reel Stock — Abstract (GSM / BF / Deckle / Color)',
    firmName: opts.firmName,
    subtitle: opts.filterNote,
    pageW,
  })

  if (opts.totals) {
    pdf.setFont('helvetica', 'normal').setFontSize(8)
    const t = opts.totals
    pdf.text(
      `Reels: ${t.totalReels}  ·  Available: ${n2(t.availableKg)} KG  ·  Consumed: ${n2(t.consumedKg)} KG`
      + (t.lowStockReels != null ? `  ·  Low: ${t.lowStockReels}` : '')
      + (t.zeroStockReels != null ? `  ·  Zero: ${t.zeroStockReels}` : ''),
      L,
      y,
    )
    y += 6
  }

  const cols = [
    { key: 'paperType', label: 'Type', w: 16 },
    { key: 'gsm', label: 'GSM', w: 14 },
    { key: 'bf', label: 'BF', w: 12 },
    { key: 'deckle', label: 'Deckle', w: 28 },
    { key: 'color', label: 'Color', w: 14 },
    { key: 'reels', label: 'Reels', w: 12, num: true },
    { key: 'activeReels', label: 'Active', w: 12, num: true },
    { key: 'openingKg', label: 'Open', w: 18, num: true },
    { key: 'availableKg', label: 'Avail', w: 18, num: true },
    { key: 'consumedKg', label: 'Used', w: 18, num: true },
    { key: 'status', label: 'Status', w: 18 },
  ] as const

  const drawTableHeader = () => {
    pdf.setFillColor(241, 245, 249)
    pdf.rect(L, y, R - L, 7, 'F')
    pdf.setFont('helvetica', 'bold').setFontSize(7)
    let x = L + 1
    for (const c of cols) {
      if ('num' in c && c.num) pdf.text(c.label, x + c.w - 2, y + 4.5, { align: 'right' })
      else pdf.text(c.label, x, y + 4.5)
      x += c.w
    }
    y += 7
  }

  drawTableHeader()
  pdf.setFont('helvetica', 'normal').setFontSize(7)

  for (const row of rows) {
    const deckleLines = pdf.splitTextToSize(String(row.deckle || '—'), 25) as string[]
    const rowH = Math.max(5.5, deckleLines.length * 3.2 + 1.4)
    y = ensurePage(pdf, y, rowH + 1, pageH)
    if (y === 12) drawTableHeader()
    let x = L + 1
    const cells: Record<string, string> = {
      paperType: row.paperType,
      gsm: row.gsm,
      bf: row.bf,
      deckle: String(row.deckle),
      color: row.color,
      reels: String(row.reels),
      activeReels: String(row.activeReels),
      openingKg: n2(row.openingKg),
      availableKg: n2(row.availableKg),
      consumedKg: n2(row.consumedKg),
      status: row.status,
    }
    for (const c of cols) {
      const val = cells[c.key] || ''
      if (c.key === 'deckle') {
        deckleLines.forEach((line: string, idx: number) => pdf.text(line, x, y + 4 + idx * 3.2))
      } else if ('num' in c && c.num) pdf.text(val, x + c.w - 2, y + 4, { align: 'right' })
      else pdf.text(val, x, y + 4)
      x += c.w
    }
    y += rowH
  }

  const file = opts.filename || `Reel_Stock_Abstract_${todayStamp()}.pdf`
  pdf.save(file)
  return { file, rows: rows.length }
}

/** Abstract PDF filtered to low + zero stock rows only. */
export function downloadReelLowStockPdf(opts: {
  breakdown: ReelInventoryBreakdownRow[]
  firmName?: string
  totals?: {
    totalReels: number
    availableKg: number
    consumedKg: number
    lowStockReels?: number
    zeroStockReels?: number
  }
}): { file: string; rows: number } {
  const filtered = opts.breakdown.filter((r) => r.stockStatus === 'low' || r.stockStatus === 'zero')
  return downloadReelAbstractStockPdf({
    breakdown: filtered,
    firmName: opts.firmName,
    totals: opts.totals,
    title: 'Paper Reel Stock — Low / Zero Stock',
    filterNote: 'Only low & zero stock configs',
    filename: `Reel_Stock_LowZero_${todayStamp()}.pdf`,
  })
}
