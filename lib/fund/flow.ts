import type { FundSnapshot } from './types'

// 個股「主動 ETF 流向指標」聚合。
// 對單一股票，計算每個交易日跨所有主動式 ETF 的淨持股股數變動：
//   - 每檔 ETF 比較自己「相鄰兩個快照」的股數差（後一日 - 前一日）
//   - 該檔股票若不在某日持股清單中，視為 0 股
//   - delta 歸屬於「後一個快照日」
//   - 跨 ETF 在同一日加總
// 慣例：紅(up)=加碼(正)、綠(down)=減碼(負)，與台股漲跌色一致。

interface FlowContributor {
  fundId: string
  delta: number   // 該 ETF 當日股數變動（+加碼 / -減碼）
}

interface FlowPoint {
  date: string            // 變動發生日（後一個快照日，YYYY-MM-DD）
  netShares: number       // 跨 ETF 淨變動股數
  addShares: number       // 當日加碼總股數（>= 0）
  reduceShares: number    // 當日減碼總股數（<= 0）
  contributors: FlowContributor[]
}

export interface FlowSeries {
  code: string
  name: string
  points: FlowPoint[]     // 由舊到新
  etfsCovered: string[]   // 有貢獻資料的 ETF 代號
}

/** 一檔 ETF 的快照序列（period 由舊到新） */
export interface EtfSnapshots {
  fundId: string
  snapshots: FundSnapshot[]
}

/** 取某快照中某股票的持股股數；不在清單或無股數欄位回 0 */
function sharesOf(snap: FundSnapshot, code: string): number {
  const h = snap.holdings.find(x => x.code === code)
  if (!h) return 0
  return typeof h.shares === 'number' && !Number.isNaN(h.shares) ? h.shares : 0
}

/**
 * 此快照是否為「無股數快照」：有持股清單、但沒有任何一筆帶股數。
 * 這類資料來自早期未抓股數的舊來源；若混入流向計算會讓 sharesOf 全回 0，
 * 造成假的「全出 → 全進」尖刺，故一律剔除。
 * 注意：空持股快照（length 0，例：非交易日 / 確實未持有）不算無股數，予以保留。
 */
function isSharelessSnapshot(snap: FundSnapshot): boolean {
  return (
    snap.holdings.length > 0 &&
    !snap.holdings.some(
      h => typeof h.shares === 'number' && !Number.isNaN(h.shares),
    )
  )
}

/** 取某快照中某股票的名稱（用於顯示） */
function nameOf(snap: FundSnapshot, code: string): string | null {
  return snap.holdings.find(x => x.code === code)?.name ?? null
}

/**
 * 純函式：給定各 ETF 的快照序列與股票代號，算出跨 ETF 的每日流向序列。
 * 僅納入「相鄰快照」的變動，首個快照不計（不把建倉初始部位算成加碼）。
 */
export function computeFlow(perEtf: EtfSnapshots[], code: string): FlowSeries {
  const byDate = new Map<string, FlowPoint>()
  const covered = new Set<string>()
  let name = ''

  for (const { fundId, snapshots } of perEtf) {
    // 只保留帶股數的快照——剔除無股數舊快照可避免假的進出尖刺，
    // 並確保同一檔 ETF 的流向序列來自一致的（有股數）資料。
    const sorted = [...snapshots]
      .filter(s => !isSharelessSnapshot(s))
      .sort((a, b) => (a.period < b.period ? -1 : 1))
    let prevShares: number | null = null

    for (const snap of sorted) {
      if (!name) {
        const n = nameOf(snap, code)
        if (n) name = n
      }
      const curr = sharesOf(snap, code)

      if (prevShares !== null) {
        const delta = curr - prevShares
        if (delta !== 0) {
          covered.add(fundId)
          let pt = byDate.get(snap.period)
          if (!pt) {
            pt = { date: snap.period, netShares: 0, addShares: 0, reduceShares: 0, contributors: [] }
            byDate.set(snap.period, pt)
          }
          pt.netShares += delta
          if (delta > 0) pt.addShares += delta
          else pt.reduceShares += delta
          pt.contributors.push({ fundId, delta })
        }
      }
      prevShares = curr
    }
  }

  const points = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
  for (const pt of points) {
    pt.contributors.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  }

  return {
    code,
    name,
    points,
    etfsCovered: [...covered].sort(),
  }
}
