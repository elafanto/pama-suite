import { db } from '@/data/db'
import { uid, nowISO } from '@/data/util'
import type { ActivityLog } from '@/types/models'

export async function logActivity(
  firmId: string,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
  meta?: Record<string, unknown>
) {
  const entry: ActivityLog = {
    id: uid(),
    firm_id: firmId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    summary,
    meta,
    created_at: nowISO(),
    updated_at: nowISO(),
    is_deleted: false,
    _dirty: true,
  }
  await db.activity_log.add(entry)
}

export async function recentActivity(firmId: string, limit = 50): Promise<ActivityLog[]> {
  return db.activity_log
    .where('firm_id')
    .equals(firmId)
    .filter(r => !r.is_deleted)
    .reverse()
    .limit(limit)
    .toArray()
}
