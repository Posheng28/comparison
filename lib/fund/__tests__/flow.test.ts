import { describe, it, expect } from 'vitest'
import { computeFlow, type EtfSnapshots } from '../flow'
import type { FundSnapshot } from '../types'

function snap(fundId: string, period: string, holdings: { code: string; shares: number }[]): FundSnapshot {
  return {
    fundId,
    reportType: 'etf_daily',
    period,
    source: 'test',
    fetchedAt: '',
    holdings: holdings.map((h, i) => ({ code: h.code, name: `name-${h.code}`, weightPct: 0, shares: h.shares, rank: i + 1 })),
  }
}

describe('computeFlow — single ETF', () => {
  const perEtf: EtfSnapshots[] = [
    {
      fundId: 'A',
      snapshots: [
        snap('A', '2026-01-01', [{ code: '2330', shares: 1000 }]),
        snap('A', '2026-01-02', [{ code: '2330', shares: 1500 }]), // +500
        snap('A', '2026-01-03', [{ code: '2330', shares: 1200 }]), // -300
      ],
    },
  ]

  const series = computeFlow(perEtf, '2330')

  it('first snapshot does not count as a move', () => {
    expect(series.points.find(p => p.date === '2026-01-01')).toBeUndefined()
  })

  it('day 2: +500 add', () => {
    const p = series.points.find(p => p.date === '2026-01-02')!
    expect(p.netShares).toBe(500)
    expect(p.addShares).toBe(500)
    expect(p.reduceShares).toBe(0)
  })

  it('day 3: -300 reduce', () => {
    const p = series.points.find(p => p.date === '2026-01-03')!
    expect(p.netShares).toBe(-300)
    expect(p.reduceShares).toBe(-300)
  })

  it('captures name and coverage', () => {
    expect(series.name).toBe('name-2330')
    expect(series.etfsCovered).toEqual(['A'])
  })
})

describe('computeFlow — multi ETF aggregation + enter/exit as 0', () => {
  const perEtf: EtfSnapshots[] = [
    {
      fundId: 'A',
      snapshots: [
        snap('A', '2026-01-01', [{ code: '2330', shares: 1000 }]),
        snap('A', '2026-01-02', [{ code: '2330', shares: 2000 }]), // +1000
      ],
    },
    {
      fundId: 'B',
      snapshots: [
        snap('B', '2026-01-01', []),                               // not held → 0
        snap('B', '2026-01-02', [{ code: '2330', shares: 300 }]),  // enter: 0 -> 300 = +300
      ],
    },
  ]

  const series = computeFlow(perEtf, '2330')

  it('aggregates both ETFs on same date', () => {
    const p = series.points.find(p => p.date === '2026-01-02')!
    expect(p.netShares).toBe(1300)
    expect(p.contributors).toHaveLength(2)
  })

  it('contributors sorted by magnitude', () => {
    const p = series.points.find(p => p.date === '2026-01-02')!
    expect(p.contributors[0].fundId).toBe('A')
    expect(p.contributors[0].delta).toBe(1000)
  })

  it('both ETFs covered', () => {
    expect(series.etfsCovered).toEqual(['A', 'B'])
  })
})

describe('computeFlow — shares-less snapshots are ignored (no phantom swings)', () => {
  // 模擬「舊的無股數快照」混入「有股數快照」：無股數那筆必須被剔除，
  // 否則 sharesOf 全回 0 會產生假的「全出再全進」尖刺。
  function sharelessSnap(fundId: string, period: string, codes: string[]): FundSnapshot {
    return {
      fundId,
      reportType: 'etf_daily',
      period,
      source: 'moneydj-legacy',
      fetchedAt: '',
      holdings: codes.map((code, i) => ({ code, name: `name-${code}`, weightPct: 0, rank: i + 1 })),
    }
  }

  const perEtf: EtfSnapshots[] = [
    {
      fundId: 'A',
      snapshots: [
        sharelessSnap('A', '2026-01-01', ['2330']),               // 無股數 → 剔除
        snap('A', '2026-01-02', [{ code: '2330', shares: 1000 }]),// 首個有股數快照
        snap('A', '2026-01-03', [{ code: '2330', shares: 1200 }]),// +200
      ],
    },
  ]

  const series = computeFlow(perEtf, '2330')

  it('does not emit a phantom point on the shares-less→shares transition', () => {
    expect(series.points.find(p => p.date === '2026-01-02')).toBeUndefined()
  })

  it('still computes deltas between the shares-bearing snapshots', () => {
    const p = series.points.find(p => p.date === '2026-01-03')!
    expect(p.netShares).toBe(200)
  })
})

describe('computeFlow — stock absent from snapshots without shares field', () => {
  const perEtf: EtfSnapshots[] = [
    {
      fundId: 'A',
      snapshots: [
        snap('A', '2026-01-01', [{ code: '9999', shares: 100 }]),
        snap('A', '2026-01-02', [{ code: '9999', shares: 100 }]), // unchanged → no point
      ],
    },
  ]

  it('zero-delta days emit no points', () => {
    const series = computeFlow(perEtf, '9999')
    expect(series.points).toHaveLength(0)
    expect(series.etfsCovered).toHaveLength(0)
  })

  it('unknown code yields empty series', () => {
    const series = computeFlow(perEtf, '0000')
    expect(series.points).toHaveLength(0)
    expect(series.name).toBe('')
  })
})
