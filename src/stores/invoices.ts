import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/data/db'
import { createRepo } from '@/data/repo'
import { uid, nowISO } from '@/data/util'
import { useFirmStore } from './firm'
import { useAccountingStore } from './accounting'
import { logActivity } from '@/services/activityLog'
import { recordInvoiceMovements } from '@/services/inventoryLedger'
import { allocateBillNo, allocateChallanNo } from '@/services/invoiceNumber'
import { isDeliveryChallan } from '@/services/invoiceDoc'
import { notifyLocalDirty } from '@/services/localDirty'
import { isInvoiceCancelled, isInvoiceActive } from '@/services/invoiceStatus'
import { allocateCustomerReceipt, payStatusFromPaid } from '@/services/partyPaymentAllocation'
import { isSalesMonthLocked, salesMonthLockMessage, salesPeriodFromDate } from '@/services/salesMonthLock'
import type { Invoice } from '@/types/models'

const repo = createRepo<Invoice>(db.invoices)
const plain = <X>(o: X): X => JSON.parse(JSON.stringify(o))
let addQueue = Promise.resolve()
const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100

async function assertSalesMonthWritable(firmId: string, ...dates: Array<string | undefined | null>) {
  const firm = await db.firms.get(firmId)
  for (const d of dates) {
    if (isSalesMonthLocked(firm, d)) {
      throw new Error(salesMonthLockMessage(salesPeriodFromDate(d) || String(d || '')))
    }
  }
}

async function syncReceiptVoucher(invoice: Invoice) {
  const accounting = useAccountingStore()
  const paid = money(Math.min(Math.max(invoice.amt_paid || 0, 0), invoice.grand_total || 0))
  if (paid <= 0) {
    await accounting.reverseLedgerByRef(`${invoice.id}_PAY`)
    return
  }
  await accounting.postPaymentVoucher(invoice.id, 'invoice', paid, false, 0, invoice.date, 'Recorded on invoice save')
}

async function reverseInvoiceEffects(invoice: Invoice) {
  const accounting = useAccountingStore()
  await accounting.reverseLedgerByRef(invoice.id)
  await accounting.reverseLedgerByRef(`${invoice.id}_PAY`)
  await recordInvoiceMovements({ ...invoice, is_deleted: true, cancelled_at: invoice.cancelled_at || nowISO() })
}

async function restoreInvoiceEffects(invoice: Invoice) {
  const accounting = useAccountingStore()
  await accounting.postSaleToLedger(invoice)
  await syncReceiptVoucher(invoice)
  await recordInvoiceMovements(invoice)
}

export const useInvoiceStore = defineStore('invoices', () => {
  const list = ref<Invoice[]>([])
  const loaded = ref(false)

  async function load() {
    const firm = useFirmStore()
    list.value = await repo.all(firm.activeFirmId)
    loaded.value = true
    const allForSeq = firm.activeFirmId
      ? await db.invoices.where('firm_id').equals(firm.activeFirmId).toArray()
      : []
    await firm.syncBillSequence(firm.activeFirmId, allForSeq)
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
    await assertSalesMonthWritable(firmId, data.date)

    let rec!: Invoice
    await db.transaction('rw', db.firms, db.invoices, async () => {
      const firm = await db.firms.get(firmId)
      if (!firm) throw new Error('Active firm required')
      if (isSalesMonthLocked(firm, data.date)) {
        throw new Error(salesMonthLockMessage(salesPeriodFromDate(data.date)))
      }
      const invoices = await db.invoices.where('firm_id').equals(firmId).toArray()
      const payload = { ...data }

      if (useAutoNumber) {
        if (isDeliveryChallan(payload)) {
          const { billNo } = allocateChallanNo(firm, invoices, payload.date)
          payload.bill_no = billNo
        } else {
          const { billNo, nextSequenceAfter } = allocateBillNo(firm, invoices, payload.date)
          payload.bill_no = billNo
          await db.firms.put(plain({ ...firm, next_bill_no: nextSequenceAfter, updated_at: nowISO(), _dirty: true }))
        }
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
        cancelled_at: null,
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
    notifyLocalDirty()
    return rec
    }

    const next = addQueue.then(run, run)
    addQueue = next.then(() => undefined, () => undefined)
    return next
  }

  async function update(id: string, patch: Partial<Invoice>) {
    const existing = await repo.get(id)
    if (!existing) return
    if (isInvoiceCancelled(existing)) {
      throw new Error(`Invoice ${existing.bill_no} cancelled hai — pehle Un-cancel karo.`)
    }
    await assertSalesMonthWritable(existing.firm_id, existing.date, patch.date)
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

  /** Cancel bill: reverse ledger/stock, keep visible with cancelled_at. */
  async function cancel(id: string) {
    const existing = await repo.get(id)
    if (!existing || existing.is_deleted) throw new Error('Invoice not found')
    if (isInvoiceCancelled(existing)) throw new Error(`Invoice ${existing.bill_no} already cancelled`)
    await assertSalesMonthWritable(existing.firm_id, existing.date)

    const now = nowISO()
    const cancelled = plain({
      ...existing,
      cancelled_at: now,
      updated_at: now,
      _dirty: true,
    }) as Invoice
    await db.invoices.put(cancelled)
    await reverseInvoiceEffects(cancelled)
    await logActivity(existing.firm_id, 'cancel', 'invoice', id, `Invoice ${existing.bill_no} cancelled`)
    await load()
    notifyLocalDirty()
    return cancelled
  }

  /**
   * Un-cancel: restore ledger/stock. Caller must enforce typed confirmation in UI.
   */
  async function uncancel(id: string) {
    const existing = await repo.get(id)
    if (!existing || existing.is_deleted) throw new Error('Invoice not found')
    if (!isInvoiceCancelled(existing)) throw new Error(`Invoice ${existing.bill_no} cancelled nahi hai`)
    await assertSalesMonthWritable(existing.firm_id, existing.date)

    const now = nowISO()
    const restored = plain({
      ...existing,
      cancelled_at: null,
      updated_at: now,
      _dirty: true,
    }) as Invoice
    await db.invoices.put(restored)
    await restoreInvoiceEffects(restored)
    await logActivity(existing.firm_id, 'uncancel', 'invoice', id, `Invoice ${existing.bill_no} un-cancelled`)
    await load()
    notifyLocalDirty()
    return restored
  }

  /** Hard delete: hide from history (tombstone). Reverse if still active. */
  async function hardDelete(id: string) {
    const existing = await repo.get(id)
    if (!existing) throw new Error('Invoice not found')
    if (existing.is_deleted) return
    await assertSalesMonthWritable(existing.firm_id, existing.date)

    if (isInvoiceActive(existing)) {
      await reverseInvoiceEffects(existing)
    }

    await repo.remove(id)
    await logActivity(existing.firm_id, 'delete', 'invoice', id, `Invoice ${existing.bill_no} hard-deleted`)
    await load()
  }

  /** @deprecated use hardDelete — kept for older call sites */
  async function remove(id: string) {
    return hardDelete(id)
  }

  async function restore(id: string) {
    const existing = await repo.get(id)
    if (existing) await assertSalesMonthWritable(existing.firm_id, existing.date)
    const rec = await repo.restore(id)
    if (rec) {
      // Restored hard-deleted bills stay Cancelled if they were cancelled before delete.
      if (isInvoiceCancelled(rec)) {
        await logActivity(rec.firm_id, 'restore', 'invoice', id, `Invoice ${rec.bill_no} restored (still cancelled)`)
      } else {
        await restoreInvoiceEffects(rec)
        await logActivity(rec.firm_id, 'restore', 'invoice', id, `Invoice ${rec.bill_no} restored`)
      }
    }
    await load()
  }

  async function recordPayment(id: string, amount: number, isWriteOff: boolean, note = '', date = '') {
    const existing = await repo.get(id)
    if (!existing) return
    if (!isInvoiceActive(existing)) {
      throw new Error(`Invoice ${existing.bill_no} cancelled/deleted — payment nahi ho sakta`)
    }

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
      await accounting.postPaymentVoucher(id, 'invoice', applied, true, writeOffAmt, date, note)
      await load()
      return
    }

    const firmInvoices = await db.invoices.where('firm_id').equals(existing.firm_id).toArray()
    const allocations = allocateCustomerReceipt(firmInvoices, id, paymentAmount)
    if (allocations.length === 0) {
      throw new Error('Is party par koi open invoice nahi mila.')
    }

    for (const allocation of allocations) {
      const inv = firmInvoices.find((row) => row.id === allocation.id)
      if (!inv) continue
      const newAmtPaid = money((inv.amt_paid || 0) + allocation.amount)
      await repo.update(inv.id, {
        amt_paid: newAmtPaid,
        pay_status: payStatusFromPaid(inv.grand_total, newAmtPaid),
      })
    }

    const accounting = useAccountingStore()
    const appliedTotal = money(allocations.reduce((sum, row) => sum + row.amount, 0))
    const excess = money(paymentAmount - appliedTotal)
    const finalNote = excess > 0.01
      ? `${note}${note ? ' | ' : ''}₹${excess.toFixed(2)} open bills se zyada — party advance`
      : note
    await accounting.postPaymentVoucher(id, 'invoice', paymentAmount, false, 0, date, finalNote)

    await load()
  }

  return {
    list,
    loaded,
    load,
    add,
    update,
    cancel,
    uncancel,
    hardDelete,
    remove,
    restore,
    recordPayment,
  }
})
