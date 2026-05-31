import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/data/db'
import { createRepo } from '@/data/repo'
import { useFirmStore } from './firm'
import type { Recipe } from '@/types/models'

const repo = createRepo<Recipe>(db.recipes)

export const useRecipeStore = defineStore('recipes', () => {
  const list = ref<Recipe[]>([])
  const loaded = ref(false)

  async function load() {
    const firm = useFirmStore()
    list.value = await repo.all(firm.activeFirmId)
    loaded.value = true
  }

  async function add(data: Omit<Recipe, 'id' | 'firm_id' | 'created_at' | 'updated_at' | 'is_deleted' | '_dirty'>): Promise<Recipe> {
    const firm = useFirmStore()
    const rec = await repo.create({ ...data, firm_id: firm.activeFirmId } as any)
    await load()
    return rec
  }

  async function update(id: string, patch: Partial<Recipe>) {
    await repo.update(id, patch)
    await load()
  }

  async function remove(id: string) {
    await repo.remove(id)
    await load()
  }

  return { list, loaded, load, add, update, remove }
})
