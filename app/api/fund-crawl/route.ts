import { NextRequest, NextResponse } from 'next/server'
import { ETFS, defById } from '@/lib/fund/sources'
import { isAfterCutoff } from '@/lib/fund/timegate'
import { saveSnapshot, listPeriods } from '@/lib/fund/store'
import { parseMoneyDJEtf } from '@/lib/fund/parse/moneyDjEtf'
import type { FundDef, FundSnapshot } from '@/lib/fund/types'

// 全 8 檔皆走 MoneyDJ 單一來源（含持股股數），每日累積；不再保存/回填歷史。
// MoneyDJ `Basic0007B` 自報資料日期 → 快照以「來源日期」為 period key，
// 因此節慶休市時 MoneyDJ 仍只回上個交易日，all 模式會判定 period 已存在而跳過，
// 形同自動略過休市日（無需維護休市行事曆）。

async function crawlOne(def: FundDef): Promise<FundSnapshot> {
  const url = `https://www.moneydj.com/ETF/X/Basic/Basic0007B.xdjhtm?etfid=${def.etfTicker}.TW`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' } })
  if (!res.ok) throw new Error(`moneydj HTTP ${res.status}`)
  const html = await res.text()
  return parseMoneyDJEtf(html, def.fundId) // 解析失敗會 throw
}

export async function POST(req: NextRequest) {
  const { fundId, force, all } = await req
    .json()
    .catch(() => ({}) as { fundId?: string; force?: boolean; all?: boolean })

  if (!force && !isAfterCutoff()) {
    return NextResponse.json({ error: '尚未過 18:30，資料當日未定案' }, { status: 425 })
  }

  // 一次爬全部（進場自動觸發用）：以來源日期為鍵，已存在則跳過。
  if (all || fundId === 'all') {
    const results: { fundId: string; period?: string; holdings?: number; status: string }[] = []
    let saved = 0
    let skipped = 0
    let failed = 0
    for (const def of ETFS) {
      try {
        const snap = await crawlOne(def)
        const periods = await listPeriods(def.fundId, 'etf_daily')
        if (periods.includes(snap.period)) {
          skipped++
          results.push({ fundId: def.fundId, period: snap.period, status: 'skipped' })
        } else {
          await saveSnapshot(snap)
          saved++
          results.push({
            fundId: def.fundId,
            period: snap.period,
            holdings: snap.holdings.length,
            status: 'saved',
          })
        }
      } catch (e) {
        failed++
        results.push({ fundId: def.fundId, status: `error: ${(e as Error).message}` })
      }
    }
    return NextResponse.json({ ok: true, saved, skipped, failed, results })
  }

  // 單檔（02 持股「更新本期」按鈕）：總是覆蓋寫入該來源日期的快照。
  const def = fundId ? defById(fundId) : null
  if (!def) return NextResponse.json({ error: 'unknown fundId' }, { status: 400 })
  try {
    const snap = await crawlOne(def)
    await saveSnapshot(snap)
    return NextResponse.json({
      ok: true,
      period: snap.period,
      holdings: snap.holdings.length,
      source: snap.source,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
