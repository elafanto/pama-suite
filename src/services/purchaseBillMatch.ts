import type { ScanResult } from '@/services/aiScanner'
import type { Purchase } from '@/types/models'

export type ScannedBillMatchStatus = 'new' | 'already_saved' | 'duplicate_in_batch'

export type ScannedBillMatchFields = {
  _matchStatus: ScannedBillMatchStatus
  _existingPurchaseId?: string
  _existingPurchaseDate?: string
}

export function normalizePurchaseBillKey(supplierName?: string | number | null, billNo?: string | number | null) {
  return {
    supplier: String(supplierName ?? '').trim().toLowerCase(),
    billNo: String(billNo ?? '').trim().toLowerCase().replace(/[\s\-_/]+/g, ''),
  }
}

export function purchaseBillBatchKey(supplierName?: string | number | null, billNo?: string | number | null): string {
  const key = normalizePurchaseBillKey(supplierName, billNo)
  if (!key.supplier || !key.billNo) return ''
  return `${key.supplier}|${key.billNo}`
}

export function purchaseMatchesBill(
  purchase: Purchase,
  supplierName?: string | number | null,
  billNo?: string | number | null,
): boolean {
  if (purchase.is_deleted) return false
  const left = normalizePurchaseBillKey(supplierName, billNo)
  if (!left.supplier || !left.billNo) return false
  const right = normalizePurchaseBillKey(purchase.supplier_name, purchase.bill_no)
  return left.supplier === right.supplier && left.billNo === right.billNo
}

export function findExistingPurchase(
  purchases: Purchase[],
  supplierName?: string | number | null,
  billNo?: string | number | null,
): Purchase | undefined {
  return purchases.find((p) => purchaseMatchesBill(p, supplierName, billNo))
}

export function getScannedBillMatchFields(
  bill: Pick<ScanResult, 'supplierName' | 'billNo'>,
  purchases: Purchase[],
  seenBatchKeys: Set<string>,
): ScannedBillMatchFields {
  const batchKey = purchaseBillBatchKey(bill.supplierName, bill.billNo)
  if (batchKey) {
    if (seenBatchKeys.has(batchKey)) {
      return { _matchStatus: 'duplicate_in_batch' }
    }
    seenBatchKeys.add(batchKey)
  }

  const existing = findExistingPurchase(purchases, bill.supplierName, bill.billNo)
  if (existing) {
    return {
      _matchStatus: 'already_saved',
      _existingPurchaseId: existing.id,
      _existingPurchaseDate: existing.date,
    }
  }

  return { _matchStatus: 'new' }
}

export function annotateScannedBillMatches<T extends ScanResult>(
  bills: T[],
  purchases: Purchase[],
): Array<T & ScannedBillMatchFields> {
  const seenBatchKeys = new Set<string>()
  return bills.map((bill) => ({
    ...bill,
    ...getScannedBillMatchFields(bill, purchases, seenBatchKeys),
  }))
}
