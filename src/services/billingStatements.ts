import type { Invoice } from '@/types/models'
import type { Firm } from '@/types/models'
import { isInvoiceActive } from '@/services/invoiceStatus'
import { docShortLabel } from '@/services/invoiceDoc'

export interface StatementFilters {
  from?: string
  to?: string
  customer?: string
  payStatus?: string
  docType?: string
  sort?: 'dateAsc' | 'dateDesc' | 'party' | 'amtDesc'
}

function n2(n: number) {
  return (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function filterInvoices(list: Invoice[], firmId: string, f: StatementFilters): Invoice[] {
  let data = list.filter(i => i.firm_id === firmId && isInvoiceActive(i))
  if (f.from) data = data.filter(b => b.date >= f.from!)
  if (f.to) data = data.filter(b => b.date <= f.to!)
  if (f.customer) data = data.filter(b => b.party_name === f.customer)
  if (f.payStatus) data = data.filter(b => b.pay_status === f.payStatus)
  if (f.docType) data = data.filter(b => b.doc_type === f.docType)
  if (f.sort === 'dateAsc') data.sort((a, b) => a.date.localeCompare(b.date))
  else if (f.sort === 'dateDesc') data.sort((a, b) => b.date.localeCompare(a.date))
  else if (f.sort === 'party') data.sort((a, b) => (a.party_name || '').localeCompare(b.party_name || ''))
  else if (f.sort === 'amtDesc') data.sort((a, b) => (b.grand_total || 0) - (a.grand_total || 0))
  return data
}

export function buildStatementHTML(firm: Firm, invoices: Invoice[], filters: StatementFilters): string {
  const data = filterInvoices(invoices, firm.id, filters)
  const period =
    filters.from || filters.to
      ? `Period: ${filters.from || '…'} to ${filters.to || '…'}`
      : 'All dates'
  const cust = filters.customer ? ` | Party: ${filters.customer}` : ''

  let totTaxable = 0
  let totTax = 0
  let totTotal = 0
  let totPaid = 0

  const rows = data.map(b => {
    const taxable = b.sub || 0
    const tax = b.total_tax || 0
    totTaxable += taxable
    totTax += tax
    totTotal += b.grand_total || 0
    totPaid += b.amt_paid || 0
    const docLbl = docShortLabel(b)
    return `<tr>
      <td>${b.date}</td><td>${b.bill_no}</td><td>${b.party_name}</td><td>${docLbl}</td>
      <td class="num">₹${n2(taxable)}</td><td class="num">₹${n2(tax)}</td><td class="num">₹${n2(b.grand_total)}</td>
      <td class="num">₹${n2(b.amt_paid || 0)}</td><td>${b.pay_status}</td>
    </tr>`
  }).join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Statement — ${firm.name}</title>
<style>
  body { font-family: system-ui, sans-serif; font-size: 11px; padding: 12mm; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: left; }
  th { background: #1e3a8a; color: white; font-size: 10px; }
  .num { text-align: right; font-family: monospace; }
  tfoot td { font-weight: bold; background: #f1f5f9; }
  @media print { .print-btn { display: none; } }
</style></head><body>
<button class="print-btn" onclick="window.print()" style="position:fixed;top:8px;right:8px;padding:8px 16px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer">Print / Save PDF</button>
<h1>${firm.name}</h1>
<p>Account Statement — ${period}${cust}</p>
<table>
<thead><tr><th>Date</th><th>Bill No</th><th>Party</th><th>Type</th><th>Taxable</th><th>Tax</th><th>Total</th><th>Paid</th><th>Status</th></tr></thead>
<tbody>${rows || '<tr><td colspan="9">No bills</td></tr>'}</tbody>
<tfoot><tr>
  <td colspan="4">Totals (${data.length} bills)</td>
  <td class="num">₹${n2(totTaxable)}</td><td class="num">₹${n2(totTax)}</td>
  <td class="num">₹${n2(totTotal)}</td><td class="num">₹${n2(totPaid)}</td><td></td>
</tr></tfoot>
</table></body></html>`
}

export function openStatementPrint(firm: Firm, invoices: Invoice[], filters: StatementFilters): boolean {
  const data = filterInvoices(invoices, firm.id, filters)
  if (data.length === 0) return false
  const html = buildStatementHTML(firm, invoices, filters)
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.write(html)
  w.document.close()
  return true
}
