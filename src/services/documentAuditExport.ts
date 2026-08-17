import JSZip from 'jszip'
import { db } from '@/data/db'
import { downloadAttachmentBlob } from '@/services/documentAttachments'
import { sanitizePathSegment } from '@/services/documentNaming'
import type { DocumentAttachment } from '@/types/models'

export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024

export interface IndianFYRange {
  label: string
  from: string
  to: string
}

export function listRecentIndianFYLabels(count = 5, ref = new Date()): IndianFYRange[] {
  const y = ref.getFullYear()
  const m = ref.getMonth() + 1
  const startYear = m >= 4 ? y : y - 1
  const out: IndianFYRange[] = []
  for (let i = 0; i < count; i++) {
    const sy = startYear - i
    const ey = sy + 1
    out.push({
      label: `FY${sy}-${String(ey).slice(-2)}`,
      from: `${sy}-04-01`,
      to: `${ey}-03-31`,
    })
  }
  return out
}

function monthFolder(date: string): string {
  return (date || '').slice(0, 7) || 'unknown-month'
}

function zipPathForAttachment(rec: DocumentAttachment): string {
  const party = sanitizePathSegment(rec.party_name)
  const month = monthFolder(rec.doc_date)
  const folder = rec.entity_type === 'purchase'
    ? 'Purchases'
    : rec.entity_type === 'invoice'
      ? 'Sales'
      : 'Vouchers'
  return `${folder}/${party}/${month}/${rec.stored_name}`
}

function csvEscape(value: string | number): string {
  const text = String(value ?? '')
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export async function exportGstAuditZip(params: {
  firmId: string
  fy: IndianFYRange
}): Promise<{ ok: boolean; error?: string; fileCount?: number }> {
  const rows = await db.document_attachments
    .where('firm_id')
    .equals(params.firmId)
    .filter((r) => !r.is_deleted && r.doc_date >= params.fy.from && r.doc_date <= params.fy.to)
    .toArray()

  if (!rows.length) {
    return { ok: false, error: `${params.fy.label} me koi saved document nahi mila.` }
  }

  const zip = new JSZip()
  const manifest: string[] = [
    'entity_type,party,doc_no,doc_date,month,stored_name,original_name,size_bytes,upload_status,virtual_path',
  ]

  let fileCount = 0
  for (const rec of rows) {
    const blob = await downloadAttachmentBlob(rec.id)
    manifest.push([
      rec.entity_type,
      rec.party_name,
      rec.doc_no,
      rec.doc_date,
      monthFolder(rec.doc_date),
      rec.stored_name,
      rec.original_name,
      rec.size_bytes,
      rec.upload_status,
      rec.virtual_path,
    ].map(csvEscape).join(','))

    if (!blob) continue
    zip.file(zipPathForAttachment(rec), blob)
    fileCount++
  }

  zip.file('manifest.csv', manifest.join('\n'))
  zip.file('README.txt', [
    `Pama Suite GST Audit Pack`,
    `Financial Year: ${params.fy.label} (${params.fy.from} to ${params.fy.to})`,
    `Files included: ${fileCount}`,
    `Folder layout: Purchases|Sales|Vouchers / Party / YYYY-MM / renamed-file`,
    `original_name column = phone se upload hone wala asli filename (audit trail).`,
  ].join('\n'))

  const content = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(content)
  const a = document.createElement('a')
  a.href = url
  a.download = `GST-Audit-${params.fy.label}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)

  return { ok: true, fileCount }
}
