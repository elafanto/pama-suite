import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INVOICE_TERMS,
  LEGACY_INVOICE_TERMS_V1,
  LEGACY_INVOICE_TERMS_V2,
  normalizePaymentDays,
  resolveInvoiceTerms,
  shouldUpgradeInvoiceTerms,
} from '@/services/invoiceTerms'

describe('normalizePaymentDays', () => {
  it('accepts non-negative integers', () => {
    expect(normalizePaymentDays(15)).toBe(15)
    expect(normalizePaymentDays('7')).toBe(7)
    expect(normalizePaymentDays(0)).toBe(0)
  })

  it('rejects blank / invalid', () => {
    expect(normalizePaymentDays(null)).toBeNull()
    expect(normalizePaymentDays('')).toBeNull()
    expect(normalizePaymentDays(undefined)).toBeNull()
    expect(normalizePaymentDays(-3)).toBeNull()
    expect(normalizePaymentDays('abc')).toBeNull()
  })
})

describe('resolveInvoiceTerms', () => {
  it('uses 3-clause default and fills party payment days', () => {
    const text = resolveInvoiceTerms({ paymentDays: 15 })
    expect(text).toContain('Payment is due within 15 days from the date of invoice.')
    expect(text).toContain('interest @ 1.5% per month')
    expect(text).toContain('within 3 days of receipt')
    expect(text).toContain('courts at Kashipur')
    expect(text).not.toContain('Custom size / printed boxes')
    expect(text).not.toContain('Goods remain our property')
  })

  it('keeps blank underline when payment days missing', () => {
    const text = resolveInvoiceTerms({ paymentDays: null })
    expect(text).toContain('Payment is due within ______ days from the date of invoice.')
  })

  it('fills {{payment_days}} in custom firm template', () => {
    const text = resolveInvoiceTerms({
      firmTerms: 'Pay within {{payment_days}} days. Thanks.',
      paymentDays: 30,
    })
    expect(text).toBe('Pay within 30 days. Thanks.')
  })

  it('fills underscore placeholders in legacy templates', () => {
    const text = resolveInvoiceTerms({
      firmTerms: '1. Payment is due within ______ days from the date of invoice.',
      paymentDays: 7,
    })
    expect(text).toBe('1. Payment is due within 7 days from the date of invoice.')
  })

  it('upgrades stored legacy 5-clause default when resolving', () => {
    const text = resolveInvoiceTerms({
      firmTerms: LEGACY_INVOICE_TERMS_V1,
      paymentDays: 10,
    })
    expect(text).toContain('within 10 days')
    expect(text).toContain('within 3 days of receipt')
    expect(text).not.toContain('Goods remain our property')
  })

  it('default template includes exactly three clauses', () => {
    expect(DEFAULT_INVOICE_TERMS).toMatch(/^1\./m)
    expect(DEFAULT_INVOICE_TERMS).toMatch(/^2\./m)
    expect(DEFAULT_INVOICE_TERMS).toMatch(/^3\./m)
    expect(DEFAULT_INVOICE_TERMS).not.toMatch(/^4\./m)
    expect(DEFAULT_INVOICE_TERMS).not.toMatch(/^5\./m)
  })
})

describe('shouldUpgradeInvoiceTerms', () => {
  it('upgrades blank and legacy defaults', () => {
    expect(shouldUpgradeInvoiceTerms('')).toBe(true)
    expect(shouldUpgradeInvoiceTerms(LEGACY_INVOICE_TERMS_V1)).toBe(true)
    expect(shouldUpgradeInvoiceTerms(LEGACY_INVOICE_TERMS_V2)).toBe(true)
    expect(shouldUpgradeInvoiceTerms(DEFAULT_INVOICE_TERMS)).toBe(false)
    expect(shouldUpgradeInvoiceTerms('Custom short terms')).toBe(false)
  })
})
