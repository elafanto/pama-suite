/** Shared party-form helpers: uppercase normalization, IFSC lookup (Razorpay). */

import type { Party } from '@/types/models'

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/

export function toUpperTrim(value: string): string {
  return value.toUpperCase().trim()
}

function normalizeAcno(acno: string): string {
  return toUpperTrim(acno).replace(/\s/g, '')
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

type PartyBankFields = Pick<Party, 'bank' | 'ifsc' | 'acno'>

/** Bank name already saved on a party with this IFSC (and account no when given). */
export function findPartyBankDetails(
  ifsc: string,
  parties: PartyBankFields[],
  acno?: string,
): IfscLookupResult | null {
  const code = toUpperTrim(ifsc)
  if (!isValidIfsc(code)) return null

  const matches = parties.filter((p) => toUpperTrim(p.ifsc) === code && (p.bank || '').trim())
  if (!matches.length) return null

  const ac = acno ? normalizeAcno(acno) : ''
  const party = (ac ? matches.find((p) => normalizeAcno(p.acno) === ac) : null) || matches[0]
  const bankLine = (party.bank || '').trim()
  if (!bankLine) return null

  return { bank: bankLine, branch: '', bankLine }
}

/** Razorpay public IFSC API — skips network if another party already has bank for this IFSC. */
export async function fetchIfscDetails(
  ifsc: string,
  options?: { acno?: string; parties?: PartyBankFields[] },
): Promise<IfscLookupResult | null> {
  const code = toUpperTrim(ifsc)
  if (!isValidIfsc(code)) return null

  const fromParty = options?.parties?.length
    ? findPartyBankDetails(code, options.parties, options.acno)
    : null
  if (fromParty) return fromParty

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
