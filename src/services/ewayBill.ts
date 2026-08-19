import { getStateCode, isGstinValid } from '@/services/gst'
import {
  resolveLivePartyDetails,
  resolveLiveShipDetails,
  resolvePartyById,
  type PartyLookup,
} from '@/services/invoiceDisplay'
import type { Firm, Invoice, Party, ShipDetails } from '@/types/models'

const EWAY_THRESHOLD = 50000

export type EwayLevel = 'required' | 'suggested' | 'none'

export interface EwayEligibility {
  show: boolean
  autoSelect: boolean
  level: EwayLevel
  reason: string
}

/** Intra: ≥ ₹50k. Inter-state: all bills (below ₹50k = suggested). Job-work challans use the same value rules. */
export function getEwayEligibility(invoice: Pick<Invoice, 'doc_type' | 'grand_total' | 'gst_type' | 'is_deleted' | 'cancelled_at'>): EwayEligibility {
  const dt = String(invoice.doc_type || 'INVOICE').toUpperCase()
  if (dt !== 'INVOICE' && dt !== 'DELIVERY_CHALLAN') {
    return { show: false, autoSelect: false, level: 'none', reason: 'Sirf Tax Invoice / Delivery Challan ke liye E-Way JSON' }
  }
  if (invoice.is_deleted || invoice.cancelled_at) {
    return { show: false, autoSelect: false, level: 'none', reason: '' }
  }

  const total = Number(invoice.grand_total) || 0
  const isInter = invoice.gst_type === 'inter' || invoice.gst_type === 'IGST'

  if (isInter) {
    if (total >= EWAY_THRESHOLD) {
      return {
        show: true,
        autoSelect: true,
        level: 'required',
        reason: 'Inter-state — ₹50,000+ par E-Way zaroori',
      }
    }
    return {
      show: true,
      autoSelect: true,
      level: 'suggested',
      reason: 'Inter-state — ₹50,000 se kam (suggested; agar transport ho to bana lo)',
    }
  }

  if (total >= EWAY_THRESHOLD) {
    return {
      show: true,
      autoSelect: true,
      level: 'required',
      reason: 'Same state — ₹50,000+ par E-Way zaroori',
    }
  }

  return { show: false, autoSelect: false, level: 'none', reason: '' }
}

const fmtD = (iso: string) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const ewbDocType = (dt: string) => {
  const u = String(dt || 'INVOICE').toUpperCase()
  if (u === 'DELIVERY_CHALLAN') return 'CHL'
  if (u === 'BILL_OF_SUPPLY') return 'BIL'
  return u === 'CREDIT_NOTE' || u === 'DEBIT_NOTE' ? 'OTH' : 'INV'
}

const unitMap: Record<string, string> = {
  KGS: 'KGS', KG: 'KGS', MTR: 'MTR', M: 'MTR', NOS: 'NOS', PCS: 'NOS', BOX: 'BOX',
  LTR: 'LTR', PAC: 'PAC', PKT: 'PAC', BAG: 'BAG', ROL: 'ROL', SET: 'SET', TON: 'TON', OTH: 'OTH',
}
const ewbUnit = (u: string) => unitMap[(u || '').toUpperCase()] || 'OTH'
const r2 = (v: number) => Math.round((v || 0) * 100) / 100

const cleanGstin = (g?: string) => {
  if (!g) return 'URP'
  const c = String(g).replace(/\s/g, '').toUpperCase()
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(c) ? c : 'URP'
}

function validPin(pin: unknown) {
  return /^\d{6}$/.test(String(pin || '').trim())
}

function partyDetails(inv: Invoice, partyLookup?: PartyLookup): Partial<Party> {
  const live = resolvePartyById(partyLookup, inv.party_id)
  return resolveLivePartyDetails(inv, live)
}

function shipDetails(inv: Invoice, partyLookup?: PartyLookup): ShipDetails | null | undefined {
  const live = resolvePartyById(partyLookup, inv.party_id)
  return resolveLiveShipDetails(inv, live)
}

function parseStateCode(stateOrGst: string | undefined): number {
  const fromGst = getStateCode(stateOrGst || '')
  if (fromGst) return parseInt(fromGst, 10) || 0
  const n = parseInt(String(stateOrGst || '').trim(), 10)
  return Number.isFinite(n) ? n : 0
}

/** NIC: Bill-to = buyer GST/state; ship-to = consignee addr/PIN/actualToStateCode. */
function ewayToParties(inv: Invoice, partyLookup?: PartyLookup) {
  const cust = partyDetails(inv, partyLookup)
  const ship = shipDetails(inv, partyLookup)
  const hasShip = inv.sameAsBuyer === false && ship && ship.addr?.trim()

  const buyerGst = cleanGstin(cust.gst || '')
  const billToState = buyerGst !== 'URP'
    ? parseStateCode(buyerGst) || parseStateCode(cust.state)
    : parseStateCode(cust.state)

  if (!hasShip) {
    const pin = parseInt(String(cust.pin || '0'), 10) || 0
    return {
      hasShip: false,
      transType: 1 as const,
      toGstin: buyerGst,
      toTrdName: inv.party_name || '',
      toAddr1: cust.addr || '',
      toAddr2: cust.city || '',
      toPlace: cust.city || '',
      toPincode: pin,
      toStateCode: billToState,
      actualToStateCode: billToState,
    }
  }

  const shipGst = cleanGstin(ship.gstin || cust.gst || '')
  const shipState = parseStateCode(ship.state) || parseStateCode(shipGst) || billToState
  const shipPin = parseInt(String(ship.pin || '0'), 10) || 0

  return {
    hasShip: true,
    transType: 4 as const,
    toGstin: buyerGst,
    toTrdName: inv.party_name || '',
    toAddr1: ship.addr || '',
    toAddr2: ship.city || '',
    toPlace: ship.city || '',
    toPincode: shipPin,
    toStateCode: billToState,
    actualToStateCode: shipState,
  }
}

export function validateEwayInvoice(inv: Invoice, firm: Firm, partyLookup?: PartyLookup): string[] {
  const errors: string[] = []
  if (!isGstinValid(firm.gst)) errors.push('Firm GSTIN valid nahi hai')
  if (!firm.addr?.trim()) errors.push('Firm address missing hai')
  if (!firm.city?.trim()) errors.push('Firm city/place missing hai')
  if (!validPin(firm.pin)) errors.push('Firm PIN 6 digit hona chahiye')
  const firmState = parseInt(firm.state || getStateCode(firm.gst) || '', 10)
  if (!firmState) errors.push('Firm state code missing hai')

  if (!(inv.vehicle || '').trim()) errors.push(`${inv.bill_no}: vehicle number missing hai`)

  const to = ewayToParties(inv, partyLookup)
  const cust = partyDetails(inv, partyLookup)

  if (!to.toAddr1?.trim()) {
    errors.push(`${inv.bill_no}: ${to.hasShip ? 'consignee' : 'buyer'} address missing hai`)
  }
  if (!to.toPlace?.trim()) {
    errors.push(`${inv.bill_no}: ${to.hasShip ? 'consignee' : 'buyer'} city/place missing hai`)
  }
  if (!validPin(to.toPincode)) {
    errors.push(`${inv.bill_no}: ${to.hasShip ? 'consignee' : 'buyer'} PIN 6 digit hona chahiye`)
  }
  if (!to.toStateCode) {
    errors.push(`${inv.bill_no}: buyer state code missing hai (GSTIN ya party master)`)
  }
  if (!to.actualToStateCode) {
    errors.push(`${inv.bill_no}: ${to.hasShip ? 'consignee' : 'buyer'} state code missing hai`)
  }
  if (!to.hasShip && cust.gst) {
    const gstState = parseStateCode(cust.gst)
    if (gstState && cust.state && parseStateCode(cust.state) && parseStateCode(cust.state) !== gstState) {
      errors.push(
        `${inv.bill_no}: party state (${cust.state}) GSTIN state (${gstState}) se match nahi — Uttarakhand = 05, UP = 09`,
      )
    }
  }

  for (const [idx, item] of (inv.items || []).entries()) {
    const gst = Number(item.gst)
    if (!Number.isFinite(gst)) errors.push(`${inv.bill_no}: line ${idx + 1} GST invalid hai`)
  }
  return errors
}

/** NIC e-Way bulk JSON (PamaTools / v1.0.0621 compatible). */
export function buildEwayJson(invoices: Invoice[], firm: Firm, partyLookup?: PartyLookup) {
  const fromSC = parseInt(firm.state, 10) || parseInt(getStateCode(firm.gst) || '0', 10) || 0
  const fromGstn = cleanGstin(firm.gst)

  const billLists = invoices.map((b) => {
    const isInter = b.gst_type === 'inter' || b.gst_type === 'IGST'
    const to = ewayToParties(b, partyLookup)

    const vehNo = (b.vehicle || '').toUpperCase().replace(/\s/g, '')
    const lrNo = b.lr || ''
    const transMode = parseInt(String(b.transMode || '1'), 10) || 1

    const totalTax = r2(b.total_tax)
    const cgstVal = !isInter ? r2(totalTax / 2) : 0
    const sgstVal = !isInter ? r2(totalTax / 2) : 0
    const igstVal = isInter ? totalTax : 0

    const mainHsn = String(parseInt(String(b.items?.[0]?.hsn || '48043100'), 10) || 48043100)

    const isChallan = String(b.doc_type || '').toUpperCase() === 'DELIVERY_CHALLAN'
    return {
      userGstin: fromGstn,
      supplyType: 'O',
      subSupplyType: isChallan ? 4 : 1,
      subSupplyDesc: isChallan ? 'Job Work' : '',
      docType: ewbDocType(b.doc_type),
      docNo: String(b.bill_no),
      docDate: fmtD(b.date),
      transType: to.transType,

      fromGstin: fromGstn,
      fromTrdName: firm.name || '',
      fromAddr1: firm.addr || '',
      fromAddr2: firm.city || '',
      fromPlace: firm.city || (firm.addr || '').split(',').pop()?.trim() || '',
      fromPincode: parseInt(firm.pin, 10) || 0,
      fromStateCode: fromSC,
      actualFromStateCode: fromSC,

      toGstin: to.toGstin,
      toTrdName: to.toTrdName,
      toAddr1: to.toAddr1,
      toAddr2: to.toAddr2,
      toPlace: to.toPlace,
      toPincode: to.toPincode,
      toStateCode: to.toStateCode,
      actualToStateCode: to.actualToStateCode,

      totalValue: r2(b.sub),
      cgstValue: cgstVal,
      sgstValue: sgstVal,
      igstValue: igstVal,
      cessValue: 0,
      TotNonAdvolVal: 0,
      OthValue: r2(b.round_off || 0),
      totInvValue: r2(b.grand_total),

      transMode,
      transDistance: parseInt(String(b.distance || 0), 10) || 1,
      transporterName: b.transporterName || '',
      transporterId: b.transporterId || '',
      transDocNo: lrNo,
      transDocDate: lrNo ? fmtD(b.date) : '',
      vehicleNo: vehNo,
      vehicleType: 'R',
      mainHsnCode: parseInt(mainHsn, 10) || 0,

      itemList: (b.items || []).map((item, idx) => ({
        itemNo: idx + 1,
        productName: item.name || '',
        productDesc: [item.size, item.gsm ? `${item.gsm} gsm` : '', item.bf ? `${item.bf} BF` : ''].filter(Boolean).join(', ') || item.name || '',
        hsnCode: String(parseInt(String(item.hsn || '48043100'), 10) || 48043100),
        quantity: r2(item.qty),
        qtyUnit: ewbUnit(item.unit),
        taxableAmount: r2((item.qty || 0) * (item.rate || 0)),
        sgstRate: !isInter ? r2((Number(item.gst) || 0) / 2) : 0,
        cgstRate: !isInter ? r2((Number(item.gst) || 0) / 2) : 0,
        igstRate: isInter ? r2(Number(item.gst) || 0) : 0,
        cessRate: 0,
        cessNonAdvol: 0,
      })),
    }
  })

  return { version: '1.0.0621', billLists }
}

export function downloadEwayJson(invoices: Invoice[], firm: Firm, partyLookup?: PartyLookup) {
  if (!invoices.length) throw new Error('Koi bill select nahi')
  if (!firm) throw new Error('Active firm set karein')
  const errors = invoices.flatMap((inv) => validateEwayInvoice(inv, firm, partyLookup))
  if (errors.length) throw new Error(errors.slice(0, 8).join('\n'))

  const json = buildEwayJson(invoices, firm, partyLookup)
  if (!json.billLists.length) throw new Error('Valid bills nahi mili')

  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const n = new Date()
  a.download = `EWayBill_${n.toISOString().slice(0, 10)}_${n.toTimeString().slice(0, 8).replace(/:/g, '-')}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return json.billLists.length
}
