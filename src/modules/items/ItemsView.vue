<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue'
import PpModal from '@/components/PpModal.vue'
import { useItemStore, type NewItem } from '@/stores/items'
import type { Item } from '@/types/models'

const store = useItemStore()
const search = ref('')
const showModal = ref(false)
const editingId = ref<string | null>(null)

const UNITS = ['PCS', 'KG', 'MTR', 'NOS', 'BOX', 'SET', 'SQM', 'DOZEN']

const blank = (): NewItem => ({
  name: '', unit: 'PCS', hsn: '', gst: 18, rate: 0, size: '', gsm: '', bf: '',
  track_stock: true, opening_stock: 0, reorder_level: 0, purchase_rate: 0,
})
const form = reactive<NewItem>(blank())

const filtered = computed(() => {
  const q = search.value.toLowerCase().trim()
  if (!q) return store.list
  return store.list.filter((i) => i.name.toLowerCase().includes(q) || i.hsn.toLowerCase().includes(q))
})

function openAdd() {
  editingId.value = null
  Object.assign(form, blank())
  showModal.value = true
}
function openEdit(i: Item) {
  editingId.value = i.id
  Object.assign(form, {
    name: i.name, unit: i.unit, hsn: i.hsn, gst: i.gst, rate: i.rate,
    size: i.size, gsm: i.gsm, bf: i.bf,
    track_stock: i.track_stock !== false, opening_stock: i.opening_stock || 0,
    reorder_level: i.reorder_level || 0, purchase_rate: i.purchase_rate || 0,
  })
  showModal.value = true
}
async function save() {
  if (!form.name.trim()) return alert('Name required')
  if (editingId.value) await store.update(editingId.value, { ...form })
  else await store.add({ ...form })
  showModal.value = false
}
async function del(i: Item) {
  if (confirm(`Delete "${i.name}"?`)) await store.remove(i.id)
}

onMounted(store.load)
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">
    <header class="flex items-center justify-between gap-3 mb-5 flex-wrap">
      <div>
        <h1 class="text-2xl font-bold text-navy">Items</h1>
        <p class="text-sm text-slate-500">Products &amp; services catalogue</p>
      </div>
      <button class="pp-btn pp-btn-primary" @click="openAdd">+ Add Item</button>
    </header>

    <div class="flex gap-2 mb-4 flex-wrap">
      <input v-model="search" class="pp-input max-w-xs" placeholder="Search name / HSN…" />
      <span class="ml-auto self-center text-sm text-slate-400">{{ filtered.length }} items</span>
    </div>

    <div class="pp-card overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-slate-500 text-xs uppercase">
          <tr>
            <th class="text-left font-semibold px-4 py-2.5">Name</th>
            <th class="text-left font-semibold px-4 py-2.5 hidden sm:table-cell">HSN</th>
            <th class="text-right font-semibold px-4 py-2.5">Rate</th>
            <th class="text-center font-semibold px-4 py-2.5 hidden sm:table-cell">Unit</th>
            <th class="text-center font-semibold px-4 py-2.5">GST%</th>
            <th class="text-right font-semibold px-4 py-2.5">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="filtered.length === 0">
            <td colspan="6" class="text-center text-slate-400 py-10">
              <div class="text-4xl mb-2">📦</div>No items yet. Click “Add Item”.
            </td>
          </tr>
          <tr v-for="i in filtered" :key="i.id" class="border-t border-slate-100 hover:bg-slate-50">
            <td class="px-4 py-2.5 font-semibold text-navy">{{ i.name }}<span v-if="i.size" class="text-slate-400 font-normal text-xs ml-1">({{ i.size }})</span></td>
            <td class="px-4 py-2.5 hidden sm:table-cell text-slate-600">{{ i.hsn || '—' }}</td>
            <td class="px-4 py-2.5 text-right text-slate-700 tabular-nums">₹{{ i.rate.toLocaleString('en-IN') }}</td>
            <td class="px-4 py-2.5 text-center hidden sm:table-cell text-slate-600">{{ i.unit }}</td>
            <td class="px-4 py-2.5 text-center text-slate-600">{{ i.gst }}%</td>
            <td class="px-4 py-2.5 text-right whitespace-nowrap">
              <button class="pp-btn pp-btn-ghost !px-2 !py-1 mr-1" @click="openEdit(i)">✏️</button>
              <button class="pp-btn pp-btn-danger !px-2 !py-1" @click="del(i)">🗑️</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <PpModal v-if="showModal" :title="editingId ? 'Edit Item' : 'Add Item'" @close="showModal = false">
      <div class="space-y-3">
        <div>
          <label class="pp-label">Name *</label>
          <input v-model="form.name" class="pp-input" placeholder="Kraft Paper / Corrugated Box" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="pp-label">HSN</label><input v-model="form.hsn" class="pp-input" placeholder="48191000" /></div>
          <div><label class="pp-label">Unit</label>
            <select v-model="form.unit" class="pp-input">
              <option v-for="u in UNITS" :key="u" :value="u">{{ u }}</option>
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="pp-label">Rate (₹)</label><input v-model.number="form.rate" type="number" class="pp-input" /></div>
          <div><label class="pp-label">GST %</label><input v-model.number="form.gst" type="number" class="pp-input" /></div>
        </div>
        <div class="border-t border-slate-200 pt-3">
          <label class="flex items-center gap-2 mb-2 cursor-pointer">
            <input type="checkbox" v-model="form.track_stock" class="w-4 h-4" />
            <span class="pp-label !mb-0 !text-slate-600">Track stock for this item</span>
          </label>
          <div v-if="form.track_stock" class="grid grid-cols-3 gap-3">
            <div><label class="pp-label">Opening Qty</label><input v-model.number="form.opening_stock" type="number" class="pp-input" /></div>
            <div><label class="pp-label">Reorder Level</label><input v-model.number="form.reorder_level" type="number" class="pp-input" /></div>
            <div><label class="pp-label">Buy Rate (₹)</label><input v-model.number="form.purchase_rate" type="number" class="pp-input" /></div>
          </div>
        </div>
        <div class="border-t border-slate-200 pt-3">
          <div class="pp-label !text-slate-600 !mb-2">Box attributes (optional)</div>
          <div class="grid grid-cols-3 gap-3">
            <div><label class="pp-label">Size</label><input v-model="form.size" class="pp-input" placeholder="25x30" /></div>
            <div><label class="pp-label">GSM</label><input v-model="form.gsm" class="pp-input" /></div>
            <div><label class="pp-label">BF</label><input v-model="form.bf" class="pp-input" /></div>
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button class="pp-btn pp-btn-ghost" @click="showModal = false">Cancel</button>
          <button class="pp-btn pp-btn-primary" @click="save">Save</button>
        </div>
      </div>
    </PpModal>
  </div>
</template>
