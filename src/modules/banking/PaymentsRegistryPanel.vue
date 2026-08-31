<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAccountingStore } from '@/stores/accounting'
import { useInvoiceStore } from '@/stores/invoices'
import { usePurchaseStore } from '@/stores/purchases'
import { useFirmStore } from '@/stores/firm'
import {
  buildPaymentRegistry,
  paymentRegistryTotals,
  type PaymentRegistryRow,
} from '@/services/paymentRegistry'

const accountingStore = useAccountingStore()
const invoiceStore = useInvoiceStore()
const purchaseStore = usePurchaseStore()
const firmStore = useFirmStore()

const busy = ref(false)
const filter = ref<'all' | 'duplicates' | 'in' | 'out'>('all')
const search = ref('')
const selected = ref<Set<string>>(new Set())

onMounted(async () => {
  busy.value = true
  try {
    await Promise.all([
      accountingStore.load(),
      invoiceStore.load(),
      purchaseStore.load(),
    ])
  } finally {
    busy.value = false
  }
})

const allRows = computed(() => buildPaymentRegistry({
  vouchers: accountingStore.vouchers,
  invoices: invoiceStore.list.filter((i) => i.firm_id === firmStore.activeFirmId),
  purchases: purchaseStore.list.filter((p) => p.firm_id === firmStore.activeFirmId),
}))

const totals = computed(() => paymentRegistryTotals(allRows.value))

const visibleRows = computed(() => {
  const q = search.value.trim().toLowerCase()
  return allRows.value.filter((row) => {
    if (filter.value === 'duplicates' && !row.duplicateGroupId) return false
    if (filter.value === 'in' && row.direction !== 'in') return false
    if (filter.value === 'out' && row.direction !== 'out') return false
    if (!q) return true
    const hay = `${row.partyName} ${row.billNo} ${row.narration} ${row.voucherNo}`.toLowerCase()
    return hay.includes(q)
  })
})

function n2(n: number) {
  return (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function toggleSelect(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function selectDuplicateExtras() {
  const seenBillVoucher = new Map<string, string>()
  const next = new Set<string>()
  for (const row of [...allRows.value].sort((a, b) => a.date.localeCompare(b.date))) {
    if (row.billId && row.billKind && row.voucherId) {
      const key = `${row.billKind}:${row.billId}`
      if (seenBillVoucher.has(key)) next.add(row.id)
      else seenBillVoucher.set(key, row.id)
    }
    if (row.duplicateGroupId) {
      const inGroup = allRows.value.filter((r) => r.duplicateGroupId === row.duplicateGroupId)
      if (inGroup.length > 1) {
        const sorted = [...inGroup].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
        sorted.slice(1).forEach((r) => next.add(r.id))
      }
    }
  }
  selected.value = next
}

function clearSelection() {
  selected.value = new Set()
}

async function removeRow(row: PaymentRegistryRow) {
  const label = `${row.direction === 'in' ? 'Receipt' : 'Payment'} ₹${n2(row.amount)} · ${row.partyName || row.billNo}`
  if (!confirm(`Ye entry hata den?\n\n${label}\n\nBill paid amount + voucher (agar hai) reverse ho jayega.`)) return

  busy.value = true
  try {
    if (row.billId && row.billKind === 'invoice') {
      await invoiceStore.clearPayment(row.billId)
    } else if (row.billId && row.billKind === 'purchase') {
      await purchaseStore.clearPayment(row.billId)
    } else if (row.voucherId) {
      await accountingStore.deleteVoucherById(row.voucherId)
    }
    selected.value.delete(row.id)
    await accountingStore.load()
    await invoiceStore.load()
    await purchaseStore.load()
  } catch (err: any) {
    alert(err?.message || 'Remove fail')
  } finally {
    busy.value = false
  }
}

async function removeSelected() {
  const rows = allRows.value.filter((r) => selected.value.has(r.id))
  if (!rows.length) return alert('Koi row select nahi')
  if (!confirm(`${rows.length} payment(s) remove karein?`)) return

  busy.value = true
  let ok = 0
  try {
    for (const row of rows) {
      try {
        if (row.billId && row.billKind === 'invoice') await invoiceStore.clearPayment(row.billId)
        else if (row.billId && row.billKind === 'purchase') await purchaseStore.clearPayment(row.billId)
        else if (row.voucherId) await accountingStore.deleteVoucherById(row.voucherId)
        ok++
      } catch {
        // continue with rest
      }
    }
    selected.value = new Set()
    await Promise.all([accountingStore.load(), invoiceStore.load(), purchaseStore.load()])
    alert(`${ok} / ${rows.length} removed`)
  } finally {
    busy.value = false
  }
}

async function refresh() {
  busy.value = true
  try {
    await Promise.all([accountingStore.load(), invoiceStore.load(), purchaseStore.load()])
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="pp-card p-4 flex flex-wrap items-center gap-3">
      <div>
        <h2 class="font-semibold text-navy">All Payments</h2>
        <p class="text-xs text-slate-500">Receipts + vendor payments ek jagah — duplicates highlight, galat entry ↩️ se hatao.</p>
      </div>
      <button type="button" class="pp-btn pp-btn-ghost !py-1.5 text-xs ml-auto" :disabled="busy" @click="refresh">
        Refresh
      </button>
    </div>

    <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
      <div class="pp-card p-3 text-center">
        <div class="text-xs text-slate-500">Total entries</div>
        <div class="text-lg font-bold text-navy">{{ totals.count }}</div>
      </div>
      <div class="pp-card p-3 text-center">
        <div class="text-xs text-slate-500">Receipts (in)</div>
        <div class="text-lg font-bold text-emerald-700">₹{{ n2(totals.receipts) }}</div>
      </div>
      <div class="pp-card p-3 text-center">
        <div class="text-xs text-slate-500">Payments (out)</div>
        <div class="text-lg font-bold text-orange-700">₹{{ n2(totals.payments) }}</div>
      </div>
      <div class="pp-card p-3 text-center">
        <div class="text-xs text-slate-500">Duplicate rows</div>
        <div class="text-lg font-bold text-rose-700">{{ totals.duplicateRows }}</div>
      </div>
      <div class="pp-card p-3 text-center">
        <div class="text-xs text-slate-500">Dup. groups</div>
        <div class="text-lg font-bold text-rose-600">{{ totals.duplicateGroups }}</div>
      </div>
    </div>

    <div class="pp-card p-4 flex flex-wrap items-center gap-3">
      <select v-model="filter" class="pp-input max-w-[160px] text-sm">
        <option value="all">All</option>
        <option value="duplicates">Duplicates only</option>
        <option value="in">Receipts (in)</option>
        <option value="out">Payments (out)</option>
      </select>
      <input v-model="search" type="search" class="pp-input flex-1 min-w-[12rem] text-sm" placeholder="Party, bill no, narration…" />
      <button type="button" class="pp-btn pp-btn-ghost text-xs" @click="selectDuplicateExtras">Select dup. extras</button>
      <button type="button" class="pp-btn pp-btn-ghost text-xs" @click="clearSelection">Clear</button>
      <button
        type="button"
        class="pp-btn pp-btn-danger text-xs"
        :disabled="busy || !selected.size"
        @click="removeSelected"
      >
        Remove {{ selected.size }} selected
      </button>
    </div>

    <div class="pp-card overflow-x-auto">
      <table class="w-full text-sm min-w-[960px]">
        <thead class="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th class="p-3 w-8"></th>
            <th class="p-3 text-left">Date</th>
            <th class="p-3 text-center">Type</th>
            <th class="p-3 text-right">Amount</th>
            <th class="p-3 text-left">Party</th>
            <th class="p-3 text-left">Bill</th>
            <th class="p-3 text-left">Voucher</th>
            <th class="p-3 text-left">Narration</th>
            <th class="p-3 text-center">Dup.</th>
            <th class="p-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody class="divide-y">
          <tr
            v-for="row in visibleRows"
            :key="row.id"
            :class="row.duplicateGroupId ? 'bg-rose-50/60' : ''"
          >
            <td class="p-3 text-center">
              <input type="checkbox" :checked="selected.has(row.id)" @change="toggleSelect(row.id)" />
            </td>
            <td class="p-3 font-mono text-xs whitespace-nowrap">{{ row.date }}</td>
            <td class="p-3 text-center">
              <span
                class="pp-badge text-[10px]"
                :class="row.direction === 'in' ? 'bg-emerald-100 text-emerald-800' : 'bg-orange-100 text-orange-800'"
              >{{ row.direction === 'in' ? 'IN' : 'OUT' }}</span>
            </td>
            <td class="p-3 text-right font-mono font-semibold">₹{{ n2(row.amount) }}</td>
            <td class="p-3">{{ row.partyName || '—' }}</td>
            <td class="p-3 font-mono text-xs">{{ row.billNo }}</td>
            <td class="p-3 font-mono text-xs">{{ row.voucherNo }}</td>
            <td class="p-3 text-xs text-slate-600 max-w-[14rem] truncate" :title="row.narration">{{ row.narration }}</td>
            <td class="p-3 text-center">
              <span
                v-if="row.duplicateGroupId"
                class="pp-badge text-[10px] bg-rose-100 text-rose-800"
                :title="row.duplicateLabel"
              >DUP</span>
            </td>
            <td class="p-3 text-right">
              <button
                type="button"
                class="pp-btn pp-btn-ghost !py-1 !px-2 text-xs text-rose-700"
                :disabled="busy"
                title="Remove payment"
                @click="removeRow(row)"
              >↩️</button>
            </td>
          </tr>
          <tr v-if="!visibleRows.length">
            <td colspan="10" class="p-8 text-center text-slate-400">Koi payment entry nahi.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
