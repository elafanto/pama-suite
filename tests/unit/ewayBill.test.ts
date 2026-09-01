import { describe, expect, it } from 'vitest'
import { buildEwayJson, getEwayEligibility, resolvePlace, validateEwayInvoice } from '@/services/ewayBill'
import type { Firm, Invoice } from '@/types/models'

const firm = {
  id: 'f1',
  name: 'Pama',
  gst: '05AAAAA0000A1Z5',
  addr: 'Addr',
  city: 'Kashipur',
  state: '05',
  pin: '244713',
} as Firm

function makeInv(over: Partial<Invoice> = {}): Invoice {
  return {
    id: 'b1',
    firm_id: 'f1',
    doc_type: 'INVOICE',
    bill_no: 'INV-0001',
    date: '2026-08-19',
    party_id: 'p1',
    party_name: 'Job Worker Co',
    party_snapshot: { gst: '05BBBBB0000B1Z5', addr: 'Buyer addr', city: 'Kashipur', pin: '244713', state: '05' },
    gst_type: 'intra',
    items: [{ item_id: null, name: 'Kraft', hsn: '4804', qty: 10, unit: 'KG', rate: 60, gst: 18 }],
    sub: 600,
    total_tax: 108,
    round_off: 0,
    grand_total: 708,
    amt_paid: 0,
    pay_status: 'UNPAID',
    notes: '',
    vehicle: 'UK06AB1234',
    created_at: '',
    updated_at: '',
    is_deleted: false,
    ...over,
  } as Invoice
}

describe('getEwayEligibility', () => {
  it('allows delivery challans', () => {
    const el = getEwayEligibility(makeInv({ doc_type: 'DELIVERY_CHALLAN', grand_total: 60000 }))
    expect(el.show).toBe(true)
  })

  it('hides credit notes', () => {
    expect(getEwayEligibility(makeInv({ doc_type: 'CREDIT_NOTE', grand_total: 60000 })).show).toBe(false)
  })
})

describe('buildEwayJson job work challan', () => {
  it('sets NIC docType CHL and subSupplyType 4', () => {
    const json = buildEwayJson([makeInv({ doc_type: 'DELIVERY_CHALLAN', bill_no: 'DC-0001' })], firm)
    expect(json.billLists[0].docType).toBe('CHL')
    expect(json.billLists[0].subSupplyType).toBe(4)
    expect(json.billLists[0].subSupplyDesc).toBe('Job Work')
    expect(json.billLists[0].docNo).toBe('DC-0001')
  })
})

describe('resolvePlace', () => {
  it('prefers explicit city', () => {
    expect(resolvePlace('Kashipur', 'Plot 5, Jaspur', '244713')).toBe('Kashipur')
  })

  it('extracts city from address when city blank', () => {
    expect(resolvePlace('', 'Plot 5, Industrial Area, Kashipur, Uttarakhand - 244713', '244713')).toBe('Kashipur')
    expect(resolvePlace('', 'Sector 2, Kashipur 244713', '244713')).toBe('Kashipur')
    expect(resolvePlace('', 'Main Road, Jaspur')).toBe('Jaspur')
  })
})

describe('validateEwayInvoice firm place', () => {
  it('passes when city empty but address has place', () => {
    const noCityFirm = { ...firm, city: '', addr: 'Plot 5, Kashipur, Uttarakhand - 244713' } as Firm
    const errors = validateEwayInvoice(makeInv(), noCityFirm)
    expect(errors.some((e) => e.includes('Firm city/place'))).toBe(false)
  })

  it('uses resolved place in JSON fromPlace', () => {
    const noCityFirm = { ...firm, city: '', addr: 'Plot 5, Kashipur, Uttarakhand - 244713' } as Firm
    const json = buildEwayJson([makeInv()], noCityFirm)
    expect(json.billLists[0].fromPlace).toBe('Kashipur')
  })
})
