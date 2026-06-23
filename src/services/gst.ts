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
