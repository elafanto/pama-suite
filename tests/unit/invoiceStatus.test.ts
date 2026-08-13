import { describe, expect, it } from 'vitest'
import {
  isInvoiceActive,
  isInvoiceCancelled,
  isInvoiceDocsCancelled,
  isInvoiceGstrReportable,
} from '@/services/invoiceStatus'

describe('invoiceStatus helpers', () => {
  it('treats cancelled_at as cancelled but still visible', () => {
    const inv = { is_deleted: false, cancelled_at: '2026-05-01T00:00:00.000Z' }
    expect(isInvoiceCancelled(inv)).toBe(true)
    expect(isInvoiceActive(inv)).toBe(false)
    expect(isInvoiceDocsCancelled(inv)).toBe(true)
    expect(isInvoiceGstrReportable(inv)).toBe(false)
  })

  it('treats hard-deleted as docs-cancelled, not visible cancelled', () => {
    const inv = { is_deleted: true, cancelled_at: null }
    expect(isInvoiceCancelled(inv)).toBe(false)
    expect(isInvoiceActive(inv)).toBe(false)
    expect(isInvoiceDocsCancelled(inv)).toBe(true)
    expect(isInvoiceGstrReportable(inv)).toBe(false)
  })

  it('active invoice is reportable', () => {
    const inv = { is_deleted: false, cancelled_at: null }
    expect(isInvoiceActive(inv)).toBe(true)
    expect(isInvoiceGstrReportable(inv)).toBe(true)
    expect(isInvoiceDocsCancelled(inv)).toBe(false)
  })
})
