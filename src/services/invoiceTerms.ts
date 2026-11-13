/**
 * Invoice Terms & Conditions — firm template + per-party payment days.
 */

export const DEFAULT_INVOICE_TERMS = [
  '1. Payment is due within {{payment_days}} days from the date of invoice.',
  '   Late payment will attract interest @ 1.5% per month from the due date.',
  '',
  '2. Goods remain our property until full payment is received.',
  '   Risk of loss passes to the buyer on delivery/dispatch.',
  '',
  '3. Any discrepancy, shortage or quality issue must be reported in writing within 7 days of receipt.',
  '   After that the goods will be deemed accepted.',
  '',
  '4. Goods once sold are non-returnable except in case of manufacturing defect.',
  '   Custom size / printed boxes or jars are strictly non-returnable.',
  '',
  '5. Subject to the exclusive jurisdiction of the courts at Kashipur.',
].join('\n')

/** Normalize payment days from party / snapshot (blank → null). */
export function normalizePaymentDays(value: unknown): number | null {
  if (value === '' || value == null) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n)
}

/**
 * Fill payment-days placeholders in firm terms (or default T&C).
 * Supports `{{payment_days}}`, `{{days}}`, and `within ______ days`.
 */
export function resolveInvoiceTerms(opts: {
  firmTerms?: string | null
  paymentDays?: number | null
}): string {
  const template = String(opts.firmTerms || '').trim() || DEFAULT_INVOICE_TERMS
  const daysNum = normalizePaymentDays(opts.paymentDays)
  const days = daysNum == null ? '______' : String(daysNum)

  return template
    .replace(/\{\{\s*payment_days\s*\}\}/gi, days)
    .replace(/\{\{\s*days\s*\}\}/gi, days)
    .replace(/within\s+[_\u2013\u2014\-.]{3,}\s*days/gi, `within ${days} days`)
}
