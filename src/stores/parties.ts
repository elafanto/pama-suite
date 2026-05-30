import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db } from '@/data/db'
import { createRepo } from '@/data/repo'
import { useFirmStore } from './firm'
import type { Party, PartyRole } from '@/types/models'

const repo = createRepo<Party>(db.parties)

export type NewParty = Omit<Party, 'id' | 'firm_id' | 'created_at' | 'updated_at' | 'is_deleted' | '_dirty'>

export const usePartyStore = defineStore('parties', () => {
  const list = ref<Party[]>([])
  const loaded = ref(false)

  const customers = computed(() => list.value.filter((p) => p.roles.includes('customer')))
  const vendors   = computed(() => list.value.filter((p) => p.roles.includes('vendor')))

  async function load() {
    const firm = useFirmStore()
    list.value = await repo.all(firm.activeFirmId)
    loaded.value = true
  }

  async function add(data: NewParty): Promise<Party> {
    const firm = useFirmStore()
    const rec = await repo.create({ ...data, firm_id: firm.activeFirmId } as any)
    await load()
    return rec
  }

  async function update(id: string, patch: Partial<Party>) {
    await repo.update(id, patch)
    await load()
  }

  async function remove(id: string) {
    await repo.remove(id)
    await load()
  }

  /** Find or create a party by name+gst, optionally ensuring a role. Used by
   *  billing/purchases so a customer or vendor is auto-created once. */
  async function ensure(name: string, role: PartyRole, extra: Partial<Party> = {}): Promise<Party> {
    const key = name.trim().toLowerCase()
    const gst = (extra.gst || '').trim().toUpperCase()
    let match = list.value.find(
      (p) => (gst && p.gst.toUpperCase() === gst) || p.name.trim().toLowerCase() === key,
    )
    if (match) {
      if (!match.roles.includes(role)) {
        await update(match.id, { roles: [...match.roles, role] })
        match = list.value.find((p) => p.id === match!.id)!
      }
      return match
    }
    return add({
      name: name.trim(), roles: [role], gst, phone: '', email: '', addr: '',
      city: '', pin: '', state: gst.slice(0, 2), is_consumer: false,
      bank: '', acno: '', ifsc: '', acname: '', ...extra,
    })
  }

  return { list, loaded, customers, vendors, load, add, update, remove, ensure }
})
