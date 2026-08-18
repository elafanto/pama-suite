import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db } from '@/data/db'
import { uid, nowISO } from '@/data/util'
import { resolveNextSequence } from '@/services/invoiceNumber'
import { logActivity } from '@/services/activityLog'
import {
  archiveFirmSignature,
  migrateLegacySignaturesToFirms,
  persistFirmSignature,
} from '@/services/firmSignature'
import { syncSignatureToCloudIfReady } from '@/services/firmSignatureCloud'
import type { Firm, Invoice } from '@/types/models'
import {
  isSalesMonthLocked,
  normalizeLockedSalesMonths,
  salesPeriodFromDate,
  withLockedSalesMonth,
} from '@/services/salesMonthLock'

export type FirmLinkedCounts = { parties: number; invoices: number; purchases: number }

export type FirmRemoveResult =
  | { ok: true }
  | { ok: false; error: 'last_firm' | 'not_found' }

const ACTIVE_KEY = 'pama_active_firm'
const plain = <X>(o: X): X => JSON.parse(JSON.stringify(o))

export type NewFirm = Omit<Firm, 'id' | 'created_at' | 'updated_at' | 'is_deleted' | '_dirty'>

export const useFirmStore = defineStore('firm', () => {
  const firms = ref<Firm[]>([])
  const activeFirmId = ref<string>(localStorage.getItem(ACTIVE_KEY) || '')

  const activeFirm = computed(() => firms.value.find((f) => f.id === activeFirmId.value) || null)

  async function load() {
    firms.value = (await db.firms.filter((f) => !f.is_deleted).toArray())
      .sort((a, b) => a.name.localeCompare(b.name))

    if (firms.value.length === 0) {
      const now = nowISO()
      const def: Firm = {
        id: uid(), name: 'Pama Packaging', gst: '', addr: '', city: 'Jaspur',
        state: '05', pin: '', phone: '', email: '',
        bank_name: 'Union Bank of India', bank_acno: '663205090000180', bank_ifsc: '',
        prefix: 'INV', next_bill_no: 1, bill_no_format: 'dash_4',
        created_at: now, updated_at: now, is_deleted: false, _dirty: true,
      }
      await db.firms.add(def)
      firms.value = [def]
    }

    if (!activeFirmId.value || !firms.value.find((f) => f.id === activeFirmId.value)) {
      setActive(firms.value[0].id)
    }

    for (const f of firms.value) {
      if (!f.prefix || !f.next_bill_no || !f.bill_no_format) {
        await db.firms.put(plain({
          ...f,
          prefix: f.prefix || 'INV',
          next_bill_no: f.next_bill_no || 1,
          bill_no_format: f.bill_no_format || 'dash_4',
          updated_at: nowISO(),
          _dirty: true,
        }))
      }
    }
    if (firms.value.some((f) => !f.prefix || !f.next_bill_no || !f.bill_no_format)) {
      firms.value = (await db.firms.filter((x) => !x.is_deleted).toArray())
        .sort((a, b) => a.name.localeCompare(b.name))
    }

    const migrated = await migrateLegacySignaturesToFirms(firms.value)
    if (migrated > 0) {
      firms.value = (await db.firms.filter((x) => !x.is_deleted).toArray())
        .sort((a, b) => a.name.localeCompare(b.name))
    }
    for (const f of firms.value) {
      if (f.signature) persistFirmSignature(f.id, f.signature, f.name)
    }
  }

  function setActive(id: string) {
    activeFirmId.value = id
    localStorage.setItem(ACTIVE_KEY, id)
  }

  async function add(data: NewFirm): Promise<Firm> {
    const now = nowISO()
    const rec = plain({
      ...data,
      prefix: data.prefix || 'INV',
      next_bill_no: data.next_bill_no || 1,
      bill_no_format: data.bill_no_format || 'dash_4',
      id: uid(),
      created_at: now,
      updated_at: now,
      is_deleted: false,
      _dirty: true,
    }) as Firm
    await db.firms.add(rec)
    if (rec.signature) {
      persistFirmSignature(rec.id, rec.signature, rec.name)
      void syncSignatureToCloudIfReady()
    }
    await load()
    setActive(rec.id)
    return rec
  }

  async function update(id: string, patch: Partial<Firm>) {
    const existing = await db.firms.get(id)
    if (!existing) return
    const next = plain({ ...existing, ...patch, updated_at: nowISO(), _dirty: true }) as Firm
    await db.firms.put(next)
    if ('signature' in patch) {
      if (patch.signature) {
        persistFirmSignature(id, patch.signature, next.name)
      } else {
        if (existing.signature) archiveFirmSignature(existing.id, existing.signature, existing.name)
        persistFirmSignature(id, undefined, next.name)
      }
      void syncSignatureToCloudIfReady()
    } else if (next.signature) {
      persistFirmSignature(id, next.signature, next.name)
    }
    await load()
  }

  async function linkedCounts(firmId: string): Promise<FirmLinkedCounts> {
    const [parties, invoices, purchases] = await Promise.all([
      db.parties.where('firm_id').equals(firmId).filter((p) => !p.is_deleted).count(),
      db.invoices.where('firm_id').equals(firmId).filter((i) => !i.is_deleted).count(),
      db.purchases.where('firm_id').equals(firmId).filter((p) => !p.is_deleted).count(),
    ])
    return { parties, invoices, purchases }
  }

  async function remove(id: string): Promise<FirmRemoveResult> {
    if (firms.value.length <= 1) return { ok: false, error: 'last_firm' }
    const existing = await db.firms.get(id)
    if (!existing || existing.is_deleted) return { ok: false, error: 'not_found' }
    await db.firms.put({ ...existing, is_deleted: true, updated_at: nowISO(), _dirty: true })
    await logActivity(id, 'delete', 'firm', id, `Firm ${existing.name} moved to Recycle Bin`, {
      name: existing.name,
    })
    await load()
    return { ok: true }
  }

  async function restore(id: string): Promise<Firm | undefined> {
    const existing = await db.firms.get(id)
    if (!existing || !existing.is_deleted) return undefined
    const rec = plain({ ...existing, is_deleted: false, updated_at: nowISO(), _dirty: true }) as Firm
    await db.firms.put(rec)
    await logActivity(id, 'restore', 'firm', id, `Firm ${rec.name} restored from Recycle Bin`, {
      name: rec.name,
    })
    await load()
    return rec
  }

  async function deletedFirms(): Promise<Firm[]> {
    return (await db.firms.filter((f) => f.is_deleted).toArray())
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
  }

  async function syncBillSequence(firmId: string, invoices: Invoice[] = []) {
    if (!firmId) return
    const firm = firms.value.find((f) => f.id === firmId)
    if (!firm) return
    const resolved = resolveNextSequence(firm, invoices)
    if ((firm.next_bill_no || 1) < resolved) {
      await update(firmId, { next_bill_no: resolved })
    }
  }

  function isSalesLocked(dateOrPeriod: string | undefined | null, firmId = activeFirmId.value): boolean {
    const firm = firms.value.find((f) => f.id === firmId) || activeFirm.value
    return isSalesMonthLocked(firm, dateOrPeriod)
  }

  async function lockSalesMonth(period: string, firmId = activeFirmId.value): Promise<{ ok: true; period: string } | { ok: false; error: string }> {
    const p = salesPeriodFromDate(period)
    if (!p) return { ok: false, error: 'Invalid month' }
    if (!firmId) return { ok: false, error: 'Active firm required' }
    const firm = await db.firms.get(firmId)
    if (!firm) return { ok: false, error: 'Firm not found' }
    const months = withLockedSalesMonth(firm, p, true)
    await update(firmId, { locked_sales_months: months })
    return { ok: true, period: p }
  }

  async function unlockSalesMonth(period: string, firmId = activeFirmId.value): Promise<{ ok: true; period: string } | { ok: false; error: string }> {
    const p = salesPeriodFromDate(period)
    if (!p) return { ok: false, error: 'Invalid month' }
    if (!firmId) return { ok: false, error: 'Active firm required' }
    const firm = await db.firms.get(firmId)
    if (!firm) return { ok: false, error: 'Firm not found' }
    const months = withLockedSalesMonth(firm, p, false)
    await update(firmId, { locked_sales_months: months })
    return { ok: true, period: p }
  }

  const lockedSalesMonths = computed(() =>
    normalizeLockedSalesMonths(activeFirm.value?.locked_sales_months),
  )

  return {
    firms, activeFirmId, activeFirm, load, setActive, add, update, remove, restore,
    linkedCounts, deletedFirms, syncBillSequence,
    isSalesLocked, lockSalesMonth, unlockSalesMonth, lockedSalesMonths,
  }
})
