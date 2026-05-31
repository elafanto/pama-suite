import { defineStore } from 'pinia'
import { ref } from 'vue'

const K = {
  gemini: 'pama_gemini_key',
  bankEmail: 'pama_bank_email',
  rtgsAccounts: 'pama_rtgs_accounts',
  templates: 'pama_templates_suite',
  autoGmail: 'pama_rtgs_auto_gmail',
}

export const useSettingsStore = defineStore('settings', () => {
  const geminiKey = ref(localStorage.getItem(K.gemini) || '')
  const bankEmail = ref(localStorage.getItem(K.bankEmail) || '')
  const autoOpenGmail = ref(localStorage.getItem(K.autoGmail) !== '0')

  const defaultRtgs = {
    loanAc: '663206180000008',
    currentAc: '663201010050599',
    ccAc: '663205090000180',
    purpose: 'procurement of plant & machinery and construction of industrial unit',
  }

  function loadRtgsAccounts() {
    try {
      return { ...defaultRtgs, ...JSON.parse(localStorage.getItem(K.rtgsAccounts) || '{}') }
    } catch {
      return { ...defaultRtgs }
    }
  }

  const rtgsAccounts = ref(loadRtgsAccounts())

  function saveGeminiKey(v: string) {
    geminiKey.value = v
    localStorage.setItem(K.gemini, v)
  }

  function saveBankEmail(v: string) {
    bankEmail.value = v
    localStorage.setItem(K.bankEmail, v)
  }

  function saveRtgsAccounts(v: typeof defaultRtgs) {
    rtgsAccounts.value = v
    localStorage.setItem(K.rtgsAccounts, JSON.stringify(v))
  }

  function saveAutoGmail(v: boolean) {
    autoOpenGmail.value = v
    localStorage.setItem(K.autoGmail, v ? '1' : '0')
  }

  return {
    geminiKey, bankEmail, rtgsAccounts, autoOpenGmail,
    saveGeminiKey, saveBankEmail, saveRtgsAccounts, saveAutoGmail,
  }
})
