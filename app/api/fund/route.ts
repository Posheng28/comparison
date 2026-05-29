import { NextRequest, NextResponse } from 'next/server'
import { ETFS, defById } from '@/lib/fund/sources'
import { loadSnapshot, listPeriods } from '@/lib/fund/store'
import { fundMoves, aggregateMoves, type FundMove } from '@/lib/fund/moves'
import { computeFlow, type EtfSnapshots } from '@/lib/fund/flow'

async function latest(fundId: string) {
  const periods = await listPeriods(fundId, 'etf_daily')
  if (!periods.length) return null
  return loadSnapshot(fundId, 'etf_daily', periods[periods.length - 1])
}

/** 載入所有 ETF 的完整快照序列（由舊到新） */
async function allEtfSnapshots(): Promise<EtfSnapshots[]> {
  const out: EtfSnapshots[] = []
  for (const def of ETFS) {
    const periods = await listPeriods(def.fundId, 'etf_daily')
    if (!periods.length) continue
    const snaps = await Promise.all(
      periods.map(p => loadSnapshot(def.fundId, 'etf_daily', p)),
    )
    const snapshots = snaps.filter((s): s is NonNullable<typeof s> => s !== null)
    if (snapshots.length) out.push({ fundId: def.fundId, snapshots })
  }
  return out
}

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const fundId = sp.get('fund')
  const moves = sp.get('moves')
  const flow = sp.get('flow')

  if (flow) {
    const code = flow.trim().toUpperCase()
    if (!/^\d{4,6}[A-Z]?$/.test(code)) {
      return NextResponse.json({ error: '請輸入台股代號' }, { status: 400 })
    }
    const perEtf = await allEtfSnapshots()
    const series = computeFlow(perEtf, code)
    return NextResponse.json(series)
  }

  if (moves) {
    const perFund: { fundId: string; moves: FundMove[] }[] = []
    let currPeriod = '', prevPeriod = ''

    for (const def of ETFS) {
      const periods = await listPeriods(def.fundId, 'etf_daily')
      if (periods.length < 2) continue
      const cp = periods[periods.length - 1]
      const pp = periods[periods.length - 2]
      if (!currPeriod || cp > currPeriod) { currPeriod = cp; prevPeriod = pp }

      const [curr, prev] = await Promise.all([
        loadSnapshot(def.fundId, 'etf_daily', cp),
        loadSnapshot(def.fundId, 'etf_daily', pp),
      ])
      if (!curr || !prev) continue

      const fm = fundMoves(prev, curr)
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
    const etfDaily = def ? await latest(fundId) : null
    return NextResponse.json({ def, etfDaily })
  }

  return NextResponse.json({ funds: ETFS })
}
