import { NextRequest, NextResponse } from 'next/server'
import { ALL_DEFS, defById } from '@/lib/fund/sources'
import { loadSnapshot, listPeriods } from '@/lib/fund/store'
import { stockDistribution, dualTrack } from '@/lib/fund/query'
import type { FundSnapshot, ReportType } from '@/lib/fund/types'

async function latest(fundId: string, rt: ReportType): Promise<FundSnapshot | null> {
  const periods = await listPeriods(fundId, rt)
  if (!periods.length) return null
  return loadSnapshot(fundId, rt, periods[periods.length - 1])
}

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const fundId = sp.get('fund'), stock = sp.get('stock'), pair = sp.get('pair')

  if (fundId) {
    const monthly = await latest(fundId, 'monthly_top10')
    const quarterly = await latest(fundId, 'quarterly_full')
    return NextResponse.json({ def: defById(fundId), monthly, quarterly })
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
