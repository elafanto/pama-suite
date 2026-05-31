<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useInvoiceStore } from '@/stores/invoices'
import { usePurchaseStore } from '@/stores/purchases'
import { usePartyStore } from '@/stores/parties'
import { useItemStore } from '@/stores/items'
import { useFirmStore } from '@/stores/firm'
import { outstandingAging } from '@/services/reports'
import type { Invoice } from '@/types/models'

const invoiceStore = useInvoiceStore()
const purchaseStore = usePurchaseStore()
const partiesStore = usePartyStore()
const itemsStore = useItemStore()
const firmStore = useFirmStore()

onMounted(async () => {
  await Promise.all([invoiceStore.load(), purchaseStore.load(), partiesStore.load(), itemsStore.load()])
})

const today = new Date().toISOString().slice(0, 10)
const monthPrefix = today.slice(0, 7)

const stats = computed(() => {
  const firmId = firmStore.activeFirmId
  const bills = invoiceStore.list.filter(b => b.firm_id === firmId && !b.is_deleted)
  const purchases = purchaseStore.list.filter(p => p.firm_id === firmId && !p.is_deleted)
  const aging = outstandingAging(bills)
  const totalOut = aging.reduce((s, r) => s + r.total, 0)
  const unpaidCount = bills.filter(b => (b.grand_total - b.amt_paid) > 0.01).length
  const salesToday = bills.filter(b => b.date === today).reduce((s, b) => s + b.grand_total, 0)
  const salesMonth = bills.filter(b => b.date.startsWith(monthPrefix)).reduce((s, b) => s + b.grand_total, 0)
  const purchasesToday = purchases.filter(p => p.date === today).reduce((s, p) => s + p.grand_total, 0)
  const purchasesMonth = purchases.filter(p => p.date.startsWith(monthPrefix)).reduce((s, p) => s + p.grand_total, 0)
  return {
    bills: bills.length,
    parties: partiesStore.list.filter(p => p.firm_id === firmId).length,
    items: itemsStore.list.filter(i => i.firm_id === firmId).length,
    outstanding: totalOut,
    unpaidCount,
    salesToday,
    salesMonth,
    purchasesToday,
    purchasesMonth,
  }
})

const recentBills = computed(() => {
  const firmId = firmStore.activeFirmId
  return [...invoiceStore.list]
    .filter(b => b.firm_id === firmId && !b.is_deleted)
    .sort((a, b) => (b.created_at || b.date).localeCompare(a.created_at || a.date))
    .slice(0, 8) as Invoice[]
})

const tools = [
  { to: '/billing',   icon: '🧾', name: 'Billing',    desc: 'GST invoices & sales',  color: 'bg-emerald-100' },
  { to: '/purchases', icon: '📥', name: 'Purchases',  desc: 'Vendor bills & stock',  color: 'bg-blue-100' },
  { to: '/reports',   icon: '📈', name: 'Reports',    desc: 'GSTR-1 & outstanding',  color: 'bg-rose-100' },
  { to: '/boxcalc',   icon: '🧮', name: 'BoxCalc',    desc: 'Corrugated costing',    color: 'bg-indigo-100' },
  { to: '/banking',   icon: '🏦', name: 'Banking',    desc: 'RTGS / NEFT emails',    color: 'bg-orange-100' },
  { to: '/accounting',icon: '📊', name: 'Accounting', desc: 'Ledger & reports',      color: 'bg-violet-100' },
]

function n2(n: number) {
  return (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">
    <header class="mb-6">
      <h1 class="text-2xl font-bold text-navy">Dashboard</h1>
      <p class="text-sm text-slate-500 mt-1">{{ firmStore.activeFirm?.name || 'Pama Business Suite' }}</p>
    </header>

    <div class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
      <div class="pp-card p-4 border-l-4 border-emerald-500">
        <div class="text-xs font-bold text-slate-500 uppercase">Sales Today</div>
        <div class="text-xl font-bold text-emerald-700 mt-1">₹ {{ n2(stats.salesToday) }}</div>
      </div>
      <div class="pp-card p-4 border-l-4 border-teal-500">
        <div class="text-xs font-bold text-slate-500 uppercase">Sales (Month)</div>
        <div class="text-xl font-bold text-teal-800 mt-1">₹ {{ n2(stats.salesMonth) }}</div>
      </div>
      <div class="pp-card p-4 border-l-4 border-blue-500">
        <div class="text-xs font-bold text-slate-500 uppercase">Purchases Today</div>
        <div class="text-xl font-bold text-blue-700 mt-1">₹ {{ n2(stats.purchasesToday) }}</div>
      </div>
      <div class="pp-card p-4 border-l-4 border-indigo-500">
        <div class="text-xs font-bold text-slate-500 uppercase">Purchases (Month)</div>
        <div class="text-xl font-bold text-indigo-800 mt-1">₹ {{ n2(stats.purchasesMonth) }}</div>
      </div>
      <div class="pp-card p-4 border-l-4 border-accent">
        <div class="text-xs font-bold text-slate-500 uppercase">Total Bills</div>
        <div class="text-2xl font-bold text-navy mt-1">{{ stats.bills }}</div>
      </div>
      <div class="pp-card p-4 border-l-4 border-emerald-500">
        <div class="text-xs font-bold text-slate-500 uppercase">Parties</div>
        <div class="text-2xl font-bold text-navy mt-1">{{ stats.parties }}</div>
      </div>
      <div class="pp-card p-4 border-l-4 border-indigo-500">
        <div class="text-xs font-bold text-slate-500 uppercase">Items</div>
        <div class="text-2xl font-bold text-navy mt-1">{{ stats.items }}</div>
      </div>
      <div class="pp-card p-4 border-l-4 border-red-500">
        <div class="text-xs font-bold text-slate-500 uppercase">Outstanding</div>
        <div class="text-2xl font-bold text-red-600 mt-1">₹ {{ n2(stats.outstanding) }}</div>
        <div class="text-xs text-slate-400">{{ stats.unpaidCount }} unpaid</div>
      </div>
    </div>

    <h2 class="text-sm font-bold text-slate-500 uppercase mb-3">Recent Bills</h2>
    <div class="pp-card overflow-hidden mb-8">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-xs uppercase text-slate-500">
          <tr><th class="text-left p-3">Date</th><th class="text-left p-3">Bill No</th><th class="text-left p-3">Customer</th><th class="text-right p-3">Total</th><th class="text-center p-3">Status</th></tr>
        </thead>
        <tbody>
          <tr v-for="b in recentBills" :key="b.id" class="border-t border-slate-100">
            <td class="p-3 text-slate-500">{{ b.date }}</td>
            <td class="p-3 font-semibold text-navy">{{ b.bill_no }}</td>
            <td class="p-3">{{ b.party_name }}</td>
            <td class="p-3 text-right">₹ {{ n2(b.grand_total) }}</td>
            <td class="p-3 text-center"><span class="pp-badge text-xs">{{ b.pay_status }}</span></td>
          </tr>
          <tr v-if="!recentBills.length"><td colspan="5" class="p-6 text-center text-slate-400">No bills yet</td></tr>
        </tbody>
      </table>
    </div>

    <h2 class="text-sm font-bold text-slate-500 uppercase mb-3">Quick Access</h2>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <RouterLink v-for="t in tools" :key="t.to" :to="t.to"
        class="pp-card p-5 flex items-start gap-4 hover:shadow-card-lg hover:-translate-y-0.5 transition no-underline">
        <div :class="['w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0', t.color]">{{ t.icon }}</div>
        <div>
          <h2 class="font-bold text-navy">{{ t.name }}</h2>
          <p class="text-sm text-slate-500">{{ t.desc }}</p>
        </div>
      </RouterLink>
    </div>
  </div>
</template>
