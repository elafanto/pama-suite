/**
 * GST portal / offline-tool GSTR-1 JSON (same shape as return-period upload JSON).
 * Built from our V2.2 Excel export payload so Excel and JSON stay in sync.
 */
import * as XLSX from 'xlsx'
import type {
  Gstr1ExportPayload,
  GstrB2BExportRow,
  GstrB2clExportRow,
  GstrB2csExportRow,
  GstrCdnrExportRow,
  GstrCdnurExportRow,
  GstrDocsExportRow,
  GstrHsnExportRow,
} from '@/services/gstrExport'

function r2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

/** YYYY-MM → MMYYYY (portal filing period). */
export function periodToGstrFp(period: string): string {
  const [y, m] = String(period || '').split('-')
  if (!y || !m) return ''
  return `${m.padStart(2, '0')}${y}`
}

/** "05-Uttarakhand" / "05" → "05" */
export function posCodeFromPlace(place: string | undefined | null): string {
  const raw = String(place || '').trim()
  const m = raw.match(/^(\d{2})/)
  return m ? m[1] : ''
}

/** Excel UQC "NOS-NUMBERS" → portal "NOS" */
export function shortUqc(uqc: string | undefined | null): string {
  const raw = String(uqc || '').trim().toUpperCase()
  if (!raw) return 'OTH'
  const head = raw.split('-')[0]?.trim()
  return head || 'OTH'
}

export function mapInvoiceTypeToPortal(invoiceType: string | undefined): string {
  const t = String(invoiceType || '').trim().toLowerCase()
  if (!t || t.includes('regular')) return 'R'
  if (t.includes('sez') && t.includes('without')) return 'SEWOP'
  if (t.includes('sez')) return 'SEWP'
  if (t.includes('deemed')) return 'DE'
  if (t.includes('export') && t.includes('without')) return 'EXPWOP'
  if (t.includes('export')) return 'EXPWP'
  return 'R'
}

const DOC_TYP_NUM: Record<string, number> = {
  'Invoices for outward supply': 1,
  'Invoices for inward supply from unregistered person': 2,
  'Revised Invoice': 3,
  'Debit Note': 4,
  'Credit Note': 5,
  'Receipt Voucher': 6,
  'Payment Voucher': 7,
  'Refund Voucher': 8,
  'Delivery Challan for job work': 9,
  'Delivery Challan for supply on approval': 10,
  'Delivery Challan in case of liquid gas': 11,
  'Delivery Challan in cases other than by way of supply (excluding at S no. 9 to 11)': 12,
}

function taxSplit(txval: number, rate: number, inter: boolean) {
  const tax = r2((Math.abs(txval) * rate) / 100) * (txval < 0 ? -1 : 1)
  if (inter) {
    return { txval: r2(txval), rt: rate, iamt: tax, camt: 0, samt: 0, csamt: 0 }
  }
  const camt = r2(Math.abs(tax) / 2) * (tax < 0 ? -1 : 1)
  const samt = r2(tax - camt)
  return { txval: r2(txval), rt: rate, iamt: 0, camt, samt, csamt: 0 }
}

function isInterPos(pos: string, firmState: string): boolean {
  const p = posCodeFromPlace(pos)
  const f = posCodeFromPlace(firmState)
  if (!p || !f) return false
  return p !== f
}

type ItmDet = ReturnType<typeof taxSplit>
type Itm = { num: number; itm_det: ItmDet }

function buildItms(rateRows: { rate: number; taxableValue: number }[], inter: boolean): Itm[] {
  return rateRows
    .filter((r) => Math.abs(r.taxableValue) >= 0.005 || r.rate >= 0)
    .map((r, idx) => ({
      num: idx + 1,
      itm_det: taxSplit(r.taxableValue, r.rate, inter),
    }))
}

function buildB2b(rows: GstrB2BExportRow[], firmState: string) {
  // Group by GSTIN → invoice number → rate lines
  type InvAcc = {
    inum: string
    idt: string
    val: number
    pos: string
    rchrg: string
    inv_typ: string
    rates: { rate: number; taxableValue: number }[]
  }
  const byCtin = new Map<string, Map<string, InvAcc>>()

  for (const row of rows) {
    const ctin = String(row.recipientGstin || '').trim().toUpperCase()
    if (!ctin) continue
    if (!byCtin.has(ctin)) byCtin.set(ctin, new Map())
    const invMap = byCtin.get(ctin)!
    const key = String(row.invoiceNumber || '').trim()
    if (!invMap.has(key)) {
      invMap.set(key, {
        inum: key,
        idt: row.invoiceDate,
        val: r2(row.invoiceValue),
        pos: posCodeFromPlace(row.placeOfSupply),
        rchrg: row.reverseCharge || 'N',
        inv_typ: mapInvoiceTypeToPortal(row.invoiceType),
        rates: [],
      })
    }
    const inv = invMap.get(key)!
    inv.rates.push({ rate: row.rate, taxableValue: row.taxableValue })
  }

  const out: Array<{ ctin: string; inv: Array<Record<string, unknown>> }> = []
  for (const [ctin, invMap] of byCtin) {
    const invs = [...invMap.values()].map((inv) => {
      const inter = isInterPos(inv.pos, firmState)
      return {
        inum: inv.inum,
        idt: inv.idt,
        val: inv.val,
        pos: inv.pos,
        rchrg: inv.rchrg,
        inv_typ: inv.inv_typ,
        itms: buildItms(inv.rates, inter),
      }
    })
    out.push({ ctin, inv: invs })
  }
  return out
}

function buildB2cl(rows: GstrB2clExportRow[], firmState: string) {
  type InvAcc = {
    inum: string
    idt: string
    val: number
    rates: { rate: number; taxableValue: number }[]
  }
  const byPos = new Map<string, Map<string, InvAcc>>()

  for (const row of rows) {
    const pos = posCodeFromPlace(row.placeOfSupply)
    if (!byPos.has(pos)) byPos.set(pos, new Map())
    const invMap = byPos.get(pos)!
    const key = String(row.invoiceNumber || '').trim()
    if (!invMap.has(key)) {
      invMap.set(key, {
        inum: key,
        idt: row.invoiceDate,
        val: r2(row.invoiceValue),
        rates: [],
      })
    }
    invMap.get(key)!.rates.push({ rate: row.rate, taxableValue: row.taxableValue })
  }

  return [...byPos.entries()].map(([pos, invMap]) => ({
    pos,
    inv: [...invMap.values()].map((inv) => ({
      inum: inv.inum,
      idt: inv.idt,
      val: inv.val,
      itms: buildItms(inv.rates, isInterPos(pos, firmState) || true), // B2CL is always inter-state
    })),
  }))
}

function buildB2cs(rows: GstrB2csExportRow[], firmState: string) {
  return rows.map((row) => {
    const pos = posCodeFromPlace(row.placeOfSupply)
    const inter = isInterPos(pos, firmState)
    const det = taxSplit(row.taxableValue, row.rate, inter)
    return {
      sply_ty: inter ? 'INTER' : 'INTRA',
      pos,
      typ: row.type || 'OE',
      rt: row.rate,
      txval: det.txval,
      iamt: det.iamt,
      camt: det.camt,
      samt: det.samt,
      csamt: det.csamt,
    }
  })
}

function buildCdnr(rows: GstrCdnrExportRow[], firmState: string) {
  type NtAcc = {
    nt_num: string
    nt_dt: string
    ntty: string
    val: number
    pos: string
    rchrg: string
    inv_typ: string
    rates: { rate: number; taxableValue: number }[]
  }
  const byCtin = new Map<string, Map<string, NtAcc>>()

  for (const row of rows) {
    const ctin = String(row.recipientGstin || '').trim().toUpperCase()
    if (!ctin) continue
    if (!byCtin.has(ctin)) byCtin.set(ctin, new Map())
    const ntMap = byCtin.get(ctin)!
    const key = String(row.noteNumber || '').trim()
    if (!ntMap.has(key)) {
      ntMap.set(key, {
        nt_num: key,
        nt_dt: row.noteDate,
        ntty: row.noteType,
        val: r2(row.noteValue),
        pos: posCodeFromPlace(row.placeOfSupply),
        rchrg: row.reverseCharge || 'N',
        inv_typ: mapInvoiceTypeToPortal(row.noteSupplyType),
        rates: [],
      })
    }
    ntMap.get(key)!.rates.push({ rate: row.rate, taxableValue: row.taxableValue })
  }

  return [...byCtin.entries()].map(([ctin, ntMap]) => ({
    ctin,
    nt: [...ntMap.values()].map((nt) => ({
      nt_num: nt.nt_num,
      nt_dt: nt.nt_dt,
      ntty: nt.ntty,
      val: nt.val,
      pos: nt.pos,
      rchrg: nt.rchrg,
      inv_typ: nt.inv_typ,
      itms: buildItms(nt.rates, isInterPos(nt.pos, firmState)),
    })),
  }))
}

function buildCdnur(rows: GstrCdnurExportRow[], firmState: string) {
  type NtAcc = {
    nt_num: string
    nt_dt: string
    ntty: string
    val: number
    typ: string
    pos: string
    rates: { rate: number; taxableValue: number }[]
  }
  const byNote = new Map<string, NtAcc>()

  for (const row of rows) {
    const key = String(row.noteNumber || '').trim()
    if (!byNote.has(key)) {
      byNote.set(key, {
        nt_num: key,
        nt_dt: row.noteDate,
        ntty: row.noteType,
        val: r2(row.noteValue),
        typ: row.urType || 'B2CL',
        pos: posCodeFromPlace(row.placeOfSupply),
        rates: [],
      })
    }
    byNote.get(key)!.rates.push({ rate: row.rate, taxableValue: row.taxableValue })
  }

  return [...byNote.values()].map((nt) => ({
    nt_num: nt.nt_num,
    nt_dt: nt.nt_dt,
    ntty: nt.ntty,
    val: nt.val,
    typ: nt.typ,
    itms: buildItms(nt.rates, isInterPos(nt.pos, firmState)),
    pos: nt.pos,
  }))
}

function buildHsnBlock(rows: GstrHsnExportRow[]) {
  return rows.map((row, idx) => ({
    num: idx + 1,
    hsn_sc: row.hsn,
    desc: row.description || '',
    uqc: shortUqc(row.uqc),
    qty: r2(row.totalQuantity),
    txval: r2(row.taxableValue),
    iamt: r2(row.igst),
    camt: r2(row.cgst),
    samt: r2(row.sgst),
    csamt: typeof row.cess === 'number' ? r2(row.cess) : 0,
    rt: row.rate,
  }))
}

function buildDocIssue(rows: GstrDocsExportRow[]) {
  const doc_det = rows.map((row, idx) => {
    const doc_num = DOC_TYP_NUM[row.nature] ?? idx + 1
    const cancel = row.cancelled || 0
    const totnum = row.totalNumber || 0
    return {
      doc_num,
      doc_typ: row.nature,
      docs: [
        {
          num: 1,
          from: row.srFrom,
          to: row.srTo,
          totnum,
          cancel,
          net_issue: Math.max(0, totnum - cancel),
        },
      ],
    }
  })
  return { doc_det }
}

export interface Gstr1PortalJson {
  gstin: string
  fp: string
  b2b?: ReturnType<typeof buildB2b>
  b2cl?: ReturnType<typeof buildB2cl>
  b2cs?: ReturnType<typeof buildB2cs>
  cdnr?: ReturnType<typeof buildCdnr>
  cdnur?: ReturnType<typeof buildCdnur>
  hsn?: { hsn_b2b?: ReturnType<typeof buildHsnBlock>; hsn_b2c?: ReturnType<typeof buildHsnBlock> }
  doc_issue?: ReturnType<typeof buildDocIssue>
}

/** Build portal-ready GSTR-1 JSON from the same payload used for Excel V2.2. */
export function buildGstr1PortalJson(
  payload: Gstr1ExportPayload,
  opts: { gstin: string; period: string },
): Gstr1PortalJson {
  const gstin = String(opts.gstin || '').trim().toUpperCase()
  const fp = periodToGstrFp(opts.period)
  const firmState = gstin.slice(0, 2)

  const json: Gstr1PortalJson = { gstin, fp }

  const b2b = buildB2b(payload.b2b, firmState)
  if (b2b.length) json.b2b = b2b

  const b2cl = buildB2cl(payload.b2cl, firmState)
  if (b2cl.length) json.b2cl = b2cl

  const b2cs = buildB2cs(payload.b2cs, firmState)
  if (b2cs.length) json.b2cs = b2cs

  const cdnr = buildCdnr(payload.cdnr, firmState)
  if (cdnr.length) json.cdnr = cdnr

  const cdnur = buildCdnur(payload.cdnur, firmState)
  if (cdnur.length) json.cdnur = cdnur

  const hsn_b2b = buildHsnBlock(payload.hsnB2b)
  const hsn_b2c = buildHsnBlock(payload.hsnB2c)
  if (hsn_b2b.length || hsn_b2c.length) {
    json.hsn = {}
    if (hsn_b2b.length) json.hsn.hsn_b2b = hsn_b2b
    if (hsn_b2c.length) json.hsn.hsn_b2c = hsn_b2c
  }

  if (payload.docs.length) json.doc_issue = buildDocIssue(payload.docs)

  return json
}

function sheetRows(wb: XLSX.WorkBook, name: string): unknown[][] {
  const ws = wb.Sheets[name]
  if (!ws) return []
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]
}

function dataRows(aoa: unknown[][]): unknown[][] {
  // V2.2 layout: title, blank, blank, headers at row 4 (index 3), data from row 5
  if (aoa.length <= 4) return []
  return aoa.slice(4).filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
}

/** Parse our generated V2.2 workbook back into Gstr1ExportPayload (Excel → JSON path). */
export function gstr1PayloadFromWorkbook(wb: XLSX.WorkBook): Gstr1ExportPayload {
  const b2b: GstrB2BExportRow[] = dataRows(sheetRows(wb, 'b2b,sez,de')).map((r) => ({
    recipientGstin: String(r[0] || ''),
    receiverName: String(r[1] || ''),
    invoiceNumber: String(r[2] || ''),
    invoiceDate: String(r[3] || ''),
    invoiceValue: Number(r[4]) || 0,
    placeOfSupply: String(r[5] || ''),
    reverseCharge: (String(r[6] || 'N').toUpperCase() === 'Y' ? 'Y' : 'N') as 'Y' | 'N',
    applicableTaxRatePct: String(r[7] || ''),
    invoiceType: String(r[8] || 'Regular B2B'),
    ecommerceGstin: String(r[9] || ''),
    rate: Number(r[10]) || 0,
    taxableValue: Number(r[11]) || 0,
    cessAmount: r[12] === '' || r[12] == null ? '' : Number(r[12]) || 0,
  }))

  const b2cl: GstrB2clExportRow[] = dataRows(sheetRows(wb, 'b2cl')).map((r) => ({
    invoiceNumber: String(r[0] || ''),
    invoiceDate: String(r[1] || ''),
    invoiceValue: Number(r[2]) || 0,
    placeOfSupply: String(r[3] || ''),
    applicableTaxRatePct: String(r[4] || ''),
    rate: Number(r[5]) || 0,
    taxableValue: Number(r[6]) || 0,
    cessAmount: r[7] === '' || r[7] == null ? '' : Number(r[7]) || 0,
    ecommerceGstin: String(r[8] || ''),
  }))

  const b2cs: GstrB2csExportRow[] = dataRows(sheetRows(wb, 'b2cs')).map((r) => ({
    type: (String(r[0] || 'OE').toUpperCase() === 'E' ? 'E' : 'OE') as 'OE' | 'E',
    placeOfSupply: String(r[1] || ''),
    applicableTaxRatePct: String(r[2] || ''),
    rate: Number(r[3]) || 0,
    taxableValue: Number(r[4]) || 0,
    cessAmount: r[5] === '' || r[5] == null ? '' : Number(r[5]) || 0,
    ecommerceGstin: String(r[6] || ''),
  }))

  const mapHsn = (name: string): GstrHsnExportRow[] =>
    dataRows(sheetRows(wb, name)).map((r) => ({
      hsn: String(r[0] || ''),
      description: String(r[1] || ''),
      uqc: String(r[2] || ''),
      totalQuantity: Number(r[3]) || 0,
      totalValue: Number(r[4]) || 0,
      rate: Number(r[5]) || 0,
      taxableValue: Number(r[6]) || 0,
      igst: Number(r[7]) || 0,
      cgst: Number(r[8]) || 0,
      sgst: Number(r[9]) || 0,
      cess: r[10] === '' || r[10] == null ? '' : Number(r[10]) || 0,
    }))

  const docs: GstrDocsExportRow[] = dataRows(sheetRows(wb, 'docs')).map((r) => ({
    nature: String(r[0] || ''),
    srFrom: String(r[1] || ''),
    srTo: String(r[2] || ''),
    totalNumber: Number(r[3]) || 0,
    cancelled: Number(r[4]) || 0,
  }))

  const cdnr: GstrCdnrExportRow[] = dataRows(sheetRows(wb, 'cdnr')).map((r) => ({
    recipientGstin: String(r[0] || ''),
    receiverName: String(r[1] || ''),
    noteNumber: String(r[2] || ''),
    noteDate: String(r[3] || ''),
    noteType: (String(r[4] || 'C').toUpperCase() === 'D' ? 'D' : 'C') as 'C' | 'D',
    placeOfSupply: String(r[5] || ''),
    reverseCharge: (String(r[6] || 'N').toUpperCase() === 'Y' ? 'Y' : 'N') as 'Y' | 'N',
    noteSupplyType: String(r[7] || 'Regular B2B'),
    noteValue: Number(r[8]) || 0,
    applicableTaxRatePct: String(r[9] || ''),
    rate: Number(r[10]) || 0,
    taxableValue: Number(r[11]) || 0,
    cessAmount: r[12] === '' || r[12] == null ? '' : Number(r[12]) || 0,
  }))

  const cdnur: GstrCdnurExportRow[] = dataRows(sheetRows(wb, 'cdnur')).map((r) => ({
    urType: String(r[0] || 'B2CL'),
    noteNumber: String(r[1] || ''),
    noteDate: String(r[2] || ''),
    noteType: (String(r[3] || 'C').toUpperCase() === 'D' ? 'D' : 'C') as 'C' | 'D',
    placeOfSupply: String(r[4] || ''),
    noteValue: Number(r[5]) || 0,
    applicableTaxRatePct: String(r[6] || ''),
    rate: Number(r[7]) || 0,
    taxableValue: Number(r[8]) || 0,
    cessAmount: r[9] === '' || r[9] == null ? '' : Number(r[9]) || 0,
  }))

  return {
    b2b,
    b2cl,
    b2cs,
    hsnB2b: mapHsn('hsn(b2b)'),
    hsnB2c: mapHsn('hsn(b2c)'),
    docs,
    cdnr,
    cdnur,
  }
}

/** Infer YYYY-MM from filename like GSTR1_GSTIN_202610_V2.2.xlsx or from fp. */
export function periodFromGstrFilename(name: string): string {
  const m = String(name || '').match(/_(\d{6})_/)
  if (!m) return ''
  const yyyymm = m[1]
  return `${yyyymm.slice(0, 4)}-${yyyymm.slice(4, 6)}`
}

export function gstinFromGstrFilename(name: string): string {
  const m = String(name || '').match(/GSTR1_([A-Z0-9]{15})_/i)
  return m ? m[1].toUpperCase() : ''
}

/** Convert our GSTR-1 Excel workbook buffer/file → portal JSON object. */
export function gstr1PortalJsonFromExcel(
  data: ArrayBuffer | Uint8Array,
  opts?: { gstin?: string; period?: string; fileName?: string },
): Gstr1PortalJson {
  const wb = XLSX.read(data, { type: 'array' })
  const payload = gstr1PayloadFromWorkbook(wb)
  const gstin = (opts?.gstin || gstinFromGstrFilename(opts?.fileName || '')).toUpperCase()
  const period = opts?.period || periodFromGstrFilename(opts?.fileName || '')
  if (!gstin) throw new Error('GSTIN missing — pass gstin or use GSTR1_<GSTIN>_<YYYYMM>_ filename')
  if (!period) throw new Error('Period missing — pass period YYYY-MM or use _YYYYMM_ in filename')
  return buildGstr1PortalJson(payload, { gstin, period })
}

export function downloadJsonFile(fileName: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = fileName
  a.click()
  URL.revokeObjectURL(a.href)
}
