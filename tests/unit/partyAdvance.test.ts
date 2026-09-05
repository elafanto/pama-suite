import { describe, expect, it } from 'vitest'
import {
  allocateAdvanceFifo,
  applySlicesToAdvance,
  openPartyAdvances,
  partyAdvanceStatus,
  totalOpenAdvance,
} from '@/services/partyAdvance'
import type { PartyAdvance } from '@/types/models'

function adv(partial: Partial<PartyAdvance> & Pick<PartyAdvance, 'id' | 'amount' | 'remaining'>): PartyAdvance {
  return {
    firm_id: 'f1',
    party_id: 'p1',
    party_name: 'Buyer Co',
    direction: 'in',
    date: '2026-08-01',
    mode: 'bank',
    narration: '',
    status: partyAdvanceStatus(partial.amount, partial.remaining),
    applications: [],
    is_deleted: false,
    created_at: '',
    updated_at: '',
    ...partial,
  } as PartyAdvance
}

describe('partyAdvance math', () => {
  it('computes status from remaining', () => {
    expect(partyAdvanceStatus(1000, 1000)).toBe('open')
    expect(partyAdvanceStatus(1000, 400)).toBe('partial')
    expect(partyAdvanceStatus(1000, 0)).toBe('applied')
  })

  it('lists open advances FIFO by date', () => {
    const list = [
      adv({ id: 'a2', date: '2026-08-10', amount: 500, remaining: 500 }),
      adv({ id: 'a1', date: '2026-08-01', amount: 300, remaining: 300 }),
      adv({ id: 'a3', date: '2026-08-05', amount: 200, remaining: 0, status: 'applied' }),
    ]
    const open = openPartyAdvances(list, 'p1', 'Buyer Co', 'in')
    expect(open.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(totalOpenAdvance(list, 'p1', 'Buyer Co', 'in')).toBe(800)
  })

  it('allocates FIFO across advances', () => {
    const open = [
      adv({ id: 'a1', amount: 300, remaining: 300 }),
      adv({ id: 'a2', amount: 500, remaining: 500 }),
    ]
    expect(allocateAdvanceFifo(open, 450)).toEqual([
      { advanceId: 'a1', amount: 300 },
      { advanceId: 'a2', amount: 150 },
    ])
  })

  it('updates remaining and applications after apply slices', () => {
    const a = adv({ id: 'a1', amount: 1000, remaining: 1000 })
    const next = applySlicesToAdvance(a, [{
      amount: 400,
      bill_id: 'inv1',
      bill_kind: 'invoice',
      bill_no: 'INV-1',
      date: '2026-09-01',
    }])
    expect(next.remaining).toBe(600)
    expect(next.status).toBe('partial')
    expect(next.applications).toHaveLength(1)
    expect(next.applications[0].bill_no).toBe('INV-1')
  })
})
