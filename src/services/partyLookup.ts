/** Shared party-form helpers: uppercase normalization, IFSC lookup (Razorpay). */

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/

export function toUpperTrim(value: string): string {
  return value.toUpperCase().trim()
}

export function isValidIfsc(ifsc: string): boolean {
  return IFSC_RE.test(toUpperTrim(ifsc))
}

export interface IfscLookupResult {
  bank: string
  branch: string
  /** Combined label for single "bank" field on party form */
  bankLine: string
}

/** Razorpay public IFSC API — https://ifsc.razorpay.com/{IFSC} */
export async function fetchIfscDetails(ifsc: string): Promise<IfscLookupResult | null> {
  const code = toUpperTrim(ifsc)
  if (!isValidIfsc(code)) return null
  try {
    const res = await fetch(`https://ifsc.razorpay.com/${code}`)
    if (!res.ok) return null
    const data = (await res.json()) as { BANK?: string; BRANCH?: string }
    const bank = (data.BANK || '').trim()
    const branch = (data.BRANCH || '').trim()
    const bankLine = bank && branch ? `${bank}, ${branch}` : bank || branch
    if (!bankLine) return null
    return { bank, branch, bankLine }
  } catch {
    return null
  }
}
