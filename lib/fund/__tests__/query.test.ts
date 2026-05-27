import { describe, it, expect } from 'vitest'
import { stockDistribution, dualTrack } from '../query'
import type { FundSnapshot } from '../types'

const snaps: FundSnapshot[] = [
  { fundId: 'uni-benteng', reportType: 'monthly_top10', period: '2026-04', source: 's', fetchedAt: '', holdings: [{ code: '2330', name: '台積電', weightPct: 7.24, rank: 5 }] },
  { fundId: '00981A', reportType: 'etf_daily', period: '2026-04-30', source: 's', fetchedAt: '', holdings: [{ code: '2330', name: '台積電', weightPct: 9.11 }] },
]

describe('query', () => {
  it('stockDistribution 列出持有某股的所有基金與權重', () => {
    const d = stockDistribution(snaps, '2330')
    expect(d).toHaveLength(2)
    expect(d.find(x => x.fundId === '00981A')?.weightPct).toBe(9.11)
  })
  it('dualTrack 配對同股票、算權重差', () => {
    const r = dualTrack(snaps[0], snaps[1])
    const row = r.find(x => x.code === '2330')!
    expect(row.fundWeight).toBe(7.24)
    expect(row.etfWeight).toBe(9.11)
    expect(row.diff).toBeCloseTo(-1.87, 2)
  })
})
