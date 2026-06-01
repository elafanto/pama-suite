import { getStateCode, isGstinValid } from '@/services/gst'
import type { Firm, Invoice, Party } from '@/types/models'

const EWAY_THRESHOLD = 50000

export type EwayLevel = 'required' | 'suggested' | 'none'

export interface EwayEligibility {
  show: boolean
  autoSelect: boolean
  level: EwayLevel
  reason: string
}

/** Intra: ≥ ₹50k. Inter-state: all bills (below ₹50k = suggested). */
export function getEwayEligibility(invoice: Pick<Invoice, 'doc_type' | 'grand_total' | 'gst_type' | 'is_deleted'>): EwayEligibility {
  const dt = String(invoice.doc_type || 'INVOICE').toUpperCase()
  if (dt !== 'INVOICE') {
    return { show: false, autoSelect: false, level: 'none', reason: 'Sirf Tax Invoice ke liye E-Way JSON' }
  }
  if (invoice.is_deleted) {
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

function partyDetails(inv: Invoice): Partial<Party> {
  return (inv.party_snapshot || {}) as Partial<Party>
}

export function validateEwayInvoice(inv: Invoice, firm: Firm): string[] {
  const errors: string[] = []
  if (!isGstinValid(firm.gst)) errors.push('Firm GSTIN valid nahi hai')
  if (!firm.addr?.trim()) errors.push('Firm address missing hai')
  if (!firm.city?.trim()) errors.push('Firm city/place missing hai')
  if (!validPin(firm.pin)) errors.push('Firm PIN 6 digit hona chahiye')
  const firmState = parseInt(firm.state || getStateCode(firm.gst) || '', 10)
  if (!firmState) errors.push('Firm state code missing hai')

  if (!(inv.vehicle || '').trim()) errors.push(`${inv.bill_no}: vehicle number missing hai`)
  const cust = partyDetails(inv)
  const hasShip = inv.sameAsBuyer === false && inv.ship && inv.ship.addr
  const addr = cust.addr || (hasShip ? inv.ship?.addr : '')
  const city = cust.city || (hasShip ? inv.ship?.city : '')
  const pin = cust.pin || (hasShip ? inv.ship?.pin : '')
  const state = cust.state || getStateCode(cust.gst || '') || (hasShip ? inv.ship?.state : '')
  if (!addr?.trim()) errors.push(`${inv.bill_no}: buyer address missing hai`)
  if (!city?.trim()) errors.push(`${inv.bill_no}: buyer city/place missing hai`)
  if (!validPin(pin)) errors.push(`${inv.bill_no}: buyer PIN 6 digit hona chahiye`)
  if (!parseInt(String(state || ''), 10)) errors.push(`${inv.bill_no}: buyer state code missing hai`)
  for (const [idx, item] of (inv.items || []).entries()) {
    const gst = Number(item.gst)
    if (!Number.isFinite(gst)) errors.push(`${inv.bill_no}: line ${idx + 1} GST invalid hai`)
  }
  return errors
}

/** NIC e-Way bulk JSON (PamaTools / v1.0.0621 compatible). */
export function buildEwayJson(invoices: Invoice[], firm: Firm) {
  const fromSC = parseInt(firm.state, 10) || parseInt(getStateCode(firm.gst) || '0', 10) || 0
  const fromGstn = cleanGstin(firm.gst)

  const billLists = invoices.map((b) => {
    const isInter = b.gst_type === 'inter' || b.gst_type === 'IGST'
    const cust = partyDetails(b)
    const buyerGst = cleanGstin(cust.gst || '')
    const toGstin = buyerGst
    const toSC = toGstin !== 'URP'
      ? parseInt(getStateCode(toGstin) || cust.state || '0', 10)
      : parseInt(String(cust.state || '0'), 10)

    const hasShip = b.sameAsBuyer === false && b.ship && b.ship.addr
    const transType = hasShip ? 4 : 1

    const vehNo = (b.vehicle || '').toUpperCase().replace(/\s/g, '')
    const lrNo = b.lr || ''
    const transMode = parseInt(String(b.transMode || '1'), 10) || 1

    const totalTax = r2(b.total_tax)
    const cgstVal = !isInter ? r2(totalTax / 2) : 0
    const sgstVal = !isInter ? r2(totalTax / 2) : 0
    const igstVal = isInter ? totalTax : 0

    const mainHsn = String(parseInt(String(b.items?.[0]?.hsn || '48043100'), 10) || 48043100)

    return {
      userGstin: fromGstn,
      supplyType: 'O',
      subSupplyType: 1,
      subSupplyDesc: '',
      docType: ewbDocType(b.doc_type),
      docNo: String(b.bill_no),
      docDate: fmtD(b.date),
      transType,

      fromGstin: fromGstn,
      fromTrdName: firm.name || '',
      fromAddr1: firm.addr || '',
      fromAddr2: firm.city || '',
      fromPlace: firm.city || (firm.addr || '').split(',').pop()?.trim() || '',
      fromPincode: parseInt(firm.pin, 10) || 0,
      fromStateCode: fromSC,
      actualFromStateCode: fromSC,

      toGstin,
      toTrdName: b.party_name || '',
      toAddr1: cust.addr || (hasShip ? b.ship?.addr : '') || '',
      toAddr2: cust.city || (hasShip ? b.ship?.city : '') || '',
      toPlace: cust.city || (hasShip ? b.ship?.city : '') || '',
      toPincode: parseInt(String(cust.pin || (hasShip ? b.ship?.pin : '') || '0'), 10),
      toStateCode: toSC,
      actualToStateCode: toSC,

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

export function downloadEwayJson(invoices: Invoice[], firm: Firm) {
  if (!invoices.length) throw new Error('Koi bill select nahi')
  if (!firm) throw new Error('Active firm set karein')
  const errors = invoices.flatMap((inv) => validateEwayInvoice(inv, firm))
  if (errors.length) throw new Error(errors.slice(0, 8).join('\n'))

  const json = buildEwayJson(invoices, firm)
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
