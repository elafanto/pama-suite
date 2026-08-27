import { describe, expect, it } from 'vitest'
import { consumableLotTotals, resolveConsumableFeed, STOCK_LABELS } from '@/services/production'
import type { ConsumableLot } from '@/types/models'

describe('consumable packs', () => {
  it('labels gum and strapping', () => {
    expect(STOCK_LABELS.glue).toBe('Gum')
    expect(STOCK_LABELS.strapping_roll).toBe('Strapping Roll')
  })

  it('sums active lot remaining packs/weight', () => {
    const lots = [
      {
        id: '1',
        firm_id: 'f1',
        stock_type: 'glue',
        status: 'active',
        is_deleted: false,
        packs_remaining: 10,
        weight_remaining: 250,
      },
      {
        id: '2',
        firm_id: 'f1',
        stock_type: 'glue',
        status: 'consumed',
        is_deleted: false,
        packs_remaining: 0,
        weight_remaining: 0,
      },
    ] as ConsumableLot[]
    expect(consumableLotTotals(lots, 'f1', 'glue')).toEqual({ packs: 10, weight: 250, lots: 1 })
  })

  it('resolves partial feed within available packs', () => {
    expect(resolveConsumableFeed('partial', { qty: 10, weight: 250 }, { qty: 2, weight: 50 })).toEqual({
      qty: 2,
      weight: 50,
    })
  })
})
