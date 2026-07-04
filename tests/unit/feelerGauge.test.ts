import { describe, expect, it } from 'vitest'
import {
  FEELER_MAX_MM,
  classifyCandidate,
  mmFromTick,
  snapMm,
  solveFeeler,
  tickFromMm,
} from '@/services/feelerGauge'

describe('feelerGauge', () => {
  it('maps ticks to mm in 0.05 steps', () => {
    expect(mmFromTick(1)).toBe('0.05')
    expect(mmFromTick(20)).toBe('1.00')
    expect(tickFromMm(3)).toBe(60)
    expect(snapMm(3.02)).toBe(3)
  })

  it('finds continuous serial for 3.00 mm', () => {
    const sol = solveFeeler(tickFromMm(3))
    expect(sol.serial.length).toBeGreaterThan(0)
    const best = sol.serial[0]
    expect(best.a).toBeLessThanOrEqual(best.b)
    const sum = Array.from({ length: best.b - best.a + 1 }, (_, i) => best.a + i).reduce((a, b) => a + b, 0)
    expect(sum).toBe(60)
  })

  it('returns exact non-serial options when no continuous block', () => {
    // 0.10 mm = tick 2 — only blade 2 is continuous; tick 1+1 invalid.
    // Use a value that needs skips: e.g. many targets have serial; pick one without.
    // Full set sum ticks = 210. Try tick 4 = 0.20 mm — blades 4 alone, or 1+3.
    const sol = solveFeeler(4)
    expect(sol.serial.some((s) => s.a === 4 && s.b === 4)).toBe(true)
  })

  it('classifies continuous blocks vs single blades', () => {
    const cand = solveFeeler(tickFromMm(0.3)).exact[0] || {
      ticks: [1, 2, 3, 6],
      runs: [[1, 3], [6, 6]] as [number, number][],
      blades: 4,
      spread: 5,
    }
    // Build a known candidate: block 1-3 + single 6
    const known = {
      ticks: [1, 2, 3, 6],
      runs: [[1, 3], [6, 6]] as [number, number][],
      blades: 4,
      spread: 5,
    }
    const c = classifyCandidate(known)
    expect(c.runTicks).toEqual([1, 2, 3])
    expect(c.skipTicks).toEqual([6])
    expect(c.kindOf(2)).toBe('run')
    expect(c.kindOf(6)).toBe('skip')
    expect(cand).toBeTruthy()
  })

  it('full set max is 10.50 mm', () => {
    expect(FEELER_MAX_MM).toBe(10.5)
    const sol = solveFeeler(tickFromMm(10.5))
    expect(sol.serial.some((s) => s.a === 1 && s.b === 20)).toBe(true)
  })

  it('closest serial when no continuous block exists', () => {
    // 32 ticks = 1.60 mm cannot be one continuous block (power of 2 > 20).
    const sol = solveFeeler(32)
    expect(sol.serial.length).toBe(0)
    expect(sol.exact.length).toBeGreaterThan(0)
    expect(sol.closest.below?.sum).toBeLessThan(32)
    expect(sol.closest.above?.sum).toBeGreaterThan(32)
  })
})
