import { NextRequest, NextResponse } from 'next/server'
import { getCached, setCached } from '@/lib/cache'

// 個股外資持股比率%（官方）。用於籌碼/大戶的「扣三大法人」之外資部分。
// 上市：TWSE MI_QFIIS（外資及陸資持股，欄位 row[6]=外資持股比率%）。
// 上櫃：TWSE 此表查不到 → 回 null（外資資料待接）。投信/自營為估算，另行處理。

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = (searchParams.get('ticker') || '').trim()
  const date = (searchParams.get('date') || '').replace(/-/g, '') // YYYYMMDD
  if (!/^\d{4}$/.test(code)) return NextResponse.json({ error: '代號錯誤' }, { status: 400 })
  if (!/^\d{8}$/.test(date)) return NextResponse.json({ error: '日期錯誤' }, { status: 400 })

  const cacheKey = `foreign:${date}`
  let map = getCached(cacheKey) as Record<string, number> | null
  if (!map) {
    try {
      const url = `https://www.twse.com.tw/rwd/zh/fund/MI_QFIIS?date=${date}&selectType=ALLBUT0999&response=json`
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!res.ok) throw new Error(`MI_QFIIS ${res.status}`)
      const j = await res.json()
      if (j.stat !== 'OK' || !Array.isArray(j.data)) throw new Error('無資料')
      map = {}
      for (const row of j.data as unknown[][]) {
        const c = String(row[0]).trim()
        const pct = parseFloat(String(row[6])) // 外資及陸資持股比率%
        if (/^\d{4}$/.test(c) && !isNaN(pct)) map[c] = pct
      }
      setCached(cacheKey, map, 12 * 60 * 60 * 1000) // 同日不變，快取 12h
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : '外資資料取得失敗' }, { status: 502 })
    }
  }

  const pct = map[code]
  return NextResponse.json({ code, date, foreignPct: pct ?? null }) // null = 非上市/查無（如上櫃）
}
