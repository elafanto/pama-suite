<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useFirmStore } from '@/stores/firm'
import { useItemStore } from '@/stores/items'
import { useInvoiceStore } from '@/stores/invoices'
import { usePurchaseStore } from '@/stores/purchases'
import { computeStock, stockSummary, type StockRow, type StockStatus } from '@/services/stock'

const firm = useFirmStore()
const items = useItemStore()
const invoices = useInvoiceStore()
const purchases = usePurchaseStore()

const search = ref('')
const statusFilter = ref<'all' | StockStatus>('all')
const loading = ref(true)

const rows = computed(() =>
  computeStock(items.list, purchases.list, invoices.list, firm.activeFirmId),
)
const summary = computed(() => stockSummary(rows.value))

const filtered = computed(() => {
  const q = search.value.toLowerCase().trim()
  return rows.value.filter((r) => {
    if (statusFilter.value !== 'all' && r.status !== statusFilter.value) return false
    return !q || r.name.toLowerCase().includes(q)
  })
})

const STATUS_META: Record<StockStatus, { label: string; cls: string }> = {
  out: { label: 'Out of stock', cls: 'bg-red-100 text-red-700' },
  low: { label: 'Low', cls: 'bg-amber-100 text-amber-700' },
  ok:  { label: 'In stock', cls: 'bg-emerald-100 text-emerald-700' },
}

function n(v: number) { return (v || 0).toLocaleString('en-IN') }
function rowCls(r: StockRow) {
  return r.status === 'out' ? 'bg-red-50' : r.status === 'low' ? 'bg-amber-50' : ''
}

onMounted(async () => {
  await firm.load()
  await Promise.all([items.load(), invoices.load(), purchases.load()])
  loading.value = false
})
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">
    <header class="mb-5">
      <h1 class="text-2xl font-bold text-navy">📊 Inventory</h1>
      <p class="text-sm text-slate-500">Live stock = opening + purchased − sold. Set reorder levels on Items.</p>
    </header>

    <!-- Summary cards -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
      <div class="pp-card p-4">
        <div class="text-xs font-semibold text-slate-500 uppercase">Tracked Items</div>
        <div class="text-2xl font-bold text-navy mt-1">{{ summary.skus }}</div>
      </div>
      <div class="pp-card p-4 border-l-4 border-amber-400">
        <div class="text-xs font-semibold text-slate-500 uppercase">Low Stock</div>
        <div class="text-2xl font-bold text-amber-600 mt-1">{{ summary.lowStock }}</div>
      </div>
      <div class="pp-card p-4 border-l-4 border-red-400">
        <div class="text-xs font-semibold text-slate-500 uppercase">Out of Stock</div>
        <div class="text-2xl font-bold text-red-600 mt-1">{{ summary.outOfStock }}</div>
      </div>
      <div class="pp-card p-4 border-l-4 border-emerald-400">
        <div class="text-xs font-semibold text-slate-500 uppercase">Stock Value</div>
        <div class="text-2xl font-bold text-emerald-700 mt-1">₹ {{ n(summary.totalValue) }}</div>
      </div>
    </div>

    <div class="flex gap-2 mb-4 flex-wrap">
      <input v-model="search" class="pp-input max-w-xs" placeholder="Search item…" />
      <select v-model="statusFilter" class="pp-input max-w-[160px]">
        <option value="all">All status</option>
        <option value="ok">In stock</option>
        <option value="low">Low</option>
        <option value="out">Out of stock</option>
      </select>
      <span class="ml-auto self-center text-sm text-slate-400">{{ filtered.length }} items</span>
    </div>

    <div v-if="loading" class="pp-card p-10 text-center text-slate-400">Loading…</div>

    <div v-else class="pp-card overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-slate-500 text-xs uppercase">
          <tr>
            <th class="text-left font-semibold px-4 py-2.5">Item</th>
            <th class="text-right font-semibold px-4 py-2.5 hidden sm:table-cell">Opening</th>
            <th class="text-right font-semibold px-4 py-2.5 hidden md:table-cell">In</th>
            <th class="text-right font-semibold px-4 py-2.5 hidden md:table-cell">Out</th>
            <th class="text-right font-semibold px-4 py-2.5">On Hand</th>
            <th class="text-right font-semibold px-4 py-2.5 hidden lg:table-cell">Value</th>
            <th class="text-center font-semibold px-4 py-2.5">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="filtered.length === 0">
            <td colspan="7" class="text-center text-slate-400 py-10">
              <div class="text-4xl mb-2">📦</div>No tracked items. Add items &amp; set "Track stock".
            </td>
          </tr>
          <tr v-for="r in filtered" :key="r.itemId" :class="['border-t border-slate-100', rowCls(r)]">
            <td class="px-4 py-2.5 font-semibold text-navy">{{ r.name }} <span class="text-slate-400 font-normal text-xs">{{ r.unit }}</span></td>
            <td class="px-4 py-2.5 text-right hidden sm:table-cell text-slate-500 tabular-nums">{{ n(r.opening) }}</td>
            <td class="px-4 py-2.5 text-right hidden md:table-cell text-emerald-600 tabular-nums">+{{ n(r.purchased) }}</td>
            <td class="px-4 py-2.5 text-right hidden md:table-cell text-blue-600 tabular-nums">−{{ n(r.sold) }}</td>
            <td class="px-4 py-2.5 text-right font-bold tabular-nums" :class="r.status==='out' ? 'text-red-600' : r.status==='low' ? 'text-amber-600' : 'text-navy'">{{ n(r.onHand) }}</td>
            <td class="px-4 py-2.5 text-right hidden lg:table-cell text-slate-600 tabular-nums">₹ {{ n(r.value) }}</td>
            <td class="px-4 py-2.5 text-center">
              <span :class="['pp-badge', STATUS_META[r.status].cls]">{{ STATUS_META[r.status].label }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
