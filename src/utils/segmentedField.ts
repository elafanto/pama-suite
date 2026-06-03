/** Segmented GSTIN (2+5+5+3) and Indian mobile (4+3+3) field helpers. */

export type SegmentKind = 'digits' | 'alnum'

export type SegmentedFieldConfig = {
  lengths: readonly number[]
  kinds: readonly SegmentKind[]
}

export const GSTIN_SEGMENT_LENGTHS = [2, 5, 5, 3] as const
export const MOBILE_SEGMENT_LENGTHS = [4, 3, 3] as const

export const GSTIN_SEGMENT_CONFIG: SegmentedFieldConfig = {
  lengths: GSTIN_SEGMENT_LENGTHS,
  kinds: ['digits', 'alnum', 'alnum', 'alnum'],
}

export const MOBILE_SEGMENT_CONFIG: SegmentedFieldConfig = {
  lengths: MOBILE_SEGMENT_LENGTHS,
  kinds: ['digits', 'digits', 'digits'],
}

const DIGIT_RE = /[0-9]/
const ALNUM_RE = /[A-Z0-9]/

export function totalSegmentLength(config: SegmentedFieldConfig): number {
  return config.lengths.reduce((sum, n) => sum + n, 0)
}

export function splitToSegments(value: string, config: SegmentedFieldConfig): string[] {
  const raw = value.replace(/\s+/g, '').toUpperCase()
  let offset = 0
  return config.lengths.map((len) => {
    const part = raw.slice(offset, offset + len)
    offset += len
    return part
  })
}

export function joinSegments(parts: readonly string[]): string {
  return parts.join('')
}

export function sanitizeChar(ch: string, kind: SegmentKind): string | null {
  const c = ch.toUpperCase()
  if (kind === 'digits') return DIGIT_RE.test(c) ? c : null
  return ALNUM_RE.test(c) ? c : null
}

/** Build a combined value from pasted or typed text, respecting per-segment rules. */
export function sanitizeCombinedInput(text: string, config: SegmentedFieldConfig): string {
  const compact = text.replace(/\s+/g, '').toUpperCase()
  let out = ''
  let segIdx = 0
  let segPos = 0
  for (const ch of compact) {
    while (segIdx < config.lengths.length && segPos >= config.lengths[segIdx]) {
      segIdx++
      segPos = 0
    }
    if (segIdx >= config.lengths.length) break
    const accepted = sanitizeChar(ch, config.kinds[segIdx])
    if (accepted) {
      out += accepted
      segPos++
    }
  }
  return out.slice(0, totalSegmentLength(config))
}

export function filterSegmentValue(
  raw: string,
  kind: SegmentKind,
  maxLen: number,
): { value: string; rejected: string } {
  let value = ''
  let rejected = ''
  for (const ch of raw.toUpperCase()) {
    const accepted = sanitizeChar(ch, kind)
    if (accepted && value.length < maxLen) value += accepted
    else if (!accepted) rejected += ch
  }
  return { value, rejected }
}

export function invalidCharMessage(rejected: string, kind: SegmentKind): string {
  if (!rejected) return ''
  const sample = [...new Set(rejected)].slice(0, 3).join('')
  if (kind === 'digits') {
    return `Invalid character${rejected.length > 1 ? 's' : ''} “${sample}” — use digits 0–9 only`
  }
  return `Invalid character${rejected.length > 1 ? 's' : ''} “${sample}” — use A–Z and 0–9 only`
}
