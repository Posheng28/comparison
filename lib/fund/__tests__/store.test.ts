import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { saveSnapshot, loadSnapshot, snapshotPath, __resetMem } from '../store'
import type { FundSnapshot } from '../types'

const etf: FundSnapshot = {
  fundId: 'TEST00A', reportType: 'etf_daily', period: '2026-04-30',
  source: 'test', fetchedAt: '2026-04-30T10:00:00Z',
  holdings: [{ code: '2330', name: '台積電', weightPct: 9.11 }],
}

describe('fundStore', () => {
  beforeEach(() => __resetMem())
  afterEach(async () => {
    await fs.rm(path.join(process.cwd(), '.funddata/etf/TEST00A'), { recursive: true, force: true })
  })

  it('ETF 每日存到 .funddata/etf/（gitignore 區）', () => {
    expect(snapshotPath(etf)).toContain(path.join('.funddata', 'etf', 'TEST00A'))
  })
  it('存後可讀回', async () => {
    await saveSnapshot(etf)
    const got = await loadSnapshot('TEST00A', 'etf_daily', '2026-04-30')
    expect(got?.holdings[0].code).toBe('2330')
  })
  it('同鍵重存為覆寫、不重複', async () => {
    await saveSnapshot(etf)
    await saveSnapshot({ ...etf, holdings: [{ code: '3017', name: '奇鋐', weightPct: 9.74, rank: 1 }] })
    const got = await loadSnapshot('TEST00A', 'etf_daily', '2026-04-30')
    expect(got?.holdings).toHaveLength(1)
    expect(got?.holdings[0].code).toBe('3017')
  })
})
