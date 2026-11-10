export const stateMap: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh (Old)',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh'
}

/** Normalize GSTIN for storage and display (uppercase, trimmed). */
export function formatGstin(gstin: string | undefined | null): string {
  return (gstin || '').trim().toUpperCase()
}

export function getStateName(gstinOrCode: string | undefined): string {
  if (!gstinOrCode) return 'Unknown'
  const code = String(gstinOrCode).trim().substring(0, 2)
  return stateMap[code] || 'Unknown'
}

export function getStateCode(gstin: string | undefined): string {
  if (!gstin) return ''
  const clean = gstin.trim()
  if (clean.length >= 2 && /^\d{2}/.test(clean.substring(0, 2))) {
    return clean.substring(0, 2)
  }
  return ''
}

/** Common abbreviations / alternate spellings → GST state code. */
const STATE_ALIASES: Record<string, string> = {
  ua: '05',
  uk: '05',
  uttarakhand: '05',
  uttaranchal: '05',
  up: '09',
  'uttar pradesh': '09',
  dl: '07',
  delhi: '07',
  nct: '07',
  mh: '27',
  maharashtra: '27',
  hr: '06',
  haryana: '06',
  pb: '03',
  punjab: '03',
  rj: '08',
  rajasthan: '08',
  hp: '02',
  'himachal pradesh': '02',
  jk: '01',
  'jammu and kashmir': '01',
  'jammu & kashmir': '01',
}

/**
 * Normalize free-text state (code, name, or alias) to a 2-digit GST state code.
 * Fixes bugs like firm.state = "Uttarakhand" → first-two-chars "Ut" vs party "05".
 */
export function normalizeStateCode(value: string | undefined | null): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (/^\d{2}/.test(raw)) return raw.slice(0, 2)
  if (/^\d$/.test(raw)) return raw.padStart(2, '0')

  const lower = raw.toLowerCase().replace(/\s+/g, ' ')
  if (STATE_ALIASES[lower]) return STATE_ALIASES[lower]

  for (const [code, name] of Object.entries(stateMap)) {
    if (name.toLowerCase() === lower) return code
  }
  return ''
}

export type GstStateSource = {
  /** Firm / party field name in models */
  gst?: string | null
  /** Invoice ship / form field name */
  gstin?: string | null
  state?: string | null
}

/**
 * Place-of-supply / supplier state for GST comparison.
 * Prefer GSTIN prefix (authoritative for registered parties), then state field.
 */
export function resolvePlaceOfSupplyState(opts: GstStateSource): string {
  const fromGst = getStateCode(opts.gstin || opts.gst || undefined)
  if (fromGst) return fromGst
  return normalizeStateCode(opts.state)
}

/**
 * Intra vs inter from firm vs place-of-supply state codes.
 * Missing place code → intra (unregistered / unknown buyer — same as prior billing default).
 */
export function detectSupplyGstType(
  firm: GstStateSource,
  place: GstStateSource,
  fallbackFirmCode = '05',
): 'intra' | 'inter' {
  const firmCode = resolvePlaceOfSupplyState(firm) || normalizeStateCode(fallbackFirmCode) || '05'
  const placeCode = resolvePlaceOfSupplyState(place)
  if (!placeCode) return 'intra'
  return firmCode === placeCode ? 'intra' : 'inter'
}

/** True when the bill is interstate (IGST). Handles both new ('inter') and
 *  legacy ('IGST') gst_type values — single source of truth. */
export function isInterstateGst(gstType: string | undefined): boolean {
  return gstType === 'inter' || gstType === 'IGST'
}

/** Collapse the 4 legacy gst_type values to the canonical pair. */
export function normalizeGstType(gstType: string | undefined): 'intra' | 'inter' {
  return isInterstateGst(gstType) ? 'inter' : 'intra'
}

export function isGstinValid(gstin: string | undefined): boolean {
  if (!gstin) return false
  const val = gstin.trim().toUpperCase()
  const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/
  return GSTIN_RE.test(val)
}

/** 15th-character check digit per GSTIN encoding (GSTN — right-to-left, factor 2/1). */
export function isGstinChecksumValid(gstin: string | undefined): boolean {
  if (!gstin) return false
  const val = gstin.trim().toUpperCase()
  if (val.length !== 15) return false
  const charset = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let factor = 2
  let sum = 0
  const mod = charset.length
  for (let i = 13; i >= 0; i--) {
    const codePoint = charset.indexOf(val[i])
    if (codePoint < 0) return false
    let digit = factor * codePoint
    factor = factor === 2 ? 1 : 2
    digit = Math.floor(digit / mod) + (digit % mod)
    sum += digit
  }
  const check = (mod - (sum % mod)) % mod
  return val[14] === charset[check]
}

export type GstinValidation = {
  valid: boolean
  message: string
  stateCode: string
  stateName: string
}

/** Client-side GSTIN checks only — no public CORS-friendly legal-name API exists. */
export function validateGstinForForm(gstin: string | undefined): GstinValidation {
  const raw = (gstin || '').trim().toUpperCase()
  if (!raw) {
    return { valid: true, message: '', stateCode: '', stateName: '' }
  }
  if (raw.length < 15) {
    return {
      valid: false,
      message: `GSTIN must be 15 characters (${raw.length}/15)`,
      stateCode: getStateCode(raw),
      stateName: getStateName(raw),
    }
  }
  if (!isGstinValid(raw)) {
    return {
      valid: false,
      message: 'Invalid GSTIN format (e.g. 05ABCDE1234F1Z5)',
      stateCode: getStateCode(raw),
      stateName: getStateName(raw),
    }
  }
  if (!isGstinChecksumValid(raw)) {
    return {
      valid: false,
      message: 'GSTIN check digit does not match — verify the number',
      stateCode: getStateCode(raw),
      stateName: getStateName(raw),
    }
  }
  const stateCode = getStateCode(raw)
  const stateName = getStateName(raw)
  return {
    valid: true,
    stateCode,
    stateName,
    message: `Valid GSTIN · ${stateName} (${stateCode}). Legal/trade name is not available offline — enter manually or verify on the GST portal.`,
  }
}
