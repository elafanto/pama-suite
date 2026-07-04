/** Feeler gauge set: blades 1..20 where 1 tick = 0.05 mm (full set = 10.50 mm). */

export const FEELER_BLADE_COUNT = 20
export const FEELER_TICK_MM = 0.05
export const FEELER_MIN_MM = FEELER_TICK_MM
export const FEELER_MAX_MM = FEELER_BLADE_COUNT * (FEELER_BLADE_COUNT + 1) * FEELER_TICK_MM / 2

export type FeelerRun = [number, number]

export interface FeelerSerialOption {
  a: number
  b: number
  count: number
}

export interface FeelerExactCandidate {
  ticks: number[]
  runs: FeelerRun[]
  blades: number
  spread: number
}

export interface FeelerBlockSum {
  a: number
  b: number
  sum: number
}

export interface FeelerSolveResult {
  serial: FeelerSerialOption[]
  exact: FeelerExactCandidate[]
  closest: { below: FeelerBlockSum | null; above: FeelerBlockSum | null }
}

export function mmFromTick(tick: number): string {
  return (tick * FEELER_TICK_MM).toFixed(2)
}

export function tickFromMm(mm: number): number {
  return Math.round(mm / FEELER_TICK_MM)
}

export function snapMm(mm: number): number {
  return +(tickFromMm(mm) * FEELER_TICK_MM).toFixed(2)
}

export function rangeArr(a: number, b: number): number[] {
  const r: number[] = []
  for (let i = a; i <= b; i++) r.push(i)
  return r
}

function contiguousExact(T: number): FeelerRun[] {
  const res: FeelerRun[] = []
  for (let a = 1; a <= FEELER_BLADE_COUNT; a++) {
    let s = 0
    for (let b = a; b <= FEELER_BLADE_COUNT; b++) {
      s += b
      if (s === T) res.push([a, b])
      if (s >= T) break
    }
  }
  return res
}

function allBlockSums(): FeelerBlockSum[] {
  const r: FeelerBlockSum[] = []
  for (let a = 1; a <= FEELER_BLADE_COUNT; a++) {
    let s = 0
    for (let b = a; b <= FEELER_BLADE_COUNT; b++) {
      s += b
      r.push({ a, b, sum: s })
    }
  }
  return r
}

export function runsOf(ticks: number[]): FeelerRun[] {
  const runs: FeelerRun[] = []
  let st: number | null = null
  let pr: number | null = null
  for (const t of ticks) {
    if (st === null) {
      st = t
      pr = t
    } else if (t === (pr as number) + 1) {
      pr = t
    } else {
      runs.push([st, pr as number])
      st = t
      pr = t
    }
  }
  if (st !== null) runs.push([st, pr as number])
  return runs
}

export function exactCandidates(T: number): FeelerExactCandidate[] {
  const seen = new Map<string, FeelerExactCandidate>()

  const add = (arr: number[]) => {
    const ticks = [...arr].sort((x, y) => x - y)
    if (ticks.reduce((a, b) => a + b, 0) !== T) return
    if (new Set(ticks).size !== ticks.length) return
    const key = ticks.join(',')
    if (seen.has(key)) return
    const runs = runsOf(ticks)
    seen.set(key, {
      ticks,
      runs,
      blades: ticks.length,
      spread: ticks[ticks.length - 1] - ticks[0],
    })
  }

  for (const [a, b] of contiguousExact(T)) add(rangeArr(a, b))

  for (let a1 = 1; a1 <= FEELER_BLADE_COUNT; a1++) {
    let s1 = 0
    for (let b1 = a1; b1 <= FEELER_BLADE_COUNT; b1++) {
      s1 += b1
      if (s1 >= T) break
      for (let a2 = b1 + 2; a2 <= FEELER_BLADE_COUNT; a2++) {
        let s2 = 0
        for (let b2 = a2; b2 <= FEELER_BLADE_COUNT; b2++) {
          s2 += b2
          if (s1 + s2 === T) add([...rangeArr(a1, b1), ...rangeArr(a2, b2)])
          if (s1 + s2 >= T) break
        }
      }
    }
  }

  for (let a = 1; a <= FEELER_BLADE_COUNT; a++) {
    let s = 0
    for (let b = a; b <= FEELER_BLADE_COUNT; b++) {
      s += b
      if (s >= T) break
      const R = T - s
      for (let x = 1; x <= FEELER_BLADE_COUNT; x++) {
        if (x >= a && x <= b) continue
        const y = R - x
        if (y <= x || y > FEELER_BLADE_COUNT) continue
        if (y >= a && y <= b) continue
        add([...rangeArr(a, b), x, y])
      }
    }
  }

  return [...seen.values()].sort(
    (p, q) => p.runs.length - q.runs.length || p.blades - q.blades || p.spread - q.spread,
  )
}

function closestSerial(T: number): { below: FeelerBlockSum | null; above: FeelerBlockSum | null } {
  let below: FeelerBlockSum | null = null
  let above: FeelerBlockSum | null = null
  for (const s of allBlockSums()) {
    const len = s.b - s.a
    if (s.sum < T && (!below || s.sum > below.sum || (s.sum === below.sum && len < below.b - below.a))) {
      below = s
    }
    if (s.sum > T && (!above || s.sum < above.sum || (s.sum === above.sum && len < above.b - above.a))) {
      above = s
    }
  }
  return { below, above }
}

export function solveFeeler(T: number): FeelerSolveResult {
  const serial = contiguousExact(T)
    .map(([a, b]) => ({ a, b, count: b - a + 1 }))
    .sort((p, q) => p.count - q.count)
  return {
    serial,
    exact: exactCandidates(T),
    closest: closestSerial(T),
  }
}

export function classifyCandidate(cand: FeelerExactCandidate): {
  runTicks: number[]
  skipTicks: number[]
  kindOf: (t: number) => 'run' | 'skip'
} {
  const isBlock = new Set<number>()
  for (const [a, b] of cand.runs) {
    if (b > a) for (let i = a; i <= b; i++) isBlock.add(i)
  }
  return {
    runTicks: cand.ticks.filter((t) => isBlock.has(t)),
    skipTicks: cand.ticks.filter((t) => !isBlock.has(t)),
    kindOf: (t) => (isBlock.has(t) ? 'run' : 'skip'),
  }
}

export function runLabel(runs: FeelerRun[]): string {
  return runs.map(([a, b]) => (a === b ? mmFromTick(a) : `${mmFromTick(a)}–${mmFromTick(b)}`)).join('  +  ')
}

export function isFeelerInRange(T: number): boolean {
  return T >= 1 && T <= tickFromMm(FEELER_MAX_MM)
}
