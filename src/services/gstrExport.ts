import * as XLSX from 'xlsx'
import { getStateCode, getStateName, isInterstateGst } from '@/services/gst'
import { gstrB2B } from '@/services/reports'
import type { Invoice } from '@/types/models'

const B2B_HEADERS = [
  'GSTIN/UIN of Recipient',
  'Receiver Name',
  'Invoice Number',
  'Invoice date',
  'Invoice Value',
  'Place Of Supply',
  'Reverse Charge',
  'Applicable % of Tax Rate',
  'Invoice Type',
  'E-Commerce GSTIN',
  'Rate',
  'Taxable Value',
  'Cess Amount',
] as const

const HSN_HEADERS = [
  'HSN',
  'Description',
  'UQC',
  'Total Quantity',
  'Total Value',
  'Taxable Value',
  'Integrated Tax Amount',
  'Central Tax Amount',
  'State/UT Tax Amount',
  'Cess Amount',
  'Rate',
] as const

const UQC_MAP: Record<string, string> = {
  PCS: 'NOS-NUMBERS',
  NOS: 'NOS-NUMBERS',
  KG: 'KGS-KILOGRAMS',
  KGS: 'KGS-KILOGRAMS',
  MTR: 'MTR-METERS',
  BOX: 'BOX-BOX',
  SET: 'SET-SETS',
  BAG: 'BAG-BAGS',
  BDL: 'BDL-BUNDLES',
}

export interface GstrB2BExportRow {
  recipientGstin: string
  receiverName: string
  invoiceNumber: string
  invoiceDate: string
  invoiceValue: number
  placeOfSupply: string
  reverseCharge: 'Y' | 'N'
  applicableTaxRatePct: string
  invoiceType: string
  ecommerceGstin: string
  rate: number
  taxableValue: number
  cessAmount: number | ''
}

export interface GstrHsnExportRow {
  hsn: string
  description: string
  uqc: string
  totalQuantity: number
  totalValue: number
  taxableValue: number
  igst: number
  cgst: number
  sgst: number
  cess: number | ''
  rate: number
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

/** GST offline CSV date: 27-May-2026 */
export function formatGstrInvoiceDate(isoDate: string): string {
  if (!isoDate) return ''
  const d = new Date(isoDate.slice(0, 10) + 'T12:00:00')
  if (Number.isNaN(d.getTime())) return isoDate
  const day = d.getDate()
  const mon = d.toLocaleDateString('en-GB', { month: 'short' })
  const year = d.getFullYear()
  return `${day}-${mon}-${year}`
}

/** GST place of supply: 05-Uttarakhand */
export function formatPlaceOfSupply(inv: Invoice): string {
  const gst = inv.party_snapshot?.gst || inv.ship?.gstin || ''
  const code = getStateCode(gst) || inv.ship?.state || inv.party_snapshot?.state || ''
  const name = getStateName(code)
  if (!code) return name === 'Unknown' ? '' : name
  return `${code}-${name}`
}

export function toGstrUqc(unit: string | undefined): string {
  const raw = (unit || 'PCS').trim().toUpperCase()
  if (UQC_MAP[raw]) return UQC_MAP[raw]
  if (raw.includes('-')) return raw
  return `OTH-OTHERS`
}

function invoiceRateBuckets(inv: Invoice): { rate: number; taxable: number }[] {
  if (inv.taxBuckets && Object.keys(inv.taxBuckets).length) {
    return Object.entries(inv.taxBuckets)
      .map(([rate, bucket]) => ({
        rate: Number(rate),
        taxable: r2(bucket.taxable ?? 0),
      }))
      .filter((b) => b.taxable > 0 || b.rate >= 0)
      .sort((a, b) => a.rate - b.rate)
  }
  const map = new Map<number, number>()
  for (const line of inv.items || []) {
    const taxable = (line.qty || 0) * (line.rate || 0)
    const rate = Number(line.gst) || 0
    map.set(rate, r2((map.get(rate) || 0) + taxable))
  }
  return [...map.entries()]
    .map(([rate, taxable]) => ({ rate, taxable }))
    .sort((a, b) => a.rate - b.rate)
}

function buyerGstin(inv: Invoice): string {
  return (inv.party_snapshot?.gst || inv.ship?.gstin || '').trim().toUpperCase()
}

export function buildGstrB2BExportRows(invoices: Invoice[]): GstrB2BExportRow[] {
  const rows: GstrB2BExportRow[] = []
  const b2b = gstrB2B(invoices).sort((a, b) => a.date.localeCompare(b.date) || a.bill_no.localeCompare(b.bill_no))

  for (const inv of b2b) {
    const buckets = invoiceRateBuckets(inv)
    if (!buckets.length) {
      buckets.push({ rate: 0, taxable: r2(inv.sub || 0) })
    }
    const invoiceValue = r2(inv.grand_total || 0)
    for (const bucket of buckets) {
      rows.push({
        recipientGstin: buyerGstin(inv),
        receiverName: inv.party_name || '',
        invoiceNumber: inv.bill_no || '',
        invoiceDate: formatGstrInvoiceDate(inv.date),
        invoiceValue,
        placeOfSupply: formatPlaceOfSupply(inv),
        reverseCharge: 'N',
        applicableTaxRatePct: '',
        invoiceType: 'Regular B2B',
        ecommerceGstin: '',
        rate: bucket.rate,
        taxableValue: bucket.taxable,
        cessAmount: '',
      })
    }
  }
  return rows
}

export function buildGstrHsnB2BExportRows(invoices: Invoice[]): GstrHsnExportRow[] {
  type Agg = GstrHsnExportRow
  const map = new Map<string, Agg>()

  for (const inv of gstrB2B(invoices)) {
    const isInter = isInterstateGst(inv.gst_type)
    for (const line of inv.items || []) {
      const hsn = (line.hsn || 'NA').trim()
      const rate = Number(line.gst) || 0
      const uqc = toGstrUqc(line.unit)
      const key = `${hsn}|${rate}|${uqc}`
      const taxable = r2((line.qty || 0) * (line.rate || 0))
      const tax = r2(taxable * rate / 100)
      const igst = isInter ? tax : 0
      const cgst = isInter ? 0 : r2(tax / 2)
      const sgst = isInter ? 0 : r2(tax - cgst)

      if (!map.has(key)) {
        map.set(key, {
          hsn,
          description: line.name || '',
          uqc,
          totalQuantity: 0,
          totalValue: 0,
          taxableValue: 0,
          igst: 0,
          cgst: 0,
          sgst: 0,
          cess: '',
          rate,
        })
      }
      const row = map.get(key)!
      row.totalQuantity = r2(row.totalQuantity + (line.qty || 0))
      row.taxableValue = r2(row.taxableValue + taxable)
      row.igst = r2(row.igst + igst)
      row.cgst = r2(row.cgst + cgst)
      row.sgst = r2(row.sgst + sgst)
      row.totalValue = r2(row.taxableValue + row.igst + row.cgst + row.sgst)
      if (!row.description && line.name) row.description = line.name
    }
  }

  return [...map.values()].sort((a, b) => b.taxableValue - a.taxableValue)
}

function b2bRowToArray(row: GstrB2BExportRow): (string | number)[] {
  return [
    row.recipientGstin,
    row.receiverName,
    row.invoiceNumber,
    row.invoiceDate,
    row.invoiceValue,
    row.placeOfSupply,
    row.reverseCharge,
    row.applicableTaxRatePct,
    row.invoiceType,
    row.ecommerceGstin,
    row.rate,
    row.taxableValue,
    row.cessAmount,
  ]
}

function hsnRowToArray(row: GstrHsnExportRow): (string | number)[] {
  return [
    row.hsn,
    row.description,
    row.uqc,
    row.totalQuantity,
    row.totalValue,
    row.taxableValue,
    row.igst,
    row.cgst,
    row.sgst,
    row.cess,
    row.rate,
  ]
}

export function periodMonthBounds(period: string): { from: string; to: string } {
  const [y, m] = period.split('-').map(Number)
  if (!y || !m) {
    const d = new Date()
    const yy = d.getFullYear()
    const mm = d.getMonth() + 1
    const last = new Date(yy, mm, 0).getDate()
    const p = `${yy}-${String(mm).padStart(2, '0')}`
    return { from: `${p}-01`, to: `${p}-${String(last).padStart(2, '0')}` }
  }
  const last = new Date(y, m, 0).getDate()
  const p = `${y}-${String(m).padStart(2, '0')}`
  return { from: `${p}-01`, to: `${p}-${String(last).padStart(2, '0')}` }
}

export function buildGstrB2BWorkbook(b2bRows: GstrB2BExportRow[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    [...B2B_HEADERS],
    ...b2bRows.map(b2bRowToArray),
  ])
  XLSX.utils.book_append_sheet(wb, sheet, 'b2b,sez,de')
  return wb
}

export function buildGstrHsnWorkbook(hsnRows: GstrHsnExportRow[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    [...HSN_HEADERS],
    ...hsnRows.map(hsnRowToArray),
  ])
  XLSX.utils.book_append_sheet(wb, sheet, 'hsn(b2b)')
  return wb
}

export function downloadGstrOfflineExcel(opts: {
  invoices: Invoice[]
  period: string
  gstin: string
  firmName?: string
}): { ok: true; b2bCount: number; hsnCount: number; b2bFile: string; hsnFile: string } | { ok: false; error: string } {
  const gstin = (opts.gstin || '').trim().toUpperCase()
  if (!gstin) return { ok: false, error: 'Firm GSTIN missing — add it in Settings → Firm profile.' }

  const { from, to } = periodMonthBounds(opts.period)
  const monthInvoices = opts.invoices.filter(
    (i) => !i.is_deleted && i.date >= from && i.date <= to
      && (i.doc_type === 'INVOICE' || i.doc_type === 'invoice'),
  )

  const b2bRows = buildGstrB2BExportRows(monthInvoices)
  const hsnRows = buildGstrHsnB2BExportRows(monthInvoices)

  const fp = opts.period.replace('-', '')
  const safeGstin = gstin.replace(/[^A-Z0-9]/gi, '')
  const b2bFile = `b2b,sez,de_${safeGstin}_${fp}.xlsx`
  const hsnFile = `hsn(b2b)_${safeGstin}_${fp}.xlsx`

  XLSX.writeFile(buildGstrB2BWorkbook(b2bRows), b2bFile)
  // Brief gap so the browser allows a second download in the same click.
  setTimeout(() => XLSX.writeFile(buildGstrHsnWorkbook(hsnRows), hsnFile), 350)

  return { ok: true, b2bCount: b2bRows.length, hsnCount: hsnRows.length, b2bFile, hsnFile }
}
