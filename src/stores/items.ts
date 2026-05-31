import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/data/db'
import { createRepo } from '@/data/repo'
import { useFirmStore } from './firm'
import type { Item } from '@/types/models'

const repo = createRepo<Item>(db.items)

export type NewItem = Omit<Item, 'id' | 'firm_id' | 'created_at' | 'updated_at' | 'is_deleted' | '_dirty'>

export const useItemStore = defineStore('items', () => {
  const list = ref<Item[]>([])
  const loaded = ref(false)

  async function load() {
    const firm = useFirmStore()
    list.value = await repo.all(firm.activeFirmId)
    loaded.value = true
  }

  async function add(data: NewItem): Promise<Item> {
    const firm = useFirmStore()
    const rec = await repo.create({ ...data, firm_id: firm.activeFirmId } as any)
    await load()
    return rec
  }

  async function update(id: string, patch: Partial<Item>) {
    await repo.update(id, patch)
    await load()
  }

  async function remove(id: string) {
    await repo.remove(id)
    await load()
  }

  async function restore(id: string) {
    await repo.restore(id)
    await load()
  }

  /** Find or create an item by name (used by billing + box recipe handoff). */
  async function ensure(name: string, extra: Partial<Item> = {}): Promise<Item> {
    const key = name.trim().toLowerCase()
    const match = list.value.find((i) => i.name.trim().toLowerCase() === key)
    if (match) return match
    return add({
      name: name.trim(), unit: 'PCS', hsn: '', gst: 18, rate: 0,
      size: '', gsm: '', bf: '', ...extra,
    })
  }

  return { list, loaded, load, add, update, remove, restore, ensure }
})
