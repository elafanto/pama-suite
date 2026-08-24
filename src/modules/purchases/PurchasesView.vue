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
import { scanPurchaseBillsFromFile, formatMultiBillScanWaitHint, type ScanResult } from '@/services/aiScanner'
import {
  annotateScannedBillMatches,
  countDuplicatePurchaseExtras,
  findDuplicatePurchaseGroups,
  purchaseBillBatchKey,
  purchaseMatchesBill,
  type ScannedBillMatchFields,
} from '@/services/purchaseBillMatch'
import {
  attachDocumentFromFile,
  openEntityDocument,
  downloadEntityDocument,
  shareEntityDocumentWhatsApp,
  getAttachmentForEntity,
} from '@/services/documentAttachments'
import { db } from '@/data/db'
import { CAPITAL_CATEGORY_LABELS } from '@/services/assets'
import {
  EXPENSE_CATEGORY_LABELS,
  PURCHASE_LINE_KIND_OPTIONS,
  applyLineKind,
  getLineKind,
  normalizePurchaseLine,
  type PurchaseLineKind,
} from '@/services/purchaseLineKind'
import { proposePurchaseReelSpecs, purchaseHasReelLines, proposePurchaseConsumableSpecs, purchaseHasConsumableLines, STOCK_LABELS, type PurchaseReelSpec, type PurchaseConsumableSpec } from '@/services/production'
import { useTableSort } from '@/composables/useTableSort'
import type { CapitalCategory, ExpenseCategory, GstType, PaperType, PayStatus, Purchase, PurchaseItemLine } from '@/types/models'

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

// Confirm reel stock into Paper Reels (custom reel numbers)
const showReelConfirmModal = ref(false)
const reelConfirmPurchaseId = ref<string | null>(null)
const reelConfirmReplace = ref(false)
const reelConfirmBusy = ref(false)
const reelConfirmRows = ref<PurchaseReelSpec[]>([])
const reelConfirmMill = ref('')

const showConsumableConfirmModal = ref(false)
const consumableConfirmPurchaseId = ref<string | null>(null)
const consumableConfirmReplace = ref(false)
const consumableConfirmBusy = ref(false)
const consumableConfirmRows = ref<PurchaseConsumableSpec[]>([])
const pendingConsumablePurchase = ref<Purchase | null>(null)

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
const capitalCategories = Object.entries(CAPITAL_CATEGORY_LABELS) as [CapitalCategory, string][]
const expenseCategories = Object.entries(EXPENSE_CATEGORY_LABELS) as [ExpenseCategory, string][]
const lineKindOptions = PURCHASE_LINE_KIND_OPTIONS

const bulkRows = ref<BulkPurchaseRow[]>([])
type ScannedBillWithFile = ScanResult & { _sourceFile?: File | null }
const scannedBills = ref<ScannedBillWithFile[]>([])
const scannedBillSelected = ref<Record<number, boolean>>({})
const scannedSaveBusy = ref(false)
const scannedSaveProgress = ref('')
const showDuplicatePurchasesModal = ref(false)
const duplicateDeleteBusy = ref(false)
const duplicateDeleteProgress = ref('')
const selectedDuplicateIds = ref<string[]>([])
const pendingScanFile = ref<File | null>(null)
const purchaseHasDoc = ref<Record<string, boolean>>({})
const attachTargetPurchase = ref<Purchase | null>(null)
const attachBusy = ref(false)
const attachFileInput = ref<HTMLInputElement | null>(null)

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
    is_capital: data.is_capital || false,
    capital_category: data.capital_category || 'plant_machinery',
    asset_tag: data.asset_tag || '',
    is_expense: data.is_expense || false,
    expense_category: data.expense_category || 'other',
    line_kind: data.line_kind,
  })
  const row = form.items[form.items.length - 1]
  applyLineKind(row, getLineKind(row))
}

function removeRow(idx: number) {
  form.items.splice(idx, 1)
  if (form.items.length === 0) addRow()
}

function resetForm() {
  editingId.value = null
  pendingScanFile.value = null
  Object.assign(form, initialFormState())
  addRow()
}

async function loadPurchaseDocFlags() {
  const firmId = firmStore.activeFirmId
  const rows = await db.document_attachments
    .where('firm_id')
    .equals(firmId)
    .filter((r) => !r.is_deleted && r.entity_type === 'purchase')
    .toArray()
  const map: Record<string, boolean> = {}
  for (const row of rows) map[row.entity_id] = true
  purchaseHasDoc.value = map
}

async function tryAttachPurchaseFile(
  purchase: Purchase,
  file: File | null | undefined,
  reuseStoragePath?: string,
): Promise<string | undefined> {
  if (!file) return reuseStoragePath
  const attached = await attachDocumentFromFile({
    file,
    entityType: 'purchase',
    entityId: purchase.id,
    partyName: purchase.supplier_name,
    docNo: purchase.bill_no,
    docDate: purchase.date,
    firmId: purchase.firm_id,
    reuseStoragePath,
  })
  if (attached) purchaseHasDoc.value[purchase.id] = true
  return attached?.storage_path || reuseStoragePath
}

function onScanFailed() {
  pendingScanFile.value = null
}

function applyScan(result: ScanResult, file: File) {
  pendingScanFile.value = file
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
  loadPurchaseDocFlags()
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

function setLineKind(idx: number, kind: PurchaseLineKind) {
  applyLineKind(form.items[idx], kind)
}

function lineKindOf(item: PurchaseItemLine) {
  return getLineKind(item)
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

const enrichedScannedBills = computed(() =>
  annotateScannedBillMatches(scannedBills.value, purchaseStore.list),
)

const scannedBillSummary = computed(() => {
  const enriched = enrichedScannedBills.value
  const saveableNew = enriched.filter((bill) => isSaveableScannedBill(bill))
  return {
    total: enriched.length,
    newCount: saveableNew.length,
    alreadySavedCount: enriched.filter((bill) => bill._matchStatus === 'already_saved').length,
    duplicateCount: enriched.filter((bill) => bill._matchStatus === 'duplicate_in_batch').length,
  }
})

const hasSelectedScannedBills = computed(() =>
  Object.values(scannedBillSelected.value).some(Boolean),
)

function isSaveableScannedBill(bill: ScannedBillWithFile & { _matchStatus?: string }) {
  return Boolean(
    bill._matchStatus === 'new' &&
    String(bill.supplierName ?? '').trim() &&
    String(bill.billNo ?? '').trim() &&
    (bill.items?.length || 0) > 0,
  )
}

function scannedBillMatchAt(idx: number): ScannedBillMatchFields {
  return enrichedScannedBills.value[idx] || { _matchStatus: 'new' }
}

function isScannedBillSelected(idx: number) {
  return Boolean(scannedBillSelected.value[idx])
}

function toggleScannedBillSelected(idx: number) {
  scannedBillSelected.value[idx] = !isScannedBillSelected(idx)
}

function clearScannedBillSelection() {
  scannedBillSelected.value = {}
}

function viewExistingScannedPurchase(purchaseId?: string) {
  if (!purchaseId) return
  const purchase = purchaseStore.list.find((row) => row.id === purchaseId)
  if (purchase) editPurchase(purchase)
}

const duplicatePurchaseGroups = computed(() => findDuplicatePurchaseGroups(purchaseStore.list))
const duplicatePurchaseExtraCount = computed(() => countDuplicatePurchaseExtras(duplicatePurchaseGroups.value))
const duplicatePurchaseIdSet = computed(() => {
  const ids = new Set<string>()
  for (const group of duplicatePurchaseGroups.value) {
    for (const extra of group.extras) ids.add(extra.id)
  }
  return ids
})

function openDuplicatePurchasesModal() {
  selectedDuplicateIds.value = duplicatePurchaseGroups.value.flatMap((group) => group.extras.map((row) => row.id))
  duplicateDeleteProgress.value = ''
  showDuplicatePurchasesModal.value = true
}

function closeDuplicatePurchasesModal() {
  if (duplicateDeleteBusy.value) return
  showDuplicatePurchasesModal.value = false
  selectedDuplicateIds.value = []
  duplicateDeleteProgress.value = ''
}

function isDuplicateExtraSelected(id: string) {
  return selectedDuplicateIds.value.includes(id)
}

function toggleDuplicateExtraSelected(id: string) {
  if (isDuplicateExtraSelected(id)) {
    selectedDuplicateIds.value = selectedDuplicateIds.value.filter((rowId) => rowId !== id)
  } else {
    selectedDuplicateIds.value = [...selectedDuplicateIds.value, id]
  }
}

function selectAllDuplicateExtras() {
  selectedDuplicateIds.value = duplicatePurchaseGroups.value.flatMap((group) => group.extras.map((row) => row.id))
}

function clearDuplicateExtraSelection() {
  selectedDuplicateIds.value = []
}

async function deleteSelectedDuplicatePurchases() {
  const ids = [...selectedDuplicateIds.value]
  if (!ids.length) {
    alert('Delete ke liye kam se kam 1 duplicate bill select karo.')
    return
  }
  if (!confirm(
    `${ids.length} duplicate purchase bill(s) delete honge.\n`
    + `Oldest bill har group me rahega.\n`
    + `Party ledger / stock reverse hoga. Continue?`,
  )) return

  duplicateDeleteBusy.value = true
  let deleted = 0
  const errors: string[] = []
  try {
    for (const id of ids) {
      const pur = purchaseStore.list.find((row) => row.id === id)
      duplicateDeleteProgress.value = `Deleting ${deleted + 1}/${ids.length}${pur ? `: ${pur.supplier_name} / ${pur.bill_no}` : ''}…`
      try {
        await purchaseStore.remove(id)
        delete purchaseHasDoc.value[id]
        deleted++
      } catch (err: any) {
        errors.push(`${pur?.bill_no || id}: ${err?.message || 'delete failed'}`)
      }
    }
    selectedDuplicateIds.value = selectedDuplicateIds.value.filter((id) =>
      duplicatePurchaseIdSet.value.has(id),
    )
    duplicateDeleteProgress.value = errors.length
      ? `${deleted} deleted, ${errors.length} failed.`
      : `${deleted} duplicate bill(s) deleted. Party ledger updated.`
    if (errors.length) {
      alert(`${duplicateDeleteProgress.value}\n\n${errors.slice(0, 5).join('\n')}`)
    } else {
      alert(duplicateDeleteProgress.value)
      if (!duplicatePurchaseExtraCount.value) {
        showDuplicatePurchasesModal.value = false
        selectedDuplicateIds.value = []
      }
    }
  } finally {
    duplicateDeleteBusy.value = false
  }
}

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
  const deckleSize = String(it.deckleSize || it.reelSize || '').trim()
  const hasReelMetadata = Boolean(
    it.reelNo || deckleSize || it.gsm || it.bf || Number(it.reelWeight) > 0 || Number(it.reelCount) > 0,
  )
  return {
    name: String(it.name || ''),
    qty: Number(it.qty) || 0,
    unit: it.unit || 'KG',
    rate: Number(it.rate) || 0,
    hsn: String(it.hsn || '48043100'),
    gst: Number(it.gst) || 18,
    is_kraft_reel: Boolean(it.isKraftReel || hasReelMetadata),
    paper_type: normalizePaperType(it.paperType),
    reel_no: String(it.reelNo || ''),
    deckle_size: deckleSize,
    gsm: String(it.gsm || ''),
    bf: String(it.bf || ''),
    color: normalizeReelColor(it.color),
    reel_weight: Number(it.reelWeight || it.qty || 0),
    reel_count: normalizeReelCount(it.reelCount),
    is_consumable: Boolean(it.isConsumable),
    consumable_type: normalizeConsumableType(it.consumableType),
  }
}

async function ensurePurchaseItemLine(it: NonNullable<ScanResult['items']>[number]): Promise<PurchaseItemLine> {
  const name = String(it.name || '').trim() || 'Purchase Item'
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

async function saveScannedBill(bill: ScannedBillWithFile, reuseStoragePath?: string): Promise<{ purchase: Purchase; storagePath?: string }> {
  const supplierName = String(bill.supplierName ?? '').trim()
  const billNo = String(bill.billNo ?? '').trim()
  if (!supplierName) throw new Error('Supplier name missing')
  if (!billNo) throw new Error('Bill number missing')

  const vendor = await partyStore.ensure(supplierName, 'vendor', {
    gst: bill.gstin != null ? String(bill.gstin) : undefined,
    addr: bill.address != null ? String(bill.address) : undefined,
    city: bill.city != null ? String(bill.city) : undefined,
    pin: bill.pin != null ? String(bill.pin) : undefined,
    phone: bill.phone != null ? String(bill.phone) : undefined,
    bank: bill.bank != null ? String(bill.bank) : undefined,
    acno: bill.acno != null ? String(bill.acno) : undefined,
    ifsc: bill.ifsc != null ? String(bill.ifsc) : undefined,
    acname: bill.acname != null ? String(bill.acname) : undefined,
  })
  const items: PurchaseItemLine[] = []
  for (const it of bill.items || []) {
    const line = await ensurePurchaseItemLine(it)
    if (line.name.trim() && line.qty > 0 && line.rate >= 0) items.push(line)
  }
  if (items.length === 0) throw new Error(`No valid items in bill ${billNo} (qty/rate check failed)`)
  const totals = calcPurchaseTotals(items)
  const purchase = await purchaseStore.add({
    supplier_name: vendor.name,
    supplier_id: vendor.id,
    bill_no: billNo,
    date: String(bill.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
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
  const storagePath = await tryAttachPurchaseFile(purchase, bill._sourceFile, reuseStoragePath)
  return { purchase, storagePath }
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
  const badReel = validItems.find(it => getLineKind(it) === 'reel' && (!it.deckle_size?.trim() || !it.gsm?.trim() || !it.bf?.trim() || !(it.reel_weight || it.qty) || normalizeReelCount(it.reel_count) <= 0))
  if (badReel) {
    alert('Paper reel line me Paper Type, Deckle, GSM, BF, Reel Weight aur No. of Reels required hai. Save ke baad custom reel number confirm karna hoga.')
    return
  }
  const badConsumable = validItems.find(it => getLineKind(it) === 'consumable' && !it.consumable_type)
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
          bf: it.bf || '',
          track_stock: getLineKind(it) === 'inventory' ? undefined : false,
        })
        it.item_id = added.id
      }
    }
  }

  const normalizedItems = validItems.map((it) => normalizePurchaseLine({
    ...it,
    reel_count: getLineKind(it) === 'reel' ? normalizeReelCount(it.reel_count) : undefined,
    paper_type: getLineKind(it) === 'reel' ? normalizePaperType(it.paper_type) : undefined,
    capital_category: getLineKind(it) === 'capital' ? (it.capital_category || 'plant_machinery') : undefined,
    asset_tag: getLineKind(it) === 'capital' ? (it.asset_tag?.trim() || undefined) : undefined,
    expense_category: getLineKind(it) === 'expense' ? (it.expense_category || 'other') : undefined,
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
    let savedPurchase: Purchase | null = null
    let openReelConfirm = false
    let openConsumableConfirm = false
    let replaceExisting = false

    if (editingId.value) {
      const updateResult = await purchaseStore.update(editingId.value, purchaseData)
      savedPurchase = purchaseStore.list.find((p) => p.id === editingId.value) || null
      openReelConfirm = !!updateResult?.needsReelConfirm
      openConsumableConfirm = !!updateResult?.needsConsumableConfirm
      replaceExisting = !!updateResult?.reelStockChanged
      alert('Purchase bill updated successfully!')
    } else {
      const purchase = await purchaseStore.add(purchaseData)
      savedPurchase = purchase
      openReelConfirm = purchaseHasReelLines(purchase)
      openConsumableConfirm = purchaseHasConsumableLines(purchase)
      replaceExisting = false
      const attached = await tryAttachPurchaseFile(purchase, pendingScanFile.value)
      pendingScanFile.value = null
      alert(attached
        ? 'Purchase bill saved + document archived (compressed & cloud).'
        : 'Purchase bill saved successfully!')
    }

    resetForm()
    activeTab.value = 'history'

    if (savedPurchase && openConsumableConfirm) {
      pendingConsumablePurchase.value = savedPurchase
    } else {
      pendingConsumablePurchase.value = null
    }

    if (openReelConfirm && savedPurchase) {
      openReelStockConfirm(savedPurchase, replaceExisting)
    } else if (pendingConsumablePurchase.value) {
      await openConsumableStockConfirm(pendingConsumablePurchase.value)
    }
  } catch (err: any) {
    alert(err?.message || 'Purchase bill save failed')
    // pendingScanFile retained so user can fix form and retry attach on save
  }
}

async function openReelStockConfirm(purchase: Purchase, replaceExisting: boolean) {
  const specs = proposePurchaseReelSpecs(purchase)
  if (!specs.length) {
    if (pendingConsumablePurchase.value) await openConsumableStockConfirm(pendingConsumablePurchase.value)
    return
  }
  // Prefer checking live stock for replace flag when editing without signature change
  // but user never confirmed before.
  let replace = replaceExisting
  if (!replace) {
    const existingCount = await db.reel_stocks
      .where('purchase_id')
      .equals(purchase.id)
      .filter((r) => !r.is_deleted)
      .count()
    replace = existingCount > 0
  }
  reelConfirmPurchaseId.value = purchase.id
  reelConfirmReplace.value = replace
  reelConfirmMill.value = purchase.supplier_name
  reelConfirmRows.value = specs.map((s) => ({ ...s }))
  showReelConfirmModal.value = true
}

function closeReelConfirmModal() {
  showReelConfirmModal.value = false
  reelConfirmPurchaseId.value = null
  reelConfirmRows.value = []
  reelConfirmBusy.value = false
  const pending = pendingConsumablePurchase.value
  if (pending) {
    pendingConsumablePurchase.value = null
    void openConsumableStockConfirm(pending)
  }
}

async function submitReelStockConfirm() {
  if (!reelConfirmPurchaseId.value) return
  const rows = reelConfirmRows.value
  if (rows.some((r) => !String(r.reel_no || '').trim())) {
    return alert('Har reel ka custom reel number bharo')
  }
  if (rows.some((r) => !(Number(r.opening_weight) > 0))) {
    return alert('Har reel ka weight 0 se zyada hona chahiye')
  }
  reelConfirmBusy.value = true
  try {
    const result = await purchaseStore.confirmReelStock(
      reelConfirmPurchaseId.value,
      rows.map((r) => ({
        ...r,
        reel_no: String(r.reel_no).trim(),
        color: normalizeReelColor(r.color),
        paper_type: normalizePaperType(r.paper_type),
        note: r.note || `${normalizePaperType(r.paper_type)} reel ${String(r.reel_no).trim()} from purchase`,
      })),
      { replaceExisting: reelConfirmReplace.value },
    )
    showReelConfirmModal.value = false
    reelConfirmPurchaseId.value = null
    reelConfirmRows.value = []
    alert(`${result.count} reel(s) Paper Reels stock me add ho gaye.`)
    const pending = pendingConsumablePurchase.value
    pendingConsumablePurchase.value = null
    if (pending) await openConsumableStockConfirm(pending)
  } catch (err: any) {
    alert(err?.message || 'Reel stock confirm failed')
  } finally {
    reelConfirmBusy.value = false
  }
}

async function openConsumableStockConfirm(purchase: Purchase) {
  const specs = proposePurchaseConsumableSpecs(purchase)
  if (!specs.length) return
  let replace = false
  const existingCount = await db.stock_movements
    .where('ref_id')
    .equals(purchase.id)
    .filter((m) => !m.is_deleted && m.source === 'purchase' && ['glue', 'ink', 'stitching_wire'].includes(m.stock_type))
    .count()
  replace = existingCount > 0
  consumableConfirmPurchaseId.value = purchase.id
  consumableConfirmReplace.value = replace
  consumableConfirmRows.value = specs.map((s) => ({ ...s }))
  showConsumableConfirmModal.value = true
}

function closeConsumableConfirmModal() {
  showConsumableConfirmModal.value = false
  consumableConfirmPurchaseId.value = null
  consumableConfirmRows.value = []
  consumableConfirmBusy.value = false
  pendingConsumablePurchase.value = null
}

async function submitConsumableStockConfirm() {
  if (!consumableConfirmPurchaseId.value) return
  const rows = consumableConfirmRows.value
  if (rows.some((r) => !(Number(r.qty) > 0 || Number(r.weight) > 0))) {
    return alert('Har consumable ka qty ya weight 0 se zyada hona chahiye')
  }
  consumableConfirmBusy.value = true
  try {
    const result = await purchaseStore.confirmConsumableStock(
      consumableConfirmPurchaseId.value,
      rows.map((r) => ({
        ...r,
        qty: Number(r.qty) || 0,
        weight: Number(r.weight) || 0,
        note: r.note || `${STOCK_LABELS[r.stock_type]} from purchase`,
      })),
      { replaceExisting: consumableConfirmReplace.value },
    )
    closeConsumableConfirmModal()
    alert(`${result.count} consumable line(s) stock me add ho gaye.`)
  } catch (err: any) {
    alert(err?.message || 'Consumable stock confirm failed')
  } finally {
    consumableConfirmBusy.value = false
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
    purchaseStore.list.some((p) => purchaseMatchesBill(p, row.supplier_name, row.bill_no)),
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
  clearScannedBillSelection()

  const extractedBills: ScannedBillWithFile[] = []
  try {
    for (const [idx, file] of files.entries()) {
      bulkScanFileStatuses.value[idx] = {
        name: file.name,
        status: 'scanning',
        message: formatMultiBillScanWaitHint(file.size, file.type || 'application/pdf'),
      }
      bulkScanStatus.value = files.length === 1
        ? formatMultiBillScanWaitHint(file.size, file.type || 'application/pdf')
        : `File ${idx + 1}/${files.length}: ${formatMultiBillScanWaitHint(file.size, file.type || 'application/pdf')}`

      try {
        const result = await scanPurchaseBillsFromFile(settingsStore.geminiKey, file, {
          onProgress: ({ message }) => {
            bulkScanFileStatuses.value[idx] = {
              name: file.name,
              status: 'scanning',
              message,
            }
            bulkScanStatus.value = files.length === 1
              ? message
              : `File ${idx + 1}/${files.length}: ${message}`
          },
        })
        const bills = (result.bills || [])
          .filter((b) => b.supplierName || b.billNo || b.items?.length)
          .map((b) => ({ ...b, _sourceFile: file }))
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
    if (extractedBills.length) {
      const summary = scannedBillSummary.value
      bulkScanStatus.value = summary.alreadySavedCount || summary.duplicateCount
        ? `Done - ${summary.total} extracted, ${summary.alreadySavedCount} already saved, ${summary.newCount} new. Review and save.`
        : `Done - ${summary.total} bill(s) extracted from ${files.length - failedCount}/${files.length} file(s). Review and save.`
    } else {
      bulkScanStatus.value = failedCount
        ? `No bills extracted. ${failedCount} file(s) failed.`
        : `No purchase bills found in ${files.length === 1 ? 'this file' : 'selected files'}.`
    }
  } finally {
    bulkScanLoading.value = false
    input.value = ''
  }
}

function removeScannedBill(idx: number) {
  scannedBills.value.splice(idx, 1)
  clearScannedBillSelection()
}

function removeAllAlreadySavedScanned() {
  const enriched = enrichedScannedBills.value
  scannedBills.value = scannedBills.value.filter((_, idx) => enriched[idx]?._matchStatus !== 'already_saved')
  clearScannedBillSelection()
}

function removeSelectedScanned() {
  const selected = new Set(
    Object.entries(scannedBillSelected.value)
      .filter(([, checked]) => checked)
      .map(([idx]) => Number(idx)),
  )
  if (!selected.size) return
  scannedBills.value = scannedBills.value.filter((_, idx) => !selected.has(idx))
  clearScannedBillSelection()
}

async function saveScannedBills() {
  if (scannedSaveBusy.value) return
  scannedSaveBusy.value = true
  scannedSaveProgress.value = ''
  try {
    const enriched = enrichedScannedBills.value
    const bills = enriched.filter((bill) => isSaveableScannedBill(bill))
    if (bills.length === 0) {
      const skipped = enriched.filter((bill) => bill._matchStatus !== 'new').length
      const incompleteNew = enriched.filter((bill) =>
        bill._matchStatus === 'new' && !isSaveableScannedBill(bill),
      ).length
      alert(skipped
        ? 'Save karne ke liye koi naya bill nahi hai. Already saved / duplicate bills hatao ya edit karo.'
        : incompleteNew
          ? 'Naye bills incomplete hain — supplier, bill no aur kam se kam 1 item chahiye.'
          : 'Scan se koi complete bill extract nahi hua.')
      return
    }
    const duplicateBill = bills.find((bill, idx) =>
      bills.findIndex((row) =>
        purchaseBillBatchKey(row.supplierName, row.billNo) === purchaseBillBatchKey(bill.supplierName, bill.billNo),
      ) !== idx,
    )
    if (duplicateBill) {
      alert(`Scanned bills me duplicate bill found: ${duplicateBill.supplierName} / ${duplicateBill.billNo}`)
      return
    }

    let saved = 0
    let skippedExisting = 0
    const fileStoragePaths = new Map<File, string>()
    const savedKeys = new Set<string>()
    for (const [idx, bill] of bills.entries()) {
      const supplierName = String(bill.supplierName ?? '').trim()
      const billNo = String(bill.billNo ?? '').trim()
      scannedSaveProgress.value = `Saving ${idx + 1}/${bills.length}: ${supplierName} / ${billNo}…`
      bulkScanStatus.value = scannedSaveProgress.value

      if (purchaseStore.list.some((p) => purchaseMatchesBill(p, supplierName, billNo))) {
        skippedExisting++
        savedKeys.add(purchaseBillBatchKey(supplierName, billNo))
        continue
      }

      const sourceFile = bill._sourceFile || null
      const reusePath = sourceFile ? fileStoragePaths.get(sourceFile) : undefined
      const { storagePath } = await saveScannedBill(bill, reusePath)
      savedKeys.add(purchaseBillBatchKey(supplierName, billNo))
      if (sourceFile && storagePath && !fileStoragePaths.has(sourceFile)) {
        fileStoragePaths.set(sourceFile, storagePath)
      }
      saved++
    }
    scannedBills.value = scannedBills.value.filter((bill) =>
      !savedKeys.has(purchaseBillBatchKey(bill.supplierName, bill.billNo)),
    )
    clearScannedBillSelection()
    const summary = skippedExisting
      ? `${saved} saved, ${skippedExisting} already existed (skipped).`
      : `${saved} scanned purchase bill(s) saved successfully.`
    scannedSaveProgress.value = summary
    bulkScanStatus.value = summary
    alert(summary)
    activeTab.value = 'history'
  } catch (err: any) {
    bulkScanStatus.value = err?.message || 'Saving scanned bills failed'
    scannedSaveProgress.value = bulkScanStatus.value
    alert(bulkScanStatus.value)
  } finally {
    scannedSaveBusy.value = false
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
  
  form.items = pur.items.map(it => normalizePurchaseLine({
    ...it,
    reel_count: getLineKind(it) === 'reel' ? normalizeReelCount(it.reel_count) : it.reel_count,
  }))
  activeTab.value = 'new'
}

// Delete purchase bill
function openAttachModal(pur: Purchase) {
  attachTargetPurchase.value = pur
  attachFileInput.value?.click()
}

async function onAttachFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  const pur = attachTargetPurchase.value
  if (!file || !pur) return
  attachBusy.value = true
  try {
    await tryAttachPurchaseFile(pur, file)
    attachTargetPurchase.value = null
    alert('Bill file attached (compressed + cloud queue).')
  } catch (err: unknown) {
    alert(err instanceof Error ? err.message : 'Attach failed')
  } finally {
    attachBusy.value = false
    input.value = ''
  }
}

async function showDocInfo(pur: Purchase) {
  const rec = await getAttachmentForEntity('purchase', pur.id)
  if (!rec) return
  alert(`Stored: ${rec.stored_name}\nOriginal: ${rec.original_name}\nSize: ${Math.round(rec.size_bytes / 1024)} KB\nCloud: ${rec.upload_status}`)
}

async function deletePurchase(pur: Purchase) {
  if (confirm(`Delete purchase bill ${pur.bill_no}? Ledger/stock reverse hoga; scan file Recycle Bin me jayegi.`)) {
    try {
      await purchaseStore.remove(pur.id)
      delete purchaseHasDoc.value[pur.id]
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
const filteredPurchasesBase = computed(() => {
  return purchaseStore.list.filter(p => {
    // Search filter
    const matchesSearch = p.supplier_name.toLowerCase().includes(search.value.toLowerCase()) || 
                          p.bill_no.toLowerCase().includes(search.value.toLowerCase())
    
    // Status filter
    const matchesStatus = statusFilter.value === 'all' || p.pay_status === statusFilter.value
    
    return matchesSearch && matchesStatus
  })
})

type PurchaseSortKey = 'date' | 'bill_no' | 'supplier_name' | 'sub' | 'total_tax' | 'grand_total' | 'amt_paid' | 'pay_status'
const purchaseSort = useTableSort<PurchaseSortKey>('date', 'desc')
const filteredPurchases = purchaseSort.sortedFrom(filteredPurchasesBase, {
  date: (r) => r.date,
  bill_no: (r) => r.bill_no,
  supplier_name: (r) => r.supplier_name,
  sub: (r) => r.sub,
  total_tax: (r) => r.total_tax,
  grand_total: (r) => r.grand_total,
  amt_paid: (r) => r.amt_paid || 0,
  pay_status: (r) => r.pay_status,
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

onMounted(async () => {
  await firmStore.load()
  await Promise.all([purchaseStore.load(), partyStore.load(), itemStore.load()])
  await loadPurchaseDocFlags()
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
        <AiScanPanel @scanned="applyScan" @scan-failed="onScanFailed" />
        <input ref="attachFileInput" type="file" accept="image/*,application/pdf" class="sr-only" :disabled="attachBusy" @change="onAttachFile" />
        <p v-if="pendingScanFile" class="text-xs text-emerald-700 -mt-2 mb-2">
          📎 {{ pendingScanFile.name }} — bill save par auto-compress + Supabase par archive hogi
        </p>
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
                  <th class="py-2 px-3 w-52">Entry Type</th>
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
                  <td class="py-2 px-1 align-top">
                    <div class="space-y-1 rounded-lg border border-slate-200 bg-white p-2 min-w-[9.5rem]">
                      <label
                        v-for="opt in lineKindOptions"
                        :key="opt.kind"
                        class="flex items-start gap-2 text-[11px] font-medium cursor-pointer select-none"
                        :class="lineKindOf(item) === opt.kind ? 'text-navy' : 'text-slate-500'"
                        :title="opt.hint"
                      >
                        <input
                          type="checkbox"
                          class="mt-0.5 rounded border-slate-300 text-navy focus:ring-navy shrink-0"
                          :checked="lineKindOf(item) === opt.kind"
                          @click.prevent="setLineKind(idx, opt.kind)"
                        />
                        <span>{{ opt.label }}</span>
                      </label>
                    </div>
                    <select v-if="lineKindOf(item) === 'consumable'" v-model="item.consumable_type" class="pp-input mt-2 text-xs">
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
                <tr v-for="(item, idx) in form.items.filter(i => lineKindOf(i) === 'expense')" :key="`expense-${idx}-${item.name}`" class="bg-slate-50/80">
                  <td colspan="9" class="px-3 py-3">
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <label class="pp-label">Expense Category *</label>
                        <select v-model="item.expense_category" class="pp-input">
                          <option v-for="[key, label] in expenseCategories" :key="key" :value="key">{{ label }}</option>
                        </select>
                      </div>
                      <div class="md:col-span-3 flex items-end">
                        <p class="text-xs text-slate-600">Expense lines stock/reel/capital me nahi jate — sirf purchase bill aur accounts me record hote hain (building material, electricity connection, etc.).</p>
                      </div>
                    </div>
                  </td>
                </tr>
                <tr v-for="(item, idx) in form.items.filter(i => lineKindOf(i) === 'capital')" :key="`capital-${idx}-${item.name}`" class="bg-violet-50/50">
                  <td colspan="9" class="px-3 py-3">
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <label class="pp-label">Category *</label>
                        <select v-model="item.capital_category" class="pp-input">
                          <option v-for="[key, label] in capitalCategories" :key="key" :value="key">{{ label }}</option>
                        </select>
                      </div>
                      <div>
                        <label class="pp-label">Asset Tag / ID (optional)</label>
                        <input v-model="item.asset_tag" class="pp-input" placeholder="e.g. M/C-01, vehicle no." />
                      </div>
                      <div class="md:col-span-2 flex items-end">
                        <p class="text-xs text-violet-800">Capital goods consume nahi hote — alag Capital Assets list me dikhenge, consumable inventory me nahi.</p>
                      </div>
                    </div>
                  </td>
                </tr>
                <tr v-for="(item, idx) in form.items.filter(i => lineKindOf(i) === 'reel')" :key="`reel-${idx}-${item.name}`" class="bg-amber-50/50">
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
            <p class="text-xs text-slate-400">Large PDFs (4+ pages or 4MB+) scan page-by-page — 20–30 page file ~15–20 min. Max 20MB / 50 pages.</p>
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
        <div class="flex flex-col gap-3">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 class="font-semibold text-slate-800">Extracted Bills Preview</h3>
              <p class="text-xs text-slate-500 mt-1">
                {{ scannedBillSummary.total }} extracted
                <span v-if="scannedBillSummary.newCount"> · {{ scannedBillSummary.newCount }} new</span>
                <span v-if="scannedBillSummary.alreadySavedCount"> · {{ scannedBillSummary.alreadySavedCount }} already saved</span>
                <span v-if="scannedBillSummary.duplicateCount"> · {{ scannedBillSummary.duplicateCount }} duplicate in scan</span>
              </p>
            </div>
            <button
              @click="saveScannedBills"
              class="pp-btn pp-btn-primary"
              :disabled="scannedSaveBusy || scannedBillSummary.newCount === 0"
            >
              {{ scannedSaveBusy
                ? (scannedSaveProgress || 'Saving…')
                : `Save ${scannedBillSummary.newCount || ''} New Bill${scannedBillSummary.newCount === 1 ? '' : 's'}` }}
            </button>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-if="scannedBillSummary.alreadySavedCount"
              @click="removeAllAlreadySavedScanned"
              class="pp-btn pp-btn-ghost text-xs text-amber-700"
            >
              Remove all already saved ({{ scannedBillSummary.alreadySavedCount }})
            </button>
            <button
              v-if="hasSelectedScannedBills"
              @click="removeSelectedScanned"
              class="pp-btn pp-btn-ghost text-xs text-rose-600"
            >
              Remove selected
            </button>
          </div>
        </div>
        <div
          v-for="(bill, billIdx) in scannedBills"
          :key="`${bill.billNo || 'bill'}-${billIdx}`"
          class="border rounded-xl p-4 bg-white space-y-3"
          :class="{
            'border-amber-300 bg-amber-50/40': scannedBillMatchAt(billIdx)._matchStatus === 'already_saved',
            'border-violet-300 bg-violet-50/40': scannedBillMatchAt(billIdx)._matchStatus === 'duplicate_in_batch',
          }"
        >
          <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <label class="flex items-center gap-2 text-xs font-semibold text-slate-600">
              <input
                type="checkbox"
                :checked="isScannedBillSelected(billIdx)"
                @change="toggleScannedBillSelected(billIdx)"
              />
              Select
            </label>
            <div class="flex flex-wrap items-center gap-2">
              <span
                v-if="scannedBillMatchAt(billIdx)._matchStatus === 'already_saved'"
                class="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800"
              >
                Already saved
                <span v-if="scannedBillMatchAt(billIdx)._existingPurchaseDate">
                  ({{ scannedBillMatchAt(billIdx)._existingPurchaseDate }})
                </span>
              </span>
              <span
                v-else-if="scannedBillMatchAt(billIdx)._matchStatus === 'duplicate_in_batch'"
                class="inline-flex items-center rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-800"
              >
                Duplicate in scan
              </span>
              <span
                v-else
                class="inline-flex items-center rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-800"
              >
                New
              </span>
              <button
                v-if="scannedBillMatchAt(billIdx)._existingPurchaseId"
                @click="viewExistingScannedPurchase(scannedBillMatchAt(billIdx)._existingPurchaseId)"
                class="pp-btn pp-btn-ghost px-2 py-1 text-xs"
              >
                View saved bill
              </button>
            </div>
          </div>
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

      <div
        v-if="duplicatePurchaseExtraCount"
        class="rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm"
      >
        <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div class="space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="font-semibold text-amber-950">Duplicate purchase bills found</h3>
              <span class="pp-badge bg-white text-amber-800">{{ duplicatePurchaseExtraCount }} extra</span>
            </div>
            <p class="text-xs text-amber-900">
              Same supplier + bill number multiple times saved hain. Extra copies delete karo — party ledger automatically reverse / update ho jayega.
            </p>
          </div>
          <button
            type="button"
            class="pp-btn pp-btn-primary w-full whitespace-nowrap sm:w-auto !bg-amber-700 hover:!bg-amber-800"
            @click="openDuplicatePurchasesModal"
          >
            Review &amp; Delete Duplicates
          </button>
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
              <th class="py-3 px-4" :class="purchaseSort.thClass('date')" @click="purchaseSort.toggle('date', 'desc')">Date{{ purchaseSort.indicator('date') }}</th>
              <th class="py-3 px-4" :class="purchaseSort.thClass('bill_no')" @click="purchaseSort.toggle('bill_no')">Bill No{{ purchaseSort.indicator('bill_no') }}</th>
              <th class="py-3 px-4" :class="purchaseSort.thClass('supplier_name')" @click="purchaseSort.toggle('supplier_name')">Supplier Name{{ purchaseSort.indicator('supplier_name') }}</th>
              <th class="py-3 px-4" :class="purchaseSort.thClass('sub', 'right')" @click="purchaseSort.toggle('sub', 'desc')">Taxable{{ purchaseSort.indicator('sub') }}</th>
              <th class="py-3 px-4" :class="purchaseSort.thClass('total_tax', 'right')" @click="purchaseSort.toggle('total_tax', 'desc')">GST{{ purchaseSort.indicator('total_tax') }}</th>
              <th class="py-3 px-4" :class="purchaseSort.thClass('grand_total', 'right')" @click="purchaseSort.toggle('grand_total', 'desc')">Total{{ purchaseSort.indicator('grand_total') }}</th>
              <th class="py-3 px-4" :class="purchaseSort.thClass('amt_paid', 'right')" @click="purchaseSort.toggle('amt_paid', 'desc')">Paid{{ purchaseSort.indicator('amt_paid') }}</th>
              <th class="py-3 px-4" :class="purchaseSort.thClass('pay_status', 'center')" @click="purchaseSort.toggle('pay_status')">Status{{ purchaseSort.indicator('pay_status') }}</th>
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
              <td class="py-3 px-4 font-mono">
                <div class="flex flex-wrap items-center gap-2">
                  <span>{{ pur.bill_no }}</span>
                  <span
                    v-if="duplicatePurchaseIdSet.has(pur.id)"
                    class="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800"
                  >Duplicate</span>
                </div>
              </td>
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
                <div class="flex justify-center gap-2 flex-wrap">
                  <button
                    v-if="!purchaseHasDoc[pur.id]"
                    type="button"
                    class="pp-btn pp-btn-ghost px-2 py-1 text-xs text-amber-700 border border-amber-200 bg-amber-50"
                    title="Bill saved but file missing"
                    :disabled="attachBusy"
                    @click="openAttachModal(pur)"
                  >📎 Attach now</button>
                  <button
                    v-if="purchaseHasDoc[pur.id]"
                    type="button"
                    class="pp-btn pp-btn-ghost px-2 py-1 text-xs"
                    title="View saved bill file"
                    @click="openEntityDocument('purchase', pur.id)"
                  >📎 View</button>
                  <button
                    v-if="purchaseHasDoc[pur.id]"
                    type="button"
                    class="pp-btn pp-btn-ghost px-2 py-1 text-xs"
                    title="Original filename & metadata"
                    @click="showDocInfo(pur)"
                  >ℹ️</button>
                  <button
                    v-if="purchaseHasDoc[pur.id]"
                    type="button"
                    class="pp-btn pp-btn-ghost px-2 py-1 text-xs"
                    title="Download renamed bill file"
                    @click="downloadEntityDocument('purchase', pur.id)"
                  >⬇️</button>
                  <button
                    v-if="purchaseHasDoc[pur.id]"
                    type="button"
                    class="pp-btn pp-btn-ghost px-2 py-1 text-xs"
                    title="WhatsApp share renamed file"
                    @click="shareEntityDocumentWhatsApp('purchase', pur.id)"
                  >📤</button>
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

    <!-- Duplicate purchase cleanup -->
    <PpModal
      :show="showDuplicatePurchasesModal"
      title="Delete Duplicate Purchase Bills"
      @close="closeDuplicatePurchasesModal"
    >
      <div class="space-y-4">
        <p class="text-sm text-slate-600">
          Har group me <strong>oldest</strong> bill keep hoga. Extra copies select karke delete karo —
          purchase ledger + payment voucher reverse honge, party outstanding update ho jayega.
        </p>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="pp-btn pp-btn-ghost text-xs" :disabled="duplicateDeleteBusy" @click="selectAllDuplicateExtras">
            Select all extras
          </button>
          <button type="button" class="pp-btn pp-btn-ghost text-xs" :disabled="duplicateDeleteBusy" @click="clearDuplicateExtraSelection">
            Clear selection
          </button>
        </div>
        <div v-if="!duplicatePurchaseGroups.length" class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
          Ab koi duplicate nahi bacha.
        </div>
        <div v-else class="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
          <div
            v-for="group in duplicatePurchaseGroups"
            :key="group.key"
            class="rounded-xl border border-amber-200 bg-amber-50/40 p-3 space-y-2"
          >
            <div class="text-sm font-semibold text-slate-800">
              {{ group.supplierName }}
              <span class="font-mono text-slate-600"> / {{ group.billNo }}</span>
              <span class="ml-2 text-xs font-normal text-amber-800">{{ group.extras.length + 1 }} copies</span>
            </div>
            <div class="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs text-emerald-800">
              Keep (oldest): {{ group.keep.date }} · ₹{{ n2(group.keep.grand_total) }} · {{ group.keep.pay_status }}
            </div>
            <label
              v-for="extra in group.extras"
              :key="extra.id"
              class="flex items-start gap-3 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs"
            >
              <input
                type="checkbox"
                class="mt-0.5"
                :checked="isDuplicateExtraSelected(extra.id)"
                :disabled="duplicateDeleteBusy"
                @change="toggleDuplicateExtraSelected(extra.id)"
              />
              <span>
                Delete: {{ extra.date }} · ₹{{ n2(extra.grand_total) }} · {{ extra.pay_status }}
                <span class="block text-slate-400">id {{ extra.id.slice(0, 8) }}…</span>
              </span>
            </label>
          </div>
        </div>
        <p v-if="duplicateDeleteProgress" class="text-xs" :class="duplicateDeleteBusy ? 'text-slate-500' : 'text-emerald-700'">
          {{ duplicateDeleteProgress }}
        </p>
        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" class="pp-btn pp-btn-ghost" :disabled="duplicateDeleteBusy" @click="closeDuplicatePurchasesModal">
            Close
          </button>
          <button
            type="button"
            class="pp-btn pp-btn-primary !bg-rose-600 hover:!bg-rose-700"
            :disabled="duplicateDeleteBusy || !selectedDuplicateIds.length"
            @click="deleteSelectedDuplicatePurchases"
          >
            {{ duplicateDeleteBusy ? 'Deleting…' : `Delete ${selectedDuplicateIds.length || ''} Duplicate${selectedDuplicateIds.length === 1 ? '' : 's'}` }}
          </button>
        </div>
      </div>
    </PpModal>

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

    <PpModal
      :show="showReelConfirmModal"
      title="Confirm Paper Reel Stock"
      @close="closeReelConfirmModal"
    >
      <div class="space-y-4">
        <p class="text-sm text-slate-600">
          Purchase save ho chuki hai. Stock me daalne se pehle har reel ka
          <strong>custom reel number</strong> confirm / edit karein.
          Mill: <span class="font-semibold">{{ reelConfirmMill }}</span>
        </p>
        <p v-if="reelConfirmReplace" class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
          Is bill ki pehli reel stock replace hogi (sirf jab consumption history na ho).
        </p>
        <div class="overflow-x-auto max-h-[50vh]">
          <table class="w-full text-sm min-w-[720px]">
            <thead class="text-xs uppercase text-slate-500 bg-slate-50 sticky top-0">
              <tr>
                <th class="p-2 text-left">Custom Reel No *</th>
                <th class="p-2 text-left">Type</th>
                <th class="p-2 text-left">Deckle</th>
                <th class="p-2 text-left">GSM</th>
                <th class="p-2 text-left">BF</th>
                <th class="p-2 text-left">Color</th>
                <th class="p-2 text-right">Weight KG *</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              <tr v-for="(row, idx) in reelConfirmRows" :key="idx">
                <td class="p-2">
                  <input v-model="row.reel_no" class="pp-input font-mono !py-1" />
                </td>
                <td class="p-2">
                  <select v-model="row.paper_type" class="pp-input !py-1">
                    <option value="KRAFT">KRAFT</option>
                    <option value="DUPLEX">DUPLEX</option>
                  </select>
                </td>
                <td class="p-2">
                  <input v-model="row.deckle_size" class="pp-input !py-1" />
                </td>
                <td class="p-2">
                  <input v-model="row.gsm" class="pp-input !py-1" />
                </td>
                <td class="p-2">
                  <input v-model="row.bf" class="pp-input !py-1" />
                </td>
                <td class="p-2">
                  <select v-model="row.color" class="pp-input !py-1">
                    <option value="NS">NS</option>
                    <option value="GY">GY</option>
                  </select>
                </td>
                <td class="p-2">
                  <input v-model.number="row.opening_weight" type="number" min="0" step="0.001" class="pp-input !py-1 text-right" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex gap-2 justify-end border-t pt-4">
          <button type="button" class="pp-btn pp-btn-ghost" :disabled="reelConfirmBusy" @click="closeReelConfirmModal">
            Skip (no stock)
          </button>
          <button type="button" class="pp-btn pp-btn-primary" :disabled="reelConfirmBusy" @click="submitReelStockConfirm">
            {{ reelConfirmBusy ? 'Saving…' : 'Confirm → Paper Reels' }}
          </button>
        </div>
      </div>
    </PpModal>

    <PpModal
      :show="showConsumableConfirmModal"
      title="Confirm Consumable Stock"
      @close="closeConsumableConfirmModal"
    >
      <div class="space-y-4">
        <p class="text-sm text-slate-600">
          Purchase save ho chuki hai. Glue / ink / stitching wire stock me daalne se pehle qty / weight confirm karein.
        </p>
        <p v-if="consumableConfirmReplace" class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
          Is bill ki pehli consumable stock replace hogi.
        </p>
        <div class="overflow-x-auto max-h-[50vh]">
          <table class="w-full text-sm min-w-[520px]">
            <thead class="text-xs uppercase text-slate-500 bg-slate-50 sticky top-0">
              <tr>
                <th class="p-2 text-left">Consumable</th>
                <th class="p-2 text-right">Qty *</th>
                <th class="p-2 text-right">Weight KG</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              <tr v-for="(row, idx) in consumableConfirmRows" :key="idx">
                <td class="p-2">
                  <select v-model="row.stock_type" class="pp-input !py-1">
                    <option value="glue">Glue</option>
                    <option value="ink">Ink</option>
                    <option value="stitching_wire">Stitching Wire</option>
                  </select>
                </td>
                <td class="p-2">
                  <input v-model.number="row.qty" type="number" min="0" step="0.001" class="pp-input !py-1 text-right" />
                </td>
                <td class="p-2">
                  <input v-model.number="row.weight" type="number" min="0" step="0.001" class="pp-input !py-1 text-right" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex gap-2 justify-end border-t pt-4">
          <button type="button" class="pp-btn pp-btn-ghost" :disabled="consumableConfirmBusy" @click="closeConsumableConfirmModal">
            Skip (no stock)
          </button>
          <button type="button" class="pp-btn pp-btn-primary" :disabled="consumableConfirmBusy" @click="submitConsumableStockConfirm">
            {{ consumableConfirmBusy ? 'Saving…' : 'Confirm → Consumables' }}
          </button>
        </div>
      </div>
    </PpModal>
  </div>
</template>
