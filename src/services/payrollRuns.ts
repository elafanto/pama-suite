import { db } from '@/data/db'
import { nowISO } from '@/data/util'
import { normalizeDayHours } from '@/services/payrollCalc'
import type { PayrollRun } from '@/types/models'

/** Count marked attendance days across all staff lines. */
export function attendanceScore(run: PayrollRun): number {
  let n = 0
  for (const line of run.lines || []) {
    n += Object.keys(normalizeDayHours(line)).length
  }
  return n
}

/** Pick the canonical run when sync created duplicates for the same month. */
export function pickBestPayrollRun(runs: PayrollRun[]): PayrollRun {
  return [...runs].sort((a, b) => {
    const scoreDiff = attendanceScore(b) - attendanceScore(a)
    if (scoreDiff !== 0) return scoreDiff
    const paidDiff = (b.status === 'paid' ? 1 : 0) - (a.status === 'paid' ? 1 : 0)
    if (paidDiff !== 0) return paidDiff
    return (b.updated_at || '').localeCompare(a.updated_at || '')
  })[0]
}

/** Soft-delete extra payroll runs that share the same firm + period. */
export async function dedupeAllPayrollRuns(firmId?: string): Promise<number> {
  const runs = firmId
    ? await db.payroll_runs.where('firm_id').equals(firmId).filter((r) => !r.is_deleted).toArray()
    : await db.payroll_runs.filter((r) => !r.is_deleted).toArray()

  const groups = new Map<string, PayrollRun[]>()
  for (const run of runs) {
    const key = `${run.firm_id}:${run.period}`
    const list = groups.get(key) || []
    list.push(run)
    groups.set(key, list)
  }

  let removed = 0
  const ts = nowISO()
  for (const group of groups.values()) {
    if (group.length <= 1) continue
    const winner = pickBestPayrollRun(group)
    for (const run of group) {
      if (run.id === winner.id) continue
      await db.payroll_runs.put({ ...run, is_deleted: true, updated_at: ts, _dirty: true })
      removed++
    }
  }
  return removed
}
