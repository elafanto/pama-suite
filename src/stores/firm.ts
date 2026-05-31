import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db } from '@/data/db'
import { uid, nowISO } from '@/data/util'
import { resolveNextSequence } from '@/services/invoiceNumber'
import type { Firm, Invoice } from '@/types/models'

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
        prefix: 'INV', next_bill_no: 1,
        created_at: now, updated_at: now, is_deleted: false, _dirty: true,
      }
      await db.firms.add(def)
      firms.value = [def]
    }

    if (!activeFirmId.value || !firms.value.find((f) => f.id === activeFirmId.value)) {
      setActive(firms.value[0].id)
    }

    for (const f of firms.value) {
      if (!f.prefix || !f.next_bill_no) {
        await db.firms.put(plain({
          ...f,
          prefix: f.prefix || 'INV',
          next_bill_no: f.next_bill_no || 1,
          updated_at: nowISO(),
          _dirty: true,
        }))
      }
    }
    if (firms.value.some((f) => !f.prefix || !f.next_bill_no)) {
      firms.value = (await db.firms.filter((x) => !x.is_deleted).toArray())
        .sort((a, b) => a.name.localeCompare(b.name))
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
      id: uid(),
      created_at: now,
      updated_at: now,
      is_deleted: false,
      _dirty: true,
    }) as Firm
    await db.firms.add(rec)
    await load()
    setActive(rec.id)
    return rec
  }

  async function update(id: string, patch: Partial<Firm>) {
    const existing = await db.firms.get(id)
    if (!existing) return
    await db.firms.put(plain({ ...existing, ...patch, updated_at: nowISO(), _dirty: true }))
    await load()
  }

  async function remove(id: string) {
    if (firms.value.length <= 1) return
    const existing = await db.firms.get(id)
    if (!existing) return
    await db.firms.put({ ...existing, is_deleted: true, updated_at: nowISO(), _dirty: true })
    await load()
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

  return { firms, activeFirmId, activeFirm, load, setActive, add, update, remove, syncBillSequence }
})
