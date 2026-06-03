<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { setPendingRTGS } from '@/services/rtgsBridge'
import { useFirmStore } from '@/stores/firm'
import { usePartyStore } from '@/stores/parties'
import { useItemStore } from '@/stores/items'
import { usePurchaseStore } from '@/stores/purchases'
import { useSettingsStore } from '@/stores/settings'
import PpModal from '@/components/PpModal.vue'
import AiScanPanel from '@/components/AiScanPanel.vue'
import { fileToBase64, scanPurchaseBillsPdf, type ScanResult } from '@/services/aiScanner'
import type { GstType, PaperType, PayStatus, Purchase, PurchaseItemLine } from '@/types/models'

// Stores
const firmStore = useFirmStore()
const partyStore = usePartyStore()
const itemStore = useItemStore()
const purchaseStore = usePurchaseStore()
const settingsStore = useSettingsStore()
const router = useRouter()

// State
const activeTab = ref<'new' | 'bulk' | 'history'>('new')
const search = ref('')
const statusFilter = ref<'all' | PayStatus>('all')
const editingId = ref<string | null>(null)
const bulkScanStatus = ref('')
const bulkScanLoading = ref(false)
const bulkScanFileName = ref('')
const bulkScanFileStatuses = ref<BulkScanFileStatus[]>([])
const selectedPurchaseIds = ref<string[]>([])
const correctionTargetFirmId = ref('')
const correctionConfirmText = ref('')
const correctionNote = ref('')
const correctionBusy = ref(false)
const correctionStatus = ref('')
const correctionWarnings = ref<string[]>([])
const correctionMode = ref(false)

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

interface BulkPurchaseRow {
  supplier_name: string
  bill_no: string
  date: string
  received_date: string
  item_name: string
  hsn: string
  qty: number
  unit: string
  rate: number
  gst: number
  payment: string
  pay_status: PayStatus
  is_consumable: boolean
  consumable_type: 'glue' | 'ink' | 'stitching_wire'
  notes: string
}

interface BulkScanFileStatus {
  name: string
  status: 'pending' | 'scanning' | 'done' | 'error'
  message: string
}

const BULK_SCAN_ACCEPT = 'application/pdf,.pdf,image/*'
const paperTypes: PaperType[] = ['KRAFT', 'DUPLEX']

const bulkRows = ref<BulkPurchaseRow[]>([])
const scannedBills = ref<ScanResult[]>([])

function newBulkRow(): BulkPurchaseRow {
  const today = new Date().toISOString().slice(0, 10)
  return {
    supplier_name: '',
    bill_no: '',
    date: today,
    received_date: today,
    item_name: '',
    hsn: '48043100',
    qty: 0,
    unit: 'KG',
    rate: 0,
    gst: 18,
    payment: 'BANK',
    pay_status: 'UNPAID',
    is_consumable: false,
    consumable_type: 'glue',
    notes: '',
  }
}

// Helper functions
const n2 = (val: number) => (val || 0).toFixed(2)

function normalizeReelCount(v: unknown) {
  return Math.max(1, Math.floor(Number(v) || 1))
}

function addBulkRow(data: Partial<BulkPurchaseRow> = {}) {
  bulkRows.value.push({ ...newBulkRow(), ...data })
}

function removeBulkRow(idx: number) {
  bulkRows.value.splice(idx, 1)
  if (bulkRows.value.length === 0) addBulkRow()
}

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
    paper_type: normalizePaperType(data.paper_type),
    reel_no: data.reel_no || '',
    deckle_size: data.deckle_size || '',
    gsm: data.gsm || '',
    bf: data.bf || '',
    color: data.color || 'NS',
    reel_weight: data.reel_weight || data.qty || 0,
    reel_count: normalizeReelCount(data.reel_count),
    is_consumable: data.is_consumable || false,
    consumable_type: data.consumable_type || 'glue',
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
    addRow(scanItemToPurchaseLine(it))
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
  selectedPurchaseIds.value = []
  correctionTargetFirmId.value = ''
  correctionConfirmText.value = ''
  correctionStatus.value = ''
  correctionWarnings.value = []
  correctionMode.value = false
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
    row.reel_count = normalizeReelCount(row.reel_count)
    row.hsn = row.hsn || '48043100'
    row.paper_type = normalizePaperType(row.paper_type)
    row.is_consumable = false
  }
}

function toggleConsumable(idx: number) {
  const row = form.items[idx]
  if (row.is_consumable) {
    row.unit = row.unit || 'KG'
    row.consumable_type = row.consumable_type || 'glue'
    row.is_kraft_reel = false
  }
}

function toggleBulkConsumable(row: BulkPurchaseRow) {
  if (row.is_consumable) {
    row.unit = row.unit || 'KG'
    row.consumable_type = row.consumable_type || 'glue'
  }
}

function applyBulkPaymentMode(e: Event) {
  const value = (e.target as HTMLSelectElement).value
  if (!value) return
  bulkRows.value.forEach((r) => { r.payment = value })
}

function applyBulkPayStatus(e: Event) {
  const value = (e.target as HTMLSelectElement).value as PayStatus | ''
  if (!value) return
  bulkRows.value.forEach((r) => { r.pay_status = value })
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

function calcBulkAmounts(row: BulkPurchaseRow) {
  const sub = Math.round((Number(row.qty) || 0) * (Number(row.rate) || 0) * 100) / 100
  const totalTax = Math.round(sub * ((Number(row.gst) || 0) / 100) * 100) / 100
  const raw = sub + totalTax
  const grandTotal = Math.round(raw)
  const roundOff = Math.round((grandTotal - raw) * 100) / 100
  return { sub, totalTax, roundOff, grandTotal }
}

function calcPurchaseTotals(items: PurchaseItemLine[]) {
  const sub = Math.round(items.reduce((sum, item) => sum + ((Number(item.qty) || 0) * (Number(item.rate) || 0)), 0) * 100) / 100
  const totalTax = Math.round(items.reduce((sum, item) => {
    const taxable = (Number(item.qty) || 0) * (Number(item.rate) || 0)
    return sum + taxable * ((Number(item.gst) || 0) / 100)
  }, 0) * 100) / 100
  const raw = sub + totalTax
  const grandTotal = Math.round(raw)
  const roundOff = Math.round((grandTotal - raw) * 100) / 100
  return { sub, totalTax, roundOff, grandTotal }
}

function normalizeConsumableType(v: unknown): PurchaseItemLine['consumable_type'] {
  const key = String(v || '').toLowerCase().replace(/\s+/g, '_')
  if (key === 'glue' || key === 'ink' || key === 'stitching_wire') return key
  return undefined
}

function normalizeReelColor(v: unknown): string {
  const key = String(v || '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  if (key === 'GY') return 'GY'
  if (key.includes('GOLDEN') && key.includes('YELLOW')) return 'GY'
  if (key === 'NS' || key.includes('NATURAL') || key.includes('NEUTRAL') || key.includes('BROWN')) return 'NS'
  return 'NS'
}

function normalizePaperType(v: unknown): PaperType {
  return String(v || '').trim().toUpperCase() === 'DUPLEX' ? 'DUPLEX' : 'KRAFT'
}

function scanItemToPurchaseLine(it: NonNullable<ScanResult['items']>[number]): Partial<PurchaseItemLine> {
  const deckleSize = (it.deckleSize || it.reelSize || '').trim()
  const hasReelMetadata = Boolean(
    it.reelNo || deckleSize || it.gsm || it.bf || Number(it.reelWeight) > 0 || Number(it.reelCount) > 0,
  )
  return {
    name: it.name,
    qty: Number(it.qty) || 0,
    unit: it.unit || 'KG',
    rate: Number(it.rate) || 0,
    hsn: it.hsn || '48043100',
    gst: it.gst ?? 18,
    is_kraft_reel: Boolean(it.isKraftReel || hasReelMetadata),
    paper_type: normalizePaperType(it.paperType),
    reel_no: it.reelNo || '',
    deckle_size: deckleSize,
    gsm: it.gsm || '',
    bf: it.bf || '',
    color: normalizeReelColor(it.color),
    reel_weight: Number(it.reelWeight || it.qty || 0),
    reel_count: normalizeReelCount(it.reelCount),
    is_consumable: Boolean(it.isConsumable),
    consumable_type: normalizeConsumableType(it.consumableType),
  }
}

async function ensurePurchaseItemLine(it: NonNullable<ScanResult['items']>[number]): Promise<PurchaseItemLine> {
  const name = (it.name || '').trim() || 'Purchase Item'
  let item = itemStore.list.find((i) => i.name.trim().toLowerCase() === name.toLowerCase())
  if (!item) {
    item = await itemStore.add({
      name,
      unit: it.unit || 'KG',
      hsn: it.hsn || '48043100',
      gst: Number(it.gst) || 18,
      rate: Number(it.rate) || 0,
      size: '',
      gsm: it.gsm || '',
      bf: it.bf || '',
    })
  }
  const consumableType = normalizeConsumableType(it.consumableType)
  const scannedLine = scanItemToPurchaseLine(it)
  return {
    item_id: item.id,
    name: item.name,
    hsn: scannedLine.hsn || item.hsn || '48043100',
    qty: scannedLine.qty || 0,
    unit: scannedLine.unit || item.unit || 'KG',
    rate: scannedLine.rate || 0,
    gst: scannedLine.gst || Number(item.gst) || 18,
    is_consumable: Boolean(it.isConsumable && consumableType),
    consumable_type: consumableType,
    is_kraft_reel: scannedLine.is_kraft_reel,
    paper_type: scannedLine.paper_type,
    reel_no: scannedLine.reel_no,
    deckle_size: scannedLine.deckle_size,
    gsm: scannedLine.gsm,
    bf: scannedLine.bf,
    color: scannedLine.color,
    reel_weight: scannedLine.reel_weight,
    reel_count: scannedLine.reel_count,
  }
}

async function saveScannedBill(bill: ScanResult) {
  const vendor = await partyStore.ensure((bill.supplierName || '').trim(), 'vendor', {
    gst: bill.gstin,
    addr: bill.address,
    city: bill.city,
    pin: bill.pin,
    phone: bill.phone,
    bank: bill.bank,
    acno: bill.acno,
    ifsc: bill.ifsc,
    acname: bill.acname,
  })
  const items: PurchaseItemLine[] = []
  for (const it of bill.items || []) {
    const line = await ensurePurchaseItemLine(it)
    if (line.name.trim() && line.qty > 0 && line.rate >= 0) items.push(line)
  }
  if (items.length === 0) throw new Error(`No valid items in bill ${bill.billNo || ''}`)
  const totals = calcPurchaseTotals(items)
  await purchaseStore.add({
    supplier_name: vendor.name,
    supplier_id: vendor.id,
    bill_no: (bill.billNo || '').trim(),
    date: bill.date || new Date().toISOString().slice(0, 10),
    received_date: new Date().toISOString().slice(0, 10),
    payment: 'BANK',
    gst_type: firmStore.activeFirm?.state && vendor.state
      ? (firmStore.activeFirm.state === vendor.state ? 'intra' : 'inter')
      : 'intra',
    items,
    sub: totals.sub,
    total_tax: totals.totalTax,
    round_off: totals.roundOff,
    grand_total: totals.grandTotal,
    amt_paid: 0,
    pay_status: 'UNPAID',
    notes: bill.grandTotal ? `AI scan total: ₹${bill.grandTotal}` : 'AI multi-bill import',
  })
}

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
  const badReel = validItems.find(it => it.is_kraft_reel && (!it.deckle_size?.trim() || !it.gsm?.trim() || !it.bf?.trim() || !(it.reel_weight || it.qty) || normalizeReelCount(it.reel_count) <= 0))
  if (badReel) {
    alert('Paper reel line me Paper Type, Deckle, GSM, BF, Reel Weight aur No. of Reels required hai. Reel No optional hai.')
    return
  }
  const badConsumable = validItems.find(it => it.is_consumable && !it.consumable_type)
  if (badConsumable) {
    alert('Consumable stock line me Glue, Ink ya Stitching Wire type select karo.')
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

  const normalizedItems = validItems.map((it) => ({
    ...it,
    reel_count: it.is_kraft_reel ? normalizeReelCount(it.reel_count) : undefined,
    paper_type: it.is_kraft_reel ? normalizePaperType(it.paper_type) : undefined,
  }))

  const purchaseData = {
    supplier_name: vendor.name,
    supplier_id: vendor.id,
    bill_no: form.bill_no.trim(),
    date: form.date,
    received_date: form.received_date,
    payment: form.payment,
    gst_type: form.gst_type,
    items: normalizedItems,
    sub: Math.round(subtotal.value * 100) / 100,
    total_tax: Math.round(totalTax.value * 100) / 100,
    round_off: Math.round(roundOff.value * 100) / 100,
    grand_total: grandTotal.value,
    amt_paid: form.amt_paid,
    pay_status: form.pay_status,
    notes: form.notes
  }

  try {
    if (editingId.value) {
      await purchaseStore.update(editingId.value, purchaseData)
      alert('Purchase bill updated successfully!')
    } else {
      await purchaseStore.add(purchaseData)
      alert('Purchase bill saved successfully!')
    }

    resetForm()
    activeTab.value = 'history'
  } catch (err: any) {
    alert(err?.message || 'Purchase bill save failed')
  }
}

async function saveBulkPurchases() {
  const validRows = bulkRows.value.filter((r) =>
    r.supplier_name.trim() && r.bill_no.trim() && r.item_name.trim() && r.qty > 0 && r.rate > 0,
  )
  if (validRows.length === 0) {
    alert('At least one complete purchase bill row add karo.')
    return
  }

  const duplicateBill = validRows.find((row, idx) =>
    validRows.findIndex((r) => r.supplier_name.trim().toLowerCase() === row.supplier_name.trim().toLowerCase() && r.bill_no.trim().toLowerCase() === row.bill_no.trim().toLowerCase()) !== idx,
  )
  if (duplicateBill) {
    alert(`Duplicate bill found: ${duplicateBill.supplier_name} / ${duplicateBill.bill_no}`)
    return
  }
  const existingBill = validRows.find((row) =>
    purchaseStore.list.some((p) =>
      !p.is_deleted &&
      p.supplier_name.trim().toLowerCase() === row.supplier_name.trim().toLowerCase() &&
      p.bill_no.trim().toLowerCase() === row.bill_no.trim().toLowerCase(),
    ),
  )
  if (existingBill) {
    alert(`Already saved bill found: ${existingBill.supplier_name} / ${existingBill.bill_no}`)
    return
  }

  let saved = 0
  for (const row of validRows) {
    const vendor = await partyStore.ensure(row.supplier_name.trim(), 'vendor')
    let item = itemStore.list.find((i) => i.name.trim().toLowerCase() === row.item_name.trim().toLowerCase())
    if (!item) {
      item = await itemStore.add({
        name: row.item_name.trim(),
        unit: row.unit,
        hsn: row.hsn,
        gst: row.gst,
        rate: row.rate,
        size: '',
        gsm: '',
        bf: '',
      })
    }
    const line: PurchaseItemLine = {
      item_id: item.id,
      name: item.name,
      hsn: row.hsn,
      qty: row.qty,
      unit: row.unit,
      rate: row.rate,
      gst: row.gst,
      is_consumable: row.is_consumable,
      consumable_type: row.is_consumable ? row.consumable_type : undefined,
    }
    const totals = calcBulkAmounts(row)
    await purchaseStore.add({
      supplier_name: vendor.name,
      supplier_id: vendor.id,
      bill_no: row.bill_no.trim(),
      date: row.date,
      received_date: row.received_date,
      payment: row.payment,
      gst_type: firmStore.activeFirm?.state && vendor.state
        ? (firmStore.activeFirm.state === vendor.state ? 'intra' : 'inter')
        : 'intra',
      items: [line],
      sub: totals.sub,
      total_tax: totals.totalTax,
      round_off: totals.roundOff,
      grand_total: totals.grandTotal,
      amt_paid: row.pay_status === 'PAID' ? totals.grandTotal : 0,
      pay_status: row.pay_status,
      notes: row.notes,
    })
    saved++
  }

  bulkRows.value = [newBulkRow()]
  alert(`${saved} purchase bill(s) saved successfully!`)
  activeTab.value = 'history'
}

async function scanBulkPurchaseFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  if (files.length === 0) return

  bulkScanFileName.value = files.length === 1 ? files[0].name : `${files.length} bill files selected`
  bulkScanLoading.value = true
  bulkScanStatus.value = files.length === 1
    ? 'Scanning bill file with Gemini...'
    : `Scanning 1 of ${files.length} bill files with Gemini...`
  scannedBills.value = []
  bulkScanFileStatuses.value = files.map((file) => ({
    name: file.name,
    status: 'pending',
    message: 'Waiting',
  }))

  const extractedBills: ScanResult[] = []
  try {
    for (const [idx, file] of files.entries()) {
      bulkScanFileStatuses.value[idx] = {
        name: file.name,
        status: 'scanning',
        message: `Scanning ${idx + 1}/${files.length}`,
      }
      bulkScanStatus.value = files.length === 1
        ? 'Scanning bill file with Gemini...'
        : `Scanning ${idx + 1} of ${files.length} bill files with Gemini...`

      try {
        const { base64, mime } = await fileToBase64(file, { allowImages: true, allowPdf: true })
        const result = await scanPurchaseBillsPdf(settingsStore.geminiKey, base64, mime)
        const bills = (result.bills || []).filter((b) => b.supplierName || b.billNo || b.items?.length)
        extractedBills.push(...bills)
        scannedBills.value = [...extractedBills]
        bulkScanFileStatuses.value[idx] = {
          name: file.name,
          status: 'done',
          message: bills.length ? `${bills.length} bill(s) extracted` : 'No bills found',
        }
      } catch (err: any) {
        bulkScanFileStatuses.value[idx] = {
          name: file.name,
          status: 'error',
          message: err?.message || 'Scan failed',
        }
      }
    }

    const failedCount = bulkScanFileStatuses.value.filter((file) => file.status === 'error').length
    bulkScanStatus.value = extractedBills.length
      ? `Done - ${extractedBills.length} bill(s) extracted from ${files.length - failedCount}/${files.length} file(s). Review and save.`
      : failedCount
        ? `No bills extracted. ${failedCount} file(s) failed.`
        : `No purchase bills found in ${files.length === 1 ? 'this file' : 'selected files'}.`
  } finally {
    bulkScanLoading.value = false
    input.value = ''
  }
}

function removeScannedBill(idx: number) {
  scannedBills.value.splice(idx, 1)
}

async function saveScannedBills() {
  const bills = scannedBills.value.filter((b) => b.supplierName?.trim() && b.billNo?.trim() && b.items?.length)
  if (bills.length === 0) {
    alert('Scan se koi complete bill extract nahi hua.')
    return
  }
  const duplicateBill = bills.find((bill, idx) =>
    bills.findIndex((b) =>
      (b.supplierName || '').trim().toLowerCase() === (bill.supplierName || '').trim().toLowerCase() &&
      (b.billNo || '').trim().toLowerCase() === (bill.billNo || '').trim().toLowerCase(),
    ) !== idx,
  )
  if (duplicateBill) {
    alert(`Scanned bills me duplicate bill found: ${duplicateBill.supplierName} / ${duplicateBill.billNo}`)
    return
  }
  const existingBill = bills.find((bill) =>
    purchaseStore.list.some((p) =>
      !p.is_deleted &&
      p.supplier_name.trim().toLowerCase() === (bill.supplierName || '').trim().toLowerCase() &&
      p.bill_no.trim().toLowerCase() === (bill.billNo || '').trim().toLowerCase(),
    ),
  )
  if (existingBill) {
    alert(`Already saved bill found: ${existingBill.supplierName} / ${existingBill.billNo}`)
    return
  }

  let saved = 0
  try {
    for (const bill of bills) {
      await saveScannedBill(bill)
      saved++
    }
    scannedBills.value = []
    bulkScanStatus.value = `${saved} scanned purchase bill(s) saved successfully.`
    alert(`${saved} scanned purchase bill(s) saved successfully!`)
    activeTab.value = 'history'
  } catch (err: any) {
    bulkScanStatus.value = err?.message || 'Saving scanned bills failed'
    alert(bulkScanStatus.value)
  }
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
  
  form.items = pur.items.map(it => ({
    ...it,
    reel_count: it.is_kraft_reel ? normalizeReelCount(it.reel_count) : it.reel_count,
  }))
  activeTab.value = 'new'
}

// Delete purchase bill
async function deletePurchase(pur: Purchase) {
  if (confirm(`Are you sure you want to delete purchase bill ${pur.bill_no}? This will also delete its accounting ledger entries and purchase stock movements.`)) {
    try {
      await purchaseStore.remove(pur.id)
      alert('Purchase bill deleted.')
    } catch (err: any) {
      alert(err?.message || 'Purchase bill delete failed')
    }
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
    sourceId: pur.id,
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

const selectedPurchases = computed(() =>
  purchaseStore.list.filter((p) => selectedPurchaseIds.value.includes(p.id)),
)

const availableTargetFirms = computed(() =>
  firmStore.firms.filter((firm) => !firm.is_deleted && firm.id !== firmStore.activeFirmId),
)

function selectVisiblePurchases() {
  selectedPurchaseIds.value = filteredPurchases.value.map((p) => p.id)
}

function openCorrectionMode() {
  correctionMode.value = true
  correctionStatus.value = ''
  correctionWarnings.value = []
}

function clearCorrectionSelection() {
  selectedPurchaseIds.value = []
  correctionConfirmText.value = ''
  correctionStatus.value = ''
  correctionWarnings.value = []
}

function closeCorrectionMode() {
  clearCorrectionSelection()
  correctionTargetFirmId.value = ''
  correctionNote.value = ''
  correctionMode.value = false
}

async function moveSelectedPurchases() {
  if (selectedPurchaseIds.value.length === 0) {
    alert('Move karne ke liye at least one purchase bill select karo.')
    return
  }
  if (!correctionTargetFirmId.value || correctionTargetFirmId.value === firmStore.activeFirmId) {
    alert('Correct target firm select karo.')
    return
  }
  if (correctionConfirmText.value.trim().toUpperCase() !== 'MOVE') {
    alert('Confirmation box me MOVE type karo.')
    return
  }

  const targetFirm = firmStore.firms.find((f) => f.id === correctionTargetFirmId.value)
  const ok = confirm(
    `Move ${selectedPurchaseIds.value.length} purchase bill(s) from ${firmStore.activeFirm?.name || 'current firm'} to ${targetFirm?.name || 'selected firm'}?\n\nThis will retag linked ledger, reel stock, stock movements, item stock movements and activity logs. Parties/items will not be moved automatically.`,
  )
  if (!ok) return

  correctionBusy.value = true
  correctionStatus.value = ''
  correctionWarnings.value = []
  try {
    const result = await purchaseStore.moveToFirm(
      selectedPurchaseIds.value,
      correctionTargetFirmId.value,
      correctionNote.value,
    )
    correctionStatus.value = `Moved ${result.purchases} bill(s). Updated ${result.vouchers} voucher(s), ${result.reelStocks} reel(s), ${result.stockMovements} stock movement(s), ${result.itemStockMovements} item movement(s), ${result.activityLogs} activity log(s).`
    correctionWarnings.value = result.warnings
    selectedPurchaseIds.value = []
    correctionConfirmText.value = ''
    correctionNote.value = ''
    correctionMode.value = false
  } catch (err: any) {
    alert(err?.message || 'Purchase firm correction failed')
  } finally {
    correctionBusy.value = false
  }
}

onMounted(() => {
  firmStore.load()
  purchaseStore.load()
  partyStore.load()
  itemStore.load()
  if (form.items.length === 0) addRow()
  if (bulkRows.value.length === 0) addBulkRow()
})
</script>

<template>
  <div class="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
    <!-- Header -->
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div class="min-w-0">
        <h1 class="text-2xl font-bold tracking-tight">Purchases Dashboard</h1>
        <p class="text-sm text-slate-500">Record incoming inventory bills and track vendor liabilities</p>
      </div>
      <div class="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap">
        <button 
          @click="activeTab = 'new'"
          class="pp-btn min-w-[9rem] flex-1 sm:flex-none"
          :class="activeTab === 'new' ? 'pp-btn-primary' : 'pp-btn-ghost'"
        >
          ➕ Record Bill
        </button>
        <button 
          @click="activeTab = 'bulk'"
          class="pp-btn min-w-[9rem] flex-1 sm:flex-none"
          :class="activeTab === 'bulk' ? 'pp-btn-primary' : 'pp-btn-ghost'"
        >
          ➕ Multiple Bills
        </button>
        <button 
          @click="activeTab = 'history'"
          class="pp-btn min-w-[9rem] flex-1 sm:flex-none"
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
            <table class="w-full text-left border-collapse min-w-[1080px]">
              <thead>
                <tr class="border-b text-slate-500 font-semibold text-xs uppercase bg-slate-50">
                  <th class="py-2 px-3">Item Description</th>
                  <th class="py-2 px-3 w-28">HSN</th>
                  <th class="py-2 px-3 w-20">Qty</th>
                  <th class="py-2 px-3 w-24">Unit</th>
                  <th class="py-2 px-3 w-24">Rate (₹)</th>
                  <th class="py-2 px-3 w-20">GST %</th>
                  <th class="py-2 px-3 w-44">Stock Tracking</th>
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
                      Paper Reel
                    </label>
                    <label class="mt-2 flex items-center gap-2 text-xs font-semibold">
                      <input type="checkbox" v-model="item.is_consumable" @change="toggleConsumable(idx)" />
                      Consumable
                    </label>
                    <select v-if="item.is_consumable" v-model="item.consumable_type" class="pp-input mt-2 text-xs">
                      <option value="glue">Glue</option>
                      <option value="ink">Ink</option>
                      <option value="stitching_wire">Stitching Wire</option>
                    </select>
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
                    <div class="grid grid-cols-2 md:grid-cols-8 gap-3">
                      <div>
                        <label class="pp-label">Paper Type</label>
                        <select v-model="item.paper_type" class="pp-input">
                          <option v-for="type in paperTypes" :key="type" :value="type">{{ type }}</option>
                        </select>
                      </div>
                      <div>
                        <label class="pp-label">Reel No (optional)</label>
                        <input v-model="item.reel_no" class="pp-input" placeholder="Reel/batch no" />
                      </div>
                      <div>
                        <label class="pp-label">Deckle / Reel Size *</label>
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
                          <option value="NS">NS - Natural Shade / Brown</option>
                          <option value="GY">GY - Golden Yellow</option>
                        </select>
                      </div>
                      <div>
                        <label class="pp-label">Reel Weight KG *</label>
                        <input type="number" v-model.number="item.reel_weight" class="pp-input text-right" placeholder="0" />
                      </div>
                      <div>
                        <label class="pp-label">No. of Reels *</label>
                        <input type="number" min="1" step="1" v-model.number="item.reel_count" class="pp-input text-right" placeholder="1" />
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

    <!-- Active Tab: Quick Multiple Purchases -->
    <div v-else-if="activeTab === 'bulk'" class="pp-card p-4 sm:p-6 space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-4">
        <div>
          <h2 class="text-md font-semibold text-slate-800">Multiple Purchase Bills</h2>
          <p class="text-xs text-slate-500">Ek ya multiple PDF/image me purchase invoices upload karo, review karo, phir sab ek sath save karo.</p>
        </div>
        <div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <button @click="addBulkRow()" class="pp-btn pp-btn-ghost w-full sm:w-auto">➕ Add Bill Row</button>
          <button @click="saveBulkPurchases()" class="pp-btn pp-btn-primary w-full sm:w-auto">Save All Bills</button>
        </div>
      </div>

      <div class="border-2 border-dashed border-slate-300 rounded-xl p-4 bg-slate-50">
        <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-semibold text-navy">AI Multi-Bill Scan</p>
            <p class="text-xs text-slate-500">Ek popup me multiple PDF ya image files select kar sakte ho. Har file me ek ya multiple bills ho sakte hain.</p>
            <p class="text-xs text-slate-400">Mobile file picker agar multiple select restrict kare, phir bhi upload button yahin se use karo.</p>
          </div>
          <label class="pp-btn pp-btn-primary w-full cursor-pointer text-center sm:w-auto">
            {{ bulkScanLoading ? 'Scanning bills...' : 'Upload Purchase Bills' }}
            <input type="file" :accept="BULK_SCAN_ACCEPT" multiple class="sr-only" :disabled="bulkScanLoading" @change="scanBulkPurchaseFiles" />
          </label>
        </div>
        <p v-if="bulkScanFileName" class="text-xs mt-2 text-slate-500">Selected: {{ bulkScanFileName }}</p>
        <p v-if="bulkScanStatus" class="text-xs mt-2" :class="bulkScanStatus.startsWith('Done') || bulkScanStatus.includes('saved') ? 'text-green-600' : 'text-slate-500'">
          {{ bulkScanStatus }}
        </p>
        <div v-if="bulkScanFileStatuses.length" class="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
          <div
            v-for="file in bulkScanFileStatuses"
            :key="file.name"
            class="rounded-lg border bg-white px-3 py-2 text-xs"
            :class="{
              'border-green-200 text-green-700': file.status === 'done',
              'border-rose-200 text-rose-700': file.status === 'error',
              'border-blue-200 text-blue-700': file.status === 'scanning',
              'border-slate-200 text-slate-500': file.status === 'pending',
            }"
          >
            <div class="font-semibold truncate">{{ file.name }}</div>
            <div>{{ file.message }}</div>
          </div>
        </div>
      </div>

      <div v-if="scannedBills.length" class="space-y-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 class="font-semibold text-slate-800">Extracted Bills Preview</h3>
          <button @click="saveScannedBills" class="pp-btn pp-btn-primary">Save Extracted Bills</button>
        </div>
        <div v-for="(bill, billIdx) in scannedBills" :key="`${bill.billNo || 'bill'}-${billIdx}`" class="border rounded-xl p-4 bg-white space-y-3">
          <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label class="pp-label">Supplier *</label>
              <input v-model="bill.supplierName" class="pp-input" placeholder="Supplier name" />
            </div>
            <div>
              <label class="pp-label">Bill No *</label>
              <input v-model="bill.billNo" class="pp-input" placeholder="Bill no" />
            </div>
            <div>
              <label class="pp-label">Bill Date</label>
              <input v-model="bill.date" type="date" class="pp-input" />
            </div>
            <div>
              <label class="pp-label">GSTIN</label>
              <input v-model="bill.gstin" class="pp-input uppercase" placeholder="GSTIN" />
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse min-w-[880px]">
              <thead>
                <tr class="border-b text-slate-500 font-semibold text-xs uppercase bg-slate-50">
                  <th class="py-2 px-3">Item</th>
                  <th class="py-2 px-3 w-28">HSN</th>
                  <th class="py-2 px-3 w-24">Qty</th>
                  <th class="py-2 px-3 w-24">Unit</th>
                  <th class="py-2 px-3 w-28">Rate</th>
                  <th class="py-2 px-3 w-20">GST</th>
                  <th class="py-2 px-3 w-44">Stock Type</th>
                </tr>
              </thead>
              <tbody class="divide-y text-sm">
                <template v-for="(item, itemIdx) in bill.items || []" :key="`${item.name || 'item'}-${itemIdx}`">
                  <tr>
                    <td class="py-2 px-1"><input v-model="item.name" class="pp-input" /></td>
                    <td class="py-2 px-1"><input v-model="item.hsn" class="pp-input text-xs font-mono" /></td>
                    <td class="py-2 px-1"><input v-model.number="item.qty" type="number" class="pp-input text-right" /></td>
                    <td class="py-2 px-1"><input v-model="item.unit" class="pp-input" /></td>
                    <td class="py-2 px-1"><input v-model.number="item.rate" type="number" class="pp-input text-right" step="0.01" /></td>
                    <td class="py-2 px-1"><input v-model.number="item.gst" type="number" class="pp-input text-right" /></td>
                    <td class="py-2 px-1">
                      <label class="flex items-center gap-2 text-xs font-semibold">
                        <input type="checkbox" v-model="item.isKraftReel" />
                        Paper Reel
                      </label>
                      <label class="mt-2 flex items-center gap-2 text-xs font-semibold">
                        <input type="checkbox" v-model="item.isConsumable" />
                        Consumable
                      </label>
                      <select v-if="item.isConsumable" v-model="item.consumableType" class="pp-input mt-2 text-xs">
                        <option value="glue">Glue</option>
                        <option value="ink">Ink</option>
                        <option value="stitching_wire">Stitching Wire</option>
                      </select>
                    </td>
                  </tr>
                  <tr v-if="item.isKraftReel" class="bg-amber-50/50">
                    <td colspan="7" class="px-3 py-3">
                      <div class="grid grid-cols-2 md:grid-cols-8 gap-3">
                        <div>
                          <label class="pp-label">Paper Type</label>
                          <select v-model="item.paperType" class="pp-input">
                            <option v-for="type in paperTypes" :key="type" :value="type">{{ type }}</option>
                          </select>
                        </div>
                        <div>
                          <label class="pp-label">Reel No (optional)</label>
                          <input v-model="item.reelNo" class="pp-input" placeholder="Reel/batch no" />
                        </div>
                        <div>
                          <label class="pp-label">Deckle / Reel Size *</label>
                          <input v-model="item.deckleSize" class="pp-input" placeholder="e.g. 52 inch" />
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
                            <option value="NS">NS - Natural Shade / Brown</option>
                            <option value="GY">GY - Golden Yellow</option>
                          </select>
                        </div>
                        <div>
                          <label class="pp-label">Reel Weight KG *</label>
                          <input type="number" v-model.number="item.reelWeight" class="pp-input text-right" placeholder="0" />
                        </div>
                        <div>
                          <label class="pp-label">No. of Reels *</label>
                          <input type="number" min="1" step="1" v-model.number="item.reelCount" class="pp-input text-right" placeholder="1" />
                        </div>
                      </div>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
          <div class="flex justify-between items-center text-sm">
            <span class="text-slate-500">AI Total: ₹{{ n2(bill.grandTotal || 0) }}</span>
            <button @click="removeScannedBill(billIdx)" class="pp-btn pp-btn-ghost px-2 py-1 text-xs text-rose-600">Remove</button>
          </div>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse min-w-[1320px]">
          <thead>
            <tr class="border-b text-slate-500 font-semibold text-xs uppercase bg-slate-50">
              <th class="py-2 px-3 w-48">Supplier</th>
              <th class="py-2 px-3 w-36">Bill No</th>
              <th class="py-2 px-3 w-36">Bill Date</th>
              <th class="py-2 px-3 w-36">Received</th>
              <th class="py-2 px-3">Item</th>
              <th class="py-2 px-3 w-28">HSN</th>
              <th class="py-2 px-3 w-24">Qty</th>
              <th class="py-2 px-3 w-24">Unit</th>
              <th class="py-2 px-3 w-28">Rate</th>
              <th class="py-2 px-3 w-20">GST</th>
              <th class="py-2 px-3 w-40">Consumable</th>
              <th class="py-2 px-3 w-36 text-right">Total</th>
              <th class="py-2 px-3 w-10"></th>
            </tr>
          </thead>
          <tbody class="divide-y text-sm">
            <tr v-for="(row, idx) in bulkRows" :key="idx" class="hover:bg-slate-50/50">
              <td class="py-2 px-1">
                <input v-model="row.supplier_name" class="pp-input" list="vendors-list" placeholder="Vendor" />
              </td>
              <td class="py-2 px-1">
                <input v-model="row.bill_no" class="pp-input" placeholder="Bill no" />
              </td>
              <td class="py-2 px-1">
                <input v-model="row.date" type="date" class="pp-input" />
              </td>
              <td class="py-2 px-1">
                <input v-model="row.received_date" type="date" class="pp-input" />
              </td>
              <td class="py-2 px-1">
                <input v-model="row.item_name" class="pp-input" list="items-list" placeholder="Item name" />
              </td>
              <td class="py-2 px-1">
                <input v-model="row.hsn" class="pp-input text-xs font-mono" />
              </td>
              <td class="py-2 px-1">
                <input v-model.number="row.qty" type="number" class="pp-input text-right" />
              </td>
              <td class="py-2 px-1">
                <select v-model="row.unit" class="pp-input">
                  <option value="KG">KG</option>
                  <option value="PCS">PCS</option>
                  <option value="NOS">NOS</option>
                  <option value="BOX">BOX</option>
                  <option value="SET">SET</option>
                </select>
              </td>
              <td class="py-2 px-1">
                <input v-model.number="row.rate" type="number" class="pp-input text-right" step="0.01" />
              </td>
              <td class="py-2 px-1">
                <select v-model.number="row.gst" class="pp-input">
                  <option :value="0">0%</option>
                  <option :value="5">5%</option>
                  <option :value="12">12%</option>
                  <option :value="18">18%</option>
                  <option :value="28">28%</option>
                </select>
              </td>
              <td class="py-2 px-1">
                <label class="flex items-center gap-2 text-xs font-semibold">
                  <input type="checkbox" v-model="row.is_consumable" @change="toggleBulkConsumable(row)" />
                  Stock
                </label>
                <select v-if="row.is_consumable" v-model="row.consumable_type" class="pp-input mt-2 text-xs">
                  <option value="glue">Glue</option>
                  <option value="ink">Ink</option>
                  <option value="stitching_wire">Stitching Wire</option>
                </select>
              </td>
              <td class="py-2 px-3 text-right font-mono font-semibold">
                ₹{{ calcBulkAmounts(row).grandTotal.toLocaleString('en-IN') }}.00
              </td>
              <td class="py-2 px-1 text-center">
                <button @click="removeBulkRow(idx)" class="text-rose-500 hover:text-rose-700 text-lg">✕</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 border-t pt-4">
        <div>
          <label class="pp-label">Default Payment Mode</label>
          <select class="pp-input" @change="applyBulkPaymentMode">
            <option value="">Keep row values</option>
            <option value="CASH">Cash</option>
            <option value="BANK">Bank</option>
            <option value="CC_LOAN">CC Account</option>
          </select>
        </div>
        <div>
          <label class="pp-label">Default Payment Status</label>
          <select class="pp-input" @change="applyBulkPayStatus">
            <option value="">Keep row values</option>
            <option value="UNPAID">UNPAID</option>
            <option value="PAID">PAID</option>
          </select>
        </div>
        <div class="flex items-end justify-end">
          <button @click="saveBulkPurchases()" class="pp-btn pp-btn-primary w-full md:w-auto">Save All Bills</button>
        </div>
      </div>

      <datalist id="vendors-list">
        <option v-for="p in partyStore.vendors" :key="p.id" :value="p.name"></option>
      </datalist>
      <datalist id="items-list">
        <option v-for="it in itemStore.list" :key="it.id" :value="it.name"></option>
      </datalist>
    </div>

    <!-- Active Tab: Purchase Logs / History -->
    <div v-else class="pp-card p-4 sm:p-6 space-y-4">
      <div class="border-b pb-4">
        <div>
          <h2 class="text-md font-semibold text-slate-800">Bill Logs / Purchase Logs</h2>
          <p class="text-xs text-slate-500">Purchases &gt; Bill Logs me wrong-firm purchase bills ko safely correct kar sakte ho.</p>
        </div>
      </div>

      <div class="rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div class="space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="font-semibold text-blue-950">Move Bills to Another Firm</h3>
              <span class="pp-badge bg-white text-blue-700">{{ selectedPurchaseIds.length }} selected</span>
            </div>
            <p class="text-xs text-blue-800">
              Wrong firm me saved bills ko select karke correct firm me move karo. Move mode start hote hi table me checkboxes dikhengi.
            </p>
          </div>
          <button
            v-if="!correctionMode"
            @click="openCorrectionMode"
            class="pp-btn pp-btn-primary w-full whitespace-nowrap sm:w-auto"
          >
            Move Bills to Another Firm
          </button>
          <button
            v-else
            @click="closeCorrectionMode"
            class="pp-btn pp-btn-ghost w-full whitespace-nowrap sm:w-auto"
            :disabled="correctionBusy"
          >
            Cancel Move Mode
          </button>
        </div>
      </div>

      <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          v-model="search"
          class="pp-input sm:w-64"
          placeholder="Search Supplier or Bill No..."
        />
        <select v-model="statusFilter" class="pp-input w-full sm:w-36">
          <option value="all">All Status</option>
          <option value="PAID">PAID</option>
          <option value="PARTIAL">PARTIAL</option>
          <option value="UNPAID">UNPAID</option>
        </select>
      </div>

      <p v-if="!correctionMode && correctionStatus" class="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
        {{ correctionStatus }}
      </p>
      <div v-if="!correctionMode && correctionWarnings.length" class="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs text-amber-800">
        <p class="font-semibold">Review warnings:</p>
        <ul class="mt-1 list-disc pl-5">
          <li v-for="warning in correctionWarnings" :key="warning">{{ warning }}</li>
        </ul>
      </div>

      <div v-if="correctionMode" class="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3 shadow-sm">
        <div class="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 class="font-semibold text-amber-900">Move Selected Purchase Bills to Correct Firm</h3>
            <p class="text-xs text-amber-800">
              Step 1: tick the wrong bills in the Move column below. Step 2: choose the correct firm, type MOVE, then confirm.
              Ledger vouchers, reel stock, stock movements, item stock movements and activity logs will be moved with sync dirty flags.
            </p>
            <p class="mt-1 text-xs text-amber-700">
              Parties/items are not moved automatically. Exact target-firm matches are used when found; otherwise existing references stay unchanged.
            </p>
          </div>
          <div class="flex gap-2">
            <button @click="selectVisiblePurchases" class="pp-btn pp-btn-ghost px-3 py-1 text-xs" :disabled="filteredPurchases.length === 0 || correctionBusy">
              Select Visible
            </button>
            <button @click="clearCorrectionSelection" class="pp-btn pp-btn-ghost px-3 py-1 text-xs" :disabled="selectedPurchaseIds.length === 0 || correctionBusy">
              Clear
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label class="pp-label">Selected Bills</label>
            <div class="rounded-lg border bg-white px-3 py-2 text-sm font-semibold">
              {{ selectedPurchases.length }} selected
            </div>
          </div>
          <div>
            <label class="pp-label">Correct Firm *</label>
            <select v-model="correctionTargetFirmId" class="pp-input" :disabled="correctionBusy">
              <option value="">Select target firm</option>
              <option v-for="firm in availableTargetFirms" :key="firm.id" :value="firm.id">{{ firm.name }}</option>
            </select>
            <p v-if="availableTargetFirms.length === 0" class="mt-1 text-xs text-amber-700">Move ke liye Settings me dusri firm add karo.</p>
          </div>
          <div>
            <label class="pp-label">Type MOVE *</label>
            <input v-model="correctionConfirmText" class="pp-input" placeholder="MOVE" :disabled="correctionBusy" />
          </div>
          <div class="flex items-end">
            <button
              @click="moveSelectedPurchases"
              class="pp-btn pp-btn-primary w-full"
              :disabled="correctionBusy || selectedPurchaseIds.length === 0 || !correctionTargetFirmId || correctionConfirmText.trim().toUpperCase() !== 'MOVE'"
            >
              {{ correctionBusy ? 'Moving...' : 'Move Selected Bills' }}
            </button>
          </div>
        </div>

        <div>
          <label class="pp-label">Correction Note</label>
          <input v-model="correctionNote" class="pp-input" placeholder="Optional reason/reference for activity log" :disabled="correctionBusy" />
        </div>

        <p v-if="correctionStatus" class="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
          {{ correctionStatus }}
        </p>
        <div v-if="correctionWarnings.length" class="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs text-amber-800">
          <p class="font-semibold">Review warnings:</p>
          <ul class="mt-1 list-disc pl-5">
            <li v-for="warning in correctionWarnings" :key="warning">{{ warning }}</li>
          </ul>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full min-w-[980px] text-left border-collapse">
          <thead>
            <tr class="border-b text-slate-500 font-semibold text-xs uppercase bg-slate-50">
              <th v-if="correctionMode" class="py-3 px-4 w-12 text-center">Move</th>
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
              <td v-if="correctionMode" class="py-3 px-4 text-center">
                <input
                  v-model="selectedPurchaseIds"
                  type="checkbox"
                  :value="pur.id"
                  class="h-4 w-4 rounded text-accent"
                  :disabled="correctionBusy"
                  :aria-label="`Select purchase bill ${pur.bill_no}`"
                />
              </td>
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
              <td :colspan="correctionMode ? 10 : 9" class="py-8 text-center text-slate-400">
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
