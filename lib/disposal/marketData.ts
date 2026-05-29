// lib/disposal/marketData.ts
import { getCached, setCached } from '@/lib/cache'

export type Market = 'TWSE' | 'TPEx'

/** 每日漲跌% 取小數 2 位無條件捨去(向零) — 注意股累積漲幅官方逐日進位法 */
const trunc2 = (x: number) => { const v = Math.round(x * 1e8) / 1e8; return Math.trunc(v * 100) / 100 }

const idxNum = (s: unknown): number | null => { const n = parseFloat(String(s).replace(/,/g, '')); return isNaN(n) ? null : n }
const isOrd = (c: string) => /^[1-9]\d{3}$/.test(c)   // 普通股(排除 ETF/ETN/權證/債券/特別股)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

interface MiResp { tables?: { title?: string; data?: unknown[][] }[] }

/** 上市某日普通股 { code: 當日漲跌幅%(raw, 未trunc) }；失敗/非交易日回 null（含 3 次重試） */
export async function fetchTwseDailyPct(ymd: string): Promise<Record<string, number> | null> {
  const url = `https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=${ymd}&type=ALLBUT0999`
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (res.ok) {
        const j = (await res.json()) as MiResp
        const t = (j.tables ?? []).find(x => String(x.title ?? '').includes('每日收盤行情'))
        if (t?.data?.length) {
          const out: Record<string, number> = {}
          for (const row of t.data) {
            const code = String(row[0]).trim(); if (!isOrd(code)) continue
            const close = idxNum(row[8]), mag = idxNum(row[10])   // row[8]=收盤 row[9]=方向(green=跌) row[10]=漲跌價差
            if (close === null || mag === null || close <= 0) continue
            const diff = mag * (String(row[9]).includes('green') ? -1 : 1), prev = close - diff
            if (prev <= 0) continue
            out[code] = (diff / prev) * 100
          }
          if (Object.keys(out).length) return out
        }
      }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 600))
  }
  return null
}

/** 上櫃某日普通股 { code: 當日漲跌幅%(raw) }；dailyQuotes，漲跌欄已帶 +/− */
export async function fetchTpexDailyPct(ymd: string): Promise<Record<string, number> | null> {
  const roc = `${+ymd.slice(0, 4) - 1911}/${ymd.slice(4, 6)}/${ymd.slice(6, 8)}`
  const url = `https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=${roc}&type=EW&response=json`
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (res.ok) {
        const j = (await res.json()) as { tables?: { data?: unknown[][] }[] }
        const data = j.tables?.[0]?.data
        if (data?.length) {
          const out: Record<string, number> = {}
          for (const row of data) {
            const code = String(row[0]).trim(); if (!isOrd(code)) continue
            const close = idxNum(row[2]), diff = idxNum(row[3])   // col2=收盤 col3=漲跌(帶號)
            if (close === null || diff === null || close <= 0) continue
            const prev = close - diff
            if (prev <= 0) continue
            out[code] = (diff / prev) * 100
          }
          if (Object.keys(out).length) return out
        }
      }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 600))
  }
  return null
}

/** 產業別對照 { code: 產業別碼 }；上市 t187ap03_L、上櫃 mopsfin_t187ap03_O。快取 24h */
export async function fetchSectorMap(market: Market): Promise<Record<string, string>> {
  const key = `sectormap:${market}`
  const cached = getCached(key); if (cached) return cached as Record<string, string>
  const out: Record<string, string> = {}
  try {
    if (market === 'TWSE') {
      const res = await fetch('https://openapi.twse.com.tw/v1/opendata/t187ap03_L', { headers: { 'User-Agent': UA } })
      if (res.ok) for (const r of (await res.json()) as Record<string, string>[]) {
        if (r['公司代號'] && r['產業別']) out[r['公司代號']] = r['產業別']
      }
    } else {
      const res = await fetch('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O', { headers: { 'User-Agent': UA } })
      if (res.ok) for (const r of (await res.json()) as Record<string, string>[]) {
        if (r.SecuritiesCompanyCode && r.SecuritiesIndustryCode) out[r.SecuritiesCompanyCode] = r.SecuritiesIndustryCode
      }
    }
  } catch { /* 回空 map */ }
  if (Object.keys(out).length) setCached(key, out, 24 * 60 * 60 * 1000)
  return out
}

/** 每檔個股累積% = 逐日 trunc2 後相加；只納入「全期 snapshot 都有」的代號 */
export function cumulativeMap(snaps: Record<string, number>[]): Record<string, number> {
  if (!snaps.length) return {}
  let codes = new Set(Object.keys(snaps[0]))
  for (let i = 1; i < snaps.length; i++) codes = new Set([...codes].filter(c => c in snaps[i]))
  const out: Record<string, number> = {}
  for (const c of codes) { let s = 0; for (const snap of snaps) s += trunc2(snap[c]); out[c] = s }
  return out
}

/** 等權(簡單)平均；可選依產業別篩 + 排除某 code。回 { avg, n } */
export function eqAvg(
  cums: Record<string, number>,
  opts: { sectorMap?: Record<string, string>; sector?: string; exclude?: string } = {},
): { avg: number | null; n: number } {
  const { sectorMap, sector, exclude } = opts
  let sum = 0, n = 0
  for (const [c, v] of Object.entries(cums)) {
    if (c === exclude) continue
    if (sector != null && sectorMap && sectorMap[c] !== sector) continue
    sum += v; n++
  }
  return { avg: n ? +(sum / n).toFixed(2) : null, n }
}
