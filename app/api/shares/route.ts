// app/api/shares/route.ts — 發行股數（股）單檔查詢；資料整批快取於 fetchIssuedShares(24h)
import { NextRequest, NextResponse } from 'next/server'
import { fetchIssuedShares, type Market } from '@/lib/disposal/marketData'

export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams
  const market = (p.get('market') === 'TPEx' ? 'TPEx' : 'TWSE') as Market
  const code = (p.get('code') ?? '').trim()
  if (!code) return NextResponse.json({ error: 'need code' }, { status: 400 })
  const map = await fetchIssuedShares(market)
  return NextResponse.json({ shares: map?.[code] ?? null })
}
