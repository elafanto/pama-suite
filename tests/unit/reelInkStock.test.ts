import { describe, expect, it } from 'vitest'
import {
  findDuplicateReelNosInList,
  findReelNosAlreadyInStock,
  guessInkColorFromText,
  normalizeInkColor,
  consumableLotTotals,
} from '@/services/production'
import type { ConsumableLot } from '@/types/models'

describe('reel number uniqueness helpers', () => {
  it('detects duplicates in proposed list (case-insensitive)', () => {
    expect(findDuplicateReelNosInList(['R-1', 'r-1', 'R-2'])).toEqual(['R-1'])
  })

  it('detects reel nos already in stock', () => {
    expect(findReelNosAlreadyInStock(['R-9', 'R-10'], ['r-9', 'R-11'])).toEqual(['R-9'])
  })

  it('excludes same purchase when checking stock', () => {
    expect(
      findReelNosAlreadyInStock(['R-1'], [], {
        excludePurchaseId: 'p1',
        existing: [
          { reel_no: 'R-1', purchase_id: 'p1', is_deleted: false },
          { reel_no: 'R-2', purchase_id: 'p2', is_deleted: false },
        ],
      }),
    ).toEqual([])
  })
})

describe('ink color', () => {
  it('normalizes whitespace', () => {
    expect(normalizeInkColor('  Cyan  Blue ')).toBe('Cyan Blue')
  })

  it('guesses color from item name', () => {
    expect(guessInkColorFromText('Offset ink Red 25kg')).toBe('Red')
    expect(guessInkColorFromText('Gum paste')).toBe('')
  })

  it('filters lot totals by ink color', () => {
    const lots = [
      {
        id: '1',
        firm_id: 'f1',
        stock_type: 'ink',
        status: 'active',
        is_deleted: false,
        ink_color: 'Black',
        packs_remaining: 2,
        weight_remaining: 50,
      },
      {
        id: '2',
        firm_id: 'f1',
        stock_type: 'ink',
        status: 'active',
        is_deleted: false,
        ink_color: 'Cyan',
        packs_remaining: 3,
        weight_remaining: 75,
      },
    ] as ConsumableLot[]
    expect(consumableLotTotals(lots, 'f1', 'ink', 'black')).toEqual({ packs: 2, weight: 50, lots: 1 })
    expect(consumableLotTotals(lots, 'f1', 'ink')).toEqual({ packs: 5, weight: 125, lots: 2 })
  })
})
