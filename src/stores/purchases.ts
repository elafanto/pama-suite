import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/data/db'
import { createRepo } from '@/data/repo'
import { useFirmStore } from './firm'
import { useAccountingStore } from './accounting'
import { logActivity } from '@/services/activityLog'
import { recordPurchaseMovements } from '@/services/inventoryLedger'
import { movePurchaseBillsToFirm, type MovePurchaseBillsResult } from '@/services/purchaseCorrection'
import {
  assertPurchaseReelsHaveNoConsumptionHistory,
  createConsumablesFromPurchase,
  createReelsFromPurchase,
  purchaseReelStockChanged,
  reversePurchaseReels,
} from '@/services/production'
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
    await createReelsFromPurchase(rec)
    await createConsumablesFromPurchase(rec)
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
      if (reelStockChanged) {
        await reversePurchaseReels(id)
      }
      await createReelsFromPurchase(rec)
      await createConsumablesFromPurchase(rec)
      await logActivity(rec.firm_id, 'update', 'purchase', rec.id, `Purchase ${rec.bill_no} updated`)
    }
    await load()
  }

  async function remove(id: string) {
    const existing = await repo.get(id)
    if (existing) {
      await assertPurchaseReelsHaveNoConsumptionHistory(id, 'delete')
    }
    await repo.remove(id)
    await reversePurchaseReels(id)
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

    const previousPaid = money(existing.amt_paid || 0)
    const outstanding = Math.max(0, money(existing.grand_total - previousPaid))
    const paymentAmount = money(Math.min(Math.max(amount, 0), outstanding))
    const newAmtPaid = money(previousPaid + paymentAmount)
    let newPayStatus = existing.pay_status
    const writeOffAmt = isWriteOff ? money(Math.max(0, outstanding - paymentAmount)) : 0

    const totalRecorded = money(newAmtPaid + writeOffAmt)

    if (Math.abs(totalRecorded - existing.grand_total) < 0.01 || isWriteOff) {
      newPayStatus = 'PAID'
    } else if (totalRecorded > 0) {
      newPayStatus = 'PARTIAL'
    } else {
      newPayStatus = 'UNPAID'
    }

    const finalAmtPaid = isWriteOff ? existing.grand_total : newAmtPaid
    const cashPaidForVoucher = isWriteOff ? newAmtPaid : finalAmtPaid

    await repo.update(id, {
      amt_paid: finalAmtPaid,
      pay_status: newPayStatus,
      notes: isWriteOff
        ? `${existing.notes || ''} [Write-off: ₹${writeOffAmt.toFixed(2)}]`.trim()
        : existing.notes,
    })

    // Post Payment Voucher to ledger
    const accounting = useAccountingStore()
    await accounting.postPaymentVoucher(id, 'purchase', cashPaidForVoucher, isWriteOff, writeOffAmt, date, note, paymentAccountName)

    await load()
  }

  async function restore(id: string) {
    const rec = await repo.restore(id)
    if (rec) {
      const accounting = useAccountingStore()
      await accounting.postPurchaseToLedger(rec)
      await syncPaymentVoucher(rec)
      await recordPurchaseMovements(rec)
      await createReelsFromPurchase(rec)
      await createConsumablesFromPurchase(rec)
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

  return { list, loaded, load, add, update, remove, restore, recordPayment, moveToFirm }
})
