import type { Firm } from '@/types/models'

/** Normalize invoice/calendar date to YYYY-MM. */
export function salesPeriodFromDate(date: string | undefined | null): string {
  const raw = String(date || '').trim()
  if (/^\d{4}-\d{2}/.test(raw)) return raw.slice(0, 7)
  return ''
}

export function normalizeLockedSalesMonths(months: unknown): string[] {
  if (!Array.isArray(months)) return []
  const out = new Set<string>()
  for (const m of months) {
    const p = salesPeriodFromDate(String(m || ''))
    if (p) out.add(p)
  }
  return [...out].sort()
}

export function isSalesMonthLocked(
  firm: Pick<Firm, 'locked_sales_months'> | null | undefined,
  dateOrPeriod: string | undefined | null,
): boolean {
  const period = salesPeriodFromDate(dateOrPeriod)
  if (!period || !firm) return false
  return normalizeLockedSalesMonths(firm.locked_sales_months).includes(period)
}

export function salesMonthLockMessage(period: string): string {
  return `Sales month ${period} is locked (GSTR filed). Unlock month to create/edit/delete bills.`
}

export function withLockedSalesMonth(
  firm: Pick<Firm, 'locked_sales_months'>,
  period: string,
  lock: boolean,
): string[] {
  const p = salesPeriodFromDate(period)
  const set = new Set(normalizeLockedSalesMonths(firm.locked_sales_months))
  if (!p) return [...set]
  if (lock) set.add(p)
  else set.delete(p)
  return [...set].sort()
}

export function periodLabelYm(period: string): string {
  const [y, m] = period.split('-').map(Number)
  if (!y || !m) return period
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}
