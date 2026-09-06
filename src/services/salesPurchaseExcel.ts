import * as XLSX from 'xlsx'
import type { SalesPurchaseSummary } from '@/services/salesPurchaseReport'

function n2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function moneyRow(label: string, t: { billCount: number; taxable: number; tax: number; grandTotal: number; paid: number; outstanding: number }) {
  return [label, t.billCount, n2(t.taxable), n2(t.tax), n2(t.grandTotal), n2(t.paid), n2(t.outstanding)]
}

function periodSheet(summary: SalesPurchaseSummary): (string | number)[][] {
  const p = summary.period
  return [
    ['PAMA SUITE — Sales & Purchase Summary'],
    ['Period', p.label],
    ['From', p.from || '(all)'],
    ['To', p.to || '(all)'],
    [],
    ['Metric', 'Bills', 'Taxable', 'Tax', 'Grand Total', 'Paid', 'Outstanding'],
    moneyRow('Sales', summary.sales),
    moneyRow('Purchases', summary.purchases),
    ['Net (Sales − Purchases)', '', '', '', n2(summary.net), '', ''],
  ]
}

function salesRegisterSheet(summary: SalesPurchaseSummary): (string | number)[][] {
  const rows: (string | number)[][] = [
    ['Date', 'Bill No', 'Party', 'Pay Status', 'Taxable', 'Tax', 'Grand Total', 'Paid', 'Outstanding'],
  ]
  for (const inv of summary.salesRegister) {
    const outstanding = Math.max(0, n2((inv.grand_total || 0) - (inv.amt_paid || 0)))
    rows.push([
      inv.date,
      inv.bill_no,
      inv.party_name || '',
      inv.pay_status || '',
      n2(inv.sub || 0),
      n2(inv.total_tax || 0),
      n2(inv.grand_total || 0),
      n2(inv.amt_paid || 0),
      outstanding,
    ])
  }
  return rows
}

function purchaseRegisterSheet(summary: SalesPurchaseSummary): (string | number)[][] {
  const rows: (string | number)[][] = [
    ['Date', 'Bill No', 'Supplier', 'Pay Status', 'Taxable', 'Tax', 'Grand Total', 'Paid', 'Outstanding'],
  ]
  for (const pur of summary.purchaseRegister) {
    const outstanding = Math.max(0, n2((pur.grand_total || 0) - (pur.amt_paid || 0)))
    rows.push([
      pur.date || pur.received_date || '',
      pur.bill_no || '',
      pur.supplier_name || '',
      pur.pay_status || '',
      n2(pur.sub || 0),
      n2(pur.total_tax || 0),
      n2(pur.grand_total || 0),
      n2(pur.amt_paid || 0),
      outstanding,
    ])
  }
  return rows
}

function monthSheet(
  sales: SalesPurchaseSummary['salesByMonth'],
  purchases: SalesPurchaseSummary['purchasesByMonth'],
): (string | number)[][] {
  const keys = [...new Set([...sales.map((r) => r.key), ...purchases.map((r) => r.key)])].sort()
  const sMap = new Map(sales.map((r) => [r.key, r]))
  const pMap = new Map(purchases.map((r) => [r.key, r]))
  const rows: (string | number)[][] = [
    ['Month', 'Sales Bills', 'Sales Total', 'Purchase Bills', 'Purchase Total', 'Net'],
  ]
  for (const key of keys) {
    const s = sMap.get(key)
    const p = pMap.get(key)
    const st = s?.grandTotal || 0
    const pt = p?.grandTotal || 0
    rows.push([
      s?.label || p?.label || key,
      s?.billCount || 0,
      n2(st),
      p?.billCount || 0,
      n2(pt),
      n2(st - pt),
    ])
  }
  return rows
}

function yearSheet(
  sales: SalesPurchaseSummary['salesByYear'],
  purchases: SalesPurchaseSummary['purchasesByYear'],
): (string | number)[][] {
  const keys = [...new Set([...sales.map((r) => r.key), ...purchases.map((r) => r.key)])].sort()
  const sMap = new Map(sales.map((r) => [r.key, r]))
  const pMap = new Map(purchases.map((r) => [r.key, r]))
  const rows: (string | number)[][] = [
    ['FY', 'Sales Bills', 'Sales Total', 'Purchase Bills', 'Purchase Total', 'Net'],
  ]
  for (const key of keys) {
    const s = sMap.get(key)
    const p = pMap.get(key)
    const st = s?.grandTotal || 0
    const pt = p?.grandTotal || 0
    rows.push([
      key,
      s?.billCount || 0,
      n2(st),
      p?.billCount || 0,
      n2(pt),
      n2(st - pt),
    ])
  }
  return rows
}

function partySheet(
  title: string,
  parties: SalesPurchaseSummary['salesByParty'],
): (string | number)[][] {
  const rows: (string | number)[][] = [
    [title],
    ['Party', 'Bills', 'Taxable', 'Tax', 'Grand Total', 'Paid', 'Outstanding'],
  ]
  for (const p of parties) {
    rows.push([
      p.partyName,
      p.billCount,
      n2(p.taxable),
      n2(p.tax),
      n2(p.grandTotal),
      n2(p.paid),
      n2(p.outstanding),
    ])
  }
  return rows
}

export function buildSalesPurchaseWorkbook(summary: SalesPurchaseSummary): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(periodSheet(summary)), 'Summary')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(salesRegisterSheet(summary)), 'Sales Register')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(purchaseRegisterSheet(summary)), 'Purchase Register')
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(monthSheet(summary.salesByMonth, summary.purchasesByMonth)),
    'By Month',
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(yearSheet(summary.salesByYear, summary.purchasesByYear)),
    'By FY',
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(partySheet('Sales by Customer', summary.salesByParty)),
    'Sales by Party',
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(partySheet('Purchases by Vendor', summary.purchasesByParty)),
    'Purchases by Party',
  )
  return wb
}

export function downloadSalesPurchaseExcel(summary: SalesPurchaseSummary, firmName?: string) {
  const wb = buildSalesPurchaseWorkbook(summary)
  const safePeriod = (summary.period.label || 'period').replace(/[^\w.-]+/g, '_')
  const safeFirm = (firmName || 'Firm').replace(/[^\w.-]+/g, '_').slice(0, 40)
  const file = `Sales_Purchase_${safeFirm}_${safePeriod}.xlsx`
  XLSX.writeFile(wb, file)
  return { file, salesBills: summary.sales.billCount, purchaseBills: summary.purchases.billCount }
}
