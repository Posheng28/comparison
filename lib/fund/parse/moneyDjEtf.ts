import * as cheerio from 'cheerio'
import type { FundSnapshot, FundHolding } from '../types'

const DATE_RE = /20\d\d[\/.\-]\d{1,2}[\/.\-]\d{1,2}/

// Supported market suffixes in holding link text, e.g. "台積電(2330.TW)" or "NVIDIA(NVDA.US)"
const HOLDING_RE = /^(.+?)\(([A-Za-z0-9]+)\.(TW|US|HK|JP|KS|SS|SZ|SH)\)\s*$/

export function parseMoneyDJEtf(html: string, fundId: string): FundSnapshot {
  const $ = cheerio.load(html)

  // Scope to the main holdings table (id ends with "stable3", class "datalist").
  // This avoids picking up rows from other tables on the page (sector, related ETFs, etc.).
  const mainTable = $('table#ctl00_ctl00_MainContent_MainContent_stable3')
  const rowSelector = mainTable.length > 0 ? mainTable.find('tr') : $('tr')

  // Locate all rows that contain both td.col05 and td.col06
  const rows = rowSelector.filter((_, el) => $(el).find('td.col05').length > 0 && $(el).find('td.col06').length > 0)
  if (rows.length === 0) throw new Error(`MoneyDJ ${fundId}: no holdings rows`)

  const holdings: FundHolding[] = []
  rows.each((_, el) => {
    const $r = $(el)
    const linkText = $r.find('td.col05 a').first().text().trim()
    // Match stocks across all supported markets: TW, US, HK, JP, KS (Korea), SS/SZ (China)
    const m = linkText.match(HOLDING_RE)
    if (!m) return
    const name = m[1].trim()
    const code = m[2].trim()
    const market = m[3]
    const weightPct = Number($r.find('td.col06').first().text().trim())
    if (Number.isNaN(weightPct)) return
    const holding: FundHolding = { code, name, weightPct, rank: holdings.length + 1 }
    if (market !== 'TW') holding.market = market
    // 股數（col07）— 可能含千分位逗號；缺值則略過
    const sharesRaw = $r.find('td.col07').first().text().trim().replace(/,/g, '')
    if (sharesRaw) {
      const shares = Number(sharesRaw)
      if (!Number.isNaN(shares)) holding.shares = shares
    }
    holdings.push(holding)
  })

  if (!holdings.length) throw new Error(`MoneyDJ ${fundId}: zero parsed holdings`)

  // Period: scan whole HTML for the first date in YYYY/MM/DD or YYYY-MM-DD form
  const allText = $.root().text()
  const dm = allText.match(DATE_RE)
  if (!dm) throw new Error(`MoneyDJ ${fundId}: no date found`)
  const period = dm[0].replace(/[\/.]/g, '-') // "2026/05/27" -> "2026-05-27"

  return {
    fundId,
    reportType: 'etf_daily',
    period,
    source: 'moneydj',
    fetchedAt: new Date().toISOString(),
    holdings,
  }
}
