import { nowISO } from '@/data/util'
import { applyImportedPayrollBackup, collectPayrollBackup } from '@/services/payrollBackup'
import { getSupabase } from '@/services/supabase'
import { useAuthStore } from '@/stores/auth'

const MIGRATION_HINT = 'Supabase me migration 012_payroll_cloud_backup.sql run karein (org_settings.payroll_backup).'

/** Push staff + advances + attendance/salary runs to org_settings (extra online backup). */
export async function pushPayrollToCloud(): Promise<{ ok: boolean; error?: string }> {
  const auth = useAuthStore()
  const sb = getSupabase()
  if (!sb || !auth.canSync || !auth.orgId) {
    return { ok: false, error: 'Cloud login required for payroll backup' }
  }

  const bundle = await collectPayrollBackup()
  const orgId = auth.orgId
  const updatedAt = nowISO()

  const { data: existing, error: readErr } = await sb
    .from('org_settings')
    .select('org_id')
    .eq('org_id', orgId)
    .maybeSingle()

  if (readErr) return { ok: false, error: readErr.message }

  const payload = {
    payroll_backup: bundle,
    updated_at: updatedAt,
  }

  const { error } = existing
    ? await sb.from('org_settings').update(payload).eq('org_id', orgId)
    : await sb.from('org_settings').insert({ org_id: orgId, ...payload })

  if (error) {
    if (/payroll_backup|column/i.test(error.message || '')) {
      return { ok: false, error: MIGRATION_HINT }
    }
    return { ok: false, error: error.message }
  }

  return { ok: true }
}

/** Pull org_settings payroll snapshot and merge into local Dexie. */
export async function pullPayrollFromCloud(): Promise<{ restored: number; error?: string }> {
  const auth = useAuthStore()
  const sb = getSupabase()
  if (!sb || !auth.canSync || !auth.orgId) return { restored: 0 }

  const { data, error } = await sb
    .from('org_settings')
    .select('payroll_backup')
    .eq('org_id', auth.orgId)
    .maybeSingle()

  if (error) {
    if (/payroll_backup|column/i.test(error.message || '')) {
      return { restored: 0, error: MIGRATION_HINT }
    }
    return { restored: 0, error: error.message }
  }

  const bundle = data?.payroll_backup as Record<string, unknown> | undefined
  if (!bundle?.staff && !bundle?.staff_advances && !bundle?.payroll_runs) {
    return { restored: 0 }
  }

  const restored = await applyImportedPayrollBackup(bundle as Parameters<typeof applyImportedPayrollBackup>[0])
  return { restored }
}

/** After local payroll save, push snapshot when cloud is ready. */
export async function syncPayrollToCloudIfReady(): Promise<void> {
  const auth = useAuthStore()
  if (!auth.canSync) return
  try {
    await pushPayrollToCloud()
  } catch {
    /* non-blocking */
  }
}
