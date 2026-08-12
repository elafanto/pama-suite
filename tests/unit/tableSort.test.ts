import { describe, expect, it } from 'vitest'
import { compareSortValues, sortRowsBy, toggleSortState } from '@/composables/useTableSort'

describe('compareSortValues', () => {
  it('compares numbers and numeric strings', () => {
    expect(compareSortValues(2, 10)).toBeLessThan(0)
    expect(compareSortValues('2', '10')).toBeLessThan(0)
  })

  it('compares text', () => {
    expect(compareSortValues('Beta', 'Alpha')).toBeGreaterThan(0)
  })
})

describe('sortRowsBy', () => {
  it('sorts ascending and descending', () => {
    const rows = [{ n: 3 }, { n: 1 }, { n: 2 }]
    expect(sortRowsBy(rows, (r) => r.n, 'asc').map((r) => r.n)).toEqual([1, 2, 3])
    expect(sortRowsBy(rows, (r) => r.n, 'desc').map((r) => r.n)).toEqual([3, 2, 1])
  })
})

describe('toggleSortState', () => {
  it('flips direction on same key and resets on new key', () => {
    expect(toggleSortState('date', 'asc', 'date')).toEqual({ key: 'date', dir: 'desc' })
    expect(toggleSortState('date', 'desc', 'name', 'asc')).toEqual({ key: 'name', dir: 'asc' })
  })
})
