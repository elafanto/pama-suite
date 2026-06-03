import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/data/db'
import { createRepo } from '@/data/repo'
import { useFirmStore } from './firm'
import { nowISO } from '@/data/util'
import { isInterstateGst } from '@/services/gst'
import type { Voucher, Account, LedgerEntry, Invoice, Purchase } from '@/types/models'

const vouchersRepo = createRepo<Voucher>(db.vouchers)
const accountsRepo = createRepo<Account>(db.accounts)

const DEFAULT_ACCOUNTS = [
  { code: '1001', name: 'Cash in Hand', group: 'Current Assets', normal: 'Dr' },
  { code: '1002', name: 'Bank Account (Primary)', group: 'Current Assets', normal: 'Dr' },
  { code: '1003', name: 'Sundry Debtors', group: 'Current Assets', normal: 'Dr' },
  { code: '1004', name: 'Stock in Hand', group: 'Current Assets', normal: 'Dr' },
  { code: '1005', name: 'CGST Input Credit', group: 'Current Assets', normal: 'Dr' },
  { code: '1006', name: 'SGST Input Credit', group: 'Current Assets', normal: 'Dr' },
  { code: '1007', name: 'IGST Input Credit', group: 'Current Assets', normal: 'Dr' },
  { code: '1101', name: 'Plant & Machinery', group: 'Fixed Assets', normal: 'Dr' },
  { code: '1102', name: 'Furniture & Fixtures', group: 'Fixed Assets', normal: 'Dr' },
  { code: '1103', name: 'Vehicles', group: 'Fixed Assets', normal: 'Dr' },
  { code: '2001', name: 'Sundry Creditors', group: 'Current Liabilities', normal: 'Cr' },
  { code: '2002', name: 'CGST Payable', group: 'Current Liabilities', normal: 'Cr' },
  { code: '2003', name: 'SGST Payable', group: 'Current Liabilities', normal: 'Cr' },
  { code: '2004', name: 'IGST Payable', group: 'Current Liabilities', normal: 'Cr' },
  { code: '2005', name: 'TDS Payable', group: 'Current Liabilities', normal: 'Cr' },
  { code: '3001', name: 'Capital Account', group: 'Capital & Reserves', normal: 'Cr' },
  { code: '3002', name: 'Retained Earnings', group: 'Capital & Reserves', normal: 'Cr' },
  { code: '4001', name: 'Sales Account', group: 'Sales Income', normal: 'Cr' },
  { code: '4002', name: 'Other Income', group: 'Other Income', normal: 'Cr' },
  { code: '5001', name: 'Purchase Account', group: 'Purchase Expense', normal: 'Dr' },
  { code: '5101', name: 'Salary & Wages', group: 'Direct Expense', normal: 'Dr' },
  { code: '5102', name: 'Labour Charges', group: 'Direct Expense', normal: 'Dr' },
  { code: '5103', name: 'Freight & Cartage', group: 'Direct Expense', normal: 'Dr' },
  { code: '5201', name: 'Electricity Expense', group: 'Indirect Expense', normal: 'Dr' },
  { code: '5202', name: 'Maintenance & Repairs', group: 'Indirect Expense', normal: 'Dr' },
  { code: '5203', name: 'Rent', group: 'Indirect Expense', normal: 'Dr' },
  { code: '5204', name: 'Office Stationery', group: 'Indirect Expense', normal: 'Dr' },
  { code: '5205', name: 'Telephone & Internet', group: 'Indirect Expense', normal: 'Dr' },
  { code: '5206', name: 'Transport & Travelling', group: 'Indirect Expense', normal: 'Dr' },
  { code: '5207', name: 'Miscellaneous Expense', group: 'Indirect Expense', normal: 'Dr' },
  { code: '5208', name: 'Round Off Expense', group: 'Indirect Expense', normal: 'Dr' },
]

export const useAccountingStore = defineStore('accounting', () => {
  const accounts = ref<Account[]>([])
  const vouchers = ref<Voucher[]>([])
  const loaded = ref(false)

  async function load() {
    const firmStore = useFirmStore()
    const firmId = firmStore.activeFirmId
    if (!firmId) return

    // Load accounts
    accounts.value = await accountsRepo.all(firmId)

    // Seed if empty
    if (accounts.value.length === 0) {
      await seedAccounts(firmId)
      accounts.value = await accountsRepo.all(firmId)
    }

    // Load vouchers
    vouchers.value = await vouchersRepo.all(firmId)
    loaded.value = true
  }

  async function seedAccounts(firmId: string) {
    const now = nowISO()
    const records: Account[] = DEFAULT_ACCOUNTS.map((def) => ({
      id: `${firmId}_${def.code}`,
      firm_id: firmId,
      code: def.code,
      name: def.name,
      group: def.group,
      normal: def.normal as 'Dr' | 'Cr',
      open_bal_dr: 0,
      open_bal_cr: 0,
      is_system: true,
      is_deleted: false,
      created_at: now,
      updated_at: now,
      _dirty: true,
    }))
    await db.accounts.bulkAdd(records)
  }

  async function addAccount(data: Omit<Account, 'id' | 'firm_id' | 'is_system' | 'created_at' | 'updated_at' | 'is_deleted' | '_dirty'>) {
    const firmStore = useFirmStore()
    const firmId = firmStore.activeFirmId
    const rec = await accountsRepo.create({
      ...data,
      firm_id: firmId,
      is_system: false,
    } as any)
    await load()
    return rec
  }

  async function updateAccount(id: string, patch: Partial<Account>) {
    await accountsRepo.update(id, patch)
    await load()
  }

  async function removeAccount(id: string) {
    const existing = await db.accounts.get(id)
    if (!existing || existing.is_system) return
    await accountsRepo.remove(id)
    await load()
  }

  async function getNextVoucherNo(type: Voucher['type']): Promise<string> {
    const firmStore = useFirmStore()
    const firmId = firmStore.activeFirmId
    // Include soft-deleted rows so a deleted voucher's number is never reused
    // (length+1 would collide after any deletion). Next = highest suffix + 1.
    const list = await db.vouchers
      .where('firm_id')
      .equals(firmId)
      .filter((v) => v.type === type)
      .toArray()
    const re = new RegExp(`^${type}-0*(\\d+)$`)
    let max = 0
    for (const v of list) {
      const m = (v.voucher_no || '').match(re)
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
    return `${type}-${String(max + 1).padStart(4, '0')}`
  }

  async function postVoucher(
    date: string,
    type: Voucher['type'],
    narration: string,
    entries: LedgerEntry[],
    refId = '',
    refType = ''
  ): Promise<Voucher> {
    const firmStore = useFirmStore()
    const firmId = firmStore.activeFirmId
    const voucherNo = await getNextVoucherNo(type)

    const rec = await vouchersRepo.create({
      firm_id: firmId,
      voucher_no: voucherNo,
      date,
      type,
      narration,
      entries,
      ref_id: refId,
      ref_type: refType,
    } as any)

    await load()
    return rec
  }

  async function reverseLedgerByRef(refId: string) {
    const active = await db.vouchers
      .where('firm_id')
      .equals(useFirmStore().activeFirmId)
      .filter((v) => v.ref_id === refId && !v.is_deleted)
      .toArray()

    for (const v of active) {
      await vouchersRepo.remove(v.id)
    }
    await load()
  }

  async function postSaleToLedger(bill: Invoice) {
    if (!bill.firm_id) return
    await reverseLedgerByRef(bill.id)

    const firmId = bill.firm_id
    const entries: LedgerEntry[] = []
    const isInter = isInterstateGst(bill.gst_type)
    const isCredit = bill.doc_type !== 'INVOICE' && bill.doc_type !== 'invoice'

    // Dr Debtors / Cr Sales
    entries.push({
      accountId: `${firmId}_1003`,
      accountName: 'Sundry Debtors',
      debit: isCredit ? 0 : bill.grand_total,
      credit: isCredit ? bill.grand_total : 0,
    })

    entries.push({
      accountId: `${firmId}_4001`,
      accountName: 'Sales Account',
      debit: isCredit ? bill.sub : 0,
      credit: isCredit ? 0 : bill.sub,
    })

    // Tax amounts per slab — from stored taxBuckets, else reconstructed from items
    // (imported invoices have no taxBuckets; without this their GST would be
    // dumped into Round Off by the balancing adjuster below).
    let taxAmounts: number[]
    if (bill.taxBuckets && Object.keys(bill.taxBuckets).length) {
      taxAmounts = Object.values(bill.taxBuckets).map((t: any) => Number(t.tax) || 0)
    } else {
      const bySlab: Record<number, number> = {}
      ;(bill.items || []).forEach((it: any) => {
        const tax = Math.round((it.qty || 0) * (it.rate || 0) * ((it.gst || 0) / 100) * 100) / 100
        bySlab[it.gst] = (bySlab[it.gst] || 0) + tax
      })
      taxAmounts = Object.values(bySlab)
    }
    {
      taxAmounts.forEach((tax) => {
        const half = Math.round((tax / 2) * 100) / 100
        if (isInter) {
          entries.push({
            accountId: `${firmId}_2004`,
            accountName: 'IGST Payable',
            debit: isCredit ? tax : 0,
            credit: isCredit ? 0 : tax,
          })
        } else {
          entries.push({
            accountId: `${firmId}_2002`,
            accountName: 'CGST Payable',
            debit: isCredit ? half : 0,
            credit: isCredit ? 0 : half,
          })
          entries.push({
            accountId: `${firmId}_2003`,
            accountName: 'SGST Payable',
            debit: isCredit ? half : 0,
            credit: isCredit ? 0 : half,
          })
        }
      })
    }

    // Adjust for rounding errors
    const totalDr = entries.reduce((s, e) => s + e.debit, 0)
    const totalCr = entries.reduce((s, e) => s + e.credit, 0)
    const diff = Math.round((totalDr - totalCr) * 100) / 100
    if (diff !== 0) {
      entries.push({
        accountId: `${firmId}_5208`,
        accountName: 'Round Off Expense',
        debit: diff > 0 ? 0 : -diff,
        credit: diff > 0 ? diff : 0,
      })
    }

    const narration = `${isCredit ? 'CN/DN' : 'Sale'} — ${bill.party_name} — ${bill.bill_no}`
    await postVoucher(bill.date, 'SALE', narration, entries, bill.id, 'sale')
  }

  async function postPurchaseToLedger(pur: Purchase) {
    if (!pur.firm_id) return
    await reverseLedgerByRef(pur.id)

    const firmId = pur.firm_id
    const entries: LedgerEntry[] = []
    const isInter = isInterstateGst(pur.gst_type)

    entries.push({
      accountId: `${firmId}_5001`,
      accountName: 'Purchase Account',
      debit: pur.sub,
      credit: 0,
    })

    if (pur.items && pur.items.length > 0) {
      const taxBuckets: Record<number, number> = {}
      pur.items.forEach((item) => {
        const itemTax = Math.round(item.qty * item.rate * (item.gst / 100) * 100) / 100
        taxBuckets[item.gst] = (taxBuckets[item.gst] || 0) + itemTax
      })

      Object.entries(taxBuckets).forEach(([_, tax]) => {
        const half = Math.round((tax / 2) * 100) / 100
        if (isInter) {
          entries.push({
            accountId: `${firmId}_1007`,
            accountName: 'IGST Input Credit',
            debit: tax,
            credit: 0,
          })
        } else {
          entries.push({
            accountId: `${firmId}_1005`,
            accountName: 'CGST Input Credit',
            debit: half,
            credit: 0,
          })
          entries.push({
            accountId: `${firmId}_1006`,
            accountName: 'SGST Input Credit',
            debit: half,
            credit: 0,
          })
        }
      })
    }

    entries.push({
      accountId: `${firmId}_2001`,
      accountName: 'Sundry Creditors',
      debit: 0,
      credit: pur.grand_total,
    })

    // Adjust for rounding errors
    const totalDr = entries.reduce((s, e) => s + e.debit, 0)
    const totalCr = entries.reduce((s, e) => s + e.credit, 0)
    const diff = Math.round((totalCr - totalDr) * 100) / 100
    if (diff !== 0) {
      entries.push({
        accountId: `${firmId}_5208`,
        accountName: 'Round Off Expense',
        debit: diff > 0 ? diff : 0,
        credit: diff < 0 ? -diff : 0,
      })
    }

    const narration = `Purchase — ${pur.supplier_name} — ${pur.bill_no || pur.id.substring(0, 8)}`
    await postVoucher(pur.received_date || pur.date, 'PURCHASE', narration, entries, pur.id, 'purchase')
  }

  async function postPaymentVoucher(
    refId: string,
    refType: 'invoice' | 'purchase',
    amount: number,
    isWriteOff: boolean,
    writeOffAmt: number,
    date: string,
    note: string,
    paymentAccountName = 'Bank Account (Primary)'
  ) {
    const firmStore = useFirmStore()
    const firmId = firmStore.activeFirmId
    if (!firmId) return

    await reverseLedgerByRef(refId + '_PAY')

    const entries: LedgerEntry[] = []
    const now = date || nowISO().split('T')[0]
    const cashAmount = Math.round(Math.max(0, Number(amount) || 0) * 100) / 100
    const writeOffAmount = Math.round(Math.max(0, isWriteOff ? Number(writeOffAmt) || 0 : 0) * 100) / 100

    if (cashAmount <= 0 && writeOffAmount <= 0) {
      await load()
      return
    }

    if (refType === 'invoice') {
      // Receipt: Dr Bank/Cash / Cr Sundry Debtors
      // Plus optional write-off: Dr Round Off Expense
      const bill = await db.invoices.get(refId)
      if (!bill) return

      entries.push({
        accountId: `${firmId}_1002`, // Bank
        accountName: paymentAccountName,
        debit: cashAmount,
        credit: 0,
      })

      if (writeOffAmount > 0) {
        entries.push({
          accountId: `${firmId}_5208`,
          accountName: 'Round Off Expense',
          debit: writeOffAmount,
          credit: 0,
        })
      }

      entries.push({
        accountId: `${firmId}_1003`,
        accountName: 'Sundry Debtors',
        debit: 0,
        credit: cashAmount + writeOffAmount,
      })

      const narration = `Receipt for Bill ${bill.bill_no} — ${bill.party_name}${note ? ' | ' + note : ''}`
      await postVoucher(now, 'RECEIPT', narration, entries, refId + '_PAY', 'receipt')
    } else {
      // Payment: Dr Sundry Creditors / Cr Bank/Cash
      // Plus optional write-off: Cr Round Off Expense
      const pur = await db.purchases.get(refId)
      if (!pur) return

      entries.push({
        accountId: `${firmId}_2001`,
        accountName: 'Sundry Creditors',
        debit: cashAmount + writeOffAmount,
        credit: 0,
      })

      entries.push({
        accountId: `${firmId}_1002`,
        accountName: paymentAccountName,
        debit: 0,
        credit: cashAmount,
      })

      if (writeOffAmount > 0) {
        entries.push({
          accountId: `${firmId}_5208`,
          accountName: 'Round Off Expense',
          debit: 0,
          credit: writeOffAmount,
        })
      }

      const narration = `Payment for Bill ${pur.bill_no} — ${pur.supplier_name}${note ? ' | ' + note : ''}`
      await postVoucher(now, 'PAYMENT', narration, entries, refId + '_PAY', 'payment')
    }
  }

  // Reports
  function getTrialBalance(toDate?: string) {
    const balMap: Record<string, { account: Account; dr: number; cr: number }> = {}

    // Initialize all active accounts
    accounts.value.forEach((a) => {
      balMap[a.id] = {
        account: a,
        dr: a.open_bal_dr || 0,
        cr: a.open_bal_cr || 0,
      }
    })

    // Sum active vouchers
    const activeVouchers = vouchers.value.filter(
      (v) => !v.is_deleted && (!toDate || v.date <= toDate)
    )

    activeVouchers.forEach((v) => {
      v.entries.forEach((e) => {
        if (!balMap[e.accountId]) {
          // Fallback if account was somehow deleted or not found
          balMap[e.accountId] = {
            account: {
              id: e.accountId,
              name: e.accountName,
              code: '',
              group: 'Uncategorized',
              normal: 'Dr',
              open_bal_dr: 0,
              open_bal_cr: 0,
              is_system: false,
              is_deleted: false,
              firm_id: '',
              created_at: '',
              updated_at: '',
            },
            dr: 0,
            cr: 0,
          }
        }
        balMap[e.accountId].dr += e.debit || 0
        balMap[e.accountId].cr += e.credit || 0
      })
    })

    return Object.values(balMap)
  }

  function getLedgerDetails(accountId: string, fromDate?: string, toDate?: string) {
    const acc = accounts.value.find((a) => a.id === accountId)
    if (!acc) return null

    let balance = acc.normal === 'Dr'
      ? (acc.open_bal_dr || 0) - (acc.open_bal_cr || 0)
      : (acc.open_bal_cr || 0) - (acc.open_bal_dr || 0)

    const rows: Array<{
      date: string
      voucherNo: string
      type: string
      narration: string
      debit: number
      credit: number
      balance: number
    }> = []

    // Add opening balance row
    rows.push({
      date: '',
      voucherNo: 'OPENING',
      type: 'OB',
      narration: 'Opening Balance',
      debit: acc.open_bal_dr || 0,
      credit: acc.open_bal_cr || 0,
      balance,
    })

    const activeVouchers = vouchers.value
      .filter((v) => !v.is_deleted)
      .sort((a, b) => a.date.localeCompare(b.date) || a.voucher_no.localeCompare(b.voucher_no))

    activeVouchers.forEach((v) => {
      const match = v.entries.find((e) => e.accountId === accountId)
      if (!match) return

      if (fromDate && v.date < fromDate) {
        // Accumulate into opening balance if before fromDate
        const change = acc.normal === 'Dr'
          ? (match.debit || 0) - (match.credit || 0)
          : (match.credit || 0) - (match.debit || 0)
        balance += change
        rows[0].debit += match.debit || 0
        rows[0].credit += match.credit || 0
        rows[0].balance = balance
        return
      }

      if (toDate && v.date > toDate) return

      const change = acc.normal === 'Dr'
        ? (match.debit || 0) - (match.credit || 0)
        : (match.credit || 0) - (match.debit || 0)
      balance += change

      rows.push({
        date: v.date,
        voucherNo: v.voucher_no,
        type: v.type,
        narration: v.narration,
        debit: match.debit || 0,
        credit: match.credit || 0,
        balance,
      })
    })

    return {
      account: acc,
      rows: fromDate ? [rows[0], ...rows.slice(1).filter((r) => r.date >= fromDate)] : rows,
      finalBalance: balance,
    }
  }

  function getProfitAndLoss(toDate?: string) {
    const rows = getTrialBalance(toDate)

    const income = rows.filter((r) => ['Sales Income', 'Other Income'].includes(r.account.group))
    const dirExp = rows.filter((r) => ['Purchase Expense', 'Direct Expense'].includes(r.account.group))
    const indExp = rows.filter((r) => r.account.group === 'Indirect Expense')

    const netCr = (r: typeof rows[0]) => (r.cr - r.dr > 0 ? r.cr - r.dr : 0)
    const netDr = (r: typeof rows[0]) => (r.dr - r.cr > 0 ? r.dr - r.cr : 0)

    const totalIncome = income.reduce((s, r) => s + netCr(r), 0)
    const totalDirExp = dirExp.reduce((s, r) => s + netDr(r), 0)
    const grossProfit = totalIncome - totalDirExp
    const totalIndExp = indExp.reduce((s, r) => s + netDr(r), 0)
    const netProfit = grossProfit - totalIndExp

    return {
      income,
      dirExp,
      indExp,
      totalIncome,
      totalDirExp,
      grossProfit,
      totalIndExp,
      netProfit,
    }
  }

  function getBalanceSheet(toDate?: string) {
    const rows = getTrialBalance(toDate)

    const assets = rows.filter((r) => ['Current Assets', 'Fixed Assets'].includes(r.account.group))
    const liab = rows.filter((r) => r.account.group === 'Current Liabilities')
    const capital = rows.filter((r) => r.account.group === 'Capital & Reserves')

    const incomeRows = rows.filter((r) => ['Sales Income', 'Other Income'].includes(r.account.group))
    const expRows = rows.filter((r) =>
      ['Purchase Expense', 'Direct Expense', 'Indirect Expense'].includes(r.account.group)
    )

    // Net P&L (Cr - Dr for Income, Dr - Cr for Expense)
    const netPL =
      incomeRows.reduce((s, r) => s + (r.cr - r.dr), 0) -
      expRows.reduce((s, r) => s + (r.dr - r.cr), 0)

    const netDrBal = (r: typeof rows[0]) => (r.dr - r.cr > 0 ? r.dr - r.cr : 0)
    const netCrBal = (r: typeof rows[0]) => (r.cr - r.dr > 0 ? r.cr - r.dr : 0)

    const totalAssets = assets.reduce((s, r) => s + netDrBal(r), 0)
    const totalLiab = liab.reduce((s, r) => s + netCrBal(r), 0)
    // Retained Earnings/Net Profit is added to Capital
    const totalCapital = capital.reduce((s, r) => s + netCrBal(r), 0) + netPL
    const totalLiabCap = totalLiab + totalCapital

    return {
      assets,
      liab,
      capital,
      netPL,
      totalAssets,
      totalLiab,
      totalCapital,
      totalLiabCap,
      netDrBal,
      netCrBal,
    }
  }

  /** Trial-balance health: total debits must equal total credits. */
  function verifyTrialBalance(toDate?: string) {
    const rows = getTrialBalance(toDate)
    const dr = Math.round(rows.reduce((s, r) => s + r.dr, 0) * 100) / 100
    const cr = Math.round(rows.reduce((s, r) => s + r.cr, 0) * 100) / 100
    const diff = Math.round((dr - cr) * 100) / 100
    return { dr, cr, diff, balanced: Math.abs(diff) < 0.01 }
  }

  /** Re-post every sale & purchase voucher from source documents using the
   *  current (corrected) logic. Fixes ledger drift from older mis-postings.
   *  Idempotent — each post reverses its own prior voucher first. */
  async function rebuildLedger(): Promise<{ invoices: number; purchases: number }> {
    const firmId = useFirmStore().activeFirmId
    if (!firmId) return { invoices: 0, purchases: 0 }
    await load()

    const invoices = await db.invoices.where('firm_id').equals(firmId).filter((b) => !b.is_deleted).toArray()
    const purchases = await db.purchases.where('firm_id').equals(firmId).filter((p) => !p.is_deleted).toArray()

    for (const inv of invoices) await postSaleToLedger(inv)
    for (const pur of purchases) await postPurchaseToLedger(pur)

    await load()
    return { invoices: invoices.length, purchases: purchases.length }
  }

  return {
    accounts,
    vouchers,
    loaded,
    load,
    addAccount,
    updateAccount,
    removeAccount,
    postVoucher,
    reverseLedgerByRef,
    postSaleToLedger,
    postPurchaseToLedger,
    postPaymentVoucher,
    getTrialBalance,
    getLedgerDetails,
    getProfitAndLoss,
    getBalanceSheet,
    verifyTrialBalance,
    rebuildLedger,
  }
})
