import { db } from '@/data/db'
import { nowISO } from '@/data/util'
import { getSupabase } from '@/services/supabase'
import {
  applyImportedSignatureBackup,
  collectSignatureBackup,
} from '@/services/firmSignature'
import { useAuthStore } from '@/stores/auth'

/** Push all firm signatures + archive to Supabase org_settings (online backup). */
export async function pushSignaturesToCloud(): Promise<{ ok: boolean; error?: string }> {
  const auth = useAuthStore()
  const sb = getSupabase()
  if (!sb || !auth.canSync || !auth.orgId) {
    return { ok: false, error: 'Cloud login required for signature backup' }
  }

  const firms = await db.firms.toArray()
  const { firmSignatures, signatureArchive } = collectSignatureBackup(firms)
  const orgId = auth.orgId
  const updatedAt = nowISO()

  const { data: existing, error: readErr } = await sb
    .from('org_settings')
    .select('org_id')
    .eq('org_id', orgId)
    .maybeSingle()

  if (readErr) return { ok: false, error: readErr.message }

  const payload = {
    firm_signatures: firmSignatures,
    signature_archive: signatureArchive,
    updated_at: updatedAt,
  }

  const { error } = existing
    ? await sb.from('org_settings').update(payload).eq('org_id', orgId)
    : await sb.from('org_settings').insert({ org_id: orgId, ...payload })

  if (error) {
    if (/firm_signatures|signature_archive|column/i.test(error.message || '')) {
      return {
        ok: false,
        error: 'Supabase me migration 010_firm_signatures_cloud.sql run karein (org_settings columns).',
      }
    }
    return { ok: false, error: error.message }
  }

  return { ok: true }
}

/** Pull cloud signature backup and merge into local firms + archive. */
export async function pullSignaturesFromCloud(): Promise<{ restored: number; error?: string }> {
  const auth = useAuthStore()
  const sb = getSupabase()
  if (!sb || !auth.canSync || !auth.orgId) return { restored: 0 }

  const { data, error } = await sb
    .from('org_settings')
    .select('firm_signatures, signature_archive')
    .eq('org_id', auth.orgId)
    .maybeSingle()

  if (error) {
    if (/firm_signatures|signature_archive|column/i.test(error.message || '')) {
      return { restored: 0, error: 'Run migration 010_firm_signatures_cloud.sql on Supabase.' }
    }
    return { restored: 0, error: error.message }
  }

  if (!data?.firm_signatures && !data?.signature_archive) {
    return { restored: 0 }
  }

  const restored = await applyImportedSignatureBackup({
    firmSignatures: (data.firm_signatures || {}) as Record<string, string>,
    signatureArchive: (data.signature_archive || {}) as Record<string, { signature: string; firmName: string; updatedAt: string }>,
  })

  return { restored }
}

/** After saving a signature locally, push to cloud when possible. */
export async function syncSignatureToCloudIfReady(): Promise<void> {
  const auth = useAuthStore()
  if (!auth.canSync) return
  try {
    await pushSignaturesToCloud()
  } catch {
    /* non-blocking */
  }
}
