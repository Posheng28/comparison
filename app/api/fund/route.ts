import { NextRequest, NextResponse } from 'next/server'
import { ALL_DEFS, FUNDS, defById } from '@/lib/fund/sources'
import { loadSnapshot, listPeriods } from '@/lib/fund/store'
import { stockDistribution, dualTrack } from '@/lib/fund/query'
import { fundMoves, aggregateMoves } from '@/lib/fund/moves'
import type { FundSnapshot, ReportType } from '@/lib/fund/types'

async function latest(fundId: string, rt: ReportType): Promise<FundSnapshot | null> {
  const periods = await listPeriods(fundId, rt)
  if (!periods.length) return null
  return loadSnapshot(fundId, rt, periods[periods.length - 1])
}

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const fundId = sp.get('fund'), stock = sp.get('stock'), pair = sp.get('pair')
  const moves = sp.get('moves')

  if (moves) {
    const perFund: { fundId: string; moves: ReturnType<typeof fundMoves> }[] = []
    let currPeriod = '', prevPeriod = ''

    for (const def of FUNDS) {
      const periods = await listPeriods(def.fundId, 'monthly_top10')
      if (periods.length < 2) continue
      const cp = periods[periods.length - 1]
      const pp = periods[periods.length - 2]
      if (!currPeriod) { currPeriod = cp; prevPeriod = pp }

      const [currSnap, prevSnap] = await Promise.all([
        loadSnapshot(def.fundId, 'monthly_top10', cp),
        loadSnapshot(def.fundId, 'monthly_top10', pp),
      ])
      if (!currSnap || !prevSnap) continue

      const fm = fundMoves(prevSnap, currSnap)
      if (fm.length) perFund.push({ fundId: def.fundId, moves: fm })
    }

    const agg = aggregateMoves(perFund)

    const up = agg
      .filter(a => a.netCount > 0)
      .sort((a, b) => b.upCount - a.upCount || b.totalDelta - a.totalDelta)
      .slice(0, 40)

    const down = agg
      .filter(a => a.netCount < 0)
      .sort((a, b) => b.downCount - a.downCount || a.totalDelta - b.totalDelta)
      .slice(0, 40)

    return NextResponse.json({ currPeriod, prevPeriod, up, down })
  }

  if (fundId) {
    const def = defById(fundId)
    const monthly = await latest(fundId, 'monthly_top10')
    const quarterly = await latest(fundId, 'quarterly_full')
    const etfDaily = def?.kind === 'etf' ? await latest(fundId, 'etf_daily') : null
    return NextResponse.json({ def, monthly, quarterly, etfDaily })
  }
  if (stock) {
    const all: FundSnapshot[] = []
    for (const d of ALL_DEFS) {
      for (const rt of ['monthly_top10', 'quarterly_full', 'etf_daily'] as ReportType[]) {
        const s = await latest(d.fundId, rt); if (s) all.push(s)
      }
    }
    return NextResponse.json({ stock, distribution: stockDistribution(all, stock) })
  }
  if (pair) {
    const [fId, eId] = pair.split(',')
    const f = await latest(fId, 'monthly_top10'), e = await latest(eId, 'etf_daily')
    return NextResponse.json({ rows: f && e ? dualTrack(f, e) : [] })
  }
  return NextResponse.json({ funds: ALL_DEFS })
}
