/** Pending RTGS prefill from Billing / Purchases → Banking module */

export interface PendingRTGS {
  name: string
  purpose: string
  bank: string
  acname: string
  acno: string
  ifsc: string
  amount: number
  mode: 'RTGS' | 'NEFT'
  partyId?: string | null
  source?: string
}

const KEY = 'pama_pending_rtgs'

export function setPendingRTGS(payload: PendingRTGS | PendingRTGS[]): void {
  const list = Array.isArray(payload) ? payload : [payload]
  sessionStorage.setItem(KEY, JSON.stringify(list))
}

export function getPendingRTGS(): PendingRTGS[] {
  const raw = sessionStorage.getItem(KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

export function clearPendingRTGS(): void {
  sessionStorage.removeItem(KEY)
}
