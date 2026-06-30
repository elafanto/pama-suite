import { describe, it, expect } from 'vitest'
import { applyLineKind, getLineKind, isGenericInventoryLine } from '@/services/purchaseLineKind'

describe('purchase line kind routing', () => {
  const base = { item_id: 'x', name: 'a', hsn: '', qty: 1, unit: 'NOS', rate: 1, gst: 0 }

  it('routes each entry type away from consumable inventory except inventory', () => {
    expect(isGenericInventoryLine({ ...base })).toBe(true)
    expect(isGenericInventoryLine({ ...base, line_kind: 'capital' })).toBe(false)
    expect(isGenericInventoryLine({ ...base, line_kind: 'reel' })).toBe(false)
    expect(isGenericInventoryLine({ ...base, line_kind: 'consumable' })).toBe(false)
    expect(isGenericInventoryLine({ ...base, line_kind: 'expense' })).toBe(false)
  })

  it('keeps legacy flags in sync when applying kind', () => {
    const line = { ...base }
    applyLineKind(line, 'expense')
    expect(getLineKind(line)).toBe('expense')
    expect(line.is_expense).toBe(true)
    expect(line.is_capital).toBe(false)
    expect(line.expense_category).toBe('other')
  })
})
