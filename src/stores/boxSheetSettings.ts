import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  type BoxSheetSettings,
  loadBoxSheetSettings,
  mergeBoxSheetSettings,
  resetBoxSheetSettings,
  saveBoxSheetSettings,
} from '@/services/boxSheetSettings'

export const useBoxSheetSettingsStore = defineStore('boxSheetSettings', () => {
  const settings = ref<BoxSheetSettings>(loadBoxSheetSettings())

  function persist(next: BoxSheetSettings) {
    settings.value = next
    saveBoxSheetSettings(next)
  }

  function update(patch: Partial<BoxSheetSettings>) {
    persist(mergeBoxSheetSettings({ ...settings.value, ...patch }))
  }

  function updateMachine(patch: Partial<BoxSheetSettings['machine']>) {
    persist(mergeBoxSheetSettings({
      ...settings.value,
      machine: { ...settings.value.machine, ...patch },
    }))
  }

  function updateCaliper(key: string, value: number) {
    persist(mergeBoxSheetSettings({
      ...settings.value,
      caliperTable: { ...settings.value.caliperTable, [key]: value },
    }))
  }

  function updateGlueFlap(ply: string, value: number) {
    persist(mergeBoxSheetSettings({
      ...settings.value,
      glueFlapDefaults: { ...settings.value.glueFlapDefaults, [ply]: value },
    }))
  }

  function reset() {
    persist(resetBoxSheetSettings())
  }

  return { settings, persist, update, updateMachine, updateCaliper, updateGlueFlap, reset }
})
