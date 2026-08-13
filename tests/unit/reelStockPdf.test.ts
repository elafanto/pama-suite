import { describe, expect, it } from 'vitest'
import {
  buildReelAbstractPdfRows,
  buildReelWisePdfRows,
} from '@/services/reelStockPdf'
import type { ReelInventoryBreakdownRow } from '@/services/production'
import type { ReelStock } from '@/types/models'

function reel(over: Partial<ReelStock> = {}): ReelStock {
  return {
    id: 'r1',
    firm_id: 'f1',
    reel_no: 'R-101',
    paper_type: 'KRAFT',
    supplier_name: 'Test Mill',
    deckle_size: '1400',
    gsm: '120',
    bf: '18',
    color: 'NS',
    opening_weight: 200,
    current_weight: 150,
    status: 'active',
    intake_condition: 'fresh',
    created_at: '2026-04-01T10:00:00.000Z',
    updated_at: '2026-04-01T10:00:00.000Z',
    is_deleted: false,
    ...over,
  } as ReelStock
}

describe('buildReelWisePdfRows', () => {
  it('sorts by reel number and maps fields', () => {
    const rows = buildReelWisePdfRows([
      reel({ id: 'b', reel_no: 'R-110', current_weight: 80 }),
      reel({ id: 'a', reel_no: 'R-101', intake_condition: 'partial' }),
    ])
    expect(rows.map((r) => r.reelNo)).toEqual(['R-101', 'R-110'])
    expect(rows[0].condition).toBe('partial')
    expect(rows[0].openingKg).toBe(200)
    expect(rows[0].currentKg).toBe(150)
    expect(rows[0].mill).toBe('Test Mill')
  })
})

describe('buildReelAbstractPdfRows', () => {
  it('maps breakdown rows for abstract PDF', () => {
    const breakdown: ReelInventoryBreakdownRow[] = [
      {
        key: 'k',
        paper_type: 'KRAFT',
        gsm: '120',
        bf: '18',
        deckle: '1400',
        color: 'NS',
        reels: 3,
        activeReels: 2,
        openingWeight: 600,
        currentWeight: 400,
        consumedWeight: 200,
        movementOut: 200,
        stockStatus: 'low',
      },
    ]
    const rows = buildReelAbstractPdfRows(breakdown)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('Low stock')
    expect(rows[0].availableKg).toBe(400)
    expect(rows[0].reels).toBe(3)
  })
})
