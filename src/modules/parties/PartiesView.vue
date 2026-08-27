<script setup lang="ts">
import { ref, computed, onMounted, reactive, watch } from 'vue'
import { RouterLink } from 'vue-router'
import PpModal from '@/components/PpModal.vue'
import SegmentedFieldInput from '@/components/SegmentedFieldInput.vue'
import { usePartyStore, type NewParty } from '@/stores/parties'
import type { Party, PartyRole } from '@/types/models'
import { validateGstinForForm, formatGstin } from '@/services/gst'
import { fetchIfscDetails, findPartyBankDetails, isValidIfsc, toUpperTrim } from '@/services/partyLookup'
import type { PartyMergeField, PartyMergePreview } from '@/services/partyMerge'

const store = usePartyStore()
const search = ref('')
const roleFilter = ref<'all' | PartyRole>('all')
const showModal = ref(false)
const editingId = ref<string | null>(null)
const deleteTarget = ref<Party | null>(null)
const deleteConfirmText = ref('')
const showMergeModal = ref(false)
const mergeWinnerId = ref('')
const mergeLoserId = ref('')
const mergePreview = ref<PartyMergePreview | null>(null)
const mergeBusy = ref(false)
const mergeFieldPicks = reactive<Record<string, string>>({})
const gstHint = ref('')
const gstHintOk = ref(true)
const ifscStatus = ref<'idle' | 'fetching' | 'success' | 'error'>('idle')
let ifscTimer: ReturnType<typeof setTimeout> | null = null

type UpperPartyField = 'name' | 'acname' | 'acno' | 'bank' | 'ifsc'

const blank = (): NewParty => ({
  name: '', roles: ['customer'], gst: '', phone: '', email: '', addr: '',
  city: '', pin: '', state: '', is_consumer: false,
  bank: '', acno: '', ifsc: '', acname: '',
})
const form = reactive<NewParty>(blank())

const filtered = computed(() => {
  const q = search.value.toLowerCase().trim()
  return store.list.filter((p) => {
    if (roleFilter.value !== 'all' && !p.roles.includes(roleFilter.value)) return false
    if (!q) return true
    return p.name.toLowerCase().includes(q) || p.gst.toLowerCase().includes(q) || p.phone.includes(q)
  })
})
const deleteConfirmed = computed(() => {
  const target = deleteTarget.value
  return !!target && deleteConfirmText.value.trim() === target.name
})

function resetFormHints() {
  gstHint.value = ''
  gstHintOk.value = true
  ifscStatus.value = 'idle'
  if (ifscTimer) clearTimeout(ifscTimer)
}

function onUpperInput(field: UpperPartyField, e: Event) {
  const v = toUpperTrim((e.target as HTMLInputElement).value)
  form[field] = v
  if (field === 'ifsc') scheduleIfscLookup()
  if (field === 'acno' && toUpperTrim(form.ifsc).length === 11) scheduleIfscLookup()
}

function onGstChange(value: string) {
  form.gst = value
  applyGstValidation()
}

function applyGstValidation() {
  const result = validateGstinForForm(form.gst)
  gstHint.value = result.message
  gstHintOk.value = result.valid || !form.gst.trim()
  if (result.valid && result.stateCode) form.state = result.stateCode
}

function onGstBlur() {
  applyGstValidation()
}

function scheduleIfscLookup() {
  const code = toUpperTrim(form.ifsc)
  if (code.length < 11) {
    ifscStatus.value = 'idle'
    return
  }
  if (!isValidIfsc(code)) {
    ifscStatus.value = 'error'
    return
  }
  ifscStatus.value = 'fetching'
  if (ifscTimer) clearTimeout(ifscTimer)
  ifscTimer = setTimeout(() => void lookupIfscNow(), 400)
}

async function lookupIfscNow() {
  const code = toUpperTrim(form.ifsc)
  if (!isValidIfsc(code)) {
    ifscStatus.value = code.length >= 11 ? 'error' : 'idle'
    return
  }
  const saved = findPartyBankDetails(code, store.list, form.acno)
  if (saved) {
    form.bank = saved.bankLine
    ifscStatus.value = 'success'
    return
  }
  form.bank = ''
  ifscStatus.value = 'fetching'
  const details = await fetchIfscDetails(code, { acno: form.acno, parties: store.list })
  if (details) {
    form.bank = details.bankLine
    ifscStatus.value = 'success'
  } else {
    ifscStatus.value = 'error'
  }
}

function onIfscBlur() {
  void lookupIfscNow()
}

function openAdd() {
  editingId.value = null
  Object.assign(form, blank())
  resetFormHints()
  showModal.value = true
}
function openEdit(p: Party) {
  editingId.value = p.id
  Object.assign(form, {
    name: p.name, roles: [...p.roles], gst: p.gst, phone: p.phone, email: p.email,
    addr: p.addr, city: p.city, pin: p.pin, state: p.state, is_consumer: p.is_consumer,
    bank: p.bank, acno: p.acno, ifsc: p.ifsc, acname: p.acname,
  })
  resetFormHints()
  if (form.gst.trim()) applyGstValidation()
  showModal.value = true
}
function toggleRole(r: PartyRole) {
  const i = form.roles.indexOf(r)
  if (i > -1) form.roles.splice(i, 1)
  else form.roles.push(r)
}
async function save() {
  if (!form.name.trim()) return alert('Name required')
  if (form.roles.length === 0) form.roles.push('customer')
  if (form.gst && !form.state) form.state = form.gst.slice(0, 2)
  const payload = { ...form, gst: formatGstin(form.gst) }
  if (editingId.value) await store.update(editingId.value, payload)
  else await store.add(payload)
  showModal.value = false
}
function openDelete(p: Party) {
  deleteTarget.value = p
  deleteConfirmText.value = ''
}
function closeDelete() {
  deleteTarget.value = null
  deleteConfirmText.value = ''
}
async function confirmDelete() {
  if (!deleteTarget.value || !deleteConfirmed.value) return
  await store.remove(deleteTarget.value.id)
  closeDelete()
}

async function openMerge(seed?: Party) {
  mergeWinnerId.value = seed?.id || store.list[0]?.id || ''
  mergeLoserId.value = ''
  mergePreview.value = null
  Object.keys(mergeFieldPicks).forEach((k) => delete mergeFieldPicks[k])
  showMergeModal.value = true
  if (mergeWinnerId.value) await refreshMergePreview()
}

function closeMerge() {
  showMergeModal.value = false
  mergePreview.value = null
  mergeBusy.value = false
}

async function refreshMergePreview() {
  mergePreview.value = null
  if (!mergeWinnerId.value || !mergeLoserId.value || mergeWinnerId.value === mergeLoserId.value) return
  try {
    mergePreview.value = await store.previewMerge(mergeWinnerId.value, mergeLoserId.value)
    for (const field of mergePreview.value.conflicts) {
      if (!mergeFieldPicks[field]) mergeFieldPicks[field] = mergeWinnerId.value
    }
  } catch (err: any) {
    alert(err?.message || 'Merge preview fail')
  }
}

async function confirmMerge() {
  if (!mergeWinnerId.value || !mergeLoserId.value) return
  const preview = mergePreview.value
  if (!preview) return alert('Pehle dono parties select karo')
  if (preview.conflicts.includes('gst') && !mergeFieldPicks.gst) {
    return alert('GST conflict — Keep ya Merge party ka GST choose karo')
  }
  const ok = confirm(
    `Merge “${preview.loser.name}” → “${preview.winner.name}”?\n\n`
    + `${preview.invoices} invoices, ${preview.purchases} purchases, ${preview.jobs} jobs rewrite honge.\n`
    + `“${preview.loser.name}” Recycle Bin me chali jayegi.`,
  )
  if (!ok) return
  mergeBusy.value = true
  try {
    const result = await store.merge(mergeWinnerId.value, mergeLoserId.value, { ...mergeFieldPicks })
    closeMerge()
    alert(`Merge done — ${result.rewritten} records updated.`)
  } catch (err: any) {
    alert(err?.message || 'Merge fail')
  } finally {
    mergeBusy.value = false
  }
}

function conflictLabel(field: PartyMergeField) {
  return field.replace(/_/g, ' ').toUpperCase()
}

watch([mergeWinnerId, mergeLoserId], () => { void refreshMergePreview() })

onMounted(store.load)
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">
    <header class="flex items-center justify-between gap-3 mb-5 flex-wrap">
      <div>
        <h1 class="text-2xl font-bold text-navy">Parties</h1>
        <p class="text-sm text-slate-500">Customers, vendors &amp; beneficiaries — one list</p>
      </div>
      <div class="flex w-full flex-wrap gap-2 sm:w-auto">
        <RouterLink to="/recycle-bin" class="pp-btn pp-btn-ghost flex-1 justify-center sm:flex-none">
          Recycle Bin
        </RouterLink>
        <button class="pp-btn pp-btn-ghost flex-1 sm:flex-none" @click="openMerge()">Merge Parties</button>
        <button class="pp-btn pp-btn-primary flex-1 sm:flex-none" @click="openAdd">+ Add Party</button>
      </div>
    </header>

    <div class="flex gap-2 mb-4 flex-wrap">
      <input v-model="search" class="pp-input max-w-xs" placeholder="Search name / GST / phone…" />
      <select v-model="roleFilter" class="pp-input max-w-[160px]">
        <option value="all">All roles</option>
        <option value="customer">Customers</option>
        <option value="vendor">Vendors</option>
      </select>
      <span class="ml-auto self-center text-sm text-slate-400">{{ filtered.length }} parties</span>
    </div>

    <div class="pp-card overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-slate-500 text-xs uppercase">
          <tr>
            <th class="text-left font-semibold px-4 py-2.5">Name</th>
            <th class="text-left font-semibold px-4 py-2.5">Roles</th>
            <th class="text-left font-semibold px-4 py-2.5 hidden sm:table-cell">GST</th>
            <th class="text-left font-semibold px-4 py-2.5 hidden md:table-cell">Phone</th>
            <th class="text-left font-semibold px-4 py-2.5 hidden lg:table-cell">City</th>
            <th class="text-right font-semibold px-4 py-2.5">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="filtered.length === 0">
            <td colspan="6" class="text-center text-slate-400 py-10">
              <div class="text-4xl mb-2">👥</div>No parties yet. Click “Add Party”.
            </td>
          </tr>
          <tr v-for="p in filtered" :key="p.id" class="border-t border-slate-100 hover:bg-slate-50">
            <td class="px-4 py-2.5 font-semibold text-navy">{{ p.name }}</td>
            <td class="px-4 py-2.5">
              <span v-for="r in p.roles" :key="r"
                :class="['pp-badge mr-1', r === 'customer' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700']">
                {{ r }}
              </span>
            </td>
            <td class="px-4 py-2.5 hidden sm:table-cell font-mono text-sm font-semibold text-slate-700">{{ formatGstin(p.gst) || '—' }}</td>
            <td class="px-4 py-2.5 hidden md:table-cell text-slate-600">{{ p.phone || '—' }}</td>
            <td class="px-4 py-2.5 hidden lg:table-cell text-slate-600">{{ p.city || '—' }}</td>
            <td class="px-4 py-2.5 text-right whitespace-nowrap">
              <button class="pp-btn pp-btn-ghost !px-2 !py-1 mr-1" title="Merge into another party" @click="openMerge(p)">⇄</button>
              <button class="pp-btn pp-btn-ghost !px-2 !py-1 mr-1" @click="openEdit(p)">✏️</button>
              <button class="pp-btn pp-btn-danger !px-2 !py-1" @click="openDelete(p)">🗑️</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <PpModal
      v-if="showModal"
      :title="editingId ? 'Edit Party' : 'Add Party'"
      @close="showModal = false"
    >
      <div class="space-y-3">
        <div>
          <label class="pp-label">Name *</label>
          <input
            :value="form.name"
            class="pp-input uppercase"
            placeholder="M/s ABC Traders"
            @input="onUpperInput('name', $event)"
          />
        </div>
        <div>
          <label class="pp-label">Roles</label>
          <div class="flex gap-2">
            <button type="button" @click="toggleRole('customer')"
              :class="['pp-btn !py-1.5', form.roles.includes('customer') ? 'pp-btn-primary' : 'pp-btn-ghost']">Customer</button>
            <button type="button" @click="toggleRole('vendor')"
              :class="['pp-btn !py-1.5', form.roles.includes('vendor') ? 'pp-btn-primary' : 'pp-btn-ghost']">Vendor</button>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="pp-label">GST</label>
            <SegmentedFieldInput
              :model-value="form.gst"
              preset="gstin"
              aria-label="GSTIN"
              @update:model-value="onGstChange"
              @blur="onGstBlur"
            />
            <p
              v-if="gstHint"
              class="text-xs mt-1"
              :class="gstHintOk ? 'text-slate-500' : 'text-amber-700'"
            >
              {{ gstHint }}
            </p>
          </div>
          <div>
            <label class="pp-label">Phone</label>
            <SegmentedFieldInput
              v-model="form.phone"
              preset="mobile"
              aria-label="Mobile number"
            />
          </div>
        </div>
        <div><label class="pp-label">Address</label><input v-model="form.addr" class="pp-input" /></div>
        <div class="grid grid-cols-3 gap-3">
          <div><label class="pp-label">City</label><input v-model="form.city" class="pp-input" /></div>
          <div><label class="pp-label">PIN</label><input v-model="form.pin" class="pp-input" /></div>
          <div><label class="pp-label">State code</label><input v-model="form.state" class="pp-input" placeholder="05" /></div>
        </div>

        <div class="border-t border-slate-200 pt-3">
          <div class="pp-label-account !mb-2">Bank details (for RTGS/NEFT)</div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="pp-label-account">A/c Name</label>
              <input :value="form.acname" class="pp-input-account uppercase" @input="onUpperInput('acname', $event)" />
            </div>
            <div>
              <label class="pp-label-account">A/c No.</label>
              <input :value="form.acno" class="pp-input-account uppercase" @input="onUpperInput('acno', $event)" />
            </div>
            <div>
              <label class="pp-label-account">IFSC</label>
              <div class="relative">
                <input
                  :value="form.ifsc"
                  class="pp-input-account uppercase pr-8"
                  placeholder="HDFC0001234"
                  maxlength="11"
                  @input="onUpperInput('ifsc', $event)"
                  @blur="onIfscBlur"
                />
                <span
                  v-if="ifscStatus !== 'idle'"
                  class="absolute right-2 top-1/2 -translate-y-1/2 text-sm"
                  :class="{
                    'text-slate-400': ifscStatus === 'fetching',
                    'text-green-600': ifscStatus === 'success',
                    'text-rose-500': ifscStatus === 'error',
                  }"
                >
                  {{ ifscStatus === 'fetching' ? '⏳' : ifscStatus === 'success' ? '✓' : '✗' }}
                </span>
              </div>
            </div>
            <div>
              <label class="pp-label-account">Bank &amp; Branch</label>
              <input :value="form.bank" class="pp-input-account uppercase" @input="onUpperInput('bank', $event)" />
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button class="pp-btn pp-btn-ghost" @click="showModal = false">Cancel</button>
          <button class="pp-btn pp-btn-primary" @click="save">Save</button>
        </div>
      </div>
    </PpModal>

    <PpModal
      v-if="deleteTarget"
      title="Delete Party?"
      @close="closeDelete"
    >
      <div class="space-y-4">
        <div class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p class="font-semibold">This will move the party to Recycle Bin, not permanently delete it.</p>
          <p class="mt-1">Party can be restored later from Recycle Bin. Type the exact party name to confirm.</p>
          <RouterLink to="/recycle-bin" class="mt-2 inline-flex font-semibold text-red-800 underline" @click="closeDelete">
            Open Recycle Bin
          </RouterLink>
        </div>

        <div>
          <label class="pp-label">Type party name: <span class="font-semibold">{{ deleteTarget.name }}</span></label>
          <input
            v-model="deleteConfirmText"
            class="pp-input"
            autocomplete="off"
            :placeholder="deleteTarget.name"
          />
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button class="pp-btn pp-btn-ghost" @click="closeDelete">Cancel</button>
          <button class="pp-btn pp-btn-danger" :disabled="!deleteConfirmed" :class="{ 'opacity-50': !deleteConfirmed }" @click="confirmDelete">
            Move to Recycle Bin
          </button>
        </div>
      </div>
    </PpModal>

    <PpModal
      :show="showMergeModal"
      title="Merge Parties"
      @close="closeMerge"
    >
      <div class="space-y-4">
        <p class="text-sm text-slate-600">
          Merge-away party ki saari bills / jobs Keep party pe shift hongi. Merge-away soft-delete (Recycle Bin) me jayegi.
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="pp-label">Keep (Winner) *</label>
            <select v-model="mergeWinnerId" class="pp-input">
              <option value="">Select…</option>
              <option v-for="p in store.list" :key="p.id" :value="p.id" :disabled="p.id === mergeLoserId">{{ p.name }}</option>
            </select>
          </div>
          <div>
            <label class="pp-label">Merge away (Loser) *</label>
            <select v-model="mergeLoserId" class="pp-input">
              <option value="">Select…</option>
              <option v-for="p in store.list" :key="p.id" :value="p.id" :disabled="p.id === mergeWinnerId">{{ p.name }}</option>
            </select>
          </div>
        </div>

        <div v-if="mergePreview" class="rounded-lg border bg-slate-50 p-3 text-sm space-y-1">
          <div class="font-semibold text-navy">Will rewrite</div>
          <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-600">
            <span>Invoices</span><span class="font-mono text-right">{{ mergePreview.invoices }}</span>
            <span>Purchases</span><span class="font-mono text-right">{{ mergePreview.purchases }}</span>
            <span>Jobs</span><span class="font-mono text-right">{{ mergePreview.jobs }}</span>
            <span>Reels / Lots / Assets</span>
            <span class="font-mono text-right">{{ mergePreview.reels + mergePreview.consumableLots + mergePreview.capitalAssets }}</span>
            <span>Recipes</span><span class="font-mono text-right">{{ mergePreview.recipes }}</span>
          </div>
        </div>

        <div v-if="mergePreview?.conflicts.length" class="space-y-2">
          <div class="text-sm font-semibold text-amber-800">Field conflicts — choose Keep value</div>
          <div v-for="field in mergePreview.conflicts" :key="field" class="grid grid-cols-1 sm:grid-cols-[8rem_1fr] gap-2 items-center text-sm">
            <span class="text-slate-500 uppercase text-xs">{{ conflictLabel(field) }}</span>
            <select v-model="mergeFieldPicks[field]" class="pp-input !py-1">
              <option :value="mergePreview.winner.id">Keep: {{ String((mergePreview.winner as any)[field] || '—') }}</option>
              <option :value="mergePreview.loser.id">Merge: {{ String((mergePreview.loser as any)[field] || '—') }}</option>
            </select>
          </div>
        </div>

        <div class="flex justify-end gap-2 border-t pt-3">
          <button type="button" class="pp-btn pp-btn-ghost" :disabled="mergeBusy" @click="closeMerge">Cancel</button>
          <button
            type="button"
            class="pp-btn pp-btn-primary"
            :disabled="mergeBusy || !mergePreview"
            :class="{ 'opacity-50': mergeBusy || !mergePreview }"
            @click="confirmMerge"
          >
            {{ mergeBusy ? 'Merging…' : 'Confirm Merge' }}
          </button>
        </div>
      </div>
    </PpModal>
  </div>
</template>
