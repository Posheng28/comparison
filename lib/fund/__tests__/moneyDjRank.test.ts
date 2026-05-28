import { describe, it, expect } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { parseMoneyDJRank, filterActiveByYTD } from '../parse/moneyDjRank'

describe('parseMoneyDJRank (real fixture)', () => {
  it('parses all rows from fixture and returns correct first row data', async () => {
    const html = await fs.readFile(path.join(__dirname, 'fixtures/moneydj-rank.html'), 'utf-8')
    const rows = parseMoneyDJRank(html)
    // fixture has 100 rows
    expect(rows.length).toBeGreaterThan(50)
    // verify first row (00674R 期元大S&P黃金反1 ytd=-4.05)
    expect(rows[0].code).toBe('00674R')
    expect(rows[0].name).toBe('期元大S&P黃金反1')
    expect(rows[0].date).toBe('05/28')
    expect(rows[0].d1).toBe(3.07)
    expect(rows[0].ytd).toBe(-4.05)
  })

  it('handles N/A values as null', async () => {
    const html = await fs.readFile(path.join(__dirname, 'fixtures/moneydj-rank.html'), 'utf-8')
    const rows = parseMoneyDJRank(html)
    // 00988B (index 29) has ytd = N/A
    const naRow = rows.find(r => r.code === '00988B')
    expect(naRow).toBeDefined()
    expect(naRow!.ytd).toBeNull()
  })

  it('filterActiveByYTD returns rows sorted by ytd for A-suffix codes', () => {
    // synthetic rows to verify the filter+sort logic
    const synthetic = [
      { code: '00981A', name: 'X', date: '05/28', d1: 1, w1: 1, ytd: 92.90, m1: 1, m3: 1, m6: 1, y1: null, y3: null, y5: null },
      { code: '00990A', name: 'Y', date: '05/28', d1: 1, w1: 1, ytd: 94.71, m1: 1, m3: 1, m6: 1, y1: null, y3: null, y5: null },
      { code: '00982A', name: 'Z', date: '05/28', d1: 1, w1: 1, ytd: null,  m1: 1, m3: 1, m6: 1, y1: null, y3: null, y5: null },
      { code: '00674R', name: 'W', date: '05/28', d1: 1, w1: 1, ytd: 180.0, m1: 1, m3: 1, m6: 1, y1: null, y3: null, y5: null },
    ]
    const top2 = filterActiveByYTD(synthetic, 2)
    // only A-suffix codes, sorted ytd desc, null excluded, max 2
    expect(top2.map(r => r.code)).toEqual(['00990A', '00981A'])
    expect(top2[0].ytd).toBe(94.71)
    expect(top2[1].ytd).toBe(92.90)
  })

  it('fixture produces no A-suffix active ETFs (rank page is for all ETF types)', async () => {
    const html = await fs.readFile(path.join(__dirname, 'fixtures/moneydj-rank.html'), 'utf-8')
    const rows = parseMoneyDJRank(html)
    const top7 = filterActiveByYTD(rows, 7)
    // the fixture is the general ETF rank page; active equity ETFs (00xxxA) are not in top-100
    expect(top7).toHaveLength(0)
  })
})
