import type { FundSnapshot } from './types'

export interface StockDistRow { fundId: string; reportType: string; period: string; weightPct: number; rank?: number }
export function stockDistribution(snaps: FundSnapshot[], code: string): StockDistRow[] {
  const out: StockDistRow[] = []
  for (const s of snaps) {
    const h = s.holdings.find(x => x.code === code)
    if (h) out.push({ fundId: s.fundId, reportType: s.reportType, period: s.period, weightPct: h.weightPct, rank: h.rank })
  }
  return out.sort((a, b) => b.weightPct - a.weightPct)
}

export interface DualRow { code: string; name: string; fundWeight: number | null; etfWeight: number | null; diff: number | null }
export function dualTrack(fund: FundSnapshot, etf: FundSnapshot): DualRow[] {
  const map = new Map<string, DualRow>()
  for (const h of fund.holdings) map.set(h.code, { code: h.code, name: h.name, fundWeight: h.weightPct, etfWeight: null, diff: null })
  for (const h of etf.holdings) {
    const r = map.get(h.code) ?? { code: h.code, name: h.name, fundWeight: null, etfWeight: null, diff: null }
    r.etfWeight = h.weightPct
    map.set(h.code, r)
  }
  for (const r of map.values()) {
    if (r.fundWeight != null && r.etfWeight != null) r.diff = +(r.fundWeight - r.etfWeight).toFixed(2)
  }
  return [...map.values()].sort((a, b) => (b.fundWeight ?? b.etfWeight ?? 0) - (a.fundWeight ?? a.etfWeight ?? 0))
}
