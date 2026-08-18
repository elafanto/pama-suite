<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useFirmStore } from '@/stores/firm'
import { usePartyStore, type NewParty } from '@/stores/parties'
import { useItemStore, type NewItem } from '@/stores/items'
import { useInvoiceStore } from '@/stores/invoices'
import { useAccountingStore } from '@/stores/accounting'
import { usePurchaseStore } from '@/stores/purchases'
import { getStateName, getStateCode, isGstinValid, formatGstin } from '@/services/gst'
import { numberToWords } from '@/services/numberToWords'
import { openStatementPrint } from '@/services/billingStatements'
import { getEwayEligibility, downloadEwayJson } from '@/services/ewayBill'
import { downloadInvoicePdf, bulkDownloadInvoicePdf, INVOICE_PDF_COPY_OPTIONS, type InvoicePdfCopy } from '@/services/invoicePdf'
import { resolveFirmSignature } from '@/services/firmSignature'
import { resolveLivePartyDetails, resolveLiveShipDetails, type PartyLookup } from '@/services/invoiceDisplay'
import { peekBillNo } from '@/services/invoiceNumber'
import {
  normalizeHsn4,
  resolveHsnGstRate,
  buildBillGstConfirmMessage,
  commonBillingHsn4Options,
  type HsnGstLookup,
} from '@/services/hsnGst'
import { listItemStockMovements } from '@/services/inventoryLedger'
import { computeStock, findStockRowForLine } from '@/services/stock'
import { periodLabelYm, salesMonthLockMessage, salesPeriodFromDate } from '@/services/salesMonthLock'
import { isInvoiceActive, isInvoiceCancelled } from '@/services/invoiceStatus'
import { useTableSort } from '@/composables/useTableSort'
import PpModal from '@/components/PpModal.vue'
import type { Invoice, InvoiceItemLine, PayStatus, GstType, ItemStockMovement } from '@/types/models'
import { uid } from '@/data/util'

// Stores
const firmStore = useFirmStore()
const partyStore = usePartyStore()
const itemStore = useItemStore()
const invoiceStore = useInvoiceStore()
const accountingStore = useAccountingStore()
const purchaseStore = usePurchaseStore()

const showQuickCust = ref(false)
const showQuickItem = ref(false)
const quickCust = reactive<NewParty>({
  name: '', roles: ['customer'], gst: '', phone: '', email: '', addr: '',
  city: '', pin: '', state: '05', is_consumer: false, bank: '', acno: '', ifsc: '', acname: '',
})
const quickItem = reactive<NewItem>({
  name: '', unit: 'KG', hsn: '4804', gst: 18, rate: 0, size: '', gsm: '', bf: '',
})
const ITEM_UNITS = ['PCS', 'KG', 'MTR', 'NOS', 'BOX', 'SET', 'SQM', 'DOZEN']

const ewayFrom = ref('')
const ewayTo = ref('')
const ewaySelected = ref<string[]>([])
const ewayCheckAll = ref(false)

function defaultEwayDates() {
  const now = new Date()
  ewayFrom.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  ewayTo.value = now.toISOString().slice(0, 10)
}

// State
const activeTab = ref<'new' | 'history' | 'templates' | 'eway'>('new')
const search = ref('')
const lockMonth = ref(new Date().toISOString().slice(0, 7))

const formMonthLocked = computed(() => firmStore.isSalesLocked(form.date))
const lockMonthLocked = computed(() => firmStore.isSalesLocked(lockMonth.value))
const lockedMonthsList = computed(() => firmStore.lockedSalesMonths)
const statusFilter = ref<'all' | PayStatus | 'cancelled'>('all')
const hideCancelled = ref(false)
const histFrom = ref('')
const histTo = ref('')
const histCustomer = ref('')
const selectedHistoryIds = ref<string[]>([])
const bulkPdfCopy = ref<InvoicePdfCopy>('office')
const showStatementModal = ref(false)
const stmtFrom = ref('')
const stmtTo = ref('')
const stmtCustomer = ref('')
const stmtPay = ref('')
const stmtDoc = ref('')
const editingId = ref<string | null>(null)
const savingInvoice = ref(false)
const templateName = ref('')
const templateDesc = ref('')
const showTemplateModal = ref(false)
const stockMovements = ref<ItemStockMovement[]>([])

/** Hard delete / uncancel confirmation modal */
const dangerModal = ref<{
  mode: 'hard_delete' | 'uncancel'
  inv: Invoice
  typedBill: string
  typedPhrase: string
} | null>(null)
const dangerMenuId = ref<string | null>(null)

// Outstanding Payment Modal State
const showPaymentModal = ref(false)
const payInvoiceId = ref<string | null>(null)
const payAmount = ref(0)
const payDate = ref(new Date().toISOString().slice(0, 10))
const payNote = ref('')
const payWriteOff = ref(false)

// Print Preview State
const showPrintPreview = ref(false)
const previewInvoice = ref<Invoice | null>(null)

const partyLookup: PartyLookup = (partyId) => {
  if (!partyId) return undefined
  return partyStore.list.find((p) => !p.is_deleted && p.id === partyId)
}

const previewBuyerDetails = computed(() => {
  if (!previewInvoice.value) return {}
  const live = partyLookup(previewInvoice.value.party_id)
  return resolveLivePartyDetails(previewInvoice.value, live)
})

const previewShipDetails = computed(() => {
  if (!previewInvoice.value) return null
  const live = partyLookup(previewInvoice.value.party_id)
  return resolveLiveShipDetails(previewInvoice.value, live)
})

// Templates State (loaded from localStorage for simplicity and persistence)
interface Template {
  id: string
  name: string
  desc: string
  custName: string
  items: Omit<InvoiceItemLine, 'item_id'>[]
  payment: string
  createdAt: string
}
const templatesList = ref<Template[]>([])

// Form state
const initialFormState = () => ({
  doc_type: 'INVOICE' as 'INVOICE' | 'BILL_OF_SUPPLY' | 'CREDIT_NOTE' | 'DEBIT_NOTE',
  bill_no: '',
  date: new Date().toISOString().slice(0, 10),
  ref: '',
  party_id: null as string | null,
  party_name: '',
  sameAsBuyer: true,
  ship: {
    name: '',
    addr: '',
    city: '',
    pin: '',
    email: '',
    gstin: '',
    state: ''
  },
  dispatch: '',
  lr: '',
  vehicle: '',
  transMode: '1',
  transporterName: '',
  transporterId: '',
  eway: '',
  dest: '',
  distance: 0,
  docNo: '',
  payment: 'CASH',
  gst_type: 'intra' as GstType,
  items: [] as InvoiceItemLine[],
  notes: '',
  amt_paid: 0,
  pay_status: 'UNPAID' as PayStatus
})

const form = reactive(initialFormState())

const editingInvoice = computed(() =>
  editingId.value ? invoiceStore.list.find((i) => i.id === editingId.value) : undefined,
)

const formSelectedParty = computed(() => {
  if (form.party_id) {
    return partyStore.list.find((p) => !p.is_deleted && p.id === form.party_id)
  }
  const key = form.party_name.trim().toLowerCase()
  if (!key) return undefined
  return partyStore.list.find((p) => !p.is_deleted && p.name.toLowerCase() === key)
})

const formBuyerDisplay = computed(() => {
  const p = formSelectedParty.value
  if (p) {
    const gst = formatGstin(p.gst)
    return {
      name: p.name,
      addr: p.addr || '',
      city: p.city || '',
      pin: p.pin || '',
      gst: p.is_consumer ? '' : gst,
      state: p.state || getStateCode(gst) || '',
      is_consumer: !!p.is_consumer,
      phone: p.phone || '',
      email: p.email || '',
    }
  }
  const snap = editingInvoice.value?.party_snapshot
  if (snap && form.party_name.trim()) {
    const gst = formatGstin(snap.gst)
    return {
      name: form.party_name.trim(),
      addr: snap.addr || '',
      city: snap.city || '',
      pin: snap.pin || '',
      gst: snap.is_consumer ? '' : gst,
      state: snap.state || getStateCode(gst) || '',
      is_consumer: !!snap.is_consumer,
      phone: snap.phone || '',
      email: snap.email || '',
    }
  }
  if (!form.party_name.trim()) return null
  return {
    name: form.party_name.trim(),
    addr: '',
    city: '',
    pin: '',
    gst: '',
    state: '',
    is_consumer: false,
    phone: '',
    email: '',
  }
})

const formShipDisplay = computed(() => {
  if (form.sameAsBuyer) return null
  const s = form.ship
  if (!s.addr?.trim() && !s.name?.trim()) return null
  const gstin = formatGstin(s.gstin)
  return {
    name: s.name?.trim() || form.party_name.trim(),
    addr: s.addr || '',
    city: s.city || '',
    pin: s.pin || '',
    gstin,
    state: s.state || getStateCode(gstin) || '',
  }
})

const showFormAddresses = computed(() => !!formBuyerDisplay.value)

// Helper functions
const n2 = (val: number) => (val || 0).toFixed(2)

const hsn4Options = commonBillingHsn4Options()
const rowHsnLookups = ref<Map<string, HsnGstLookup>>(new Map())
const hsnLookupBusy = ref<Record<number, boolean>>({})

function sanitizeHsnInput(row: InvoiceItemLine) {
  row.hsn = (row.hsn || '').replace(/\D/g, '').slice(0, 4)
}

async function onHsnBlur(row: InvoiceItemLine, idx: number) {
  sanitizeHsnInput(row)
  const hsn4 = normalizeHsn4(row.hsn)
  if (!hsn4) return
  row.hsn = hsn4
  hsnLookupBusy.value = { ...hsnLookupBusy.value, [idx]: true }
  try {
    const lookup = await resolveHsnGstRate(hsn4)
    if (lookup) {
      row.gst = lookup.gst
      rowHsnLookups.value = new Map(rowHsnLookups.value).set(hsn4, lookup)
    }
  } finally {
    const next = { ...hsnLookupBusy.value }
    delete next[idx]
    hsnLookupBusy.value = next
  }
}

// Incomplete row validation helper
function isRowIncomplete(row: InvoiceItemLine) {
  const hasContent = row.name.trim() || row.qty > 0 || row.rate > 0
  return hasContent && (!row.name.trim() || row.qty <= 0 || row.rate <= 0)
}

function addRow(data: Partial<InvoiceItemLine> = {}) {
  form.items.push({
    item_id: data.item_id || null,
    name: data.name || '',
    hsn: normalizeHsn4(data.hsn) || data.hsn?.replace(/\D/g, '').slice(0, 4) || '4804',
    size: data.size || '',
    gsm: data.gsm || '',
    bf: data.bf || '',
    extra: data.extra || '',
    qty: data.qty || 0,
    unit: data.unit || 'KG',
    rate: data.rate || 0,
    gst: data.gst !== undefined ? data.gst : 18
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

const nextBillPreview = computed(() => {
  const firm = firmStore.activeFirm
  if (!firm || editingId.value) return ''
  return peekBillNo(firm, invoiceStore.list, form.date)
})

const saveButtonLabel = computed(() => {
  if (editingId.value) return 'Update Bill'
  if (form.doc_type === 'INVOICE' && formEwayEligibility.value.show) return 'Save Bill + E-Way JSON'
  return 'Save Bill'
})

function tryAutoEwayDownload(invoice: Invoice): string {
  const firm = firmStore.activeFirm
  if (!firm) return ''
  const el = getEwayEligibility(invoice)
  if (!el.show) return ''
  if (!(invoice.vehicle || '').trim()) {
    return '\n\nE-Way: vehicle number transport section me bharein, phir History se JSON download karein.'
  }
  try {
    downloadEwayJson([invoice], firm, partyLookup)
    return '\n\nE-Way JSON download ho gaya (1 bill). Upload: ewaybillgst.gov.in → Generate Bulk'
  } catch (e: any) {
    return `\n\nE-Way JSON error: ${e?.message || 'failed'}`
  }
}

function downloadEwayForHistoryBill(inv: Invoice) {
  const firm = firmStore.activeFirm
  if (!firm) return alert('Active firm set karein')
  const el = getEwayEligibility(inv)
  if (!el.show) return alert('Is bill par E-Way JSON nahi banta (amount / type check karein).')
  if (!(inv.vehicle || '').trim()) return alert('Is bill me vehicle number nahi — pehle bill edit karke transport bharein.')
  try {
    downloadEwayJson([inv], firm, partyLookup)
    alert(`E-Way JSON downloaded for ${inv.bill_no}`)
  } catch (e: any) {
    alert(e.message || 'E-Way JSON failed')
  }
}

// Watch active firm to update sequence
watch(() => firmStore.activeFirmId, () => {
  invoiceStore.load()
})

// Autocomplete customer selection
function handleCustSelect() {
  const key = form.party_name.trim().toLowerCase()
  const match = partyStore.list.find(p => !p.is_deleted && p.name.toLowerCase() === key)
  if (match) {
    form.party_id = match.id
    form.ship.name = match.name
    form.ship.addr = match.addr
    form.ship.city = match.city
    form.ship.pin = match.pin
    form.ship.email = match.email
    form.ship.gstin = match.gst
    form.ship.state = match.state
    detectGstType()
  } else {
    form.party_id = null
  }
}

// Automatically detect intra vs inter state GST
function detectGstType() {
  const activeFirm = firmStore.activeFirm
  if (!activeFirm) return

  const firmState = (activeFirm.state || getStateCode(activeFirm.gst) || '05').padStart(2, '0').substring(0, 2)
  let consigneeState = ''

  if (form.sameAsBuyer) {
    const key = form.party_name.trim().toLowerCase()
    const c = partyStore.list.find(p => !p.is_deleted && p.name.toLowerCase() === key)
    consigneeState = c ? (c.state || getStateCode(c.gst) || '') : ''
  } else {
    consigneeState = form.ship.state
    if (!consigneeState) {
      consigneeState = getStateCode(form.ship.gstin) || ''
    }
  }

  const consS = String(consigneeState || '').padStart(2, '0').substring(0, 2)
  if (!consS || consS === '00') {
    form.gst_type = 'intra'
    return
  }
  form.gst_type = (firmState === consS) ? 'intra' : 'inter'
}

watch(() => form.sameAsBuyer, detectGstType)

// Autocomplete item selection per row
async function handleItemSelect(row: InvoiceItemLine) {
  const match = itemStore.list.find(i => !i.is_deleted && i.name.toLowerCase() === row.name.trim().toLowerCase())
  if (match) {
    row.item_id = match.id
    row.hsn = normalizeHsn4(match.hsn) || match.hsn.replace(/\D/g, '').slice(0, 4) || '4804'
    row.unit = match.unit
    row.rate = match.rate
    row.size = match.size || ''
    row.gsm = match.gsm || ''
    row.bf = match.bf || ''
    const lookup = await resolveHsnGstRate(row.hsn)
    if (lookup) {
      row.gst = lookup.gst
      rowHsnLookups.value = new Map(rowHsnLookups.value).set(lookup.hsn4, lookup)
    } else {
      row.gst = match.gst
    }
  }
}

// Calculations
const subTotal = computed(() => {
  return form.items.reduce((sum, row) => {
    if (!row.name.trim() || row.qty <= 0 || row.rate <= 0) return sum
    return sum + (row.qty * row.rate)
  }, 0)
})

const taxBuckets = computed(() => {
  const buckets: Record<number, { taxable: number; tax: number }> = {}
  form.items.forEach(row => {
    if (!row.name.trim() || row.qty <= 0 || row.rate <= 0) return
    const amt = row.qty * row.rate
    const gstPct = row.gst || 0
    if (!buckets[gstPct]) buckets[gstPct] = { taxable: 0, tax: 0 }
    buckets[gstPct].taxable += amt
  })

  Object.keys(buckets).forEach(pctKey => {
    const pct = parseFloat(pctKey)
    const b = buckets[pct]
    b.tax = Math.round(b.taxable * pct / 100 * 100) / 100
  })
  return buckets
})

const totalTax = computed(() => {
  return Object.values(taxBuckets.value).reduce((sum, b) => sum + b.tax, 0)
})

const rawGrandTotal = computed(() => subTotal.value + totalTax.value)
const grandTotal = computed(() => Math.round(rawGrandTotal.value))
const roundOff = computed(() => grandTotal.value - rawGrandTotal.value)

const formEwayEligibility = computed(() => getEwayEligibility({
  doc_type: form.doc_type,
  grand_total: grandTotal.value,
  gst_type: form.gst_type,
  is_deleted: false,
}))

const stockRows = computed(() =>
  computeStock(itemStore.list, purchaseStore.list, invoiceStore.list, firmStore.activeFirmId, stockMovements.value),
)

function qtyLabel(qty: number, unit: string) {
  return `${(qty || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 })} ${unit || ''}`.trim()
}

const editedInvoice = computed(() => invoiceStore.list.find((inv) => inv.id === editingId.value) || null)

const originalEditQtyByItem = computed(() => {
  const qty = new Map<string, number>()
  const inv = editedInvoice.value
  if (!inv || inv.doc_type !== 'INVOICE') return qty
  for (const line of inv.items || []) {
    const stockRow = findStockRowForLine(stockRows.value, line)
    if (!stockRow) continue
    qty.set(stockRow.itemId, (qty.get(stockRow.itemId) || 0) + (Number(line.qty) || 0))
  }
  return qty
})

const stockGuardWarnings = computed(() => {
  if (form.doc_type !== 'INVOICE') return []

  const requested = new Map<string, { row: ReturnType<typeof findStockRowForLine>; qty: number }>()
  for (const line of form.items) {
    if (!line.name.trim() || Number(line.qty) <= 0) continue
    const stockRow = findStockRowForLine(stockRows.value, line)
    if (!stockRow) continue
    const current = requested.get(stockRow.itemId)
    requested.set(stockRow.itemId, { row: stockRow, qty: (current?.qty || 0) + (Number(line.qty) || 0) })
  }

  return [...requested.entries()]
    .map(([itemId, entry]) => {
      const row = entry.row
      if (!row) return null
      const available = row.onHand + (originalEditQtyByItem.value.get(itemId) || 0)
      const shortage = entry.qty - available
      return shortage > 0.0001
        ? { itemId, name: row.name, unit: row.unit, requested: entry.qty, available, shortage }
        : null
    })
    .filter(Boolean) as { itemId: string; name: string; unit: string; requested: number; available: number; shortage: number }[]
})

const stockGuardMessage = computed(() =>
  stockGuardWarnings.value
    .map((w) => `${w.name}: billing ${qtyLabel(w.requested, w.unit)}, on-hand ${qtyLabel(w.available, w.unit)}`)
    .join('\n'),
)

function rowHasStockWarning(row: InvoiceItemLine) {
  const stockRow = findStockRowForLine(stockRows.value, row)
  return !!stockRow && stockGuardWarnings.value.some((w) => w.itemId === stockRow.itemId)
}

const ewayCandidates = computed(() => {
  let list = invoiceStore.list.filter((b) => {
    if (b.is_deleted || b.firm_id !== firmStore.activeFirmId) return false
    return getEwayEligibility(b).show
  })
  if (ewayFrom.value) list = list.filter((b) => b.date >= ewayFrom.value)
  if (ewayTo.value) list = list.filter((b) => b.date <= ewayTo.value)
  return list.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
})

function refreshEwaySelection() {
  ewaySelected.value = ewayCandidates.value
    .filter((b) => getEwayEligibility(b).autoSelect)
    .map((b) => b.id)
  ewayCheckAll.value = ewayCandidates.value.length > 0 && ewaySelected.value.length === ewayCandidates.value.length
}

function toggleEwaySelect(id: string) {
  const i = ewaySelected.value.indexOf(id)
  if (i >= 0) ewaySelected.value.splice(i, 1)
  else ewaySelected.value.push(id)
  ewayCheckAll.value = ewayCandidates.value.length > 0 && ewaySelected.value.length === ewayCandidates.value.length
}

function toggleEwayCheckAll() {
  if (ewayCheckAll.value) {
    ewaySelected.value = ewayCandidates.value.map((b) => b.id)
  } else {
    ewaySelected.value = []
  }
}

function ewayLevelLabel(b: Invoice) {
  const e = getEwayEligibility(b)
  if (e.level === 'required') return 'Required'
  if (e.level === 'suggested') return 'Suggested'
  return '—'
}

function downloadSelectedEwayJson() {
  const firm = firmStore.activeFirm
  if (!firm) return alert('Active firm set karein')
  const selected = ewayCandidates.value.filter((b) => ewaySelected.value.includes(b.id))
  if (!selected.length) return alert('Kam se kam ek bill select karein')
  try {
    const n = downloadEwayJson(selected, firm, partyLookup)
    alert(`${n} E-Way bill JSON download ho gaya. Upload: ewaybillgst.gov.in → Generate Bulk`)
  } catch (e: any) {
    alert(e.message || 'E-Way JSON failed')
  }
}

function isEwayEligible(inv: Invoice) {
  return getEwayEligibility(inv).show
}

watch(activeTab, (tab) => {
  if (tab === 'eway') refreshEwaySelection()
})

watch([ewayFrom, ewayTo], () => refreshEwaySelection())

// Payment handler auto-fills
function onPayStatusChange() {
  if (form.pay_status === 'PAID') {
    form.amt_paid = grandTotal.value
  } else if (form.pay_status === 'UNPAID') {
    form.amt_paid = 0
  }
}

const buyerGstin = computed(() => {
  if (form.sameAsBuyer) {
    const c = partyStore.list.find(p => !p.is_deleted && p.name.toLowerCase() === form.party_name.trim().toLowerCase())
    return c?.gst || ''
  }
  return form.ship.gstin
})

const gstinFeedback = computed(() => {
  const g = (buyerGstin.value || '').trim().toUpperCase()
  if (!g || g === 'URD') return { ok: true, msg: '' }
  if (isGstinValid(g)) return { ok: true, msg: '✓ Valid GSTIN format' }
  return { ok: false, msg: '⚠ Invalid GSTIN format' }
})

function openQuickCust() {
  Object.assign(quickCust, {
    name: form.party_name.trim() || '', roles: ['customer'], gst: '', phone: '', email: '', addr: '',
    city: '', pin: '', state: '05', is_consumer: false, bank: '', acno: '', ifsc: '', acname: '',
  })
  showQuickCust.value = true
}

async function saveQuickCust() {
  if (!quickCust.name.trim()) return alert('Customer name required')
  if (quickCust.gst && !quickCust.state) quickCust.state = quickCust.gst.slice(0, 2)
  const p = await partyStore.add({ ...quickCust })
  form.party_name = p.name
  form.party_id = p.id
  handleCustSelect()
  showQuickCust.value = false
}

function openQuickItem() {
  Object.assign(quickItem, { name: '', unit: 'KG', hsn: '4804', gst: 18, rate: 0, size: '', gsm: '', bf: '' })
  showQuickItem.value = true
}

async function saveQuickItem() {
  if (!quickItem.name.trim()) return alert('Item name required')
  await itemStore.add({ ...quickItem })
  showQuickItem.value = false
}

function repeatLastBill() {
  const firmId = firmStore.activeFirmId
  const active = invoiceStore.list.filter(b => b.firm_id === firmId && isInvoiceActive(b))
  if (!active.length) return alert('No previous bills found')
  active.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  copyInvoice(active[0])
}

function toggleHistorySelect(id: string) {
  const i = selectedHistoryIds.value.indexOf(id)
  if (i >= 0) selectedHistoryIds.value.splice(i, 1)
  else selectedHistoryIds.value.push(id)
}

async function bulkCancelHistory() {
  if (!selectedHistoryIds.value.length) return alert('Select bills to cancel')
  const targets = selectedHistoryIds.value
    .map((id) => invoiceStore.list.find((b) => b.id === id))
    .filter((b): b is Invoice => !!b && isInvoiceActive(b))
  if (!targets.length) return alert('Selected me koi active bill nahi (cancelled pehle se cancel nahi).')
  const locked = targets.filter((b) => firmStore.isSalesLocked(b.date))
  if (locked.length) {
    return alert(
      `Locked sales month me ${locked.length} bill(s) hain — pehle month unlock karo.\n`
      + locked.slice(0, 5).map((b) => `${b.bill_no} (${salesPeriodFromDate(b.date)})`).join('\n'),
    )
  }
  if (!confirm(`Cancel ${targets.length} selected bill(s)?\n\nLedger/stock reverse; history me Cancelled dikhenge; GSTR Table 13 me count.`)) return
  try {
    for (const inv of targets) {
      await invoiceStore.cancel(inv.id)
    }
    selectedHistoryIds.value = []
    alert(`${targets.length} bill(s) cancelled.`)
  } catch (err: any) {
    alert(err?.message || String(err))
  }
}

async function cancelInvoice(inv: Invoice) {
  if (firmStore.isSalesLocked(inv.date)) {
    return alert(salesMonthLockMessage(salesPeriodFromDate(inv.date)))
  }
  if (!isInvoiceActive(inv)) return alert('Bill already cancelled / deleted')
  if (!confirm(
    `Cancel invoice ${inv.bill_no}?\n\n`
    + `• History me Cancelled badge ke saath dikhega\n`
    + `• Print/PDF pe CANCELLED watermark\n`
    + `• Ledger + stock reverse\n`
    + `• Bill number reserved (GSTR Table 13 cancelled)`,
  )) return
  try {
    await invoiceStore.cancel(inv.id)
    alert(`Invoice ${inv.bill_no} cancelled.`)
  } catch (err: any) {
    alert(err?.message || String(err))
  }
}

function openHardDeleteModal(inv: Invoice) {
  if (firmStore.isSalesLocked(inv.date)) {
    return alert(salesMonthLockMessage(salesPeriodFromDate(inv.date)))
  }
  dangerMenuId.value = null
  dangerModal.value = { mode: 'hard_delete', inv, typedBill: '', typedPhrase: '' }
}

function openUncancelModal(inv: Invoice) {
  if (firmStore.isSalesLocked(inv.date)) {
    return alert(salesMonthLockMessage(salesPeriodFromDate(inv.date)))
  }
  if (!isInvoiceCancelled(inv)) return alert('Bill cancelled nahi hai')
  dangerMenuId.value = null
  dangerModal.value = { mode: 'uncancel', inv, typedBill: '', typedPhrase: '' }
}

function closeDangerModal() {
  dangerModal.value = null
}

const dangerModalReady = computed(() => {
  const m = dangerModal.value
  if (!m) return false
  const billOk = m.typedBill.trim().toUpperCase() === m.inv.bill_no.trim().toUpperCase()
  const phrase = m.mode === 'hard_delete' ? 'HARD DELETE' : 'UNCANCEL'
  return billOk && m.typedPhrase.trim().toUpperCase() === phrase
})

async function confirmDangerModal() {
  const m = dangerModal.value
  if (!m || !dangerModalReady.value) return
  try {
    if (m.mode === 'hard_delete') {
      await invoiceStore.hardDelete(m.inv.id)
      alert(`Invoice ${m.inv.bill_no} hard-deleted (history se hide). Number reserved.`)
    } else {
      await invoiceStore.uncancel(m.inv.id)
      alert(`Invoice ${m.inv.bill_no} un-cancelled — ledger/stock restore.`)
    }
    closeDangerModal()
  } catch (err: any) {
    alert(err?.message || String(err))
  }
}

async function lockSelectedSalesMonth() {
  const p = salesPeriodFromDate(lockMonth.value)
  if (!p) return alert('Month select karo')
  if (!confirm(`Lock sales bills for ${periodLabelYm(p)}?\n\nIs month ke bills create/edit/delete nahi ho payenge (payment allowed).`)) return
  const res = await firmStore.lockSalesMonth(p)
  if (!res.ok) return alert(res.error)
  alert(`${periodLabelYm(p)} locked.`)
}

async function unlockSelectedSalesMonth() {
  const p = salesPeriodFromDate(lockMonth.value)
  if (!p) return alert('Month select karo')
  if (!confirm(`Unlock ${periodLabelYm(p)}?\n\nPhir se bills edit/delete ho sakte hain.`)) return
  const res = await firmStore.unlockSalesMonth(p)
  if (!res.ok) return alert(res.error)
  alert(`${periodLabelYm(p)} unlocked.`)
}

function downloadPDF(inv?: Invoice) {
  const bill = inv || previewInvoice.value
  const firm = firmStore.activeFirm
  if (!bill || !firm) return alert('Bill ya firm nahi mila')
  try {
    downloadInvoicePdf(bill, firm, partyLookup)
  } catch (e: any) {
    alert('PDF generation failed: ' + (e?.message || 'unknown error'))
  }
}

async function bulkDownloadPDF() {
  const firm = firmStore.activeFirm
  if (!firm) return alert('Active firm set karein')
  if (!selectedHistoryIds.value.length) return alert('Kam se kam ek bill select karein')
  const selected = invoiceStore.list.filter((b) => selectedHistoryIds.value.includes(b.id))
  if (!selected.length) return alert('Selected bills nahi mile')
  try {
    const n = await bulkDownloadInvoicePdf(selected, firm, partyLookup, bulkPdfCopy.value)
    const copyLabel = INVOICE_PDF_COPY_OPTIONS.find((o) => o.value === bulkPdfCopy.value)?.label || 'Office copy'
    alert(`${n} ${copyLabel} PDF download ho gaye`)
  } catch (e: any) {
    alert('Bulk PDF failed: ' + (e?.message || 'unknown error'))
  }
}

async function sharePDFViaWhatsApp() {
  const inv = previewInvoice.value
  const firm = firmStore.activeFirm
  if (!inv || !firm) return
  try {
    downloadInvoicePdf(inv, firm, partyLookup)
  } catch { /* continue to WhatsApp */ }
  const msg = encodeURIComponent(
    `Invoice ${inv.bill_no} dated ${inv.date}\nAmount: ₹${n2(inv.grand_total)}\n\nPDF download ho gaya — chat me attach karein.`,
  )
  const phone = (inv.party_snapshot?.phone || '').replace(/\D/g, '')
  const url = phone ? `https://wa.me/91${phone}?text=${msg}` : `https://wa.me/?text=${msg}`
  window.open(url, '_blank')
}

function sharePDFViaEmail() {
  const inv = previewInvoice.value
  const firm = firmStore.activeFirm
  if (!inv || !firm) return
  try {
    downloadInvoicePdf(inv, firm, partyLookup)
  } catch { /* continue to email */ }
  const subject = encodeURIComponent(`Invoice ${inv.bill_no} — ${firm.name}`)
  const body = encodeURIComponent(
    `Dear ${inv.party_name},\n\nPlease find attached invoice ${inv.bill_no} dated ${inv.date}.\n\nTotal Amount: ₹${n2(inv.grand_total)}\nPayment Status: ${inv.pay_status}\n\nKindly attach the downloaded PDF before sending.\n\nThank you.`,
  )
  const to = inv.party_snapshot?.email || ''
  window.location.href = `mailto:${to}?subject=${subject}&body=${body}`
}

function generateStatementPDF() {
  const firm = firmStore.activeFirm
  if (!firm) return alert('Select a firm first')
  const ok = openStatementPrint(firm, invoiceStore.list, {
    from: stmtFrom.value || undefined,
    to: stmtTo.value || undefined,
    customer: stmtCustomer.value || undefined,
    payStatus: stmtPay.value || undefined,
    docType: stmtDoc.value || undefined,
    sort: 'dateDesc',
  })
  if (!ok) alert('No bills found for selected filters')
  else showStatementModal.value = false
}

function firmSignatureUrl(): string {
  const f = firmStore.activeFirm
  return f ? resolveFirmSignature(f) : ''
}

// Duplicate bill check
const isDuplicateBillNo = computed(() => {
  const currentVal = form.bill_no.trim()
  if (!currentVal) return false
  return invoiceStore.list.some(b => {
    return b.bill_no === currentVal && b.id !== editingId.value
  })
})

// Save Invoice to Dexie DB
async function saveInvoice() {
  if (savingInvoice.value) return
  if (!firmStore.activeFirmId) return alert('Please set up an active firm first.')
  if (!form.party_name.trim()) return alert('Customer name is required.')
  if (firmStore.isSalesLocked(form.date)) {
    return alert(salesMonthLockMessage(salesPeriodFromDate(form.date)))
  }
  
  const validItems = form.items.filter(row => row.name.trim() && row.qty > 0 && row.rate > 0)
  if (validItems.length === 0) return alert('At least one item with valid quantity and rate is required.')
  if (stockGuardWarnings.value.length) {
    return alert(`Stock guard: tracked item quantity exceeds on-hand.\n\n${stockGuardMessage.value}`)
  }

  if (isDuplicateBillNo.value && editingId.value) {
    if (!confirm('This invoice number already exists. Continue anyway?')) return
  }

  if (editingId.value && !form.bill_no.trim()) return alert('Invoice number required')

  if (form.doc_type === 'INVOICE') {
    for (const row of validItems) sanitizeHsnInput(row)
    const msg = buildBillGstConfirmMessage(validItems, rowHsnLookups.value)
    if (!confirm(msg)) return
  }

  const customerObj = partyStore.list.find(p => !p.is_deleted && p.name.toLowerCase() === form.party_name.trim().toLowerCase())

  // Adjust payment status based on amount paid vs grand total
  let finalPayStatus = form.pay_status
  if (Math.abs(form.amt_paid - grandTotal.value) < 0.01) finalPayStatus = 'PAID'
  else if (form.amt_paid > 0 && form.amt_paid < grandTotal.value) finalPayStatus = 'PARTIAL'
  else if (form.amt_paid === 0) finalPayStatus = 'UNPAID'

  const invoiceData: Omit<Invoice, 'id' | 'firm_id' | 'created_at' | 'updated_at' | 'is_deleted' | '_dirty'> = {
    doc_type: form.doc_type,
    bill_no: editingId.value ? form.bill_no.trim() : '',
    date: form.date,
    ref: form.ref,
    party_id: form.party_id,
    party_name: form.party_name.trim(),
    party_snapshot: customerObj ? {
      addr: customerObj.addr,
      city: customerObj.city,
      pin: customerObj.pin,
      email: customerObj.email,
      phone: customerObj.phone,
      gst: formatGstin(customerObj.gst),
      state: customerObj.state,
      is_consumer: customerObj.is_consumer
    } : { name: form.party_name.trim() },
    sameAsBuyer: form.sameAsBuyer,
    ship: form.sameAsBuyer ? null : {
      name: form.ship.name.trim(),
      addr: form.ship.addr.trim(),
      city: form.ship.city.trim(),
      pin: form.ship.pin.trim(),
      email: form.ship.email.trim(),
      gstin: form.ship.gstin.trim().toUpperCase(),
      state: form.ship.state.trim()
    },
    dispatch: form.dispatch.trim(),
    lr: form.lr.trim(),
    vehicle: form.vehicle.trim().toUpperCase(),
    transMode: form.transMode,
    transporterName: form.transporterName.trim(),
    transporterId: form.transporterId.trim().toUpperCase(),
    eway: form.eway.trim(),
    dest: form.dest.trim(),
    distance: form.distance || 0,
    docNo: form.docNo.trim(),
    payment: form.payment,
    gst_type: form.gst_type,
    items: validItems,
    taxBuckets: taxBuckets.value,
    sub: subTotal.value,
    total_tax: totalTax.value,
    round_off: roundOff.value,
    grand_total: grandTotal.value,
    amt_paid: form.amt_paid,
    pay_status: finalPayStatus,
    notes: form.notes.trim()
  }

  try {
    savingInvoice.value = true
    const wasEditing = !!editingId.value
    if (wasEditing) {
      const editReason = prompt('Enter the reason for modifying this invoice:') || 'Update'
      await invoiceStore.update(editingId.value!, { ...invoiceData, editReason })
      alert('Invoice updated successfully!')
    } else {
      const savedInvoice = await invoiceStore.add(invoiceData, true)
      const ewayNote = tryAutoEwayDownload(savedInvoice)
      const firm = firmStore.activeFirm
      if (firm) {
        try {
          downloadInvoicePdf(savedInvoice, firm, partyLookup)
        } catch (pdfErr: any) {
          console.warn('PDF after save failed', pdfErr)
        }
      }
      openPrintPreview(savedInvoice)
      alert(`Invoice ${savedInvoice.bill_no} saved.${ewayNote}\n\nPDF download shuru ho gaya — preview me dubara PDF le sakte ho.`)
    }

    validItems.forEach(async row => {
      const it = itemStore.list.find(item => !item.is_deleted && item.name.toLowerCase() === row.name.toLowerCase())
      if (it) {
        await itemStore.update(it.id, { rate: row.rate })
      }
    })

    resetForm()
    if (wasEditing) activeTab.value = 'history'
  } catch (err: any) {
    console.error(err)
    alert('Failed to save invoice: ' + (err?.message || String(err)))
  } finally {
    savingInvoice.value = false
  }
}

// Edit existing invoice
function editInvoice(inv: Invoice) {
  if (isInvoiceCancelled(inv)) {
    alert(`Invoice ${inv.bill_no} cancelled hai — pehle Un-cancel karo.`)
    return
  }
  if (firmStore.isSalesLocked(inv.date)) {
    alert(salesMonthLockMessage(salesPeriodFromDate(inv.date)))
    return
  }
  editingId.value = inv.id
  Object.assign(form, {
    doc_type: inv.doc_type,
    bill_no: inv.bill_no,
    date: inv.date,
    ref: inv.ref || '',
    party_id: inv.party_id,
    party_name: inv.party_name,
    sameAsBuyer: inv.sameAsBuyer !== false,
    ship: inv.ship ? {
      name: inv.ship.name,
      addr: inv.ship.addr,
      city: inv.ship.city,
      pin: inv.ship.pin,
      email: inv.ship.email,
      gstin: inv.ship.gstin,
      state: inv.ship.state
    } : { name: '', addr: '', city: '', pin: '', email: '', gstin: '', state: '' },
    dispatch: inv.dispatch || '',
    lr: inv.lr || '',
    vehicle: inv.vehicle || '',
    transMode: inv.transMode || '1',
    transporterName: inv.transporterName || '',
    transporterId: inv.transporterId || '',
    eway: inv.eway || '',
    dest: inv.dest || '',
    distance: inv.distance || 0,
    docNo: inv.docNo || '',
    payment: inv.payment || 'CASH',
    gst_type: inv.gst_type,
    items: [],
    notes: inv.notes || '',
    amt_paid: inv.amt_paid || 0,
    pay_status: inv.pay_status || 'UNPAID'
  })

  form.items = inv.items.map(row => ({ ...row }))
  activeTab.value = 'new'
}

// Copy invoice as new draft
function copyInvoice(inv: Invoice) {
  resetForm()
  Object.assign(form, {
    doc_type: inv.doc_type,
    bill_no: '',
    date: new Date().toISOString().slice(0, 10),
    ref: inv.ref || '',
    party_id: inv.party_id,
    party_name: inv.party_name,
    sameAsBuyer: inv.sameAsBuyer !== false,
    ship: inv.ship ? {
      name: inv.ship.name,
      addr: inv.ship.addr,
      city: inv.ship.city,
      pin: inv.ship.pin,
      email: inv.ship.email,
      gstin: inv.ship.gstin,
      state: inv.ship.state
    } : { name: '', addr: '', city: '', pin: '', email: '', gstin: '', state: '' },
    dispatch: inv.dispatch || '',
    lr: inv.lr || '',
    vehicle: inv.vehicle || '',
    transMode: inv.transMode || '1',
    transporterName: inv.transporterName || '',
    transporterId: inv.transporterId || '',
    eway: inv.eway || '',
    dest: inv.dest || '',
    distance: inv.distance || 0,
    docNo: inv.docNo || '',
    payment: inv.payment || 'CASH',
    gst_type: inv.gst_type,
    items: [],
    notes: inv.notes || '',
    amt_paid: 0,
    pay_status: 'UNPAID' as PayStatus
  })

  form.items = inv.items.map(row => ({ ...row }))
  activeTab.value = 'new'
  alert('Invoice copied as a new draft!')
}

// History Filters
const historyCustomers = computed(() => {
  const names = new Set(invoiceStore.list.map(i => i.party_name).filter(Boolean))
  return [...names].sort()
})

const filteredInvoicesBase = computed(() => {
  const q = search.value.toLowerCase().trim()
  return invoiceStore.list.filter(inv => {
    if (inv.is_deleted) return false
    if (hideCancelled.value && isInvoiceCancelled(inv)) return false
    if (statusFilter.value === 'cancelled') {
      if (!isInvoiceCancelled(inv)) return false
    } else if (statusFilter.value !== 'all' && inv.pay_status !== statusFilter.value) {
      return false
    }
    if (histFrom.value && inv.date < histFrom.value) return false
    if (histTo.value && inv.date > histTo.value) return false
    if (histCustomer.value && inv.party_name !== histCustomer.value) return false
    if (!q) return true
    return inv.bill_no.toLowerCase().includes(q) || inv.party_name.toLowerCase().includes(q)
  })
})

type SalesSortKey = 'date' | 'bill_no' | 'party_name' | 'grand_total' | 'amt_paid' | 'outstanding' | 'pay_status'
const salesSort = useTableSort<SalesSortKey>('date', 'desc')
const filteredInvoices = salesSort.sortedFrom(filteredInvoicesBase, {
  date: (r) => r.date,
  bill_no: (r) => r.bill_no,
  party_name: (r) => r.party_name,
  grand_total: (r) => r.grand_total,
  amt_paid: (r) => r.amt_paid || 0,
  outstanding: (r) => r.grand_total - (r.amt_paid || 0),
  pay_status: (r) => r.pay_status,
})

// Outstanding payment recorder modal actions
function openPaymentModal(inv: Invoice) {
  payInvoiceId.value = inv.id
  const outstanding = inv.grand_total - inv.amt_paid
  payAmount.value = outstanding > 0 ? parseFloat(outstanding.toFixed(2)) : 0
  payDate.value = new Date().toISOString().slice(0, 10)
  payNote.value = ''
  payWriteOff.value = false
  showPaymentModal.value = true
}

// Automatic write-off check
const isWriteOffSuggested = computed(() => {
  const inv = invoiceStore.list.find(i => i.id === payInvoiceId.value)
  if (!inv) return false
  const outstanding = inv.grand_total - inv.amt_paid
  const diff = Math.round((outstanding - payAmount.value) * 100) / 100
  return diff > 0 && diff <= 50
})

async function savePayment() {
  if (!payInvoiceId.value) return
  if (payAmount.value <= 0) return alert('Amount must be positive.')

  await invoiceStore.recordPayment(
    payInvoiceId.value,
    payAmount.value,
    payWriteOff.value,
    payNote.value,
    payDate.value,
  )
  showPaymentModal.value = false
  alert('Payment recorded successfully!')
}

// PDF/Print preview generator
function openPrintPreview(inv: Invoice) {
  previewInvoice.value = inv
  showPrintPreview.value = true
}

function printInvoice() {
  window.print()
}

// Templates management (localStorage)
function saveAsTemplate() {
  const validItems = form.items.filter(row => row.name.trim() && row.qty > 0 && row.rate > 0)
  if (validItems.length === 0) return alert('Cannot save an empty template.')
  
  templateName.value = ''
  templateDesc.value = ''
  showTemplateModal.value = true
}

function confirmSaveTemplate() {
  if (!templateName.value.trim()) return alert('Template name required')

  const validItems = form.items.filter(row => row.name.trim() && row.qty > 0 && row.rate > 0)
  const newTpl: Template = {
    id: uid(),
    name: templateName.value.trim(),
    desc: templateDesc.value.trim(),
    custName: form.party_name,
    items: validItems.map(row => ({
      name: row.name,
      hsn: row.hsn,
      size: row.size || '',
      gsm: row.gsm || '',
      bf: row.bf || '',
      extra: row.extra || '',
      qty: row.qty,
      unit: row.unit,
      rate: row.rate,
      gst: row.gst
    })),
    payment: form.payment,
    createdAt: new Date().toISOString()
  }

  templatesList.value.push(newTpl)
  localStorage.setItem('pama_templates_suite', JSON.stringify(templatesList.value))
  showTemplateModal.value = false
  alert('Template saved successfully!')
}

function deleteTemplate(id: string) {
  if (confirm('Delete this template?')) {
    const t = templatesList.value.find(x => x.id === id)
    if (t) (t as Template & { deletedAt?: string }).deletedAt = new Date().toISOString()
    templatesList.value = templatesList.value.filter(x => !(x as Template & { deletedAt?: string }).deletedAt)
    const all = JSON.parse(localStorage.getItem('pama_templates_suite') || '[]') as (Template & { deletedAt?: string })[]
    const item = all.find(x => x.id === id)
    if (item) item.deletedAt = new Date().toISOString()
    localStorage.setItem('pama_templates_suite', JSON.stringify(all))
  }
}

function applyTemplate(tpl: Template) {
  resetForm()
  form.party_name = tpl.custName
  handleCustSelect()
  form.payment = tpl.payment
  form.items = []
  
  tpl.items.forEach(item => {
    addRow({
      name: item.name,
      hsn: item.hsn,
      size: item.size,
      gsm: item.gsm,
      bf: item.bf,
      extra: item.extra,
      qty: item.qty,
      unit: item.unit,
      rate: item.rate,
      gst: item.gst
    })
  })

  activeTab.value = 'new'
  alert(`Template "${tpl.name}" applied successfully.`)
}

function applyBoxCalcPrefill() {
  const raw = sessionStorage.getItem('pama_billing_prefill')
  if (!raw) return false
  sessionStorage.removeItem('pama_billing_prefill')
  try {
    const pre = JSON.parse(raw) as { party_name?: string; items?: Partial<InvoiceItemLine>[] }
    Object.assign(form, initialFormState())
    if (pre.party_name) {
      form.party_name = pre.party_name
      handleCustSelect()
    }
    form.items = []
    for (const it of pre.items || []) addRow(it)
    if (form.items.length === 0) addRow()
    activeTab.value = 'new'
    return true
  } catch {
    return false
  }
}

onMounted(async () => {
  defaultEwayDates()
  await firmStore.load()
  await Promise.all([
    invoiceStore.load(),
    partyStore.load(),
    itemStore.load(),
    purchaseStore.load(),
    accountingStore.load(),
  ])
  stockMovements.value = await listItemStockMovements(firmStore.activeFirmId, { limit: 1000 })
  if (!applyBoxCalcPrefill()) resetForm()

  // Load templates from localStorage
  const saved = localStorage.getItem('pama_templates_suite')
  if (saved) {
    try {
      templatesList.value = (JSON.parse(saved) as (Template & { deletedAt?: string })[]).filter(t => !t.deletedAt)
    } catch { templatesList.value = [] }
  }
})
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto hide-on-print">
    <!-- Navbar Shell -->
    <header class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-bold text-navy flex items-center gap-2">
          🧾 Billing <span class="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold" v-if="editingId">EDIT MODE</span>
        </h1>
        <p class="text-sm text-slate-500">GST invoices, Credit/Debit notes and client receipts</p>
      </div>

      <div class="flex gap-2 self-start flex-wrap">
        <button v-if="activeTab === 'new'" @click="repeatLastBill" class="pp-btn pp-btn-ghost !text-xs">🔁 Repeat Last Bill</button>
        <button v-if="activeTab === 'history'" @click="showStatementModal = true" class="pp-btn pp-btn-ghost !text-xs">📄 Customer Statement</button>
      </div>

      <!-- Navigation Tabs -->
      <div class="flex bg-slate-200/80 p-1 rounded-lg self-start">
        <button @click="activeTab = 'new'"
          :class="['px-3 py-1.5 text-xs font-semibold rounded-md transition-colors', activeTab === 'new' ? 'bg-white text-navy shadow-sm' : 'text-slate-600 hover:text-navy']">
          New Bill
        </button>
        <button @click="activeTab = 'history'"
          :class="['px-3 py-1.5 text-xs font-semibold rounded-md transition-colors', activeTab === 'history' ? 'bg-white text-navy shadow-sm' : 'text-slate-600 hover:text-navy']">
          Sales History
        </button>
        <button @click="activeTab = 'templates'"
          :class="['px-3 py-1.5 text-xs font-semibold rounded-md transition-colors', activeTab === 'templates' ? 'bg-white text-navy shadow-sm' : 'text-slate-600 hover:text-navy']">
          Templates
        </button>
        <button @click="activeTab = 'eway'"
          :class="['px-3 py-1.5 text-xs font-semibold rounded-md transition-colors', activeTab === 'eway' ? 'bg-white text-navy shadow-sm' : 'text-slate-600 hover:text-navy']">
          E-Way Bill
        </button>
      </div>
    </header>

    <!-- TAB 1: NEW BILL FORM -->
    <div v-if="activeTab === 'new'" class="grid grid-cols-1 lg:grid-cols-4 gap-6">
      <!-- Autocompletes -->
      <datalist id="customerList">
        <option v-for="c in partyStore.list.filter(p => !p.is_deleted)" :key="c.id" :value="c.name" />
      </datalist>
      <datalist id="itemList">
        <option v-for="it in itemStore.list.filter(i => !i.is_deleted)" :key="it.id" :value="it.name" />
      </datalist>
      <datalist id="hsn4List">
        <option v-for="code in hsn4Options" :key="code" :value="code" />
      </datalist>

      <!-- Main Form Area -->
      <div class="lg:col-span-3 space-y-6">
        <div v-if="formEwayEligibility.show" class="pp-card p-3 border border-amber-200 bg-amber-50 text-sm text-amber-900">
          🚚 <strong>E-Way:</strong> {{ formEwayEligibility.reason }}
          <span class="block text-xs mt-1 text-amber-800">
            Save par ek saath NIC JSON download hoga (vehicle number transport me bharein).
          </span>
          <span v-if="formEwayEligibility.level === 'suggested'" class="block text-xs mt-1 text-amber-800">
            Inter-state ₹50,000 se kam — JSON optional hai.
          </span>
        </div>
        <div class="pp-card p-5 space-y-4">
          <!-- Doc type, Date & Invoice No -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label class="pp-label">Document Type</label>
              <select v-model="form.doc_type" class="pp-input">
                <option value="INVOICE">Tax Invoice</option>
                <option value="BILL_OF_SUPPLY">Bill of Supply</option>
                <option value="CREDIT_NOTE">Credit Note</option>
                <option value="DEBIT_NOTE">Debit Note</option>
              </select>
            </div>
            <div>
              <label class="pp-label">Invoice Number</label>
              <input
                v-if="editingId"
                v-model="form.bill_no"
                class="pp-input"
              />
              <input
                v-else
                :value="nextBillPreview"
                readonly
                class="pp-input bg-slate-50 font-semibold text-navy"
                :placeholder="nextBillPreview || 'INV-0001'"
              />
              <span v-if="!editingId" class="text-[10px] text-slate-500 mt-1 block">
                Auto on save — next: <strong>{{ nextBillPreview || '—' }}</strong>
              </span>
              <span v-if="isDuplicateBillNo && editingId" class="text-xs text-danger font-semibold mt-1 block">⚠️ Duplicate Invoice Number</span>
            </div>
            <div>
              <label class="pp-label">Date</label>
              <input v-model="form.date" type="date" class="pp-input" />
            </div>
          </div>

          <!-- Customer details -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-100 pt-4">
            <div>
              <div class="flex items-center justify-between gap-2 mb-1">
                <label class="pp-label !mb-0">Client / Buyer *</label>
                <button type="button" class="pp-btn pp-btn-ghost !px-2 !py-1 text-xs" @click="openQuickCust">+ Add Customer</button>
              </div>
              <input v-model="form.party_name" list="customerList" @input="handleCustSelect" class="pp-input" placeholder="Search or type buyer name..." />
              <p v-if="gstinFeedback.msg" class="text-xs mt-1" :class="gstinFeedback.ok ? 'text-emerald-600' : 'text-amber-600'">{{ gstinFeedback.msg }}</p>
            </div>
            <div>
              <label class="pp-label">Reference / PO No.</label>
              <input v-model="form.ref" class="pp-input" placeholder="PO-12345 (Optional)" />
            </div>
          </div>

          <!-- Billing & shipping address preview -->
          <div v-if="showFormAddresses" class="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-slate-100 pt-4">
            <div class="p-3 rounded-xl border border-blue-200 bg-blue-50/60">
              <h3 class="text-xs font-bold text-blue-900 uppercase tracking-wider mb-2">Bill To (Billing)</h3>
              <p class="font-semibold text-navy text-sm">{{ formBuyerDisplay!.name }}</p>
              <p v-if="formBuyerDisplay!.addr" class="text-xs text-slate-700 mt-1 whitespace-pre-wrap">{{ formBuyerDisplay!.addr }}</p>
              <p v-if="formBuyerDisplay!.city || formBuyerDisplay!.pin" class="text-xs text-slate-600 mt-0.5">
                {{ [formBuyerDisplay!.city, formBuyerDisplay!.pin].filter(Boolean).join(' - ') }}
              </p>
              <p v-if="formBuyerDisplay!.is_consumer" class="text-xs text-emerald-700 font-semibold mt-1">Consumer (B2C)</p>
              <p v-else-if="formBuyerDisplay!.gst" class="text-xs font-mono font-semibold mt-1">GSTIN: {{ formBuyerDisplay!.gst }}</p>
              <p v-if="formBuyerDisplay!.state" class="text-xs text-slate-500 mt-0.5">
                {{ getStateName(formBuyerDisplay!.gst || formBuyerDisplay!.state) }} ({{ formBuyerDisplay!.state }})
              </p>
              <p v-if="!formBuyerDisplay!.addr" class="text-xs text-amber-700 mt-2">Address missing — Parties me edit karein</p>
            </div>
            <div class="p-3 rounded-xl border border-emerald-200 bg-emerald-50/60">
              <h3 class="text-xs font-bold text-emerald-900 uppercase tracking-wider mb-2">Ship To (Consignee)</h3>
              <template v-if="form.sameAsBuyer">
                <p class="text-sm text-slate-600 italic mb-1">Same as billing address</p>
                <p class="font-semibold text-navy text-sm">{{ formBuyerDisplay!.name }}</p>
                <p v-if="formBuyerDisplay!.addr" class="text-xs text-slate-700 mt-1 whitespace-pre-wrap">{{ formBuyerDisplay!.addr }}</p>
                <p v-if="formBuyerDisplay!.city || formBuyerDisplay!.pin" class="text-xs text-slate-600 mt-0.5">
                  {{ [formBuyerDisplay!.city, formBuyerDisplay!.pin].filter(Boolean).join(' - ') }}
                </p>
              </template>
              <template v-else-if="formShipDisplay">
                <p class="font-semibold text-navy text-sm">{{ formShipDisplay.name }}</p>
                <p v-if="formShipDisplay.addr" class="text-xs text-slate-700 mt-1 whitespace-pre-wrap">{{ formShipDisplay.addr }}</p>
                <p v-if="formShipDisplay.city || formShipDisplay.pin" class="text-xs text-slate-600 mt-0.5">
                  {{ [formShipDisplay.city, formShipDisplay.pin].filter(Boolean).join(' - ') }}
                </p>
                <p v-if="formShipDisplay.gstin" class="text-xs font-mono font-semibold mt-1">GSTIN: {{ formShipDisplay.gstin }}</p>
                <p v-if="formShipDisplay.state" class="text-xs text-slate-500 mt-0.5">
                  {{ getStateName(formShipDisplay.gstin || formShipDisplay.state) }} ({{ formShipDisplay.state }})
                </p>
              </template>
              <template v-else>
                <p class="text-sm text-amber-700">Alag consignee — neeche shipping details bharein</p>
              </template>
            </div>
          </div>

          <!-- Shipping toggle & grid -->
          <div class="border-t border-slate-100 pt-4">
            <div class="flex items-center gap-2 mb-3">
              <input type="checkbox" v-model="form.sameAsBuyer" id="sameAsBuyer" class="rounded border-slate-300 text-accent focus:ring-accent" />
              <label for="sameAsBuyer" class="text-sm font-semibold text-slate-700 cursor-pointer">Consignee same as Buyer (Shipping matches Billing)</label>
            </div>

            <!-- Separate Consignee details -->
            <div v-if="!form.sameAsBuyer" class="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
              <h3 class="text-xs font-bold text-slate-500 uppercase tracking-wider">Consignee Shipping Details</h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label class="pp-label">Consignee Name</label><input v-model="form.ship.name" class="pp-input" /></div>
                <div><label class="pp-label">GSTIN</label><input v-model="form.ship.gstin" @input="detectGstType" class="pp-input uppercase" placeholder="05ABCDE1234F1Z5" /></div>
              </div>
              <div><label class="pp-label">Address</label><input v-model="form.ship.addr" class="pp-input" /></div>
              <div class="grid grid-cols-3 gap-3">
                <div><label class="pp-label">City</label><input v-model="form.ship.city" class="pp-input" /></div>
                <div><label class="pp-label">PIN</label><input v-model="form.ship.pin" class="pp-input" /></div>
                <div><label class="pp-label">State Code</label><input v-model="form.ship.state" @input="detectGstType" class="pp-input" placeholder="05" /></div>
              </div>
            </div>
          </div>

          <!-- Transport accordian collapse -->
          <details class="border-t border-slate-100 pt-4 group">
            <summary class="flex justify-between items-center text-sm font-bold text-slate-600 cursor-pointer list-none select-none">
              <span>🚚 Dispatch &amp; Transport Details</span>
              <span class="transition-transform group-open:rotate-180">▼</span>
            </summary>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
              <div><label class="pp-label">Dispatch via</label><input v-model="form.dispatch" class="pp-input" placeholder="Road, Courier..." /></div>
              <div><label class="pp-label">LR/RR No.</label><input v-model="form.lr" class="pp-input" /></div>
              <div><label class="pp-label">Vehicle Number</label><input v-model="form.vehicle" class="pp-input uppercase" placeholder="UA-07-C-1234" /></div>
              <div><label class="pp-label">Transporter ID</label><input v-model="form.transporterId" class="pp-input uppercase" /></div>
              <div><label class="pp-label">Transporter Name</label><input v-model="form.transporterName" class="pp-input" /></div>
              <div><label class="pp-label">E-Way Bill No.</label><input v-model="form.eway" class="pp-input" /></div>
              <div><label class="pp-label">Destination</label><input v-model="form.dest" class="pp-input" /></div>
              <div><label class="pp-label">Distance (km)</label><input v-model.number="form.distance" type="number" class="pp-input" /></div>
              <div><label class="pp-label">Document No.</label><input v-model="form.docNo" class="pp-input" /></div>
            </div>
          </details>
        </div>

        <!-- Items Entry Table -->
        <div class="pp-card overflow-hidden">
          <div class="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
            <h2 class="font-bold text-navy">Goods Description &amp; Rows</h2>
            <div class="flex gap-2">
              <button type="button" @click="openQuickItem" class="pp-btn pp-btn-ghost !px-2.5 !py-1 text-xs">+ Add Item</button>
              <button @click="addRow()" class="pp-btn pp-btn-ghost !px-2.5 !py-1 text-xs">+ Add Row</button>
            </div>
          </div>
          <div v-if="stockGuardWarnings.length" class="m-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <strong>Stock guard:</strong> Cannot save because tracked item quantity exceeds on-hand stock.
            <ul class="mt-1 list-disc pl-5 text-xs space-y-0.5">
              <li v-for="w in stockGuardWarnings" :key="w.itemId">
                {{ w.name }}: billing {{ qtyLabel(w.requested, w.unit) }}, on-hand {{ qtyLabel(w.available, w.unit) }}
              </li>
            </ul>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead class="bg-slate-100 text-slate-500 uppercase font-semibold">
                <tr>
                  <th class="px-2 py-2 text-center w-8">Sl</th>
                  <th class="px-2 py-2 text-left min-w-[220px]">Item Description</th>
                  <th class="px-2 py-2 text-center w-24">HSN</th>
                  <th class="px-2 py-2 text-right w-24">Qty</th>
                  <th class="px-2 py-2 text-center w-20">Unit</th>
                  <th class="px-2 py-2 text-right w-28">Rate</th>
                  <th class="px-2 py-2 text-center w-20">GST%</th>
                  <th class="px-2 py-2 text-right w-24">Amt</th>
                  <th class="px-2 py-2 text-center w-8">✕</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, idx) in form.items" :key="idx"
                  :class="['border-t border-slate-100 align-top', rowHasStockWarning(row) ? 'bg-red-50' : isRowIncomplete(row) ? 'bg-amber-50/50' : 'hover:bg-slate-50/30']">
                  <td class="text-center font-bold text-slate-400 py-2">{{ idx + 1 }}</td>
                  <td class="p-1 min-w-[220px]">
                    <input v-model="row.name" list="itemList" @input="handleItemSelect(row)" class="pp-input !py-1.5 !px-2 w-full" placeholder="Product name..." />
                    <div class="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                      <input v-model="row.size" class="pp-input !py-1 !px-2 text-center min-w-0" placeholder="Size" title="Size" />
                      <input v-model="row.gsm" class="pp-input !py-1 !px-2 text-center min-w-0" placeholder="GSM" title="GSM" />
                      <input v-model="row.bf" class="pp-input !py-1 !px-2 text-center min-w-0" placeholder="BF" title="BF" />
                      <input v-model="row.extra" class="pp-input !py-1 !px-2 min-w-0" placeholder="Extra" title="Extra" />
                    </div>
                  </td>
                  <td class="p-1">
                    <input
                      v-model="row.hsn"
                      list="hsn4List"
                      maxlength="4"
                      inputmode="numeric"
                      class="pp-input !py-1.5 !px-2 text-center w-full min-w-[4.5rem] font-mono"
                      placeholder="4804"
                      title="4-digit HSN — GST auto from official slab"
                      @input="sanitizeHsnInput(row)"
                      @blur="onHsnBlur(row, idx)"
                    />
                    <p v-if="hsnLookupBusy[idx]" class="text-[10px] text-slate-400 mt-0.5">GST lookup…</p>
                  </td>
                  <td class="p-1">
                    <input v-model.number="row.qty" type="number" step="0.001" :class="['pp-input !py-1.5 !px-2.5 text-right w-full min-w-[5.5rem]', rowHasStockWarning(row) ? 'border-red-300 bg-red-50' : '']" />
                  </td>
                  <td class="p-1">
                    <select v-model="row.unit" class="pp-input !py-1.5 !px-1.5 text-center w-full min-w-[4.5rem]">
                      <option>KG</option>
                      <option>PCS</option>
                      <option>MTR</option>
                      <option>TON</option>
                      <option>REAM</option>
                      <option>BOX</option>
                      <option>NOS</option>
                    </select>
                  </td>
                  <td class="p-1">
                    <input v-model.number="row.rate" type="number" step="0.01" class="pp-input !py-1.5 !px-2.5 text-right w-full min-w-[6rem]" />
                  </td>
                  <td class="p-1">
                    <select v-model.number="row.gst" class="pp-input !py-1.5 !px-1.5 text-center w-full min-w-[4.5rem]">
                      <option :value="0">0%</option>
                      <option :value="5">5%</option>
                      <option :value="12">12%</option>
                      <option :value="18">18%</option>
                      <option :value="28">28%</option>
                    </select>
                  </td>
                  <td class="p-1 text-right font-semibold text-navy pr-3 pt-2 whitespace-nowrap">
                    ₹ {{ n2(row.qty * row.rate) }}
                  </td>
                  <td class="p-1 text-center pt-2">
                    <button @click="removeRow(idx)" class="text-danger hover:text-red-700 text-sm font-bold">✕</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="pp-card p-5">
          <label class="pp-label">Notes / Remarks</label>
          <textarea v-model="form.notes" class="pp-input" rows="2" placeholder="Invoice details, terms..."></textarea>
        </div>
      </div>

      <!-- Right Totals Side-Card -->
      <div class="space-y-6">
        <div class="pp-card p-5 space-y-4">
          <h2 class="font-bold text-navy border-b border-slate-100 pb-2">Invoice Summary</h2>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between text-slate-500">
              <span>Sub Total:</span>
              <span class="font-semibold text-navy">₹ {{ n2(subTotal) }}</span>
            </div>

            <!-- Tax Breakdown -->
            <div class="border-t border-slate-100/60 pt-2 space-y-1.5">
              <div v-for="(b, pct) in taxBuckets" :key="pct" class="text-xs text-slate-500 space-y-0.5">
                <div v-if="form.gst_type === 'intra'" class="flex justify-between">
                  <span>CGST @{{ Number(pct)/2 }}% + SGST @{{ Number(pct)/2 }}%:</span>
                  <span>₹ {{ n2(b.tax) }}</span>
                </div>
                <div v-else class="flex justify-between">
                  <span>IGST @{{ pct }}%:</span>
                  <span>₹ {{ n2(b.tax) }}</span>
                </div>
              </div>
            </div>

            <div class="flex justify-between text-slate-500 border-t border-slate-100 pt-2">
              <span>Round Off:</span>
              <span>₹ {{ n2(roundOff) }}</span>
            </div>

            <div class="flex justify-between font-bold text-base text-navy pt-2 border-t border-slate-200">
              <span>Grand Total:</span>
              <span>₹ {{ n2(grandTotal) }}</span>
            </div>
            <div class="text-[10px] text-slate-400 italic mt-1 leading-normal">
              {{ numberToWords(grandTotal) }}
            </div>
          </div>

          <div class="border-t border-slate-200 pt-4 space-y-3">
            <div>
              <label class="pp-label">Payment mode</label>
              <select v-model="form.payment" class="pp-input">
                <option value="CASH">Cash</option>
                <option value="BANK">Bank Transfer (RTGS/NEFT)</option>
                <option value="CC">Credit Account</option>
              </select>
            </div>
            <div>
              <label class="pp-label">Payment Status</label>
              <select v-model="form.pay_status" @change="onPayStatusChange" class="pp-input">
                <option value="UNPAID">Unpaid</option>
                <option value="PARTIAL">Partial</option>
                <option value="PAID">Paid (Full)</option>
              </select>
            </div>
            <div v-if="form.pay_status !== 'UNPAID'">
              <label class="pp-label">Amount Paid (₹)</label>
              <input v-model.number="form.amt_paid" type="number" class="pp-input" />
            </div>
          </div>

          <div class="flex gap-2 pt-2">
            <button
              @click="saveInvoice"
              class="pp-btn pp-btn-primary flex-1"
              :disabled="savingInvoice || formMonthLocked"
              :title="formMonthLocked ? salesMonthLockMessage(salesPeriodFromDate(form.date)) : ''"
            >
              {{ savingInvoice ? 'Saving…' : (formMonthLocked ? '🔒 Month locked' : saveButtonLabel) }}
            </button>
            <button @click="saveAsTemplate" class="pp-btn pp-btn-ghost" title="Save as template">💾</button>
          </div>
          <p v-if="formMonthLocked" class="text-[11px] text-rose-700 bg-rose-50 border border-rose-100 rounded px-2 py-1.5">
            {{ salesMonthLockMessage(salesPeriodFromDate(form.date)) }}
            Sales History se unlock kar sakte ho.
          </p>
          <p v-if="!editingId" class="text-[10px] text-slate-500 leading-relaxed">
            Save par invoice number auto + PDF download (3 copies).
          </p>
          <button @click="resetForm" class="pp-btn pp-btn-ghost w-full text-xs">Reset Form</button>
        </div>
      </div>
    </div>

    <!-- TAB 2: SALES HISTORY -->
    <div v-if="activeTab === 'history'" class="space-y-4">
      <div class="pp-card p-3 flex flex-wrap gap-3 items-end bg-amber-50/60 border-amber-100">
        <div>
          <label class="pp-label">Sales month lock (GSTR-1)</label>
          <input v-model="lockMonth" type="month" class="pp-input !w-40" />
        </div>
        <button
          type="button"
          class="pp-btn pp-btn-primary !text-xs"
          :disabled="lockMonthLocked"
          @click="lockSelectedSalesMonth"
        >
          🔒 Lock month
        </button>
        <button
          type="button"
          class="pp-btn pp-btn-ghost !text-xs border-amber-300"
          :disabled="!lockMonthLocked"
          @click="unlockSelectedSalesMonth"
        >
          🔓 Unlock month
        </button>
        <p class="text-[11px] text-amber-900 w-full sm:w-auto sm:flex-1 leading-relaxed">
          GSTR-1 file ke baad month lock karo — us month ke sale bills edit/delete nahi honge.
          Payment record phir bhi chalega. Purchases par asar nahi.
          <span v-if="lockedMonthsList.length" class="block mt-1 font-semibold">
            Locked: {{ lockedMonthsList.map(periodLabelYm).join(', ') }}
          </span>
        </p>
      </div>

      <div class="flex gap-3 flex-wrap items-end">
        <input v-model="search" class="pp-input max-w-xs" placeholder="Search Bill No / Client..." />
        <input v-model="histFrom" type="date" class="pp-input !w-36" title="From date" />
        <input v-model="histTo" type="date" class="pp-input !w-36" title="To date" />
        <select v-model="histCustomer" class="pp-input max-w-[180px]">
          <option value="">All customers</option>
          <option v-for="c in historyCustomers" :key="c" :value="c">{{ c }}</option>
        </select>
        <select v-model="statusFilter" class="pp-input max-w-[160px]">
          <option value="all">All statuses</option>
          <option value="PAID">Paid</option>
          <option value="PARTIAL">Partial</option>
          <option value="UNPAID">Unpaid</option>
          <option value="cancelled">Cancelled only</option>
        </select>
        <label class="inline-flex items-center gap-1.5 text-xs text-slate-600 self-center">
          <input v-model="hideCancelled" type="checkbox" class="h-4 w-4" />
          Hide cancelled
        </label>
        <select
          v-if="selectedHistoryIds.length"
          v-model="bulkPdfCopy"
          class="pp-input max-w-[160px] !text-xs"
          title="Kaun si copy print karni hai"
        >
          <option v-for="opt in INVOICE_PDF_COPY_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
        <button
          v-if="selectedHistoryIds.length"
          class="pp-btn pp-btn-primary !text-xs"
          @click="bulkDownloadPDF"
        >📥 Bulk PDF ({{ selectedHistoryIds.length }})</button>
        <button
          v-if="selectedHistoryIds.length"
          class="pp-btn pp-btn-danger !text-xs"
          @click="bulkCancelHistory"
        >✕ Cancel {{ selectedHistoryIds.length }} selected</button>
        <span class="ml-auto self-center text-sm text-slate-400">{{ filteredInvoices.length }} invoices found</span>
      </div>

      <div class="pp-card overflow-x-auto">
        <table class="w-full text-sm min-w-[900px]">
          <thead class="bg-slate-50 text-slate-500 text-xs uppercase font-semibold">
            <tr>
              <th class="w-8 px-2 py-2.5"></th>
              <th class="px-4 py-2.5" :class="salesSort.thClass('date')" @click="salesSort.toggle('date', 'desc')">Date{{ salesSort.indicator('date') }}</th>
              <th class="px-4 py-2.5" :class="salesSort.thClass('bill_no')" @click="salesSort.toggle('bill_no')">Bill No{{ salesSort.indicator('bill_no') }}</th>
              <th class="px-4 py-2.5" :class="salesSort.thClass('party_name')" @click="salesSort.toggle('party_name')">Client Name{{ salesSort.indicator('party_name') }}</th>
              <th class="px-4 py-2.5" :class="salesSort.thClass('grand_total', 'right')" @click="salesSort.toggle('grand_total', 'desc')">Total{{ salesSort.indicator('grand_total') }}</th>
              <th class="px-4 py-2.5" :class="salesSort.thClass('amt_paid', 'right')" @click="salesSort.toggle('amt_paid', 'desc')">Paid{{ salesSort.indicator('amt_paid') }}</th>
              <th class="px-4 py-2.5" :class="salesSort.thClass('outstanding', 'right')" @click="salesSort.toggle('outstanding', 'desc')">Outstanding{{ salesSort.indicator('outstanding') }}</th>
              <th class="px-4 py-2.5" :class="salesSort.thClass('pay_status', 'center')" @click="salesSort.toggle('pay_status')">Status{{ salesSort.indicator('pay_status') }}</th>
              <th class="text-right px-4 py-2.5">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="filteredInvoices.length === 0">
              <td colspan="9" class="text-center text-slate-400 py-10">
                <div class="text-4xl mb-2">🧾</div>No invoices found.
              </td>
            </tr>
            <tr v-for="inv in filteredInvoices" :key="inv.id" class="border-t border-slate-100 hover:bg-slate-50/50" :class="{ 'bg-slate-50/80': isInvoiceCancelled(inv) }">
              <td class="px-2 py-2.5 text-center">
                <input type="checkbox" :checked="selectedHistoryIds.includes(inv.id)" @change="toggleHistorySelect(inv.id)" />
              </td>
              <td class="px-4 py-2.5 text-slate-500">
                {{ inv.date }}
                <span
                  v-if="firmStore.isSalesLocked(inv.date)"
                  class="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold"
                  title="Sales month locked"
                >🔒</span>
              </td>
              <td class="px-4 py-2.5 font-bold text-navy">
                {{ inv.bill_no }}
                <span
                  v-if="isInvoiceCancelled(inv)"
                  class="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-white font-semibold uppercase tracking-wide"
                >Cancelled</span>
              </td>
              <td class="px-4 py-2.5">{{ inv.party_name }}</td>
              <td class="px-4 py-2.5 text-right font-semibold text-slate-700">₹{{ inv.grand_total.toLocaleString('en-IN') }}</td>
              <td class="px-4 py-2.5 text-right text-emerald-600">₹{{ (inv.amt_paid || 0).toLocaleString('en-IN') }}</td>
              <td class="px-4 py-2.5 text-right text-rose-600 font-semibold">₹{{ (inv.grand_total - (inv.amt_paid || 0)).toLocaleString('en-IN') }}</td>
              <td class="px-4 py-2.5 text-center">
                <span
                  v-if="isInvoiceCancelled(inv)"
                  class="pp-badge bg-slate-200 text-slate-700"
                >CANCELLED</span>
                <span
                  v-else
                  :class="['pp-badge',
                              inv.pay_status === 'PAID' ? 'bg-emerald-100 text-emerald-700' :
                              inv.pay_status === 'PARTIAL' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700']"
                >
                  {{ inv.pay_status }}
                </span>
              </td>
              <td class="px-4 py-2.5 text-right whitespace-nowrap">
                <div class="inline-flex items-center justify-end gap-1 relative">
                  <button
                    v-if="isInvoiceActive(inv)"
                    @click="openPaymentModal(inv)"
                    class="pp-btn pp-btn-ghost !px-2 !py-1 text-xs"
                    title="Record Payment"
                  >💳</button>
                  <button @click="openPrintPreview(inv)" class="pp-btn pp-btn-ghost !px-2 !py-1 text-xs" title="Preview">👁️</button>
                  <button @click="downloadPDF(inv)" class="pp-btn pp-btn-primary !px-2 !py-1 text-xs font-semibold" title="Download PDF">PDF</button>
                  <button
                    v-if="isInvoiceActive(inv) && isEwayEligible(inv)"
                    @click="downloadEwayForHistoryBill(inv)"
                    class="pp-btn pp-btn-ghost !px-2 !py-1 text-xs"
                    title="Download E-Way JSON"
                  >🚚</button>
                  <button
                    v-if="isInvoiceActive(inv)"
                    @click="editInvoice(inv)"
                    class="pp-btn pp-btn-ghost !px-2 !py-1 text-xs"
                    :disabled="firmStore.isSalesLocked(inv.date)"
                    :title="firmStore.isSalesLocked(inv.date) ? 'Month locked' : 'Edit Bill'"
                  >✏️</button>
                  <button @click="copyInvoice(inv)" class="pp-btn pp-btn-ghost !px-2 !py-1 text-xs" title="Copy Draft">📋</button>
                  <button
                    v-if="isInvoiceActive(inv)"
                    @click="cancelInvoice(inv)"
                    class="pp-btn pp-btn-danger !px-2 !py-1 text-xs"
                    :disabled="firmStore.isSalesLocked(inv.date)"
                    :title="firmStore.isSalesLocked(inv.date) ? 'Month locked' : 'Cancel Bill'"
                  >Cancel</button>
                  <button
                    type="button"
                    class="pp-btn pp-btn-ghost !px-2 !py-1 text-xs"
                    title="More actions"
                    @click="dangerMenuId = dangerMenuId === inv.id ? null : inv.id"
                  >⋯</button>
                  <div
                    v-if="dangerMenuId === inv.id"
                    class="absolute right-0 top-full mt-1 z-20 min-w-[11rem] rounded-lg border border-slate-200 bg-white shadow-lg text-left py-1"
                  >
                    <button
                      v-if="isInvoiceCancelled(inv)"
                      type="button"
                      class="w-full px-3 py-2 text-xs text-left hover:bg-amber-50 text-amber-900"
                      @click="openUncancelModal(inv)"
                    >
                      Un-cancel…
                    </button>
                    <button
                      type="button"
                      class="w-full px-3 py-2 text-xs text-left hover:bg-red-50 text-red-700"
                      :disabled="firmStore.isSalesLocked(inv.date)"
                      @click="openHardDeleteModal(inv)"
                    >
                      Hard delete…
                    </button>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 3: E-WAY BILL JSON -->
    <div v-if="activeTab === 'eway'" class="space-y-4">
      <div class="pp-card p-5">
        <h2 class="font-bold text-navy mb-2">🚚 E-Way Bill JSON (NIC Bulk Upload)</h2>
        <p class="text-sm text-slate-500 mb-4">
          Naya bill: <strong>New Bill → Save Bill + E-Way JSON</strong> (ek bill, ek JSON).
          Purane bills ke liye yahan se select karke bulk download karein.
          Upload: <strong>ewaybillgst.gov.in → Generate Bulk</strong>
        </p>
        <div class="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4 space-y-1">
          <div><strong>Same state (intra):</strong> sirf bill ≥ ₹50,000</div>
          <div><strong>Inter-state:</strong> har amount par JSON (₹50,000 se kam = <em>Suggested</em>, optional)</div>
          <div>Transport details (vehicle, distance, LR) bill me bharein — JSON me jayenge.</div>
        </div>
        <div class="flex flex-wrap gap-3 items-end mb-4">
          <div>
            <label class="pp-label">From Date</label>
            <input v-model="ewayFrom" type="date" class="pp-input !w-40" />
          </div>
          <div>
            <label class="pp-label">To Date</label>
            <input v-model="ewayTo" type="date" class="pp-input !w-40" />
          </div>
          <button type="button" class="pp-btn pp-btn-primary" @click="downloadSelectedEwayJson">📥 Download NIC JSON</button>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th class="px-3 py-2 w-8">
                  <input v-model="ewayCheckAll" type="checkbox" class="rounded" @change="toggleEwayCheckAll" />
                </th>
                <th class="px-3 py-2 text-left">Date</th>
                <th class="px-3 py-2 text-left">Bill No</th>
                <th class="px-3 py-2 text-left">Customer</th>
                <th class="px-3 py-2 text-left">Type</th>
                <th class="px-3 py-2 text-right">Total</th>
                <th class="px-3 py-2 text-center">Dist.</th>
                <th class="px-3 py-2 text-left">Vehicle</th>
                <th class="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!ewayCandidates.length">
                <td colspan="9" class="text-center text-slate-400 py-10">
                  Is date range me koi eligible bill nahi (Tax Invoice + amount rules).
                </td>
              </tr>
              <tr v-for="b in ewayCandidates" :key="b.id" class="border-t border-slate-100 hover:bg-slate-50">
                <td class="px-3 py-2">
                  <input
                    type="checkbox"
                    class="rounded"
                    :checked="ewaySelected.includes(b.id)"
                    @change="toggleEwaySelect(b.id)"
                  />
                </td>
                <td class="px-3 py-2">{{ b.date }}</td>
                <td class="px-3 py-2 font-mono">{{ b.bill_no }}</td>
                <td class="px-3 py-2">{{ b.party_name }}</td>
                <td class="px-3 py-2">{{ b.gst_type === 'inter' ? 'Inter' : 'Intra' }}</td>
                <td class="px-3 py-2 text-right tabular-nums">₹{{ n2(b.grand_total) }}</td>
                <td class="px-3 py-2 text-center">{{ b.distance || 0 }}</td>
                <td class="px-3 py-2">{{ b.vehicle || '—' }}</td>
                <td class="px-3 py-2">
                  <span
                    :class="[
                      'pp-badge text-[10px]',
                      getEwayEligibility(b).level === 'required' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800',
                    ]"
                  >
                    {{ ewayLevelLabel(b) }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- TAB 4: TEMPLATES -->
    <div v-if="activeTab === 'templates'" class="space-y-4">
      <div class="pp-card overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-slate-500 text-xs uppercase font-semibold">
            <tr>
              <th class="text-left px-4 py-2.5">Template Name</th>
              <th class="text-left px-4 py-2.5">Client Name</th>
              <th class="text-center px-4 py-2.5">Rows count</th>
              <th class="text-right px-4 py-2.5">Created At</th>
              <th class="text-right px-4 py-2.5">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="templatesList.length === 0">
              <td colspan="5" class="text-center text-slate-400 py-10">
                <div class="text-4xl mb-2">📑</div>No templates saved. Save from the New Bill page!
              </td>
            </tr>
            <tr v-for="t in templatesList" :key="t.id" class="border-t border-slate-100 hover:bg-slate-50/50">
              <td class="px-4 py-2.5">
                <strong class="text-navy">{{ t.name }}</strong>
                <p v-if="t.desc" class="text-xs text-slate-400 mt-0.5">{{ t.desc }}</p>
              </td>
              <td class="px-4 py-2.5">{{ t.custName || '—' }}</td>
              <td class="px-4 py-2.5 text-center">{{ t.items.length }} rows</td>
              <td class="px-4 py-2.5 text-right text-slate-500">{{ new Date(t.createdAt).toLocaleDateString() }}</td>
              <td class="px-4 py-2.5 text-right whitespace-nowrap space-x-1">
                <button @click="applyTemplate(t)" class="pp-btn pp-btn-success !py-1 text-xs">Apply</button>
                <button @click="deleteTemplate(t.id)" class="pp-btn pp-btn-danger !px-2.5 !py-1 text-xs">🗑️</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Payment Update Modal -->
    <PpModal v-if="showPaymentModal" title="Record Outstanding Receipt" @close="showPaymentModal = false">
      <div class="space-y-4 text-sm" v-if="payInvoiceId">
        <div class="p-3 bg-slate-50 rounded-lg space-y-1">
          <p class="text-slate-500">Bill No: <strong class="text-navy">{{ invoiceStore.list.find(i => i.id === payInvoiceId)?.bill_no }}</strong></p>
          <p class="text-slate-500">Client: <strong>{{ invoiceStore.list.find(i => i.id === payInvoiceId)?.party_name }}</strong></p>
          <p class="text-slate-500">Outstanding: <strong class="text-danger">₹{{ n2((invoiceStore.list.find(i => i.id === payInvoiceId)?.grand_total || 0) - (invoiceStore.list.find(i => i.id === payInvoiceId)?.amt_paid || 0)) }}</strong></p>
        </div>
        <div class="space-y-3">
          <div>
            <label class="pp-label">Receipt Amount (₹)</label>
            <input v-model.number="payAmount" type="number" step="0.01" class="pp-input" />
          </div>
          <div>
            <label class="pp-label">Receipt Date</label>
            <input v-model="payDate" type="date" class="pp-input" />
          </div>
          <div v-if="isWriteOffSuggested" class="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
            <input type="checkbox" v-model="payWriteOff" id="payWriteOff" class="mt-0.5 rounded border-slate-300 text-accent" />
            <div>
              <label for="payWriteOff" class="text-xs font-bold text-amber-800 cursor-pointer">Write off short payment?</label>
              <p class="text-[11px] text-amber-700 mt-0.5 leading-normal">The difference is small. Check this to mark the bill fully PAID and write off the remaining balance as round-off.</p>
            </div>
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-2 border-t border-slate-200">
          <button @click="showPaymentModal = false" class="pp-btn pp-btn-ghost">Cancel</button>
          <button @click="savePayment" class="pp-btn pp-btn-primary">Record Payment</button>
        </div>
      </div>
    </PpModal>

    <!-- Save Template Metadata Modal -->
    <PpModal v-if="showTemplateModal" title="Save Invoicing Template" @close="showTemplateModal = false">
      <div class="space-y-3">
        <div>
          <label class="pp-label">Template Name *</label>
          <input v-model="templateName" class="pp-input" placeholder="Standard 5-Ply Box Bill..." />
        </div>
        <div>
          <label class="pp-label">Short Description</label>
          <input v-model="templateDesc" class="pp-input" placeholder="e.g. Preset for Box calculations" />
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button @click="showTemplateModal = false" class="pp-btn pp-btn-ghost">Cancel</button>
          <button @click="confirmSaveTemplate" class="pp-btn pp-btn-primary">Save Template</button>
        </div>
      </div>
    </PpModal>

    <!-- Customer Statement Modal -->
    <PpModal v-if="showStatementModal" title="Customer Statement (PDF)" @close="showStatementModal = false">
      <div class="space-y-3 text-sm">
        <div class="grid grid-cols-2 gap-3">
          <div><label class="pp-label">From</label><input v-model="stmtFrom" type="date" class="pp-input" /></div>
          <div><label class="pp-label">To</label><input v-model="stmtTo" type="date" class="pp-input" /></div>
        </div>
        <div>
          <label class="pp-label">Customer</label>
          <select v-model="stmtCustomer" class="pp-input">
            <option value="">All customers</option>
            <option v-for="c in historyCustomers" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="pp-label">Payment status</label>
            <select v-model="stmtPay" class="pp-input">
              <option value="">All</option>
              <option value="PAID">Paid</option>
              <option value="PARTIAL">Partial</option>
              <option value="UNPAID">Unpaid</option>
            </select>
          </div>
          <div>
            <label class="pp-label">Document type</label>
            <select v-model="stmtDoc" class="pp-input">
              <option value="">All</option>
              <option value="INVOICE">Tax Invoice</option>
              <option value="BILL_OF_SUPPLY">Bill of Supply</option>
              <option value="CREDIT_NOTE">Credit Note</option>
            </select>
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button class="pp-btn pp-btn-ghost" @click="showStatementModal = false">Cancel</button>
          <button class="pp-btn pp-btn-primary" @click="generateStatementPDF">📄 Generate PDF</button>
        </div>
      </div>
    </PpModal>

    <PpModal v-if="showQuickCust" title="Add Customer" @close="showQuickCust = false">
      <div class="space-y-3">
        <div><label class="pp-label">Name *</label><input v-model="quickCust.name" class="pp-input" /></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="pp-label">GSTIN</label><input v-model="quickCust.gst" class="pp-input uppercase" /></div>
          <div><label class="pp-label">Phone</label><input v-model="quickCust.phone" class="pp-input" /></div>
        </div>
        <div><label class="pp-label">Address</label><input v-model="quickCust.addr" class="pp-input" /></div>
        <div class="grid grid-cols-3 gap-3">
          <div><label class="pp-label">City</label><input v-model="quickCust.city" class="pp-input" /></div>
          <div><label class="pp-label">PIN</label><input v-model="quickCust.pin" class="pp-input" /></div>
          <div><label class="pp-label">State</label><input v-model="quickCust.state" class="pp-input" placeholder="05" /></div>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button class="pp-btn pp-btn-ghost" @click="showQuickCust = false">Cancel</button>
          <button class="pp-btn pp-btn-primary" @click="saveQuickCust">Save Customer</button>
        </div>
      </div>
    </PpModal>

    <PpModal v-if="showQuickItem" title="Add Item" @close="showQuickItem = false">
      <div class="space-y-3">
        <div><label class="pp-label">Name *</label><input v-model="quickItem.name" class="pp-input" /></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="pp-label">HSN (4 digit)</label><input v-model="quickItem.hsn" maxlength="4" inputmode="numeric" class="pp-input font-mono" placeholder="4804" /></div>
          <div><label class="pp-label">Unit</label>
            <select v-model="quickItem.unit" class="pp-input">
              <option v-for="u in ITEM_UNITS" :key="u" :value="u">{{ u }}</option>
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="pp-label">Rate (₹)</label><input v-model.number="quickItem.rate" type="number" class="pp-input" /></div>
          <div><label class="pp-label">GST %</label><input v-model.number="quickItem.gst" type="number" class="pp-input" /></div>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button class="pp-btn pp-btn-ghost" @click="showQuickItem = false">Cancel</button>
          <button class="pp-btn pp-btn-primary" @click="saveQuickItem">Save Item</button>
        </div>
      </div>
    </PpModal>
  </div>

  <!-- Print Preview Sheet Modal (Overlay & Print Wrapper) -->
  <div v-if="showPrintPreview && previewInvoice" class="fixed inset-0 z-50 flex flex-col bg-slate-900/60 p-0 sm:p-4 overflow-y-auto no-print">
    <div class="w-full max-w-4xl mx-auto bg-white rounded-xl shadow-2xl flex flex-col min-h-[90vh]">
      <header class="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
        <h3 class="font-bold text-navy">Invoice Print Preview</h3>
        <div class="flex items-center gap-2 flex-wrap">
          <button @click="downloadPDF()" class="pp-btn pp-btn-primary !py-1 text-xs">📄 Download PDF</button>
          <button @click="printInvoice" class="pp-btn pp-btn-ghost !py-1 text-xs">🖨️ Print</button>
          <button @click="sharePDFViaWhatsApp" class="pp-btn pp-btn-ghost !py-1 text-xs">💬 WhatsApp</button>
          <button @click="sharePDFViaEmail" class="pp-btn pp-btn-ghost !py-1 text-xs">📧 Email</button>
          <button @click="showPrintPreview = false" class="pp-btn pp-btn-ghost !py-1 text-xs">✕ Close</button>
        </div>
      </header>
      <div class="flex-1 p-6 overflow-y-auto bg-slate-100 flex items-start justify-center">
        <!-- Rebuilt Print Sheet -->
        <div id="invoice-print-area" class="bg-white w-[800px] p-6 shadow-md border border-slate-300 text-xs leading-normal font-serif text-black relative">
          <div
            v-if="previewInvoice.cancelled_at"
            class="invoice-cancelled-watermark"
            aria-hidden="true"
          >CANCELLED</div>
          <!-- Document Header -->
          <div class="text-center border-b border-black pb-2 mb-3">
            <h1 class="text-lg font-bold uppercase tracking-wider break-words">{{ firmStore.activeFirm?.name || 'PAMA PACKAGING' }}</h1>
            <p class="break-words whitespace-pre-wrap">{{ firmStore.activeFirm?.addr || '' }}</p>
            <p class="break-words">PIN: {{ firmStore.activeFirm?.pin || '-' }} | Mob: {{ firmStore.activeFirm?.phone || '' }} | Email: {{ firmStore.activeFirm?.email || '-' }}</p>
            <p class="text-sm font-semibold mt-1 break-words">
              GSTIN: {{ formatGstin(firmStore.activeFirm?.gst) || '-' }} | State: {{ getStateName(firmStore.activeFirm?.gst || firmStore.activeFirm?.state) }} (Code: {{ firmStore.activeFirm?.state || '-' }})
            </p>
            <div class="text-center uppercase font-bold text-xs bg-black text-white py-1 mt-2 tracking-widest">
              {{ previewInvoice.doc_type === 'CREDIT_NOTE' ? 'CREDIT NOTE' : (previewInvoice.doc_type === 'DEBIT_NOTE' ? 'DEBIT NOTE' : (previewInvoice.doc_type === 'BILL_OF_SUPPLY' ? 'BILL OF SUPPLY' : 'TAX INVOICE')) }}
            </div>
          </div>

          <!-- Customer Cards & Invoice Meta -->
          <table class="w-full mb-3 border-collapse text-left">
            <tr>
              <td class="w-[35%] border border-black p-2 align-top text-[11px] break-words">
                <strong class="block mb-1 border-b border-black pb-0.5">Bill To (Buyer):</strong>
                <strong class="break-words">{{ previewInvoice.party_name }}</strong><br />
                <span class="whitespace-pre-wrap break-words">{{ previewBuyerDetails.addr || '' }}</span><br />
                {{ previewBuyerDetails.city }} - {{ previewBuyerDetails.pin }}<br />
                <span class="text-sm font-semibold font-mono">GSTIN: {{ previewBuyerDetails.gst || 'URD (Consumer)' }}</span><br />
                State: {{ getStateName(previewBuyerDetails.gst || previewBuyerDetails.state) }} (Code: {{ previewBuyerDetails.state || '-' }})
              </td>
              <td class="w-[35%] border border-black p-2 align-top text-[11px] break-words">
                <strong class="block mb-1 border-b border-black pb-0.5">Ship To (Consignee):</strong>
                <template v-if="previewInvoice.sameAsBuyer !== false">
                  <em>Same as Buyer</em>
                </template>
                <template v-else-if="previewShipDetails">
                  <strong class="break-words">{{ previewShipDetails.name }}</strong><br />
                  <span class="whitespace-pre-wrap break-words">{{ previewShipDetails.addr }}</span><br />
                  {{ previewShipDetails.city }} - {{ previewShipDetails.pin }}<br />
                  <span class="text-sm font-semibold font-mono">GSTIN: {{ previewShipDetails.gstin || 'URD' }}</span><br />
                  State: {{ getStateName(previewShipDetails.gstin || previewShipDetails.state) }} (Code: {{ previewShipDetails.state || '-' }})
                </template>
              </td>
              <td class="w-[30%] border border-black p-2 align-top text-[11px] space-y-1 break-words">
                <div><strong>Invoice No:</strong> {{ previewInvoice.bill_no }}</div>
                <div><strong>Date:</strong> {{ new Date(previewInvoice.date).toLocaleDateString('en-IN') }}</div>
                <div><strong>Ref:</strong> {{ previewInvoice.ref || '-' }}</div>
                <div><strong>Payment:</strong> {{ previewInvoice.payment }}</div>
              </td>
            </tr>
          </table>

          <!-- Transport Info -->
          <table class="w-full mb-3 border-collapse text-left">
            <tr class="border-b border-black">
              <td class="border border-black p-1 text-[10px] break-words"><strong>Dispatch:</strong> {{ previewInvoice.dispatch || '-' }}</td>
              <td class="border border-black p-1 text-[10px] break-words"><strong>LR/RR No:</strong> {{ previewInvoice.lr || '-' }}</td>
              <td class="border border-black p-1 text-[10px] break-words"><strong>Vehicle:</strong> {{ previewInvoice.vehicle || '-' }}</td>
            </tr>
            <tr>
              <td class="border border-black p-1 text-[10px] break-words"><strong>E-Way Bill:</strong> {{ previewInvoice.eway || '-' }}</td>
              <td class="border border-black p-1 text-[10px] break-words"><strong>Destination:</strong> {{ previewInvoice.dest || '-' }}</td>
              <td class="border border-black p-1 text-[10px] break-words"><strong>Distance:</strong> {{ previewInvoice.distance || 0 }} km</td>
            </tr>
          </table>

          <!-- Goods Items Table -->
          <table class="w-full border border-black text-left mb-3">
            <thead>
              <tr class="border-b border-black bg-slate-50 text-[10px]">
                <th class="border-r border-black p-1 text-center w-8">Sl</th>
                <th class="border-r border-black p-1">Description of Goods</th>
                <th class="border-r border-black p-1 text-center w-20">HSN</th>
                <th class="border-r border-black p-1 text-right w-24">Qty</th>
                <th class="border-r border-black p-1 text-right w-20">Rate</th>
                <th class="border-r border-black p-1 text-center w-16">GST%</th>
                <th class="border-r border-black p-1 text-right w-20">GST Amt</th>
                <th class="p-1 text-right w-24">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, idx) in previewInvoice.items" :key="idx" class="border-b border-black/40 text-[11px]">
                <td class="border-r border-black p-1 text-center">{{ idx + 1 }}</td>
                <td class="border-r border-black p-1 break-words">
                  <strong class="break-words">{{ r.name }}</strong>
                  <div v-if="r.size || r.gsm || r.bf || r.extra" class="text-[9px] text-slate-500 italic mt-0.5">
                    {{ [r.size, r.gsm ? r.gsm+'gsm' : '', r.bf ? r.bf+'bf' : '', r.extra].filter(Boolean).join(' | ') }}
                  </div>
                </td>
                <td class="border-r border-black p-1 text-center">{{ r.hsn || '-' }}</td>
                <td class="border-r border-black p-1 text-right">{{ n2(r.qty) }} {{ r.unit }}</td>
                <td class="border-r border-black p-1 text-right">{{ n2(r.rate) }}</td>
                <td class="border-r border-black p-1 text-center">{{ r.gst }}%</td>
                <td class="border-r border-black p-1 text-right">₹{{ n2(r.qty * r.rate * r.gst / 100) }}</td>
                <td class="p-1 text-right font-bold">₹{{ n2(r.qty * r.rate) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="border-t border-black bg-slate-50">
                <td colspan="7" class="border-r border-black p-1 text-right font-bold">Sub Total:</td>
                <td class="p-1 text-right font-bold">₹{{ n2(previewInvoice.sub) }}</td>
              </tr>
            </tfoot>
          </table>

          <!-- Tax Distribution Summary -->
          <table class="w-full border border-black text-left mb-3">
            <thead>
              <tr class="border-b border-black bg-slate-50 text-[10px]">
                <th class="border-r border-black p-1">GST Rate</th>
                <th class="border-r border-black p-1 text-right">Taxable Value</th>
                <th class="border-r border-black p-1 text-right">CGST</th>
                <th class="border-r border-black p-1 text-right">SGST</th>
                <th class="border-r border-black p-1 text-right">IGST</th>
                <th class="p-1 text-right">Total Tax</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(b, pct) in previewInvoice.taxBuckets" :key="pct" class="border-b border-black/40 text-[10px]">
                <td class="border-r border-black p-1">{{ pct }}%</td>
                <td class="border-r border-black p-1 text-right">₹{{ n2(b.taxable) }}</td>
                <td class="border-r border-black p-1 text-right">
                  <template v-if="previewInvoice.gst_type === 'intra'">₹{{ n2(b.tax / 2) }}</template>
                  <template v-else>-</template>
                </td>
                <td class="border-r border-black p-1 text-right">
                  <template v-if="previewInvoice.gst_type === 'intra'">₹{{ n2(b.tax / 2) }}</template>
                  <template v-else>-</template>
                </td>
                <td class="border-r border-black p-1 text-right">
                  <template v-if="previewInvoice.gst_type === 'inter'">₹{{ n2(b.tax) }}</template>
                  <template v-else>-</template>
                </td>
                <td class="p-1 text-right font-bold">₹{{ n2(b.tax) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="border-t border-black bg-slate-50">
                <td colspan="5" class="border-r border-black p-1 text-right font-bold">Round Off:</td>
                <td class="p-1 text-right font-bold">₹{{ n2(previewInvoice.round_off) }}</td>
              </tr>
              <tr class="border-t border-black bg-slate-100">
                <td colspan="5" class="border-r border-black p-1 text-right font-bold text-[11px] text-navy">Grand Total:</td>
                <td class="p-1 text-right font-bold text-[12px] text-navy">₹{{ n2(previewInvoice.grand_total) }}</td>
              </tr>
            </tfoot>
          </table>

          <!-- Footer Legal & Bank Accounts -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-black pt-2">
            <div class="text-[10px] space-y-1">
              <div><strong>Amount in Words:</strong> {{ numberToWords(previewInvoice.grand_total) }}</div>
              <div class="pt-2 text-base font-bold leading-snug">
                <strong>Bank details:</strong><br />
                Bank Name: {{ firmStore.activeFirm?.bank_name || '-' }}<br />
                A/c No: {{ firmStore.activeFirm?.bank_acno || '-' }}<br />
                IFSC Code: {{ firmStore.activeFirm?.bank_ifsc || '-' }}
              </div>
              <div class="pt-2 text-[9px] text-slate-500 leading-normal">
                <strong>Terms &amp; Declaration:</strong><br />
                {{ firmStore.activeFirm?.terms || 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.' }}
              </div>
            </div>
            <div class="text-center flex flex-col justify-between items-center min-h-28 pt-2">
              <strong class="uppercase text-[9px] break-words px-1">For {{ firmStore.activeFirm?.name || 'PAMA PACKAGING' }}</strong>
              <img v-if="firmSignatureUrl()" :src="firmSignatureUrl()" alt="Signature" class="max-h-14 max-w-[140px] object-contain" />
              <div class="border-t border-black/40 w-32 pt-1 font-bold text-[9px] uppercase">Authorised Signatory</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Print Specific Style Area -->
  <div id="print-view-container" class="print-only">
    <div v-if="previewInvoice" class="bg-white p-0 text-xs leading-normal font-serif text-black relative">
      <div
        v-if="previewInvoice.cancelled_at"
        class="invoice-cancelled-watermark"
        aria-hidden="true"
      >CANCELLED</div>
      <!-- Document Header -->
      <div class="text-center border-b border-black pb-2 mb-3">
        <h1 class="text-lg font-bold uppercase tracking-wider break-words">{{ firmStore.activeFirm?.name || 'PAMA PACKAGING' }}</h1>
        <p class="break-words whitespace-pre-wrap">{{ firmStore.activeFirm?.addr || '' }}</p>
        <p class="break-words">PIN: {{ firmStore.activeFirm?.pin || '-' }}<template v-if="firmStore.activeFirm?.phone"> | Mob: {{ firmStore.activeFirm.phone }}</template> | Email: {{ firmStore.activeFirm?.email || '-' }}</p>
        <p class="text-sm font-semibold mt-1 break-words">
          GSTIN: {{ formatGstin(firmStore.activeFirm?.gst) || '-' }} | State: {{ getStateName(firmStore.activeFirm?.gst || firmStore.activeFirm?.state) }} (Code: {{ firmStore.activeFirm?.state || '-' }})
        </p>
        <div class="text-center uppercase font-bold text-xs bg-black text-white py-1 mt-2 tracking-widest">
          {{ previewInvoice.doc_type === 'CREDIT_NOTE' ? 'CREDIT NOTE' : (previewInvoice.doc_type === 'DEBIT_NOTE' ? 'DEBIT NOTE' : (previewInvoice.doc_type === 'BILL_OF_SUPPLY' ? 'BILL OF SUPPLY' : 'TAX INVOICE')) }}
        </div>
      </div>

      <!-- Customer Cards & Invoice Meta -->
      <table class="w-full mb-3 border-collapse text-left">
        <tr>
          <td class="w-[35%] border border-black p-2 align-top text-[11px] break-words">
            <strong class="block mb-1 border-b border-black pb-0.5">Bill To (Buyer):</strong>
            <strong class="break-words">{{ previewInvoice.party_name }}</strong><br />
            <span class="whitespace-pre-wrap break-words">{{ previewBuyerDetails.addr || '' }}</span><br />
            {{ previewBuyerDetails.city }} - {{ previewBuyerDetails.pin }}<br />
            <span class="text-sm font-semibold font-mono">GSTIN: {{ previewBuyerDetails.gst || 'URD (Consumer)' }}</span><br />
            State: {{ getStateName(previewBuyerDetails.gst || previewBuyerDetails.state) }} (Code: {{ previewBuyerDetails.state || '-' }})
          </td>
          <td class="w-[35%] border border-black p-2 align-top text-[11px] break-words">
            <strong class="block mb-1 border-b border-black pb-0.5">Ship To (Consignee):</strong>
            <template v-if="previewInvoice.sameAsBuyer !== false">
              <em>Same as Buyer</em>
            </template>
            <template v-else-if="previewShipDetails">
              <strong class="break-words">{{ previewShipDetails.name }}</strong><br />
              <span class="whitespace-pre-wrap break-words">{{ previewShipDetails.addr }}</span><br />
              {{ previewShipDetails.city }} - {{ previewShipDetails.pin }}<br />
              <span class="text-sm font-semibold font-mono">GSTIN: {{ previewShipDetails.gstin || 'URD' }}</span><br />
              State: {{ getStateName(previewShipDetails.gstin || previewShipDetails.state) }} (Code: {{ previewShipDetails.state || '-' }})
            </template>
          </td>
          <td class="w-[30%] border border-black p-2 align-top text-[11px] space-y-1 break-words">
            <div><strong>Invoice No:</strong> {{ previewInvoice.bill_no }}</div>
            <div><strong>Date:</strong> {{ new Date(previewInvoice.date).toLocaleDateString('en-IN') }}</div>
            <div><strong>Ref:</strong> {{ previewInvoice.ref || '-' }}</div>
            <div><strong>Payment:</strong> {{ previewInvoice.payment }}</div>
          </td>
        </tr>
      </table>

      <!-- Transport Info -->
      <table class="w-full mb-3 border-collapse text-left">
        <tr class="border-b border-black">
          <td class="border border-black p-1 text-[10px] break-words"><strong>Dispatch:</strong> {{ previewInvoice.dispatch || '-' }}</td>
          <td class="border border-black p-1 text-[10px] break-words"><strong>LR/RR No:</strong> {{ previewInvoice.lr || '-' }}</td>
          <td class="border border-black p-1 text-[10px] break-words"><strong>Vehicle:</strong> {{ previewInvoice.vehicle || '-' }}</td>
        </tr>
        <tr>
          <td class="border border-black p-1 text-[10px] break-words"><strong>E-Way Bill:</strong> {{ previewInvoice.eway || '-' }}</td>
          <td class="border border-black p-1 text-[10px] break-words"><strong>Destination:</strong> {{ previewInvoice.dest || '-' }}</td>
          <td class="border border-black p-1 text-[10px] break-words"><strong>Distance:</strong> {{ previewInvoice.distance || 0 }} km</td>
        </tr>
      </table>

      <!-- Goods Items Table -->
      <table class="w-full border border-black text-left mb-3">
        <thead>
          <tr class="border-b border-black bg-slate-50 text-[10px]">
            <th class="border-r border-black p-1 text-center w-8">Sl</th>
            <th class="border-r border-black p-1">Description of Goods</th>
            <th class="border-r border-black p-1 text-center w-20">HSN</th>
            <th class="border-r border-black p-1 text-right w-24">Qty</th>
            <th class="border-r border-black p-1 text-right w-20">Rate</th>
            <th class="border-r border-black p-1 text-center w-16">GST%</th>
            <th class="border-r border-black p-1 text-right w-20">GST Amt</th>
            <th class="p-1 text-right w-24">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, idx) in previewInvoice.items" :key="idx" class="border-b border-black/40 text-[11px]">
            <td class="border-r border-black p-1 text-center">{{ idx + 1 }}</td>
            <td class="border-r border-black p-1 break-words">
              <strong class="break-words">{{ r.name }}</strong>
              <div v-if="r.size || r.gsm || r.bf || r.extra" class="text-[9px] text-slate-500 italic mt-0.5">
                {{ [r.size, r.gsm ? r.gsm+'gsm' : '', r.bf ? r.bf+'bf' : '', r.extra].filter(Boolean).join(' | ') }}
              </div>
            </td>
            <td class="border-r border-black p-1 text-center">{{ r.hsn || '-' }}</td>
            <td class="border-r border-black p-1 text-right">{{ n2(r.qty) }} {{ r.unit }}</td>
            <td class="border-r border-black p-1 text-right">{{ n2(r.rate) }}</td>
            <td class="border-r border-black p-1 text-center">{{ r.gst }}%</td>
            <td class="border-r border-black p-1 text-right">₹{{ n2(r.qty * r.rate * r.gst / 100) }}</td>
            <td class="p-1 text-right font-bold">₹{{ n2(r.qty * r.rate) }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="border-t border-black bg-slate-50">
            <td colspan="7" class="border-r border-black p-1 text-right font-bold">Sub Total:</td>
            <td class="p-1 text-right font-bold">₹{{ n2(previewInvoice.sub) }}</td>
          </tr>
        </tfoot>
      </table>

      <!-- Tax Distribution Summary -->
      <table class="w-full border border-black text-left mb-3">
        <thead>
          <tr class="border-b border-black bg-slate-50 text-[10px]">
            <th class="border-r border-black p-1">GST Rate</th>
            <th class="border-r border-black p-1 text-right">Taxable Value</th>
            <th class="border-r border-black p-1 text-right">CGST</th>
            <th class="border-r border-black p-1 text-right">SGST</th>
            <th class="border-r border-black p-1 text-right">IGST</th>
            <th class="p-1 text-right">Total Tax</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(b, pct) in previewInvoice.taxBuckets" :key="pct" class="border-b border-black/40 text-[10px]">
            <td class="border-r border-black p-1">{{ pct }}%</td>
            <td class="border-r border-black p-1 text-right">₹{{ n2(b.taxable) }}</td>
            <td class="border-r border-black p-1 text-right">
              <template v-if="previewInvoice.gst_type === 'intra'">₹{{ n2(b.tax / 2) }}</template>
              <template v-else>-</template>
            </td>
            <td class="border-r border-black p-1 text-right">
              <template v-if="previewInvoice.gst_type === 'intra'">₹{{ n2(b.tax / 2) }}</template>
              <template v-else>-</template>
            </td>
            <td class="border-r border-black p-1 text-right">
              <template v-if="previewInvoice.gst_type === 'inter'">₹{{ n2(b.tax) }}</template>
              <template v-else>-</template>
            </td>
            <td class="p-1 text-right font-bold">₹{{ n2(b.tax) }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="border-t border-black bg-slate-50">
            <td colspan="5" class="border-r border-black p-1 text-right font-bold">Round Off:</td>
            <td class="p-1 text-right font-bold">₹{{ n2(previewInvoice.round_off) }}</td>
          </tr>
          <tr class="border-t border-black bg-slate-100">
            <td colspan="5" class="border-r border-black p-1 text-right font-bold text-[11px]">Grand Total:</td>
            <td class="p-1 text-right font-bold text-[12px]">₹{{ n2(previewInvoice.grand_total) }}</td>
          </tr>
        </tfoot>
      </table>

      <!-- Footer Legal & Bank Accounts -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-black pt-2">
        <div class="text-[10px] space-y-1">
          <div><strong>Amount in Words:</strong> {{ numberToWords(previewInvoice.grand_total) }}</div>
          <div class="pt-2 text-base font-bold leading-snug">
            <strong>Bank details:</strong><br />
            Bank Name: {{ firmStore.activeFirm?.bank_name || '-' }}<br />
            A/c No: {{ firmStore.activeFirm?.bank_acno || '-' }}<br />
            IFSC Code: {{ firmStore.activeFirm?.bank_ifsc || '-' }}
          </div>
          <div class="pt-2 text-[9px] text-slate-500 leading-normal">
            <strong>Terms &amp; Declaration:</strong><br />
            {{ firmStore.activeFirm?.terms || 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.' }}
          </div>
        </div>
        <div class="text-center flex flex-col justify-between items-center min-h-28 pt-2">
          <strong class="uppercase text-[9px] break-words px-1">For {{ firmStore.activeFirm?.name || 'PAMA PACKAGING' }}</strong>
          <div class="border-t border-black/40 w-32 pt-1 font-bold text-[9px] uppercase">Authorised Signatory</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Hard delete / Un-cancel confirmation -->
  <div
    v-if="dangerModal"
    class="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 no-print"
    @click.self="closeDangerModal"
  >
    <div class="w-full max-w-md rounded-xl bg-white shadow-2xl p-5 space-y-3">
      <h3 class="font-bold text-navy">
        {{ dangerModal.mode === 'hard_delete' ? 'Hard delete invoice' : 'Un-cancel invoice' }}
      </h3>
      <p class="text-sm text-slate-600 leading-relaxed">
        <template v-if="dangerModal.mode === 'hard_delete'">
          Bill <b>{{ dangerModal.inv.bill_no }}</b> history se hide ho jayega.
          Number reuse nahi hoga; GSTR Table 13 me cancelled count me rahega.
          Ye undo mushkil hai (Deleted tab se restore, cancelled state preserve).
        </template>
        <template v-else>
          Bill <b>{{ dangerModal.inv.bill_no }}</b> wapas active hoga — ledger + stock restore.
          Sirf jab galti se cancel kiya ho.
        </template>
      </p>
      <div>
        <label class="pp-label">Type exact bill number</label>
        <input v-model="dangerModal.typedBill" class="pp-input font-mono" :placeholder="dangerModal.inv.bill_no" />
      </div>
      <div>
        <label class="pp-label">
          Type
          <span class="font-mono font-bold">{{ dangerModal.mode === 'hard_delete' ? 'HARD DELETE' : 'UNCANCEL' }}</span>
        </label>
        <input
          v-model="dangerModal.typedPhrase"
          class="pp-input font-mono uppercase"
          :placeholder="dangerModal.mode === 'hard_delete' ? 'HARD DELETE' : 'UNCANCEL'"
        />
      </div>
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" class="pp-btn pp-btn-ghost" @click="closeDangerModal">Close</button>
        <button
          type="button"
          class="pp-btn"
          :class="[
            dangerModal.mode === 'hard_delete' ? 'pp-btn-danger' : 'pp-btn-primary',
            !dangerModalReady ? 'opacity-50' : '',
          ]"
          :disabled="!dangerModalReady"
          @click="confirmDangerModal"
        >
          {{ dangerModal.mode === 'hard_delete' ? 'Hard delete forever' : 'Confirm Un-cancel' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style>
/* Print Media CSS Rules */
@media print {
  .hide-on-print {
    display: none !important;
  }
  .no-print {
    display: none !important;
  }
  body, html, #app, main {
    background: white !important;
    color: black !important;
    height: auto !important;
    overflow: visible !important;
  }
  #print-view-container {
    display: block !important;
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
  }
  aside, header {
    display: none !important;
  }
}

.print-only {
  display: none;
}

#invoice-print-area table {
  width: 100%;
  border-collapse: collapse;
}

#invoice-print-area th, #invoice-print-area td,
#print-view-container th, #print-view-container td {
  border: 1px solid black;
  padding: 4px 6px;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.invoice-cancelled-watermark {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 5;
  font-size: 72px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: rgba(185, 28, 28, 0.22);
  transform: rotate(-28deg);
  text-transform: uppercase;
  font-family: Helvetica, Arial, sans-serif;
}
</style>
