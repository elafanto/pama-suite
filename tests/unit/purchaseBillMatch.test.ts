import { describe, expect, it } from 'vitest'
import {
  annotateScannedBillMatches,
  countDuplicatePurchaseExtras,
  findDuplicatePurchaseGroups,
  findExistingPurchase,
  purchaseBillBatchKey,
  purchaseMatchesBill,
} from '@/services/purchaseBillMatch'
import type { ScanResult } from '@/services/aiScanner'
import type { Purchase } from '@/types/models'

describe('purchaseBillMatch helpers', () => {
  const purchases = [
    {
      id: 'p1',
      supplier_name: 'ABC Traders',
      bill_no: 'INV 001',
      date: '2025-08-01',
      is_deleted: false,
    },
  ] as Purchase[]

  it('matches saved bills ignoring case and spaces', () => {
    expect(purchaseMatchesBill(purchases[0], 'abc traders', 'inv001')).toBe(true)
    expect(findExistingPurchase(purchases, 'ABC Traders', 'INV-001')).toBe(purchases[0])
  })

  it('annotates already saved and duplicate scan rows', () => {
    const bills: ScanResult[] = [
      { supplierName: 'ABC Traders', billNo: 'INV-001', items: [{ name: 'A', qty: 1, rate: 1, gst: 18 }] },
      { supplierName: 'ABC Traders', billNo: 'INV-001', items: [{ name: 'B', qty: 1, rate: 1, gst: 18 }] },
      { supplierName: 'New Vendor', billNo: 'B-100', items: [{ name: 'C', qty: 1, rate: 1, gst: 18 }] },
    ]

    const annotated = annotateScannedBillMatches(bills, purchases)
    expect(annotated[0]._matchStatus).toBe('already_saved')
    expect(annotated[0]._existingPurchaseId).toBe('p1')
    expect(annotated[1]._matchStatus).toBe('duplicate_in_batch')
    expect(annotated[2]._matchStatus).toBe('new')
    expect(purchaseBillBatchKey(' ABC ', 'INV 001')).toBe('abc|inv001')
  })

  it('handles numeric bill numbers from OCR JSON', () => {
    expect(purchaseBillBatchKey('ABC Traders', 1001)).toBe('abc traders|1001')

    const bills: ScanResult[] = [
      { supplierName: 'New Vendor', billNo: 7788, items: [{ name: 'C', qty: 1, rate: 1, gst: 18 }] },
    ]
    const annotated = annotateScannedBillMatches(bills, purchases)
    expect(annotated[0]._matchStatus).toBe('new')
  })

  it('finds duplicate saved purchases and keeps the oldest', () => {
    const rows = [
      { id: 'a', supplier_name: 'ABC Traders', bill_no: 'INV-001', date: '2025-08-01', created_at: '2025-08-01T10:00:00.000Z', is_deleted: false, grand_total: 100, pay_status: 'UNPAID' },
      { id: 'b', supplier_name: 'ABC Traders', bill_no: 'INV 001', date: '2025-08-02', created_at: '2025-08-02T10:00:00.000Z', is_deleted: false, grand_total: 100, pay_status: 'UNPAID' },
      { id: 'c', supplier_name: 'Other', bill_no: 'X-1', date: '2025-08-01', created_at: '2025-08-01T10:00:00.000Z', is_deleted: false, grand_total: 50, pay_status: 'UNPAID' },
    ] as Purchase[]

    const groups = findDuplicatePurchaseGroups(rows)
    expect(groups).toHaveLength(1)
    expect(groups[0].keep.id).toBe('a')
    expect(groups[0].extras.map((r) => r.id)).toEqual(['b'])
    expect(countDuplicatePurchaseExtras(groups)).toBe(1)
  })
})
