import hsnGst4Data from '@/data/hsnGst4.json'

export type HsnGstLookup = {
  hsn4: string
  gst: number
  description?: string
  source: string
  notificationRef?: string
}

type HsnGst4Entry = { gst: number; notificationRef?: string; description?: string }

const LOCAL_SOURCE = 'CBIC Notification 09/2025-CT(Rate) — gst.gov.in HSN directory'
const PORTAL_SOURCE = 'gst.gov.in (live lookup)'

const ratesMap = hsnGst4Data.rates as Record<string, HsnGst4Entry>

/**
 * Pama billing — 4-digit slabs from CBIC tariff lines (override generic chapter aggregate).
 * Kraft paper reels: 18% | Corrugated cartons/boxes: 5%
 */
const BILLING_HSN_GST_OVERRIDES: Record<string, HsnGst4Entry & { description: string }> = {
  '4804': {
    gst: 18,
    description: 'Kraft paper / kraft paperboard (reels)',
    notificationRef: 'CGST Rate Notification — kraft paper heading 4804',
  },
  '4819': {
    gst: 5,
    description: 'Corrugated cartons, boxes & cases (paper / paperboard)',
    notificationRef: 'CGST Rate Notification — 4819 corrugated boxes',
  },
}

function lookupOverride(hsn4: string): HsnGstLookup | null {
  const entry = BILLING_HSN_GST_OVERRIDES[hsn4]
  if (!entry) return null
  return {
    hsn4,
    gst: entry.gst,
    description: entry.description,
    source: `${LOCAL_SOURCE} (packaging tariff line)`,
    notificationRef: entry.notificationRef,
  }
}

/** Normalize any HSN input to 4-digit heading (GSTR-1 ≤ ₹5 Cr turnover). */
export function normalizeHsn4(hsn: string | number | undefined | null): string | null {
  const digits = String(hsn ?? '').replace(/\D/g, '')
  if (digits.length < 4) return null
  return digits.slice(0, 4)
}

export function isValidHsn4(hsn: string | number | undefined | null): boolean {
  return normalizeHsn4(hsn) !== null
}

export function listHsn4Options(prefix = ''): string[] {
  const p = prefix.replace(/\D/g, '')
  return Object.keys(ratesMap)
    .filter((code) => !p || code.startsWith(p))
    .sort()
}

/** Common paper / packaging headings for billing datalist. */
export function commonBillingHsn4Options(): string[] {
  const chapters = ['4707', '4801', '4802', '4803', '4804', '4805', '4806', '4807', '4808', '4809', '4810', '4811', '4819', '4823', '3920', '3921', '3923']
  return chapters.filter((c) => ratesMap[c]).sort()
}

export function lookupHsnGstLocal(hsn4: string): HsnGstLookup | null {
  const override = lookupOverride(hsn4)
  if (override) return override
  const entry = ratesMap[hsn4]
  if (!entry) return null
  return {
    hsn4,
    gst: entry.gst,
    description: entry.description,
    source: LOCAL_SOURCE,
    notificationRef: entry.notificationRef || hsnGst4Data.meta?.source,
  }
}

function parsePortalGstValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = parseFloat(value.replace(/[^\d.]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function parseGstPortalPayload(data: unknown, hsn4: string): HsnGstLookup | null {
  const rows = Array.isArray(data) ? data : (data && typeof data === 'object' && Array.isArray((data as any).data))
    ? (data as any).data
    : data && typeof data === 'object' ? [data] : []

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const code = normalizeHsn4((row as any).hsnCode ?? (row as any).hsn ?? (row as any).c)
    if (code !== hsn4) continue

    const igst = parsePortalGstValue((row as any).igst ?? (row as any).igstRate ?? (row as any).gstRt ?? (row as any).rate)
    const cgst = parsePortalGstValue((row as any).cgst ?? (row as any).cgstRate)
    const sgst = parsePortalGstValue((row as any).sgst ?? (row as any).sgstRate)
    const gst = igst ?? (cgst != null && sgst != null ? cgst + sgst : null)
    if (gst == null) continue

    return {
      hsn4,
      gst,
      description: String((row as any).desc ?? (row as any).description ?? (row as any).hsnDesc ?? '').trim() || undefined,
      source: PORTAL_SOURCE,
    }
  }
  return null
}

/** Try live lookup on official GST portal (browser). Falls back silently. */
export async function fetchHsnGstFromPortal(hsn4: string): Promise<HsnGstLookup | null> {
  const url = `https://services.gst.gov.in/services/api/search/goodservice?hsnCode=${encodeURIComponent(hsn4)}`
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('json')) return null
    const data = await res.json()
    return parseGstPortalPayload(data, hsn4)
  } catch {
    return null
  }
}

/** Official portal first, then bundled CBIC notification rates. */
export async function resolveHsnGstRate(hsn: string | number | undefined | null): Promise<HsnGstLookup | null> {
  const hsn4 = normalizeHsn4(hsn)
  if (!hsn4) return null
  const override = lookupOverride(hsn4)
  if (override) return override
  const live = await fetchHsnGstFromPortal(hsn4)
  if (live) return live
  return lookupHsnGstLocal(hsn4)
}

export function formatHsnGstConfirmLine(itemName: string, hsn: string, gst: number, lookup?: HsnGstLookup | null): string {
  const hsn4 = normalizeHsn4(hsn) || hsn
  const src = lookup?.source ? ` — ${lookup.source}` : ''
  return `${itemName.trim() || 'Item'}: HSN ${hsn4} → GST ${gst}%${src}`
}

export function buildBillGstConfirmMessage(
  rows: { name: string; hsn: string; gst: number }[],
  lookups: Map<string, HsnGstLookup | null>,
): string {
  const lines = rows.map((row) => {
    const hsn4 = normalizeHsn4(row.hsn) || row.hsn
    return formatHsnGstConfirmLine(row.name, hsn4, row.gst, lookups.get(hsn4) || lookupHsnGstLocal(hsn4))
  })
  return [
    'Bill save se pehle HSN → GST slab verify karein:',
    '',
    ...lines,
    '',
    'Continue karein?',
  ].join('\n')
}

export const HSN_GST_DATA_META = hsnGst4Data.meta
