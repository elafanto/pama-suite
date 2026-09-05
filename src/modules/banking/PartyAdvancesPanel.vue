<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import PpModal from '@/components/PpModal.vue'
import { useFirmStore } from '@/stores/firm'
import { usePartyStore } from '@/stores/parties'
import { usePartyAdvanceStore } from '@/stores/partyAdvances'
import type { PartyAdvanceDirection, PartyAdvanceMode } from '@/types/models'

const firmStore = useFirmStore()
const partyStore = usePartyStore()
const advanceStore = usePartyAdvanceStore()

const busy = ref(false)
const filter = ref<'all' | 'in' | 'out' | 'open'>('open')
const search = ref('')
const showModal = ref(false)

const form = reactive({
  party_id: null as string | null,
  party_name: '',
  direction: 'in' as PartyAdvanceDirection,
  date: new Date().toISOString().slice(0, 10),
  amount: 0,
  mode: 'bank' as PartyAdvanceMode,
  narration: '',
  postVoucher: true,
})

onMounted(async () => {
  busy.value = true
  try {
    await Promise.all([partyStore.load(), advanceStore.load()])
  } finally {
    busy.value = false
  }
})

const parties = computed(() =>
  partyStore.list.filter((p) => !p.is_deleted && p.firm_id === firmStore.activeFirmId),
)

const rows = computed(() => {
  const q = search.value.trim().toLowerCase()
  return advanceStore.list
    .filter((a) => a.firm_id === firmStore.activeFirmId && !a.is_deleted && a.status !== 'reversed')
    .filter((a) => {
      if (filter.value === 'in') return a.direction === 'in'
      if (filter.value === 'out') return a.direction === 'out'
      if (filter.value === 'open') return a.status === 'open' || a.status === 'partial'
      return true
    })
    .filter((a) => {
      if (!q) return true
      return `${a.party_name} ${a.narration}`.toLowerCase().includes(q)
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))
})

const totals = computed(() => {
  const openIn = rows.value.filter((a) => a.direction === 'in').reduce((s, a) => s + (a.remaining || 0), 0)
  const openOut = rows.value.filter((a) => a.direction === 'out').reduce((s, a) => s + (a.remaining || 0), 0)
  return { openIn, openOut, count: rows.value.length }
})

function n2(n: number) {
  return (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function openRecord() {
  form.party_id = null
  form.party_name = ''
  form.direction = 'in'
  form.date = new Date().toISOString().slice(0, 10)
  form.amount = 0
  form.mode = 'bank'
  form.narration = ''
  form.postVoucher = true
  showModal.value = true
}

function onPartyPick() {
  const p = parties.value.find((x) => x.name === form.party_name)
  form.party_id = p?.id || null
  if (p) {
    const isVendor = (p.roles || []).includes('vendor') && !(p.roles || []).includes('customer')
    if (isVendor) form.direction = 'out'
    else if ((p.roles || []).includes('customer')) form.direction = 'in'
  }
}

async function saveAdvance() {
  if (!form.party_name.trim()) return alert('Party select / type karein')
  if (!(form.amount > 0)) return alert('Amount 0 se zyada hona chahiye')
  busy.value = true
  try {
    onPartyPick()
    await advanceStore.record({
      party_id: form.party_id,
      party_name: form.party_name.trim(),
      direction: form.direction,
      date: form.date,
      amount: form.amount,
      mode: form.mode,
      narration: form.narration,
      postVoucher: form.postVoucher,
    })
    showModal.value = false
    alert('Advance recorded.')
  } catch (err: any) {
    alert(err?.message || 'Advance save fail')
  } finally {
    busy.value = false
  }
}

async function reverseAdvance(id: string, partyName: string) {
  if (!confirm(`Advance reverse / delete karein?\n\n${partyName}`)) return
  busy.value = true
  try {
    await advanceStore.reverse(id)
  } catch (err: any) {
    alert(err?.message || 'Reverse fail')
  } finally {
    busy.value = false
  }
}

async function refresh() {
  busy.value = true
  try {
    await advanceStore.load()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="pp-card p-4 flex flex-wrap items-center gap-3">
      <div>
        <h2 class="font-semibold text-navy">Party Advances</h2>
        <p class="text-xs text-slate-500">
          Bina bill ke customer receipt / vendor payment — baad me invoice ya purchase pe apply karo.
        </p>
      </div>
      <button type="button" class="pp-btn pp-btn-ghost !py-1.5 text-xs ml-auto" :disabled="busy" @click="refresh">Refresh</button>
      <button type="button" class="pp-btn pp-btn-primary !py-1.5 text-xs" :disabled="busy" @click="openRecord">+ Record Advance</button>
    </div>

    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <div class="pp-card p-3 text-center">
        <div class="text-xs text-slate-500">Listed</div>
        <div class="text-lg font-bold text-navy">{{ totals.count }}</div>
      </div>
      <div class="pp-card p-3 text-center">
        <div class="text-xs text-slate-500">Customer advance open</div>
        <div class="text-lg font-bold text-emerald-700">₹{{ n2(totals.openIn) }}</div>
      </div>
      <div class="pp-card p-3 text-center">
        <div class="text-xs text-slate-500">Vendor advance open</div>
        <div class="text-lg font-bold text-orange-700">₹{{ n2(totals.openOut) }}</div>
      </div>
    </div>

    <div class="pp-card p-4 flex flex-wrap items-center gap-3">
      <select v-model="filter" class="pp-input max-w-[160px] text-sm">
        <option value="open">Open / partial</option>
        <option value="all">All</option>
        <option value="in">Customer (in)</option>
        <option value="out">Vendor (out)</option>
      </select>
      <input v-model="search" type="search" class="pp-input flex-1 min-w-[12rem] text-sm" placeholder="Party, narration…" />
    </div>

    <div class="pp-card overflow-x-auto">
      <table class="w-full text-sm min-w-[880px]">
        <thead class="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th class="p-3 text-left">Date</th>
            <th class="p-3 text-center">Type</th>
            <th class="p-3 text-left">Party</th>
            <th class="p-3 text-right">Amount</th>
            <th class="p-3 text-right">Remaining</th>
            <th class="p-3 text-center">Status</th>
            <th class="p-3 text-left">Mode</th>
            <th class="p-3 text-left">Narration</th>
            <th class="p-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody class="divide-y">
          <tr v-for="row in rows" :key="row.id">
            <td class="p-3 font-mono text-xs whitespace-nowrap">{{ row.date }}</td>
            <td class="p-3 text-center">
              <span
                class="pp-badge text-[10px]"
                :class="row.direction === 'in' ? 'bg-emerald-100 text-emerald-800' : 'bg-orange-100 text-orange-800'"
              >{{ row.direction === 'in' ? 'IN' : 'OUT' }}</span>
            </td>
            <td class="p-3">{{ row.party_name }}</td>
            <td class="p-3 text-right font-mono">₹{{ n2(row.amount) }}</td>
            <td class="p-3 text-right font-mono font-semibold">₹{{ n2(row.remaining) }}</td>
            <td class="p-3 text-center">
              <span class="pp-badge text-[10px] bg-slate-100 text-slate-700">{{ row.status }}</span>
            </td>
            <td class="p-3 text-xs uppercase">{{ row.mode }}</td>
            <td class="p-3 text-xs text-slate-600 max-w-[12rem] truncate" :title="row.narration">{{ row.narration || '—' }}</td>
            <td class="p-3 text-right">
              <button
                v-if="row.status === 'open' && !(row.applications || []).length"
                type="button"
                class="pp-btn pp-btn-ghost !py-1 !px-2 text-xs text-rose-700"
                :disabled="busy"
                @click="reverseAdvance(row.id, row.party_name)"
              >↩️</button>
              <span v-else class="text-xs text-slate-400">—</span>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="9" class="p-8 text-center text-slate-400">Koi advance nahi. “Record Advance” se pehli entry banao.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <PpModal v-if="showModal" title="Record Party Advance" @close="showModal = false">
      <div class="space-y-3">
        <div>
          <label class="pp-label">Party</label>
          <input v-model="form.party_name" list="partyAdvanceParties" class="pp-input" placeholder="Customer / vendor name" @change="onPartyPick" />
          <datalist id="partyAdvanceParties">
            <option v-for="p in parties" :key="p.id" :value="p.name" />
          </datalist>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="pp-label">Type</label>
            <select v-model="form.direction" class="pp-input">
              <option value="in">Customer advance (paisa ANDAR)</option>
              <option value="out">Vendor advance (paisa BAHAR)</option>
            </select>
          </div>
          <div>
            <label class="pp-label">Date</label>
            <input v-model="form.date" type="date" class="pp-input" />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="pp-label">Amount (₹)</label>
            <input v-model.number="form.amount" type="number" min="1" step="0.01" class="pp-input" />
          </div>
          <div>
            <label class="pp-label">Mode</label>
            <select v-model="form.mode" class="pp-input">
              <option value="bank">Bank</option>
              <option value="cash">Cash</option>
            </select>
          </div>
        </div>
        <div>
          <label class="pp-label">Narration</label>
          <input v-model="form.narration" class="pp-input" placeholder="Optional note" />
        </div>
        <label class="flex items-center gap-2 text-sm text-slate-700">
          <input v-model="form.postVoucher" type="checkbox" class="rounded" />
          Accounting voucher post karo
        </label>
        <div class="flex gap-2 justify-end pt-2">
          <button type="button" class="pp-btn pp-btn-ghost" @click="showModal = false">Cancel</button>
          <button type="button" class="pp-btn pp-btn-primary" :disabled="busy" @click="saveAdvance">Save</button>
        </div>
      </div>
    </PpModal>
  </div>
</template>
