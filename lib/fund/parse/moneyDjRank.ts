import * as cheerio from 'cheerio'

export interface RankRow {
  code: string
  name: string
  date: string          // "MM/DD" as-is from page
  d1: number | null     // 1日%
  w1: number | null     // 1週%
  ytd: number | null    // 今年以來%
  m1: number | null     // 1個月%
  m3: number | null     // 3個月%
  m6: number | null     // 6個月%
  y1: number | null     // 1年%
  y3: number | null     // 3年%
  y5: number | null     // 5年%
}

function num(s: string): number | null {
  const t = String(s).trim()
  if (!t || /^N\/A$/i.test(t)) return null
  const n = Number(t.replace(/[, ]/g, ''))
  return Number.isFinite(n) ? n : null
}

export function parseMoneyDJRank(html: string): RankRow[] {
  const $ = cheerio.load(html)
  const rows: RankRow[] = []
  $('tbody tr').each((_, el) => {
    const tds = $(el).find('td').map((__, td) => $(td).text().trim()).get()
    if (tds.length < 10) return
    // identify ETF link to get code reliably (avoid relying on td index for code)
    const href = $(el).find('a[href*="etfid="]').first().attr('href') ?? ''
    const m = href.match(/etfid=([0-9]{4,6}[A-Z]?)/)
    const code = m ? m[1] : (tds[3] || '')
    if (!code) return
    rows.push({
      code,
      name: tds[4] ?? '',
      date: tds[5] ?? '',
      d1:  num(tds[7]  ?? ''),
      w1:  num(tds[8]  ?? ''),
      ytd: num(tds[9]  ?? ''),
      m1:  num(tds[10] ?? ''),
      m3:  num(tds[11] ?? ''),
      m6:  num(tds[12] ?? ''),
      y1:  num(tds[13] ?? ''),
      y3:  num(tds[14] ?? ''),
      y5:  num(tds[15] ?? ''),
    })
  })
  return rows
}

export function filterActiveByYTD(rows: RankRow[], topN: number): RankRow[] {
  return rows
    .filter(r => /^00\d{3}A$/.test(r.code) && r.ytd !== null)
    .sort((a, b) => (b.ytd ?? -Infinity) - (a.ytd ?? -Infinity))
    .slice(0, topN)
}
