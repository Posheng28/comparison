import { describe, it, expect } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { parseMoneyDJEtf } from '../parse/moneyDjEtf'

const EXPECTED: Array<[string, number, string, string, number]> = [
  // [fundId, holdingsCount, period, firstCode, firstWeight]
  ['00980A', 45, '2026-05-27', '2330', 7.96],
  ['00981A', 51, '2026-05-27', '2330', 9.23],
  ['00982A', 59, '2026-05-27', '2330', 8.01],
  // 00988A holds foreign stocks (US/JP/KS/SH) — parser now captures all markets; 41 total
  ['00988A', 41, '2026-05-26', 'MU', 5.2],
  ['00991A', 50, '2026-05-27', '2330', 15.86],
  ['00993A', 52, '2026-05-27', '2330', 9.08],
]

describe('parseMoneyDJEtf (6 real fixtures)', () => {
  for (const [fundId, count, period, code1, weight1] of EXPECTED) {
    it(`${fundId}: ${count} holdings, period ${period}, top1 ${code1}@${weight1}`, async () => {
      const html = await fs.readFile(path.join(__dirname, 'fixtures', `moneydj-${fundId}.html`), 'utf-8')
      const snap = parseMoneyDJEtf(html, fundId)
      expect(snap.fundId).toBe(fundId)
      expect(snap.reportType).toBe('etf_daily')
      expect(snap.source).toBe('moneydj')
      expect(snap.period).toBe(period)
      expect(snap.holdings.length).toBe(count)
      expect(snap.holdings[0].code).toBe(code1)
      expect(snap.holdings[0].weightPct).toBe(weight1)
      expect(snap.holdings[0].rank).toBe(1)
    })
  }
})

describe('parseMoneyDJEtf (3 new fixtures — multi-market)', () => {
  it('00984A: 109 TW-only holdings, period 2026-05-28, top1 2303@5.03', async () => {
    const html = await fs.readFile(path.join(__dirname, 'fixtures', 'moneydj-00984A.html'), 'utf-8')
    const snap = parseMoneyDJEtf(html, '00984A')
    expect(snap.fundId).toBe('00984A')
    expect(snap.reportType).toBe('etf_daily')
    expect(snap.source).toBe('moneydj')
    expect(snap.period).toBe('2026-05-28')
    expect(snap.holdings.length).toBe(109)
    expect(snap.holdings[0].code).toBe('2303')
    expect(snap.holdings[0].weightPct).toBe(5.03)
    expect(snap.holdings[0].rank).toBe(1)
    // All TW — no market field on first holding
    expect(snap.holdings[0].market).toBeUndefined()
  })

  it('00990A: 52 mixed-market holdings (TW+US+JP+KS), period 2026-05-27, top1 MU(US)@6.29', async () => {
    const html = await fs.readFile(path.join(__dirname, 'fixtures', 'moneydj-00990A.html'), 'utf-8')
    const snap = parseMoneyDJEtf(html, '00990A')
    expect(snap.fundId).toBe('00990A')
    expect(snap.period).toBe('2026-05-27')
    expect(snap.holdings.length).toBe(52)
    expect(snap.holdings[0].code).toBe('MU')
    expect(snap.holdings[0].weightPct).toBe(6.29)
    expect(snap.holdings[0].rank).toBe(1)
    expect(snap.holdings[0].market).toBe('US')
    // Some holdings should be TW (no market field)
    const twHoldings = snap.holdings.filter(h => h.market === undefined)
    expect(twHoldings.length).toBeGreaterThan(0)
    // Some holdings should have non-TW markets
    const nonTwHoldings = snap.holdings.filter(h => h.market !== undefined)
    expect(nonTwHoldings.length).toBeGreaterThan(0)
  })

  it('00986A: 28 mixed-market holdings (TW+US+JP), period 2026-05-27, top1 MU(US)@9.02', async () => {
    const html = await fs.readFile(path.join(__dirname, 'fixtures', 'moneydj-00986A.html'), 'utf-8')
    const snap = parseMoneyDJEtf(html, '00986A')
    expect(snap.fundId).toBe('00986A')
    expect(snap.period).toBe('2026-05-27')
    expect(snap.holdings.length).toBe(28)
    expect(snap.holdings[0].code).toBe('MU')
    expect(snap.holdings[0].weightPct).toBe(9.02)
    expect(snap.holdings[0].rank).toBe(1)
    expect(snap.holdings[0].market).toBe('US')
    // Should have exactly 1 TW holding (台積電)
    const twHoldings = snap.holdings.filter(h => h.market === undefined)
    expect(twHoldings.length).toBe(1)
    expect(twHoldings[0].code).toBe('2330')
    // Should have US and JP holdings
    expect(snap.holdings.some(h => h.market === 'US')).toBe(true)
    expect(snap.holdings.some(h => h.market === 'JP')).toBe(true)
  })
})
