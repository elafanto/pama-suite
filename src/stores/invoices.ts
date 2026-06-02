import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/data/db'
import { createRepo } from '@/data/repo'
import { uid, nowISO } from '@/data/util'
import { useFirmStore } from './firm'
import { useAccountingStore } from './accounting'
import { logActivity } from '@/services/activityLog'
import { recordInvoiceMovements } from '@/services/inventoryLedger'
import { allocateBillNo } from '@/services/invoiceNumber'
import type { Invoice } from '@/types/models'

const repo = createRepo<Invoice>(db.invoices)
const plain = <X>(o: X): X => JSON.parse(JSON.stringify(o))
let addQueue = Promise.resolve()
const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100

async function syncReceiptVoucher(invoice: Invoice) {
  const accounting = useAccountingStore()
  const paid = money(Math.min(Math.max(invoice.amt_paid || 0, 0), invoice.grand_total || 0))
  if (paid <= 0) {
    await accounting.reverseLedgerByRef(`${invoice.id}_PAY`)
    return
  }
  await accounting.postPaymentVoucher(invoice.id, 'invoice', paid, false, 0, invoice.date, 'Recorded on invoice save')
}

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
    const run = async (): Promise<Invoice> => {
    const firmStore = useFirmStore()
    const firmId = firmStore.activeFirmId
    const accounting = useAccountingStore()

    if (!firmId) throw new Error('Active firm required')

    let rec!: Invoice
    await db.transaction('rw', db.firms, db.invoices, async () => {
      const firm = await db.firms.get(firmId)
      if (!firm) throw new Error('Active firm required')
      const invoices = await db.invoices.where('firm_id').equals(firmId).filter((b) => !b.is_deleted).toArray()
      const payload = { ...data }

      if (useAutoNumber) {
        const { billNo, nextSequenceAfter } = allocateBillNo(firm, invoices)
        payload.bill_no = billNo
        await db.firms.put(plain({ ...firm, next_bill_no: nextSequenceAfter, updated_at: nowISO(), _dirty: true }))
      } else if (!payload.bill_no?.trim()) {
        throw new Error('Invoice number missing')
      } else {
        const dup = invoices.some((b) => b.bill_no.trim().toUpperCase() === payload.bill_no.trim().toUpperCase())
        if (dup) throw new Error(`Invoice number ${payload.bill_no} already exists`)
      }

      const now = nowISO()
      rec = plain({
        ...payload,
        id: uid(),
        firm_id: firmId,
        bill_no: payload.bill_no.trim(),
        created_at: now,
        updated_at: now,
        is_deleted: false,
        _dirty: true,
      }) as Invoice
      await db.invoices.add(rec)
    })

    try {
      await accounting.load()
      await accounting.postSaleToLedger(rec)
      await syncReceiptVoucher(rec)
    } catch (e) {
      console.warn('Ledger posting skipped:', e)
    }
    await recordInvoiceMovements(rec)
    await logActivity(firmId, 'create', 'invoice', rec.id, `Invoice ${rec.bill_no} created`)

    await load()
    return rec
    }

    const next = addQueue.then(run, run)
    addQueue = next.then(() => undefined, () => undefined)
    return next
  }

  async function update(id: string, patch: Partial<Invoice>) {
    const rec = await repo.update(id, patch)
    if (rec) {
      const accounting = useAccountingStore()
      await accounting.postSaleToLedger(rec)
      await syncReceiptVoucher(rec)
      await recordInvoiceMovements(rec)
      await logActivity(rec.firm_id, 'update', 'invoice', rec.id, `Invoice ${rec.bill_no} updated`)
    }
    await load()
  }

  async function remove(id: string) {
    const existing = await repo.get(id)
    await repo.remove(id)
    const accounting = useAccountingStore()
    await accounting.reverseLedgerByRef(id)
    await accounting.reverseLedgerByRef(`${id}_PAY`)
    if (existing) {
      await recordInvoiceMovements({ ...existing, is_deleted: true })
      await logActivity(existing.firm_id, 'delete', 'invoice', id, `Invoice ${existing.bill_no} deleted`)
    }
    await load()
  }

  async function restore(id: string) {
    const rec = await repo.restore(id)
    if (rec) {
      const accounting = useAccountingStore()
      await accounting.postSaleToLedger(rec)
      await syncReceiptVoucher(rec)
      await recordInvoiceMovements(rec)
      await logActivity(rec.firm_id, 'restore', 'invoice', id, `Invoice ${rec.bill_no} restored`)
    }
    await load()
  }

  async function recordPayment(id: string, amount: number, isWriteOff: boolean, note = '', date = '') {
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
      notes: isWriteOff ? `${existing.notes || ''} [Write-off: ₹${writeOffAmt.toFixed(2)}]`.trim() : existing.notes
    })

    // Post Receipt Voucher to ledger
    const accounting = useAccountingStore()
    await accounting.postPaymentVoucher(id, 'invoice', cashPaidForVoucher, isWriteOff, writeOffAmt, date, note)

    await load()
  }

  return { list, loaded, load, add, update, remove, restore, recordPayment }
})

