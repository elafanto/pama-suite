import { db } from '@/data/db'
import { nowISO } from '@/data/util'
import type { PayrollRun, Staff, StaffAdvance } from '@/types/models'

export interface PayrollBackupBundle {
  staff: Staff[]
  staff_advances: StaffAdvance[]
  payroll_runs: PayrollRun[]
  exported_at: string
}

function isNewer(incoming?: string, existing?: string): boolean {
  if (!existing) return true
  if (!incoming) return false
  const a = Date.parse(incoming)
  const b = Date.parse(existing)
  if (!Number.isFinite(a)) return false
  if (!Number.isFinite(b)) return true
  return a > b
}

/** Full payroll export — staff, advances, attendance/salary runs (incl. soft-deleted). */
export async function collectPayrollBackup(): Promise<PayrollBackupBundle> {
  const [staff, staff_advances, payroll_runs] = await Promise.all([
    db.staff.toArray(),
    db.staff_advances.toArray(),
    db.payroll_runs.toArray(),
  ])
  return {
    staff,
    staff_advances,
    payroll_runs,
    exported_at: nowISO(),
  }
}

/** Merge imported payroll rows (JSON backup or org_settings snapshot). */
export async function applyImportedPayrollBackup(
  incoming: Partial<PayrollBackupBundle> | undefined,
  options: { skipDirtyLocal?: boolean } = {},
): Promise<number> {
  if (!incoming) return 0
  const skipDirty = options.skipDirtyLocal !== false
  let restored = 0

  const mergeRows = async <T extends { id: string; updated_at?: string; _dirty?: boolean }>(
    table: { get: (id: string) => Promise<T | undefined>; put: (row: T) => Promise<unknown> },
    rows: T[] | undefined,
  ) => {
    if (!rows?.length) return
    for (const row of rows) {
      const existing = await table.get(row.id)
      if (skipDirty && existing?._dirty) continue
      if (!existing || isNewer(row.updated_at, existing.updated_at)) {
        await table.put({
          ...row,
          _dirty: false,
          updated_at: row.updated_at || nowISO(),
        } as T)
        restored++
      }
    }
  }

  await mergeRows(db.staff, incoming.staff)
  await mergeRows(db.staff_advances, incoming.staff_advances)
  await mergeRows(db.payroll_runs, incoming.payroll_runs)
  return restored
}
