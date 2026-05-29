import { describe, it, expect } from 'vitest'
import { ETFS, ALL_DEFS } from '../sources'

describe('ETF registry', () => {
  it('有 8 檔主動式 ETF', () => {
    expect(ETFS).toHaveLength(8)
  })
  it('fundId 全域唯一', () => {
    const ids = ALL_DEFS.map(d => d.fundId)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('fundId === etfTicker', () => {
    for (const e of ETFS) expect(e.fundId).toBe(e.etfTicker)
  })
  it('ALL_DEFS === ETFS', () => {
    expect(ALL_DEFS).toBe(ETFS)
  })
})
