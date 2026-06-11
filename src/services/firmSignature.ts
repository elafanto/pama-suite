import { db } from '@/data/db'
import { nowISO } from '@/data/util'
import type { Firm } from '@/types/models'

const LS_PREFIX = 'pama_firm_signature_'
const ARCHIVE_KEY = 'pama_firm_signatures_archive'

export interface ArchivedFirmSignature {
  signature: string
  firmName: string
  updatedAt: string
}

export type FirmSignatureBackupMap = Record<string, string>
export type FirmSignatureArchive = Record<string, ArchivedFirmSignature>

function readArchive(): FirmSignatureArchive {
  try {
    return JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '{}') as FirmSignatureArchive
  } catch {
    return {}
  }
}

function writeArchive(archive: FirmSignatureArchive) {
  localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive))
}

function mirrorLocal(firmId: string, signature: string) {
  localStorage.setItem(`${LS_PREFIX}${firmId}`, signature)
}

function clearLocalMirror(firmId: string) {
  localStorage.removeItem(`${LS_PREFIX}${firmId}`)
}

/** Resolve signature: firm record → local mirror → archive. */
export function resolveFirmSignature(firm: Pick<Firm, 'id' | 'signature' | 'name'>): string {
  if (firm.signature) return firm.signature
  const local = localStorage.getItem(`${LS_PREFIX}${firm.id}`) || ''
  if (local) return local
  return readArchive()[firm.id]?.signature || ''
}

export function archiveFirmSignature(
  firmId: string,
  signature: string,
  firmName = '',
): void {
  if (!signature) return
  const archive = readArchive()
  archive[firmId] = {
    signature,
    firmName,
    updatedAt: nowISO(),
  }
  writeArchive(archive)
}

/** Persist active signature to firm mirrors + permanent archive. */
export function persistFirmSignature(
  firmId: string,
  signature: string | undefined,
  firmName = '',
): void {
  if (signature) {
    mirrorLocal(firmId, signature)
    archiveFirmSignature(firmId, signature, firmName)
    return
  }
  clearLocalMirror(firmId)
}

/** Collect every known signature for JSON backup (always exported). */
export function collectSignatureBackup(firms: Firm[]): {
  firmSignatures: FirmSignatureBackupMap
  signatureArchive: FirmSignatureArchive
} {
  const firmSignatures: FirmSignatureBackupMap = {}
  for (const firm of firms) {
    const sig = resolveFirmSignature(firm)
    if (sig) firmSignatures[firm.id] = sig
  }
  const archive = readArchive()
  for (const [firmId, entry] of Object.entries(archive)) {
    if (!firmSignatures[firmId] && entry.signature) {
      firmSignatures[firmId] = entry.signature
    }
  }
  return { firmSignatures, signatureArchive: archive }
}

/** Move legacy localStorage-only signatures into Dexie firm records. */
export async function migrateLegacySignaturesToFirms(firms: Firm[]): Promise<number> {
  let migrated = 0
  for (const firm of firms) {
    if (firm.signature) {
      persistFirmSignature(firm.id, firm.signature, firm.name)
      continue
    }
    const legacy = localStorage.getItem(`${LS_PREFIX}${firm.id}`) || ''
    const archived = readArchive()[firm.id]?.signature || ''
    const signature = legacy || archived
    if (!signature) continue
    await db.firms.put({
      ...firm,
      signature,
      updated_at: nowISO(),
      _dirty: true,
    })
    persistFirmSignature(firm.id, signature, firm.name)
    migrated++
  }
  return migrated
}

export async function applyImportedSignatureBackup(settings?: {
  firmSignatures?: FirmSignatureBackupMap
  signatureArchive?: FirmSignatureArchive
}): Promise<number> {
  if (settings?.signatureArchive) {
    const merged = { ...readArchive(), ...settings.signatureArchive }
    writeArchive(merged)
  }

  let restored = 0
  const signatures = settings?.firmSignatures || {}
  for (const [firmId, signature] of Object.entries(signatures)) {
    if (!signature) continue
    persistFirmSignature(firmId, signature)
    const firm = await db.firms.get(firmId)
    if (firm && !firm.signature) {
      await db.firms.put({
        ...firm,
        signature,
        updated_at: nowISO(),
        _dirty: true,
      })
      restored++
    }
  }

  restored += await migrateLegacySignaturesToFirms(await db.firms.toArray())
  return restored
}
