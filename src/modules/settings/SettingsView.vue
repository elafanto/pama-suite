<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import PpModal from '@/components/PpModal.vue'
import { useFirmStore, type NewFirm } from '@/stores/firm'
import type { Firm } from '@/types/models'

const firmStore = useFirmStore()
const showModal = ref(false)
const editingId = ref<string | null>(null)

const blank = (): NewFirm => ({
  name: '', gst: '', addr: '', city: '', state: '05', pin: '', phone: '', email: '',
  bank_name: '', bank_acno: '', bank_ifsc: '',
})
const form = reactive<NewFirm>(blank())

function openAdd() {
  editingId.value = null
  Object.assign(form, blank())
  showModal.value = true
}
function openEdit(f: Firm) {
  editingId.value = f.id
  Object.assign(form, {
    name: f.name, gst: f.gst, addr: f.addr, city: f.city, state: f.state, pin: f.pin,
    phone: f.phone, email: f.email, bank_name: f.bank_name, bank_acno: f.bank_acno, bank_ifsc: f.bank_ifsc,
  })
  showModal.value = true
}
async function save() {
  if (!form.name.trim()) return alert('Firm name required')
  if (editingId.value) await firmStore.update(editingId.value, { ...form })
  else await firmStore.add({ ...form })
  showModal.value = false
}

onMounted(firmStore.load)
</script>

<template>
  <div class="p-6 max-w-4xl mx-auto">
    <header class="mb-5">
      <h1 class="text-2xl font-bold text-navy">Settings</h1>
      <p class="text-sm text-slate-500">Firms (companies), preferences &amp; backup</p>
    </header>

    <!-- Firms -->
    <section class="pp-card p-5 mb-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="font-bold text-navy">🏢 Firms / Companies</h2>
        <button class="pp-btn pp-btn-primary" @click="openAdd">+ Add Firm</button>
      </div>

      <div class="space-y-2">
        <div v-for="f in firmStore.firms" :key="f.id"
          :class="['flex items-center gap-3 p-3 rounded-lg border',
                   f.id === firmStore.activeFirmId ? 'border-accent bg-blue-50' : 'border-slate-200']">
          <div class="flex-1">
            <div class="font-semibold text-navy">{{ f.name }}
              <span v-if="f.id === firmStore.activeFirmId" class="pp-badge bg-accent text-white ml-1">Active</span>
            </div>
            <div class="text-xs text-slate-500">{{ f.gst || 'No GST' }} · {{ f.city || '—' }}</div>
          </div>
          <button v-if="f.id !== firmStore.activeFirmId" class="pp-btn pp-btn-ghost !py-1.5"
            @click="firmStore.setActive(f.id)">Switch</button>
          <button class="pp-btn pp-btn-ghost !px-2 !py-1" @click="openEdit(f)">✏️</button>
        </div>
      </div>
    </section>

    <section class="pp-card p-5">
      <h2 class="font-bold text-navy mb-2">☁️ Cloud Sync &amp; Backup</h2>
      <p class="text-sm text-slate-500">Cloud sync (Supabase) is added once you create an account — your
        data is stored locally on this device until then, and will sync automatically afterward.</p>
    </section>

    <PpModal v-if="showModal" :title="editingId ? 'Edit Firm' : 'Add Firm'" @close="showModal = false">
      <div class="space-y-3">
        <div><label class="pp-label">Firm Name *</label><input v-model="form.name" class="pp-input" placeholder="Pama Packaging" /></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="pp-label">GSTIN</label><input v-model="form.gst" class="pp-input uppercase" /></div>
          <div><label class="pp-label">State code</label><input v-model="form.state" class="pp-input" placeholder="05" /></div>
        </div>
        <div><label class="pp-label">Address</label><input v-model="form.addr" class="pp-input" /></div>
        <div class="grid grid-cols-3 gap-3">
          <div><label class="pp-label">City</label><input v-model="form.city" class="pp-input" /></div>
          <div><label class="pp-label">PIN</label><input v-model="form.pin" class="pp-input" /></div>
          <div><label class="pp-label">Phone</label><input v-model="form.phone" class="pp-input" /></div>
        </div>
        <div class="border-t border-slate-200 pt-3">
          <div class="pp-label !text-slate-600 !mb-2">Bank details (printed on invoices)</div>
          <div class="grid grid-cols-3 gap-3">
            <div><label class="pp-label">Bank</label><input v-model="form.bank_name" class="pp-input" /></div>
            <div><label class="pp-label">A/c No.</label><input v-model="form.bank_acno" class="pp-input" /></div>
            <div><label class="pp-label">IFSC</label><input v-model="form.bank_ifsc" class="pp-input uppercase" /></div>
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
