<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { usePartyStore } from '@/stores/parties'
import { numberToWords } from '@/services/numberToWords'
import { getPendingRTGS, clearPendingRTGS } from '@/services/rtgsBridge'
import PpModal from '@/components/PpModal.vue'

interface SavedBene {
  name: string
  purpose: string
  bank: string
  acname: string
  acno: string
  ifsc: string
  mode: 'RTGS' | 'NEFT'
}

// Stores
const partyStore = usePartyStore()

// State
const loanAc = ref(localStorage.getItem('pama_rtgs_loanAc') || '663206180000008')
const currentAc = ref(localStorage.getItem('pama_rtgs_currentAc') || '663201010050599')
const ccAc = ref(localStorage.getItem('pama_rtgs_ccAc') || '663205090000180')
const debitFrom = ref(localStorage.getItem('pama_rtgs_debitFrom') || '')
const txnDate = ref('')
const purpose = ref(localStorage.getItem('pama_rtgs_purpose') || 'procurement of plant & machinery and construction of industrial unit')
const BANK_EMAIL_KEY = 'pama_bank_email'
const bankEmail = ref(localStorage.getItem(BANK_EMAIL_KEY) || 'ubijaspur@unionbankofindia.co.in')
const autoOpenGmail = ref(localStorage.getItem('pama_rtgs_auto_gmail') !== '0')

// Active beneficiaries in this transaction
interface BankBeneficiary {
  id: string
  name: string
  purpose: string
  bank: string
  acname: string
  acno: string
  ifsc: string
  amount: number
  mode: 'RTGS' | 'NEFT'
  ifscStatus: 'idle' | 'fetching' | 'success' | 'error'
  partyId?: string | null
}

const beneficiaries = ref<BankBeneficiary[]>([])
const savedBenes = ref<SavedBene[]>([])

function loadSavedBenes() {
  try {
    savedBenes.value = JSON.parse(localStorage.getItem('pama_benes') || '[]')
  } catch {
    savedBenes.value = []
  }
}

function persistSavedBenes() {
  localStorage.setItem('pama_benes', JSON.stringify(savedBenes.value))
}

function addFromSavedChip(b: SavedBene) {
  addBene({ name: b.name, purpose: b.purpose, bank: b.bank, acname: b.acname, acno: b.acno, ifsc: b.ifsc, mode: b.mode || 'RTGS' })
}

function deleteSavedChip(i: number) {
  savedBenes.value.splice(i, 1)
  persistSavedBenes()
}

function saveBeneToSavedList(idx: number) {
  const b = beneficiaries.value[idx]
  if (!b.name?.trim() || !b.acno?.trim() || !b.ifsc?.trim()) {
    alert('Fill Name, Account No. and IFSC before saving to list.')
    return
  }
  const entry: SavedBene = {
    name: b.name,
    purpose: b.purpose,
    bank: b.bank,
    acname: b.acname || b.name,
    acno: b.acno,
    ifsc: b.ifsc,
    mode: b.mode,
  }
  const existing = savedBenes.value.findIndex(x => x.acno === b.acno && x.ifsc === b.ifsc)
  if (existing >= 0) savedBenes.value[existing] = entry
  else savedBenes.value.push(entry)
  persistSavedBenes()
  alert(`"${b.name}" saved to beneficiary list`)
}

function resetBeneficiaries() {
  if (!beneficiaries.value.length) return
  if (!confirm('Clear all beneficiaries from this email draft?')) return
  beneficiaries.value = []
}

function applyPendingRtgs() {
  const pending = getPendingRTGS()
  if (!pending.length) return
  for (const p of pending) {
    addBene({
      name: p.name,
      purpose: p.purpose,
      bank: p.bank,
      acname: p.acname,
      acno: p.acno,
      ifsc: p.ifsc,
      amount: p.amount,
      mode: p.mode,
      partyId: p.partyId ?? null,
    })
  }
  clearPendingRTGS()
}
const generatedSubject = ref('')
const generatedBody = ref('')
const showOutput = ref(false)
const showPrintLetter = ref(false)
const isCopied = ref(false)

// Save configurations on changes
watch([loanAc, currentAc, ccAc, debitFrom, purpose, bankEmail], () => {
  localStorage.setItem('pama_rtgs_loanAc', loanAc.value)
  localStorage.setItem('pama_rtgs_currentAc', currentAc.value)
  localStorage.setItem('pama_rtgs_ccAc', ccAc.value)
  localStorage.setItem('pama_rtgs_debitFrom', debitFrom.value)
  localStorage.setItem('pama_rtgs_purpose', purpose.value)
  localStorage.setItem(BANK_EMAIL_KEY, bankEmail.value.trim())
})

watch(autoOpenGmail, (newVal) => {
  localStorage.setItem('pama_rtgs_auto_gmail', newVal ? '1' : '0')
})

// Debit account options computed
const debitOptions = computed(() => {
  const list: Array<{ label: string; value: string }> = []
  if (loanAc.value) list.push({ label: `Term Loan A/c — ${loanAc.value}`, value: `Term Loan A/c No.: ${loanAc.value}` })
  if (currentAc.value) list.push({ label: `Current A/c — ${currentAc.value}`, value: `Current A/c No.: ${currentAc.value}` })
  if (ccAc.value) list.push({ label: `CC (Cash Credit) A/c — ${ccAc.value}`, value: `CC (Cash Credit) A/c No.: ${ccAc.value}` })
  return list
})

// Initialize debitFrom if empty
watch(debitOptions, (opts) => {
  if (opts.length > 0 && (!debitFrom.value || !opts.some(o => o.value === debitFrom.value))) {
    debitFrom.value = opts[0].value
  }
}, { immediate: true })

// Helper to format currency
const n2 = (val: number) => (val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const cleanText = (val: string) => val.trim().replace(/\s+/g, ' ')

const selectedDebitOption = computed(() => {
  return debitOptions.value.find(o => o.value === debitFrom.value)
})

const selectedDebitLabel = computed(() => selectedDebitOption.value?.label || debitFrom.value)
const enteredPurposeText = computed(() => cleanText(purpose.value) || 'the stated business purpose')
const beneficiaryPurposeTexts = computed(() => {
  return beneficiaries.value.map(b => cleanText(b.purpose)).filter(Boolean)
})
const draftPurposeText = computed(() => {
  const purposes = beneficiaryPurposeTexts.value
  if (purposes.length === 0) return enteredPurposeText.value

  const uniquePurposes = purposes.filter((p, idx, list) => {
    return list.findIndex(x => x.toLocaleLowerCase() === p.toLocaleLowerCase()) === idx
  })

  if (uniquePurposes.length === 1) return uniquePurposes[0]
  return 'the purposes detailed below'
})
const isTermLoanDebit = computed(() => debitFrom.value.startsWith('Term Loan'))

const branchEmailAddress = computed(() => {
  const saved = localStorage.getItem(BANK_EMAIL_KEY)
  return cleanText(bankEmail.value || saved || '')
})

// Add empty beneficiary
function addBene(data: Partial<BankBeneficiary> = {}) {
  beneficiaries.value.push({
    id: Math.random().toString(36).substring(2, 9),
    name: data.name || '',
    purpose: data.purpose || '',
    bank: data.bank || '',
    acname: data.acname || '',
    acno: data.acno || '',
    ifsc: data.ifsc || '',
    amount: data.amount || 0,
    mode: data.mode || 'RTGS',
    ifscStatus: 'idle',
    partyId: data.partyId || null
  })
}

// Remove beneficiary row
function removeBene(idx: number) {
  beneficiaries.value.splice(idx, 1)
}

// Populate bank details when a party is selected
function onPartyChange(idx: number) {
  const row = beneficiaries.value[idx]
  if (!row.partyId) return
  const party = partyStore.list.find(p => p.id === row.partyId)
  if (party) {
    row.name = party.name
    row.bank = party.bank || ''
    row.acname = party.acname || party.name
    row.acno = party.acno || ''
    row.ifsc = party.ifsc || ''
  }
}

// Save bank details back to unified party
async function saveBankDetailsToParty(bene: BankBeneficiary) {
  if (!bene.name || !bene.acno || !bene.ifsc) {
    alert('Please fill Name, Account No, and IFSC before saving.')
    return
  }

  // Find existing party or create one
  const party = await partyStore.ensure(bene.name, 'vendor', {
    bank: bene.bank,
    acno: bene.acno,
    ifsc: bene.ifsc,
    acname: bene.acname || bene.name
  })

  // If already exists, update bank details
  if (party) {
    await partyStore.update(party.id, {
      bank: bene.bank,
      acno: bene.acno,
      ifsc: bene.ifsc,
      acname: bene.acname || bene.name
    })
    bene.partyId = party.id
    alert(`Bank details synced to party "${party.name}" successfully!`)
  }
}

// IFSC fetch details debounced
const ifscDebounceTimer = ref<Record<string, any>>({})
function onIfscInput(idx: number) {
  const row = beneficiaries.value[idx]
  row.ifsc = row.ifsc.toUpperCase().trim()
  if (row.ifsc.length < 11) {
    row.ifscStatus = 'idle'
    return
  }
  if (row.ifsc.length > 11) return

  row.ifscStatus = 'fetching'
  clearTimeout(ifscDebounceTimer.value[row.id])
  ifscDebounceTimer.value[row.id] = setTimeout(async () => {
    try {
      const res = await fetch(`https://ifsc.razorpay.com/${row.ifsc}`)
      if (!res.ok) throw new Error('Invalid code')
      const data = await res.json()
      row.bank = `${data.BANK}, ${data.BRANCH}`
      row.ifscStatus = 'success'
    } catch (e) {
      row.ifscStatus = 'error'
    }
  }, 400)
}

// Date strings
const displayDate = computed(() => {
  if (txnDate.value) {
    const [y, m, d] = txnDate.value.split('-')
    return `${d}/${m}/${y}`
  }
  const d = new Date()
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear()
})

const totalDisbursement = computed(() => {
  return beneficiaries.value.reduce((sum, b) => sum + (b.amount || 0), 0)
})

// Build draft output
function buildDraft() {
  if (beneficiaries.value.length === 0) return null

  const beneficiaryLines = beneficiaries.value.map((b, idx) => {
    const amtFmt = n2(b.amount)
    const amtWords = numberToWords(b.amount)
    const rowPurpose = cleanText(b.purpose) || enteredPurposeText.value

    return `${idx + 1}. Beneficiary Details
   Name         : ${b.name}
   Bank         : ${b.bank}
   Account Name : ${b.acname || b.name}
   Account No.  : ${b.acno}
   IFSC         : ${b.ifsc}
   Amount       : Rs. ${amtFmt}
   Amount Words : ${amtWords}
   Purpose      : ${rowPurpose}
   Payment Mode : ${b.mode}`
  }).join('\n\n')

  const totalFmt = n2(totalDisbursement.value)
  const totalWords = numberToWords(totalDisbursement.value)

  let subjectType = 'Fund Transfer'
  if (isTermLoanDebit.value) subjectType = 'Term Loan Disbursement'
  else if (debitFrom.value.startsWith('CC')) subjectType = 'CC Account Disbursement'

  const enteredPurpose = draftPurposeText.value
  const selectedDebitAccount = cleanText(debitFrom.value || selectedDebitLabel.value)
  let sourceAccountName = 'selected debit account'
  if (isTermLoanDebit.value) {
    sourceAccountName = 'Term Loan Account'
  } else if (debitFrom.value.startsWith('CC')) {
    sourceAccountName = 'Cash Credit (CC) Account'
  } else {
    sourceAccountName = 'Current Account'
  }
  const transferAction = debitFrom.value.startsWith('Current') ? 'transfer funds' : 'disburse funds'
  const openingLine = `We, M/s Pama Packaging, respectfully request you to kindly ${transferAction} from our ${sourceAccountName} (${selectedDebitAccount}) towards ${enteredPurpose}.`
  const sanctionConfirmation = isTermLoanDebit.value
    ? `\nTerm Loan Declaration:\nWe confirm that the funds shall be utilised for ${enteredPurpose} and in accordance with the terms and conditions of the loan sanction.\n`
    : ''

  const acBlock = [
    'Account Name : Pama Packaging',
    `Debit Account: ${selectedDebitAccount}`,
    loanAc.value ? `Term Loan A/c No.       : ${loanAc.value}` : '',
    currentAc.value ? `Current A/c No.          : ${currentAc.value}` : '',
    ccAc.value ? `CC (Cash Credit) A/c No. : ${ccAc.value}` : '',
  ].filter(Boolean).join('\n')

  const multiSubject = beneficiaries.value.length > 1 ? 'Multiple Beneficiaries - ' : ''
  const subject = `Request for ${subjectType} via RTGS/NEFT - ${multiSubject}Pama Packaging (Debit: ${selectedDebitAccount})`

  const body = `Date: ${displayDate.value}

To,
The Branch Manager
Union Bank of India
Jaspur Branch

Subject: ${subject}

Dear Sir / Madam,

${openingLine}

DEBIT ACCOUNT

${acBlock}

TRANSFER PURPOSE
${enteredPurpose}

BENEFICIARY DETAILS
${beneficiaryLines}

AMOUNT SUMMARY
Total Amount : Rs. ${totalFmt}
Amount Words : ${totalWords}

PAYMENT REQUEST
Please debit the above selected account and remit the payment(s) to the beneficiary account(s) mentioned above through RTGS/NEFT.

${sanctionConfirmation}Kindly process the above payment(s) at the earliest and confirm the transaction.

Thanking you.

Yours sincerely,
For M/s Pama Packaging

Anju Samant
(Authorised Signatory)`

  return { subject, body }
}

function generateEmailDraft() {
  const draft = buildDraft()
  if (!draft) {
    alert('Please add at least one beneficiary first.')
    return
  }
  generatedSubject.value = draft.subject
  generatedBody.value = draft.body
  showOutput.value = true
  isCopied.value = false

  if (autoOpenGmail.value) {
    setTimeout(openGmailCompose, 300)
  }
}

function copyEmail() {
  navigator.clipboard.writeText(generatedBody.value).then(() => {
    isCopied.value = true
    setTimeout(() => isCopied.value = false, 2500)
  })
}

function openGmailCompose() {
  if (!generatedBody.value) return
  if (!branchEmailAddress.value) {
    alert('Please enter a Bank Email address.')
    return
  }
  const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(branchEmailAddress.value)}&su=${encodeURIComponent(generatedSubject.value)}&body=${encodeURIComponent(generatedBody.value)}`
  window.open(url, '_blank')
}

function openMailtoFallback() {
  if (!generatedBody.value) return
  if (!branchEmailAddress.value) {
    alert('Please enter a Bank Email address.')
    return
  }
  const url = `mailto:${encodeURIComponent(branchEmailAddress.value)}?subject=${encodeURIComponent(generatedSubject.value)}&body=${encodeURIComponent(generatedBody.value)}`
  window.location.href = url
}

function printDocument() {
  window.print()
}

onMounted(() => {
  partyStore.load()
  loadSavedBenes()
  applyPendingRtgs()
  if (beneficiaries.value.length === 0) {
    // Add default sample
    addBene({
      name: 'M/s Universal Power Solutions',
      purpose: 'Supplier of solar panel and items for manufacturing unit',
      bank: 'Axis Bank Ltd., Bazpur',
      acname: 'UNIVERSAL POWER SOLUTIONS',
      acno: '915020029057563',
      ifsc: 'UTIB0000517',
      amount: 3200000,
      mode: 'RTGS'
    })
  }
})
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">RTGS / NEFT Banking Portal</h1>
        <p class="text-sm text-slate-500 font-medium">Generate bank disbursement email requests and print NEFT instructions</p>
      </div>
      <div>
        <span class="text-xs font-semibold px-3 py-1 bg-blue-50 text-blue-800 rounded-full border border-blue-100">
          🏦 Union Bank of India, Jaspur
        </span>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Left Forms -->
      <div class="lg:col-span-2 space-y-6">
        <!-- Sender / Credit Line details -->
        <div class="pp-card p-6 space-y-4">
          <h2 class="text-md font-semibold text-slate-800 border-b pb-2 mb-4">Debit Account Details</h2>
          
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label class="pp-label">Term Loan Account</label>
              <input v-model="loanAc" class="pp-input text-sm font-mono" placeholder="Loan A/c No" />
            </div>
            <div>
              <label class="pp-label">Current Account</label>
              <input v-model="currentAc" class="pp-input text-sm font-mono" placeholder="Current A/c No" />
            </div>
            <div>
              <label class="pp-label">CC (Cash Credit) Account</label>
              <input v-model="ccAc" class="pp-input text-sm font-mono" placeholder="CC A/c No" />
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label class="pp-label">Debit Source *</label>
              <select v-model="debitFrom" class="pp-input text-sm">
                <option v-for="opt in debitOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </div>
            <div>
              <label class="pp-label">Execution Date (blank = today)</label>
              <input type="date" v-model="txnDate" class="pp-input" />
            </div>
            <div>
              <label class="pp-label">Purpose</label>
              <input v-model="purpose" class="pp-input text-sm" placeholder="Purpose statement" />
            </div>
          </div>
        </div>

        <!-- Beneficiary rows -->
        <div class="pp-card p-6 space-y-4">
          <div class="flex items-center justify-between border-b pb-2 mb-4">
            <h2 class="text-md font-semibold text-slate-800">Remittance Targets</h2>
            <div class="flex gap-2">
              <button @click="addBene()" class="pp-btn pp-btn-ghost text-xs px-3 py-1">
                ➕ Add Target
              </button>
            </div>
          </div>

          <div class="space-y-4">
            <div 
              v-for="(b, idx) in beneficiaries" 
              :key="b.id" 
              class="border rounded-xl p-4 bg-slate-50/50 hover:border-slate-300 relative transition-all"
            >
              <div class="absolute top-2 right-2 flex gap-1">
                <button
                  type="button"
                  @click="saveBeneToSavedList(idx)"
                  class="pp-btn pp-btn-ghost px-2 py-0.5 text-[11px]"
                  title="Save to quick-add chip list"
                >📌 Save</button>
                <button 
                  @click="saveBankDetailsToParty(b)"
                  class="pp-btn pp-btn-ghost px-2 py-0.5 text-[11px] bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200"
                  title="Sync bank details back to contact list"
                >
                  💾 Sync Party
                </button>
                <button @click="removeBene(idx)" class="text-rose-500 hover:text-rose-700 text-sm p-1">
                  ✕ Remove
                </button>
              </div>

              <div class="text-xs font-bold text-slate-400 mb-2">TARGET RECIPIENT #{{ idx + 1 }}</div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div>
                  <label class="pp-label">Contact / Party Link</label>
                  <select v-model="b.partyId" class="pp-input text-xs" @change="onPartyChange(idx)">
                    <option :value="null">Custom Beneficiary (Not Linked)</option>
                    <option v-for="p in partyStore.list" :key="p.id" :value="p.id">
                      {{ p.name }} {{ p.gst ? `(GST: ${p.gst})` : '' }}
                    </option>
                  </select>
                </div>
                <div>
                  <label class="pp-label">Firm / Payee Name *</label>
                  <input v-model="b.name" class="pp-input" placeholder="M/s Payee Name" />
                </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                <div>
                  <label class="pp-label">Account No *</label>
                  <input v-model="b.acno" class="pp-input font-mono" placeholder="A/c Number" />
                </div>
                <div>
                  <label class="pp-label">IFSC Code *</label>
                  <div class="relative">
                    <input 
                      v-model="b.ifsc" 
                      class="pp-input font-mono uppercase" 
                      placeholder="IFSC Code" 
                      @input="onIfscInput(idx)"
                    />
                    <span 
                      v-if="b.ifscStatus !== 'idle'" 
                      class="absolute right-2 top-2 text-xs"
                      :class="{
                        'text-slate-400': b.ifscStatus === 'fetching',
                        'text-green-600 font-bold': b.ifscStatus === 'success',
                        'text-rose-500 font-bold': b.ifscStatus === 'error'
                      }"
                    >
                      {{ b.ifscStatus === 'fetching' ? '⏳' : b.ifscStatus === 'success' ? '✓' : '✗' }}
                    </span>
                  </div>
                </div>
                <div>
                  <label class="pp-label">Account Name (on Bank Record)</label>
                  <input v-model="b.acname" class="pp-input" placeholder="Default same as name" />
                </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div class="sm:col-span-2">
                  <label class="pp-label">Bank Branch Details</label>
                  <input v-model="b.bank" class="pp-input" placeholder="State Bank of India, branch details" />
                </div>
                <div>
                  <label class="pp-label">Purpose of Payment</label>
                  <input v-model="b.purpose" class="pp-input text-xs" placeholder="e.g. Purchase of board" />
                </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pt-3 border-t">
                <div>
                  <label class="pp-label">Amount (₹) *</label>
                  <input type="number" v-model.number="b.amount" class="pp-input text-right font-mono font-semibold" placeholder="0.00" />
                </div>
                <div>
                  <label class="pp-label">Transfer Channel</label>
                  <select v-model="b.mode" class="pp-input">
                    <option value="RTGS">RTGS (Speedy for &ge; 2L)</option>
                    <option value="NEFT">NEFT (Standard Batch)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <button @click="generateEmailDraft()" class="pp-btn pp-btn-primary w-full py-3 mt-2 text-base">
            🚀 Compile Official Instructions &amp; Open Mailer
          </button>
        </div>
      </div>

      <!-- Right Config Panel -->
      <div class="space-y-6">
        <!-- Bank Dispatch Settings -->
        <div class="pp-card p-6 space-y-4">
          <h2 class="text-md font-semibold text-slate-800 border-b pb-2 mb-4">Manager Email Channel</h2>
          
          <div>
            <label class="pp-label">Manager / Bank Email Address</label>
            <input type="email" v-model="bankEmail" class="pp-input text-sm font-mono" placeholder="bankbranch@unionbank.co.in" />
            <span class="text-[11px] text-slate-400 mt-1 block">Your bank's official email address. Pre-filled in compose form.</span>
          </div>

          <div class="flex items-center gap-2 pt-2 border-t">
            <input type="checkbox" v-model="autoOpenGmail" id="auto-gmail-chk" class="w-4 h-4 rounded text-accent" />
            <label for="auto-gmail-chk" class="text-sm font-semibold text-slate-600">
              Open Gmail on generation
            </label>
          </div>
        </div>

        <!-- Saved beneficiary chips (legacy pama_benes) -->
        <div class="pp-card p-6 space-y-4">
          <div class="flex items-center justify-between border-b pb-2 mb-2">
            <h2 class="text-md font-semibold text-slate-800">Saved Beneficiaries</h2>
            <button type="button" class="pp-btn pp-btn-ghost !text-xs" @click="resetBeneficiaries">Reset draft</button>
          </div>
          <div class="flex flex-wrap gap-2">
            <div
              v-for="(b, i) in savedBenes"
              :key="`${b.acno}-${i}`"
              class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 border text-xs"
            >
              <span class="font-semibold">{{ b.name }}</span>
              <button type="button" class="text-accent font-bold" @click="addFromSavedChip(b)">+ Add</button>
              <button type="button" class="text-red-500" @click="deleteSavedChip(i)">✕</button>
            </div>
            <span v-if="!savedBenes.length" class="text-xs text-slate-400 italic">Save from a beneficiary row to build quick-add chips</span>
          </div>
        </div>

        <!-- Saved Parties list with Bank details -->
        <div class="pp-card p-6 space-y-4">
          <h2 class="text-md font-semibold text-slate-800 border-b pb-2 mb-4">Contacts with Bank Profiles</h2>
          <div class="max-h-60 overflow-y-auto space-y-2">
            <div 
              v-for="p in partyStore.list.filter(x => x.acno && !x.is_deleted)" 
              :key="p.id"
              class="p-2 border rounded bg-slate-50 hover:bg-slate-100/80 flex items-center justify-between text-xs transition-all"
            >
              <div>
                <div class="font-bold text-slate-700">{{ p.name }}</div>
                <div class="text-[10px] text-slate-400 font-mono">{{ p.bank }} | {{ p.acno }}</div>
              </div>
              <button 
                @click="addBene({ name: p.name, bank: p.bank, acno: p.acno, ifsc: p.ifsc, acname: p.acname || p.name, partyId: p.id })" 
                class="pp-btn pp-btn-ghost px-2 py-1 text-[10px] font-bold"
              >
                + Add
              </button>
            </div>
            <div v-if="partyStore.list.filter(x => x.acno && !x.is_deleted).length === 0" class="text-center py-4 text-xs text-slate-400 italic">
              No contacts with saved bank credentials yet. Add bank details to any payee and click "Sync Party".
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Output Section (visible after click) -->
    <div v-if="showOutput" class="pp-card p-6 space-y-4">
      <div class="flex items-center justify-between border-b pb-2 mb-2">
        <h2 class="text-md font-semibold text-slate-800">Generated email body details</h2>
        <div class="flex gap-2">
          <button @click="showPrintLetter = true" class="pp-btn pp-btn-ghost text-xs">
            🖨️ Open Print Preview
          </button>
        </div>
      </div>

      <div>
        <label class="pp-label">Calculated Subject Header</label>
        <input :value="generatedSubject" readonly class="pp-input bg-slate-50 font-mono font-bold text-slate-800 text-xs" />
      </div>

      <div>
        <label class="pp-label">Formatted Mail Draft Body (Courier spacing)</label>
        <textarea :value="generatedBody" readonly class="pp-input font-mono text-[12px] bg-slate-50 text-slate-800 h-96 p-4 leading-relaxed"></textarea>
      </div>

      <div class="flex flex-wrap gap-2 pt-2">
        <button @click="copyEmail()" class="pp-btn" :class="isCopied ? 'pp-btn-success' : 'pp-btn-primary'">
          {{ isCopied ? '✓ Copied!' : '📋 Copy to Clipboard' }}
        </button>
        <button @click="openGmailCompose()" class="pp-btn bg-red-600 text-white hover:bg-red-700">
          📧 Compose in Gmail
        </button>
        <button @click="openMailtoFallback()" class="pp-btn pp-btn-ghost text-slate-600">
          ✉️ Send via Standard Client
        </button>
      </div>
    </div>

    <!-- Print Modal Letter -->
    <PpModal :show="showPrintLetter" title="Official Bank Disbursement Instructions Letter" @close="showPrintLetter = false" max-width="max-w-4xl">
      <div class="p-6 bg-white select-text">
        <!-- Print Header instructions -->
        <div class="no-print bg-slate-50 p-3 rounded-lg border flex justify-between items-center mb-6">
          <span class="text-xs text-slate-600">Use standard browser Print options (Ctrl+P). Stylings are print-optimized.</span>
          <button @click="printDocument()" class="pp-btn pp-btn-success text-xs">
            🖨️ Click to Print Document
          </button>
        </div>

        <!-- Letter Body structure -->
        <div id="bank-print-letter" class="text-black bg-white leading-relaxed text-sm select-text font-serif max-w-[800px] mx-auto p-4">
          <div class="flex justify-between items-start mb-6">
            <div>
              <strong class="text-lg">M/s PAMA PACKAGING</strong>
              <div class="text-xs">Manufacturer of High Quality Corrugated Boxes</div>
              <div class="text-xs">Jaspur, Uttarakhand, State Code: 05</div>
            </div>
            <div class="text-right">
              <div><strong>DATE:</strong> {{ displayDate }}</div>
            </div>
          </div>

          <div class="mb-6">
            <div><strong>To,</strong></div>
            <div><strong>The Branch Manager,</strong></div>
            <div><strong>Union Bank of India,</strong></div>
            <div>Jaspur Branch.</div>
          </div>

          <div class="mb-4">
            <strong>SUBJECT:</strong> Request for disbursement/payment via RTGS/NEFT — Pama Packaging.
          </div>

          <p class="mb-4">
            Dear Sir / Madam,
          </p>

          <p class="mb-4">
            We respectfully request you to kindly disburse/transfer funds from our selected debit account
            (<u>{{ selectedDebitLabel }}</u>) towards <u>{{ draftPurposeText }}</u>.
          </p>

          <div class="mb-4 bg-slate-50/80 p-3 border rounded text-xs leading-5">
            <div><strong>SENDER DETAILS:</strong></div>
            <div class="grid grid-cols-2 gap-2 mt-1">
              <div>Term Loan A/c: {{ loanAc || 'N/A' }}</div>
              <div>Current A/c: {{ currentAc || 'N/A' }}</div>
              <div>CC Account: {{ ccAc || 'N/A' }}</div>
              <div><strong>DEBIT ACCOUNT: {{ debitFrom }}</strong></div>
            </div>
          </div>

          <p class="mb-4">
            Kindly debit our account and credit the respective beneficiaries via RTGS/NEFT channel as per the following schedule:
          </p>

          <table class="w-full text-xs text-left border-collapse border border-black mb-6">
            <thead>
              <tr class="bg-slate-100 text-black uppercase font-bold text-[10px] border-b border-black">
                <th class="border border-black p-2 w-10 text-center">S.No</th>
                <th class="border border-black p-2">Beneficiary & Bank Details</th>
                <th class="border border-black p-2">Account Number</th>
                <th class="border border-black p-2 w-28">IFSC Code</th>
                <th class="border border-black p-2 w-20 text-center">Mode</th>
                <th class="border border-black p-2 text-right w-28">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(b, idx) in beneficiaries" :key="b.id">
                <td class="border border-black p-2 text-center">{{ idx + 1 }}</td>
                <td class="border border-black p-2">
                  <div class="font-bold">{{ b.name }}</div>
                  <div class="text-[10px] text-slate-600">{{ b.bank }}</div>
                  <div class="text-[9px] text-slate-500">Ac Name: {{ b.acname || b.name }}</div>
                </td>
                <td class="border border-black p-2 font-mono">{{ b.acno }}</td>
                <td class="border border-black p-2 font-mono">{{ b.ifsc }}</td>
                <td class="border border-black p-2 text-center">{{ b.mode }}</td>
                <td class="border border-black p-2 text-right font-mono">₹{{ n2(b.amount) }}</td>
              </tr>
              <tr class="font-bold bg-slate-50">
                <td colspan="5" class="border border-black p-2 text-right">TOTAL DISBURSEMENT AMOUNT:</td>
                <td class="border border-black p-2 text-right font-mono">₹{{ n2(totalDisbursement) }}</td>
              </tr>
            </tbody>
          </table>

          <div class="mb-6 bg-slate-50/80 p-3 border rounded text-xs">
            <strong>TOTAL AMOUNT IN WORDS:</strong> {{ numberToWords(totalDisbursement) }}
          </div>

          <p v-if="isTermLoanDebit" class="mb-6 text-xs text-justify">
            We confirm that the funds shall be utilised for {{ draftPurposeText }} and in accordance with the terms and conditions of the loan sanction.
          </p>

          <div class="mt-12 flex justify-between">
            <div>
              <br/>
              ____________________________<br/>
              <strong>Anju Samant</strong><br/>
              (Authorised Signatory)
            </div>
            <div class="text-right">
              <strong>For M/s PAMA PACKAGING</strong>
              <br/><br/><br/>
              ____________________________<br/>
              (Partner / Signatory)
            </div>
          </div>
        </div>

        <div class="flex gap-2 justify-end border-t pt-4 mt-6 no-print">
          <button @click="showPrintLetter = false" class="pp-btn pp-btn-ghost">Close Preview</button>
        </div>
      </div>
    </PpModal>
  </div>
</template>

<style scoped>
@media print {
  body * {
    visibility: hidden;
  }
  .no-print {
    display: none !important;
  }
  #bank-print-letter, #bank-print-letter * {
    visibility: visible;
  }
  #bank-print-letter {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    margin: 0;
    padding: 20px;
    box-shadow: none;
    border: none;
    font-size: 13px;
  }
}
</style>
