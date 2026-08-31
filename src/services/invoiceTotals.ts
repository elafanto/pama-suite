import type { InvoiceItemLine } from '@/types/models'

export type InvoiceDiscountMode = 'none' | 'flat' | 'pct'

export interface InvoiceTotalsInput {
  items: Pick<InvoiceItemLine, 'name' | 'qty' | 'rate' | 'gst'>[]
  discount_mode?: InvoiceDiscountMode
  /** ₹ when flat, % when pct. */
  discount_value?: number
}

export interface InvoiceTotalsResult {
  /** Gross line total before discount. */
  sub: number
  discount_amount: number
  discount_pct?: number
  /** Subtotal after discount (taxable base). */
  taxable: number
  taxBuckets: Record<number, { taxable: number; tax: number }>
  total_tax: number
  rawGrandTotal: number
  grand_total: number
  round_off: number
}

function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function validLine(row: Pick<InvoiceItemLine, 'name' | 'qty' | 'rate' | 'gst'>) {
  return Boolean(String(row.name || '').trim()) && Number(row.qty) > 0 && Number(row.rate) > 0
}

export function resolveInvoiceDiscountAmount(
  grossSub: number,
  mode: InvoiceDiscountMode = 'none',
  value = 0,
): { amount: number; pct?: number } {
  const gross = round2(grossSub)
  if (gross <= 0 || mode === 'none') return { amount: 0 }
  const v = Number(value) || 0
  if (v <= 0) return { amount: 0 }
  if (mode === 'flat') {
    return { amount: Math.min(gross, round2(v)) }
  }
  const pct = Math.min(100, Math.max(0, v))
  return { amount: Math.min(gross, round2(gross * pct / 100)), pct }
}

/** Infer discount UI mode when loading a saved invoice. */
export function inferInvoiceDiscountMode(
  discount_amount?: number,
  discount_pct?: number,
): { mode: InvoiceDiscountMode; value: number } {
  const amt = round2(discount_amount)
  const pct = round2(discount_pct)
  if (pct > 0) return { mode: 'pct', value: pct }
  if (amt > 0) return { mode: 'flat', value: amt }
  return { mode: 'none', value: 0 }
}

export function computeInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotalsResult {
  const lines = (input.items || []).filter(validLine)
  const grossBuckets: Record<number, number> = {}
  let sub = 0

  for (const row of lines) {
    const amt = round2(row.qty * row.rate)
    sub = round2(sub + amt)
    const gstPct = Number(row.gst) || 0
    grossBuckets[gstPct] = round2((grossBuckets[gstPct] || 0) + amt)
  }

  const mode = input.discount_mode || 'none'
  const { amount: discount_amount, pct: discount_pct } = resolveInvoiceDiscountAmount(
    sub,
    mode,
    input.discount_value,
  )
  const taxable = round2(Math.max(0, sub - discount_amount))

  const taxBuckets: Record<number, { taxable: number; tax: number }> = {}
  for (const [pctKey, grossAmt] of Object.entries(grossBuckets)) {
    const pct = parseFloat(pctKey)
    const share = sub > 0 ? grossAmt / sub : 0
    const slabTaxable = round2(Math.max(0, grossAmt - discount_amount * share))
    const tax = round2(slabTaxable * pct / 100)
    taxBuckets[pct] = { taxable: slabTaxable, tax }
  }

  const total_tax = round2(Object.values(taxBuckets).reduce((sum, b) => sum + b.tax, 0))
  const rawGrandTotal = round2(taxable + total_tax)
  const grand_total = Math.round(rawGrandTotal)
  const round_off = round2(grand_total - rawGrandTotal)

  return {
    sub,
    discount_amount,
    discount_pct: mode === 'pct' && discount_pct ? discount_pct : undefined,
    taxable,
    taxBuckets,
    total_tax,
    rawGrandTotal,
    grand_total,
    round_off,
  }
}

/** Taxable sales value for ledger (post-discount). */
export function invoiceTaxableSales(inv: { sub?: number; discount_amount?: number; taxBuckets?: Record<number, { taxable: number; tax: number }> }) {
  if (inv.taxBuckets && Object.keys(inv.taxBuckets).length) {
    return round2(Object.values(inv.taxBuckets).reduce((s, b) => s + (Number(b.taxable) || 0), 0))
  }
  return round2(Math.max(0, (Number(inv.sub) || 0) - (Number(inv.discount_amount) || 0)))
}
