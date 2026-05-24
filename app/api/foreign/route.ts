import { NextRequest, NextResponse } from 'next/server'
import { loadFund, saveFund } from '@/lib/fundStore'

// 個股外資持股比率%（官方）。用於籌碼/大戶「扣三大法人」之外資部分。
// 上市 TWSE：MI_QFIIS（row[6]=外資持股比率%），支援日期 → 逐週精確、per-date 全市場快取。
// 上櫃 TPEx：OpenAPI tpex_3insti_qfii（PercentageOfSharesOC/FMIHeld）→ 僅最新一週，套到各週（近似）。
// 投信/自營為估算，另行處理。

// 上櫃僅有最新值，模組級快取（無日期）
let tpexCache: { at: number; map: Record<string, number> } | null = null
async function fetchTpexQfii(): Promise<Record<string, number>> {
  if (tpexCache && Date.now() - tpexCache.at < 12 * 60 * 60 * 1000) return tpexCache.map
  const res = await fetch('https://www.tpex.org.tw/openapi/v1/tpex_3insti_qfii', { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`tpex_3insti_qfii ${res.status}`)
  const arr = (await res.json()) as Record<string, string>[]
  const map: Record<string, number> = {}
  for (const r of arr) {
    const c = String(r.SecuritiesCompanyCode).trim()
    const pct = parseFloat(String(r['PercentageOfSharesOC/FMIHeld']).replace('%', ''))
    if (/^\d{4}$/.test(c) && !isNaN(pct)) map[c] = pct
  }
  tpexCache = { at: Date.now(), map }
  return map
}

async function fetchQfiiDate(date: string): Promise<Record<string, number>> {
  const cached = await loadFund(date)
  if (cached) return cached
  const url = `https://www.twse.com.tw/rwd/zh/fund/MI_QFIIS?date=${date}&selectType=ALLBUT0999&response=json`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`MI_QFIIS ${res.status}`)
  const j = await res.json()
  const map: Record<string, number> = {}
  if (j.stat === 'OK' && Array.isArray(j.data)) {
    for (const row of j.data as unknown[][]) {
      const c = String(row[0]).trim()
      const pct = parseFloat(String(row[6]))
      if (/^\d{4}$/.test(c) && !isNaN(pct)) map[c] = pct
    }
  }
  await saveFund(date, map) // 即使空也存，避免重抓非交易日
  return map
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = (searchParams.get('ticker') || '').trim()
  if (!/^\d{4}$/.test(code)) return NextResponse.json({ error: '代號錯誤' }, { status: 400 })

  // dates=逗號分隔 YYYYMMDD（逐週）；或單一 date
  const market = searchParams.get('market') === 'TPEx' ? 'TPEx' : 'TWSE'
  const datesParam = searchParams.get('dates') || searchParams.get('date') || ''
  const dates = [...new Set(datesParam.split(',').map(s => s.replace(/-/g, '').trim()).filter(d => /^\d{8}$/.test(d)))]
  if (dates.length === 0) return NextResponse.json({ error: '日期錯誤' }, { status: 400 })

  try {
    const byDate: Record<string, number | null> = {}
    if (market === 'TPEx') {
      // 上櫃：僅最新值，套到各週（近似）
      const map = await fetchTpexQfii()
      const pct = map[code] ?? null
      for (const d of dates) byDate[d] = pct
      return NextResponse.json({ code, market, approxLatest: true, foreign: byDate })
    }
    for (const d of dates) {
      const map = await fetchQfiiDate(d)
      byDate[d] = map[code] ?? null
    }
    return NextResponse.json({ code, market, foreign: byDate })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '外資資料取得失敗' }, { status: 502 })
  }
}
