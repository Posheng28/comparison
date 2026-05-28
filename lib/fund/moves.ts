import type { FundSnapshot } from './types'

export type MoveKind = 'add' | 'reduce' | 'enter' | 'exit'

export interface FundMove {
  code: string
  name: string
  prevWeight: number
  currWeight: number
  delta: number
  kind: MoveKind
}

export interface StockAgg {
  code: string
  name: string
  addFunds: string[]
  reduceFunds: string[]
  enterFunds: string[]
  exitFunds: string[]
  upCount: number    // addFunds + enterFunds count
  downCount: number  // reduceFunds + exitFunds count
  netCount: number   // upCount - downCount
  totalDelta: number // sum of deltas across funds (2dp)
}

function round2(x: number): number {
  return Math.round(x * 100) / 100
}

export function fundMoves(prev: FundSnapshot, curr: FundSnapshot): FundMove[] {
  const pm = new Map<string, { name: string; weight: number }>()
  const cm = new Map<string, { name: string; weight: number }>()

  for (const h of prev.holdings) pm.set(h.code, { name: h.name, weight: h.weightPct })
  for (const h of curr.holdings) cm.set(h.code, { name: h.name, weight: h.weightPct })

  const codes = new Set([...pm.keys(), ...cm.keys()])
  const result: FundMove[] = []

  for (const code of codes) {
    const pw = pm.get(code)?.weight ?? 0
    const cw = cm.get(code)?.weight ?? 0
    const delta = round2(cw - pw)

    if (delta === 0) continue

    const name = cm.get(code)?.name ?? pm.get(code)?.name ?? ''

    let kind: MoveKind
    if (pw === 0 && cw > 0) {
      kind = 'enter'
    } else if (cw === 0 && pw > 0) {
      kind = 'exit'
    } else if (delta > 0) {
      kind = 'add'
    } else {
      kind = 'reduce'
    }

    result.push({ code, name, prevWeight: pw, currWeight: cw, delta, kind })
  }

  return result
}

export function aggregateMoves(
  perFund: { fundId: string; moves: FundMove[] }[]
): StockAgg[] {
  const map = new Map<string, StockAgg>()

  for (const { fundId, moves } of perFund) {
    for (const move of moves) {
      if (!map.has(move.code)) {
        map.set(move.code, {
          code: move.code,
          name: move.name || '',
          addFunds: [],
          reduceFunds: [],
          enterFunds: [],
          exitFunds: [],
          upCount: 0,
          downCount: 0,
          netCount: 0,
          totalDelta: 0,
        })
      }
      const agg = map.get(move.code)!
      if (!agg.name && move.name) agg.name = move.name

      switch (move.kind) {
        case 'add':    agg.addFunds.push(fundId);    break
        case 'reduce': agg.reduceFunds.push(fundId); break
        case 'enter':  agg.enterFunds.push(fundId);  break
        case 'exit':   agg.exitFunds.push(fundId);   break
      }
    }
  }

  const result: StockAgg[] = []
  for (const agg of map.values()) {
    agg.upCount   = agg.addFunds.length   + agg.enterFunds.length
    agg.downCount = agg.reduceFunds.length + agg.exitFunds.length
    agg.netCount  = agg.upCount - agg.downCount
    const rawTotal = [...perFund].flatMap(({ moves }) =>
      moves.filter(m => m.code === agg.code).map(m => m.delta)
    ).reduce((sum, d) => sum + d, 0)
    agg.totalDelta = round2(rawTotal)
    result.push(agg)
  }

  return result
}
