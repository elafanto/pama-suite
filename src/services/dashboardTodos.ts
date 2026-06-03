import { db } from '@/data/db'
import { createRepo } from '@/data/repo'
import type { DashboardTodo } from '@/types/models'

const repo = createRepo<DashboardTodo>(db.dashboard_todos)

export async function listDashboardTodos(firmId: string): Promise<DashboardTodo[]> {
  const rows = await repo.all(firmId)
  return rows.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1
    return (b.created_at || '').localeCompare(a.created_at || '')
  })
}

export async function addDashboardTodo(firmId: string, text: string): Promise<DashboardTodo> {
  return repo.create({ firm_id: firmId, text: text.trim(), completed: false } as Omit<DashboardTodo, 'id' | 'created_at' | 'updated_at' | 'is_deleted' | '_dirty'>)
}

export async function toggleDashboardTodo(id: string, completed: boolean): Promise<DashboardTodo | undefined> {
  return repo.update(id, { completed } as Partial<DashboardTodo>)
}

export async function removeDashboardTodo(id: string): Promise<void> {
  await repo.remove(id)
}
