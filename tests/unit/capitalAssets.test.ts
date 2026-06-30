import { describe, it, expect } from 'vitest'
import { isGenericInventoryLine } from '@/services/assets'

describe('capital assets inventory routing', () => {
  it('excludes capital/reel/consumable from generic consumable inventory', () => {
    expect(isGenericInventoryLine({ item_id: 'x', name: 'a', hsn: '', qty: 1, unit: 'NOS', rate: 1, gst: 0, is_capital: true })).toBe(false)
    expect(isGenericInventoryLine({ item_id: 'x', name: 'a', hsn: '', qty: 1, unit: 'NOS', rate: 1, gst: 0, is_kraft_reel: true })).toBe(false)
    expect(isGenericInventoryLine({ item_id: 'x', name: 'a', hsn: '', qty: 1, unit: 'NOS', rate: 1, gst: 0, is_consumable: true })).toBe(false)
    expect(isGenericInventoryLine({ item_id: 'x', name: 'a', hsn: '', qty: 1, unit: 'NOS', rate: 1, gst: 0 })).toBe(true)
  })
})
