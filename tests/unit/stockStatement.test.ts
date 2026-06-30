import { describe, expect, it } from 'vitest'
import {
  computeLineAmount,
  createBlankStockStatement,
  grandTotal,
  normalizeStockStatement,
  segmentTotal,
} from '@/services/stockStatement'

describe('stockStatement helpers', () => {
  it('creates a blank statement with all four default segments', () => {
    const statement = createBlankStockStatement('F1')
    expect(statement.lines.map((line) => line.segment)).toEqual(['paper', 'gum', 'stitching_wire', 'consumables'])
  })

  it('calculates segment and grand totals', () => {
    const statement = normalizeStockStatement({
      ...createBlankStockStatement('F1'),
      lines: [
        { id: '1', segment: 'paper', paper_name: 'Kraft', bf: '18', gsm: '120', qty: 100, unit: 'KG', rate: 50, amount: 0 },
        { id: '2', segment: 'gum', item_name: 'Gum', qty: 20, unit: 'KG', rate: 70, amount: 0 },
      ],
    })

    expect(computeLineAmount(statement.lines[0])).toBe(5000)
    expect(segmentTotal(statement.lines, 'paper')).toBe(5000)
    expect(segmentTotal(statement.lines, 'gum')).toBe(1400)
    expect(grandTotal(statement.lines)).toBe(6400)
  })
})
