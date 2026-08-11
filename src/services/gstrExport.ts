import * as XLSX from 'xlsx'
import { getStateCode, getStateName, isInterstateGst } from '@/services/gst'
import { gstrB2B, gstrB2C } from '@/services/reports'
import type { Invoice } from '@/types/models'

/** Official GSTR-1 Excel Workbook Template V2.2 sheet names / columns. */
export const GSTR1_TEMPLATE_PATH = '/templates/GSTR1_Excel_Workbook_Template_V2.2.xlsx'

const B2B_SHEET = 'b2b,sez,de'
const B2CL_SHEET = 'b2cl'
const B2CS_SHEET = 'b2cs'
const HSN_B2B_SHEET = 'hsn(b2b)'
const HSN_B2C_SHEET = 'hsn(b2c)'
const DOCS_SHEET = 'docs'
const CDNR_SHEET = 'cdnr'
const CDNUR_SHEET = 'cdnur'

/** B2C large (inter-state) invoice threshold for Table 5 / b2cl. */
export const B2CL_INVOICE_THRESHOLD = 250000

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

const B2CL_HEADERS = [
  'Invoice Number',
  'Invoice date',
  'Invoice Value',
  'Place Of Supply',
  'Applicable % of Tax Rate',
  'Rate',
  'Taxable Value',
  'Cess Amount',
  'E-Commerce GSTIN',
] as const

const B2CS_HEADERS = [
  'Type',
  'Place Of Supply',
  'Applicable % of Tax Rate',
  'Rate',
  'Taxable Value',
  'Cess Amount',
  'E-Commerce GSTIN',
] as const

/** V2.2 order: Rate comes before Taxable Value. */
const HSN_HEADERS = [
  'HSN',
  'Description',
  'UQC',
  'Total Quantity',
  'Total Value',
  'Rate',
  'Taxable Value',
  'Integrated Tax Amount',
  'Central Tax Amount',
  'State/UT Tax Amount',
  'Cess Amount',
] as const

const DOCS_HEADERS = [
  'Nature of Document',
  'Sr. No. From',
  'Sr. No. To',
  'Total Number',
  'Cancelled',
] as const

const CDNR_HEADERS = [
  'GSTIN/UIN of Recipient',
  'Receiver Name',
  'Note Number',
  'Note Date',
  'Note Type',
  'Place Of Supply',
  'Reverse Charge',
  'Note Supply Type',
  'Note Value',
  'Applicable % of Tax Rate',
  'Rate',
  'Taxable Value',
  'Cess Amount',
] as const

const CDNUR_HEADERS = [
  'UR Type',
  'Note Number',
  'Note Date',
  'Note Type',
  'Place Of Supply',
  'Note Value',
  'Applicable % of Tax Rate',
  'Rate',
  'Taxable Value',
  'Cess Amount',
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

export interface GstrB2clExportRow {
  invoiceNumber: string
  invoiceDate: string
  invoiceValue: number
  placeOfSupply: string
  applicableTaxRatePct: string
  rate: number
  taxableValue: number
  cessAmount: number | ''
  ecommerceGstin: string
}

export interface GstrB2csExportRow {
  type: 'OE' | 'E'
  placeOfSupply: string
  applicableTaxRatePct: string
  rate: number
  taxableValue: number
  cessAmount: number | ''
  ecommerceGstin: string
}

export interface GstrHsnExportRow {
  hsn: string
  description: string
  uqc: string
  totalQuantity: number
  totalValue: number
  rate: number
  taxableValue: number
  igst: number
  cgst: number
  sgst: number
  cess: number | ''
}

export interface GstrDocsExportRow {
  nature: string
  srFrom: string
  srTo: string
  totalNumber: number
  cancelled: number
}

export interface GstrCdnrExportRow {
  recipientGstin: string
  receiverName: string
  noteNumber: string
  noteDate: string
  noteType: 'C' | 'D'
  placeOfSupply: string
  reverseCharge: 'Y' | 'N'
  noteSupplyType: string
  noteValue: number
  applicableTaxRatePct: string
  rate: number
  taxableValue: number
  cessAmount: number | ''
}

export interface GstrCdnurExportRow {
  urType: string
  noteNumber: string
  noteDate: string
  noteType: 'C' | 'D'
  placeOfSupply: string
  noteValue: number
  applicableTaxRatePct: string
  rate: number
  taxableValue: number
  cessAmount: number | ''
}

export interface Gstr1ExportPayload {
  b2b: GstrB2BExportRow[]
  b2cl: GstrB2clExportRow[]
  b2cs: GstrB2csExportRow[]
  hsnB2b: GstrHsnExportRow[]
  hsnB2c: GstrHsnExportRow[]
  docs: GstrDocsExportRow[]
  cdnr: GstrCdnrExportRow[]
  cdnur: GstrCdnurExportRow[]
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

function docKind(inv: Invoice): string {
  return String(inv.doc_type || 'INVOICE').toUpperCase()
}

function isTaxInvoice(inv: Invoice): boolean {
  const k = docKind(inv)
  return k === 'INVOICE' || k === 'BILL_OF_SUPPLY'
}

function isCreditOrDebitNote(inv: Invoice): boolean {
  const k = docKind(inv)
  return k === 'CREDIT_NOTE' || k === 'DEBIT_NOTE'
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

function isRegisteredBuyer(inv: Invoice): boolean {
  const snap = inv.party_snapshot || {}
  const gst = buyerGstin(inv)
  return !snap.is_consumer && gst.length >= 10
}

/** Inter-state B2C invoice value > ₹2.5L → b2cl; else b2cs. */
export function isB2clInvoice(inv: Invoice): boolean {
  if (isRegisteredBuyer(inv)) return false
  if (!isInterstateGst(inv.gst_type)) return false
  return r2(inv.grand_total || 0) > B2CL_INVOICE_THRESHOLD
}

export function buildGstrB2BExportRows(invoices: Invoice[]): GstrB2BExportRow[] {
  const rows: GstrB2BExportRow[] = []
  const b2b = gstrB2B(invoices.filter(isTaxInvoice)).sort(
    (a, b) => a.date.localeCompare(b.date) || a.bill_no.localeCompare(b.bill_no),
  )

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

export function buildGstrB2clExportRows(invoices: Invoice[]): GstrB2clExportRow[] {
  const rows: GstrB2clExportRow[] = []
  const list = gstrB2C(invoices.filter(isTaxInvoice))
    .filter(isB2clInvoice)
    .sort((a, b) => a.date.localeCompare(b.date) || a.bill_no.localeCompare(b.bill_no))

  for (const inv of list) {
    const buckets = invoiceRateBuckets(inv)
    if (!buckets.length) buckets.push({ rate: 0, taxable: r2(inv.sub || 0) })
    const invoiceValue = r2(inv.grand_total || 0)
    for (const bucket of buckets) {
      rows.push({
        invoiceNumber: inv.bill_no || '',
        invoiceDate: formatGstrInvoiceDate(inv.date),
        invoiceValue,
        placeOfSupply: formatPlaceOfSupply(inv),
        applicableTaxRatePct: '',
        rate: bucket.rate,
        taxableValue: bucket.taxable,
        cessAmount: '',
        ecommerceGstin: '',
      })
    }
  }
  return rows
}

export function buildGstrB2csExportRows(invoices: Invoice[]): GstrB2csExportRow[] {
  const map = new Map<string, GstrB2csExportRow>()
  const list = gstrB2C(invoices.filter(isTaxInvoice)).filter((inv) => !isB2clInvoice(inv))

  for (const inv of list) {
    const pos = formatPlaceOfSupply(inv) || '97-Other Territory'
    const buckets = invoiceRateBuckets(inv)
    if (!buckets.length) buckets.push({ rate: 0, taxable: r2(inv.sub || 0) })
    for (const bucket of buckets) {
      if (bucket.taxable <= 0) continue
      const key = `OE|${pos}|${bucket.rate}`
      if (!map.has(key)) {
        map.set(key, {
          type: 'OE',
          placeOfSupply: pos,
          applicableTaxRatePct: '',
          rate: bucket.rate,
          taxableValue: 0,
          cessAmount: '',
          ecommerceGstin: '',
        })
      }
      const row = map.get(key)!
      row.taxableValue = r2(row.taxableValue + bucket.taxable)
    }
  }

  return [...map.values()].sort(
    (a, b) => a.placeOfSupply.localeCompare(b.placeOfSupply) || a.rate - b.rate,
  )
}

function buildHsnRows(invoices: Invoice[]): GstrHsnExportRow[] {
  type Agg = GstrHsnExportRow
  const map = new Map<string, Agg>()

  for (const inv of invoices) {
    const isInter = isInterstateGst(inv.gst_type)
    for (const line of inv.items || []) {
      const hsn = (line.hsn || 'NA').trim()
      const rate = Number(line.gst) || 0
      const uqc = toGstrUqc(line.unit)
      const key = `${hsn}|${rate}|${uqc}`
      const taxable = r2((line.qty || 0) * (line.rate || 0))
      const tax = r2((taxable * rate) / 100)
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
          rate,
          taxableValue: 0,
          igst: 0,
          cgst: 0,
          sgst: 0,
          cess: '',
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

export function buildGstrHsnB2BExportRows(invoices: Invoice[]): GstrHsnExportRow[] {
  return buildHsnRows(gstrB2B(invoices.filter(isTaxInvoice)))
}

export function buildGstrHsnB2CExportRows(invoices: Invoice[]): GstrHsnExportRow[] {
  return buildHsnRows(gstrB2C(invoices.filter(isTaxInvoice)))
}

export function buildGstrDocsExportRows(invoices: Invoice[]): GstrDocsExportRow[] {
  const taxInvoices = invoices
    .filter(isTaxInvoice)
    .map((i) => i.bill_no || '')
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

  const notes = invoices
    .filter(isCreditOrDebitNote)
    .map((i) => i.bill_no || '')
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

  const rows: GstrDocsExportRow[] = []
  if (taxInvoices.length) {
    rows.push({
      nature: 'Invoices for outward supply',
      srFrom: taxInvoices[0],
      srTo: taxInvoices[taxInvoices.length - 1],
      totalNumber: taxInvoices.length,
      cancelled: 0,
    })
  }
  if (notes.length) {
    rows.push({
      nature: 'Credit Note',
      srFrom: notes[0],
      srTo: notes[notes.length - 1],
      totalNumber: notes.length,
      cancelled: 0,
    })
  }
  return rows
}

function buildNoteRateRows(inv: Invoice): { rate: number; taxable: number }[] {
  const buckets = invoiceRateBuckets(inv)
  if (!buckets.length) return [{ rate: 0, taxable: r2(inv.sub || 0) }]
  return buckets
}

export function buildGstrCdnrExportRows(invoices: Invoice[]): GstrCdnrExportRow[] {
  const rows: GstrCdnrExportRow[] = []
  const notes = invoices
    .filter(isCreditOrDebitNote)
    .filter(isRegisteredBuyer)
    .sort((a, b) => a.date.localeCompare(b.date) || a.bill_no.localeCompare(b.bill_no))

  for (const inv of notes) {
    const noteType: 'C' | 'D' = docKind(inv) === 'DEBIT_NOTE' ? 'D' : 'C'
    const noteValue = r2(inv.grand_total || 0)
    for (const bucket of buildNoteRateRows(inv)) {
      rows.push({
        recipientGstin: buyerGstin(inv),
        receiverName: inv.party_name || '',
        noteNumber: inv.bill_no || '',
        noteDate: formatGstrInvoiceDate(inv.date),
        noteType,
        placeOfSupply: formatPlaceOfSupply(inv),
        reverseCharge: 'N',
        noteSupplyType: 'Regular B2B',
        noteValue,
        applicableTaxRatePct: '',
        rate: bucket.rate,
        taxableValue: bucket.taxable,
        cessAmount: '',
      })
    }
  }
  return rows
}

export function buildGstrCdnurExportRows(invoices: Invoice[]): GstrCdnurExportRow[] {
  const rows: GstrCdnurExportRow[] = []
  const notes = invoices
    .filter(isCreditOrDebitNote)
    .filter((inv) => !isRegisteredBuyer(inv))
    .sort((a, b) => a.date.localeCompare(b.date) || a.bill_no.localeCompare(b.bill_no))

  for (const inv of notes) {
    const noteType: 'C' | 'D' = docKind(inv) === 'DEBIT_NOTE' ? 'D' : 'C'
    const noteValue = r2(inv.grand_total || 0)
    for (const bucket of buildNoteRateRows(inv)) {
      rows.push({
        urType: 'B2CL',
        noteNumber: inv.bill_no || '',
        noteDate: formatGstrInvoiceDate(inv.date),
        noteType,
        placeOfSupply: formatPlaceOfSupply(inv),
        noteValue,
        applicableTaxRatePct: '',
        rate: bucket.rate,
        taxableValue: bucket.taxable,
        cessAmount: '',
      })
    }
  }
  return rows
}

export function buildGstr1ExportPayload(invoices: Invoice[]): Gstr1ExportPayload {
  return {
    b2b: buildGstrB2BExportRows(invoices),
    b2cl: buildGstrB2clExportRows(invoices),
    b2cs: buildGstrB2csExportRows(invoices),
    hsnB2b: buildGstrHsnB2BExportRows(invoices),
    hsnB2c: buildGstrHsnB2CExportRows(invoices),
    docs: buildGstrDocsExportRows(invoices),
    cdnr: buildGstrCdnrExportRows(invoices),
    cdnur: buildGstrCdnurExportRows(invoices),
  }
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

function b2clRowToArray(row: GstrB2clExportRow): (string | number)[] {
  return [
    row.invoiceNumber,
    row.invoiceDate,
    row.invoiceValue,
    row.placeOfSupply,
    row.applicableTaxRatePct,
    row.rate,
    row.taxableValue,
    row.cessAmount,
    row.ecommerceGstin,
  ]
}

function b2csRowToArray(row: GstrB2csExportRow): (string | number)[] {
  return [
    row.type,
    row.placeOfSupply,
    row.applicableTaxRatePct,
    row.rate,
    row.taxableValue,
    row.cessAmount,
    row.ecommerceGstin,
  ]
}

function hsnRowToArray(row: GstrHsnExportRow): (string | number)[] {
  return [
    row.hsn,
    row.description,
    row.uqc,
    row.totalQuantity,
    row.totalValue,
    row.rate,
    row.taxableValue,
    row.igst,
    row.cgst,
    row.sgst,
    row.cess,
  ]
}

function docsRowToArray(row: GstrDocsExportRow): (string | number)[] {
  return [row.nature, row.srFrom, row.srTo, row.totalNumber, row.cancelled]
}

function cdnrRowToArray(row: GstrCdnrExportRow): (string | number)[] {
  return [
    row.recipientGstin,
    row.receiverName,
    row.noteNumber,
    row.noteDate,
    row.noteType,
    row.placeOfSupply,
    row.reverseCharge,
    row.noteSupplyType,
    row.noteValue,
    row.applicableTaxRatePct,
    row.rate,
    row.taxableValue,
    row.cessAmount,
  ]
}

function cdnurRowToArray(row: GstrCdnurExportRow): (string | number)[] {
  return [
    row.urType,
    row.noteNumber,
    row.noteDate,
    row.noteType,
    row.placeOfSupply,
    row.noteValue,
    row.applicableTaxRatePct,
    row.rate,
    row.taxableValue,
    row.cessAmount,
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

function filterMonthDocs(invoices: Invoice[], from: string, to: string): Invoice[] {
  return invoices.filter(
    (i) =>
      !i.is_deleted
      && i.date >= from
      && i.date <= to
      && (isTaxInvoice(i) || isCreditOrDebitNote(i)),
  )
}

function sheetTitleRows(title: string, headers: readonly string[]): (string | number)[][] {
  return [
    [title],
    [],
    [],
    [...headers],
  ]
}

/** Fallback workbook when official template file is unavailable (tests / offline). */
export function buildGstr1WorkbookFromPayload(payload: Gstr1ExportPayload): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()

  const sheets: Array<{ name: string; title: string; headers: readonly string[]; rows: (string | number)[][] }> = [
    {
      name: B2B_SHEET,
      title: 'Summary For B2B, SEZ, DE (4A, 4B, 6B, 6C)',
      headers: B2B_HEADERS,
      rows: payload.b2b.map(b2bRowToArray),
    },
    {
      name: B2CL_SHEET,
      title: 'Summary For B2CL(5)',
      headers: B2CL_HEADERS,
      rows: payload.b2cl.map(b2clRowToArray),
    },
    {
      name: B2CS_SHEET,
      title: 'Summary For B2CS(7)',
      headers: B2CS_HEADERS,
      rows: payload.b2cs.map(b2csRowToArray),
    },
    {
      name: HSN_B2B_SHEET,
      title: 'Summary For HSN(12)',
      headers: HSN_HEADERS,
      rows: payload.hsnB2b.map(hsnRowToArray),
    },
    {
      name: HSN_B2C_SHEET,
      title: 'Summary For HSN(12)',
      headers: HSN_HEADERS,
      rows: payload.hsnB2c.map(hsnRowToArray),
    },
    {
      name: DOCS_SHEET,
      title: 'Summary of documents issued during the tax period (13)',
      headers: DOCS_HEADERS,
      rows: payload.docs.map(docsRowToArray),
    },
    {
      name: CDNR_SHEET,
      title: 'Summary For CDNR(9B)',
      headers: CDNR_HEADERS,
      rows: payload.cdnr.map(cdnrRowToArray),
    },
    {
      name: CDNUR_SHEET,
      title: 'Summary For CDNUR(9B)',
      headers: CDNUR_HEADERS,
      rows: payload.cdnur.map(cdnurRowToArray),
    },
  ]

  for (const s of sheets) {
    const aoa = [...sheetTitleRows(s.title, s.headers), ...s.rows]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), s.name)
  }
  return wb
}

function fillSheetFromRow5(wb: XLSX.WorkBook, sheetName: string, rows: (string | number)[][]) {
  const ws = wb.Sheets[sheetName]
  if (!ws || !rows.length) return
  XLSX.utils.sheet_add_aoa(ws, rows, { origin: 'A5' })
}

export function fillGstr1TemplateWorkbook(
  templateWb: XLSX.WorkBook,
  payload: Gstr1ExportPayload,
): XLSX.WorkBook {
  fillSheetFromRow5(templateWb, B2B_SHEET, payload.b2b.map(b2bRowToArray))
  fillSheetFromRow5(templateWb, B2CL_SHEET, payload.b2cl.map(b2clRowToArray))
  fillSheetFromRow5(templateWb, B2CS_SHEET, payload.b2cs.map(b2csRowToArray))
  fillSheetFromRow5(templateWb, HSN_B2B_SHEET, payload.hsnB2b.map(hsnRowToArray))
  fillSheetFromRow5(templateWb, HSN_B2C_SHEET, payload.hsnB2c.map(hsnRowToArray))
  fillSheetFromRow5(templateWb, DOCS_SHEET, payload.docs.map(docsRowToArray))
  fillSheetFromRow5(templateWb, CDNR_SHEET, payload.cdnr.map(cdnrRowToArray))
  fillSheetFromRow5(templateWb, CDNUR_SHEET, payload.cdnur.map(cdnurRowToArray))
  return templateWb
}

export async function loadGstr1TemplateWorkbook(
  templateUrl = GSTR1_TEMPLATE_PATH,
): Promise<XLSX.WorkBook | null> {
  try {
    const res = await fetch(templateUrl)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    return XLSX.read(buf, { type: 'array' })
  } catch {
    return null
  }
}

/** @deprecated kept for older call sites — prefer buildGstr1WorkbookFromPayload */
export function buildGstrB2BWorkbook(b2bRows: GstrB2BExportRow[]): XLSX.WorkBook {
  return buildGstr1WorkbookFromPayload({
    b2b: b2bRows,
    b2cl: [],
    b2cs: [],
    hsnB2b: [],
    hsnB2c: [],
    docs: [],
    cdnr: [],
    cdnur: [],
  })
}

/** @deprecated */
export function buildGstrHsnWorkbook(hsnRows: GstrHsnExportRow[]): XLSX.WorkBook {
  return buildGstr1WorkbookFromPayload({
    b2b: [],
    b2cl: [],
    b2cs: [],
    hsnB2b: hsnRows,
    hsnB2c: [],
    docs: [],
    cdnr: [],
    cdnur: [],
  })
}

export type GstrDownloadResult =
  | {
      ok: true
      file: string
      usedOfficialTemplate: boolean
      counts: {
        b2b: number
        b2cl: number
        b2cs: number
        hsnB2b: number
        hsnB2c: number
        docs: number
        cdnr: number
        cdnur: number
      }
    }
  | { ok: false; error: string }

export async function downloadGstrOfflineExcel(opts: {
  invoices: Invoice[]
  period: string
  gstin: string
  firmName?: string
  /** Prefer generated V2.2 sheets; official 7MB template freezes many browsers. */
  useOfficialTemplate?: boolean
  templateUrl?: string
}): Promise<GstrDownloadResult> {
  const gstin = (opts.gstin || '').trim().toUpperCase()
  if (!gstin) return { ok: false, error: 'Firm GSTIN missing — add it in Settings → Firm profile.' }

  const { from, to } = periodMonthBounds(opts.period)
  const monthDocs = filterMonthDocs(opts.invoices, from, to)
  const payload = buildGstr1ExportPayload(monthDocs)

  // Default: lightweight workbook with official sheet names + V2.2 column headers.
  // Optional: fill GST portal template (large; can hang mobile / low-RAM browsers).
  let usedOfficialTemplate = false
  let wb = buildGstr1WorkbookFromPayload(payload)
  if (opts.useOfficialTemplate) {
    const template = await loadGstr1TemplateWorkbook(opts.templateUrl || GSTR1_TEMPLATE_PATH)
    if (template) {
      wb = fillGstr1TemplateWorkbook(template, payload)
      usedOfficialTemplate = true
    }
  }

  const fp = opts.period.replace('-', '')
  const safeGstin = gstin.replace(/[^A-Z0-9]/gi, '')
  const file = `GSTR1_${safeGstin}_${fp}_V2.2.xlsx`
  XLSX.writeFile(wb, file)

  return {
    ok: true,
    file,
    usedOfficialTemplate,
    counts: {
      b2b: payload.b2b.length,
      b2cl: payload.b2cl.length,
      b2cs: payload.b2cs.length,
      hsnB2b: payload.hsnB2b.length,
      hsnB2c: payload.hsnB2c.length,
      docs: payload.docs.length,
      cdnr: payload.cdnr.length,
      cdnur: payload.cdnur.length,
    },
  }
}
