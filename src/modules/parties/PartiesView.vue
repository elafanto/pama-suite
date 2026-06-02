<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue'
import PpModal from '@/components/PpModal.vue'
import { usePartyStore, type NewParty } from '@/stores/parties'
import type { Party, PartyRole } from '@/types/models'

const store = usePartyStore()
const search = ref('')
const roleFilter = ref<'all' | PartyRole>('all')
const showModal = ref(false)
const editingId = ref<string | null>(null)

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

function openAdd() {
  editingId.value = null
  Object.assign(form, blank())
  showModal.value = true
}
function openEdit(p: Party) {
  editingId.value = p.id
  Object.assign(form, {
    name: p.name, roles: [...p.roles], gst: p.gst, phone: p.phone, email: p.email,
    addr: p.addr, city: p.city, pin: p.pin, state: p.state, is_consumer: p.is_consumer,
    bank: p.bank, acno: p.acno, ifsc: p.ifsc, acname: p.acname,
  })
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
  if (editingId.value) await store.update(editingId.value, { ...form })
  else await store.add({ ...form })
  showModal.value = false
}
async function del(p: Party) {
  if (confirm(`Delete "${p.name}"?`)) await store.remove(p.id)
}

onMounted(store.load)
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">
    <header class="flex items-center justify-between gap-3 mb-5 flex-wrap">
      <div>
        <h1 class="text-2xl font-bold text-navy">Parties</h1>
        <p class="text-sm text-slate-500">Customers, vendors &amp; beneficiaries — one list</p>
      </div>
      <button class="pp-btn pp-btn-primary" @click="openAdd">+ Add Party</button>
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
            <td class="px-4 py-2.5 hidden sm:table-cell text-slate-600">{{ p.gst || '—' }}</td>
            <td class="px-4 py-2.5 hidden md:table-cell text-slate-600">{{ p.phone || '—' }}</td>
            <td class="px-4 py-2.5 hidden lg:table-cell text-slate-600">{{ p.city || '—' }}</td>
            <td class="px-4 py-2.5 text-right whitespace-nowrap">
              <button class="pp-btn pp-btn-ghost !px-2 !py-1 mr-1" @click="openEdit(p)">✏️</button>
              <button class="pp-btn pp-btn-danger !px-2 !py-1" @click="del(p)">🗑️</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <PpModal
      v-if="showModal"
      :title="editingId ? 'Edit Party' : 'Add Party'"
      :close-on-backdrop="false"
      @close="showModal = false"
    >
      <div class="space-y-3">
        <div>
          <label class="pp-label">Name *</label>
          <input v-model="form.name" class="pp-input" placeholder="M/s ABC Traders" />
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
          <div><label class="pp-label">GST</label><input v-model="form.gst" class="pp-input uppercase" placeholder="05ABCDE1234F1Z5" /></div>
          <div><label class="pp-label">Phone</label><input v-model="form.phone" class="pp-input" /></div>
        </div>
        <div><label class="pp-label">Address</label><input v-model="form.addr" class="pp-input" /></div>
        <div class="grid grid-cols-3 gap-3">
          <div><label class="pp-label">City</label><input v-model="form.city" class="pp-input" /></div>
          <div><label class="pp-label">PIN</label><input v-model="form.pin" class="pp-input" /></div>
          <div><label class="pp-label">State code</label><input v-model="form.state" class="pp-input" placeholder="05" /></div>
        </div>

        <div class="border-t border-slate-200 pt-3">
          <div class="pp-label !text-slate-600 !mb-2">Bank details (for RTGS/NEFT)</div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="pp-label">A/c Name</label><input v-model="form.acname" class="pp-input" /></div>
            <div><label class="pp-label">A/c No.</label><input v-model="form.acno" class="pp-input" /></div>
            <div><label class="pp-label">IFSC</label><input v-model="form.ifsc" class="pp-input uppercase" /></div>
            <div><label class="pp-label">Bank &amp; Branch</label><input v-model="form.bank" class="pp-input" /></div>
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
