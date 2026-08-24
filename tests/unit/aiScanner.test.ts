import { describe, expect, it } from 'vitest'
import {
  formatMultiBillScanWaitHint,
  mergeContinuationBills,
  PAGE_BY_PAGE_MIN_PAGES,
  PAGE_BY_PAGE_PDF_BYTES,
  resolveMultiBillScanTimeoutMs,
  shouldUsePageByPagePdfScan,
  type ScanResult,
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

describe('mergeContinuationBills', () => {
  it('merges two pages of the same bill', () => {
    const page1: ScanResult = {
      supplierName: 'ABC Traders',
      billNo: 'INV-001',
      items: [{ name: 'Kraft Paper', qty: 100, rate: 50, gst: 18 }],
      sub: 5000,
    }
    const page2: ScanResult = {
      supplierName: 'ABC Traders',
      billNo: 'INV-001',
      items: [{ name: 'Freight', qty: 1, rate: 200, gst: 18 }],
      grandTotal: 5200,
    }

    const merged = mergeContinuationBills([page1, page2])
    expect(merged).toHaveLength(1)
    expect(merged[0].items).toHaveLength(2)
    expect(merged[0].grandTotal).toBe(5200)
  })

  it('merges continuation page without repeated header', () => {
    const page1: ScanResult = {
      supplierName: 'ABC Traders',
      billNo: 'INV-001',
      items: [{ name: 'Item A', qty: 1, rate: 100, gst: 18 }],
    }
    const page2: ScanResult = {
      items: [{ name: 'Item B', qty: 2, rate: 50, gst: 18 }],
      grandTotal: 200,
    }

    expect(mergeContinuationBills([page1, page2])).toHaveLength(1)
  })

  it('keeps separate bills when supplier and bill number differ', () => {
    const bill1: ScanResult = {
      supplierName: 'ABC Traders',
      billNo: 'INV-001',
      items: [{ name: 'Item A', qty: 1, rate: 100, gst: 18 }],
    }
    const bill2: ScanResult = {
      supplierName: 'XYZ Mills',
      billNo: 'INV-002',
      items: [{ name: 'Item B', qty: 1, rate: 200, gst: 18 }],
    }

    expect(mergeContinuationBills([bill1, bill2])).toHaveLength(2)
  })
})
