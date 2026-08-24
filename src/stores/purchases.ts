import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/data/db'
import { createRepo } from '@/data/repo'
import { useFirmStore } from './firm'
import { useAccountingStore } from './accounting'
import { logActivity } from '@/services/activityLog'
import { recordPurchaseMovements } from '@/services/inventoryLedger'
import {
  allocateVendorPayment,
  payStatusFromPaidPurchase,
} from '@/services/partyPaymentAllocation'
import { movePurchaseBillsToFirm, type MovePurchaseBillsResult } from '@/services/purchaseCorrection'
import {
  assertPurchaseReelsHaveNoConsumptionHistory,
  createConsumablesFromPurchase,
  createReelsFromPurchase,
  purchaseHasConsumableLines,
  purchaseHasReelLines,
  purchaseReelStockChanged,
  reversePurchaseConsumables,
  reversePurchaseReels,
  type PurchaseConsumableSpec,
  type PurchaseReelSpec,
} from '@/services/production'
import {
  createCapitalAssetsFromPurchase,
  reversePurchaseCapitalAssets,
} from '@/services/assets'
import {
  restoreAttachmentsForEntity,
  softDeleteAttachmentsForEntity,
} from '@/services/documentAttachments'
import type { Purchase } from '@/types/models'

const repo = createRepo<Purchase>(db.purchases)
const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100

async function syncPaymentVoucher(purchase: Purchase) {
  const accounting = useAccountingStore()
  const paid = money(Math.min(Math.max(purchase.amt_paid || 0, 0), purchase.grand_total || 0))
  if (paid <= 0) {
    await accounting.reverseLedgerByRef(`${purchase.id}_PAY`)
    return
  }
  await accounting.postPaymentVoucher(purchase.id, 'purchase', paid, false, 0, purchase.received_date || purchase.date, 'Recorded on purchase save')
}

export const usePurchaseStore = defineStore('purchases', () => {
  const list = ref<Purchase[]>([])
  const loaded = ref(false)

  async function load() {
    const firm = useFirmStore()
    list.value = await repo.all(firm.activeFirmId)
    loaded.value = true
  }

  async function add(data: Omit<Purchase, 'id' | 'firm_id' | 'created_at' | 'updated_at' | 'is_deleted' | '_dirty'>): Promise<Purchase> {
    const firmStore = useFirmStore()
    const firmId = firmStore.activeFirmId
    const accounting = useAccountingStore()

    const rec = await repo.create({ ...data, firm_id: firmId } as any)

    // Post to double-entry ledger
    await accounting.postPurchaseToLedger(rec)
    await syncPaymentVoucher(rec)
    await recordPurchaseMovements(rec)
    // Reel / consumable stock confirmed separately in UI.
    await createCapitalAssetsFromPurchase(rec)
    await logActivity(firmId, 'create', 'purchase', rec.id, `Purchase ${rec.bill_no} from ${rec.supplier_name}`)

    await load()
    return rec
  }

  async function update(id: string, patch: Partial<Purchase>) {
    const existing = await repo.get(id)
    const next = existing ? ({ ...existing, ...patch } as Purchase) : undefined
    const reelStockChanged = !!existing && !!next && purchaseReelStockChanged(existing, next)
    if (reelStockChanged) {
      await assertPurchaseReelsHaveNoConsumptionHistory(id, 'update')
    }

    const rec = await repo.update(id, patch)
    if (rec) {
      const accounting = useAccountingStore()
      await accounting.postPurchaseToLedger(rec)
      await syncPaymentVoucher(rec)
      await recordPurchaseMovements(rec)
      await createCapitalAssetsFromPurchase(rec)
      await logActivity(rec.firm_id, 'update', 'purchase', rec.id, `Purchase ${rec.bill_no} updated`)
    }
    await load()
    return {
      reelStockChanged,
      needsReelConfirm: !!rec && purchaseHasReelLines(rec),
      needsConsumableConfirm: !!rec && purchaseHasConsumableLines(rec),
    }
  }

  async function confirmReelStock(purchaseId: string, specs: PurchaseReelSpec[], opts?: { replaceExisting?: boolean }) {
    const rec = await repo.get(purchaseId)
    if (!rec || rec.is_deleted) throw new Error('Purchase not found')
    if (!purchaseHasReelLines(rec) && !(specs || []).length) {
      throw new Error('Is purchase me paper reel lines nahi hain')
    }
    if (opts?.replaceExisting) {
      await assertPurchaseReelsHaveNoConsumptionHistory(purchaseId, 'update')
      await reversePurchaseReels(purchaseId)
    }
    const count = await createReelsFromPurchase(rec, specs)
    await logActivity(rec.firm_id, 'create', 'reel_stock', rec.id, `Confirmed ${count} reels from purchase ${rec.bill_no}`)
    await load()
    return { count }
  }

  async function confirmConsumableStock(purchaseId: string, specs: PurchaseConsumableSpec[], opts?: { replaceExisting?: boolean }) {
    const rec = await repo.get(purchaseId)
    if (!rec || rec.is_deleted) throw new Error('Purchase not found')
    if (!purchaseHasConsumableLines(rec) && !(specs || []).length) {
      throw new Error('Is purchase me consumable lines nahi hain')
    }
    if (opts?.replaceExisting) {
      await reversePurchaseConsumables(purchaseId)
    }
    const count = await createConsumablesFromPurchase(rec, specs)
    await logActivity(rec.firm_id, 'create', 'stock_movement', rec.id, `Confirmed ${count} consumables from purchase ${rec.bill_no}`)
    await load()
    return { count }
  }

  async function remove(id: string) {
    const existing = await repo.get(id)
    if (existing) {
      await assertPurchaseReelsHaveNoConsumptionHistory(id, 'delete')
    }
    await softDeleteAttachmentsForEntity('purchase', id, existing?.firm_id)
    await repo.remove(id)
    await reversePurchaseReels(id)
    await reversePurchaseConsumables(id)
    await reversePurchaseCapitalAssets(id)
    const accounting = useAccountingStore()
    await accounting.reverseLedgerByRef(id)
    await accounting.reverseLedgerByRef(`${id}_PAY`)
    if (existing) {
      await recordPurchaseMovements({ ...existing, is_deleted: true })
      await logActivity(existing.firm_id, 'delete', 'purchase', id, `Purchase ${existing.bill_no} deleted`)
    }
    await load()
  }

  async function recordPayment(id: string, amount: number, isWriteOff: boolean, note = '', date = '', paymentAccountName?: string) {
    const existing = await repo.get(id)
    if (!existing) return

    const paymentAmount = money(Math.max(0, amount))
    if (paymentAmount <= 0) return

    if (isWriteOff) {
      const previousPaid = money(existing.amt_paid || 0)
      const outstanding = Math.max(0, money(existing.grand_total - previousPaid))
      const applied = money(Math.min(paymentAmount, outstanding))
      const writeOffAmt = money(Math.max(0, outstanding - applied))

      await repo.update(id, {
        amt_paid: existing.grand_total,
        pay_status: 'PAID',
        notes: `${existing.notes || ''} [Write-off: ₹${writeOffAmt.toFixed(2)}]`.trim(),
      })

      const accounting = useAccountingStore()
      await accounting.postPaymentVoucher(id, 'purchase', applied, true, writeOffAmt, date, note, paymentAccountName)
      await load()
      return
    }

    const firmPurchases = await db.purchases.where('firm_id').equals(existing.firm_id).toArray()
    const allocations = allocateVendorPayment(firmPurchases, id, paymentAmount)
    if (allocations.length === 0) {
      throw new Error('Is supplier par koi open purchase nahi mila.')
    }

    for (const allocation of allocations) {
      const pur = firmPurchases.find((row) => row.id === allocation.id)
      if (!pur) continue
      const newAmtPaid = money((pur.amt_paid || 0) + allocation.amount)
      await repo.update(pur.id, {
        amt_paid: newAmtPaid,
        pay_status: payStatusFromPaidPurchase(pur.grand_total, newAmtPaid),
      })
    }

    const accounting = useAccountingStore()
    const appliedTotal = money(allocations.reduce((sum, row) => sum + row.amount, 0))
    const excess = money(paymentAmount - appliedTotal)
    const finalNote = excess > 0.01
      ? `${note}${note ? ' | ' : ''}₹${excess.toFixed(2)} open bills se zyada — supplier advance`
      : note
    await accounting.postPaymentVoucher(id, 'purchase', paymentAmount, false, 0, date, finalNote, paymentAccountName)

    await load()
  }

  async function restore(id: string) {
    const rec = await repo.restore(id)
    if (rec) {
      await restoreAttachmentsForEntity('purchase', id, rec.firm_id)
      const accounting = useAccountingStore()
      await accounting.postPurchaseToLedger(rec)
      await syncPaymentVoucher(rec)
      await recordPurchaseMovements(rec)
      await createCapitalAssetsFromPurchase(rec)
      await logActivity(rec.firm_id, 'restore', 'purchase', id, `Purchase ${rec.bill_no} restored`)
    }
    await load()
  }

  async function moveToFirm(purchaseIds: string[], toFirmId: string, note = ''): Promise<MovePurchaseBillsResult> {
    const firm = useFirmStore()
    const result = await movePurchaseBillsToFirm({
      purchaseIds,
      fromFirmId: firm.activeFirmId,
      toFirmId,
      note,
    })
    await load()
    return result
  }

  return {
    list,
    loaded,
    load,
    add,
    update,
    remove,
    restore,
    recordPayment,
    moveToFirm,
    confirmReelStock,
    confirmConsumableStock,
  }
})
