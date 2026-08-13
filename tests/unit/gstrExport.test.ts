import { describe, expect, it } from 'vitest'
import {
  B2CL_INVOICE_THRESHOLD,
  buildGstr1ExportPayload,
  buildGstr1WorkbookFromPayload,
  buildGstrB2BExportRows,
  buildGstrB2clExportRows,
  buildGstrB2csExportRows,
  buildGstrDocsExportRows,
  buildGstrHsnB2BExportRows,
  formatGstrInvoiceDate,
  formatPlaceOfSupply,
  isB2clInvoice,
  periodMonthBounds,
  toGstrUqc,
} from '@/services/gstrExport'
import type { Invoice } from '@/types/models'

function makeInvoice(partial: Partial<Invoice> & Pick<Invoice, 'id'>): Invoice {
  return {
    firm_id: 'f1',
    doc_type: 'INVOICE',
    bill_no: 'INV-1',
    date: '2026-05-27',
    party_id: 'p1',
    party_name: 'Buyer Ltd',
    party_snapshot: { gst: '05AFAPH7995A1ZM', is_consumer: false },
    gst_type: 'intra',
    items: [],
    sub: 0,
    total_tax: 0,
    round_off: 0,
    grand_total: 0,
    amt_paid: 0,
    pay_status: 'UNPAID',
    notes: '',
    created_at: '',
    updated_at: '',
    is_deleted: false,
    ...partial,
  }
}

describe('formatGstrInvoiceDate', () => {
  it('formats ISO date as dd-MMM-yyyy', () => {
    expect(formatGstrInvoiceDate('2026-05-27')).toBe('27-May-2026')
  })
})

describe('formatPlaceOfSupply', () => {
  it('uses buyer GSTIN state code and name', () => {
    const inv = makeInvoice({
      id: '1',
      party_snapshot: { gst: '09AHNPR9960N1Z3', is_consumer: false },
    })
    expect(formatPlaceOfSupply(inv)).toBe('09-Uttar Pradesh')
  })
})

describe('periodMonthBounds', () => {
  it('returns first and last day of month', () => {
    expect(periodMonthBounds('2026-05')).toEqual({ from: '2026-05-01', to: '2026-05-31' })
  })
})

describe('buildGstrB2BExportRows', () => {
  it('exports one row per tax rate for B2B invoices', () => {
    const inv = makeInvoice({
      id: '1',
      bill_no: 'INV-0003',
      grand_total: 17454,
      sub: 16622.5,
      total_tax: 831.5,
      taxBuckets: { 5: { taxable: 16622.5, tax: 831.12 } },
      items: [{ item_id: null, name: 'Paper', hsn: '4707', qty: 1090, unit: 'KG', rate: 15.25, gst: 5 }],
    })
    const rows = buildGstrB2BExportRows([inv])
    expect(rows).toHaveLength(1)
    expect(rows[0].recipientGstin).toBe('05AFAPH7995A1ZM')
    expect(rows[0].invoiceNumber).toBe('INV-0003')
    expect(rows[0].invoiceDate).toBe('27-May-2026')
    expect(rows[0].invoiceValue).toBe(17454)
    expect(rows[0].rate).toBe(5)
    expect(rows[0].taxableValue).toBe(16622.5)
    expect(rows[0].invoiceType).toBe('Regular B2B')
  })

  it('skips B2C / consumer invoices', () => {
    const b2c = makeInvoice({
      id: '2',
      party_snapshot: { is_consumer: true },
    })
    expect(buildGstrB2BExportRows([b2c])).toHaveLength(0)
  })
})

describe('buildGstrHsnB2BExportRows', () => {
  it('aggregates HSN with CGST/SGST for intra-state and V2.2 rate-before-taxable shape', () => {
    const inv = makeInvoice({
      id: '1',
      gst_type: 'intra',
      items: [{ item_id: null, name: 'Paper', hsn: '4707', qty: 100, unit: 'KG', rate: 100, gst: 5 }],
    })
    const rows = buildGstrHsnB2BExportRows([inv])
    expect(rows).toHaveLength(1)
    expect(rows[0].hsn).toBe('4707')
    expect(rows[0].uqc).toBe(toGstrUqc('KG'))
    expect(rows[0].taxableValue).toBe(10000)
    expect(rows[0].rate).toBe(5)
    expect(rows[0].cgst).toBe(250)
    expect(rows[0].sgst).toBe(250)
    expect(rows[0].igst).toBe(0)
    expect(rows[0].totalValue).toBe(10500)
  })

  it('uses IGST for inter-state', () => {
    const inv = makeInvoice({
      id: '2',
      gst_type: 'inter',
      items: [{ item_id: null, name: 'Boxes', hsn: '48191010', qty: 10, unit: 'NOS', rate: 1000, gst: 5 }],
    })
    const rows = buildGstrHsnB2BExportRows([inv])
    expect(rows[0].igst).toBe(500)
    expect(rows[0].cgst).toBe(0)
    expect(rows[0].sgst).toBe(0)
  })
})

describe('B2C sheets', () => {
  it('aggregates small B2C into b2cs by POS + rate', () => {
    const inv = makeInvoice({
      id: 'c1',
      party_snapshot: { is_consumer: true, state: '05' },
      ship: { name: '', phone: '', addr: '', city: '', pin: '', email: '', gstin: '', state: '05' },
      gst_type: 'intra',
      grand_total: 5000,
      taxBuckets: { 5: { taxable: 4762, tax: 238 } },
    })
    const rows = buildGstrB2csExportRows([inv])
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].type).toBe('OE')
    expect(rows[0].rate).toBe(5)
    expect(rows[0].taxableValue).toBe(4762)
  })

  it('routes large interstate B2C to b2cl', () => {
    const inv = makeInvoice({
      id: 'c2',
      party_snapshot: { is_consumer: true },
      gst_type: 'inter',
      grand_total: B2CL_INVOICE_THRESHOLD + 1,
      bill_no: 'INV-L1',
      taxBuckets: { 18: { taxable: 220000, tax: 39600 } },
    })
    expect(isB2clInvoice(inv)).toBe(true)
    expect(buildGstrB2clExportRows([inv])).toHaveLength(1)
    expect(buildGstrB2csExportRows([inv])).toHaveLength(0)
  })
})

describe('buildGstr1WorkbookFromPayload', () => {
  it('creates official V2.2 sheet names with headers on row 4', () => {
    const inv = makeInvoice({
      id: '1',
      taxBuckets: { 5: { taxable: 1000, tax: 50 } },
      grand_total: 1050,
      items: [{ item_id: null, name: 'Paper', hsn: '4707', qty: 10, unit: 'KG', rate: 100, gst: 5 }],
    })
    const payload = buildGstr1ExportPayload([inv])
    const wb = buildGstr1WorkbookFromPayload(payload)
    expect(wb.SheetNames).toEqual(
      expect.arrayContaining(['b2b,sez,de', 'b2cs', 'b2cl', 'hsn(b2b)', 'hsn(b2c)', 'docs', 'cdnr', 'cdnur']),
    )
    const b2b = wb.Sheets['b2b,sez,de']
    expect(b2b.A4.v).toBe('GSTIN/UIN of Recipient')
    expect(b2b.K4.v).toBe('Rate')
    const hsn = wb.Sheets['hsn(b2b)']
    expect(hsn.F4.v).toBe('Rate')
    expect(hsn.G4.v).toBe('Taxable Value')
  })
})

describe('buildGstrDocsExportRows / Table 13 cancelled', () => {
  it('counts soft-deleted invoices as Cancelled and keeps them out of B2B', () => {
    const active = makeInvoice({
      id: 'a',
      bill_no: 'INV-0001',
      taxBuckets: { 5: { taxable: 1000, tax: 50 } },
      grand_total: 1050,
    })
    const cancelled = makeInvoice({
      id: 'c',
      bill_no: 'INV-0002',
      is_deleted: true,
      taxBuckets: { 5: { taxable: 500, tax: 25 } },
      grand_total: 525,
    })
    const later = makeInvoice({
      id: 'b',
      bill_no: 'INV-0003',
      taxBuckets: { 5: { taxable: 800, tax: 40 } },
      grand_total: 840,
    })
    const docs = buildGstrDocsExportRows([active, cancelled, later])
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      nature: 'Invoices for outward supply',
      srFrom: 'INV-0001',
      srTo: 'INV-0003',
      totalNumber: 3,
      cancelled: 1,
    })
    const payload = buildGstr1ExportPayload([active, cancelled, later])
    expect(payload.b2b.every((r) => r.invoiceNumber !== 'INV-0002')).toBe(true)
    expect(payload.b2b.map((r) => r.invoiceNumber).sort()).toEqual(['INV-0001', 'INV-0003'])
    expect(payload.docs[0].cancelled).toBe(1)
  })

  it('counts cancelled_at (visible cancel) in Table 13 and excludes from B2B', () => {
    const liveCancel = makeInvoice({
      id: 'x',
      bill_no: 'INV-0010',
      cancelled_at: '2026-05-20T10:00:00.000Z',
      taxBuckets: { 5: { taxable: 100, tax: 5 } },
      grand_total: 105,
    })
    const active = makeInvoice({
      id: 'y',
      bill_no: 'INV-0011',
      taxBuckets: { 5: { taxable: 200, tax: 10 } },
      grand_total: 210,
    })
    const payload = buildGstr1ExportPayload([liveCancel, active])
    expect(payload.docs[0]).toMatchObject({
      srFrom: 'INV-0010',
      srTo: 'INV-0011',
      totalNumber: 2,
      cancelled: 1,
    })
    expect(payload.b2b.map((r) => r.invoiceNumber)).toEqual(['INV-0011'])
  })

  it('still emits docs when the period has only cancelled invoices', () => {
    const onlyCancelled = makeInvoice({
      id: 'x',
      bill_no: 'INV-0005',
      is_deleted: true,
    })
    const payload = buildGstr1ExportPayload([onlyCancelled])
    expect(payload.b2b).toHaveLength(0)
    expect(payload.b2cs).toHaveLength(0)
    expect(payload.docs).toEqual([
      {
        nature: 'Invoices for outward supply',
        srFrom: 'INV-0005',
        srTo: 'INV-0005',
        totalNumber: 1,
        cancelled: 1,
      },
    ])
  })

  it('separates Credit Note and Debit Note natures and counts cancelled notes', () => {
    const cn = makeInvoice({
      id: 'cn1',
      bill_no: 'CN-0001',
      doc_type: 'CREDIT_NOTE',
    })
    const cnDel = makeInvoice({
      id: 'cn2',
      bill_no: 'CN-0002',
      doc_type: 'CREDIT_NOTE',
      is_deleted: true,
    })
    const dn = makeInvoice({
      id: 'dn1',
      bill_no: 'DN-0001',
      doc_type: 'DEBIT_NOTE',
    })
    const docs = buildGstrDocsExportRows([cn, cnDel, dn])
    expect(docs).toEqual([
      {
        nature: 'Credit Note',
        srFrom: 'CN-0001',
        srTo: 'CN-0002',
        totalNumber: 2,
        cancelled: 1,
      },
      {
        nature: 'Debit Note',
        srFrom: 'DN-0001',
        srTo: 'DN-0001',
        totalNumber: 1,
        cancelled: 0,
      },
    ])
  })
})
