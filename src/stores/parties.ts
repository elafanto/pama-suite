import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db } from '@/data/db'
import { createRepo } from '@/data/repo'
import { useFirmStore } from './firm'
import { logActivity } from '@/services/activityLog'
import { formatGstin } from '@/services/gst'
import { mergeParties, previewPartyMerge, type PartyMergeFieldPicks } from '@/services/partyMerge'
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
    const rec = await repo.create({
      ...data,
      gst: formatGstin(data.gst),
      firm_id: firm.activeFirmId,
    } as any)
    await logActivity(firm.activeFirmId, 'create', 'party', rec.id, `Party ${rec.name} added`)
    await load()
    return rec
  }

  async function update(id: string, patch: Partial<Party>) {
    const normalized = patch.gst !== undefined ? { ...patch, gst: formatGstin(patch.gst) } : patch
    const rec = await repo.update(id, normalized)
    if (rec) await logActivity(rec.firm_id, 'update', 'party', rec.id, `Party ${rec.name} updated`)
    await load()
  }

  async function remove(id: string) {
    const existing = await repo.get(id)
    await repo.remove(id)
    if (existing) {
      await logActivity(existing.firm_id, 'delete', 'party', id, `Party ${existing.name} moved to Recycle Bin`, {
        name: existing.name,
      })
    }
    await load()
  }

  async function restore(id: string) {
    const rec = await repo.restore(id)
    if (rec) {
      await logActivity(rec.firm_id, 'restore', 'party', id, `Party ${rec.name} restored from Recycle Bin`, {
        name: rec.name,
      })
    }
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

  async function merge(winnerId: string, loserId: string, fieldPicks?: PartyMergeFieldPicks) {
    const result = await mergeParties(winnerId, loserId, fieldPicks)
    const winner = await repo.get(winnerId)
    await logActivity(
      winner?.firm_id || useFirmStore().activeFirmId,
      'update',
      'party',
      winnerId,
      `Merged party into ${winner?.name || winnerId} (${result.rewritten} records)`,
      { loserId, rewritten: result.rewritten },
    )
    await load()
    return result
  }

  return {
    list,
    loaded,
    customers,
    vendors,
    load,
    add,
    update,
    remove,
    restore,
    ensure,
    merge,
    previewMerge: previewPartyMerge,
  }
})
