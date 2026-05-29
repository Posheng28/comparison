// lib/disposal/__tests__/marketData.test.ts
import { describe, it, expect } from 'vitest'
import { cumulativeMap, eqAvg } from '@/lib/disposal/marketData'

describe('cumulativeMap', () => {
  it('每檔逐日 trunc2 後相加，僅納入全期都有的代號', () => {
    // 2 天窗口；A 兩天都在，B 第二天缺 → B 不納入
    const snaps = [
      { '1111': 1.005, '2222': 3.0 },   // day1 raw daily%
      { '1111': 2.004, '2222': 1.0 },   // day2；2222 仍在
    ]
    // 1111: trunc2(1.005)=1.00 + trunc2(2.004)=2.00 → 3.00
    // 2222: trunc2(3.0)=3.00 + trunc2(1.0)=1.00 → 4.00
    const cum = cumulativeMap(snaps)
    expect(cum['1111']).toBeCloseTo(3.0, 6)
    expect(cum['2222']).toBeCloseTo(4.0, 6)
  })
  it('缺一天的代號被剔除', () => {
    const cum = cumulativeMap([{ A: 1 }, { B: 2 }])
    expect(Object.keys(cum)).toEqual([])
  })
})

describe('eqAvg', () => {
  const cums = { '1111': 10, '2222': 20, '3333': 30 }
  it('全體等權平均、可排除標的本身', () => {
    expect(eqAvg(cums).avg).toBeCloseTo(20, 6)             // (10+20+30)/3
    expect(eqAvg(cums, { exclude: '2222' }).avg).toBeCloseTo(20, 6) // (10+30)/2
    expect(eqAvg(cums, { exclude: '1111' }).avg).toBeCloseTo(25, 6) // (20+30)/2
  })
  it('依產業別篩選 + 排除自己', () => {
    const sectorMap = { '1111': '28', '2222': '28', '3333': '24' }
    const r = eqAvg(cums, { sectorMap, sector: '28', exclude: '1111' })
    expect(r.avg).toBeCloseTo(20, 6)  // 只剩 2222
    expect(r.n).toBe(1)
  })
  it('空集合回 null', () => {
    expect(eqAvg({}).avg).toBeNull()
  })
})
