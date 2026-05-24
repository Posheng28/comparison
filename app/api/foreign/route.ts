import { NextRequest, NextResponse } from 'next/server'

// 個股三大法人持股比重%（逐週），供籌碼/大戶「扣三大法人」用。
// 來源：富邦 e-broker（嘉實 DJ）法人持股明細，伺服器渲染、上市櫃通吃、約 1 年每日。
//   zcl.djhtm?a=代號&c=起日&d=迄日（YYYY-MM-DD）→ 表格列：日期 + 買賣超×4 + 估計持股×4 + 外資比重% + 三大法人比重%。
//   ⚠️ 投信/自營為 DJ 估算值（官方僅發買賣超）；持股比重以「佔已發行股數」計（與集保庫存略有差異）。
// 回傳每個請求週的 { foreign%（外資）, legal%（三大法人） }；該週無資料則取最近一個較早日。

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

// 每股快取（DJ 一次抓一年，12h 內重用）
const cache = new Map<string, { at: number; map: Record<string, { f: number; l: number }> }>()

const rocToAD = (s: string) => {
  const [y, m, d] = s.split('/')
  return `${parseInt(y) + 1911}${m.padStart(2, '0')}${d.padStart(2, '0')}`
}
const adToDash = (ymd: string) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`

async function fetchDJ(code: string, from: string, to: string): Promise<Record<string, { f: number; l: number }>> {
  const hit = cache.get(code)
  if (hit && Date.now() - hit.at < 12 * 60 * 60 * 1000) return hit.map
  const url = `https://fubon-ebrokerdj.fbs.com.tw/z/zc/zcl/zcl.djhtm?a=${code}&c=${from}&d=${to}`
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: `https://fubon-ebrokerdj.fbs.com.tw/z/zc/zcl/zcl_${code}.djhtm` } })
  if (!res.ok) throw new Error(`DJ ${res.status}`)
  const html = new TextDecoder('big5').decode(await res.arrayBuffer())
  const map: Record<string, { f: number; l: number }> = {}
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const c = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map(x => x[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').replace(/,/g, '').trim())
      .filter(Boolean)
    if (c.length >= 10 && /^\d{2,3}\/\d{2}\/\d{2}$/.test(c[0])) {
      const f = parseFloat(c[c.length - 2]) // 外資持股比重%
      const l = parseFloat(c[c.length - 1]) // 三大法人持股比重%
      if (!isNaN(l)) map[rocToAD(c[0])] = { f: isNaN(f) ? 0 : f, l }
    }
  }
  cache.set(code, { at: Date.now(), map })
  return map
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = (searchParams.get('ticker') || '').trim()
  if (!/^\d{4}$/.test(code)) return NextResponse.json({ error: '代號錯誤' }, { status: 400 })
  const dates = [...new Set((searchParams.get('dates') || searchParams.get('date') || '')
    .split(',').map(s => s.replace(/-/g, '').trim()).filter(d => /^\d{8}$/.test(d)))].sort()
  if (dates.length === 0) return NextResponse.json({ error: '日期錯誤' }, { status: 400 })

  try {
    const map = await fetchDJ(code, adToDash(dates[0]), adToDash(dates[dates.length - 1]))
    const sortedKeys = Object.keys(map).sort()
    const foreign: Record<string, number | null> = {}
    const legal: Record<string, number | null> = {}
    for (const d of dates) {
      let key: string | undefined = map[d] ? d : undefined
      if (!key) { for (let i = sortedKeys.length - 1; i >= 0; i--) if (sortedKeys[i] <= d) { key = sortedKeys[i]; break } } // 最近較早日
      foreign[d] = key ? map[key].f : null
      legal[d] = key ? map[key].l : null
    }
    return NextResponse.json({ code, foreign, legal })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '法人持股取得失敗' }, { status: 502 })
  }
}
