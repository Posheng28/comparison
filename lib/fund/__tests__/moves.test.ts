import { describe, it, expect } from 'vitest'
import { fundMoves, aggregateMoves } from '../moves'
import type { FundSnapshot } from '../types'

// Real fixtures — copied from data/funds/uni-allweather/monthly_top10_2026-03.json
// and monthly_top10_2026-04.json. ALL values below were observed/computed from those files.
import prevSnap from './fixtures/moves-prev.json'
import currSnap from './fixtures/moves-curr.json'

const prev = prevSnap as unknown as FundSnapshot
const curr = currSnap as unknown as FundSnapshot

describe('fundMoves — real uni-allweather 2026-03 → 2026-04', () => {
  const moves = fundMoves(prev, curr)

  it('returns a non-empty array', () => {
    expect(moves.length).toBeGreaterThan(0)
  })

  it('2308 台達電: add, delta=0.56', () => {
    const m = moves.find(m => m.code === '2308')!
    expect(m).toBeDefined()
    expect(m.delta).toBe(0.56)
    expect(m.kind).toBe('add')
    expect(m.prevWeight).toBe(8.12)
    expect(m.currWeight).toBe(8.68)
  })

  it('2330 台積電: reduce, delta=-0.40', () => {
    const m = moves.find(m => m.code === '2330')!
    expect(m).toBeDefined()
    expect(m.delta).toBe(-0.4)
    expect(m.kind).toBe('reduce')
    expect(m.prevWeight).toBe(7.48)
    expect(m.currWeight).toBe(7.08)
  })

  it('2383 台光電: add, delta=1.59', () => {
    const m = moves.find(m => m.code === '2383')!
    expect(m).toBeDefined()
    expect(m.delta).toBe(1.59)
    expect(m.kind).toBe('add')
  })

  it('3037 欣興: add, delta=2.22', () => {
    const m = moves.find(m => m.code === '3037')!
    expect(m).toBeDefined()
    expect(m.delta).toBe(2.22)
    expect(m.kind).toBe('add')
  })

  it('8046 南電: enter (only in curr), prevWeight=0, delta=3.75', () => {
    const m = moves.find(m => m.code === '8046')!
    expect(m).toBeDefined()
    expect(m.kind).toBe('enter')
    expect(m.prevWeight).toBe(0)
    expect(m.currWeight).toBe(3.75)
    expect(m.delta).toBe(3.75)
  })

  it('2345 智邦: exit (only in prev), currWeight=0, delta=-3.49', () => {
    const m = moves.find(m => m.code === '2345')!
    expect(m).toBeDefined()
    expect(m.kind).toBe('exit')
    expect(m.prevWeight).toBe(3.49)
    expect(m.currWeight).toBe(0)
    expect(m.delta).toBe(-3.49)
  })

  it('no move emitted when weight unchanged (no unchanged stocks in this pair → confirms omit logic via synthetic)', () => {
    // synthetic: same weight in both → should be omitted
    const fakePrev: FundSnapshot = {
      fundId: 'x', reportType: 'monthly_top10', period: '2026-03', source: 't', fetchedAt: '',
      holdings: [{ code: '1111', name: 'AA', weightPct: 5.0 }, { code: '2222', name: 'BB', weightPct: 3.0 }],
    }
    const fakeCurr: FundSnapshot = {
      fundId: 'x', reportType: 'monthly_top10', period: '2026-04', source: 't', fetchedAt: '',
      holdings: [{ code: '1111', name: 'AA', weightPct: 5.0 }, { code: '2222', name: 'BB', weightPct: 4.0 }],
    }
    const result = fundMoves(fakePrev, fakeCurr)
    // 1111 unchanged → omitted; 2222 changed → included
    expect(result.find(m => m.code === '1111')).toBeUndefined()
    expect(result.find(m => m.code === '2222')).toBeDefined()
    expect(result.find(m => m.code === '2222')!.kind).toBe('add')
  })

  it('total move count matches real observed changes (11 stocks changed)', () => {
    // From the two snapshots: 9 stocks in both with weight changes + 1 exit (2345) + 1 enter (8046) = 11
    expect(moves).toHaveLength(11)
  })
})

describe('aggregateMoves — synthetic multi-fund logic', () => {
  // Build two small synthetic move sets to test grouping/counting
  // fund1: 2330 add, 2382 enter
  // fund2: 2330 reduce, 2382 enter
  const movesF1 = [
    { code: '2330', name: '台積電', prevWeight: 7.0, currWeight: 8.0, delta: 1.0, kind: 'add' as const },
    { code: '2382', name: '廣達',   prevWeight: 0,   currWeight: 5.0, delta: 5.0, kind: 'enter' as const },
  ]
  const movesF2 = [
    { code: '2330', name: '台積電', prevWeight: 9.0, currWeight: 8.0, delta: -1.0, kind: 'reduce' as const },
    { code: '2382', name: '廣達',   prevWeight: 0,   currWeight: 3.0, delta: 3.0,  kind: 'enter' as const },
    { code: '3034', name: '聯詠',   prevWeight: 4.0, currWeight: 0,   delta: -4.0, kind: 'exit' as const },
  ]

  const agg = aggregateMoves([
    { fundId: 'fund1', moves: movesF1 },
    { fundId: 'fund2', moves: movesF2 },
  ])

  it('2330: addFunds=[fund1], reduceFunds=[fund2], upCount=1, downCount=1, netCount=0, totalDelta=0', () => {
    const s = agg.find(a => a.code === '2330')!
    expect(s).toBeDefined()
    expect(s.addFunds).toContain('fund1')
    expect(s.reduceFunds).toContain('fund2')
    expect(s.upCount).toBe(1)
    expect(s.downCount).toBe(1)
    expect(s.netCount).toBe(0)
    expect(s.totalDelta).toBe(0)
  })

  it('2382: enterFunds=[fund1,fund2], upCount=2, downCount=0, netCount=2, totalDelta=8', () => {
    const s = agg.find(a => a.code === '2382')!
    expect(s).toBeDefined()
    expect(s.enterFunds).toContain('fund1')
    expect(s.enterFunds).toContain('fund2')
    expect(s.upCount).toBe(2)
    expect(s.downCount).toBe(0)
    expect(s.netCount).toBe(2)
    expect(s.totalDelta).toBe(8)
  })

  it('3034: exitFunds=[fund2], downCount=1, upCount=0, netCount=-1, totalDelta=-4', () => {
    const s = agg.find(a => a.code === '3034')!
    expect(s).toBeDefined()
    expect(s.exitFunds).toContain('fund2')
    expect(s.downCount).toBe(1)
    expect(s.upCount).toBe(0)
    expect(s.netCount).toBe(-1)
    expect(s.totalDelta).toBe(-4)
  })

  it('totalDelta is rounded to 2dp', () => {
    const movesF3 = [
      { code: '9999', name: 'Test', prevWeight: 1.001, currWeight: 2.004, delta: 1.003, kind: 'add' as const },
    ]
    const movesF4 = [
      { code: '9999', name: 'Test', prevWeight: 2.0, currWeight: 3.006, delta: 1.006, kind: 'add' as const },
    ]
    const result = aggregateMoves([
      { fundId: 'fx', moves: movesF3 },
      { fundId: 'fy', moves: movesF4 },
    ])
    const s = result.find(a => a.code === '9999')!
    // 1.003 + 1.006 = 2.009 → round2 = 2.01
    expect(s.totalDelta).toBe(2.01)
  })
})
