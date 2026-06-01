<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { db } from '@/data/db'
import { useFirmStore } from '@/stores/firm'
import { usePartyStore } from '@/stores/parties'
import { useItemStore } from '@/stores/items'
import { useInvoiceStore } from '@/stores/invoices'
import { usePurchaseStore } from '@/stores/purchases'

interface DeletedRow {
  type: 'party' | 'item' | 'invoice' | 'purchase'
  id: string
  label: string
  sub: string
  deletedAt: string
}

const firm = useFirmStore()
const parties = usePartyStore()
const items = useItemStore()
const invoices = useInvoiceStore()
const purchases = usePurchaseStore()

const rows = ref<DeletedRow[]>([])
const loading = ref(true)
const busyId = ref<string | null>(null)
const typeFilter = ref<'all' | DeletedRow['type']>('all')

const TYPE_META: Record<DeletedRow['type'], { icon: string; label: string; cls: string }> = {
  party:    { icon: '👥', label: 'Party',    cls: 'bg-cyan-100 text-cyan-700' },
  item:     { icon: '📦', label: 'Item',     cls: 'bg-amber-100 text-amber-700' },
  invoice:  { icon: '🧾', label: 'Invoice',  cls: 'bg-emerald-100 text-emerald-700' },
  purchase: { icon: '📥', label: 'Purchase', cls: 'bg-blue-100 text-blue-700' },
}

const filtered = computed(() =>
  typeFilter.value === 'all' ? rows.value : rows.value.filter((r) => r.type === typeFilter.value),
)

async function loadDeleted() {
  loading.value = true
  const fid = firm.activeFirmId
  const onlyDel = <T extends { is_deleted: boolean; firm_id: string }>(arr: T[]) =>
    arr.filter((r) => r.is_deleted && r.firm_id === fid)

  const [dParties, dItems, dInvoices, dPurchases] = await Promise.all([
    db.parties.toArray(),
    db.items.toArray(),
    db.invoices.toArray(),
    db.purchases.toArray(),
  ])

  const out: DeletedRow[] = []
  for (const p of onlyDel(dParties))
    out.push({ type: 'party', id: p.id, label: p.name, sub: (p.roles || []).join(', ') || '—', deletedAt: p.updated_at })
  for (const i of onlyDel(dItems))
    out.push({ type: 'item', id: i.id, label: i.name, sub: `₹${i.rate} · ${i.unit}`, deletedAt: i.updated_at })
  for (const inv of onlyDel(dInvoices))
    out.push({ type: 'invoice', id: inv.id, label: inv.bill_no || 'Invoice', sub: `${inv.party_name} · ₹${inv.grand_total}`, deletedAt: inv.updated_at })
  for (const pu of onlyDel(dPurchases))
    out.push({ type: 'purchase', id: pu.id, label: pu.bill_no || 'Purchase', sub: `${pu.supplier_name} · ₹${pu.grand_total}`, deletedAt: pu.updated_at })

  out.sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''))
  rows.value = out
  loading.value = false
}

async function restore(row: DeletedRow) {
  busyId.value = row.id
  try {
    if (row.type === 'party') await parties.restore(row.id)
    else if (row.type === 'item') await items.restore(row.id)
    else if (row.type === 'invoice') await invoices.restore(row.id)
    else if (row.type === 'purchase') await purchases.restore(row.id)
    await loadDeleted()
  } finally {
    busyId.value = null
  }
}

function fmt(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

onMounted(async () => { await firm.load(); await loadDeleted() })
</script>

<template>
  <div class="p-6 max-w-5xl mx-auto">
    <header class="mb-5">
      <h1 class="text-2xl font-bold text-navy">♻️ Recycle Bin</h1>
      <p class="text-sm text-slate-500">Deleted parties, items, invoices &amp; purchases — restore anytime.</p>
    </header>

    <div class="flex gap-2 mb-4 flex-wrap">
      <select v-model="typeFilter" class="pp-input max-w-[180px]">
        <option value="all">All types</option>
        <option value="party">Parties</option>
        <option value="item">Items</option>
        <option value="invoice">Invoices</option>
        <option value="purchase">Purchases</option>
      </select>
      <span class="ml-auto self-center text-sm text-slate-400">{{ filtered.length }} deleted</span>
    </div>

    <div v-if="loading" class="pp-card p-10 text-center text-slate-400">Loading…</div>

    <div v-else class="pp-card overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-slate-500 text-xs uppercase">
          <tr>
            <th class="text-left font-semibold px-4 py-2.5">Type</th>
            <th class="text-left font-semibold px-4 py-2.5">Name</th>
            <th class="text-left font-semibold px-4 py-2.5 hidden sm:table-cell">Details</th>
            <th class="text-left font-semibold px-4 py-2.5 hidden md:table-cell">Deleted</th>
            <th class="text-right font-semibold px-4 py-2.5">Action</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="filtered.length === 0">
            <td colspan="5" class="text-center text-slate-400 py-10">
              <div class="text-4xl mb-2">🗑️</div>Recycle Bin is empty.
            </td>
          </tr>
          <tr v-for="r in filtered" :key="r.type + r.id" class="border-t border-slate-100 hover:bg-slate-50">
            <td class="px-4 py-2.5">
              <span :class="['pp-badge', TYPE_META[r.type].cls]">{{ TYPE_META[r.type].icon }} {{ TYPE_META[r.type].label }}</span>
            </td>
            <td class="px-4 py-2.5 font-semibold text-navy">{{ r.label }}</td>
            <td class="px-4 py-2.5 hidden sm:table-cell text-slate-600">{{ r.sub }}</td>
            <td class="px-4 py-2.5 hidden md:table-cell text-slate-500">{{ fmt(r.deletedAt) }}</td>
            <td class="px-4 py-2.5 text-right">
              <button class="pp-btn pp-btn-primary !py-1.5" :disabled="busyId === r.id" @click="restore(r)">
                {{ busyId === r.id ? 'Restoring…' : '♻️ Restore' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="text-xs text-slate-400 mt-3">
      Restoring an invoice/purchase also re-posts its accounting ledger entries.
    </p>
  </div>
</template>
