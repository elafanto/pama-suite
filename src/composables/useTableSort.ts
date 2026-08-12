import { computed, ref, type Ref } from 'vue'

export type SortDir = 'asc' | 'desc'

export function compareSortValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1

  if (typeof a === 'number' && typeof b === 'number') {
    return a - b
  }

  const as = String(a)
  const bs = String(b)
  const an = Number(as)
  const bn = Number(bs)
  if (as !== '' && bs !== '' && Number.isFinite(an) && Number.isFinite(bn) && /^-?\d+(\.\d+)?$/.test(as) && /^-?\d+(\.\d+)?$/.test(bs)) {
    return an - bn
  }

  return as.localeCompare(bs, undefined, { numeric: true, sensitivity: 'base' })
}

export function sortRowsBy<T>(
  rows: T[],
  getValue: (row: T) => unknown,
  dir: SortDir,
): T[] {
  const mult = dir === 'asc' ? 1 : -1
  return [...rows].sort((ra, rb) => mult * compareSortValues(getValue(ra), getValue(rb)))
}

export function toggleSortState<K extends string>(
  currentKey: K,
  currentDir: SortDir,
  nextKey: K,
  defaultDir: SortDir = 'asc',
): { key: K; dir: SortDir } {
  if (currentKey === nextKey) {
    return { key: nextKey, dir: currentDir === 'asc' ? 'desc' : 'asc' }
  }
  return { key: nextKey, dir: defaultDir }
}

/** Clickable column-header sort for list tables. */
export function useTableSort<K extends string>(defaultKey: K, defaultDir: SortDir = 'asc') {
  const sortKey = ref(defaultKey) as Ref<K>
  const sortDir = ref<SortDir>(defaultDir)

  function toggle(key: K, firstDir: SortDir = 'asc') {
    const next = toggleSortState(sortKey.value, sortDir.value, key, firstDir)
    sortKey.value = next.key
    sortDir.value = next.dir
  }

  function indicator(key: K): string {
    if (sortKey.value !== key) return ''
    return sortDir.value === 'asc' ? ' ▲' : ' ▼'
  }

  function thClass(key: K, align: 'left' | 'right' | 'center' = 'left'): string {
    const base =
      align === 'right'
        ? 'text-right'
        : align === 'center'
          ? 'text-center'
          : 'text-left'
    const active = sortKey.value === key ? ' text-navy' : ''
    return `${base} cursor-pointer select-none hover:text-navy${active}`
  }

  function sorted<T>(rows: T[] | undefined | null, getters: Record<K, (row: T) => unknown>) {
    return computed(() => {
      const list = rows ? [...rows] : []
      const getter = getters[sortKey.value]
      if (!getter) return list
      return sortRowsBy(list, getter, sortDir.value)
    })
  }

  /** Sort a reactive/computed source list. */
  function sortedFrom<T>(
    source: { value: T[] } | (() => T[]),
    getters: Record<K, (row: T) => unknown>,
  ) {
    return computed(() => {
      const list = typeof source === 'function' ? source() : source.value
      const getter = getters[sortKey.value]
      if (!getter) return [...list]
      return sortRowsBy(list, getter, sortDir.value)
    })
  }

  return { sortKey, sortDir, toggle, indicator, thClass, sorted, sortedFrom }
}
