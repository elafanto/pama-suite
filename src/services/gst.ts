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

export function isGstinValid(gstin: string | undefined): boolean {
  if (!gstin) return false
  const val = gstin.trim().toUpperCase()
  const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/
  return GSTIN_RE.test(val)
}
