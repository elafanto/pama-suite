<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { setPendingRTGS } from '@/services/rtgsBridge'
import { useFirmStore } from '@/stores/firm'
import { usePartyStore } from '@/stores/parties'
import { useItemStore } from '@/stores/items'
import { usePurchaseStore } from '@/stores/purchases'
import PpModal from '@/components/PpModal.vue'
import AiScanPanel from '@/components/AiScanPanel.vue'
import type { ScanResult } from '@/services/aiScanner'
import type { Purchase, PurchaseItemLine, PayStatus, GstType } from '@/types/models'

// Stores
const firmStore = useFirmStore()
const partyStore = usePartyStore()
const itemStore = useItemStore()
const purchaseStore = usePurchaseStore()
const router = useRouter()

// State
const activeTab = ref<'new' | 'history'>('new')
const search = ref('')
const statusFilter = ref<'all' | PayStatus>('all')
const editingId = ref<string | null>(null)

// Payment Modal State
const showPaymentModal = ref(false)
const payPurchaseId = ref<string | null>(null)
const payAmount = ref(0)
const payDate = ref(new Date().toISOString().slice(0, 10))
const payNote = ref('')
const payWriteOff = ref(false)

// Form State
const initialFormState = () => ({
  supplier_name: '',
  supplier_id: null as string | null,
  bill_no: '',
  date: new Date().toISOString().slice(0, 10),
  received_date: new Date().toISOString().slice(0, 10),
  payment: 'BANK',
  gst_type: 'intra' as GstType,
  items: [] as PurchaseItemLine[],
  notes: '',
  amt_paid: 0,
  pay_status: 'UNPAID' as PayStatus
})

const form = reactive(initialFormState())

// Helper functions
const n2 = (val: number) => (val || 0).toFixed(2)

function isRowIncomplete(row: PurchaseItemLine) {
  const hasContent = row.name.trim() || row.qty > 0 || row.rate > 0
  return hasContent && (!row.name.trim() || row.qty <= 0 || row.rate <= 0)
}

function addRow(data: Partial<PurchaseItemLine> = {}) {
  form.items.push({
    item_id: data.item_id || null,
    name: data.name || '',
    hsn: data.hsn || '48043100',
    qty: data.qty || 0,
    unit: data.unit || 'KG',
    rate: data.rate || 0,
    gst: data.gst !== undefined ? data.gst : 18,
    is_kraft_reel: data.is_kraft_reel || false,
    reel_no: data.reel_no || '',
    deckle_size: data.deckle_size || '',
    gsm: data.gsm || '',
    bf: data.bf || '',
    color: data.color || 'NATURAL_BROWN',
    reel_weight: data.reel_weight || data.qty || 0,
  })
}

function removeRow(idx: number) {
  form.items.splice(idx, 1)
  if (form.items.length === 0) addRow()
}

function resetForm() {
  editingId.value = null
  Object.assign(form, initialFormState())
  addRow()
}

function applyScan(result: ScanResult) {
  if (result.supplierName) form.supplier_name = result.supplierName
  if (result.billNo) form.bill_no = result.billNo
  if (result.date) form.date = result.date
  form.items = []
  for (const it of result.items || []) {
    addRow({ name: it.name, qty: it.qty, rate: it.rate, hsn: it.hsn || '48043100', gst: it.gst ?? 18 })
  }
  if (form.items.length === 0) addRow()
  if (result.supplierName) {
    partyStore.ensure(result.supplierName, 'vendor', {
      gst: result.gstin, addr: result.address, city: result.city, pin: result.pin,
      phone: result.phone, bank: result.bank, acno: result.acno, ifsc: result.ifsc, acname: result.acname,
    }).catch(() => {})
  }
}

// Watch active firm to reload data
watch(() => firmStore.activeFirmId, () => {
  purchaseStore.load()
  partyStore.load()
  itemStore.load()
})

// Autocomplete supplier details
function handleVendorSelect() {
  const key = form.supplier_name.trim().toLowerCase()
  const match = partyStore.list.find(p => !p.is_deleted && p.name.toLowerCase() === key)
  if (match) {
    form.supplier_id = match.id
    form.supplier_name = match.name
    updateGstType(match.state)
  } else {
    form.supplier_id = null
  }
}


function updateGstType(vendorStateCode: string) {
  const activeFirm = firmStore.activeFirm
  if (activeFirm && vendorStateCode) {
    form.gst_type = (activeFirm.state === vendorStateCode) ? 'intra' : 'inter'
  }
}

// Item row selection helper
function onRowItemSelect(idx: number) {
  const row = form.items[idx]
  const key = row.name.trim().toLowerCase()
  const match = itemStore.list.find(it => !it.is_deleted && it.name.toLowerCase() === key)
  if (match) {
    row.item_id = match.id
    row.name = match.name
    row.hsn = match.hsn
    row.unit = match.unit
    row.gst = match.gst
    row.rate = match.rate
  }
}

function toggleKraftReel(idx: number) {
  const row = form.items[idx]
  if (row.is_kraft_reel) {
    row.unit = 'KG'
    row.reel_weight = row.reel_weight || row.qty || 0
    row.hsn = row.hsn || '48043100'
  }
}

// Totals calculations
const subtotal = computed(() => {
  return form.items.reduce((sum, item) => {
    if (isRowIncomplete(item)) return sum
    return sum + (item.qty * item.rate)
  }, 0)
})

const taxBuckets = computed(() => {
  const buckets: Record<number, { taxable: number; tax: number }> = {}
  form.items.forEach(item => {
    if (isRowIncomplete(item)) return
    const taxable = item.qty * item.rate
    const tax = taxable * (item.gst / 100)
    if (!buckets[item.gst]) {
      buckets[item.gst] = { taxable: 0, tax: 0 }
    }
    buckets[item.gst].taxable += taxable
    buckets[item.gst].tax += tax
  })
  return buckets
})

const totalTax = computed(() => {
  return Object.values(taxBuckets.value).reduce((sum, b) => sum + b.tax, 0)
})

const rawTotal = computed(() => subtotal.value + totalTax.value)
const grandTotal = computed(() => Math.round(rawTotal.value))
const roundOff = computed(() => grandTotal.value - rawTotal.value)

// Save purchase invoice
async function savePurchase() {
  if (!form.supplier_name.trim()) {
    alert('Please enter a supplier name')
    return
  }
  if (!form.bill_no.trim()) {
    alert('Please enter a supplier bill number')
    return
  }
  
  const validItems = form.items.filter(it => !isRowIncomplete(it) && it.name.trim() && it.qty > 0 && it.rate > 0)
  if (validItems.length === 0) {
    alert('Please add at least one valid line item')
    return
  }
  const badReel = validItems.find(it => it.is_kraft_reel && (!it.reel_no?.trim() || !it.deckle_size?.trim() || !it.gsm?.trim() || !it.bf?.trim() || !(it.reel_weight || it.qty)))
  if (badReel) {
    alert('Kraft reel line me Reel No, Deckle, GSM, BF aur Reel Weight required hai.')
    return
  }

  // Ensure vendor exists
  const vendor = await partyStore.ensure(form.supplier_name, 'vendor')

  // Save each item that might be new
  for (const it of validItems) {
    if (!it.item_id) {
      const match = itemStore.list.find(i => i.name.toLowerCase() === it.name.trim().toLowerCase())
      if (!match) {
        const added = await itemStore.add({
          name: it.name.trim(),
          unit: it.unit,
          hsn: it.hsn,
          gst: it.gst,
          rate: it.rate,
          size: '',
          gsm: '',
          bf: it.bf || ''
        })
        it.item_id = added.id
      }
    }
  }

  const purchaseData = {
    supplier_name: vendor.name,
    supplier_id: vendor.id,
    bill_no: form.bill_no.trim(),
    date: form.date,
    received_date: form.received_date,
    payment: form.payment,
    gst_type: form.gst_type,
    items: validItems,
    sub: Math.round(subtotal.value * 100) / 100,
    total_tax: Math.round(totalTax.value * 100) / 100,
    round_off: Math.round(roundOff.value * 100) / 100,
    grand_total: grandTotal.value,
    amt_paid: form.amt_paid,
    pay_status: form.pay_status,
    notes: form.notes
  }

  if (editingId.value) {
    await purchaseStore.update(editingId.value, purchaseData)
    alert('Purchase bill updated successfully!')
  } else {
    await purchaseStore.add(purchaseData)
    alert('Purchase bill saved successfully!')
  }

  resetForm()
  activeTab.value = 'history'
}

// Edit purchase bill
function editPurchase(pur: Purchase) {
  editingId.value = pur.id
  form.supplier_name = pur.supplier_name
  form.supplier_id = pur.supplier_id
  form.bill_no = pur.bill_no
  form.date = pur.date
  form.received_date = pur.received_date || pur.date
  form.payment = pur.payment || 'BANK'
  form.gst_type = pur.gst_type
  form.notes = pur.notes
  form.amt_paid = pur.amt_paid
  form.pay_status = pur.pay_status
  
  form.items = pur.items.map(it => ({ ...it }))
  activeTab.value = 'new'
}

// Delete purchase bill
async function deletePurchase(pur: Purchase) {
  if (confirm(`Are you sure you want to delete purchase bill ${pur.bill_no}? This will also delete its accounting ledger entries.`)) {
    await purchaseStore.remove(pur.id)
    alert('Purchase bill deleted.')
  }
}

// Payment trigger
function openPaymentModal(pur: Purchase) {
  payPurchaseId.value = pur.id
  payAmount.value = Math.max(0, pur.grand_total - (pur.amt_paid || 0))
  payDate.value = new Date().toISOString().slice(0, 10)
  payNote.value = ''
  payWriteOff.value = false
  showPaymentModal.value = true
}

async function submitPayment() {
  if (!payPurchaseId.value) return
  if (payAmount.value < 0) {
    alert('Amount cannot be negative')
    return
  }
  await purchaseStore.recordPayment(
    payPurchaseId.value,
    payAmount.value,
    payWriteOff.value,
    payNote.value,
    payDate.value
  )
  showPaymentModal.value = false
  alert('Payment logged successfully!')
}

function payVendorRtgs(pur: Purchase) {
  const vendor = partyStore.list.find(p => p.id === pur.supplier_id || p.name === pur.supplier_name)
  const outstanding = Math.max(0, pur.grand_total - (pur.amt_paid || 0))
  if (outstanding <= 0) return alert('No outstanding amount on this purchase')
  if (!vendor?.acno || !vendor?.ifsc) return alert('Add vendor bank details in Parties first')
  setPendingRTGS({
    name: pur.supplier_name,
    purpose: `Payment against purchase ${pur.bill_no}`,
    bank: vendor.bank || '',
    acname: vendor.acname || pur.supplier_name,
    acno: vendor.acno,
    ifsc: vendor.ifsc,
    amount: outstanding,
    mode: 'RTGS',
    partyId: vendor.id,
    source: 'purchases',
  })
  router.push('/banking')
}

// History Filtered list
const filteredPurchases = computed(() => {
  return purchaseStore.list.filter(p => {
    // Search filter
    const matchesSearch = p.supplier_name.toLowerCase().includes(search.value.toLowerCase()) || 
                          p.bill_no.toLowerCase().includes(search.value.toLowerCase())
    
    // Status filter
    const matchesStatus = statusFilter.value === 'all' || p.pay_status === statusFilter.value
    
    return matchesSearch && matchesStatus
  })
})

onMounted(() => {
  purchaseStore.load()
  partyStore.load()
  itemStore.load()
  if (form.items.length === 0) addRow()
})
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Purchases Dashboard</h1>
        <p class="text-sm text-slate-500">Record incoming inventory bills and track vendor liabilities</p>
      </div>
      <div class="flex gap-2">
        <button 
          @click="activeTab = 'new'"
          class="pp-btn"
          :class="activeTab === 'new' ? 'pp-btn-primary' : 'pp-btn-ghost'"
        >
          ➕ Record Bill
        </button>
        <button 
          @click="activeTab = 'history'"
          class="pp-btn"
          :class="activeTab === 'history' ? 'pp-btn-primary' : 'pp-btn-ghost'"
        >
          📜 Bill Logs
        </button>
      </div>
    </div>

    <!-- Active Tab: New Purchase -->
    <div v-if="activeTab === 'new'" class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Main Form -->
      <div class="lg:col-span-2 space-y-6">
        <AiScanPanel @scanned="applyScan" />
        <div class="pp-card p-6 space-y-4">
          <h2 class="text-md font-semibold text-slate-800 border-b pb-2 mb-4">Supplier & Document Details</h2>
          
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="pp-label">Supplier Name *</label>
              <input 
                v-model="form.supplier_name"
                class="pp-input" 
                placeholder="Enter or select vendor name"
                @input="handleVendorSelect"
                list="vendors-list"
              />
              <datalist id="vendors-list">
                <option v-for="p in partyStore.vendors" :key="p.id" :value="p.name"></option>
              </datalist>
            </div>
            <div>
              <label class="pp-label">GSTIN Type</label>
              <div class="flex items-center gap-4 mt-2">
                <label class="flex items-center gap-2 text-sm font-medium">
                  <input type="radio" v-model="form.gst_type" value="intra" class="w-4 h-4 text-accent" />
                  Intra-state (CGST/SGST)
                </label>
                <label class="flex items-center gap-2 text-sm font-medium">
                  <input type="radio" v-model="form.gst_type" value="inter" class="w-4 h-4 text-accent" />
                  Inter-state (IGST)
                </label>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label class="pp-label">Supplier Bill Number *</label>
              <input 
                v-model="form.bill_no"
                class="pp-input" 
                placeholder="Vendor's Invoice No."
              />
            </div>
            <div>
              <label class="pp-label">Bill Date</label>
              <input 
                v-model="form.date"
                type="date"
                class="pp-input" 
              />
            </div>
            <div>
              <label class="pp-label">Received Date</label>
              <input 
                v-model="form.received_date"
                type="date"
                class="pp-input" 
              />
            </div>
          </div>
        </div>

        <!-- Purchase Items Table -->
        <div class="pp-card p-6 space-y-4">
          <h2 class="text-md font-semibold text-slate-800 border-b pb-2 mb-4">Item Breakdown</h2>
          
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse min-w-[980px]">
              <thead>
                <tr class="border-b text-slate-500 font-semibold text-xs uppercase bg-slate-50">
                  <th class="py-2 px-3">Item Description</th>
                  <th class="py-2 px-3 w-28">HSN</th>
                  <th class="py-2 px-3 w-20">Qty</th>
                  <th class="py-2 px-3 w-24">Unit</th>
                  <th class="py-2 px-3 w-24">Rate (₹)</th>
                  <th class="py-2 px-3 w-20">GST %</th>
                  <th class="py-2 px-3 w-28">Kraft Reel</th>
                  <th class="py-2 px-3 text-right w-28">Total Amount</th>
                  <th class="py-2 px-3 w-10"></th>
                </tr>
              </thead>
              <tbody class="divide-y text-sm">
                <tr v-for="(item, idx) in form.items" :key="idx" class="hover:bg-slate-50/50">
                  <td class="py-2 px-1">
                    <input 
                      v-model="item.name"
                      class="pp-input"
                      placeholder="Search or enter item"
                      @input="onRowItemSelect(idx)"
                      list="items-list"
                    />
                  </td>
                  <td class="py-2 px-1">
                    <input v-model="item.hsn" class="pp-input text-xs font-mono" placeholder="48043100" />
                  </td>
                  <td class="py-2 px-1">
                    <input type="number" v-model.number="item.qty" class="pp-input text-right" placeholder="0" />
                  </td>
                  <td class="py-2 px-1">
                    <select v-model="item.unit" class="pp-input">
                      <option value="KG">KG</option>
                      <option value="PCS">PCS</option>
                      <option value="NOS">NOS</option>
                      <option value="BOX">BOX</option>
                      <option value="SET">SET</option>
                    </select>
                  </td>
                  <td class="py-2 px-1">
                    <input type="number" v-model.number="item.rate" class="pp-input text-right" placeholder="0.00" step="0.01" />
                  </td>
                  <td class="py-2 px-1">
                    <select v-model.number="item.gst" class="pp-input">
                      <option :value="0">0%</option>
                      <option :value="5">5%</option>
                      <option :value="12">12%</option>
                      <option :value="18">18%</option>
                      <option :value="28">28%</option>
                    </select>
                  </td>
                  <td class="py-2 px-1">
                    <label class="flex items-center gap-2 text-xs font-semibold">
                      <input type="checkbox" v-model="item.is_kraft_reel" @change="toggleKraftReel(idx)" />
                      Reel Stock
                    </label>
                  </td>
                  <td class="py-2 px-3 text-right font-mono font-medium">
                    ₹ {{ n2(item.qty * item.rate) }}
                  </td>
                  <td class="py-2 px-1 text-center">
                    <button @click="removeRow(idx)" class="text-rose-500 hover:text-rose-700 text-lg">✕</button>
                  </td>
                </tr>
                <tr v-for="(item, idx) in form.items.filter(i => i.is_kraft_reel)" :key="`reel-${idx}-${item.name}`" class="bg-amber-50/50">
                  <td colspan="9" class="px-3 py-3">
                    <div class="grid grid-cols-2 md:grid-cols-6 gap-3">
                      <div>
                        <label class="pp-label">Reel No *</label>
                        <input v-model="item.reel_no" class="pp-input" placeholder="Reel/batch no" />
                      </div>
                      <div>
                        <label class="pp-label">Deckle Size *</label>
                        <input v-model="item.deckle_size" class="pp-input" placeholder="e.g. 52 inch" />
                      </div>
                      <div>
                        <label class="pp-label">GSM *</label>
                        <input v-model="item.gsm" class="pp-input" placeholder="120" />
                      </div>
                      <div>
                        <label class="pp-label">BF *</label>
                        <input v-model="item.bf" class="pp-input" placeholder="18" />
                      </div>
                      <div>
                        <label class="pp-label">Color</label>
                        <select v-model="item.color" class="pp-input">
                          <option value="NATURAL_BROWN">Natural Brown</option>
                          <option value="GY">GY</option>
                        </select>
                      </div>
                      <div>
                        <label class="pp-label">Reel Weight KG *</label>
                        <input type="number" v-model.number="item.reel_weight" class="pp-input text-right" placeholder="0" />
                      </div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <button @click="addRow()" class="pp-btn pp-btn-ghost w-full border border-dashed border-slate-300">
            ➕ Add Line Item
          </button>

          <!-- Datalists for autocomplete -->
          <datalist id="items-list">
            <option v-for="it in itemStore.list" :key="it.id" :value="it.name"></option>
          </datalist>
        </div>
      </div>

      <!-- Right Summary Panel -->
      <div class="space-y-6">
        <!-- Billing Details Summary -->
        <div class="pp-card p-6 space-y-4">
          <h2 class="text-md font-semibold text-slate-800 border-b pb-2 mb-4">Invoice Summary</h2>
          
          <div class="space-y-3 text-sm">
            <div class="flex justify-between">
              <span class="text-slate-500">Taxable Value</span>
              <span class="font-mono font-medium">₹ {{ n2(subtotal) }}</span>
            </div>

            <!-- GST Split-out -->
            <div v-for="(b, rate) in taxBuckets" :key="rate" class="space-y-1 bg-slate-50 p-2 rounded">
              <div class="flex justify-between text-xs text-slate-500">
                <span>GST @ {{ rate }}% on ₹{{ n2(b.taxable) }}</span>
                <span>₹{{ n2(b.tax) }}</span>
              </div>
              <div v-if="form.gst_type === 'intra'" class="flex justify-between text-[11px] text-slate-400 pl-2">
                <span>CGST (half) / SGST (half)</span>
                <span>₹{{ n2(b.tax / 2) }} / ₹{{ n2(b.tax / 2) }}</span>
              </div>
              <div v-else class="flex justify-between text-[11px] text-slate-400 pl-2">
                <span>IGST (full)</span>
                <span>₹{{ n2(b.tax) }}</span>
              </div>
            </div>

            <div class="flex justify-between border-t pt-3">
              <span class="text-slate-500">Total GST Inputs</span>
              <span class="font-mono font-medium">₹ {{ n2(totalTax) }}</span>
            </div>

            <div class="flex justify-between">
              <span class="text-slate-500">Round Off Adjust</span>
              <span class="font-mono text-slate-400">₹ {{ n2(roundOff) }}</span>
            </div>

            <div class="flex justify-between border-t pt-3 text-base font-bold">
              <span>Grand Total</span>
              <span class="text-accent font-mono">₹ {{ grandTotal.toLocaleString('en-IN') }}.00</span>
            </div>
          </div>
        </div>

        <!-- Payment Controls -->
        <div class="pp-card p-6 space-y-4">
          <h2 class="text-md font-semibold text-slate-800 border-b pb-2 mb-4">Payment & Logging</h2>
          
          <div>
            <label class="pp-label">Payment Status</label>
            <select v-model="form.pay_status" class="pp-input" @change="form.amt_paid = (form.pay_status === 'PAID') ? grandTotal : 0">
              <option value="UNPAID">UNPAID</option>
              <option value="PARTIAL">PARTIAL PAYMENT</option>
              <option value="PAID">FULLY PAID</option>
            </select>
          </div>

          <div v-if="form.pay_status === 'PARTIAL'">
            <label class="pp-label">Amount Paid *</label>
            <input type="number" v-model.number="form.amt_paid" class="pp-input" placeholder="0.00" />
          </div>

          <div>
            <label class="pp-label">Payment Account/Mode</label>
            <select v-model="form.payment" class="pp-input">
              <option value="CASH">Cash in Hand</option>
              <option value="BANK">Bank Account (Primary)</option>
              <option value="CC_LOAN">CC (Cash Credit) Account</option>
            </select>
          </div>

          <div>
            <label class="pp-label">Administrative Notes</label>
            <textarea v-model="form.notes" class="pp-input min-h-[80px]" placeholder="Add remarks or notes..."></textarea>
          </div>

          <div class="flex gap-2">
            <button @click="resetForm()" class="pp-btn pp-btn-ghost flex-1">
              Reset
            </button>
            <button @click="savePurchase()" class="pp-btn pp-btn-primary flex-1">
              {{ editingId ? 'Update Bill' : 'Record Bill' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Active Tab: Purchase Logs / History -->
    <div v-else class="pp-card p-6 space-y-4">
      <div class="flex flex-col sm:flex-row gap-4 items-center justify-between border-b pb-4">
        <h2 class="text-md font-semibold text-slate-800">Purchase Transaction Registers</h2>
        
        <div class="flex gap-2 w-full sm:w-auto">
          <input 
            v-model="search"
            class="pp-input sm:w-64"
            placeholder="Search Supplier or Bill No..."
          />
          <select v-model="statusFilter" class="pp-input w-36">
            <option value="all">All Status</option>
            <option value="PAID">PAID</option>
            <option value="PARTIAL">PARTIAL</option>
            <option value="UNPAID">UNPAID</option>
          </select>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="border-b text-slate-500 font-semibold text-xs uppercase bg-slate-50">
              <th class="py-3 px-4">Date</th>
              <th class="py-3 px-4">Bill No</th>
              <th class="py-3 px-4">Supplier Name</th>
              <th class="py-3 px-4 text-right">Taxable</th>
              <th class="py-3 px-4 text-right">GST</th>
              <th class="py-3 px-4 text-right">Total</th>
              <th class="py-3 px-4 text-right">Paid</th>
              <th class="py-3 px-4 text-center">Status</th>
              <th class="py-3 px-4 text-center">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y text-sm">
            <tr v-for="pur in filteredPurchases" :key="pur.id" class="hover:bg-slate-50/50">
              <td class="py-3 px-4 font-medium">{{ pur.date }}</td>
              <td class="py-3 px-4 font-mono">{{ pur.bill_no }}</td>
              <td class="py-3 px-4">{{ pur.supplier_name }}</td>
              <td class="py-3 px-4 text-right font-mono">₹{{ n2(pur.sub) }}</td>
              <td class="py-3 px-4 text-right font-mono">₹{{ n2(pur.total_tax) }}</td>
              <td class="py-3 px-4 text-right font-mono font-semibold text-slate-800">₹{{ pur.grand_total.toLocaleString('en-IN') }}.00</td>
              <td class="py-3 px-4 text-right font-mono text-emerald-600">₹{{ n2(pur.amt_paid || 0) }}</td>
              <td class="py-3 px-4 text-center">
                <span 
                  class="pp-badge"
                  :class="{
                    'bg-green-100 text-green-800': pur.pay_status === 'PAID',
                    'bg-amber-100 text-amber-800': pur.pay_status === 'PARTIAL',
                    'bg-rose-100 text-rose-800': pur.pay_status === 'UNPAID'
                  }"
                >
                  {{ pur.pay_status }}
                </span>
              </td>
              <td class="py-3 px-4 text-center">
                <div class="flex justify-center gap-2">
                  <button
                    v-if="pur.pay_status !== 'PAID'"
                    @click="payVendorRtgs(pur)"
                    class="pp-btn pp-btn-ghost px-2 py-1 text-xs"
                    title="Pay via RTGS"
                  >🏦 RTGS</button>
                  <button 
                    v-if="pur.pay_status !== 'PAID'"
                    @click="openPaymentModal(pur)" 
                    class="pp-btn pp-btn-ghost px-2 py-1 text-xs"
                    title="Log Payment"
                  >
                    💳 Pay
                  </button>
                  <button 
                    @click="editPurchase(pur)" 
                    class="pp-btn pp-btn-ghost px-2 py-1 text-xs"
                    title="Edit Bill"
                  >
                    ✏️ Edit
                  </button>
                  <button 
                    @click="deletePurchase(pur)" 
                    class="pp-btn pp-btn-ghost px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                    title="Delete Bill"
                  >
                    🗑️ Del
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="filteredPurchases.length === 0">
              <td colspan="9" class="py-8 text-center text-slate-400">
                No purchase transactions logged for this firm.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Outstanding Payment Modal -->
    <PpModal :show="showPaymentModal" title="Record Payment to Vendor" @close="showPaymentModal = false">
      <div class="space-y-4">
        <div>
          <label class="pp-label">Date of Payment</label>
          <input type="date" v-model="payDate" class="pp-input" />
        </div>
        <div>
          <label class="pp-label">Amount Paid (₹)</label>
          <input type="number" v-model.number="payAmount" class="pp-input" placeholder="0.00" />
        </div>
        <div class="flex items-center gap-2">
          <input type="checkbox" v-model="payWriteOff" id="write-off-chk" class="w-4 h-4 rounded text-accent" />
          <label for="write-off-chk" class="text-sm font-semibold text-slate-600">
            Write-off difference as Round Off Expense?
          </label>
        </div>
        <div>
          <label class="pp-label">Transaction Reference / Note</label>
          <input v-model="payNote" class="pp-input" placeholder="UTR, Cheque No, Bank Ref..." />
        </div>
        <div class="flex gap-2 justify-end border-t pt-4">
          <button @click="showPaymentModal = false" class="pp-btn pp-btn-ghost">Cancel</button>
          <button @click="submitPayment" class="pp-btn pp-btn-primary">Record Payment</button>
        </div>
      </div>
    </PpModal>
  </div>
</template>
