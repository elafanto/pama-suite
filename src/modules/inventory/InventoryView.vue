<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import PpModal from '@/components/PpModal.vue'
import { useFirmStore } from '@/stores/firm'
import { useItemStore } from '@/stores/items'
import { useInvoiceStore } from '@/stores/invoices'
import { usePurchaseStore } from '@/stores/purchases'
import { computeStock, stockSummary, type StockRow, type StockStatus } from '@/services/stock'
import { createManualAdjustment, listItemStockMovements } from '@/services/inventoryLedger'
import type { ItemStockMovement } from '@/types/models'

const firm = useFirmStore()
const items = useItemStore()
const invoices = useInvoiceStore()
const purchases = usePurchaseStore()

const search = ref('')
const statusFilter = ref<'all' | StockStatus>('all')
const loading = ref(true)
const movements = ref<ItemStockMovement[]>([])
const showAdjustModal = ref(false)
const adjustmentMsg = ref('')
const savingAdjustment = ref(false)
const adjustForm = ref({
  itemId: '',
  date: new Date().toISOString().slice(0, 10),
  mode: 'add' as 'add' | 'remove',
  qty: 0,
  reasonCode: 'stock_count',
  notes: '',
})

const rows = computed(() =>
  computeStock(items.list, purchases.list, invoices.list, firm.activeFirmId, movements.value),
)
const summary = computed(() => stockSummary(rows.value))
const itemById = computed(() => new Map(items.list.map((i) => [i.id, i])))

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
function signed(v: number) { return `${v > 0 ? '+' : ''}${n(v)}` }
function rowCls(r: StockRow) {
  return r.status === 'out' ? 'bg-red-50' : r.status === 'low' ? 'bg-amber-50' : ''
}

const selectedRow = computed(() => rows.value.find((r) => r.itemId === adjustForm.value.itemId) || null)
const adjustmentDelta = computed(() => {
  const qty = Math.abs(Number(adjustForm.value.qty) || 0)
  return adjustForm.value.mode === 'remove' ? -qty : qty
})
const adjustedPreview = computed(() => (selectedRow.value?.onHand || 0) + adjustmentDelta.value)
const adjustmentInvalid = computed(() => {
  if (!adjustForm.value.itemId) return 'Select an item'
  if (!adjustForm.value.date) return 'Date is required'
  if (!Number.isFinite(Number(adjustForm.value.qty)) || Number(adjustForm.value.qty) <= 0) return 'Quantity must be greater than zero'
  if (selectedRow.value && adjustedPreview.value < 0) return 'Adjustment cannot make stock negative'
  return ''
})
const recentMovements = computed(() => movements.value.slice(0, 25))

async function loadMovements() {
  movements.value = await listItemStockMovements(firm.activeFirmId, { limit: 200 })
}

function openAdjust(row?: StockRow) {
  adjustmentMsg.value = ''
  adjustForm.value = {
    itemId: row?.itemId || rows.value[0]?.itemId || '',
    date: new Date().toISOString().slice(0, 10),
    mode: 'add',
    qty: 0,
    reasonCode: 'stock_count',
    notes: '',
  }
  showAdjustModal.value = true
}

async function saveAdjustment() {
  adjustmentMsg.value = ''
  if (adjustmentInvalid.value) {
    adjustmentMsg.value = adjustmentInvalid.value
    return
  }
  savingAdjustment.value = true
  try {
    await createManualAdjustment({
      firmId: firm.activeFirmId,
      itemId: adjustForm.value.itemId,
      date: adjustForm.value.date,
      qtyDelta: adjustmentDelta.value,
      reasonCode: adjustForm.value.reasonCode,
      notes: adjustForm.value.notes,
      currentOnHand: selectedRow.value?.onHand,
    })
    await loadMovements()
    showAdjustModal.value = false
  } catch (err: any) {
    adjustmentMsg.value = err?.message || 'Adjustment failed'
  } finally {
    savingAdjustment.value = false
  }
}

function movementItemName(m: ItemStockMovement) {
  return itemById.value.get(m.item_id)?.name || 'Unknown item'
}

onMounted(async () => {
  await firm.load()
  await Promise.all([items.load(), invoices.load(), purchases.load()])
  await loadMovements()
  loading.value = false
})
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">
    <header class="mb-5 flex flex-wrap items-start gap-3 justify-between">
      <div>
        <h1 class="text-2xl font-bold text-navy">📊 Inventory</h1>
        <p class="text-sm text-slate-500">Live stock = opening + purchased − sold + manual adjustments. Set reorder levels on Items.</p>
      </div>
      <button class="pp-btn pp-btn-primary" @click="openAdjust()">Adjust Stock</button>
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
            <th class="text-right font-semibold px-4 py-2.5 hidden lg:table-cell">Adjust</th>
            <th class="text-right font-semibold px-4 py-2.5">On Hand</th>
            <th class="text-right font-semibold px-4 py-2.5 hidden xl:table-cell">Value</th>
            <th class="text-center font-semibold px-4 py-2.5">Status</th>
            <th class="text-right font-semibold px-4 py-2.5">Action</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="filtered.length === 0">
            <td colspan="9" class="text-center text-slate-400 py-10">
              <div class="text-4xl mb-2">📦</div>No tracked items. Add items &amp; set "Track stock".
            </td>
          </tr>
          <tr v-for="r in filtered" :key="r.itemId" :class="['border-t border-slate-100', rowCls(r)]">
            <td class="px-4 py-2.5 font-semibold text-navy">{{ r.name }} <span class="text-slate-400 font-normal text-xs">{{ r.unit }}</span></td>
            <td class="px-4 py-2.5 text-right hidden sm:table-cell text-slate-500 tabular-nums">{{ n(r.opening) }}</td>
            <td class="px-4 py-2.5 text-right hidden md:table-cell text-emerald-600 tabular-nums">+{{ n(r.purchased) }}</td>
            <td class="px-4 py-2.5 text-right hidden md:table-cell text-blue-600 tabular-nums">−{{ n(r.sold) }}</td>
            <td class="px-4 py-2.5 text-right hidden lg:table-cell tabular-nums" :class="r.adjusted < 0 ? 'text-red-600' : r.adjusted > 0 ? 'text-emerald-600' : 'text-slate-400'">{{ signed(r.adjusted) }}</td>
            <td class="px-4 py-2.5 text-right font-bold tabular-nums" :class="r.status==='out' ? 'text-red-600' : r.status==='low' ? 'text-amber-600' : 'text-navy'">{{ n(r.onHand) }}</td>
            <td class="px-4 py-2.5 text-right hidden xl:table-cell text-slate-600 tabular-nums">₹ {{ n(r.value) }}</td>
            <td class="px-4 py-2.5 text-center">
              <span :class="['pp-badge', STATUS_META[r.status].cls]">{{ STATUS_META[r.status].label }}</span>
            </td>
            <td class="px-4 py-2.5 text-right">
              <button class="pp-btn pp-btn-ghost !py-1 !px-2 text-xs" @click="openAdjust(r)">Adjust</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <section class="pp-card mt-5 overflow-x-auto">
      <div class="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div>
          <h2 class="font-bold text-navy">Recent Stock Movements</h2>
          <p class="text-xs text-slate-500">Manual adjustments are included in current stock totals.</p>
        </div>
        <span class="text-xs text-slate-400">{{ recentMovements.length }} shown</span>
      </div>
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-slate-500 text-xs uppercase">
          <tr>
            <th class="text-left font-semibold px-4 py-2.5">Date</th>
            <th class="text-left font-semibold px-4 py-2.5">Item</th>
            <th class="text-right font-semibold px-4 py-2.5">Qty</th>
            <th class="text-left font-semibold px-4 py-2.5 hidden md:table-cell">Reason</th>
            <th class="text-left font-semibold px-4 py-2.5 hidden lg:table-cell">Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="recentMovements.length === 0">
            <td colspan="5" class="text-center text-slate-400 py-8">No stock adjustments yet.</td>
          </tr>
          <tr v-for="m in recentMovements" :key="m.id" class="border-t border-slate-100">
            <td class="px-4 py-2.5 text-slate-500 whitespace-nowrap">{{ m.date }}</td>
            <td class="px-4 py-2.5 font-semibold text-navy">{{ movementItemName(m) }}</td>
            <td class="px-4 py-2.5 text-right font-semibold tabular-nums" :class="m.qty_delta < 0 ? 'text-red-600' : 'text-emerald-600'">{{ signed(m.qty_delta) }} {{ m.unit }}</td>
            <td class="px-4 py-2.5 hidden md:table-cell text-slate-600">{{ m.reason_code }}</td>
            <td class="px-4 py-2.5 hidden lg:table-cell text-slate-500">{{ m.notes || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <PpModal v-if="showAdjustModal" title="Manual Stock Adjustment" @close="showAdjustModal = false">
      <div class="space-y-3">
        <div>
          <label class="pp-label">Item *</label>
          <select v-model="adjustForm.itemId" class="pp-input">
            <option value="">Select item</option>
            <option v-for="r in rows" :key="r.itemId" :value="r.itemId">{{ r.name }} ({{ n(r.onHand) }} {{ r.unit }})</option>
          </select>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="pp-label">Date *</label>
            <input v-model="adjustForm.date" type="date" class="pp-input" />
          </div>
          <div>
            <label class="pp-label">Action</label>
            <select v-model="adjustForm.mode" class="pp-input">
              <option value="add">Add stock</option>
              <option value="remove">Remove stock</option>
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="pp-label">Quantity *</label>
            <input v-model.number="adjustForm.qty" type="number" min="0" step="0.01" class="pp-input" />
          </div>
          <div>
            <label class="pp-label">Reason</label>
            <select v-model="adjustForm.reasonCode" class="pp-input">
              <option value="stock_count">Stock count</option>
              <option value="damage">Damage</option>
              <option value="wastage">Wastage</option>
              <option value="sample">Sample</option>
              <option value="correction">Correction</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <div v-if="selectedRow" class="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm">
          <div class="flex justify-between">
            <span class="text-slate-500">Current stock</span>
            <strong>{{ n(selectedRow.onHand) }} {{ selectedRow.unit }}</strong>
          </div>
          <div class="flex justify-between mt-1">
            <span class="text-slate-500">Adjusted stock</span>
            <strong :class="adjustedPreview < 0 ? 'text-red-600' : 'text-navy'">{{ n(adjustedPreview) }} {{ selectedRow.unit }}</strong>
          </div>
        </div>
        <div>
          <label class="pp-label">Notes</label>
          <textarea v-model="adjustForm.notes" class="pp-input min-h-[80px]" placeholder="Optional details"></textarea>
        </div>
        <p v-if="adjustmentMsg || adjustmentInvalid" class="text-sm text-red-600">{{ adjustmentMsg || adjustmentInvalid }}</p>
        <div class="flex justify-end gap-2 pt-2">
          <button class="pp-btn pp-btn-ghost" @click="showAdjustModal = false">Cancel</button>
          <button class="pp-btn pp-btn-primary" :disabled="!!adjustmentInvalid || savingAdjustment" @click="saveAdjustment">
            {{ savingAdjustment ? 'Saving…' : 'Save Adjustment' }}
          </button>
        </div>
      </div>
    </PpModal>
  </div>
</template>
