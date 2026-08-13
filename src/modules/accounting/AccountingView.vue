<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useFirmStore } from '@/stores/firm'
import { useAccountingStore } from '@/stores/accounting'
import { useInvoiceStore } from '@/stores/invoices'
import { usePartyStore } from '@/stores/parties'
import { usePurchaseStore } from '@/stores/purchases'
import { useSettingsStore } from '@/stores/settings'
import { cashBookFromVouchers, customerReceivableSummary } from '@/services/reports'
import { buildPartyLedger, partyLedgerOptions, type PartyLedgerMode, type PartyLedgerPartyOption } from '@/services/partyLedger'
import { scanVoucherImage, fileToBase64, type VoucherScanResult } from '@/services/aiScanner'
import {
  attachDocumentFromFile,
  openEntityDocument,
  downloadEntityDocument,
  shareEntityDocumentWhatsApp,
} from '@/services/documentAttachments'
import { db } from '@/data/db'
import PpModal from '@/components/PpModal.vue'
import type { Account, Voucher, LedgerEntry } from '@/types/models'

// Stores
const firmStore = useFirmStore()
const accountingStore = useAccountingStore()
const invoiceStore = useInvoiceStore()
const partyStore = usePartyStore()
const purchaseStore = usePurchaseStore()
const settingsStore = useSettingsStore()

// Navigation state
type TabType = 'reports' | 'ledger' | 'partyLedger' | 'debtors' | 'cashbook' | 'vouchers' | 'accounts'
const activeTab = ref<TabType>('reports')
const voucherScanStatus = ref('')
const voucherScanLoading = ref(false)
const pendingVoucherScanFile = ref<File | null>(null)
const voucherHasDoc = ref<Record<string, boolean>>({})

// Report selection state
type ReportType = 'trial' | 'pl' | 'bs'
const activeReport = ref<ReportType>('trial')
const reportAsOnDate = ref(new Date().toISOString().slice(0, 10))
const reportFromDate = ref(new Date().toISOString().slice(0, 7) + '-01')

// Ledger card filter state
const selectedLedgerAccountId = ref('')
const ledgerFromDate = ref(new Date().toISOString().slice(0, 7) + '-01')
const ledgerToDate = ref(new Date().toISOString().slice(0, 10))

// Party ledger filter state
const partyLedgerMode = ref<PartyLedgerMode>('both')
const partyLedgerPartyKey = ref('')
const partyLedgerMonth = ref('')
const partyLedgerFromDate = ref(new Date().toISOString().slice(0, 7) + '-01')
const partyLedgerToDate = ref(new Date().toISOString().slice(0, 10))
const partyLedgerPendingOnly = ref(false)
const partyLedgerMinAmount = ref<number | null>(null)
const partyLedgerMaxAmount = ref<number | null>(null)
const partyLedgerMinOutstanding = ref<number | null>(null)
const partyLedgerMaxOutstanding = ref<number | null>(null)

const selectedCashBookAccountId = ref('')

// Voucher list filter state
const voucherFilterType = ref<Voucher['type'] | 'ALL'>('ALL')

// Modals state
const showAccountModal = ref(false)
const showVoucherModal = ref(false)
const showVoucherDetailModal = ref(false)

const editingAccount = ref<Account | null>(null)
const selectedVoucher = ref<Voucher | null>(null)

// Forms State
const initialAccountForm = () => ({
  code: '',
  name: '',
  group: 'Indirect Expense',
  normal: 'Dr' as 'Dr' | 'Cr',
  open_bal_dr: 0,
  open_bal_cr: 0
})
const accountForm = reactive(initialAccountForm())

// Voucher Form State
type VoucherFormType = 'PV' | 'RV' | 'CV' | 'JV'
const voucherFormType = ref<VoucherFormType>('PV')
const voucherForm = reactive({
  date: new Date().toISOString().slice(0, 10),
  narration: '',
  payeeName: '',
  amount: 0,
  debitAccId: '',
  creditAccId: '',
  entries: [] as Array<{ accountId: string; debit: number; credit: number }>
})

// Cash/Bank account filter computed
const cashBankAccounts = computed(() => {
  return accountingStore.accounts.filter(a => 
    a.group === 'Current Assets' && 
    (a.code === '1001' || a.code === '1002' || a.name.toLowerCase().includes('bank') || a.name.toLowerCase().includes('cash'))
  )
})

// Helper functions
const n2 = (val: number | null | undefined) => (val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function moneyOrDash(val: number | null) {
  return val == null ? '—' : `₹${n2(val)}`
}

function getAccountLabel(accountId: string) {
  const a = accountingStore.accounts.find(x => x.id === accountId)
  return a ? `${a.code} — ${a.name}` : accountId
}

// Reload when active firm changes
watch(() => firmStore.activeFirmId, () => {
  accountingStore.load()
  invoiceStore.load()
  partyStore.load()
  purchaseStore.load()
  selectedLedgerAccountId.value = ''
  partyLedgerPartyKey.value = ''
})

// Account form actions
function openNewAccount() {
  editingAccount.value = null
  Object.assign(accountForm, initialAccountForm())
  
  // Predict next code
  const lastAcc = [...accountingStore.accounts].sort((a, b) => b.code.localeCompare(a.code))[0]
  if (lastAcc) {
    const codeNum = parseInt(lastAcc.code)
    if (!isNaN(codeNum)) {
      accountForm.code = String(codeNum + 1)
    }
  }
  showAccountModal.value = true
}

function editAccount(acc: Account) {
  editingAccount.value = acc
  accountForm.code = acc.code
  accountForm.name = acc.name
  accountForm.group = acc.group
  accountForm.normal = acc.normal
  accountForm.open_bal_dr = acc.open_bal_dr
  accountForm.open_bal_cr = acc.open_bal_cr
  showAccountModal.value = true
}

async function saveAccount() {
  if (!accountForm.name.trim()) {
    alert('Account name is required')
    return
  }
  if (!accountForm.code.trim()) {
    alert('Account code is required')
    return
  }

  // Validate duplicate code
  const duplicate = accountingStore.accounts.find(a => a.code === accountForm.code && (!editingAccount.value || a.id !== editingAccount.value.id))
  if (duplicate) {
    alert(`Account code ${accountForm.code} is already in use by "${duplicate.name}"`)
    return
  }

  if (editingAccount.value) {
    await accountingStore.updateAccount(editingAccount.value.id, {
      code: accountForm.code.trim(),
      name: accountForm.name.trim(),
      group: accountForm.group,
      normal: accountForm.normal,
      open_bal_dr: accountForm.open_bal_dr,
      open_bal_cr: accountForm.open_bal_cr
    })
    alert('Account updated.')
  } else {
    await accountingStore.addAccount({
      code: accountForm.code.trim(),
      name: accountForm.name.trim(),
      group: accountForm.group,
      normal: accountForm.normal,
      open_bal_dr: accountForm.open_bal_dr,
      open_bal_cr: accountForm.open_bal_cr
    })
    alert('Account created.')
  }
  showAccountModal.value = false
}

async function removeAccount(acc: Account) {
  if (acc.is_system) {
    alert('System accounts cannot be deleted.')
    return
  }
  if (confirm(`Are you sure you want to delete account "${acc.name}"?`)) {
    await accountingStore.removeAccount(acc.id)
    alert('Account deleted.')
  }
}

// Voucher form actions
function openNewVoucher(type: VoucherFormType) {
  voucherFormType.value = type
  pendingVoucherScanFile.value = null
  voucherScanStatus.value = ''
  voucherForm.date = new Date().toISOString().slice(0, 10)
  voucherForm.narration = ''
  voucherForm.payeeName = ''
  voucherForm.amount = 0
  voucherForm.debitAccId = accountingStore.accounts[0]?.id || ''
  voucherForm.creditAccId = accountingStore.accounts[0]?.id || ''
  voucherForm.entries = []
  
  if (type === 'JV') {
    addJvRow()
    addJvRow()
  } else if (type === 'PV') {
    voucherForm.creditAccId = cashBankAccounts.value[0]?.id || ''
  } else if (type === 'RV') {
    voucherForm.debitAccId = cashBankAccounts.value[0]?.id || ''
  }
  showVoucherModal.value = true
}

function addJvRow() {
  voucherForm.entries.push({
    accountId: accountingStore.accounts[0]?.id || '',
    debit: 0,
    credit: 0
  })
}

function removeJvRow(idx: number) {
  voucherForm.entries.splice(idx, 1)
  if (voucherForm.entries.length < 2) addJvRow()
}

// Compute JV balance totals
const jvTotals = computed(() => {
  return voucherForm.entries.reduce((totals, row) => {
    totals.dr += row.debit || 0
    totals.cr += row.credit || 0
    return totals
  }, { dr: 0, cr: 0 })
})

async function saveVoucher() {
  if (!voucherForm.narration.trim()) {
    alert('Narration is required')
    return
  }

  let ledgerEntries: LedgerEntry[] = []
  let calculatedType: Voucher['type'] = 'JOURNAL'

  if (voucherFormType.value === 'JV') {
    const drTotal = Math.round(jvTotals.value.dr * 100) / 100
    const crTotal = Math.round(jvTotals.value.cr * 100) / 100
    
    if (Math.abs(drTotal - crTotal) > 0.01) {
      alert(`Journal Voucher is not balanced! Total Debit (₹${n2(drTotal)}) must equal Total Credit (₹${n2(crTotal)}).`)
      return
    }

    const validEntries = voucherForm.entries.filter(e => e.debit > 0 || e.credit > 0)
    if (validEntries.length < 2) {
      alert('A Journal Voucher must have at least 2 entries.')
      return
    }

    ledgerEntries = validEntries.map(e => ({
      accountId: e.accountId,
      accountName: accountingStore.accounts.find(x => x.id === e.accountId)?.name || '',
      debit: e.debit,
      credit: e.credit
    }))
    calculatedType = 'JOURNAL'
  } else {
    if (voucherForm.amount <= 0) {
      alert('Voucher amount must be greater than zero.')
      return
    }
    if (!voucherForm.debitAccId || !voucherForm.creditAccId) {
      alert('Please select both debit and credit accounts')
      return
    }
    if (voucherForm.debitAccId === voucherForm.creditAccId) {
      alert('Debit and credit accounts must be different')
      return
    }

    const drAcc = accountingStore.accounts.find(x => x.id === voucherForm.debitAccId)
    const crAcc = accountingStore.accounts.find(x => x.id === voucherForm.creditAccId)

    ledgerEntries = [
      {
        accountId: voucherForm.debitAccId,
        accountName: drAcc?.name || '',
        debit: voucherForm.amount,
        credit: 0
      },
      {
        accountId: voucherForm.creditAccId,
        accountName: crAcc?.name || '',
        debit: 0,
        credit: voucherForm.amount
      }
    ]

    if (voucherFormType.value === 'PV') calculatedType = 'PAYMENT'
    else if (voucherFormType.value === 'RV') calculatedType = 'RECEIPT'
    else if (voucherFormType.value === 'CV') calculatedType = 'CONTRA'
  }

  const completeNarration = voucherForm.payeeName 
    ? `${voucherForm.payeeName} | ${voucherForm.narration}` 
    : voucherForm.narration

  const voucher = await accountingStore.postVoucher(
    voucherForm.date,
    calculatedType,
    completeNarration,
    ledgerEntries
  )

  let docAttached = false
  if (pendingVoucherScanFile.value) {
    const partyName = voucherForm.payeeName?.trim()
      || completeNarration.split('|')[0]?.trim()
      || 'Voucher'
    await attachDocumentFromFile({
      file: pendingVoucherScanFile.value,
      entityType: 'voucher',
      entityId: voucher.id,
      partyName,
      docNo: voucher.voucher_no,
      docDate: voucher.date,
    })
    voucherHasDoc.value[voucher.id] = true
    docAttached = true
    pendingVoucherScanFile.value = null
  }

  showVoucherModal.value = false
  alert(docAttached
    ? 'Voucher posted + scan file archived (compressed & cloud).'
    : 'Voucher posted successfully!')
}

async function removeVoucher(id: string) {
  if (confirm('Are you sure you want to delete this voucher? Scan file Recycle Bin me jayegi.')) {
    await accountingStore.deleteVoucherById(id)
    await loadVoucherDocFlags()
    alert('Voucher deleted.')
  }
}

// Financial reports computed
const trialBalanceReport = computed(() => {
  return accountingStore.getTrialBalance(reportAsOnDate.value)
})

const ledgerHealth = computed(() => accountingStore.verifyTrialBalance(reportAsOnDate.value))
const rebuilding = ref(false)
async function doRebuildLedger() {
  if (!confirm('Rebuild ledger from all invoices & purchases?\n\nSafe & idempotent — re-posts every sale/purchase voucher using the corrected tax logic (fixes any old IGST/round-off drift).')) return
  rebuilding.value = true
  try {
    const r = await accountingStore.rebuildLedger()
    alert(`Ledger rebuilt ✓\n${r.invoices} invoices + ${r.purchases} purchases re-posted.`)
  } finally {
    rebuilding.value = false
  }
}

const plReport = computed(() => {
  return accountingStore.getProfitAndLoss(reportAsOnDate.value)
})

const bsReport = computed(() => {
  return accountingStore.getBalanceSheet(reportAsOnDate.value)
})

// Ledger details computed
const ledgerCardDetails = computed(() => {
  if (!selectedLedgerAccountId.value) return null
  return accountingStore.getLedgerDetails(
    selectedLedgerAccountId.value,
    ledgerFromDate.value,
    ledgerToDate.value
  )
})

const partyLedgerOptionRows = computed(() =>
  partyLedgerOptions(
    partyStore.list,
    invoiceStore.list,
    purchaseStore.list,
    firmStore.activeFirmId,
    partyLedgerMode.value,
  ),
)

function partyLedgerOptionKey(option: PartyLedgerPartyOption) {
  return `${option.source}:${option.id || option.name}`
}

const selectedPartyLedgerOption = computed(() =>
  partyLedgerOptionRows.value.find((option) => partyLedgerOptionKey(option) === partyLedgerPartyKey.value) || null,
)

function amountFilter(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

const partyLedgerResult = computed(() => buildPartyLedger(invoiceStore.list, purchaseStore.list, {
  firmId: firmStore.activeFirmId,
  mode: partyLedgerMode.value,
  partyId: selectedPartyLedgerOption.value?.source === 'party' ? selectedPartyLedgerOption.value.id : undefined,
  partyName: selectedPartyLedgerOption.value?.name,
  month: partyLedgerMonth.value || undefined,
  from: partyLedgerMonth.value ? undefined : partyLedgerFromDate.value || undefined,
  to: partyLedgerMonth.value ? undefined : partyLedgerToDate.value || undefined,
  pendingOnly: partyLedgerPendingOnly.value,
  minAmount: amountFilter(partyLedgerMinAmount.value),
  maxAmount: amountFilter(partyLedgerMaxAmount.value),
  minOutstanding: amountFilter(partyLedgerMinOutstanding.value),
  maxOutstanding: amountFilter(partyLedgerMaxOutstanding.value),
}))

function exportPartyLedgerCsv() {
  const headers = ['Date', 'Ref No', 'Mode', 'Party', 'Type', 'Narration', 'Debit', 'Credit', 'Balance', 'Outstanding', 'Status']
  const rows = partyLedgerResult.value.rows.map((row) => [
    row.date,
    row.refNo,
    row.mode,
    row.partyName,
    row.type,
    row.narration,
    n2(row.debit),
    n2(row.credit),
    row.balance == null ? '' : n2(row.balance),
    n2(row.outstanding),
    row.payStatus,
  ])
  const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `Party_Ledger_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

function printPartyLedger() {
  window.print()
}

// Voucher logs filtered computed
const filteredVouchers = computed(() => {
  return accountingStore.vouchers.filter(v => {
    if (voucherFilterType.value === 'ALL') return true
    return v.type === voucherFilterType.value
  })
})

function viewVoucherDetail(v: Voucher) {
  selectedVoucher.value = v
  showVoucherDetailModal.value = true
}

const customerLedgerRows = computed(() => {
  const firmId = firmStore.activeFirmId
  return customerReceivableSummary(invoiceStore.list.filter(i => i.firm_id === firmId && !i.is_deleted && !i.cancelled_at))
})

const cashBookRows = computed(() => cashBookFromVouchers(accountingStore.vouchers, {
  accounts: cashBankAccounts.value,
  accountIds: selectedCashBookAccountId.value ? [selectedCashBookAccountId.value] : undefined,
}))

async function loadVoucherDocFlags() {
  const firmId = firmStore.activeFirmId
  const rows = await db.document_attachments
    .where('firm_id')
    .equals(firmId)
    .filter((r) => !r.is_deleted && r.entity_type === 'voucher')
    .toArray()
  const map: Record<string, boolean> = {}
  for (const row of rows) map[row.entity_id] = true
  voucherHasDoc.value = map
}

async function onVoucherScanFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  voucherScanLoading.value = true
  voucherScanStatus.value = 'Scanning voucher…'
  pendingVoucherScanFile.value = null
  try {
    const { base64, mime } = await fileToBase64(file, { allowImages: true, allowPdf: false })
    const r = await scanVoucherImage(settingsStore.geminiKey, base64, mime)
    applyVoucherScan(r)
    pendingVoucherScanFile.value = file
    voucherScanStatus.value = 'Done — fields filled (file bill save par archive hogi)'
  } catch (err: unknown) {
    pendingVoucherScanFile.value = null
    voucherScanStatus.value = err instanceof Error ? err.message : 'Scan failed'
  } finally {
    voucherScanLoading.value = false
    input.value = ''
  }
}

function applyVoucherScan(r: VoucherScanResult) {
  if (r.date) voucherForm.date = r.date
  if (r.narration) voucherForm.narration = r.narration
  if (r.payeeName) voucherForm.payeeName = r.payeeName
  if (r.amount) voucherForm.amount = r.amount
  if (r.type === 'PV' || r.type === 'RV' || r.type === 'JV' || r.type === 'CV') {
    voucherFormType.value = r.type
  }
  const matchAcc = (hint: string) =>
    accountingStore.accounts.find(a =>
      a.name.toLowerCase().includes(hint.toLowerCase()) || a.code === hint,
    )?.id
  if (r.debitAccount) {
    const id = matchAcc(r.debitAccount)
    if (id) voucherForm.debitAccId = id
  }
  if (r.creditAccount) {
    const id = matchAcc(r.creditAccount)
    if (id) voucherForm.creditAccId = id
  }
}

onMounted(async () => {
  await Promise.all([accountingStore.load(), invoiceStore.load(), partyStore.load(), purchaseStore.load()])
  await loadVoucherDocFlags()
})

watch(() => firmStore.activeFirmId, () => { loadVoucherDocFlags() })
</script>

<template>
  <div class="max-w-7xl mx-auto space-y-6 p-4 sm:p-6">
    <!-- Header -->
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Accounting Dashboard</h1>
        <p class="text-sm text-slate-500">Double-entry ledger book, manuals, and financial outputs</p>
      </div>
      
      <!-- Nav Tabs -->
      <div class="w-full overflow-x-auto sm:w-auto">
        <div class="flex min-w-max gap-1 rounded-lg border bg-slate-100 p-0.5 sm:min-w-0 sm:flex-wrap">
        <button 
          v-for="t in ([
            { id: 'reports', label: '📊 Financials' },
            { id: 'ledger', label: '📇 Ledgers' },
            { id: 'partyLedger', label: '👤 Party Ledger' },
            { id: 'debtors', label: '👥 Sundry Debtors' },
            { id: 'cashbook', label: '💵 Cash Book' },
            { id: 'vouchers', label: '💸 Vouchers' },
            { id: 'accounts', label: '📋 Chart of Accounts' }
          ] as const)"
          :key="t.id"
          @click="activeTab = t.id"
          class="pp-btn py-1 px-3 text-xs font-semibold rounded-md border-none cursor-pointer transition-all"
          :class="activeTab === t.id ? 'bg-white text-slate-800 shadow' : 'text-slate-500 hover:text-slate-800'"
        >
          {{ t.label }}
        </button>
        </div>
      </div>
    </div>

    <!-- TAB 1: FINANCIAL REPORTS -->
    <div v-if="activeTab === 'reports'" class="space-y-6">
      <!-- Report Header config -->
      <div class="pp-card p-6 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div class="flex gap-2">
          <button 
            v-for="r in ([
              { id: 'trial', label: 'Trial Balance' },
              { id: 'pl', label: 'Profit & Loss' },
              { id: 'bs', label: 'Balance Sheet' }
            ] as const)"
            :key="r.id"
            @click="activeReport = r.id"
            class="pp-btn px-4 py-1.5 text-xs font-bold"
            :class="activeReport === r.id ? 'pp-btn-primary' : 'pp-btn-ghost'"
          >
            {{ r.label }}
          </button>
        </div>
        <div class="flex items-center gap-3 w-full md:w-auto">
          <div v-if="activeReport === 'pl'" class="flex items-center gap-2">
            <span class="text-xs font-semibold text-slate-500">From</span>
            <input type="date" v-model="reportFromDate" class="pp-input text-xs w-36" />
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold text-slate-500">As On / To</span>
            <input type="date" v-model="reportAsOnDate" class="pp-input text-xs w-36" />
          </div>
        </div>
      </div>

      <!-- Report Area: Trial Balance -->
      <div v-if="activeReport === 'trial'" class="pp-card p-6 space-y-4">
        <div class="flex items-center justify-between gap-3 border-b pb-2 flex-wrap">
          <h3 class="text-base font-bold text-slate-800">Trial Balance Sheet</h3>
          <div class="flex items-center gap-2">
            <span :class="['pp-badge', ledgerHealth.balanced ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700']">
              {{ ledgerHealth.balanced ? '✓ Balanced' : `⚠ Off by ₹${n2(Math.abs(ledgerHealth.diff))}` }}
            </span>
            <button class="pp-btn pp-btn-ghost !py-1.5" :disabled="rebuilding" @click="doRebuildLedger">
              {{ rebuilding ? 'Rebuilding…' : '🔧 Rebuild Ledger' }}
            </button>
          </div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b text-slate-500 font-semibold text-xs uppercase bg-slate-50">
                <th class="py-2.5 px-4 w-28">Acc Code</th>
                <th class="py-2.5 px-4">Account Name</th>
                <th class="py-2.5 px-4">Account Group</th>
                <th class="py-2.5 px-4 text-right w-36">Debit (Dr)</th>
                <th class="py-2.5 px-4 text-right w-36">Credit (Cr)</th>
              </tr>
            </thead>
            <tbody class="divide-y text-sm">
              <tr 
                v-for="row in trialBalanceReport.filter(r => r.dr > 0 || r.cr > 0)" 
                :key="row.account.id"
                class="hover:bg-slate-50/50"
              >
                <td class="py-2 px-4 font-mono text-slate-500">{{ row.account.code }}</td>
                <td class="py-2 px-4 font-medium">{{ row.account.name }}</td>
                <td class="py-2 px-4 text-slate-500 text-xs">{{ row.account.group }}</td>
                <td class="py-2 px-4 text-right font-mono font-medium text-blue-700">
                  {{ row.dr > 0 ? `₹${n2(row.dr)}` : '-' }}
                </td>
                <td class="py-2 px-4 text-right font-mono font-medium text-amber-700">
                  {{ row.cr > 0 ? `₹${n2(row.cr)}` : '-' }}
                </td>
              </tr>
              <tr class="font-bold bg-slate-50 text-base">
                <td colspan="3" class="py-3 px-4 text-right text-slate-600">Total Sum:</td>
                <td class="py-3 px-4 text-right font-mono text-blue-800">
                  ₹{{ n2(trialBalanceReport.reduce((s, r) => s + r.dr, 0)) }}
                </td>
                <td class="py-3 px-4 text-right font-mono text-amber-800">
                  ₹{{ n2(trialBalanceReport.reduce((s, r) => s + r.cr, 0)) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Report Area: Profit & Loss -->
      <div v-if="activeReport === 'pl'" class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Left Column: Incomes & Direct Expenses -->
        <div class="space-y-6">
          <div class="pp-card p-6 space-y-4">
            <h3 class="text-sm font-bold text-slate-500 uppercase tracking-wider border-b pb-2">Sales Income</h3>
            <table class="w-full text-sm">
              <tbody class="divide-y">
                <tr v-for="r in plReport.income.filter(row => row.cr - row.dr > 0)" :key="r.account.id">
                  <td class="py-2 font-medium">{{ r.account.name }}</td>
                  <td class="py-2 text-right font-mono text-emerald-600">₹{{ n2(r.cr - r.dr) }}</td>
                </tr>
                <tr class="font-bold text-slate-800">
                  <td class="py-3">Total Income</td>
                  <td class="py-3 text-right font-mono text-emerald-700">₹{{ n2(plReport.totalIncome) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="pp-card p-6 space-y-4">
            <h3 class="text-sm font-bold text-slate-500 uppercase tracking-wider border-b pb-2">Direct Expenses</h3>
            <table class="w-full text-sm">
              <tbody class="divide-y">
                <tr v-for="r in plReport.dirExp.filter(row => row.dr - row.cr > 0)" :key="r.account.id">
                  <td class="py-2 font-medium">{{ r.account.name }}</td>
                  <td class="py-2 text-right font-mono text-rose-600">₹{{ n2(r.dr - r.cr) }}</td>
                </tr>
                <tr class="font-bold text-slate-800 bg-slate-50 p-2">
                  <td class="py-3 pl-2">Total Direct Expenses</td>
                  <td class="py-3 text-right font-mono text-rose-700 pr-2">₹{{ n2(plReport.totalDirExp) }}</td>
                </tr>
                <tr class="font-bold text-white text-base" :class="plReport.grossProfit >= 0 ? 'bg-slate-800' : 'bg-red-700'">
                  <td class="py-3 pl-3">GROSS {{ plReport.grossProfit >= 0 ? 'PROFIT' : 'LOSS' }}</td>
                  <td class="py-3 text-right font-mono pr-3">₹{{ n2(Math.abs(plReport.grossProfit)) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Right Column: Indirect Expenses & Net Profit -->
        <div class="space-y-6">
          <div class="pp-card p-6 space-y-4">
            <h3 class="text-sm font-bold text-slate-500 uppercase tracking-wider border-b pb-2">Indirect Expenses</h3>
            <div class="max-h-80 overflow-y-auto">
              <table class="w-full text-sm">
                <tbody class="divide-y">
                  <tr v-for="r in plReport.indExp.filter(row => row.dr - row.cr > 0)" :key="r.account.id">
                    <td class="py-2 font-medium">{{ r.account.name }}</td>
                    <td class="py-2 text-right font-mono text-slate-700">₹{{ n2(r.dr - r.cr) }}</td>
                  </tr>
                  <tr v-if="plReport.indExp.filter(row => row.dr - row.cr > 0).length === 0">
                    <td colspan="2" class="py-4 text-center text-slate-400 text-xs italic">No indirect expense balances</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="flex justify-between font-bold border-t pt-3 text-slate-800">
              <span>Total Indirect Expenses</span>
              <span class="font-mono">₹{{ n2(plReport.totalIndExp) }}</span>
            </div>
          </div>

          <!-- Final Profit widget -->
          <div 
            class="rounded-2xl p-6 text-center text-white space-y-2 shadow-lg"
            :class="plReport.netProfit >= 0 ? 'bg-gradient-to-br from-emerald-600 to-teal-800' : 'bg-gradient-to-br from-rose-600 to-red-800'"
          >
            <div class="text-xs uppercase tracking-widest font-semibold opacity-75">
              {{ plReport.netProfit >= 0 ? 'NET PROFIT' : 'NET LOSS' }}
            </div>
            <div class="text-3xl font-extrabold font-mono">
              ₹ {{ n2(Math.abs(plReport.netProfit)) }}
            </div>
            <div class="text-[11px] opacity-70">
              Calculated dynamically up to date {{ reportAsOnDate }}
            </div>
          </div>
        </div>
      </div>

      <!-- Report Area: Balance Sheet -->
      <div v-if="activeReport === 'bs'" class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Asset Column -->
        <div class="pp-card p-6 space-y-4">
          <h3 class="text-base font-bold text-slate-800 border-b pb-2">Assets</h3>
          <table class="w-full text-sm">
            <tbody>
              <tr class="font-bold text-xs text-accent bg-blue-50 py-1"><td colspan="2" class="py-1 pl-2">CURRENT ASSETS</td></tr>
              <tr v-for="r in bsReport.assets.filter(row => row.account.group === 'Current Assets' && bsReport.netDrBal(row) > 0)" :key="r.account.id" class="border-b">
                <td class="py-2 pl-3">{{ r.account.name }}</td>
                <td class="py-2 text-right font-mono">₹{{ n2(bsReport.netDrBal(r)) }}</td>
              </tr>
              <tr class="font-bold text-xs text-accent bg-blue-50 py-1"><td colspan="2" class="py-1 pl-2">FIXED ASSETS</td></tr>
              <tr v-for="r in bsReport.assets.filter(row => row.account.group === 'Fixed Assets' && bsReport.netDrBal(row) > 0)" :key="r.account.id" class="border-b">
                <td class="py-2 pl-3">{{ r.account.name }}</td>
                <td class="py-2 text-right font-mono">₹{{ n2(bsReport.netDrBal(r)) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="font-extrabold text-base bg-slate-800 text-white">
                <td class="py-3 pl-3 rounded-l-lg">TOTAL ASSETS</td>
                <td class="py-3 text-right font-mono pr-3 rounded-r-lg">₹{{ n2(bsReport.totalAssets) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <!-- Liabilities Column -->
        <div class="pp-card p-6 space-y-4">
          <h3 class="text-base font-bold text-slate-800 border-b pb-2">Liabilities &amp; Capital</h3>
          <table class="w-full text-sm">
            <tbody>
              <tr class="font-bold text-xs text-purple-800 bg-purple-50 py-1"><td colspan="2" class="py-1 pl-2">CAPITAL &amp; RESERVES</td></tr>
              <tr v-for="r in bsReport.capital.filter(row => bsReport.netCrBal(row) > 0)" :key="r.account.id" class="border-b">
                <td class="py-2 pl-3">{{ r.account.name }}</td>
                <td class="py-2 text-right font-mono">₹{{ n2(bsReport.netCrBal(r)) }}</td>
              </tr>
              <tr class="border-b">
                <td class="py-2 pl-3 font-semibold" :class="bsReport.netPL >= 0 ? 'text-emerald-700' : 'text-rose-700'">
                  {{ bsReport.netPL >= 0 ? 'Add: Current Net Profit' : 'Less: Current Net Loss' }}
                </td>
                <td class="py-2 text-right font-mono font-bold" :class="bsReport.netPL >= 0 ? 'text-emerald-700' : 'text-rose-700'">
                  ₹{{ n2(Math.abs(bsReport.netPL)) }}
                </td>
              </tr>
              <tr class="font-bold text-xs text-purple-800 bg-purple-50 py-1"><td colspan="2" class="py-1 pl-2">CURRENT LIABILITIES</td></tr>
              <tr v-for="r in bsReport.liab.filter(row => bsReport.netCrBal(row) > 0)" :key="r.account.id" class="border-b">
                <td class="py-2 pl-3">{{ r.account.name }}</td>
                <td class="py-2 text-right font-mono">₹{{ n2(bsReport.netCrBal(r)) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="font-extrabold text-base bg-slate-800 text-white">
                <td class="py-3 pl-3 rounded-l-lg">TOTAL CAPITAL &amp; LIAB</td>
                <td class="py-3 text-right font-mono pr-3 rounded-r-lg">₹{{ n2(bsReport.totalLiabCap) }}</td>
              </tr>
              <tr v-if="Math.abs(bsReport.totalAssets - bsReport.totalLiabCap) > 1" class="bg-red-50 text-red-600 font-bold text-xs text-center">
                <td colspan="2" class="py-2">
                  ⚠️ Ledger Out of Balance! Diff: ₹{{ n2(Math.abs(bsReport.totalAssets - bsReport.totalLiabCap)) }}. Check your entries.
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>

    <!-- TAB 2: LEDGER CARDS -->
    <div v-else-if="activeTab === 'debtors'" class="space-y-6">
      <div class="pp-card p-6 overflow-x-auto">
        <h2 class="text-md font-semibold text-slate-800 border-b pb-3 mb-4">Customer Ledger (from Sales Invoices)</h2>
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <th class="text-left p-3">Customer</th>
              <th class="text-right p-3">Billed</th>
              <th class="text-right p-3">Received</th>
              <th class="text-right p-3">Outstanding</th>
              <th class="text-right p-3">Bills</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in customerLedgerRows" :key="r.customer" class="border-b">
              <td class="p-3 font-medium">{{ r.customer }}</td>
              <td class="p-3 text-right">₹{{ n2(r.billed) }}</td>
              <td class="p-3 text-right text-emerald-600">₹{{ n2(r.received) }}</td>
              <td class="p-3 text-right font-bold text-red-600">₹{{ n2(r.outstanding) }}</td>
              <td class="p-3 text-right">{{ r.bills }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!customerLedgerRows.length" class="py-8 text-center text-slate-400">No invoice data for customer ledger</p>
      </div>
    </div>

    <div v-else-if="activeTab === 'partyLedger'" id="party-ledger-print" class="space-y-6">
      <div class="pp-card p-6 space-y-4 print:hidden">
        <div class="flex flex-col gap-2 border-b pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 class="text-md font-semibold text-slate-800">Party Ledger</h2>
            <p class="text-xs text-slate-500">Customer aur vendor invoices/purchases ka running balance, pending aur paid view.</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button class="pp-btn pp-btn-ghost !py-1.5 text-xs" @click="exportPartyLedgerCsv" :disabled="partyLedgerResult.rows.length === 0">
              Export CSV
            </button>
            <button class="pp-btn pp-btn-primary !py-1.5 text-xs" @click="printPartyLedger" :disabled="partyLedgerResult.rows.length === 0">
              Print
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label class="pp-label">Mode</label>
            <select v-model="partyLedgerMode" class="pp-input" @change="partyLedgerPartyKey = ''">
              <option value="both">Customer + Vendor</option>
              <option value="customer">Customer</option>
              <option value="vendor">Vendor</option>
            </select>
          </div>
          <div class="md:col-span-2">
            <label class="pp-label">Party</label>
            <select v-model="partyLedgerPartyKey" class="pp-input">
              <option value="">All parties</option>
              <option v-for="option in partyLedgerOptionRows" :key="partyLedgerOptionKey(option)" :value="partyLedgerOptionKey(option)">
                {{ option.name }} · {{ option.roles.join('/') }}{{ option.source === 'document' ? ' · from bills' : '' }}
              </option>
            </select>
          </div>
          <label class="flex items-center gap-2 rounded-lg border bg-slate-50 px-3 py-2 text-sm">
            <input v-model="partyLedgerPendingOnly" type="checkbox" />
            <span>Pending only</span>
          </label>
        </div>

        <div class="grid grid-cols-1 gap-3 md:grid-cols-5">
          <div>
            <label class="pp-label">Month</label>
            <input v-model="partyLedgerMonth" type="month" class="pp-input" />
          </div>
          <div>
            <label class="pp-label">From</label>
            <input v-model="partyLedgerFromDate" type="date" class="pp-input" :disabled="!!partyLedgerMonth" />
          </div>
          <div>
            <label class="pp-label">To</label>
            <input v-model="partyLedgerToDate" type="date" class="pp-input" :disabled="!!partyLedgerMonth" />
          </div>
          <div>
            <label class="pp-label">Min Amount</label>
            <input v-model.number="partyLedgerMinAmount" type="number" min="0" class="pp-input" placeholder="0" />
          </div>
          <div>
            <label class="pp-label">Max Amount</label>
            <input v-model.number="partyLedgerMaxAmount" type="number" min="0" class="pp-input" placeholder="No limit" />
          </div>
        </div>

        <div class="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label class="pp-label">Min Outstanding</label>
            <input v-model.number="partyLedgerMinOutstanding" type="number" min="0" class="pp-input" placeholder="0" />
          </div>
          <div>
            <label class="pp-label">Max Outstanding</label>
            <input v-model.number="partyLedgerMaxOutstanding" type="number" min="0" class="pp-input" placeholder="No limit" />
          </div>
        </div>
      </div>

      <div class="pp-card p-6 space-y-4">
        <div class="flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 class="text-base font-bold text-slate-800">Party Ledger Statement</h3>
            <p class="text-xs text-slate-500">
              {{ selectedPartyLedgerOption?.name || 'All parties' }} ·
              {{ partyLedgerMonth || `${partyLedgerFromDate || 'Start'} to ${partyLedgerToDate || 'Today'}` }}
            </p>
          </div>
          <div class="grid grid-cols-2 gap-2 text-right text-xs sm:grid-cols-4">
            <div class="rounded-lg bg-blue-50 px-3 py-2">
              <div class="text-slate-500">Debit</div>
              <div class="font-bold text-blue-700">₹{{ n2(partyLedgerResult.totals.debit) }}</div>
            </div>
            <div class="rounded-lg bg-amber-50 px-3 py-2">
              <div class="text-slate-500">Credit</div>
              <div class="font-bold text-amber-700">₹{{ n2(partyLedgerResult.totals.credit) }}</div>
            </div>
            <div class="rounded-lg bg-slate-50 px-3 py-2">
              <div class="text-slate-500">Balance</div>
              <div class="font-bold text-slate-800">{{ moneyOrDash(partyLedgerResult.totals.balance) }}</div>
            </div>
            <div class="rounded-lg bg-rose-50 px-3 py-2">
              <div class="text-slate-500">Outstanding</div>
              <div class="font-bold text-rose-700">₹{{ n2(partyLedgerResult.totals.outstanding) }}</div>
            </div>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full min-w-[1040px] text-left text-sm">
            <thead class="bg-slate-50 text-xs uppercase text-slate-500">
              <tr class="border-b">
                <th class="p-3">Date</th>
                <th class="p-3">Ref</th>
                <th class="p-3">Party</th>
                <th class="p-3">Type</th>
                <th class="p-3">Narration</th>
                <th class="p-3 text-right">Debit</th>
                <th class="p-3 text-right">Credit</th>
                <th class="p-3 text-right">Balance</th>
                <th class="p-3 text-right">Outstanding</th>
                <th class="p-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in partyLedgerResult.rows" :key="row.id" class="border-b hover:bg-slate-50">
                <td class="p-3 whitespace-nowrap">{{ row.date }}</td>
                <td class="p-3 font-mono">{{ row.refNo }}</td>
                <td class="p-3">
                  <div class="font-medium">{{ row.partyName }}</div>
                  <div class="text-[11px] uppercase text-slate-400">{{ row.mode }}</div>
                </td>
                <td class="p-3">{{ row.type }}</td>
                <td class="p-3 text-slate-600">{{ row.narration }}</td>
                <td class="p-3 text-right font-mono text-blue-700">{{ row.debit ? n2(row.debit) : '-' }}</td>
                <td class="p-3 text-right font-mono text-amber-700">{{ row.credit ? n2(row.credit) : '-' }}</td>
                <td class="p-3 text-right font-mono font-bold">{{ moneyOrDash(row.balance) }}</td>
                <td class="p-3 text-right font-mono text-rose-700">₹{{ n2(row.outstanding) }}</td>
                <td class="p-3 text-center">
                  <span class="pp-badge" :class="row.outstanding <= 0.01 ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'">
                    {{ row.payStatus }}
                  </span>
                </td>
              </tr>
              <tr v-if="partyLedgerResult.rows.length === 0">
                <td colspan="10" class="p-8 text-center text-slate-400">No party ledger rows for selected filters.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-else-if="activeTab === 'cashbook'" class="space-y-6">
      <div class="pp-card p-6 overflow-x-auto">
        <div class="mb-4 flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-end sm:justify-between">
          <h2 class="text-md font-semibold text-slate-800">Cash / Bank Book</h2>
          <div class="w-full sm:w-72">
            <label class="pp-label">Cash/Bank Account</label>
            <select v-model="selectedCashBookAccountId" class="pp-input">
              <option value="">All cash and bank accounts</option>
              <option v-for="account in cashBankAccounts" :key="account.id" :value="account.id">
                {{ account.code }} — {{ account.name }}
              </option>
            </select>
          </div>
        </div>
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <th class="p-3">Date</th><th class="p-3">Voucher</th><th class="p-3">Narration</th>
              <th class="text-right p-3">Dr</th><th class="text-right p-3">Cr</th><th class="text-right p-3">Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in cashBookRows" :key="i" class="border-b">
              <td class="p-3">{{ r.date }}</td>
              <td class="p-3 font-mono">{{ r.voucher_no }}</td>
              <td class="p-3">{{ r.narration }}</td>
              <td class="p-3 text-right">{{ r.debit ? n2(r.debit) : '' }}</td>
              <td class="p-3 text-right">{{ r.credit ? n2(r.credit) : '' }}</td>
              <td class="p-3 text-right font-semibold">{{ n2(r.balance) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-else-if="activeTab === 'ledger'" class="space-y-6">
      <!-- Filter panel -->
      <div class="pp-card p-6 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
        <div class="md:col-span-2">
          <label class="pp-label">Select Ledger Account</label>
          <select v-model="selectedLedgerAccountId" class="pp-input">
            <option value="">Select Ledger Account...</option>
            <option v-for="a in accountingStore.accounts" :key="a.id" :value="a.id">
              {{ a.code }} — {{ a.name }} ({{ a.group }})
            </option>
          </select>
        </div>
        <div>
          <label class="pp-label">From Date</label>
          <input type="date" v-model="ledgerFromDate" class="pp-input" />
        </div>
        <div>
          <label class="pp-label">To Date</label>
          <input type="date" v-model="ledgerToDate" class="pp-input" />
        </div>
      </div>

      <!-- Ledger transaction records -->
      <div v-if="ledgerCardDetails" class="pp-card p-6 space-y-4">
        <div class="flex items-center justify-between border-b pb-2 mb-4">
          <div>
            <h3 class="text-base font-bold text-slate-800">{{ ledgerCardDetails.account.name }} Account</h3>
            <span class="text-xs text-slate-500 font-mono">Code: {{ ledgerCardDetails.account.code }} | Normal: {{ ledgerCardDetails.account.normal }}</span>
          </div>
          <div class="text-right">
            <div class="text-xs text-slate-500">Closing Balance</div>
            <div class="text-lg font-bold font-mono text-accent">₹{{ n2(ledgerCardDetails.finalBalance) }}</div>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b text-slate-500 font-semibold text-xs uppercase bg-slate-50">
                <th class="py-2 px-3 w-28">Date</th>
                <th class="py-2 px-3 w-32">Voucher No</th>
                <th class="py-2 px-3">Description / Narration</th>
                <th class="py-2 px-3 text-right w-28">Debit (₹)</th>
                <th class="py-2 px-3 text-right w-28">Credit (₹)</th>
                <th class="py-2 px-3 text-right w-32">Balance (₹)</th>
              </tr>
            </thead>
            <tbody class="divide-y text-sm">
              <tr 
                v-for="(row, idx) in ledgerCardDetails.rows" 
                :key="idx" 
                class="hover:bg-slate-50/50"
                :class="{ 'bg-slate-50/30 text-slate-500 italic': row.voucherNo === 'OPENING' }"
              >
                <td class="py-2 px-3 font-medium">{{ row.date || '-' }}</td>
                <td class="py-2 px-3 font-mono font-semibold">{{ row.voucherNo }}</td>
                <td class="py-2 px-3">{{ row.narration }}</td>
                <td class="py-2 px-3 text-right font-mono text-blue-600">
                  {{ row.debit > 0 ? n2(row.debit) : '-' }}
                </td>
                <td class="py-2 px-3 text-right font-mono text-amber-600">
                  {{ row.credit > 0 ? n2(row.credit) : '-' }}
                </td>
                <td class="py-2 px-3 text-right font-mono font-bold text-slate-800">
                  ₹{{ n2(row.balance) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div v-else class="text-center py-12 text-slate-400">
        Please select a ledger account to view details.
      </div>
    </div>

    <!-- TAB 3: VOUCHERS JOURNAL -->
    <div v-else-if="activeTab === 'vouchers'" class="space-y-6">
      <!-- Create buttons and filters -->
      <div class="pp-card p-6 space-y-4">
        <h3 class="text-sm font-bold text-slate-600 border-b pb-2 mb-2">Create New Manual Entry</h3>
        <div class="flex flex-wrap gap-2">
          <button @click="openNewVoucher('PV')" class="pp-btn pp-btn-ghost text-xs bg-red-50 text-red-700 hover:bg-red-100">
            💸 Payment Voucher (PV)
          </button>
          <button @click="openNewVoucher('RV')" class="pp-btn pp-btn-ghost text-xs bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
            📥 Receipt Voucher (RV)
          </button>
          <button @click="openNewVoucher('CV')" class="pp-btn pp-btn-ghost text-xs bg-blue-50 text-blue-700 hover:bg-blue-100">
            🔄 Contra Voucher (CV)
          </button>
          <button @click="openNewVoucher('JV')" class="pp-btn pp-btn-ghost text-xs bg-amber-50 text-amber-700 hover:bg-amber-100">
            📝 Journal Voucher (JV)
          </button>
        </div>
      </div>

      <!-- Voucher Logs list -->
      <div class="pp-card p-6 space-y-4">
        <div class="flex items-center justify-between border-b pb-4">
          <h2 class="text-md font-semibold text-slate-800">Posted Voucher Entries</h2>
          <select v-model="voucherFilterType" class="pp-input w-48 text-xs">
            <option value="ALL">All Vouchers</option>
            <option value="SALE">Sales Vouchers</option>
            <option value="PURCHASE">Purchase Vouchers</option>
            <option value="PAYMENT">Payments (PV)</option>
            <option value="RECEIPT">Receipts (RV)</option>
            <option value="JOURNAL">Journal Entries (JV)</option>
            <option value="CONTRA">Contra Vouchers (CV)</option>
          </select>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b text-slate-500 font-semibold text-xs uppercase bg-slate-50">
                <th class="py-3 px-4">Date</th>
                <th class="py-3 px-4">Voucher No</th>
                <th class="py-3 px-4">Voucher Type</th>
                <th class="py-3 px-4">Narration / Description</th>
                <th class="py-3 px-4 text-right">Debit/Credit Sum</th>
                <th class="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y text-sm">
              <tr v-for="v in filteredVouchers" :key="v.id" class="hover:bg-slate-50/50">
                <td class="py-3 px-4">{{ v.date }}</td>
                <td class="py-3 px-4 font-mono font-semibold">{{ v.voucher_no }}</td>
                <td class="py-3 px-4">
                  <span 
                    class="pp-badge text-[10px]"
                    :class="{
                      'bg-green-100 text-green-800': v.type === 'SALE',
                      'bg-rose-100 text-rose-800': v.type === 'PURCHASE',
                      'bg-blue-100 text-blue-800': v.type === 'PAYMENT',
                      'bg-emerald-100 text-emerald-800': v.type === 'RECEIPT',
                      'bg-amber-100 text-amber-800': v.type === 'JOURNAL',
                      'bg-indigo-100 text-indigo-800': v.type === 'CONTRA'
                    }"
                  >
                    {{ v.type }}
                  </span>
                </td>
                <td class="py-3 px-4 max-w-xs truncate" :title="v.narration">{{ v.narration }}</td>
                <td class="py-3 px-4 text-right font-mono font-medium">
                  ₹{{ n2(v.entries.reduce((sum, e) => sum + e.debit, 0)) }}
                </td>
                <td class="py-3 px-4 text-center">
                  <div class="flex justify-center gap-2 flex-wrap">
                    <button
                      v-if="voucherHasDoc[v.id]"
                      type="button"
                      class="pp-btn pp-btn-ghost px-2 py-0.5 text-xs"
                      title="View voucher scan"
                      @click="openEntityDocument('voucher', v.id)"
                    >📎 View</button>
                    <button
                      v-if="voucherHasDoc[v.id]"
                      type="button"
                      class="pp-btn pp-btn-ghost px-2 py-0.5 text-xs"
                      title="Download voucher scan"
                      @click="downloadEntityDocument('voucher', v.id)"
                    >⬇️</button>
                    <button
                      v-if="voucherHasDoc[v.id]"
                      type="button"
                      class="pp-btn pp-btn-ghost px-2 py-0.5 text-xs"
                      title="WhatsApp share"
                      @click="shareEntityDocumentWhatsApp('voucher', v.id)"
                    >📤</button>
                    <button @click="viewVoucherDetail(v)" class="pp-btn pp-btn-ghost px-2 py-0.5 text-xs">
                      👁️ Details
                    </button>
                    <!-- Allow delete for manual vouchers -->
                    <button 
                      v-if="['PAYMENT', 'RECEIPT', 'JOURNAL', 'CONTRA'].includes(v.type)"
                      @click="removeVoucher(v.id)" 
                      class="pp-btn pp-btn-ghost px-2 py-0.5 text-xs text-rose-600 hover:bg-rose-50"
                    >
                      🗑️ Delete
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="filteredVouchers.length === 0">
                <td colspan="6" class="py-8 text-center text-slate-400">
                  No vouchers posted matching filters.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- TAB 4: CHART OF ACCOUNTS -->
    <div v-else-if="activeTab === 'accounts'" class="space-y-6">
      <div class="pp-card p-6 space-y-4">
        <div class="flex items-center justify-between border-b pb-4">
          <h2 class="text-md font-semibold text-slate-800">Chart of Account Ledgers</h2>
          <button @click="openNewAccount()" class="pp-btn pp-btn-primary text-xs">
            ➕ Add Account Ledger
          </button>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b text-slate-500 font-semibold text-xs uppercase bg-slate-50">
                <th class="py-3 px-4 w-28">Acc Code</th>
                <th class="py-3 px-4">Account Name</th>
                <th class="py-3 px-4">Group Classification</th>
                <th class="py-3 px-4 text-center">Normal Bal</th>
                <th class="py-3 px-4 text-right">Dr Opening Balance</th>
                <th class="py-3 px-4 text-right">Cr Opening Balance</th>
                <th class="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y text-sm">
              <tr v-for="acc in accountingStore.accounts" :key="acc.id" class="hover:bg-slate-50/50">
                <td class="py-3 px-4 font-mono text-slate-500 font-bold">{{ acc.code }}</td>
                <td class="py-3 px-4 font-medium">{{ acc.name }}</td>
                <td class="py-3 px-4 text-slate-500 text-xs">{{ acc.group }}</td>
                <td class="py-3 px-4 text-center font-bold text-xs" :class="acc.normal === 'Dr' ? 'text-blue-600' : 'text-amber-600'">
                  {{ acc.normal }}
                </td>
                <td class="py-3 px-4 text-right font-mono text-slate-600">
                  {{ acc.open_bal_dr > 0 ? `₹${n2(acc.open_bal_dr)}` : '-' }}
                </td>
                <td class="py-3 px-4 text-right font-mono text-slate-600">
                  {{ acc.open_bal_cr > 0 ? `₹${n2(acc.open_bal_cr)}` : '-' }}
                </td>
                <td class="py-3 px-4 text-center">
                  <div class="flex justify-center gap-1">
                    <button @click="editAccount(acc)" class="pp-btn pp-btn-ghost px-2 py-0.5 text-xs">
                      ✏️ Edit
                    </button>
                    <button 
                      v-if="!acc.is_system"
                      @click="removeAccount(acc)" 
                      class="pp-btn pp-btn-ghost px-2 py-0.5 text-xs text-rose-600 hover:bg-rose-50"
                    >
                      🗑️ Del
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- MODAL 1: Account Add/Edit -->
    <PpModal :show="showAccountModal" :title="editingAccount ? 'Edit Account Details' : 'Create New Account Ledger'" @close="showAccountModal = false">
      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="pp-label">Account Code *</label>
            <input v-model="accountForm.code" class="pp-input font-mono" placeholder="e.g. 5209" />
          </div>
          <div>
            <label class="pp-label">Normal Balance Direction</label>
            <select v-model="accountForm.normal" class="pp-input">
              <option value="Dr">Debit (Assets, Expenses)</option>
              <option value="Cr">Credit (Liabilities, Capital, Revenues)</option>
            </select>
          </div>
        </div>
        <div>
          <label class="pp-label">Account Name *</label>
          <input v-model="accountForm.name" class="pp-input" placeholder="e.g. Solar Energy Maintenance" />
        </div>
        <div>
          <label class="pp-label">Group Category</label>
          <select v-model="accountForm.group" class="pp-input">
            <option value="Current Assets">Current Assets</option>
            <option value="Fixed Assets">Fixed Assets</option>
            <option value="Current Liabilities">Current Liabilities</option>
            <option value="Capital & Reserves">Capital &amp; Reserves</option>
            <option value="Sales Income">Sales Income</option>
            <option value="Other Income">Other Income</option>
            <option value="Purchase Expense">Purchase Expense</option>
            <option value="Direct Expense">Direct Expense</option>
            <option value="Indirect Expense">Indirect Expense</option>
          </select>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="pp-label">Debit Opening Balance (₹)</label>
            <input type="number" v-model.number="accountForm.open_bal_dr" class="pp-input text-right font-mono" placeholder="0.00" />
          </div>
          <div>
            <label class="pp-label">Credit Opening Balance (₹)</label>
            <input type="number" v-model.number="accountForm.open_bal_cr" class="pp-input text-right font-mono" placeholder="0.00" />
          </div>
        </div>
        <div class="flex gap-2 justify-end border-t pt-4">
          <button @click="showAccountModal = false" class="pp-btn pp-btn-ghost">Cancel</button>
          <button @click="saveAccount()" class="pp-btn pp-btn-primary">Save Ledger Account</button>
        </div>
      </div>
    </PpModal>

    <!-- MODAL 2: Voucher Add (Payment, Receipt, Contra, Journal) -->
    <PpModal :show="showVoucherModal" :title="`Create ${voucherFormType} Voucher`" @close="showVoucherModal = false" max-width="max-w-3xl">
      <div class="space-y-4">
        <div class="border-2 border-dashed border-slate-300 rounded-lg p-3 bg-slate-50 text-center">
          <p class="text-xs font-semibold text-navy mb-2">🤖 AI Voucher Scan (PV / RV / JV photo)</p>
          <label class="pp-btn pp-btn-primary cursor-pointer inline-block !text-xs">
            {{ voucherScanLoading ? 'Scanning…' : 'Upload Voucher Image' }}
            <input type="file" accept="image/*" class="hidden" :disabled="voucherScanLoading" @change="onVoucherScanFile" />
          </label>
          <p v-if="voucherScanStatus" class="text-xs mt-2 text-slate-500">{{ voucherScanStatus }}</p>
          <p v-if="pendingVoucherScanFile" class="text-xs mt-2 text-emerald-700">
            📎 {{ pendingVoucherScanFile.name }} — post par auto-compress + Supabase par archive hogi
          </p>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="pp-label">Voucher Date</label>
            <input type="date" v-model="voucherForm.date" class="pp-input" />
          </div>
          <div v-if="voucherFormType !== 'JV'">
            <label class="pp-label">Amount (₹) *</label>
            <input type="number" v-model.number="voucherForm.amount" class="pp-input font-mono text-right" placeholder="0.00" />
          </div>
          <div v-else>
            <label class="pp-label">Voucher Amount (JV Sum)</label>
            <input :value="jvTotals.dr" readonly class="pp-input font-mono text-right bg-slate-50" />
          </div>
        </div>

        <!-- PV form configuration -->
        <div v-if="voucherFormType === 'PV'" class="space-y-4">
          <div>
            <label class="pp-label">Payee / Payee Name *</label>
            <input v-model="voucherForm.payeeName" class="pp-input" placeholder="e.g. Ramesh Plumber, Cash Withdrawal" />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="pp-label">Expense / Dr Account (Debit) *</label>
              <select v-model="voucherForm.debitAccId" class="pp-input">
                <option v-for="a in accountingStore.accounts" :key="a.id" :value="a.id">
                  {{ a.code }} — {{ a.name }}
                </option>
              </select>
            </div>
            <div>
              <label class="pp-label">Pay From Cash/Bank (Credit) *</label>
              <select v-model="voucherForm.creditAccId" class="pp-input">
                <option v-for="a in cashBankAccounts" :key="a.id" :value="a.id">
                  {{ a.code }} — {{ a.name }}
                </option>
              </select>
            </div>
          </div>
        </div>

        <!-- RV form configuration -->
        <div v-else-if="voucherFormType === 'RV'" class="space-y-4">
          <div>
            <label class="pp-label">Received From (Payer Name) *</label>
            <input v-model="voucherForm.payeeName" class="pp-input" placeholder="e.g. M/s XYZ Buyers" />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="pp-label">Receive Into Cash/Bank (Debit) *</label>
              <select v-model="voucherForm.debitAccId" class="pp-input">
                <option v-for="a in cashBankAccounts" :key="a.id" :value="a.id">
                  {{ a.code }} — {{ a.name }}
                </option>
              </select>
            </div>
            <div>
              <label class="pp-label">Income / Cr Account (Credit) *</label>
              <select v-model="voucherForm.creditAccId" class="pp-input">
                <option v-for="a in accountingStore.accounts" :key="a.id" :value="a.id">
                  {{ a.code }} — {{ a.name }}
                </option>
              </select>
            </div>
          </div>
        </div>

        <!-- CV form configuration -->
        <div v-else-if="voucherFormType === 'CV'" class="grid grid-cols-2 gap-4">
          <div>
            <label class="pp-label">Deposit Into (Debit) *</label>
            <select v-model="voucherForm.debitAccId" class="pp-input">
              <option v-for="a in cashBankAccounts" :key="a.id" :value="a.id">
                {{ a.code }} — {{ a.name }}
              </option>
            </select>
          </div>
          <div>
            <label class="pp-label">Withdraw From (Credit) *</label>
            <select v-model="voucherForm.creditAccId" class="pp-input">
              <option v-for="a in cashBankAccounts" :key="a.id" :value="a.id">
                {{ a.code }} — {{ a.name }}
              </option>
            </select>
          </div>
        </div>

        <!-- JV multi-line form configuration -->
        <div v-else-if="voucherFormType === 'JV'" class="space-y-3">
          <div class="overflow-x-auto max-h-60">
            <table class="w-full text-xs text-left">
              <thead>
                <tr class="bg-slate-50 font-semibold border-b">
                  <th class="py-2 px-1">Ledger Account</th>
                  <th class="py-2 px-1 text-right w-28">Debit Amt (Dr)</th>
                  <th class="py-2 px-1 text-right w-28">Credit Amt (Cr)</th>
                  <th class="py-2 px-1 w-8"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, idx) in voucherForm.entries" :key="idx">
                  <td class="py-1 px-1">
                    <select v-model="row.accountId" class="pp-input text-xs">
                      <option v-for="a in accountingStore.accounts" :key="a.id" :value="a.id">
                        {{ a.code }} — {{ a.name }}
                      </option>
                    </select>
                  </td>
                  <td class="py-1 px-1">
                    <input type="number" v-model.number="row.debit" class="pp-input text-xs text-right" placeholder="0.00" @input="row.credit = 0" />
                  </td>
                  <td class="py-1 px-1">
                    <input type="number" v-model.number="row.credit" class="pp-input text-xs text-right" placeholder="0.00" @input="row.debit = 0" />
                  </td>
                  <td class="py-1 px-1 text-center">
                    <button @click="removeJvRow(idx)" class="text-rose-500 font-bold hover:text-rose-700">✕</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <button @click="addJvRow()" class="pp-btn pp-btn-ghost text-xs w-full py-1">
            ➕ Add Journal Line Row
          </button>
          <div class="flex justify-between items-center text-xs font-bold bg-slate-100 p-2 rounded">
            <div>Debit Total: ₹{{ n2(jvTotals.dr) }}</div>
            <div>Credit Total: ₹{{ n2(jvTotals.cr) }}</div>
            <div :class="Math.abs(jvTotals.dr - jvTotals.cr) < 0.01 ? 'text-green-600' : 'text-rose-500'">
              {{ Math.abs(jvTotals.dr - jvTotals.cr) < 0.01 ? 'Balanced ✓' : `Out by ₹${n2(Math.abs(jvTotals.dr - jvTotals.cr))} ⚠️` }}
            </div>
          </div>
        </div>

        <div>
          <label class="pp-label">Narration / Internal Description *</label>
          <input v-model="voucherForm.narration" class="pp-input" placeholder="e.g. Conveyance allowance to driver" />
        </div>

        <div class="flex gap-2 justify-end border-t pt-4">
          <button @click="showVoucherModal = false" class="pp-btn pp-btn-ghost">Cancel</button>
          <button @click="saveVoucher" class="pp-btn pp-btn-primary">Post Voucher to Ledger</button>
        </div>
      </div>
    </PpModal>

    <!-- MODAL 3: Voucher View Details -->
    <PpModal :show="showVoucherDetailModal" title="Voucher Posting Details" @close="showVoucherDetailModal = false">
      <div v-if="selectedVoucher" class="space-y-4">
        <div class="border-b pb-3">
          <div class="text-lg font-bold font-mono">{{ selectedVoucher.voucher_no }}</div>
          <div class="text-xs text-slate-500 font-medium">Type: {{ selectedVoucher.type }} | Date: {{ selectedVoucher.date }}</div>
        </div>

        <div>
          <span class="text-xs font-bold text-slate-400 block uppercase">Narration Detail</span>
          <p class="text-sm font-medium text-slate-800 bg-slate-50 p-2 rounded border">{{ selectedVoucher.narration }}</p>
        </div>

        <div>
          <span class="text-xs font-bold text-slate-400 block uppercase mb-2">Ledger Postings</span>
          <table class="w-full text-xs text-left border border-slate-100">
            <thead>
              <tr class="bg-slate-50 font-bold border-b">
                <th class="py-2 px-3">Account Account</th>
                <th class="py-2 px-3 text-right">Debit (Dr)</th>
                <th class="py-2 px-3 text-right">Credit (Cr)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(e, idx) in selectedVoucher.entries" :key="idx" class="border-b hover:bg-slate-50/50">
                <td class="py-2 px-3 font-semibold text-slate-700">
                  {{ getAccountLabel(e.accountId) }}
                </td>
                <td class="py-2 px-3 text-right font-mono font-bold text-blue-700">
                  {{ e.debit > 0 ? `₹${n2(e.debit)}` : '-' }}
                </td>
                <td class="py-2 px-3 text-right font-mono font-bold text-amber-700">
                  {{ e.credit > 0 ? `₹${n2(e.credit)}` : '-' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex gap-2 justify-end border-t pt-4">
          <button @click="showVoucherDetailModal = false" class="pp-btn pp-btn-ghost">Close</button>
        </div>
      </div>
    </PpModal>
  </div>
</template>
