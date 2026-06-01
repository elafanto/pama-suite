import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/data/db'
import { createRepo } from '@/data/repo'
import { useFirmStore } from './firm'
import { useAccountingStore } from './accounting'
import { logActivity } from '@/services/activityLog'
import { createReelsFromPurchase, reversePurchaseReels } from '@/services/production'
import type { Purchase } from '@/types/models'

const repo = createRepo<Purchase>(db.purchases)

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
    await createReelsFromPurchase(rec)
    await logActivity(firmId, 'create', 'purchase', rec.id, `Purchase ${rec.bill_no} from ${rec.supplier_name}`)

    await load()
    return rec
  }

  async function update(id: string, patch: Partial<Purchase>) {
    const rec = await repo.update(id, patch)
    if (rec) {
      const accounting = useAccountingStore()
      await accounting.postPurchaseToLedger(rec)
      await reversePurchaseReels(id)
      await createReelsFromPurchase(rec)
      await logActivity(rec.firm_id, 'update', 'purchase', rec.id, `Purchase ${rec.bill_no} updated`)
    }
    await load()
  }

  async function remove(id: string) {
    const existing = await repo.get(id)
    await repo.remove(id)
    await reversePurchaseReels(id)
    const accounting = useAccountingStore()
    await accounting.reverseLedgerByRef(id)
    if (existing) {
      await logActivity(existing.firm_id, 'delete', 'purchase', id, `Purchase ${existing.bill_no} deleted`)
    }
    await load()
  }

  async function recordPayment(id: string, amount: number, isWriteOff: boolean, note = '', date = '') {
    const existing = await repo.get(id)
    if (!existing) return

    const previousPaid = existing.amt_paid || 0
    const newAmtPaid = previousPaid + amount
    let newPayStatus = existing.pay_status
    const outstanding = Math.max(0, existing.grand_total - previousPaid)
    const writeOffAmt = isWriteOff ? Math.max(0, outstanding - amount) : 0

    const totalRecorded = newAmtPaid + writeOffAmt

    if (Math.abs(totalRecorded - existing.grand_total) < 0.01 || isWriteOff) {
      newPayStatus = 'PAID'
    } else if (totalRecorded > 0) {
      newPayStatus = 'PARTIAL'
    } else {
      newPayStatus = 'UNPAID'
    }

    const finalAmtPaid = isWriteOff ? existing.grand_total : newAmtPaid

    await repo.update(id, {
      amt_paid: finalAmtPaid,
      pay_status: newPayStatus,
      notes: isWriteOff
        ? `${existing.notes || ''} [Write-off: ₹${writeOffAmt.toFixed(2)}]`.trim()
        : existing.notes,
    })

    // Post Payment Voucher to ledger
    const accounting = useAccountingStore()
    await accounting.postPaymentVoucher(id, 'purchase', amount, isWriteOff, writeOffAmt, date, note)

    await load()
  }

  async function restore(id: string) {
    const rec = await repo.restore(id)
    if (rec) {
      const accounting = useAccountingStore()
      await accounting.postPurchaseToLedger(rec)
      await createReelsFromPurchase(rec)
      await logActivity(rec.firm_id, 'restore', 'purchase', id, `Purchase ${rec.bill_no} restored`)
    }
    await load()
  }

  return { list, loaded, load, add, update, remove, restore, recordPayment }
})
