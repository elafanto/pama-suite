<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useInvoiceStore } from '@/stores/invoices'
import { usePurchaseStore } from '@/stores/purchases'
import { usePartyStore } from '@/stores/parties'
import { useItemStore } from '@/stores/items'
import { useFirmStore } from '@/stores/firm'
import { outstandingAging } from '@/services/reports'
import { computeStock, stockSummary } from '@/services/stock'
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
const prevMonthPrefix = (() => {
  const d = new Date(); d.setMonth(d.getMonth() - 1)
  return d.toISOString().slice(0, 7)
})()

const stats = computed(() => {
  const firmId = firmStore.activeFirmId
  const bills = invoiceStore.list.filter(b => b.firm_id === firmId && !b.is_deleted)
  const purchases = purchaseStore.list.filter(p => p.firm_id === firmId && !p.is_deleted)
  const aging = outstandingAging(bills)
  const totalOut = aging.reduce((s, r) => s + r.total, 0)
  const payable = purchases.reduce((s, p) => s + Math.max(0, (p.grand_total || 0) - (p.amt_paid || 0)), 0)
  const unpaidCount = bills.filter(b => (b.grand_total - b.amt_paid) > 0.01).length
  const salesToday = bills.filter(b => b.date === today).reduce((s, b) => s + b.grand_total, 0)
  const salesMonth = bills.filter(b => b.date.startsWith(monthPrefix)).reduce((s, b) => s + b.grand_total, 0)
  const salesPrevMonth = bills.filter(b => b.date.startsWith(prevMonthPrefix)).reduce((s, b) => s + b.grand_total, 0)
  const purchasesToday = purchases.filter(p => p.date === today).reduce((s, p) => s + p.grand_total, 0)
  const purchasesMonth = purchases.filter(p => p.date.startsWith(monthPrefix)).reduce((s, p) => s + p.grand_total, 0)
  const stock = stockSummary(computeStock(itemsStore.list, purchases, bills, firmId))
  const momPct = salesPrevMonth > 0 ? Math.round(((salesMonth - salesPrevMonth) / salesPrevMonth) * 100) : null
  return {
    bills: bills.length,
    parties: partiesStore.list.filter(p => p.firm_id === firmId && !p.is_deleted).length,
    items: itemsStore.list.filter(i => i.firm_id === firmId && !i.is_deleted).length,
    outstanding: totalOut,
    payable,
    unpaidCount,
    salesToday,
    salesMonth,
    salesPrevMonth,
    momPct,
    purchasesToday,
    purchasesMonth,
    netMonth: salesMonth - purchasesMonth,
    lowStock: stock.lowStock + stock.outOfStock,
    stockValue: stock.totalValue,
  }
})

const topCustomers = computed(() => {
  const firmId = firmStore.activeFirmId
  const bills = invoiceStore.list.filter(b => b.firm_id === firmId && !b.is_deleted)
  return outstandingAging(bills).slice(0, 5)
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

    <!-- Headline KPIs -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
      <div class="pp-card p-4 bg-gradient-to-br from-navy to-primary text-white">
        <div class="text-xs font-semibold text-sky-200 uppercase">Net (This Month)</div>
        <div class="text-2xl font-extrabold mt-1" :class="stats.netMonth < 0 ? 'text-red-300' : 'text-white'">₹ {{ n2(stats.netMonth) }}</div>
        <div class="text-[11px] text-sky-300 mt-0.5">Sales − Purchases</div>
      </div>
      <div class="pp-card p-4">
        <div class="text-xs font-semibold text-slate-500 uppercase">Sales (Month)</div>
        <div class="text-2xl font-extrabold text-teal-800 mt-1">₹ {{ n2(stats.salesMonth) }}</div>
        <div v-if="stats.momPct !== null" class="text-[11px] mt-0.5 font-semibold"
             :class="stats.momPct >= 0 ? 'text-emerald-600' : 'text-red-500'">
          {{ stats.momPct >= 0 ? '▲' : '▼' }} {{ Math.abs(stats.momPct) }}% vs last month
        </div>
        <div v-else class="text-[11px] text-slate-400 mt-0.5">no prior month data</div>
      </div>
      <div class="pp-card p-4 border-l-4 border-red-400">
        <div class="text-xs font-semibold text-slate-500 uppercase">Receivable</div>
        <div class="text-2xl font-extrabold text-red-600 mt-1">₹ {{ n2(stats.outstanding) }}</div>
        <div class="text-[11px] text-slate-400 mt-0.5">{{ stats.unpaidCount }} unpaid bills</div>
      </div>
      <div class="pp-card p-4 border-l-4 border-orange-400">
        <div class="text-xs font-semibold text-slate-500 uppercase">Payable</div>
        <div class="text-2xl font-extrabold text-orange-600 mt-1">₹ {{ n2(stats.payable) }}</div>
        <RouterLink to="/inventory" class="text-[11px] text-accent hover:underline mt-0.5 inline-block">
          {{ stats.lowStock }} items low/out of stock →
        </RouterLink>
      </div>
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
      <div class="pp-card p-4 border-l-4 border-emerald-500">
        <div class="text-xs font-bold text-slate-500 uppercase">Sales Today</div>
        <div class="text-xl font-bold text-emerald-700 mt-1">₹ {{ n2(stats.salesToday) }}</div>
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
      <div class="pp-card p-4 border-l-4 border-amber-400">
        <div class="text-xs font-bold text-slate-500 uppercase">Stock Value</div>
        <div class="text-2xl font-bold text-navy mt-1">₹ {{ n2(stats.stockValue) }}</div>
        <RouterLink to="/inventory" class="text-[11px] text-accent hover:underline">View inventory →</RouterLink>
      </div>
    </div>

    <div v-if="topCustomers.length" class="mb-8">
      <h2 class="text-sm font-bold text-slate-500 uppercase mb-3">Top Outstanding Customers</h2>
      <div class="pp-card overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-xs uppercase text-slate-500">
            <tr><th class="text-left p-3">Customer</th><th class="text-right p-3 hidden sm:table-cell">Bills</th><th class="text-right p-3 hidden md:table-cell">90+ days</th><th class="text-right p-3">Outstanding</th></tr>
          </thead>
          <tbody>
            <tr v-for="c in topCustomers" :key="c.customer" class="border-t border-slate-100">
              <td class="p-3 font-semibold text-navy">{{ c.customer }}</td>
              <td class="p-3 text-right hidden sm:table-cell text-slate-500">{{ c.billCount }}</td>
              <td class="p-3 text-right hidden md:table-cell" :class="c.d90plus > 0 ? 'text-red-600 font-semibold' : 'text-slate-400'">₹ {{ n2(c.d90plus) }}</td>
              <td class="p-3 text-right font-bold text-red-600">₹ {{ n2(c.total) }}</td>
            </tr>
          </tbody>
        </table>
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
