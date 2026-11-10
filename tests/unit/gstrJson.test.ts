import { describe, expect, it } from 'vitest'
import { buildGstr1WorkbookFromPayload, type Gstr1ExportPayload } from '@/services/gstrExport'
import {
  buildGstr1PortalJson,
  gstr1PayloadFromWorkbook,
  gstr1PortalJsonFromExcel,
  periodToGstrFp,
  posCodeFromPlace,
  shortUqc,
  mapInvoiceTypeToPortal,
} from '@/services/gstrJson'
import * as XLSX from 'xlsx'

const samplePayload: Gstr1ExportPayload = {
  b2b: [
    {
      recipientGstin: '05AAWCS6317D1Z6',
      receiverName: 'Sivanta',
      invoiceNumber: 'INV-0055',
      invoiceDate: '4-Oct-2026',
      invoiceValue: 167076,
      placeOfSupply: '05-Uttarakhand',
      reverseCharge: 'N',
      applicableTaxRatePct: '',
      invoiceType: 'Regular B2B',
      ecommerceGstin: '',
      rate: 5,
      taxableValue: 159120,
      cessAmount: '',
    },
    {
      recipientGstin: '09ARBPK8945N1Z2',
      receiverName: 'KPS',
      invoiceNumber: 'INV-0054',
      invoiceDate: '3-Oct-2026',
      invoiceValue: 187331,
      placeOfSupply: '09-Uttar Pradesh',
      reverseCharge: 'N',
      applicableTaxRatePct: '',
      invoiceType: 'Regular B2B',
      ecommerceGstin: '',
      rate: 5,
      taxableValue: 178410,
      cessAmount: '',
    },
  ],
  b2cl: [],
  b2cs: [
    {
      type: 'OE',
      placeOfSupply: '97-Other Territory',
      applicableTaxRatePct: '',
      rate: 5,
      taxableValue: 68449,
      cessAmount: '',
      ecommerceGstin: '',
    },
  ],
  hsnB2b: [
    {
      hsn: '4819',
      description: 'Corrugated box',
      uqc: 'NOS-NUMBERS',
      totalQuantity: 73779,
      totalValue: 2898288.13,
      rate: 5,
      taxableValue: 2855936,
      igst: 42352.13,
      cgst: 0,
      sgst: 0,
      cess: '',
    },
  ],
  hsnB2c: [
    {
      hsn: '4819',
      description: 'Corrugated box',
      uqc: 'NOS-NUMBERS',
      totalQuantity: 2118,
      totalValue: 71871.45,
      rate: 5,
      taxableValue: 68449,
      igst: 3422.45,
      cgst: 0,
      sgst: 0,
      cess: '',
    },
  ],
  docs: [
    {
      nature: 'Invoices for outward supply',
      srFrom: 'INV-0054',
      srTo: 'INV-0090',
      totalNumber: 37,
      cancelled: 0,
    },
  ],
  cdnr: [],
  cdnur: [],
}

describe('gstrJson helpers', () => {
  it('maps period and POS / UQC like portal JSON', () => {
    expect(periodToGstrFp('2026-10')).toBe('102026')
    expect(periodToGstrFp('2026-09')).toBe('092026')
    expect(posCodeFromPlace('05-Uttarakhand')).toBe('05')
    expect(shortUqc('NOS-NUMBERS')).toBe('NOS')
    expect(mapInvoiceTypeToPortal('Regular B2B')).toBe('R')
  })

  it('builds portal JSON matching sample shape', () => {
    const json = buildGstr1PortalJson(samplePayload, {
      gstin: '05DGKPP4479M1ZL',
      period: '2026-10',
    })
    expect(json.gstin).toBe('05DGKPP4479M1ZL')
    expect(json.fp).toBe('102026')
    expect(json.b2b).toHaveLength(2)

    const uk = json.b2b!.find((b) => b.ctin === '05AAWCS6317D1Z6')!
    expect(uk.inv[0]).toMatchObject({
      inum: 'INV-0055',
      idt: '4-Oct-2026',
      val: 167076,
      pos: '05',
      rchrg: 'N',
      inv_typ: 'R',
    })
    expect(uk.inv[0].itms[0].itm_det).toMatchObject({
      txval: 159120,
      rt: 5,
      iamt: 0,
      camt: 3978,
      samt: 3978,
      csamt: 0,
    })

    const up = json.b2b!.find((b) => b.ctin === '09ARBPK8945N1Z2')!
    expect(up.inv[0].itms[0].itm_det.iamt).toBe(8920.5)
    expect(up.inv[0].itms[0].itm_det.camt).toBe(0)

    expect(json.b2cs![0]).toMatchObject({
      sply_ty: 'INTER',
      pos: '97',
      typ: 'OE',
      rt: 5,
      txval: 68449,
    })
    expect(json.hsn?.hsn_b2b?.[0]).toMatchObject({
      hsn_sc: '4819',
      uqc: 'NOS',
      rt: 5,
      txval: 2855936,
    })
    expect(json.doc_issue?.doc_det[0]).toMatchObject({
      doc_num: 1,
      doc_typ: 'Invoices for outward supply',
    })
    expect(json.doc_issue?.doc_det[0].docs[0]).toMatchObject({
      from: 'INV-0054',
      to: 'INV-0090',
      totnum: 37,
      cancel: 0,
      net_issue: 37,
    })
  })

  it('round-trips Excel workbook → payload → JSON', () => {
    const wb = buildGstr1WorkbookFromPayload(samplePayload)
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const json = gstr1PortalJsonFromExcel(out, {
      gstin: '05DGKPP4479M1ZL',
      period: '2026-10',
      fileName: 'GSTR1_05DGKPP4479M1ZL_202610_V2.2.xlsx',
    })
    expect(json.b2b).toHaveLength(2)
    expect(json.hsn?.hsn_b2b?.[0].uqc).toBe('NOS')
    expect(gstr1PayloadFromWorkbook(wb).b2b).toHaveLength(2)
  })
})
