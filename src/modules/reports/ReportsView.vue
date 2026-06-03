<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useInvoiceStore } from '@/stores/invoices'
import { usePartyStore } from '@/stores/parties'
import { useItemStore } from '@/stores/items'
import { usePurchaseStore } from '@/stores/purchases'
import { useAccountingStore } from '@/stores/accounting'
import { useFirmStore } from '@/stores/firm'
import { db } from '@/data/db'
import {
  filterInvoices, gstrB2B, gstrB2C, gstrHsnSummary, outstandingAging,
  cashBookFromVouchers, ewayInvoices, itemSalesReport, getStateName, getStateCode,
} from '@/services/reports'
import { recentActivity } from '@/services/activityLog'
import { displayGstinForInvoice } from '@/services/invoiceDisplay'
import type { ActivityLog } from '@/types/models'
import type { Invoice } from '@/types/models'

const tab = ref<'b2b' | 'b2c' | 'hsn' | 'items' | 'outstanding' | 'cashbook' | 'eway' | 'activity' | 'deleted'>('b2b')
const from = ref('')
const to = ref('')

const invoiceStore = useInvoiceStore()
const partyStore = usePartyStore()
const itemStore = useItemStore()
const purchaseStore = usePurchaseStore()
const accountingStore = useAccountingStore()
const firmStore = useFirmStore()

const activity = ref<ActivityLog[]>([])
const activitySearch = ref('')
const activityEntityFilter = ref('all')
const activityPage = ref(1)
const ACTIVITY_PAGE_SIZE = 50

const filteredActivity = computed(() => {
  const q = activitySearch.value.toLowerCase().trim()
  const ef = activityEntityFilter.value
  return activity.value.filter((a) => {
    if (ef !== 'all' && a.entity_type !== ef) return false
    if (!q) return true
    return (a.summary || '').toLowerCase().includes(q) || (a.action || '').toLowerCase().includes(q)
  })
})
const pagedActivity = computed(() => {
  const start = (activityPage.value - 1) * ACTIVITY_PAGE_SIZE
  return filteredActivity.value.slice(start, start + ACTIVITY_PAGE_SIZE)
})
const activityTotalPages = computed(() => Math.max(1, Math.ceil(filteredActivity.value.length / ACTIVITY_PAGE_SIZE)))

function reportInvoiceGst(b: Invoice) {
  const live = b.party_id ? partyStore.list.find((p) => !p.is_deleted && p.id === b.party_id) : undefined
  return displayGstinForInvoice(b, live) || '—'
}

const ACTION_COLOR: Record<string, string> = {
  create: 'bg-emerald-100 text-emerald-700',
  update: 'bg-blue-100 text-blue-700',
  delete: 'bg-red-100 text-red-700',
  restore: 'bg-amber-100 text-amber-700',
}

const deletedTab = ref<'all' | 'bills' | 'parties' | 'items' | 'purchases' | 'templates'>('all')
const deletedRows = ref<{ type: string; name: string; id: string; date: string; entity: string }[]>([])

onMounted(async () => {
  await firmStore.load()
  await Promise.all([invoiceStore.load(), partyStore.load(), itemStore.load(), purchaseStore.load()])
  await accountingStore.load()
  const firmId = firmStore.activeFirmId
  if (firmId) activity.value = await recentActivity(firmId, 2000)
  await loadDeleted()
})

async function loadDeleted() {
  const rows: typeof deletedRows.value = []
  const push = (
    type: string,
    entity: string,
    list: { id: string; name?: string; bill_no?: string; date?: string; updated_at?: string; is_deleted: boolean }[],
    nameFn: (x: typeof list[0]) => string,
  ) => {
    for (const r of list.filter(x => x.is_deleted)) {
      rows.push({ type, entity, id: r.id, name: nameFn(r), date: r.date || r.updated_at || '' })
    }
  }
  push('Bill', 'bills', await db.invoices.toArray(), r => r.bill_no || r.id)
  push('Party', 'parties', await db.parties.toArray(), r => r.name || r.id)
  push('Item', 'items', await db.items.toArray(), r => r.name || r.id)
  push('Purchase', 'purchases', await db.purchases.toArray(), r => r.bill_no || r.id)
  try {
    const tpl = JSON.parse(localStorage.getItem('pama_templates_suite') || '[]') as { id: string; name: string; deletedAt?: string }[]
    for (const t of tpl.filter(x => (x as any).deletedAt)) {
      rows.push({ type: 'Template', entity: 'templates', id: t.id, name: t.name, date: (t as any).deletedAt })
    }
  } catch { /* */ }
  deletedRows.value = rows.sort((a, b) => b.date.localeCompare(a.date))
}

const filteredDeleted = computed(() => {
  if (deletedTab.value === 'all') return deletedRows.value
  return deletedRows.value.filter(r => r.entity === deletedTab.value)
})

async function restoreDeleted(row: { entity: string; id: string; type: string }) {
  if (!confirm(`Restore this ${row.type}?`)) return
  if (row.entity === 'bills') await invoiceStore.restore(row.id)
  else if (row.entity === 'parties') await partyStore.restore(row.id)
  else if (row.entity === 'items') await itemStore.restore(row.id)
  else if (row.entity === 'purchases') await purchaseStore.restore(row.id)
  else if (row.entity === 'templates') {
    const raw = localStorage.getItem('pama_templates_suite')
    if (raw) {
      const list = JSON.parse(raw)
      const t = list.find((x: { id: string }) => x.id === row.id)
      if (t) delete t.deletedAt
      localStorage.setItem('pama_templates_suite', JSON.stringify(list))
    }
  }
  await loadDeleted()
  alert('Restored successfully')
}

const filtered = computed(() =>
  filterInvoices(invoiceStore.list, firmStore.activeFirmId, from.value || undefined, to.value || undefined)
)

const b2bRows = computed(() => gstrB2B(filtered.value))
const b2cRows = computed(() => gstrB2C(filtered.value))
const hsnRows = computed(() => gstrHsnSummary(filtered.value))
const itemRows = computed(() => itemSalesReport(filtered.value))
const receivableDocs = computed(() => invoiceStore.list.filter((i) => {
  if (i.firm_id !== firmStore.activeFirmId || i.is_deleted) return false
  if (from.value && i.date < from.value) return false
  if (to.value && i.date > to.value) return false
  return true
}))
const cashBookAccounts = computed(() => accountingStore.accounts.filter(a =>
  a.group === 'Current Assets' &&
  (a.code === '1001' || a.code === '1002' || a.name.toLowerCase().includes('bank') || a.name.toLowerCase().includes('cash'))
))
const agingRows = computed(() => outstandingAging(receivableDocs.value))
const cashRows = computed(() => cashBookFromVouchers(accountingStore.vouchers, {
  accounts: cashBookAccounts.value,
  from: from.value || undefined,
  to: to.value || undefined,
}))
const ewayRows = computed(() => ewayInvoices(filtered.value))

function n2(n: number) {
  return (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function exportCsv(filename: string, headers: string[], rows: string[][]) {
  const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
}

function exportOutstanding() {
  exportCsv('Outstanding_Aging.csv',
    ['Customer', '0-30', '31-60', '61-90', '90+', 'Total', 'Bills'],
    agingRows.value.map(r => [r.customer, n2(r.d0_30), n2(r.d31_60), n2(r.d61_90), n2(r.d90plus), n2(r.total), String(r.billCount)]))
}

function exportItemSales() {
  exportCsv('Item_Sales.csv',
    ['Item', 'Bills', 'Qty', 'Value'],
    itemRows.value.map(r => [r.name, String(r.count), n2(r.qty), n2(r.value)]))
}
</script>

<template>
  <div class="p-4 sm:p-6 max-w-7xl mx-auto">
    <header class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-navy">Reports</h1>
        <p class="text-sm text-slate-500">GSTR-1, Outstanding, Cash Book &amp; more</p>
      </div>
      <div class="flex gap-2 flex-wrap items-end">
        <div><label class="pp-label">From</label><input v-model="from" type="date" class="pp-input !w-36" /></div>
        <div><label class="pp-label">To</label><input v-model="to" type="date" class="pp-input !w-36" /></div>
      </div>
    </header>

    <div class="flex flex-wrap gap-1 mb-4 border-b border-slate-200 pb-2">
      <button v-for="t in [
        ['b2b','GSTR B2B'],['b2c','GSTR B2C'],['hsn','HSN'],['items','Item Sales'],
        ['outstanding','Outstanding'],['cashbook','Cash Book'],['eway','E-Way'],['activity','Activity'],['deleted','Deleted']
      ]" :key="t[0]"
        :class="['px-3 py-1.5 rounded-lg text-xs font-semibold', tab === t[0] ? 'bg-accent text-white' : 'bg-slate-100 text-slate-600']"
        @click="tab = t[0] as any">{{ t[1] }}</button>
    </div>

    <!-- GSTR B2B -->
    <div v-if="tab === 'b2b'" class="pp-card overflow-x-auto">
      <p class="text-xs text-slate-500 mb-3 p-3 bg-blue-50 rounded">B2B invoices with buyer GSTIN — GSTR-1 Table 4A</p>
      <table class="w-full text-sm">
        <thead><tr class="border-b"><th class="text-left p-2">Date</th><th>Invoice</th><th>Buyer</th><th>GSTIN</th><th>POS</th><th class="text-right">Taxable</th><th class="text-right">Tax</th><th class="text-right">Total</th></tr></thead>
        <tbody>
          <tr v-for="b in b2bRows" :key="b.id" class="border-b border-slate-100">
            <td class="p-2">{{ b.date }}</td>
            <td>{{ b.bill_no }}</td>
            <td>{{ b.party_name }}</td>
            <td class="font-mono text-sm font-semibold">{{ reportInvoiceGst(b) }}</td>
            <td>{{ getStateName(getStateCode(b.party_snapshot?.gst || '')) }}</td>
            <td class="text-right">₹{{ n2(b.sub) }}</td>
            <td class="text-right">₹{{ n2(b.total_tax) }}</td>
            <td class="text-right font-semibold">₹{{ n2(b.grand_total) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!b2bRows.length" class="p-8 text-center text-slate-400">No B2B invoices in range</p>
    </div>

    <!-- GSTR B2C -->
    <div v-if="tab === 'b2c'" class="pp-card overflow-x-auto">
      <p class="text-xs text-slate-500 mb-3 p-3 bg-blue-50 rounded">B2C summary — GSTR-1 Table 7</p>
      <table class="w-full text-sm">
        <thead><tr class="border-b"><th class="text-left p-2">Date</th><th>Invoice</th><th>Customer</th><th class="text-right">Taxable</th><th class="text-right">Total</th></tr></thead>
        <tbody>
          <tr v-for="b in b2cRows" :key="b.id" class="border-b border-slate-100">
            <td class="p-2">{{ b.date }}</td><td>{{ b.bill_no }}</td><td>{{ b.party_name }}</td>
            <td class="text-right">₹{{ n2(b.sub) }}</td><td class="text-right">₹{{ n2(b.grand_total) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- HSN -->
    <div v-if="tab === 'hsn'" class="pp-card overflow-x-auto">
      <table class="w-full text-sm">
        <thead><tr class="border-b"><th>HSN</th><th>Description</th><th>UQC</th><th class="text-right">Qty</th><th class="text-right">Taxable</th><th class="text-right">Tax</th></tr></thead>
        <tbody>
          <tr v-for="r in hsnRows" :key="r.hsn" class="border-b"><td>{{ r.hsn }}</td><td>{{ r.desc }}</td><td>{{ r.uqc }}</td>
            <td class="text-right">{{ n2(r.qty) }}</td><td class="text-right">₹{{ n2(r.taxable) }}</td><td class="text-right">₹{{ n2(r.tax) }}</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Item sales -->
    <div v-if="tab === 'items'" class="pp-card overflow-x-auto">
      <div class="flex justify-between items-center p-3 border-b">
        <span class="font-semibold">Item Sales</span>
        <button class="pp-btn pp-btn-primary !py-1.5 !text-xs" @click="exportItemSales">📥 Export CSV</button>
      </div>
      <table class="w-full text-sm">
        <thead><tr class="border-b"><th>Item</th><th class="text-right">Bills</th><th class="text-right">Qty</th><th class="text-right">Value</th></tr></thead>
        <tbody>
          <tr v-for="r in itemRows" :key="r.name" class="border-b"><td>{{ r.name }}</td><td class="text-right">{{ r.count }}</td><td class="text-right">{{ n2(r.qty) }}</td><td class="text-right">₹{{ n2(r.value) }}</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Outstanding -->
    <div v-if="tab === 'outstanding'" class="pp-card overflow-x-auto">
      <div class="flex justify-between items-center p-3 border-b">
        <span class="font-semibold">Customer Outstanding &amp; Aging</span>
        <button class="pp-btn pp-btn-primary !py-1.5 !text-xs" @click="exportOutstanding">📥 Export CSV</button>
      </div>
      <table class="w-full text-sm">
        <thead><tr class="border-b bg-slate-50"><th class="text-left p-2">Customer</th><th class="text-right">0-30</th><th class="text-right">31-60</th><th class="text-right">61-90</th><th class="text-right">90+</th><th class="text-right">Total</th><th class="text-right">Bills</th></tr></thead>
        <tbody>
          <tr v-for="r in agingRows" :key="r.customer" class="border-b">
            <td class="p-2 font-medium">{{ r.customer }}</td>
            <td class="text-right">₹{{ n2(r.d0_30) }}</td><td class="text-right">₹{{ n2(r.d31_60) }}</td>
            <td class="text-right">₹{{ n2(r.d61_90) }}</td><td class="text-right text-red-600">₹{{ n2(r.d90plus) }}</td>
            <td class="text-right font-bold">₹{{ n2(r.total) }}</td><td class="text-right">{{ r.billCount }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!agingRows.length" class="p-8 text-center text-green-600">All bills paid 🎉</p>
    </div>

    <!-- Cash book -->
    <div v-if="tab === 'cashbook'" class="pp-card overflow-x-auto">
      <table class="w-full text-sm">
        <thead><tr class="border-b"><th>Date</th><th>Voucher</th><th>Narration</th><th class="text-right">Dr</th><th class="text-right">Cr</th><th class="text-right">Balance</th></tr></thead>
        <tbody>
          <tr v-for="(r, i) in cashRows" :key="i" class="border-b">
            <td>{{ r.date }}</td><td>{{ r.voucher_no }}</td><td>{{ r.narration }}</td>
            <td class="text-right">{{ r.debit ? n2(r.debit) : '' }}</td><td class="text-right">{{ r.credit ? n2(r.credit) : '' }}</td>
            <td class="text-right font-semibold">{{ n2(r.balance) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- E-way -->
    <div v-if="tab === 'eway'" class="pp-card overflow-x-auto">
      <table class="w-full text-sm">
        <thead><tr class="border-b"><th>Date</th><th>Bill</th><th>Party</th><th>E-Way No</th><th>Dest</th></tr></thead>
        <tbody>
          <tr v-for="b in ewayRows" :key="b.id" class="border-b">
            <td>{{ b.date }}</td><td>{{ b.bill_no }}</td><td>{{ b.party_name }}</td><td class="font-mono">{{ b.eway }}</td><td>{{ b.dest }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Activity -->
    <div v-if="tab === 'activity'" class="space-y-3">
      <div class="flex flex-wrap gap-2">
        <input v-model="activitySearch" class="pp-input max-w-xs" placeholder="Search activity…" />
        <select v-model="activityEntityFilter" class="pp-input max-w-[160px]">
          <option value="all">All types</option>
          <option value="invoice">Invoices</option>
          <option value="purchase">Purchases</option>
          <option value="party">Parties</option>
          <option value="item">Items</option>
        </select>
        <span class="ml-auto self-center text-sm text-slate-400">{{ filteredActivity.length }} records</span>
      </div>
      <div class="pp-card overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th class="text-left p-3">Time</th>
              <th class="text-left p-3">Action</th>
              <th class="text-left p-3">Type</th>
              <th class="text-left p-3">Summary</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in pagedActivity" :key="a.id" class="border-t border-slate-100 hover:bg-slate-50">
              <td class="p-3 text-slate-400 whitespace-nowrap text-xs">{{ a.created_at.slice(0,16).replace('T',' ') }}</td>
              <td class="p-3">
                <span :class="['pp-badge', ACTION_COLOR[a.action] || 'bg-slate-100 text-slate-600']">{{ a.action }}</span>
              </td>
              <td class="p-3 text-slate-600 capitalize">{{ a.entity_type }}</td>
              <td class="p-3 text-slate-700">{{ a.summary }}</td>
            </tr>
            <tr v-if="!pagedActivity.length">
              <td colspan="4" class="p-8 text-center text-slate-400">No activity logged yet</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="activityTotalPages > 1" class="flex items-center justify-center gap-2">
        <button class="pp-btn pp-btn-ghost !py-1.5" :disabled="activityPage <= 1" @click="activityPage--">← Prev</button>
        <span class="text-sm text-slate-500">Page {{ activityPage }} / {{ activityTotalPages }}</span>
        <button class="pp-btn pp-btn-ghost !py-1.5" :disabled="activityPage >= activityTotalPages" @click="activityPage++">Next →</button>
      </div>
    </div>

    <!-- Deleted -->
    <div v-if="tab === 'deleted'" class="space-y-3">
      <div class="flex flex-wrap gap-1">
        <button
          v-for="t in [['all','All'],['bills','Bills'],['parties','Parties'],['items','Items'],['purchases','Purchases'],['templates','Templates']]"
          :key="t[0]"
          :class="['px-3 py-1 rounded-lg text-xs font-semibold', deletedTab === t[0] ? 'bg-accent text-white' : 'bg-slate-100']"
          @click="deletedTab = t[0] as typeof deletedTab"
        >{{ t[1] }}</button>
      </div>
      <div class="pp-card overflow-x-auto">
        <table class="w-full text-sm">
          <thead><tr class="border-b"><th>Type</th><th>Name</th><th>Date</th><th class="text-right">Action</th></tr></thead>
          <tbody>
            <tr v-for="r in filteredDeleted" :key="r.id + r.entity" class="border-b">
              <td>{{ r.type }}</td><td>{{ r.name }}</td><td>{{ r.date.slice(0, 10) }}</td>
              <td class="text-right"><button class="pp-btn pp-btn-success !py-1 text-xs" @click="restoreDeleted(r)">Restore</button></td>
            </tr>
          </tbody>
        </table>
        <p v-if="!filteredDeleted.length" class="p-6 text-center text-slate-400">No deleted records in this tab</p>
      </div>
    </div>
  </div>
</template>
