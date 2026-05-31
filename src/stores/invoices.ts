import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/data/db'
import { createRepo } from '@/data/repo'
import { useFirmStore } from './firm'
import { useAccountingStore } from './accounting'
import { logActivity } from '@/services/activityLog'
import { allocateBillNo } from '@/services/invoiceNumber'
import type { Invoice } from '@/types/models'

const repo = createRepo<Invoice>(db.invoices)

export const useInvoiceStore = defineStore('invoices', () => {
  const list = ref<Invoice[]>([])
  const loaded = ref(false)

  async function load() {
    const firm = useFirmStore()
    list.value = await repo.all(firm.activeFirmId)
    loaded.value = true
    await firm.syncBillSequence(firm.activeFirmId, list.value)
  }

  async function add(
    data: Omit<Invoice, 'id' | 'firm_id' | 'created_at' | 'updated_at' | 'is_deleted' | '_dirty'>,
    useAutoNumber = true,
  ): Promise<Invoice> {
    const firmStore = useFirmStore()
    const firmId = firmStore.activeFirmId
    const accounting = useAccountingStore()

    if (!firmId) throw new Error('Active firm required')

    await load()

    const firm = firmStore.activeFirm
    if (!firm) throw new Error('Active firm required')

    let payload = { ...data }

    if (useAutoNumber) {
      const { billNo, nextSequenceAfter } = allocateBillNo(firm, list.value)
      payload.bill_no = billNo
      await firmStore.update(firmId, { next_bill_no: nextSequenceAfter })
    } else if (!payload.bill_no?.trim()) {
      throw new Error('Invoice number missing')
    } else {
      const dup = list.value.some(
        (b) => !b.is_deleted && b.firm_id === firmId && b.bill_no === payload.bill_no.trim(),
      )
      if (dup) throw new Error(`Invoice number ${payload.bill_no} already exists`)
    }

    const rec = await repo.create({ ...payload, firm_id: firmId, bill_no: payload.bill_no.trim() } as any)

    try {
      await accounting.load()
      await accounting.postSaleToLedger(rec)
    } catch (e) {
      console.warn('Ledger posting skipped:', e)
    }
    await logActivity(firmId, 'create', 'invoice', rec.id, `Invoice ${rec.bill_no} created`)

    await load()
    return rec
  }

  async function update(id: string, patch: Partial<Invoice>) {
    const rec = await repo.update(id, patch)
    if (rec) {
      const accounting = useAccountingStore()
      await accounting.postSaleToLedger(rec)
      await logActivity(rec.firm_id, 'update', 'invoice', rec.id, `Invoice ${rec.bill_no} updated`)
    }
    await load()
  }

  async function remove(id: string) {
    const existing = await repo.get(id)
    await repo.remove(id)
    const accounting = useAccountingStore()
    await accounting.reverseLedgerByRef(id)
    if (existing) {
      await logActivity(existing.firm_id, 'delete', 'invoice', id, `Invoice ${existing.bill_no} deleted`)
    }
    await load()
  }

  async function restore(id: string) {
    const rec = await repo.restore(id)
    if (rec) {
      const accounting = useAccountingStore()
      await accounting.postSaleToLedger(rec)
      await logActivity(rec.firm_id, 'restore', 'invoice', id, `Invoice ${rec.bill_no} restored`)
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
      notes: isWriteOff ? `${existing.notes || ''} [Write-off: ₹${writeOffAmt.toFixed(2)}]`.trim() : existing.notes
    })

    // Post Receipt Voucher to ledger
    const accounting = useAccountingStore()
    await accounting.postPaymentVoucher(id, 'invoice', amount, isWriteOff, writeOffAmt, date, note)

    await load()
  }

  return { list, loaded, load, add, update, remove, restore, recordPayment }
})

