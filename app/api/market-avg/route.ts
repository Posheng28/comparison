import { NextRequest, NextResponse } from 'next/server'
import { getCached, setCached } from '@/lib/cache'
import { loadSnapshot, saveSnapshot, pruneExcept } from '@/lib/marketStore'

// 全體有價證券「已知部分累積漲跌% 的簡單算術平均」(分上市/上櫃)。
// 用途：注意標準款一「差幅 ≥ 20%」的比較基底（個股漲幅 − 全體平均）。
//
// 窗口定義（重要）：
//  注意判定窗口 =「最近 6 個營業日(含當日)累積之最後成交價漲跌%」。
//  累積「基準」= 該 6 日區間之前一交易日收盤（例：判定 5/25 → 基準 = 5/15 收盤）。
//  完整 6 日 = 基準(5/15) → 5/18,19,20,21,22 → 當日(5/25)，共 6 個漲跌間隔。
//  其中「當日(5/25)」要收盤才知道、且是唯一變數；前面 5 個間隔(基準→最近收盤日)全部已知。
//  故本 API 算「已知部分」= 基準收盤(5/15) → 最近收盤日(5/22) 的累積(5 個間隔)；
//  判定當日注意時，再把「當日」全市場漲跌併為第 6 個間隔。
//  明天 5/25 收盤後，窗口自動滾成 基準 5/18 → 最近 5/25。
//
// 演算法：
//  1. 由今日往回找出最近 6 個已收盤交易日（含基準日；非交易日資料源回空 → 跳過，自動避開假日）。
//  2. 每個交易日抓全市場「當日漲跌幅%」快照（已存則略過），存檔並修剪到只留這 6 天。
//  3. 6 個交易日 = 5 個間隔；逐檔將各日漲跌幅「相加」= 該檔已知累積漲跌%
//     （法規：累積漲跌% = 各營業日漲跌%之和，非收盤比值/連乘）。
//  4. 對全市場「整段都有交易」的股票取簡單(等權)算術平均。

const WINDOW = 6 // 含基準日的已收盤交易日數 → 5 個已知間隔；第 6 個間隔=當日(變數)另外併入

const pad = (n: number) => String(n).padStart(2, '0')
const toYMD   = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
const toSlash = (ymd: string) => `${ymd.slice(0, 4)}/${ymd.slice(4, 6)}/${ymd.slice(6, 8)}`
const parseNum = (s: unknown): number | null => {
  const n = parseFloat(String(s).replace(/,/g, ''))
  return isNaN(n) ? null : n
}
// 只取普通股 4 位數且非 0 開頭（排除 00xx ETF / 6 位數 ETN / 特別股如 2887B）
const isOrdinary = (code: string) => /^[1-9]\d{3}$/.test(code)

interface TableResp { tables?: { title?: string; data?: unknown[][] }[] }

/** 上市：回傳 { code: 當日漲跌幅% }，非交易日/抓取失敗回 null（不拋錯，避免整支 500） */
async function fetchTWSE(ymd: string): Promise<Record<string, number> | null> {
 try {
  const url = `https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=${ymd}&type=ALLBUT0999`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) return null
  const j = (await res.json()) as TableResp
  const t = (j.tables ?? []).find(x => String(x.title ?? '').includes('每日收盤行情'))
  if (!t?.data?.length) return null
  const out: Record<string, number> = {}
  for (const row of t.data) {
    const code = String(row[0]).trim()
    if (!isOrdinary(code)) continue
    const close = parseNum(row[8])         // 收盤價
    const mag   = parseNum(row[10])        // 漲跌價差（幅度，sign 在 row[9]）
    if (close === null || mag === null || close <= 0) continue
    const sign  = String(row[9]).includes('green') ? -1 : 1
    const diff  = mag * sign
    const prev  = close - diff
    if (prev <= 0) continue
    out[code] = (diff / prev) * 100
  }
  return Object.keys(out).length ? out : null
 } catch { return null }
}

/** 上櫃：回傳 { code: 當日漲跌幅% }，非交易日/抓取失敗回 null（不拋錯） */
async function fetchTPEx(ymd: string): Promise<Record<string, number> | null> {
 try {
  const url = `https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=${toSlash(ymd)}&type=EW&id=&response=json`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) return null
  const j = (await res.json()) as TableResp
  const t = (j.tables ?? [])[0]
  if (!t?.data?.length) return null
  const out: Record<string, number> = {}
  for (const row of t.data) {
    const code = String(row[0]).trim()
    if (!isOrdinary(code)) continue
    const close = parseNum(row[2])         // 收盤
    const diff  = parseNum(row[3])         // 漲跌（已含正負號）
    if (close === null || diff === null || close <= 0) continue
    const prev = close - diff
    if (prev <= 0) continue
    out[code] = (diff / prev) * 100
  }
  return Object.keys(out).length ? out : null
 } catch { return null }
}

// 逐日漲跌%相加（全精度）。closes 升冪(基準→最近收盤)，回傳 (closes.length-1) 個間隔相加%
function sumDailyPct(closes: number[]): number {
  let s = 0
  for (let i = 1; i < closes.length; i++) s += (closes[i] / closes[i - 1] - 1) * 100
  return s
}
const idxNum = (s: unknown): number | null => {
  const n = parseFloat(String(s).replace(/,/g, '')); return isNaN(n) ? null : n
}
const rocToYMD = (roc: string) => {
  const m = roc.match(/(\d+)\/(\d+)\/(\d+)/); if (!m) return ''
  return `${+m[1] + 1911}${pad(+m[2])}${pad(+m[3])}`
}
/** 上櫃櫃買指數收盤 { YYYYMMDD: close }（OpenAPI，最近約一個月） */
async function fetchTpexIndex(): Promise<Record<string, number>> {
  try {
    const res = await fetch('https://www.tpex.org.tw/openapi/v1/tpex_index', { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return {}
    const arr = (await res.json()) as { Date: string; Close: string }[]
    const out: Record<string, number> = {}
    for (const r of arr) { const c = idxNum(r.Close); if (/^\d{8}$/.test(r.Date) && c) out[r.Date] = c }
    return out
  } catch { return {} }
}
/** 上市 TAIEX 收盤 { YYYYMMDD: close }，抓指定月份(YYYYMMDD)；回整月 */
async function fetchTwseIndexMonth(ymd: string): Promise<Record<string, number>> {
  try {
    const res = await fetch(`https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?response=json&date=${ymd}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return {}
    const j = (await res.json()) as { data?: string[][] }
    const out: Record<string, number> = {}
    for (const row of j.data ?? []) { const d = rocToYMD(String(row[0])); const c = idxNum(row[4]); if (d && c) out[d] = c }
    return out
  } catch { return {} }
}

/** 逐檔「逐日漲跌幅相加」→ 各檔累積%，再對全市場取簡單(等權)平均
 *  法規：個股累積漲跌% = 期間內各營業日漲跌%之「相加」（非收盤比值/連乘）；
 *  全體均值 = 全市場每檔依此計算之累積%的『簡單平均值』（等權，非市值加權）。 */
function avgCumulative(snaps: Record<string, Record<string, number>>, days: string[]): { avg: number; n: number } {
  const intervals = days.slice(1) // 6 個交易日 = 5 個間隔（首日為基準，不含其自身漲跌）
  if (intervals.length === 0) return { avg: 0, n: 0 }
  let codes = new Set(Object.keys(snaps[intervals[0]] ?? {}))
  for (const d of intervals.slice(1)) {
    const s = snaps[d] ?? {}
    codes = new Set([...codes].filter(c => c in s))
  }
  const trunc2 = (x: number) => Math.trunc(x * 100) / 100   // 每日漲跌% 取小數 2 位無條件捨去(向零)
  let sum = 0, n = 0
  for (const c of codes) {
    let cum = 0
    for (const d of intervals) cum += trunc2(snaps[d][c])   // 逐日(截斷後)漲跌幅相加
    sum += cum
    n++
  }
  return { avg: n ? sum / n : 0, n }
}

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams
  const bust = params.get('bust') === '1'
  const dateParam = params.get('date')
  const endYMD = dateParam && /^\d{8}$/.test(dateParam) ? dateParam : toYMD(new Date())

  // 取兩市場指數收盤序列（TAIEX 抓 endMonth + 前一月以防跨月；櫃買指數 OpenAPI 給近一個月）
  const prevMonthYMD = toYMD(new Date(+endYMD.slice(0, 4), +endYMD.slice(4, 6) - 2, 15))
  const [tpexIdx, twseA, twseB] = await Promise.all([
    fetchTpexIndex(),
    fetchTwseIndexMonth(endYMD),
    fetchTwseIndexMonth(prevMonthYMD),
  ])
  const twseIdx = { ...twseB, ...twseA }

  // 取 ≤ endYMD 的最近 WINDOW 個交易日收盤（升冪）
  const pickWindow = (idx: Record<string, number>): { days: string[]; closes: number[] } => {
    const ds = Object.keys(idx).filter(d => d <= endYMD).sort().slice(-WINDOW)
    return { days: ds, closes: ds.map(d => idx[d]) }
  }
  const tpW = pickWindow(tpexIdx)
  const twW = pickWindow(twseIdx)

  const mkResult = (w: { days: string[]; closes: number[] }) =>
    w.closes.length === WINDOW
      ? { avg: +sumDailyPct(w.closes).toFixed(2), baseDate: w.days[0], lastClosedDate: w.days[WINDOW - 1] }
      : null

  const tp = mkResult(tpW)
  const tw = mkResult(twW)
  const lastClosed = tw?.lastClosedDate ?? tp?.lastClosedDate ?? endYMD
  const baseDate = tw?.baseDate ?? tp?.baseDate ?? ''

  const cacheKey = `market-avg:idx:${endYMD}`
  if (!bust) { const c = getCached(cacheKey); if (c) return NextResponse.json({ ...(c as object), cached: true }) }

  const result = {
    knownIntervals: WINDOW - 1,
    baseDate, lastClosedDate: lastClosed,
    note: '全體均值 = 發行量加權指數(上市TAIEX/上櫃櫃買指數)逐日漲跌%相加(全精度)；當日(下一交易日)以0%計',
    twse: tw ? { avg: tw.avg } : { avg: null },
    tpex: tp ? { avg: tp.avg } : { avg: null },
  }
  setCached(cacheKey, result, 6 * 60 * 60 * 1000)
  return NextResponse.json(result)
}
