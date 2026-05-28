import { describe, it, expect } from 'vitest'
import { FUNDS, ETFS, ALL_DEFS, slugBySitca } from '../sources'

describe('fund registry', () => {
  it('有 13 檔基金、7 檔 ETF', () => {
    expect(FUNDS).toHaveLength(13)
    expect(ETFS).toHaveLength(7)
  })
  it('fundId 全域唯一', () => {
    const ids = ALL_DEFS.map(d => d.fundId)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('每檔基金都有 sitcaCode 且 slug 映射存在', () => {
    for (const f of FUNDS) {
      expect(f.sitcaCode).toBeTruthy()
      expect(slugBySitca(f.sitcaCode!)).toBe(f.fundId)
    }
  })
  it('ETF fundId === ticker', () => {
    for (const e of ETFS) expect(e.fundId).toBe(e.etfTicker)
  })
})
