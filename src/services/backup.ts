import { db } from '@/data/db'
import { uid, nowISO } from '@/data/util'
import { allocateBillNo, findDuplicateBillNoGroups, resolveNextSequence } from '@/services/invoiceNumber'
import { normalizeGstType } from '@/services/gst'
import type {
  Party, Firm, Item, Invoice, Purchase, Recipe, Account, Voucher, ActivityLog,
  ReelStock, ProductionJob, ProductionStageEntry, StockMovement, ItemStockMovement,
  DashboardTodo,
} from '@/types/models'

export const BACKUP_FORMAT = 'pama_suite_backup'
export const BACKUP_VERSION = 1

export interface ExportOptions {
  includeSensitiveSettings?: boolean
}

export interface ImportOptions {
  allowSensitiveSettings?: boolean
}

export interface ImportPreview {
  supported: boolean
  format: string
  version?: number
  exportedAt?: string
  counts: Record<string, number>
  warnings: string[]
  hasSensitiveSettings: boolean
  mergeSkipsOlderRecords?: number
}

export interface ImportResult {
  counts: Record<string, number>
  skipped?: Record<string, number>
  skippedSensitiveSettings?: boolean
}

export interface SuiteBackup {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  firms: Firm[]
  parties: Party[]
  items: Item[]
  invoices: Invoice[]
  purchases: Purchase[]
  recipes: Recipe[]
  accounts: Account[]
  vouchers: Voucher[]
  activity_log: ActivityLog[]
  reel_stocks?: ReelStock[]
  production_jobs?: ProductionJob[]
  production_stages?: ProductionStageEntry[]
  stock_movements?: StockMovement[]
  item_stock_movements?: ItemStockMovement[]
  dashboard_todos?: DashboardTodo[]
  settings?: {
    geminiKey?: string
    supabaseUrl?: string
    supabaseAnon?: string
    bankEmail?: string
    rtgsAccounts?: Record<string, string>
    activeFirmId?: string
    templates?: unknown[]
  }
}

type ImportableRecord = { id: string; updated_at?: string }
type ImportMode = 'merge' | 'replace'

export async function exportAll(options: ExportOptions = {}): Promise<SuiteBackup> {
  const [
    firms, parties, items, invoices, purchases, recipes, accounts, vouchers, activity_log,
    reel_stocks, production_jobs, production_stages, stock_movements, item_stock_movements,
    dashboard_todos,
  ] = await Promise.all([
    db.firms.toArray(),
    db.parties.toArray(),
    db.items.toArray(),
    db.invoices.toArray(),
    db.purchases.toArray(),
    db.recipes.toArray(),
    db.accounts.toArray(),
    db.vouchers.toArray(),
    db.activity_log.toArray(),
    db.reel_stocks.toArray(),
    db.production_jobs.toArray(),
    db.production_stages.toArray(),
    db.stock_movements.toArray(),
    db.item_stock_movements.toArray(),
    db.dashboard_todos.toArray(),
  ])

  let templates: unknown[] = []
  try { templates = JSON.parse(localStorage.getItem('pama_templates_suite') || '[]') } catch { /* */ }

  let rtgsAccounts: Record<string, string> = {}
  try { rtgsAccounts = JSON.parse(localStorage.getItem('pama_rtgs_accounts') || '{}') } catch { /* */ }

  const settings: SuiteBackup['settings'] = {
    bankEmail: localStorage.getItem('pama_bank_email') || '',
    rtgsAccounts,
    activeFirmId: localStorage.getItem('pama_active_firm') || '',
    templates,
  }

  if (options.includeSensitiveSettings) {
    settings.geminiKey = localStorage.getItem('pama_gemini_key') || ''
    settings.supabaseUrl = localStorage.getItem('pama_supabase_url') || ''
    settings.supabaseAnon = localStorage.getItem('pama_supabase_anon_key') || ''
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    firms, parties, items, invoices, purchases, recipes, accounts, vouchers, activity_log,
    reel_stocks, production_jobs, production_stages, stock_movements, item_stock_movements,
    dashboard_todos,
    settings,
  }
}

export function downloadBackup(data: SuiteBackup, filename?: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename || `PamaSuite_Backup_${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

export async function previewImport(data: any): Promise<ImportPreview> {
  const format = detectBackupFormat(data)
  const counts = countImportRows(data, format)
  const warnings: string[] = []
  const version = typeof data?.version === 'number' ? data.version : undefined
  const exportedAt = typeof data?.exportedAt === 'string' ? data.exportedAt : undefined
  const hasSensitiveSettings = hasSensitiveImportSettings(data)

  if (format === 'unknown') {
    return {
      supported: false,
      format,
      version,
      exportedAt,
      counts,
      warnings: ['Unknown backup format. Import cannot continue.'],
      hasSensitiveSettings,
    }
  }

  if (format === BACKUP_FORMAT && version && version > BACKUP_VERSION) {
    warnings.push(`Backup version ${version} is newer than this app supports (${BACKUP_VERSION}). Review carefully before importing.`)
  }

  if (format !== BACKUP_FORMAT) {
    warnings.push('Legacy backup detected. Imported records will be converted to the current suite format.')
  }

  if (hasSensitiveSettings) {
    warnings.push('Backup contains saved API keys/config. They will only overwrite this device after a separate confirmation.')
  }

  let mergeSkipsOlderRecords = 0
  if (format === BACKUP_FORMAT) {
    mergeSkipsOlderRecords = await countOlderSuiteRows(data)
    if (mergeSkipsOlderRecords) {
      warnings.push(`Merge will skip ${mergeSkipsOlderRecords} record(s) because this device already has the same or newer updated_at.`)
    }
  }

  return {
    supported: true,
    format,
    version,
    exportedAt,
    counts,
    warnings,
    hasSensitiveSettings,
    mergeSkipsOlderRecords,
  }
}

const LEGACY_VOUCHER_TYPES: Record<string, Voucher['type']> = {
  PV: 'PAYMENT', RV: 'RECEIPT', CV: 'CONTRA', JV: 'JOURNAL',
  PAYMENT: 'PAYMENT', RECEIPT: 'RECEIPT', CONTRA: 'CONTRA', JOURNAL: 'JOURNAL',
  SALE: 'SALE', PURCHASE: 'PURCHASE',
}

export async function importBackup(data: any, mode: ImportMode = 'merge', options: ImportOptions = {}): Promise<ImportResult> {
  const format = detectBackupFormat(data)
  if (format === BACKUP_FORMAT) return importSuiteBackup(data, mode, options)
  if (format === 'pama_unified_backup') return importLegacyUnified(data, mode, options)
  if (format === 'legacy_billing') return importLegacyBilling(data, mode)
  throw new Error('Unknown backup format')
}

async function importSuiteBackup(data: any, mode: ImportMode, options: ImportOptions): Promise<ImportResult> {
  const counts: Record<string, number> = {}
  const skipped: Record<string, number> = {}

  const upsertAll = async <T extends ImportableRecord>(table: any, rows: T[], key: string) => {
    counts[key] = 0
    skipped[key] = 0
    for (const r of rows) {
      if (mode === 'merge') {
        const existing = await table.get(r.id)
        if (!shouldImportRow(existing, r)) {
          skipped[key]++
          continue
        }
      }
      await table.put({ ...r, _dirty: true, updated_at: r.updated_at || nowISO() })
      counts[key]++
    }
  }

  await db.transaction('rw', db.tables.map(t => t.name), async () => {
    if (mode === 'replace') {
      for (const t of db.tables) await t.clear()
    }

    await upsertAll(db.firms, data.firms || [], 'firms')
    await upsertAll(db.parties, data.parties || [], 'parties')
    await upsertAll(db.items, data.items || [], 'items')
    await upsertAll(db.invoices, data.invoices || [], 'invoices')
    await upsertAll(db.purchases, data.purchases || [], 'purchases')
    await upsertAll(db.recipes, data.recipes || [], 'recipes')
    await upsertAll(db.accounts, data.accounts || [], 'accounts')
    await upsertAll(db.vouchers, data.vouchers || [], 'vouchers')
    await upsertAll(db.activity_log, data.activity_log || [], 'activity_log')
    await upsertAll(db.reel_stocks, data.reel_stocks || [], 'reel_stocks')
    await upsertAll(db.production_jobs, data.production_jobs || [], 'production_jobs')
    await upsertAll(db.production_stages, data.production_stages || [], 'production_stages')
    await upsertAll(db.stock_movements, data.stock_movements || [], 'stock_movements')
    await upsertAll(db.item_stock_movements, data.item_stock_movements || [], 'item_stock_movements')
    await upsertAll(db.dashboard_todos, data.dashboard_todos || [], 'dashboard_todos')

    await repairImportedInvoiceNumbers()
  })

  const skippedSensitiveSettings = applyImportedSettings(data.settings, options)
  return { counts, skipped, skippedSensitiveSettings }
}

async function importLegacyUnified(data: any, mode: ImportMode, options: ImportOptions) {
  const billing = data.billing || {}
  const box = data.box || {}
  const rtgs = data.rtgs || {}

  const legacyBilling = {
    firms: billing.firms,
    custs: billing.custs,
    items: billing.items,
    bills: billing.bills,
    vendors: billing.vendors,
    purchases: billing.purchases,
    vouchers: billing.vouchers,
    accounts: billing.accounts,
    activeFirmId: billing.activeFirmId,
    templates: billing.templates,
  }

  const result = await importLegacyBilling(legacyBilling, mode)

  // Box recipes
  if (box.recipes?.length) {
    const firmId = localStorage.getItem('pama_active_firm') || ''
    for (const r of box.recipes) {
      const rec: Recipe = {
        id: r.id || uid(),
        firm_id: firmId,
        name: r.name || r.boxName || 'Recipe',
        customer_name: r.customerName || r.customer_name || '',
        box_name: r.boxName || r.box_name || '',
        print_type: r.printType || r.print_type || 'printed',
        dimension_unit: r.dimensionUnit || 'mm',
        ply: r.ply || '3-ply',
        flute: r.flute || 'C',
        form: r.form || r,
        results: r.results || {},
        created_at: r.createdAt || nowISO(),
        updated_at: nowISO(),
        is_deleted: false,
        _dirty: true,
      }
      await db.recipes.put(rec)
      result.counts.recipes = (result.counts.recipes || 0) + 1
    }
  }

  // RTGS benes → parties with vendor role + bank
  if (rtgs.benes?.length) {
    const firmId = localStorage.getItem('pama_active_firm') || ''
    for (const b of rtgs.benes) {
      const party: Party = {
        id: uid(),
        firm_id: firmId,
        name: b.name || b.acname || 'Beneficiary',
        roles: ['vendor'],
        gst: '', phone: '', email: '', addr: '', city: '', pin: '', state: '',
        is_consumer: false,
        bank: b.bank || '', acno: b.acno || '', ifsc: b.ifsc || '', acname: b.acname || b.name || '',
        created_at: nowISO(), updated_at: nowISO(), is_deleted: false, _dirty: true,
      }
      await db.parties.put(party)
      result.counts.parties = (result.counts.parties || 0) + 1
    }
  }

  if (rtgs.bankEmail) localStorage.setItem('pama_bank_email', rtgs.bankEmail)
  if (rtgs.accounts) localStorage.setItem('pama_rtgs_accounts', JSON.stringify(rtgs.accounts))
  const skippedSensitiveSettings = applyImportedSettings(data.settings, options)

  if (skippedSensitiveSettings) result.skippedSensitiveSettings = true
  return result
}

async function importLegacyBilling(data: any, mode: ImportMode): Promise<ImportResult> {
  if (mode === 'replace') {
    await db.transaction('rw', db.tables.map(t => t.name), async () => {
      for (const t of db.tables) await t.clear()
    })
  }

  const firmMap = new Map<string, string>()
  const counts: Record<string, number> = {}

  for (const f of data.firms || []) {
    const id = f.id || uid()
    firmMap.set(f.id || id, id)
    await db.firms.put({
      id, name: f.name || 'Firm', gst: f.gst || '', addr: f.addr || f.address || '',
      city: f.city || '', state: f.state || '05', pin: f.pin || '',
      phone: f.phone || '', email: f.email || '',
      bank_name: f.bankName || f.bank_name || '', bank_acno: f.bankAcno || f.bank_acno || '',
      bank_ifsc: f.bankIfsc || f.bank_ifsc || '',
      prefix: f.prefix || 'INV', next_bill_no: f.nextBillNo || f.next_bill_no || 1,
      signature: f.signature || undefined,
      created_at: f.createdAt || nowISO(), updated_at: nowISO(), is_deleted: !!f.isDeleted, _dirty: true,
    })
    counts.firms = (counts.firms || 0) + 1
  }

  const activeFirm = firmMap.get(data.activeFirmId) || firmMap.get(data.firms?.[0]?.id) || data.activeFirmId || data.firms?.[0]?.id
  if (activeFirm) localStorage.setItem('pama_active_firm', activeFirm)

  const partyByName = new Map<string, string>()

  const addParty = async (p: any, roles: ('customer' | 'vendor')[]) => {
    const firmId = firmMap.get(p.firmId) || p.firmId || activeFirm || ''
    const key = `${firmId}:${(p.name || '').toLowerCase().trim()}`
    // Same party seen again (e.g. once as customer, once as vendor) → merge roles
    // instead of dropping one, so a party who is both keeps both roles.
    if (partyByName.has(key)) {
      const existingId = partyByName.get(key)!
      const existing = await db.parties.get(existingId)
      if (existing) {
        const merged = Array.from(new Set([...(existing.roles || []), ...roles]))
        if (merged.length !== (existing.roles || []).length) {
          await db.parties.put({ ...existing, roles: merged, updated_at: nowISO(), _dirty: true })
        }
      }
      return existingId
    }
    const id = p.id || uid()
    partyByName.set(key, id)
    await db.parties.put({
      id, firm_id: firmId, name: p.name || '', roles,
      gst: p.gst || p.gstin || '', phone: p.phone || '', email: p.email || '',
      addr: p.addr || p.address || '', city: p.city || '', pin: p.pin || '', state: p.state || '',
      is_consumer: !!p.isConsumer || !!p.is_consumer,
      bank: p.bank || '', acno: p.acno || p.acNo || '', ifsc: p.ifsc || '', acname: p.acname || p.acName || '',
      created_at: p.createdAt || nowISO(), updated_at: nowISO(), is_deleted: !!p.isDeleted, _dirty: true,
    })
    counts.parties = (counts.parties || 0) + 1
    return id
  }

  for (const c of data.custs || []) await addParty(c, ['customer'])
  for (const v of data.vendors || []) await addParty(v, ['vendor'])

  for (const it of data.items || []) {
    await db.items.put({
      id: it.id || uid(), firm_id: firmMap.get(it.firmId) || it.firmId || activeFirm || '',
      name: it.name || '', unit: it.unit || 'PCS', hsn: it.hsn || '', gst: num(it.gst), rate: num(it.rate),
      size: it.size || '', gsm: it.gsm || '', bf: it.bf || '',
      track_stock: it.trackStock ?? it.track_stock ?? true,
      opening_stock: num(it.openingStock ?? it.opening_stock),
      reorder_level: num(it.reorderLevel ?? it.reorder_level),
      purchase_rate: num(it.purchaseRate ?? it.purchase_rate),
      created_at: it.createdAt || nowISO(), updated_at: nowISO(), is_deleted: !!it.isDeleted, _dirty: true,
    })
    counts.items = (counts.items || 0) + 1
  }

  for (const b of data.bills || []) {
    const inv: Invoice = {
      id: b.id || uid(),
      firm_id: firmMap.get(b.firmId) || b.firmId || activeFirm || '',
      doc_type: (b.docType || 'INVOICE') as Invoice['doc_type'],
      bill_no: b.billNo || b.bill_no || '',
      date: b.date || '',
      party_id: b.custId || null,
      party_name: b.custName || '',
      party_snapshot: b.custDetails || {},
      ship: b.ship || null,
      gst_type: normalizeGstType(b.gstType),
      items: (b.items || []).map((r: any) => ({
        item_id: r.itemId || null, name: r.name || '', hsn: r.hsn || '', qty: num(r.qty), unit: r.unit || 'PCS',
        rate: num(r.rate), gst: num(r.gst),
      })),
      sub: num(b.sub), total_tax: num(b.totalTax), round_off: num(b.roundOff),
      grand_total: num(b.grandTotal), amt_paid: num(b.amtPaid),
      pay_status: b.payStatus || 'UNPAID', notes: b.notes || '',
      eway: b.eway || '', dest: b.dest || '',
      created_at: b.createdAt || nowISO(), updated_at: nowISO(), is_deleted: !!(b.isDeleted || b.is_deleted), _dirty: true,
    }
    await db.invoices.put(inv)
    counts.invoices = (counts.invoices || 0) + 1
  }

  for (const p of data.purchases || []) {
    await db.purchases.put({
      id: p.id || uid(), firm_id: firmMap.get(p.firmId) || p.firmId || activeFirm || '',
      supplier_name: p.supplierName || p.vendorName || '', supplier_id: p.vendorId || null,
      bill_no: p.billNo || '', date: p.date || '', gst_type: normalizeGstType(p.gstType),
      items: p.items || [], sub: num(p.sub), total_tax: num(p.totalTax), round_off: num(p.roundOff),
      grand_total: num(p.grandTotal), amt_paid: num(p.amtPaid), pay_status: p.payStatus || 'UNPAID',
      notes: p.notes || '', created_at: p.createdAt || nowISO(), updated_at: nowISO(), is_deleted: !!(p.isDeleted || p.is_deleted), _dirty: true,
    })
    counts.purchases = (counts.purchases || 0) + 1
  }

  if (data.templates) localStorage.setItem('pama_templates_suite', JSON.stringify(data.templates))

  for (const a of data.accounts || []) {
    const firmId = firmMap.get(a.firmId) || a.firmId || activeFirm || ''
    await db.accounts.put({
      id: a.id || `${firmId}_${a.code || uid()}`,
      firm_id: firmId,
      code: a.code || '',
      name: a.name || '',
      group: a.group || 'Indirect Expense',
      normal: (a.normal || 'Dr') as Account['normal'],
      open_bal_dr: num(a.openBalDr ?? a.open_bal_dr),
      open_bal_cr: num(a.openBalCr ?? a.open_bal_cr),
      is_system: !!(a.isSystem ?? a.is_system),
      created_at: a.createdAt || a.created_at || nowISO(),
      updated_at: nowISO(),
      is_deleted: !!(a.isDeleted || a.is_deleted),
      _dirty: true,
    })
    counts.accounts = (counts.accounts || 0) + 1
  }

  for (const v of data.vouchers || []) {
    const firmId = firmMap.get(v.firmId) || v.firmId || activeFirm || ''
    const type = LEGACY_VOUCHER_TYPES[v.type] || 'JOURNAL'
    await db.vouchers.put({
      id: v.id || uid(),
      firm_id: firmId,
      voucher_no: v.voucherNo || v.voucher_no || '',
      date: v.date || '',
      type,
      narration: v.narration || '',
      entries: (v.entries || []).map((e: any) => ({
        accountId: e.accountId || e.account_id || '',
        accountName: e.accountName || e.account_name || '',
        debit: num(e.debit),
        credit: num(e.credit),
      })),
      ref_id: v.refId || v.ref_id,
      ref_type: v.refType || v.ref_type,
      created_at: v.createdAt || v.created_at || nowISO(),
      updated_at: nowISO(),
      is_deleted: !!(v.isDeleted || v.is_deleted),
      _dirty: true,
    })
    counts.vouchers = (counts.vouchers || 0) + 1
  }

  await repairImportedInvoiceNumbers()

  return { counts }
}

async function repairImportedInvoiceNumbers() {
  const allFirms = await db.firms.filter((f) => !f.is_deleted).toArray()
  for (const f of allFirms) {
    let invs = await db.invoices.where('firm_id').equals(f.id).filter((i) => !i.is_deleted).toArray()
    for (const group of findDuplicateBillNoGroups(invs)) {
      const ordered = [...group].sort((a, b) =>
        (a.created_at || a.updated_at || '').localeCompare(b.created_at || b.updated_at || ''),
      )
      for (const dup of ordered.slice(1)) {
        const { billNo } = allocateBillNo(f, invs)
        const updated = { ...dup, bill_no: billNo, updated_at: nowISO(), _dirty: true }
        await db.invoices.put(updated)
        invs = invs.map((i) => i.id === dup.id ? updated : i)
      }
    }
    const resolved = resolveNextSequence(f, invs)
    if ((f.next_bill_no || 1) < resolved) {
      await db.firms.put({ ...f, next_bill_no: resolved, updated_at: nowISO(), _dirty: true })
    }
  }
}

function detectBackupFormat(data: any): string {
  if (data?.format === BACKUP_FORMAT) return BACKUP_FORMAT
  if (data?.format === 'pama_unified_backup') return 'pama_unified_backup'
  // Legacy billing JSON (custs/bills; suite backups use parties[] and format field).
  if (data?.bills || data?.custs || (data?.firms?.length && !data?.parties)) return 'legacy_billing'
  return 'unknown'
}

function countImportRows(data: any, format: string): Record<string, number> {
  const counts: Record<string, number> = {}
  if (format === BACKUP_FORMAT) {
    for (const { key, rows } of suiteImportTables(data)) counts[key] = rows.length
    return counts
  }

  if (format === 'pama_unified_backup') {
    const billing = data.billing || {}
    const box = data.box || {}
    const rtgs = data.rtgs || {}
    counts.firms = arrayCount(billing.firms)
    counts.parties = arrayCount(billing.custs) + arrayCount(billing.vendors) + arrayCount(rtgs.benes)
    counts.items = arrayCount(billing.items)
    counts.invoices = arrayCount(billing.bills)
    counts.purchases = arrayCount(billing.purchases)
    counts.accounts = arrayCount(billing.accounts)
    counts.vouchers = arrayCount(billing.vouchers)
    counts.recipes = arrayCount(box.recipes)
    return counts
  }

  if (format === 'legacy_billing') {
    counts.firms = arrayCount(data.firms)
    counts.parties = arrayCount(data.custs) + arrayCount(data.vendors)
    counts.items = arrayCount(data.items)
    counts.invoices = arrayCount(data.bills)
    counts.purchases = arrayCount(data.purchases)
    counts.accounts = arrayCount(data.accounts)
    counts.vouchers = arrayCount(data.vouchers)
  }
  return counts
}

async function countOlderSuiteRows(data: any): Promise<number> {
  let count = 0
  for (const { table, rows } of suiteImportTables(data)) {
    for (const row of rows) {
      const existing = await table.get(row.id)
      if (existing && !shouldImportRow(existing, row)) count++
    }
  }
  return count
}

function suiteImportTables(data: any) {
  return [
    { key: 'firms', table: db.firms, rows: asArray<ImportableRecord>(data.firms) },
    { key: 'parties', table: db.parties, rows: asArray<ImportableRecord>(data.parties) },
    { key: 'items', table: db.items, rows: asArray<ImportableRecord>(data.items) },
    { key: 'invoices', table: db.invoices, rows: asArray<ImportableRecord>(data.invoices) },
    { key: 'purchases', table: db.purchases, rows: asArray<ImportableRecord>(data.purchases) },
    { key: 'recipes', table: db.recipes, rows: asArray<ImportableRecord>(data.recipes) },
    { key: 'accounts', table: db.accounts, rows: asArray<ImportableRecord>(data.accounts) },
    { key: 'vouchers', table: db.vouchers, rows: asArray<ImportableRecord>(data.vouchers) },
    { key: 'activity_log', table: db.activity_log, rows: asArray<ImportableRecord>(data.activity_log) },
    { key: 'reel_stocks', table: db.reel_stocks, rows: asArray<ImportableRecord>(data.reel_stocks) },
    { key: 'production_jobs', table: db.production_jobs, rows: asArray<ImportableRecord>(data.production_jobs) },
    { key: 'production_stages', table: db.production_stages, rows: asArray<ImportableRecord>(data.production_stages) },
    { key: 'stock_movements', table: db.stock_movements, rows: asArray<ImportableRecord>(data.stock_movements) },
    { key: 'item_stock_movements', table: db.item_stock_movements, rows: asArray<ImportableRecord>(data.item_stock_movements) },
    { key: 'dashboard_todos', table: db.dashboard_todos, rows: asArray<ImportableRecord>(data.dashboard_todos) },
  ]
}

function shouldImportRow(existing: ImportableRecord | undefined, incoming: ImportableRecord): boolean {
  if (!existing) return true
  const existingUpdatedAt = timestampMs(existing.updated_at)
  const incomingUpdatedAt = timestampMs(incoming.updated_at)

  if (incomingUpdatedAt !== undefined && existingUpdatedAt !== undefined) {
    return incomingUpdatedAt > existingUpdatedAt
  }
  if (incomingUpdatedAt !== undefined) return true
  if (existingUpdatedAt !== undefined) return false
  return true
}

function applyImportedSettings(settings: SuiteBackup['settings'] | undefined, options: ImportOptions): boolean {
  if (!settings) return false
  let skippedSensitiveSettings = false

  if (options.allowSensitiveSettings) {
    if (settings.geminiKey) localStorage.setItem('pama_gemini_key', settings.geminiKey)
    if (settings.supabaseUrl) localStorage.setItem('pama_supabase_url', settings.supabaseUrl)
    if (settings.supabaseAnon) localStorage.setItem('pama_supabase_anon_key', settings.supabaseAnon)
  } else if (settings.geminiKey || settings.supabaseUrl || settings.supabaseAnon) {
    skippedSensitiveSettings = true
  }

  if (settings.bankEmail) localStorage.setItem('pama_bank_email', settings.bankEmail)
  if (settings.rtgsAccounts) localStorage.setItem('pama_rtgs_accounts', JSON.stringify(settings.rtgsAccounts))
  if (settings.activeFirmId) localStorage.setItem('pama_active_firm', settings.activeFirmId)
  if (settings.templates) localStorage.setItem('pama_templates_suite', JSON.stringify(settings.templates))

  return skippedSensitiveSettings
}

function hasSensitiveImportSettings(data: any): boolean {
  const settings = data?.settings
  return !!(settings?.geminiKey || settings?.supabaseUrl || settings?.supabaseAnon)
}

function timestampMs(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : []
}

function arrayCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function num(v: any): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
