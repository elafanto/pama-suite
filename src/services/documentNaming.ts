import type { DocumentEntityType } from '@/types/models'

export function sanitizePathSegment(value: string, maxLen = 60): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen) || 'Unknown'
}

export function fileExtensionFromMime(mime: string): string {
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return 'bin'
}

export function buildStoredFileName(
  docDate: string,
  docNo: string,
  partyName: string,
  ext: string,
  suffix = '',
): string {
  const date = (docDate || '').slice(0, 10) || 'unknown-date'
  const party = sanitizePathSegment(partyName)
  const no = sanitizePathSegment(docNo, 40)
  return `${date}_${no}_${party}${suffix}.${ext}`
}

export function buildDocumentPaths(params: {
  orgId: string
  firmId: string
  entityType: DocumentEntityType
  partyName: string
  docDate: string
  storedName: string
}): { storagePath: string; virtualPath: string } {
  const year = (params.docDate || '').slice(0, 4) || 'unknown'
  const party = sanitizePathSegment(params.partyName)
  const folder = params.entityType === 'purchase'
    ? 'Purchases'
    : params.entityType === 'invoice'
      ? 'Sales'
      : 'Vouchers'
  const virtualPath = `${folder}/${party}/${year}/${params.storedName}`
  const storagePath = `${params.orgId}/${params.firmId}/${virtualPath}`
  return { storagePath, virtualPath }
}
