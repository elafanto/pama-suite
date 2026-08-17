import { describe, expect, it } from 'vitest'
import {
  formatMultiBillScanWaitHint,
  PAGE_BY_PAGE_MIN_PAGES,
  PAGE_BY_PAGE_PDF_BYTES,
  resolveMultiBillScanTimeoutMs,
  shouldUsePageByPagePdfScan,
} from '@/services/aiScanner'

describe('resolveMultiBillScanTimeoutMs', () => {
  it('uses 120s for normal PDFs', () => {
    expect(resolveMultiBillScanTimeoutMs(500_000, 'application/pdf')).toBe(120_000)
  })

  it('uses 180s for large PDFs (>= 2MB)', () => {
    expect(resolveMultiBillScanTimeoutMs(2 * 1024 * 1024, 'application/pdf')).toBe(180_000)
  })

  it('uses 180s for very large PDFs (>= 4MB)', () => {
    expect(resolveMultiBillScanTimeoutMs(15 * 1024 * 1024, 'application/pdf')).toBe(180_000)
  })

  it('uses 120s for images', () => {
    expect(resolveMultiBillScanTimeoutMs(800_000, 'image/jpeg')).toBe(120_000)
  })
})

describe('shouldUsePageByPagePdfScan', () => {
  it('uses page mode for 4+ pages', () => {
    expect(shouldUsePageByPagePdfScan(1_000_000, PAGE_BY_PAGE_MIN_PAGES)).toBe(true)
  })

  it('uses page mode for large files', () => {
    expect(shouldUsePageByPagePdfScan(PAGE_BY_PAGE_PDF_BYTES, 1)).toBe(true)
  })

  it('uses whole PDF for small short files', () => {
    expect(shouldUsePageByPagePdfScan(500_000, 2)).toBe(false)
  })
})

describe('formatMultiBillScanWaitHint', () => {
  it('mentions page-by-page estimate for large page count', () => {
    expect(formatMultiBillScanWaitHint(15 * 1024 * 1024, 'application/pdf', 25)).toMatch(/25-page PDF/)
  })

  it('mentions wait time for small PDF', () => {
    expect(formatMultiBillScanWaitHint(500_000, 'application/pdf')).toMatch(/120s/)
  })
})
