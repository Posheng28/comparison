import { NextResponse } from 'next/server'
import { parseMoneyDJRank, filterActiveByYTD } from '@/lib/fund/parse/moneyDjRank'

export async function GET() {
  const res = await fetch('https://www.moneydj.com/ETF/X/Rank/Rank0001.xdjhtm', {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
  })
  if (!res.ok) return NextResponse.json({ error: `moneydj rank HTTP ${res.status}` }, { status: 502 })
  const html = await res.text()
  const all = parseMoneyDJRank(html)
  const top7 = filterActiveByYTD(all, 7)
  return NextResponse.json({ top7, fetchedAt: new Date().toISOString() })
}
