import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/data/db'
import { createRepo } from '@/data/repo'
import { useFirmStore } from '@/stores/firm'
import { logActivity } from '@/services/activityLog'
import {
  allocateAdvanceFifo,
  applySlicesToAdvance,
  openPartyAdvances,
  partyAdvanceStatus,
  postAdvanceApplyVoucher,
  postPartyAdvanceVoucher,
  reversePartyAdvanceVoucher,
  round2,
  totalOpenAdvance,
} from '@/services/partyAdvance'
import { payStatusFromPaid, payStatusFromPaidPurchase } from '@/services/partyPaymentAllocation'
import type { PartyAdvance, PartyAdvanceDirection, PartyAdvanceMode } from '@/types/models'

const repo = createRepo<PartyAdvance>(db.party_advances)

export const usePartyAdvanceStore = defineStore('partyAdvances', () => {
  const list = ref<PartyAdvance[]>([])
  const loaded = ref(false)

  async function load() {
    const firm = useFirmStore()
    list.value = await repo.all(firm.activeFirmId)
    loaded.value = true
  }

  async function record(input: {
    party_id: string | null
    party_name: string
    direction: PartyAdvanceDirection
    date: string
    amount: number
    mode: PartyAdvanceMode
    narration?: string
    postVoucher?: boolean
  }): Promise<PartyAdvance> {
    const firm = useFirmStore()
    const firmId = firm.activeFirmId
    if (!firmId) throw new Error('Active firm required')
    const amount = round2(input.amount)
    if (amount <= 0) throw new Error('Advance amount 0 se zyada hona chahiye')
    if (!input.party_name.trim()) throw new Error('Party name required')

    const rec = await repo.create({
      firm_id: firmId,
      party_id: input.party_id,
      party_name: input.party_name.trim(),
      direction: input.direction,
      date: input.date,
      amount,
      remaining: amount,
      mode: input.mode,
      narration: (input.narration || '').trim(),
      status: 'open',
      applications: [],
    } as any)

    let voucherId: string | undefined
    if (input.postVoucher !== false) {
      voucherId = await postPartyAdvanceVoucher(firmId, rec)
      await repo.update(rec.id, { voucher_id: voucherId })
    }

    await logActivity(
      firmId,
      'create',
      'party_advance',
      rec.id,
      `${input.direction === 'in' ? 'Customer' : 'Vendor'} advance ₹${amount} — ${rec.party_name}`,
    )
    await load()
    return { ...rec, voucher_id: voucherId }
  }

  async function reverse(id: string) {
    const existing = await repo.get(id)
    if (!existing || existing.is_deleted) throw new Error('Advance nahi mili')
    if ((existing.applications || []).length) {
      throw new Error('Is advance pe bill apply ho chuka hai — pehle un bills se payment clear karein / advance reverse nahi ho sakta')
    }
    await reversePartyAdvanceVoucher(id)
    await repo.update(id, {
      status: 'reversed',
      remaining: 0,
      is_deleted: true,
    } as any)
    await logActivity(existing.firm_id, 'delete', 'party_advance', id, `Advance reversed — ${existing.party_name}`)
    await load()
  }

  /**
   * Apply open advances (FIFO) to a bill. Updates bill amt_paid and advance remaining.
   * Returns amount actually applied.
   */
  async function applyToBill(opts: {
    billId: string
    billKind: 'invoice' | 'purchase'
    amount: number
    date?: string
    note?: string
  }): Promise<number> {
    const firm = useFirmStore()
    const firmId = firm.activeFirmId
    if (!firmId) throw new Error('Active firm required')
    const want = round2(opts.amount)
    if (want <= 0) return 0

    const date = opts.date || new Date().toISOString().slice(0, 10)

    if (opts.billKind === 'invoice') {
      const bill = await db.invoices.get(opts.billId)
      if (!bill || bill.is_deleted) throw new Error('Invoice nahi mili')
      const outstanding = round2(Math.max(0, bill.grand_total - (bill.amt_paid || 0)))
      const toApply = round2(Math.min(want, outstanding))
      if (toApply <= 0.01) return 0

      const open = openPartyAdvances(list.value, bill.party_id, bill.party_name, 'in')
      const slices = allocateAdvanceFifo(open, toApply)
      if (!slices.length) throw new Error('Is party pe koi open customer advance nahi')

      let applied = 0
      for (const slice of slices) {
        const adv = await repo.get(slice.advanceId)
        if (!adv || adv.is_deleted) continue
        await postAdvanceApplyVoucher({
          firmId,
          advance: adv,
          applyAmount: slice.amount,
          billId: bill.id,
          billKind: 'invoice',
          billNo: bill.bill_no,
          partyName: bill.party_name,
          date,
        })
        const next = applySlicesToAdvance(adv, [{
          amount: slice.amount,
          bill_id: bill.id,
          bill_kind: 'invoice',
          bill_no: bill.bill_no,
          date,
        }])
        await repo.update(adv.id, {
          remaining: next.remaining,
          applications: next.applications,
          status: next.status,
        })
        applied = round2(applied + slice.amount)
      }

      const newPaid = round2((bill.amt_paid || 0) + applied)
      await db.invoices.put({
        ...bill,
        amt_paid: newPaid,
        pay_status: payStatusFromPaid(bill.grand_total, newPaid),
        last_payment_date: date,
        updated_at: new Date().toISOString(),
        _dirty: true,
        notes: opts.note
          ? `${bill.notes || ''} [${opts.note}]`.trim()
          : bill.notes,
      })
      await logActivity(firmId, 'update', 'invoice', bill.id, `Advance ₹${applied} applied to ${bill.bill_no}`)
      await load()
      return applied
    }

    const pur = await db.purchases.get(opts.billId)
    if (!pur || pur.is_deleted) throw new Error('Purchase nahi mili')
    const outstanding = round2(Math.max(0, pur.grand_total - (pur.amt_paid || 0)))
    const toApply = round2(Math.min(want, outstanding))
    if (toApply <= 0.01) return 0

    const open = openPartyAdvances(list.value, pur.supplier_id, pur.supplier_name, 'out')
    const slices = allocateAdvanceFifo(open, toApply)
    if (!slices.length) throw new Error('Is supplier pe koi open vendor advance nahi')

    let applied = 0
    for (const slice of slices) {
      const adv = await repo.get(slice.advanceId)
      if (!adv || adv.is_deleted) continue
      await postAdvanceApplyVoucher({
        firmId,
        advance: adv,
        applyAmount: slice.amount,
        billId: pur.id,
        billKind: 'purchase',
        billNo: pur.bill_no,
        partyName: pur.supplier_name,
        date,
      })
      const next = applySlicesToAdvance(adv, [{
        amount: slice.amount,
        bill_id: pur.id,
        bill_kind: 'purchase',
        bill_no: pur.bill_no,
        date,
      }])
      await repo.update(adv.id, {
        remaining: next.remaining,
        applications: next.applications,
        status: next.status,
      })
      applied = round2(applied + slice.amount)
    }

    const newPaid = round2((pur.amt_paid || 0) + applied)
    await db.purchases.put({
      ...pur,
      amt_paid: newPaid,
      pay_status: payStatusFromPaidPurchase(pur.grand_total, newPaid),
      last_payment_date: date,
      updated_at: new Date().toISOString(),
      _dirty: true,
      notes: opts.note
        ? `${pur.notes || ''} [${opts.note}]`.trim()
        : pur.notes,
    })
    await logActivity(firmId, 'update', 'purchase', pur.id, `Advance ₹${applied} applied to ${pur.bill_no}`)
    await load()
    return applied
  }

  function openForParty(partyId: string | null | undefined, partyName: string, direction: PartyAdvanceDirection) {
    return openPartyAdvances(list.value, partyId, partyName, direction)
  }

  function totalOpen(partyId: string | null | undefined, partyName: string, direction: PartyAdvanceDirection) {
    return totalOpenAdvance(list.value, partyId, partyName, direction)
  }

  return {
    list,
    loaded,
    load,
    record,
    reverse,
    applyToBill,
    openForParty,
    totalOpen,
    partyAdvanceStatus,
  }
})
