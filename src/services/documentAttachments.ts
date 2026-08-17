import { db } from '@/data/db'
import { createRepo } from '@/data/repo'
import { uid, nowISO } from '@/data/util'
import { getSupabase } from '@/services/supabase'
import { useAuthStore } from '@/stores/auth'
import { useFirmStore } from '@/stores/firm'
import { prepareDocumentFile } from '@/services/documentCompress'
import { DOCUMENT_MAX_BYTES } from '@/services/documentAuditExport'
import {
  buildDocumentPaths,
  buildStoredFileName,
  fileExtensionFromMime,
  sanitizePathSegment,
} from '@/services/documentNaming'
import type { DocumentAttachment, DocumentEntityType } from '@/types/models'

export { DOCUMENT_MAX_BYTES }

const repo = createRepo<DocumentAttachment>(db.document_attachments)

export const DOCUMENTS_BUCKET = 'pama-documents'
const MOBILE_STORAGE_WARN_BYTES = 80 * 1024 * 1024

export interface AttachDocumentInput {
  file: File
  entityType: DocumentEntityType
  entityId: string
  partyName: string
  docNo: string
  docDate: string
  firmId?: string
  reuseStoragePath?: string
}

export interface DocumentStorageStats {
  attachmentCount: number
  localBytes: number
  pendingUploads: number
  shouldWarnMobile: boolean
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function validateDocumentFileSize(file: File): void {
  if (file.size > DOCUMENT_MAX_BYTES) {
    throw new Error(`${file.name}: file ${formatBytes(file.size)} hai. Maximum ${formatBytes(DOCUMENT_MAX_BYTES)} allowed.`)
  }
}

async function saveLocalBlob(attachmentId: string, blob: Blob) {
  await db.attachment_blobs.put({ id: attachmentId, blob, updated_at: nowISO() })
}

async function getLocalBlob(attachmentId: string): Promise<Blob | null> {
  const row = await db.attachment_blobs.get(attachmentId)
  return row?.blob || null
}

async function resolveUniqueStoredName(
  firmId: string,
  docDate: string,
  docNo: string,
  partyName: string,
  ext: string,
): Promise<string> {
  let suffix = ''
  for (let i = 0; i < 20; i++) {
    const storedName = buildStoredFileName(docDate, docNo, partyName, ext, suffix)
    const clash = await db.document_attachments
      .where('firm_id')
      .equals(firmId)
      .filter((r) => !r.is_deleted && r.stored_name === storedName)
      .first()
    if (!clash) return storedName
    suffix = `_${i + 2}`
  }
  return buildStoredFileName(docDate, docNo, partyName, ext, `_${uid().slice(0, 6)}`)
}

export async function getDocumentStorageStats(firmId?: string): Promise<DocumentStorageStats> {
  const firm = useFirmStore()
  const fid = firmId || firm.activeFirmId
  const attachments = await db.document_attachments
    .where('firm_id')
    .equals(fid)
    .filter((r) => !r.is_deleted)
    .toArray()
  const ids = new Set(attachments.map((r) => r.id))
  const blobs = await db.attachment_blobs.toArray()
  const localBytes = blobs
    .filter((b) => ids.has(b.id))
    .reduce((sum, b) => sum + b.blob.size, 0)
  const pendingUploads = attachments.filter((r) => r.upload_status === 'pending' || r.upload_status === 'failed').length
  const isMobile = typeof window !== 'undefined'
    && (window.matchMedia('(max-width: 768px)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent))
  return {
    attachmentCount: attachments.length,
    localBytes,
    pendingUploads,
    shouldWarnMobile: isMobile && localBytes >= MOBILE_STORAGE_WARN_BYTES,
  }
}

export async function attachDocumentFromFile(input: AttachDocumentInput): Promise<DocumentAttachment | null> {
  const auth = useAuthStore()
  const firmStore = useFirmStore()
  const firmId = input.firmId || firmStore.activeFirmId
  if (!firmId || !input.entityId) return null

  validateDocumentFileSize(input.file)

  const prepared = await prepareDocumentFile(input.file)
  if (prepared.blob.size > DOCUMENT_MAX_BYTES) {
    throw new Error(
      `${input.file.name}: file ${formatBytes(prepared.blob.size)} hai after compression. `
      + `Maximum ${formatBytes(DOCUMENT_MAX_BYTES)} allowed — chhota PDF ya kam pages wali file use karein.`,
    )
  }

  const stats = await getDocumentStorageStats(firmId)
  if (stats.shouldWarnMobile) {
    const proceed = confirm(
      `Phone par document cache ${formatBytes(stats.localBytes)} ho chuka hai.\n\nPhir bhi ye file save karein? Purani files Sync + ZIP export se manage kar sakte ho.`,
    )
    if (!proceed) return null
  }

  const ext = fileExtensionFromMime(prepared.mime)
  const storedName = await resolveUniqueStoredName(
    firmId,
    input.docDate,
    input.docNo,
    input.partyName,
    ext,
  )

  const orgId = auth.orgId || 'local'
  let storagePath = input.reuseStoragePath || ''
  let virtualPath = ''

  if (!storagePath) {
    const paths = buildDocumentPaths({
      orgId,
      firmId,
      entityType: input.entityType,
      partyName: input.partyName,
      docDate: input.docDate,
      storedName,
    })
    storagePath = paths.storagePath
    virtualPath = paths.virtualPath
  } else {
    const parts = storagePath.split('/')
    virtualPath = parts.slice(2).join('/')
  }

  const rec = await repo.create({
    firm_id: firmId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    party_name: input.partyName.trim(),
    doc_no: input.docNo.trim(),
    doc_date: input.docDate.slice(0, 10),
    storage_path: storagePath,
    stored_name: storedName,
    virtual_path: virtualPath,
    mime_type: prepared.mime,
    size_bytes: prepared.blob.size,
    original_name: input.file.name,
    upload_status: 'pending',
    has_local_blob: true,
  } as Omit<DocumentAttachment, 'id' | 'created_at' | 'updated_at' | 'is_deleted' | '_dirty'>)

  await saveLocalBlob(rec.id, prepared.blob)

  if (auth.canSync) {
    try {
      await uploadAttachment(rec.id, prepared.blob)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      await repo.update(rec.id, { upload_status: 'failed', upload_error: message })
    }
  }

  return (await repo.get(rec.id)) || rec
}

export async function softDeleteAttachmentsForEntity(
  entityType: DocumentEntityType,
  entityId: string,
  firmId?: string,
): Promise<number> {
  const firm = useFirmStore()
  const fid = firmId || firm.activeFirmId
  const rows = await db.document_attachments
    .where('[firm_id+entity_type+entity_id]')
    .equals([fid, entityType, entityId])
    .filter((r) => !r.is_deleted)
    .toArray()
  for (const row of rows) await repo.remove(row.id)
  return rows.length
}

export async function restoreAttachmentsForEntity(
  entityType: DocumentEntityType,
  entityId: string,
  firmId?: string,
): Promise<number> {
  const firm = useFirmStore()
  const fid = firmId || firm.activeFirmId
  const rows = await db.document_attachments
    .where('[firm_id+entity_type+entity_id]')
    .equals([fid, entityType, entityId])
    .toArray()
  let restored = 0
  for (const row of rows) {
    if (row.is_deleted) {
      await repo.restore(row.id)
      restored++
    }
  }
  return restored
}

export async function restoreAttachment(id: string): Promise<void> {
  await repo.restore(id)
}

export async function uploadAttachment(attachmentId: string, blob?: Blob): Promise<void> {
  const auth = useAuthStore()
  const sb = getSupabase()
  if (!sb || !auth.canSync || !auth.orgId) {
    throw new Error('Cloud login required for document upload')
  }

  const rec = await repo.get(attachmentId)
  if (!rec || rec.is_deleted) return
  if (rec.upload_status === 'uploaded') return

  const existingUploaded = await db.document_attachments
    .filter((r) => !r.is_deleted && r.storage_path === rec.storage_path && r.upload_status === 'uploaded' && r.id !== rec.id)
    .first()
  if (existingUploaded) {
    await repo.update(attachmentId, { upload_status: 'uploaded', upload_error: undefined })
    return
  }

  const fileBlob = blob || await getLocalBlob(attachmentId)
  if (!fileBlob) throw new Error('Local file missing')

  const path = rec.storage_path.startsWith(auth.orgId)
    ? rec.storage_path
    : `${auth.orgId}/${rec.firm_id}/${rec.virtual_path}`

  const { error } = await sb.storage.from(DOCUMENTS_BUCKET).upload(path, fileBlob, {
    upsert: true,
    contentType: rec.mime_type,
  })
  if (error) throw new Error(error.message)

  await repo.update(attachmentId, {
    storage_path: path,
    upload_status: 'uploaded',
    upload_error: undefined,
  })
}

export async function pushPendingDocumentUploads(): Promise<{ uploaded: number; failed: number }> {
  const auth = useAuthStore()
  if (!auth.canSync) return { uploaded: 0, failed: 0 }

  const pending = await db.document_attachments
    .filter((r) => !r.is_deleted && (r.upload_status === 'pending' || r.upload_status === 'failed'))
    .toArray()

  let uploaded = 0
  let failed = 0
  for (const rec of pending) {
    try {
      await uploadAttachment(rec.id)
      uploaded++
    } catch {
      failed++
    }
  }
  return { uploaded, failed }
}

export async function downloadAttachmentBlob(attachmentId: string): Promise<Blob | null> {
  const local = await getLocalBlob(attachmentId)
  if (local) return local

  const auth = useAuthStore()
  const sb = getSupabase()
  const rec = await repo.get(attachmentId)
  if (!rec || !sb || !auth.canSync) return null

  const { data, error } = await sb.storage.from(DOCUMENTS_BUCKET).download(rec.storage_path)
  if (error || !data) return null

  await saveLocalBlob(attachmentId, data)
  await repo.update(attachmentId, { has_local_blob: true })
  return data
}

export async function getAttachmentForEntity(
  entityType: DocumentEntityType,
  entityId: string,
): Promise<DocumentAttachment | undefined> {
  const firm = useFirmStore()
  return db.document_attachments
    .where('[firm_id+entity_type+entity_id]')
    .equals([firm.activeFirmId, entityType, entityId])
    .filter((r) => !r.is_deleted)
    .first()
}

export async function entityHasAttachment(entityType: DocumentEntityType, entityId: string): Promise<boolean> {
  return !!(await getAttachmentForEntity(entityType, entityId))
}

async function blobToShareFile(rec: DocumentAttachment, blob: Blob): Promise<File> {
  return new File([blob], rec.stored_name, { type: rec.mime_type })
}

export async function shareEntityDocument(entityType: DocumentEntityType, entityId: string): Promise<boolean> {
  const rec = await getAttachmentForEntity(entityType, entityId)
  if (!rec) {
    alert('Share ke liye saved file nahi mili.')
    return false
  }
  const blob = await downloadAttachmentBlob(rec.id)
  if (!blob) {
    alert('File load nahi ho payi. Pehle Sync karein.')
    return false
  }
  const file = await blobToShareFile(rec, blob)
  const shareData: ShareData = {
    title: rec.stored_name,
    text: `${rec.party_name} · ${rec.doc_no} · ${rec.doc_date}\nOriginal: ${rec.original_name}`,
    files: [file],
  }
  if (navigator.share && navigator.canShare?.(shareData)) {
    await navigator.share(shareData)
    return true
  }
  await downloadEntityDocument(entityType, entityId)
  alert('Is device par direct share supported nahi. File download ho gayi — WhatsApp se manually bhejein.')
  return false
}

export async function shareEntityDocumentWhatsApp(entityType: DocumentEntityType, entityId: string): Promise<boolean> {
  const rec = await getAttachmentForEntity(entityType, entityId)
  if (!rec) return false
  const blob = await downloadAttachmentBlob(rec.id)
  if (!blob) return false
  const file = await blobToShareFile(rec, blob)
  const shareData: ShareData = { files: [file], title: rec.stored_name }
  if (navigator.share && navigator.canShare?.(shareData)) {
    try {
      await navigator.share(shareData)
      return true
    } catch {
      /* user cancelled */
    }
  }
  const text = encodeURIComponent(`${rec.party_name} bill ${rec.doc_no} (${rec.doc_date})`)
  window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer')
  await downloadEntityDocument(entityType, entityId)
  alert('WhatsApp text link khula. File download bhi ho gayi — attachment ke taur par bhejein.')
  return true
}

export async function openEntityDocument(entityType: DocumentEntityType, entityId: string): Promise<boolean> {
  const rec = await getAttachmentForEntity(entityType, entityId)
  if (!rec) {
    alert('Is bill/voucher ki file save nahi hui.')
    return false
  }
  const blob = await downloadAttachmentBlob(rec.id)
  if (!blob) {
    alert(rec.upload_status === 'pending'
      ? 'File abhi cloud par upload nahi hui. Sync karein ya internet check karein.'
      : 'File download nahi ho payi.')
    return false
  }
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return true
}

export async function downloadEntityDocument(entityType: DocumentEntityType, entityId: string): Promise<boolean> {
  const rec = await getAttachmentForEntity(entityType, entityId)
  if (!rec) return false
  const blob = await downloadAttachmentBlob(rec.id)
  if (!blob) return false
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = rec.stored_name || sanitizePathSegment(rec.original_name, 80)
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return true
}

export async function cacheRecentRemoteDocuments(limit = 8): Promise<number> {
  const auth = useAuthStore()
  if (!auth.canSync) return 0

  const firm = useFirmStore()
  const rows = await db.document_attachments
    .where('firm_id')
    .equals(firm.activeFirmId)
    .filter((r) => !r.is_deleted && r.upload_status === 'uploaded' && !r.has_local_blob)
    .toArray()

  let cached = 0
  for (const rec of rows.slice(0, limit)) {
    const blob = await downloadAttachmentBlob(rec.id)
    if (blob) cached++
  }
  return cached
}

export async function countPendingUploads(): Promise<number> {
  return db.document_attachments
    .filter((r) => !r.is_deleted && (r.upload_status === 'pending' || r.upload_status === 'failed'))
    .count()
}
