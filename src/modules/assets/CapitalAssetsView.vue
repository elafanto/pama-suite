<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useCapitalAssetStore } from '@/stores/assets'
import { CAPITAL_CATEGORY_LABELS } from '@/services/assets'
import type { CapitalAssetStatus, CapitalCategory } from '@/types/models'

const router = useRouter()
const store = useCapitalAssetStore()

const search = ref('')
const categoryFilter = ref<'all' | CapitalCategory>('all')
const statusFilter = ref<'all' | CapitalAssetStatus>('all')
const loading = ref(true)

const filtered = computed(() => {
  const q = search.value.toLowerCase().trim()
  return store.list.filter((asset) => {
    if (categoryFilter.value !== 'all' && asset.category !== categoryFilter.value) return false
    if (statusFilter.value !== 'all' && asset.status !== statusFilter.value) return false
    if (!q) return true
    const hay = `${asset.name} ${asset.asset_tag || ''} ${asset.purchase_bill_no} ${asset.supplier_name}`.toLowerCase()
    return hay.includes(q)
  })
})

const summary = computed(() => {
  const active = store.list.filter((a) => a.status === 'active')
  return {
    total: store.list.length,
    active: active.length,
    value: Math.round(active.reduce((sum, a) => sum + (a.amount || 0), 0) * 100) / 100,
  }
})

const STATUS_META: Record<CapitalAssetStatus, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-emerald-100 text-emerald-800' },
  disposed: { label: 'Disposed', cls: 'bg-slate-200 text-slate-700' },
  written_off: { label: 'Written off', cls: 'bg-rose-100 text-rose-700' },
}

function n2(v: number) {
  return (v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function goPurchases() {
  router.push('/purchases')
}

async function changeStatus(assetId: string, status: CapitalAssetStatus) {
  await store.setStatus(assetId, status)
}

onMounted(async () => {
  loading.value = true
  await store.load()
  loading.value = false
})
</script>

<template>
  <div class="pp-page">
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-bold text-navy">Capital Assets</h1>
        <p class="text-sm text-slate-500 mt-1">Machinery aur capital goods — consumable inventory se alag.</p>
      </div>
      <button type="button" class="pp-btn pp-btn-primary" @click="goPurchases">+ Purchase se add karo</button>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
      <div class="pp-card p-4">
        <div class="text-xs text-slate-500 uppercase tracking-wide">Total assets</div>
        <div class="text-2xl font-bold text-navy mt-1">{{ summary.total }}</div>
      </div>
      <div class="pp-card p-4">
        <div class="text-xs text-slate-500 uppercase tracking-wide">Active</div>
        <div class="text-2xl font-bold text-emerald-700 mt-1">{{ summary.active }}</div>
      </div>
      <div class="pp-card p-4">
        <div class="text-xs text-slate-500 uppercase tracking-wide">Active book value</div>
        <div class="text-2xl font-bold text-navy mt-1">₹ {{ n2(summary.value) }}</div>
      </div>
    </div>

    <div class="pp-card p-4 mb-4">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <input v-model="search" type="search" class="pp-input" placeholder="Search name, tag, bill no..." />
        <select v-model="categoryFilter" class="pp-input">
          <option value="all">All categories</option>
          <option v-for="(label, key) in CAPITAL_CATEGORY_LABELS" :key="key" :value="key">{{ label }}</option>
        </select>
        <select v-model="statusFilter" class="pp-input">
          <option value="all">All status</option>
          <option value="active">Active</option>
          <option value="disposed">Disposed</option>
          <option value="written_off">Written off</option>
        </select>
      </div>
    </div>

    <div v-if="loading" class="text-center py-12 text-slate-500">Loading...</div>
    <div v-else-if="filtered.length === 0" class="pp-card p-8 text-center text-slate-500">
      <p class="mb-2">Abhi koi capital asset nahi hai.</p>
      <p class="text-sm">Purchase bill me line par <strong>Capital Goods</strong> mark karo (machinery, furniture, vehicle, etc.).</p>
    </div>
    <div v-else class="pp-card overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b bg-slate-50 text-left text-xs uppercase text-slate-500">
            <th class="py-3 px-3">Asset</th>
            <th class="py-3 px-3">Category</th>
            <th class="py-3 px-3">Purchase</th>
            <th class="py-3 px-3">Supplier</th>
            <th class="py-3 px-3 text-right">Qty</th>
            <th class="py-3 px-3 text-right">Amount</th>
            <th class="py-3 px-3">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="asset in filtered" :key="asset.id" class="border-b last:border-0 hover:bg-slate-50/80">
            <td class="py-3 px-3">
              <div class="font-medium text-navy">{{ asset.name }}</div>
              <div v-if="asset.asset_tag" class="text-xs text-slate-500">Tag: {{ asset.asset_tag }}</div>
            </td>
            <td class="py-3 px-3">{{ CAPITAL_CATEGORY_LABELS[asset.category] }}</td>
            <td class="py-3 px-3">
              <div>{{ asset.purchase_bill_no }}</div>
              <div class="text-xs text-slate-500">{{ asset.purchase_date }}</div>
            </td>
            <td class="py-3 px-3">{{ asset.supplier_name }}</td>
            <td class="py-3 px-3 text-right font-mono">{{ asset.qty }} {{ asset.unit }}</td>
            <td class="py-3 px-3 text-right font-mono font-medium">₹ {{ n2(asset.amount) }}</td>
            <td class="py-3 px-3">
              <select
                :value="asset.status"
                class="pp-input !py-1 text-xs min-w-[7rem]"
                @change="changeStatus(asset.id, ($event.target as HTMLSelectElement).value as CapitalAssetStatus)"
              >
                <option value="active">Active</option>
                <option value="disposed">Disposed</option>
                <option value="written_off">Written off</option>
              </select>
              <span class="ml-2 inline-block px-2 py-0.5 rounded text-[10px] font-semibold" :class="STATUS_META[asset.status].cls">
                {{ STATUS_META[asset.status].label }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
