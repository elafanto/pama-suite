<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useBrowserBack } from '@/composables/useBrowserBack'

const { goBack } = useBrowserBack('/settings')
import { db } from '@/data/db'
import { useFirmStore } from '@/stores/firm'
import { usePartyStore } from '@/stores/parties'
import { useItemStore } from '@/stores/items'
import { useInvoiceStore } from '@/stores/invoices'
import { usePurchaseStore } from '@/stores/purchases'
import { restoreAttachment } from '@/services/documentAttachments'

interface DeletedRow {
  type: 'party' | 'item' | 'invoice' | 'purchase' | 'firm' | 'document'
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
  firm:     { icon: '🏢', label: 'Firm',     cls: 'bg-violet-100 text-violet-700' },
  document: { icon: '📎', label: 'Document', cls: 'bg-slate-200 text-slate-700' },
}

const filtered = computed(() =>
  typeFilter.value === 'all' ? rows.value : rows.value.filter((r) => r.type === typeFilter.value),
)

async function loadDeleted() {
  loading.value = true
  const fid = firm.activeFirmId
  const onlyDel = <T extends { is_deleted: boolean; firm_id: string }>(arr: T[]) =>
    arr.filter((r) => r.is_deleted && r.firm_id === fid)

  const [dParties, dItems, dInvoices, dPurchases, dFirms, dDocs] = await Promise.all([
    db.parties.toArray(),
    db.items.toArray(),
    db.invoices.toArray(),
    db.purchases.toArray(),
    firm.deletedFirms(),
    db.document_attachments.where('firm_id').equals(fid).filter((r) => r.is_deleted).toArray(),
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
  for (const f of dFirms)
    out.push({ type: 'firm', id: f.id, label: f.name, sub: `${f.gst || 'No GST'} · ${f.city || '—'}`, deletedAt: f.updated_at })
  for (const doc of dDocs)
    out.push({
      type: 'document',
      id: doc.id,
      label: doc.stored_name,
      sub: `${doc.entity_type} · ${doc.party_name} · orig: ${doc.original_name}`,
      deletedAt: doc.updated_at,
    })

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
    else if (row.type === 'firm') await firm.restore(row.id)
    else if (row.type === 'document') await restoreAttachment(row.id)
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
    <button
      type="button"
      class="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-accent mb-3"
      @click="goBack"
    >
      ← Back
    </button>
    <header class="mb-5">
      <h1 class="text-2xl font-bold text-navy">♻️ Recycle Bin</h1>
      <p class="text-sm text-slate-500">Deleted firms, parties, items, invoices, purchases &amp; bill scan files — restore anytime.</p>
    </header>

    <div class="flex gap-2 mb-4 flex-wrap">
      <select v-model="typeFilter" class="pp-input max-w-[180px]">
        <option value="all">All types</option>
        <option value="party">Parties</option>
        <option value="item">Items</option>
        <option value="invoice">Invoices</option>
        <option value="purchase">Purchases</option>
        <option value="document">Bill files</option>
        <option value="firm">Firms</option>
      </select>
    </div>

    <div v-if="loading" class="text-center py-12 text-slate-400">Loading…</div>
    <div v-else-if="!filtered.length" class="text-center py-12 text-slate-400">Recycle bin empty.</div>
    <div v-else class="space-y-2">
      <div
        v-for="row in filtered"
        :key="`${row.type}-${row.id}`"
        class="pp-card p-4 flex flex-col sm:flex-row sm:items-center gap-3"
      >
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span :class="['pp-badge text-[10px]', TYPE_META[row.type].cls]">{{ TYPE_META[row.type].icon }} {{ TYPE_META[row.type].label }}</span>
            <span class="text-xs text-slate-400">{{ fmt(row.deletedAt) }}</span>
          </div>
          <div class="font-semibold text-navy truncate">{{ row.label }}</div>
          <div class="text-xs text-slate-500 truncate">{{ row.sub }}</div>
        </div>
        <button
          class="pp-btn pp-btn-primary !py-1.5 shrink-0"
          :disabled="busyId === row.id"
          @click="restore(row)"
        >
          {{ busyId === row.id ? '…' : 'Restore' }}
        </button>
      </div>
    </div>
  </div>
</template>
