import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useFirmStore } from './firm'
import { listCapitalAssets, updateCapitalAssetStatus } from '@/services/assets'
import type { CapitalAsset, CapitalAssetStatus } from '@/types/models'

export const useCapitalAssetStore = defineStore('capitalAssets', () => {
  const list = ref<CapitalAsset[]>([])
  const loaded = ref(false)

  async function load() {
    const firm = useFirmStore()
    list.value = await listCapitalAssets(firm.activeFirmId)
    loaded.value = true
  }

  async function setStatus(assetId: string, status: CapitalAssetStatus) {
    await updateCapitalAssetStatus(assetId, status)
    await load()
  }

  return { list, loaded, load, setStatus }
})
