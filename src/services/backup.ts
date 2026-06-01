import { db } from '@/data/db'
import { uid, nowISO } from '@/data/util'
import { allocateBillNo, findDuplicateBillNoGroups, resolveNextSequence } from '@/services/invoiceNumber'
import { normalizeGstType } from '@/services/gst'
import type { Party, Firm, Item, Invoice, Purchase, Recipe, Account, Voucher, ActivityLog } from '@/types/models'

export const BACKUP_FORMAT = 'pama_suite_backup'
export const BACKUP_VERSION = 1

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
  settings?: {
    geminiKey?: string
    bankEmail?: string
    rtgsAccounts?: Record<string, string>
    activeFirmId?: string
    templates?: unknown[]
  }
}

export async function exportAll(): Promise<SuiteBackup> {
  const [firms, parties, items, invoices, purchases, recipes, accounts, vouchers, activity_log] = await Promise.all([
    db.firms.toArray(),
    db.parties.toArray(),
    db.items.toArray(),
    db.invoices.toArray(),
    db.purchases.toArray(),
    db.recipes.toArray(),
    db.accounts.toArray(),
    db.vouchers.toArray(),
    db.activity_log.toArray(),
  ])

  let templates: unknown[] = []
  try { templates = JSON.parse(localStorage.getItem('pama_templates_suite') || '[]') } catch { /* */ }

  let rtgsAccounts: Record<string, string> = {}
  try { rtgsAccounts = JSON.parse(localStorage.getItem('pama_rtgs_accounts') || '{}') } catch { /* */ }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    firms, parties, items, invoices, purchases, recipes, accounts, vouchers, activity_log,
    settings: {
      geminiKey: localStorage.getItem('pama_gemini_key') || '',
      bankEmail: localStorage.getItem('pama_bank_email') || '',
      rtgsAccounts,
      activeFirmId: localStorage.getItem('pama_active_firm') || '',
      templates,
    },
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

const LEGACY_VOUCHER_TYPES: Record<string, Voucher['type']> = {
  PV: 'PAYMENT', RV: 'RECEIPT', CV: 'CONTRA', JV: 'JOURNAL',
  PAYMENT: 'PAYMENT', RECEIPT: 'RECEIPT', CONTRA: 'CONTRA', JOURNAL: 'JOURNAL',
  SALE: 'SALE', PURCHASE: 'PURCHASE',
}

export async function importBackup(data: any, mode: 'merge' | 'replace' = 'merge'): Promise<{ counts: Record<string, number> }> {
  if (data?.format === BACKUP_FORMAT) {
    return importSuiteBackup(data, mode)
  }
  if (data?.format === 'pama_unified_backup') {
    return importLegacyUnified(data, mode)
  }
  // Legacy billing JSON (custs/bills — suite backups use parties[] and format field)
  if (data?.bills || data?.custs || (data?.firms?.length && !data?.parties)) {
    return importLegacyBilling(data, mode)
  }
  throw new Error('Unknown backup format')
}

async function importSuiteBackup(data: any, mode: 'merge' | 'replace'): Promise<{ counts: Record<string, number> }> {
  const counts: Record<string, number> = {}

  if (mode === 'replace') {
    await db.transaction('rw', db.tables.map(t => t.name), async () => {
      for (const t of db.tables) await t.clear()
    })
  }

  const upsertAll = async <T extends { id: string; updated_at?: string }>(table: any, rows: T[], key: string) => {
    counts[key] = 0
    for (const r of rows) {
      await table.put({ ...r, _dirty: true, updated_at: r.updated_at || nowISO() })
      counts[key]++
    }
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

  if (data.settings) {
    if (data.settings.geminiKey) localStorage.setItem('pama_gemini_key', data.settings.geminiKey)
    if (data.settings.bankEmail) localStorage.setItem('pama_bank_email', data.settings.bankEmail)
    if (data.settings.rtgsAccounts) localStorage.setItem('pama_rtgs_accounts', JSON.stringify(data.settings.rtgsAccounts))
    if (data.settings.activeFirmId) localStorage.setItem('pama_active_firm', data.settings.activeFirmId)
    if (data.settings.templates) localStorage.setItem('pama_templates_suite', JSON.stringify(data.settings.templates))
  }

  await repairImportedInvoiceNumbers()
  return { counts }
}

async function importLegacyUnified(data: any, mode: 'merge' | 'replace') {
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
  if (data.settings?.geminiKey) localStorage.setItem('pama_gemini_key', data.settings.geminiKey)

  return result
}

async function importLegacyBilling(data: any, mode: 'merge' | 'replace') {
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
    let invs = await db.invoices.filter((i) => !i.is_deleted && i.firm_id === f.id).toArray()
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

function num(v: any): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
