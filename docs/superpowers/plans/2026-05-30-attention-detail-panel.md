# 注意細節條件面板 + 款一~六 引擎重構 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把處置工具的「近 6 日收盤價」唯讀表換成 attstock 風格「注意細節條件」面板（款一~六，每款條件總結＋燈號），引擎收斂到款一~六、新增款四/五、移除款十一/十二，並把款三/四（款六項三）的成交量/週轉率第二條件升級成「可算硬量門檻」、盤中即時更新。

**Architecture:** 純函式條件引擎 `lib/clauseEngine.ts` 產出「足以渲染逐項細節」的結構化 `ClauseResult`（含 `groups`/`headerThreshold`/`badge`）；資料層 `lib/disposal/marketData.ts` 新增 `fetchIssuedShares`（官方發行股數，24h 快取）經 `/api/shares` 代理；UI 層新元件 `components/disposal/AttentionDetailPanel.tsx` 以 6 張可收合卡片近乎純渲染引擎結果；`DisposalTool.tsx` 接線盤中量/發行股數並換掉舊表格與舊面板。

**Tech Stack:** Next.js 16.2.6（Turbopack、App Router）、TypeScript strict、React 19、Tailwind 4、vitest 4。`npm run build` 為 CI gate、`npm test`＝`vitest run`。

> ⚠️ Next.js 此版本有破壞性改動，動到 framework API 前先讀 `node_modules/next/dist/docs/`。
> ⚠️ **單位約定**：引擎內所有量/股數一律「張」(1 張 = 1000 股)。UI 從 Yahoo/官方拿到的是「股」(raw)，在 `evalCard` 呼叫點 `÷1000` 換成「張」再傳入。
> ⚠️ **Git**：本計畫每個 Task 末有 commit 步驟，但**實際是否 commit 由使用者明確指示**（遵專案全域規則：未獲明確指示不得 commit/push/amend）。若使用者未要求 commit，跳過 commit 步驟、保留變更於工作區即可。
> ⚠️ **build 紅燈視窗**：Task 1 改了 `ClauseInput`/移除 `gap11` 後，`DisposalTool.tsx` 會型別錯誤 → `npm run build` 會紅，直到 Task 6 完成。**Task 1~5 的關卡是 `npm test`(vitest，不做完整 type-check)**；完整 build 綠燈在 Task 6 恢復、Task 8 最終驗證。

---

## 檔案結構（決策）

| 檔案 | 責任 | 動作 |
|---|---|---|
| `lib/clauseEngine.ts` | 純函式條件引擎（款一~六），產生結構化可渲染結果 | **重寫** |
| `lib/clauseEngine.test.ts` | 引擎單元測試（差幅閘、量門檻、AND、id 集合） | **重寫** |
| `lib/disposal/marketData.ts` | 共用資料層，新增 `fetchIssuedShares` | **修改（追加）** |
| `lib/disposal/__tests__/marketData.test.ts` | 資料層單元測試，新增 shares 解析測試 | **修改（追加）** |
| `app/api/shares/route.ts` | 發行股數代理（單檔查詢、24h 快取） | **新增** |
| `components/disposal/AttentionDetailPanel.tsx` | 6 張可收合卡片，近乎純渲染 `ClauseResult[]` | **新增** |
| `components/DisposalTool.tsx` | 接線盤中量/發行股數；換表格、移除舊面板/款十一 badge | **修改** |
| `docs/PROJECT_NOTES.md` | 長期記憶：記錄本次重構與資料來源 | **修改（追加）** |

> 引擎是唯一真相來源（single source of truth）：`summarize()` 只讀 `fired`/`first`（介面相容既有處置模擬）；面板只讀 `badge`/`headerThreshold`/`groups`/`exclusions`。UI 不重算門檻。

---

## Task 1: 重寫條件引擎（款一~六）+ 單元測試

**Files:**
- Rewrite: `lib/clauseEngine.ts`
- Rewrite: `lib/clauseEngine.test.ts`

**背景**：現引擎 id 集合 `'1①'|'1②'|'2'|'3'|'6'|'11'|'12'`、`ClauseResult` 只有 `{id,fired,first,detail,blocked}`。本 Task 換成 `'1①'|'1②'|'2'|'3'|'4'|'5'|'6'`，`ClauseResult` 擴充 `name/lawText/badge/headerThreshold/groups/exclusions`，移除 `gap11/c11/c12`，升級 `c3`、新增 `c4/c5`、改寫 `c6`（OR→AND + 項三硬量門檻）。量/股數一律「張」。

- [ ] **Step 1: 重寫測試檔（先寫會失敗的測試）**

寫入 `lib/clauseEngine.test.ts`（完整覆蓋）：

```ts
// lib/clauseEngine.test.ts
import { describe, it, expect } from 'vitest'
import { evalClauses, summarize, type ClauseInput, type ClauseResult } from '@/lib/clauseEngine'

const base: ClauseInput = {
  market: 'TWSE', prevClose: 100, sumKnown: 0, price: 130, spreadBase: 100,
  marketAvg6: null, sectorAvg6: null,
  c2: null,
  pe: null, pbr: null, mktPe: null, mktPbr: null,
  dayVolume: null, avgVol60: null, sharesOutstanding: null,
  c3Assume: true, c4Assume: true, c5Assume: false, c6Assume: false,
}
const find = (rs: ClauseResult[], id: ClauseResult['id']) => rs.find(r => r.id === id)!

describe('id 集合與介面', () => {
  it('evalClauses 回 [1①,1②,2,3,4,5,6]，移除 11/12', () => {
    const ids = evalClauses(base).map(r => r.id)
    expect(ids).toEqual(['1①', '1②', '2', '3', '4', '5', '6'])
  })
  it('每款都有 name/lawText/badge/headerThreshold/groups', () => {
    for (const r of evalClauses(base)) {
      expect(r.name.length).toBeGreaterThan(0)
      expect(r.lawText.length).toBeGreaterThan(0)
      expect(['safe', 'possible', 'fired']).toContain(r.badge)
      expect(typeof r.headerThreshold).toBe('string')
      expect(Array.isArray(r.groups)).toBe(true)
    }
  })
  it('summarize 只讀 fired/first（介面相容）', () => {
    const rs = evalClauses({ ...base, price: 133, marketAvg6: 10 })
    expect(summarize(rs).first).toBe(true)   // 款一①觸發
    expect(summarize(rs).any).toBe(true)
  })
})

describe('款一差幅閘 = max(全體, 同類)+20', () => {
  it('同類均值較高 → 綁定門檻被同類拉高（款一①更難觸發）', () => {
    const rs = evalClauses({ ...base, marketAvg6: 10, sectorAvg6: 50 }) // 閘=70%
    expect(find(rs, '1①').fired).toBe(false)   // price=130 僅 +30% < 70%
  })
  it('只有全體（同類 null）行為同舊版', () => {
    const rs = evalClauses({ ...base, price: 133, marketAvg6: 10, sectorAvg6: null }) // 閘=30%
    expect(find(rs, '1①').fired).toBe(true)    // +33% > max(32,30)
  })
  it('兩者皆 null → 退回純價格門檻(32%)', () => {
    expect(find(evalClauses({ ...base, price: 133 }), '1①').fired).toBe(true)   // +33% > 32
    expect(find(evalClauses({ ...base, price: 131 }), '1①').fired).toBe(false)  // +31% < 32
  })
})

describe('款三 量能：量 ≥ 5×近60日均量（張）', () => {
  // price=130(+30%>25%) 已過第一條件；avgVol60=1000張 → 門檻 5000張
  const over = { ...base, price: 130, avgVol60: 1000 }
  it('量達標且 c3Assume 開 → 觸發', () => {
    expect(find(evalClauses({ ...over, dayVolume: 5000 }), '3').fired).toBe(true)
  })
  it('量達標但 c3Assume 關 → 不觸發、blocked', () => {
    const r = find(evalClauses({ ...over, dayVolume: 5000, c3Assume: false }), '3')
    expect(r.fired).toBe(false); expect(r.blocked).toBe(true)
  })
  it('量未達 → 不觸發', () => {
    expect(find(evalClauses({ ...over, dayVolume: 4999 }), '3').fired).toBe(false)
  })
  it('量 < 500 張除外', () => {
    const r = find(evalClauses({ ...over, dayVolume: 400, avgVol60: 50 }), '3') // 門檻250張，但<500張除外
    expect(r.fired).toBe(false)
    expect(r.exclusions?.some(e => e.label.includes('500') && e.status === 'met')).toBe(true)
  })
  it('headerThreshold 含量門檻張數', () => {
    expect(find(evalClauses(over), '3').headerThreshold).toContain('5,000張')
  })
})

describe('款四 週轉率：量 ≥ 門檻%×發行張數', () => {
  // 上市 10%；發行 1,000,000 張 → 門檻 100,000 張
  const over = { ...base, price: 130, sharesOutstanding: 1_000_000 }
  it('量達標且 c4Assume 開 → 觸發', () => {
    expect(find(evalClauses({ ...over, dayVolume: 100_000 }), '4').fired).toBe(true)
  })
  it('量未達 → 不觸發', () => {
    expect(find(evalClauses({ ...over, dayVolume: 99_999 }), '4').fired).toBe(false)
  })
  it('上櫃門檻 5%', () => {
    const r = evalClauses({ ...over, market: 'TPEx', dayVolume: 50_000 })
    expect(find(r, '4').fired).toBe(true)   // 0.05×1,000,000 = 50,000
  })
  it('headerThreshold 含發行推導量門檻', () => {
    expect(find(evalClauses(over), '4').headerThreshold).toContain('100,000張')
  })
})

describe('款六 四項 AND（修正既有 OR bug）', () => {
  // PE/PBR 皆異常 + 量達項三 + c6Assume(項四) 才觸發
  const all = {
    ...base, price: 130, pe: 200, pbr: 12, mktPe: 20, mktPbr: 2,
    sharesOutstanding: 1_000_000, dayVolume: 100_000, c6Assume: true,
  }
  it('四項齊備 → 觸發', () => {
    expect(find(evalClauses(all), '6').fired).toBe(true)
  })
  it('只有 PE 異常、PBR 正常 → 不觸發（AND）', () => {
    expect(find(evalClauses({ ...all, pbr: 1 }), '6').fired).toBe(false)
  })
  it('項四假設關 → 不觸發、blocked', () => {
    const r = find(evalClauses({ ...all, c6Assume: false }), '6')
    expect(r.fired).toBe(false); expect(r.blocked).toBe(true)
  })
  it('量未達項三 → 不觸發', () => {
    expect(find(evalClauses({ ...all, dayVolume: 100 }), '6').fired).toBe(false)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd "C:/Users/user/chart-overlay" && npx vitest run lib/clauseEngine.test.ts`
Expected: FAIL（型別/匯出不符：`ClauseInput` 缺 `dayVolume` 等、`evalClauses` 仍含 `11/12`）。

- [ ] **Step 3: 重寫引擎（完整實作）**

完整覆蓋 `lib/clauseEngine.ts`：

```ts
// lib/clauseEngine.ts — 注意條件引擎（款一~六），純函式可單測。
// 量/股數單位一律「張」(1 張 = 1000 股)；UI 層負責 股→張 換算後傳入。
export type Market = 'TWSE' | 'TPEx'
type ClauseId = '1①' | '1②' | '2' | '3' | '4' | '5' | '6'

export type CondStatus = 'met' | 'possible' | 'safe' | 'assumed' | 'raised' // 已達/可能/無風險/假設/拉高門檻
export interface SubCond { label: string; threshold: string; current?: string; status: CondStatus; note?: string }
export interface CondGroup { title: string; threshold: string; status: CondStatus; subs: SubCond[] }
export interface ClauseResult {
  id: ClauseId
  name: string
  lawText: string
  fired: boolean
  first: boolean
  badge: 'safe' | 'possible' | 'fired'
  headerThreshold: string
  groups: CondGroup[]
  exclusions?: { label: string; status: 'met' | 'unimpl' | 'na' }[]
  blocked?: boolean
}

const trunc2 = (x: number) => { const v = Math.round(x * 1e8) / 1e8; return Math.trunc(v * 100) / 100 }
const tickOf = (p: number) => p < 10 ? 0.01 : p < 50 ? 0.05 : p < 100 ? 0.1 : p < 500 ? 0.5 : p < 1000 ? 1 : 5
const nextTick = (p: number) => { const t = tickOf(p); let k = Math.ceil(p / t) * t; if (k <= p + 1e-9) k += t; return +k.toFixed(2) }
const clTick   = (p: number) => { const t = tickOf(p); return +(Math.round(p / t) * t).toFixed(2) }
const fmtLot = (n: number) => Math.round(n).toLocaleString('en-US')

const PCT = {
  TWSE: { c1a: 32, c1b: 25, c3: 25, gap: 50, c2: [100, 130, 160] as const, pe: 60, pbr: 6, c2dup: 25,
    volMult: 5, volWin: 60, volMagDiff: 4, volMinLot: 500, turnoverFloor: 0.1,
    turnover: 10, turnoverDiff: 5, brokerConc: 25, brokerBranchAdd: 1, brokerConcCap: 35, brokerMinLot: 500,
    c6Turnover: 5, c6MinLot: 3000, c6PbrMult: 4 },
  TPEx: { c1a: 30, c1b: 23, c3: 27, gap: 40, c2: [100, 140, 160] as const, pe: 65, pbr: 4, c2dup: 27,
    volMult: 5, volWin: 60, volMagDiff: 4, volMinLot: 300, turnoverFloor: 1,
    turnover: 5, turnoverDiff: 3, brokerConc: 20, brokerBranchAdd: 1, brokerConcCap: 30, brokerMinLot: 300,
    c6Turnover: 5, c6MinLot: 2000, c6PbrMult: 2 },
}

export interface ClauseInput {
  market: Market
  prevClose: number
  sumKnown: number
  price: number
  spreadBase: number
  marketAvg6: number | null
  sectorAvg6: number | null
  c2: { window: number; pct: number; exempt: boolean } | null
  pe: number | null; pbr: number | null; mktPe: number | null; mktPbr: number | null
  dayVolume: number | null          // 當日/盤中累積量（張）
  avgVol60: number | null           // 近 60 日均量（張）
  sharesOutstanding: number | null  // 發行（張）
  c3Assume: boolean   // 款三「放大倍數與全體差≥4倍」假設成立
  c4Assume: boolean   // 款四「週轉率與全體差≥5%」假設成立
  c5Assume: boolean   // 款五 券商集中度（非公開）假設達標
  c6Assume: boolean   // 款六 項四（三選一，非公開）假設達標
}

const diffGate = (m: number | null, s: number | null): number => {
  const xs = [m, s].filter((x): x is number => x != null)
  return xs.length ? Math.max(...xs) + 20 : -Infinity
}
const priceForCum = (prevClose: number, sumKnown: number, x: number) => prevClose * (1 + (x - sumKnown) / 100)
const cumAt = (inp: ClauseInput, p: number) => inp.sumKnown + trunc2(inp.prevClose > 0 ? (p - inp.prevClose) / inp.prevClose * 100 : 0)
const cumOf = (inp: ClauseInput) => cumAt(inp, inp.price)
const effCum = (inp: ClauseInput, base: number) => Math.max(base, diffGate(inp.marketAvg6, inp.sectorAvg6))
const t3Of   = (inp: ClauseInput) => nextTick(priceForCum(inp.prevClose, inp.sumKnown, effCum(inp, PCT[inp.market].c3)))

// 差幅閘門子列（顯示「門檻base%→eff%」拉高門檻）
function diffSub(inp: ClauseInput, base: number): SubCond {
  const eff = effCum(inp, base)
  return { label: '差幅', threshold: `門檻${base}%→${eff.toFixed(2)}%`, status: 'raised', note: '需超出全體及同類均值 20% 以上' }
}
// 漲跌幅（第一條件）群組 — 款三/四/五 共用
function priceGroup(inp: ClauseInput, t: number, base: number): CondGroup {
  const met = inp.price >= t
  return {
    title: '漲跌幅', threshold: `收盤 ≥ ${t}`, status: met ? 'met' : 'possible',
    subs: [
      { label: '6日累積漲跌', threshold: `≥ ${effCum(inp, base).toFixed(2)}%`, current: `${cumOf(inp).toFixed(2)}%`, status: met ? 'met' : 'possible' },
      diffSub(inp, base),
    ],
  }
}
function exC1(inp: ClauseInput): ClauseResult['exclusions'] {
  const m = PCT[inp.market]
  return [
    { label: 'IPO 無漲跌幅期間不計', status: 'unimpl' },
    { label: '除權息等非交易因素', status: 'unimpl' },
    { label: '收盤 < 5 元不適用', status: inp.price < 5 ? 'met' : 'na' },
    { label: '同類 < 5 種不適用類股規定', status: inp.sectorAvg6 == null ? 'met' : 'na' },
    { label: `PE 負或 ≥${m.pe}倍不適用類股規定`, status: (inp.pe != null && (inp.pe < 0 || inp.pe >= m.pe)) ? 'met' : 'na' },
    { label: '前一營業日溢/折價 ≤10%', status: 'unimpl' },
    { label: '認購售權證特例（普通股 N/A）', status: 'na' },
  ]
}

function c1(inp: ClauseInput): ClauseResult[] {
  const m = PCT[inp.market]
  const t1 = nextTick(priceForCum(inp.prevClose, inp.sumKnown, effCum(inp, m.c1a)))
  const t2 = Math.max(nextTick(priceForCum(inp.prevClose, inp.sumKnown, effCum(inp, m.c1b))), clTick(inp.spreadBase + m.gap))
  const f1 = inp.price >= t1, f2 = !f1 && inp.price >= t2
  const spread = inp.price - inp.spreadBase
  const r1: ClauseResult = {
    id: '1①', name: '累積漲跌幅異常', lawText: `6 日累積漲跌 > ${m.c1a}% 且差幅 ≥20%`,
    fired: f1, first: f1, badge: f1 ? 'fired' : 'safe',
    headerThreshold: `收盤 ≥ ${t1}`, groups: [priceGroup(inp, t1, m.c1a)], exclusions: exC1(inp),
  }
  const r2: ClauseResult = {
    id: '1②', name: '累積漲跌幅異常（含起迄價差）', lawText: `6 日累積漲跌 > ${m.c1b}% 且差幅 ≥20% 且起迄價差 ≥ ${m.gap} 元`,
    fired: f2, first: f2, badge: f2 ? 'fired' : 'safe',
    headerThreshold: `收盤 ≥ ${t2}（含起迄價差 ≥ ${m.gap} 元）`,
    groups: [
      priceGroup(inp, t2, m.c1b),
      { title: '起迄價差', threshold: `≥ ${m.gap} 元`, status: spread >= m.gap ? 'met' : 'possible',
        subs: [{ label: '起迄價差', threshold: `≥ ${m.gap} 元`, current: `${spread.toFixed(2)} 元`, status: spread >= m.gap ? 'met' : 'possible' }] },
    ],
    exclusions: exC1(inp),
  }
  return [r1, r2]
}

function c2(inp: ClauseInput): ClauseResult {
  const m = PCT[inp.market]
  const hit = !!(inp.c2 && inp.c2.pct > 0 && !inp.c2.exempt)
  return {
    id: '2', name: '中長期漲跌異常',
    lawText: `30日 > ${m.c2[0]}% / 60日 > ${m.c2[1]}% / 90日 > ${m.c2[2]}%，且收盤須高於(漲)/低於(跌)當日開盤參考價`,
    fired: hit, first: false, badge: hit ? 'fired' : 'safe',
    headerThreshold: inp.c2 ? `${inp.c2.window}日累積 ${inp.c2.pct.toFixed(1)}%${inp.c2.exempt ? '（防重複豁免）' : ''}` : '無中長期窗口資料',
    groups: inp.c2 ? [{
      title: '中長期窗口', threshold: `${inp.c2.window} 日 > 視窗門檻`, status: hit ? 'met' : (inp.c2.exempt ? 'safe' : 'possible'),
      subs: [
        { label: `${inp.c2.window}日累積漲跌`, threshold: '> 視窗門檻', current: `${inp.c2.pct.toFixed(1)}%`, status: inp.c2.pct > 0 ? 'met' : 'safe' },
        { label: '防重複豁免', threshold: `近30日已公布注意且 6 日累積 ≤ ${m.c2dup}% 則豁免`, status: inp.c2.exempt ? 'safe' : 'met', note: inp.c2.exempt ? '豁免成立 → 不適用' : '未豁免' },
      ],
    }] : [],
  }
}

function c3(inp: ClauseInput): ClauseResult {
  const m = PCT[inp.market], t3 = t3Of(inp)
  const priceMet = inp.price >= t3
  const volThresh = inp.avgVol60 != null ? m.volMult * inp.avgVol60 : null
  const volMet = inp.dayVolume != null && volThresh != null && inp.dayVolume >= volThresh
  const excluded = inp.dayVolume != null && inp.dayVolume < m.volMinLot
  const fired = priceMet && volMet && inp.c3Assume && !excluded
  const blocked = priceMet && volMet && !inp.c3Assume && !excluded
  const volGroup: CondGroup = {
    title: '量能', threshold: volThresh != null ? `量 ≥ ${m.volMult}×近${m.volWin}日均量 = ${fmtLot(volThresh)}張` : `量 ≥ ${m.volMult}×近${m.volWin}日均量`,
    status: volMet ? 'met' : 'possible',
    subs: [
      { label: '基本門檻', threshold: `${m.volMult} 倍`, status: volMet ? 'met' : 'possible',
        current: inp.dayVolume != null && volThresh != null ? `目前 ${fmtLot(inp.dayVolume)}張 / 門檻 ${fmtLot(volThresh)}張` : undefined },
      { label: `放大倍數與全體差 ≥ ${m.volMagDiff} 倍`, threshold: '次要條件', status: inp.c3Assume ? 'assumed' : 'safe', note: '全市場量均值未算，假設成立' },
      { label: `參考：近${m.volWin}日均量`, threshold: inp.avgVol60 != null ? `${fmtLot(inp.avgVol60)}張` : '—', status: 'met' },
    ],
  }
  return {
    id: '3', name: '漲跌異常 + 量能放大',
    lawText: `6 日累積漲跌 > ${m.c3}% 且差幅 ≥20% 且 當日量 ≥ ${m.volMult}×近${m.volWin}日均量（放大倍數與全體差 ≥ ${m.volMagDiff} 倍）`,
    fired, first: false, blocked, badge: fired ? 'fired' : priceMet ? 'possible' : 'safe',
    headerThreshold: volThresh != null ? `收盤 ≥ ${t3} 且 量 ≥ ${fmtLot(volThresh)}張` : `收盤 ≥ ${t3} 且 量達標`,
    groups: [priceGroup(inp, t3, m.c3), volGroup],
    exclusions: [
      { label: `當日量 < ${m.volMinLot}張 不適用`, status: excluded ? 'met' : 'na' },
      { label: `週轉率 < ${m.turnoverFloor}% 不適用`, status: 'unimpl' },
    ],
  }
}

function c4(inp: ClauseInput): ClauseResult {
  const m = PCT[inp.market], t3 = t3Of(inp)
  const priceMet = inp.price >= t3
  const turnoverLot = inp.sharesOutstanding != null ? (m.turnover / 100) * inp.sharesOutstanding : null
  const volMet = inp.dayVolume != null && turnoverLot != null && inp.dayVolume >= turnoverLot
  const fired = priceMet && volMet && inp.c4Assume
  const blocked = priceMet && volMet && !inp.c4Assume
  const curTurnover = inp.dayVolume != null && inp.sharesOutstanding ? inp.dayVolume / inp.sharesOutstanding * 100 : null
  const turnGroup: CondGroup = {
    title: '週轉率', threshold: turnoverLot != null ? `週轉率 ≥ ${m.turnover}%（≈ ${fmtLot(turnoverLot)}張）` : `週轉率 ≥ ${m.turnover}%`,
    status: volMet ? 'met' : 'possible',
    subs: [
      { label: '基本門檻', threshold: `≥ ${m.turnover}%`, status: volMet ? 'met' : 'possible',
        current: inp.dayVolume != null && turnoverLot != null ? `目前 ${fmtLot(inp.dayVolume)}張 / 門檻 ${fmtLot(turnoverLot)}張${curTurnover != null ? `（${curTurnover.toFixed(2)}%）` : ''}` : undefined },
      { label: `差幅條件（與全體差 ≥ ${m.turnoverDiff}%）`, threshold: '次要條件', status: inp.c4Assume ? 'assumed' : 'safe', note: '全市場週轉率均值未算，假設成立' },
      { label: '參考：發行張數', threshold: inp.sharesOutstanding != null ? `${fmtLot(inp.sharesOutstanding)}張` : '—', status: 'met' },
    ],
  }
  return {
    id: '4', name: '漲跌異常 + 高週轉',
    lawText: `6 日累積漲跌 > ${m.c3}% 且差幅 ≥20% 且 當日週轉率 ≥ ${m.turnover}%（與全體差 ≥ ${m.turnoverDiff}%）`,
    fired, first: false, blocked, badge: fired ? 'fired' : priceMet ? 'possible' : 'safe',
    headerThreshold: turnoverLot != null ? `收盤 ≥ ${t3} 且 量 ≥ ${fmtLot(turnoverLot)}張` : `收盤 ≥ ${t3} 且 週轉率 ≥ ${m.turnover}%`,
    groups: [priceGroup(inp, t3, m.c3), turnGroup],
    exclusions: [
      { label: '同類 < 5 種不適用', status: inp.sectorAvg6 == null ? 'met' : 'na' },
      { label: `PE 負或 ≥${m.pe}倍不適用`, status: (inp.pe != null && (inp.pe < 0 || inp.pe >= m.pe)) ? 'met' : 'na' },
    ],
  }
}

function c5(inp: ClauseInput): ClauseResult {
  const m = PCT[inp.market], t3 = t3Of(inp)
  const priceMet = inp.price >= t3
  const fired = priceMet && inp.c5Assume
  const blocked = priceMet && !inp.c5Assume
  return {
    id: '5', name: '漲跌異常 + 券商集中',
    lawText: `6 日累積漲跌 > ${m.c3}% 且差幅 ≥20% 且 單一券商受託買賣集中度 > ${m.brokerConc}%（每分支 +${m.brokerBranchAdd}%，上限 ${m.brokerConcCap}%）且 > ${m.brokerMinLot}張`,
    fired, first: false, blocked, badge: fired ? 'fired' : priceMet ? 'possible' : 'safe',
    headerThreshold: `收盤 ≥ ${t3}（且券商佔比 > ${m.brokerConc}%）`,
    groups: [
      priceGroup(inp, t3, m.c3),
      { title: '券商集中', threshold: `集中度 > ${m.brokerConc}%（非公開）`, status: inp.c5Assume ? 'assumed' : 'safe',
        subs: [{ label: '券商分點集中度', threshold: `> ${m.brokerConc}% 且 > ${m.brokerMinLot}張`, status: inp.c5Assume ? 'assumed' : 'safe', note: '券商分點全量無公開 API，假設達標' }] },
    ],
  }
}

function c6(inp: ClauseInput): ClauseResult {
  const m = PCT[inp.market]
  const peHit  = inp.pe  != null && (inp.pe < 0 || (inp.pe >= m.pe && (inp.mktPe == null || inp.pe > inp.mktPe * 2)))
  const pbrHit = inp.pbr != null && inp.pbr >= m.pbr && (inp.mktPbr == null || inp.pbr > inp.mktPbr * 2)
  const c6VolLot = inp.sharesOutstanding != null ? Math.max((m.c6Turnover / 100) * inp.sharesOutstanding, m.c6MinLot) : null
  const turn3Met = inp.dayVolume != null && c6VolLot != null && inp.dayVolume >= c6VolLot
  const priceHit = peHit && pbrHit && turn3Met
  const fired = priceHit && inp.c6Assume
  const blocked = priceHit && !inp.c6Assume
  return {
    id: '6', name: '本益比 / 股價淨值比異常',
    lawText: `當日同時：PE 負或 ≥${m.pe}倍(且>全體×2)、PBR ≥${m.pbr}倍(且>全體×2)、週轉率 ≥${m.c6Turnover}% 且量 ≥${m.c6MinLot}張、四項之一(產業PBR×${m.c6PbrMult}/券商或投資人集中)`,
    fired, first: false, blocked, badge: fired ? 'fired' : (peHit && pbrHit) ? 'possible' : 'safe',
    headerThreshold: (peHit && pbrHit) ? `PE ${inp.pe?.toFixed(1) ?? '—'} / PBR ${inp.pbr?.toFixed(2) ?? '—'} 等四項` : '不會觸發',
    groups: [
      { title: '項一 本益比', threshold: `PE 負 或 ≥${m.pe}倍且 >全體×2`, status: peHit ? 'met' : 'safe',
        subs: [{ label: 'PE', threshold: `<0 或 ≥${m.pe}（>全體均值×2）`, current: inp.pe != null ? inp.pe.toFixed(1) : '—', status: peHit ? 'met' : 'safe', note: inp.mktPe != null ? `全體中位數 ${inp.mktPe.toFixed(1)}` : undefined }] },
      { title: '項二 股價淨值比', threshold: `PBR ≥${m.pbr}倍且 >全體×2`, status: pbrHit ? 'met' : 'safe',
        subs: [{ label: 'PBR', threshold: `≥${m.pbr}（>全體均值×2）`, current: inp.pbr != null ? inp.pbr.toFixed(2) : '—', status: pbrHit ? 'met' : 'safe', note: inp.mktPbr != null ? `全體中位數 ${inp.mktPbr.toFixed(2)}` : undefined }] },
      { title: '項三 週轉率 + 量', threshold: c6VolLot != null ? `週轉率 ≥${m.c6Turnover}% 且 量 ≥ ${fmtLot(c6VolLot)}張` : `週轉率 ≥${m.c6Turnover}% 且 量 ≥${m.c6MinLot}張`, status: turn3Met ? 'met' : 'possible',
        subs: [{ label: '量', threshold: c6VolLot != null ? `≥ ${fmtLot(c6VolLot)}張` : `≥ ${m.c6MinLot}張`, current: inp.dayVolume != null ? `${fmtLot(inp.dayVolume)}張` : undefined, status: turn3Met ? 'met' : 'possible' }] },
      { title: '項四 三選一', threshold: `產業PBR×${m.c6PbrMult} / 券商或投資人集中 ≥10% 且 ≥1億`, status: inp.c6Assume ? 'assumed' : 'safe',
        subs: [{ label: '三選一', threshold: '多為非公開 / 缺產業PBR', status: inp.c6Assume ? 'assumed' : 'safe', note: '假設達標' }] },
    ],
    exclusions: [
      { label: 'IPO 無漲跌幅期間不計', status: 'unimpl' },
      { label: '非普通股不適用（本工具僅普通股）', status: 'na' },
      { label: '鉅額交易扣除（項三 / 項四(2)(3)）', status: 'unimpl' },
    ],
  }
}

export function evalClauses(inp: ClauseInput): ClauseResult[] {
  return [...c1(inp), c2(inp), c3(inp), c4(inp), c5(inp), c6(inp)]
}
export function summarize(rs: ClauseResult[]): { first: boolean; any: boolean } {
  return { first: rs.some(r => r.first && r.fired), any: rs.some(r => r.fired) }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd "C:/Users/user/chart-overlay" && npx vitest run lib/clauseEngine.test.ts`
Expected: PASS（全部）。

- [ ] **Step 5: Commit（僅在使用者要求時）**

```bash
git add lib/clauseEngine.ts lib/clauseEngine.test.ts
git commit -m "$(cat <<'EOF'
refactor(disposal): rewrite clause engine to 款一~六 with structured results

- ClauseResult 擴充 name/lawText/badge/headerThreshold/groups/exclusions
- 移除款十一/十二(gap11/c11/c12)、新增款四(週轉率硬量門檻)/款五(券商集中)
- 款三量門檻=5×近60日均量(張)、款四=門檻%×發行張數、款六項三=硬量門檻
- 款六 OR→AND(項一∧項二∧項三∧項四假設)修正法規解讀
- 量/股數一律「張」單位；雙市場 PCT(上市/上櫃)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 資料層新增 `fetchIssuedShares`（官方發行股數）

**Files:**
- Modify: `lib/disposal/marketData.ts`（追加函式，置於 `fetchSectorMap` 之後、`cumulativeMap` 之前）
- Modify: `lib/disposal/__tests__/marketData.test.ts`（追加純解析測試）

**背景（已核實的金鑰值）**：
- 上市 TWSE：`https://www.twse.com.tw/rwd/zh/fund/MI_QFIIS?response=json&date=YYYYMMDD&selectType=ALLBUT0999` → `j.stat==='OK'`、`j.data` 每列 `row[0]`=代號、`row[3]`=發行股數（字串含逗號）。**國巨 2327 = "2,071,465,484" 股**。整批可快取。
- 上櫃 TPEx：`https://www.tpex.org.tw/openapi/v1/tpex_3insti_qfii` → JSON array，每物件 `SecuritiesCompanyCode` + `NumberOfSharesIssued`（字串無逗號）。**環球晶 6488 = "478113725" 股**。整批可快取。
- 回傳「股」(raw)；UI 端 `÷1000` 換張。查無 → null（UI 退回假設開關）。

- [ ] **Step 1: 追加純解析輔助 + 測試（先寫會失敗的測試）**

`fetchIssuedShares` 會打網路、不單測；但把「列 → 股數」解析抽成可測純函式 `parseSharesTwse` / `parseSharesTpex` 並匯出。於 `lib/disposal/__tests__/marketData.test.ts` 末尾追加：

```ts
import { parseSharesTwse, parseSharesTpex } from '@/lib/disposal/marketData'

describe('parseSharesTwse（MI_QFIIS row[0]=代號 row[3]=發行股數）', () => {
  it('解析普通股、千分位逗號去除；過濾非普通股', () => {
    const rows = [
      ['2327', '國巨', 'x', '2,071,465,484'],
      ['0050', '元大台灣50', 'x', '1,000,000'],   // ETF → 過濾
      ['1101', '台泥', 'x', '6,000,000,000'],
    ] as string[][]
    const m = parseSharesTwse(rows)
    expect(m['2327']).toBe(2071465484)
    expect(m['1101']).toBe(6000000000)
    expect(m['0050']).toBeUndefined()
  })
})

describe('parseSharesTpex（NumberOfSharesIssued）', () => {
  it('解析普通股股數；過濾非普通股', () => {
    const arr = [
      { SecuritiesCompanyCode: '6488', NumberOfSharesIssued: '478113725' },
      { SecuritiesCompanyCode: '00679B', NumberOfSharesIssued: '123' }, // 債券ETF → 過濾
    ]
    const m = parseSharesTpex(arr)
    expect(m['6488']).toBe(478113725)
    expect(m['00679B']).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd "C:/Users/user/chart-overlay" && npx vitest run lib/disposal/__tests__/marketData.test.ts`
Expected: FAIL（`parseSharesTwse`/`parseSharesTpex` 未匯出）。

- [ ] **Step 3: 追加實作到 `lib/disposal/marketData.ts`**

在 `fetchSectorMap` 函式結尾 `}` 之後、`cumulativeMap` 之前插入：

```ts
/** MI_QFIIS 列 → { 普通股代號: 發行股數(股) }（row[0]=代號 row[3]=發行股數，去逗號） */
export function parseSharesTwse(rows: string[][]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of rows) {
    const code = String(row[0]).trim(); if (!isOrd(code)) continue
    const n = idxNum(row[3]); if (n == null || n <= 0) continue
    out[code] = n
  }
  return out
}
/** tpex_3insti_qfii 陣列 → { 普通股代號: 發行股數(股) } */
export function parseSharesTpex(arr: { SecuritiesCompanyCode?: string; NumberOfSharesIssued?: string }[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const x of arr) {
    const code = String(x.SecuritiesCompanyCode ?? '').trim(); if (!isOrd(code)) continue
    const n = idxNum(x.NumberOfSharesIssued); if (n == null || n <= 0) continue
    out[code] = n
  }
  return out
}

/** 全市場發行股數對照 { code: 股數(股) }；上市 MI_QFIIS、上櫃 tpex_3insti_qfii。快取 24h。失敗回 null。 */
export async function fetchIssuedShares(market: Market): Promise<Record<string, number> | null> {
  const key = `issuedshares:${market}`
  const cached = getCached(key); if (cached) return cached as Record<string, number>
  try {
    if (market === 'TWSE') {
      const ymd = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '')
      const res = await fetch(`https://www.twse.com.tw/rwd/zh/fund/MI_QFIIS?response=json&date=${ymd}&selectType=ALLBUT0999`, { headers: { 'User-Agent': UA } })
      if (res.ok) {
        const j = (await res.json()) as { stat?: string; data?: string[][] }
        if (j.stat === 'OK' && j.data?.length) {
          const out = parseSharesTwse(j.data)
          if (Object.keys(out).length) { setCached(key, out, 24 * 60 * 60 * 1000); return out }
        }
      }
    } else {
      const res = await fetch('https://www.tpex.org.tw/openapi/v1/tpex_3insti_qfii', { headers: { 'User-Agent': UA } })
      if (res.ok) {
        const arr = (await res.json()) as { SecuritiesCompanyCode?: string; NumberOfSharesIssued?: string }[]
        const out = parseSharesTpex(arr)
        if (Object.keys(out).length) { setCached(key, out, 24 * 60 * 60 * 1000); return out }
      }
    }
  } catch { /* 回 null */ }
  return null
}
```

> 註：MI_QFIIS 為「當日」報表，非交易日/盤前 `date` 可能查無 → `j.data` 空回 null。UI 端 null 時退回款四/六假設開關（不影響款一~三）。

- [ ] **Step 4: 跑測試確認通過**

Run: `cd "C:/Users/user/chart-overlay" && npx vitest run lib/disposal/__tests__/marketData.test.ts`
Expected: PASS（含既有 cumulativeMap/eqAvg 測試）。

- [ ] **Step 5: Commit（僅在使用者要求時）**

```bash
git add lib/disposal/marketData.ts lib/disposal/__tests__/marketData.test.ts
git commit -m "$(cat <<'EOF'
feat(disposal): add fetchIssuedShares (官方發行股數, 24h cache)

上市 MI_QFIIS row[3] / 上櫃 tpex_3insti_qfii NumberOfSharesIssued；
抽 parseSharesTwse/parseSharesTpex 純函式供單測（國巨 2327=2,071,465,484 股）。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 新增 `/api/shares` 代理路由

**Files:**
- Create: `app/api/shares/route.ts`
- Test: 無單元測試（薄代理，行為由 `fetchIssuedShares` 測試覆蓋）；以 Step 3 手動 smoke。

**背景**：鏡像 `app/api/peratio/route.ts` 模式（整批抓、快取、單檔查 `code`）。回 `{ shares: number | null }`（股）。

- [ ] **Step 1: 建立路由（完整實作）**

寫入 `app/api/shares/route.ts`：

```ts
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
```

- [ ] **Step 2: 確認可建置（型別）**

Run: `cd "C:/Users/user/chart-overlay" && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "api/shares" || echo "shares route: no type errors"`
Expected: `shares route: no type errors`（注意：因 Task 1 已改 DisposalTool 相依，`tsc` 整體仍會有 DisposalTool 錯誤，這是預期的；此步只看 shares route 本身無錯）。

- [ ] **Step 3: Smoke（dev server 起得來時；起不來可跳過，Task 8 整合驗證）**

Run（背景啟 dev、查國巨）:
```bash
cd "C:/Users/user/chart-overlay" && curl -s "http://localhost:3000/api/shares?market=TWSE&code=2327" || echo "(dev server 未啟動，略過 smoke)"
```
Expected（dev 有起時）：`{"shares":2071465484}` 或近似值（發行股數可能因增減資微調）。

- [ ] **Step 4: Commit（僅在使用者要求時）**

```bash
git add app/api/shares/route.ts
git commit -m "$(cat <<'EOF'
feat(api): add /api/shares 發行股數代理（鏡像 peratio 模式）

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: DisposalTool 接線（state + doImport×2 + evalCard）

**Files:**
- Modify: `components/DisposalTool.tsx`

**背景**：移除款十二(sbl)/款三手動 `clause3VolMet` 開關 state，新增發行股數/盤中量/即時價 state 與 `c3Assume/c4Assume/c5Assume` 開關；`doImport` 與 `importFromList` 兩段抓 shares、從**原始** `json.data`（未經 `dropUnclosedToday`）取計算日(predictDay)那根的 `volume`/`value` 當盤中量/即時價；`evalCard` 改餵新欄位並 股→張。此 Task 後 `npm run build` 仍紅（面板尚未換、Task 6 才綠）；驗證以 `npm test` 為準。

- [ ] **Step 1: 替換款三/六/十二 state 宣告（lines 379–389）**

把這段（行 379–389）：

```tsx
  // 款三：最近 60 日均量（股）；卡 0「假設當日量達 5×均量」開關
  const [avg60Vol,     setAvg60Vol]     = useState<number | null>(null)
  const [clause3VolMet, setClause3VolMet] = useState(false)

  // 款六：PE/PBR 資料
  const [peData, setPeData] = useState<{ pe:number|null; pbr:number|null; mktPe:number|null; mktPbr:number|null }|null>(null)
  const [clause6Assume, setClause6Assume] = useState(false)

  // 款十二：借券資料
  const [sblData, setSblData] = useState<{ rate:number|null; amp:number|null }|null>(null)
  const [clause12Assume, setClause12Assume] = useState(false)
```

換成：

```tsx
  // 款三：最近 60 日均量（股）
  const [avg60Vol, setAvg60Vol] = useState<number | null>(null)
  // 發行股數（股，raw）；計算日(盤中)累積量與即時價
  const [sharesOutstanding, setSharesOutstanding] = useState<number | null>(null)
  const [dayVolume, setDayVolume] = useState<number | null>(null)   // 計算日盤中累積量（股）
  const [livePrice, setLivePrice] = useState<number | null>(null)   // 計算日盤中即時價

  // 款六：PE/PBR 資料
  const [peData, setPeData] = useState<{ pe:number|null; pbr:number|null; mktPe:number|null; mktPbr:number|null }|null>(null)

  // 殘差「次要條件假設成立」開關：款三/四 預設開（絕對門檻必綁定），款五/六 預設關（整段非公開）
  const [c3Assume, setC3Assume] = useState(true)
  const [c4Assume, setC4Assume] = useState(true)
  const [c5Assume, setC5Assume] = useState(false)
  const [clause6Assume, setClause6Assume] = useState(false)
```

- [ ] **Step 2: 改 `doImport` 抓量/股數區塊（lines 437–458）**

把這段（行 437–458，`const all = dropUnclosedToday(...)` 起到款十二 fetch 區塊結束）：

```tsx
          const all = dropUnclosedToday(json.data as { date: string; value: number; volume?: number }[])
          setPriceHistory(all)
          // 款三：最近 60 日均量（股）。當日為變數，用已知歷史日均量當基準
          const vols = all.slice(-60).map(d => d.volume).filter((v): v is number => typeof v === 'number' && v > 0)
          setAvg60Vol(vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : null)
          setClause3VolMet(false)
          const recent = all.slice(-6)
          const newDays: DayEntry[] = recent.map(d => ({
            baseDateStr: d.date,
            bp: Math.round(d.value * 10) / 10,
          }))
          setDays(newDays)
          setSimPrices(newDays.map(() => null))
          stockOk = true
          // 款六：抓 PE/PBR
          fetch(`/api/peratio?market=${json.market}&code=${code}&date=${todayTD.replace(/-/g,'')}`).then(r=>r.json()).then(setPeData).catch(()=>setPeData(null))
          // 款十二：借券率/放大
          {
            const winYMDs = all.slice(-6).map(d => d.date.replace(/-/g,''))
            const ampYMDs = all.slice(-20).map(d => d.date.replace(/-/g,''))
            fetch(`/api/sbl?market=${json.market}&code=${code}&win=${winYMDs.join(',')}&amp=${ampYMDs.join(',')}`).then(r=>r.json()).then(setSblData).catch(()=>setSblData(null))
          }
```

換成：

```tsx
          const raw = json.data as { date: string; value: number; volume?: number }[]
          const all = dropUnclosedToday(raw)
          setPriceHistory(all)
          // 款三：最近 60 日均量（股）。當日為變數，用已知歷史日均量當基準
          const vols = all.slice(-60).map(d => d.volume).filter((v): v is number => typeof v === 'number' && v > 0)
          setAvg60Vol(vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : null)
          // 計算日(predictDay)盤中：從原始資料(未丟今天那根)取該日 volume(累積量,股)/value(即時價)
          {
            const bar = raw.find(b => b.date === predictDay)
            setDayVolume(typeof bar?.volume === 'number' ? bar.volume : null)
            setLivePrice(typeof bar?.value === 'number' ? bar.value : null)
          }
          const recent = all.slice(-6)
          const newDays: DayEntry[] = recent.map(d => ({
            baseDateStr: d.date,
            bp: Math.round(d.value * 10) / 10,
          }))
          setDays(newDays)
          setSimPrices(newDays.map(() => null))
          stockOk = true
          // 款六：抓 PE/PBR
          fetch(`/api/peratio?market=${json.market}&code=${code}&date=${todayTD.replace(/-/g,'')}`).then(r=>r.json()).then(setPeData).catch(()=>setPeData(null))
          // 款四/六：抓發行股數（股）
          fetch(`/api/shares?market=${json.market}&code=${code}`).then(r=>r.json()).then(d=>setSharesOutstanding(d.shares ?? null)).catch(()=>setSharesOutstanding(null))
```

- [ ] **Step 3: 改 `importFromList` 對應區塊（lines 543–559）**

把這段（行 543–559）：

```tsx
          const all = dropUnclosedToday(json.data as { date: string; value: number; volume?: number }[])
          setPriceHistory(all)
          // 款三：最近 60 日均量（股）。當日為變數，用已知歷史日均量當基準
          const vols = all.slice(-60).map(d => d.volume).filter((v): v is number => typeof v === 'number' && v > 0)
          setAvg60Vol(vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : null)
          setClause3VolMet(false)
          const recent = all.slice(-6)
          const newDays: DayEntry[] = recent.map(d => ({ baseDateStr: d.date, bp: Math.round(d.value * 10) / 10 }))
          setDays(newDays); setSimPrices(newDays.map(() => null)); stockOk = true
          // 款六：抓 PE/PBR
          fetch(`/api/peratio?market=${json.market}&code=${code}&date=${todayTD.replace(/-/g,'')}`).then(r=>r.json()).then(setPeData).catch(()=>setPeData(null))
          // 款十二：借券率/放大
          {
            const winYMDs = all.slice(-6).map(d => d.date.replace(/-/g,''))
            const ampYMDs = all.slice(-20).map(d => d.date.replace(/-/g,''))
            fetch(`/api/sbl?market=${json.market}&code=${code}&win=${winYMDs.join(',')}&amp=${ampYMDs.join(',')}`).then(r=>r.json()).then(setSblData).catch(()=>setSblData(null))
          }
```

換成：

```tsx
          const raw = json.data as { date: string; value: number; volume?: number }[]
          const all = dropUnclosedToday(raw)
          setPriceHistory(all)
          // 款三：最近 60 日均量（股）。當日為變數，用已知歷史日均量當基準
          const vols = all.slice(-60).map(d => d.volume).filter((v): v is number => typeof v === 'number' && v > 0)
          setAvg60Vol(vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : null)
          {
            const bar = raw.find(b => b.date === predictDay)
            setDayVolume(typeof bar?.volume === 'number' ? bar.volume : null)
            setLivePrice(typeof bar?.value === 'number' ? bar.value : null)
          }
          const recent = all.slice(-6)
          const newDays: DayEntry[] = recent.map(d => ({ baseDateStr: d.date, bp: Math.round(d.value * 10) / 10 }))
          setDays(newDays); setSimPrices(newDays.map(() => null)); stockOk = true
          // 款六：抓 PE/PBR
          fetch(`/api/peratio?market=${json.market}&code=${code}&date=${todayTD.replace(/-/g,'')}`).then(r=>r.json()).then(setPeData).catch(()=>setPeData(null))
          // 款四/六：抓發行股數（股）
          fetch(`/api/shares?market=${json.market}&code=${code}`).then(r=>r.json()).then(d=>setSharesOutstanding(d.shares ?? null)).catch(()=>setSharesOutstanding(null))
```

- [ ] **Step 4: 改 `evalCard`（lines 731–741）股→張、餵新欄位**

把這段（行 731–741）：

```tsx
  // 組裝單卡引擎輸入並評估
  const evalCard = (i: number, price: number): ClauseResult[] => evalClauses({
    market, prevClose: prevCloseOf(i), sumKnown: knownSumOf(i), price,
    spreadBase: spreadBaseOf(i),
    marketAvg6: mAvgEff,
    sectorAvg6: sAvgPct,
    c2: i === 0 ? clause2ForEngine() : null,
    volMet: i === 0 && clause3VolMet,
    pe: i === 0 ? pePredict(price) : null, pbr: i === 0 ? pbrPredict(price) : null, mktPe: peData?.mktPe ?? null, mktPbr: peData?.mktPbr ?? null, c6Assume: i === 0 && clause6Assume,
    sblRate: i === 0 ? (sblData?.rate ?? null) : null, sblAmp: i === 0 ? (sblData?.amp ?? null) : null, c12Assume: i === 0 && clause12Assume,
  })
```

換成：

```tsx
  // 組裝單卡引擎輸入並評估（量/股數 股→張；款三~六僅卡 0=計算日有意義）
  const evalCard = (i: number, price: number): ClauseResult[] => evalClauses({
    market, prevClose: prevCloseOf(i), sumKnown: knownSumOf(i), price,
    spreadBase: spreadBaseOf(i),
    marketAvg6: mAvgEff,
    sectorAvg6: sAvgPct,
    c2: i === 0 ? clause2ForEngine() : null,
    pe: i === 0 ? pePredict(price) : null, pbr: i === 0 ? pbrPredict(price) : null,
    mktPe: peData?.mktPe ?? null, mktPbr: peData?.mktPbr ?? null,
    dayVolume:         i === 0 && dayVolume != null ? dayVolume / 1000 : null,                 // 股→張
    avgVol60:          i === 0 && avg60Vol != null ? avg60Vol / 1000 : null,                   // 股→張
    sharesOutstanding: i === 0 && sharesOutstanding != null ? sharesOutstanding / 1000 : null, // 股→張
    c3Assume: i === 0 && c3Assume,
    c4Assume: i === 0 && c4Assume,
    c5Assume: i === 0 && c5Assume,
    c6Assume: i === 0 && clause6Assume,
  })
```

- [ ] **Step 5: 跑既有測試（不應回歸）**

Run: `cd "C:/Users/user/chart-overlay" && npm test`
Expected: PASS（vitest 不做完整 type-check，引擎/資料層測試全綠）。

> ⚠️ 此時 `npm run build` 仍會因 DisposalTool 尚有 `gap11`/舊面板引用而紅 → Task 6 修復。

- [ ] **Step 6: Commit（僅在使用者要求時）**

```bash
git add components/DisposalTool.tsx
git commit -m "$(cat <<'EOF'
feat(disposal): wire 發行股數/盤中量/即時價 into evalCard

- 移除款十二(sbl)/款三手動量達標 state；新增 sharesOutstanding/dayVolume/livePrice
- 殘差假設開關 c3/c4(預設開) c5/c6(預設關)
- doImport/importFromList 抓 /api/shares + 從原始bar取計算日盤中量/價
- evalCard 量/股數 股→張 後餵新引擎

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 新增 `AttentionDetailPanel` 元件

**Files:**
- Create: `components/disposal/AttentionDetailPanel.tsx`

**背景**：近乎純渲染 `evalClauses(0,…)` 的 `ClauseResult[]`。把 `1①/1②` 合成一張「款一」卡（兩子段落），其餘 1:1，共 **6 張可收合卡片**。收合顯示 `headerThreshold`＋燈號；展開顯示 `groups`（每群門檻＋逐列現值）＋`exclusions`。`assumed` 群下方出現「假設達標」開關。

- [ ] **Step 1: 建立元件（完整實作）**

寫入 `components/disposal/AttentionDetailPanel.tsx`：

```tsx
'use client'
import { useState } from 'react'
import type { ClauseResult, CondStatus } from '@/lib/clauseEngine'

type AssumeKey = 'c3' | 'c4' | 'c5' | 'c6'
interface Props {
  results: ClauseResult[]                       // evalCard(0, price0)
  calcDateLabel: string                         // 如 "6/02"
  statusLabel: string                           // "盤中即時" | "預估"
  assume: Record<AssumeKey, boolean>
  onToggleAssume: (k: AssumeKey) => void
}

const BADGE: Record<ClauseResult['badge'], { txt: string; cls: string }> = {
  fired:    { txt: '已觸發',   cls: 'bg-red-900/50 text-red-300 border-red-700' },
  possible: { txt: '可能觸發', cls: 'bg-orange-900/50 text-orange-300 border-orange-700' },
  safe:     { txt: '無風險',   cls: 'bg-green-900/50 text-green-300 border-green-700' },
}
const STATUS: Record<CondStatus, { txt: string; cls: string }> = {
  met:      { txt: '已達',     cls: 'text-red-300' },
  possible: { txt: '可能',     cls: 'text-orange-300' },
  safe:     { txt: '未達',     cls: 'text-green-400' },
  assumed:  { txt: '假設',     cls: 'text-sky-300' },
  raised:   { txt: '拉高門檻', cls: 'text-purple-300' },
}
const rank: Record<ClauseResult['badge'], number> = { safe: 0, possible: 1, fired: 2 }

// 6 張卡片：款一合 1①/1②，其餘 1:1
const CARDS: { key: string; label: string; ids: ClauseResult['id'][]; assumeKey?: AssumeKey }[] = [
  { key: '1', label: '款一', ids: ['1①', '1②'] },
  { key: '2', label: '款二', ids: ['2'] },
  { key: '3', label: '款三', ids: ['3'], assumeKey: 'c3' },
  { key: '4', label: '款四', ids: ['4'], assumeKey: 'c4' },
  { key: '5', label: '款五', ids: ['5'], assumeKey: 'c5' },
  { key: '6', label: '款六', ids: ['6'], assumeKey: 'c6' },
]

function StatusPill({ s }: { s: CondStatus }) {
  return <span className={`text-[11px] font-semibold ${STATUS[s].cls}`}>{STATUS[s].txt}</span>
}

function ClauseBody({ r }: { r: ClauseResult }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-gray-500 leading-snug">
        <span className="inline-block px-1 mr-1 rounded bg-gray-800 text-gray-400">法規</span>{r.lawText}
      </p>
      {r.groups.map((g, gi) => (
        <div key={gi} className="rounded-lg border border-gray-800 bg-gray-900/40 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-gray-200">{g.title}</span>
            <span className="text-[11px] text-gray-400">{g.threshold}</span>
            <StatusPill s={g.status} />
          </div>
          <ul className="mt-1 space-y-0.5">
            {g.subs.map((s, si) => (
              <li key={si} className="flex items-baseline gap-1.5 text-[11px]">
                <span className="text-gray-400 shrink-0">{s.label}</span>
                <span className="text-gray-500">{s.threshold}</span>
                {s.current && <span className="text-gray-200 font-medium">{s.current}</span>}
                <StatusPill s={s.status} />
                {s.note && <span className="text-gray-600">— {s.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {r.exclusions && r.exclusions.length > 0 && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-gray-500 hover:text-gray-300">除外條件（{r.exclusions.length}）</summary>
          <ul className="mt-1 space-y-0.5 pl-2">
            {r.exclusions.map((e, ei) => (
              <li key={ei} className="flex items-center gap-1.5">
                <span className={e.status === 'met' ? 'text-amber-400' : e.status === 'unimpl' ? 'text-gray-600' : 'text-gray-500'}>
                  {e.status === 'met' ? '✓' : e.status === 'unimpl' ? '—' : '·'}
                </span>
                <span className="text-gray-500">{e.label}</span>
                {e.status === 'unimpl' && <span className="text-gray-700">(未實作)</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

export default function AttentionDetailPanel({ results, calcDateLabel, statusLabel, assume, onToggleAssume }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const byId = (id: ClauseResult['id']) => results.find(r => r.id === id)

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-bold text-gray-200 uppercase tracking-wider">🔎 注意細節條件</p>
        <span className="text-xs text-gray-500">計算日 {calcDateLabel}・{statusLabel}</span>
      </div>
      <div className="space-y-1.5">
        {CARDS.map(card => {
          const rs = card.ids.map(byId).filter((r): r is ClauseResult => !!r)
          if (rs.length === 0) return null
          const badge = rs.reduce((b, r) => rank[r.badge] > rank[b] ? r.badge : b, 'safe' as ClauseResult['badge'])
          const isOpen = !!open[card.key]
          const showToggle = !!card.assumeKey && rs.some(r => r.groups.some(g => g.status === 'assumed'))
          return (
            <div key={card.key} className="rounded-xl border border-gray-700 bg-gray-900/60">
              <button
                onClick={() => setOpen(o => ({ ...o, [card.key]: !o[card.key] }))}
                className="w-full flex items-center gap-2 px-3 py-2 text-left">
                <span className="text-sm font-bold text-gray-100 shrink-0">{card.label}</span>
                <span className="text-[11px] text-gray-400 truncate flex-1">
                  {rs.map(r => r.headerThreshold).join('　')}
                </span>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${BADGE[badge].cls}`}>{BADGE[badge].txt}</span>
                <span className="text-gray-500 text-xs shrink-0">{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen && (
                <div className="px-3 pb-3 space-y-3 border-t border-gray-800 pt-2">
                  {rs.map(r => (
                    <div key={r.id}>
                      {card.ids.length > 1 && <p className="text-xs font-semibold text-gray-300 mb-1">{r.id}　{r.name}</p>}
                      <ClauseBody r={r} />
                    </div>
                  ))}
                  {showToggle && card.assumeKey && (
                    <button
                      onClick={() => onToggleAssume(card.assumeKey!)}
                      className={`self-start text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                        assume[card.assumeKey] ? 'bg-orange-900/50 text-orange-200 border-orange-600'
                                               : 'bg-gray-800 text-gray-300 border-gray-700 hover:border-gray-500'}`}>
                      {assume[card.assumeKey] ? '☑ 次要條件假設成立（已計入處置模擬）' : '☐ 假設次要條件成立'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <p className="text-[11px] text-gray-600 mt-2">收合顯示門檻總結＋燈號；展開看逐項條件。款三~六僅對計算日有意義。</p>
    </section>
  )
}
```

- [ ] **Step 2: 確認元件型別自洽**

Run: `cd "C:/Users/user/chart-overlay" && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "AttentionDetailPanel" || echo "panel: no own type errors"`
Expected: `panel: no own type errors`（DisposalTool 其他錯誤此步忽略，Task 6 修）。

- [ ] **Step 3: Commit（僅在使用者要求時）**

```bash
git add components/disposal/AttentionDetailPanel.tsx
git commit -m "$(cat <<'EOF'
feat(disposal): add AttentionDetailPanel (6 collapsible 款一~六 cards)

近乎純渲染 ClauseResult[]：收合門檻總結+燈號、展開逐項 groups/除外、
assumed 群下「假設達標」開關。款一合 1①/1②。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 整合面板 + 移除舊表格/舊面板/款十一 badge（恢復 build 綠）

**Files:**
- Modify: `components/DisposalTool.tsx`

**背景**：把新面板放回「近 6 日收盤價」表格的位置（行 869–917 區塊），移除整個 `clause3Panel`（行 1124–1217）與其渲染（行 1463）、grid 內款十一 badge（行 1022–1031）、`gap11` import、死碼 `CLAUSE3_VOL_MULT`。完成後 `npm run build` 應綠。

- [ ] **Step 1: 改 import（line 4）移除 `gap11`，加新元件**

把：

```tsx
import { evalClauses, summarize, gap11, type ClauseResult } from '@/lib/clauseEngine'
```

換成：

```tsx
import { evalClauses, summarize, type ClauseResult } from '@/lib/clauseEngine'
import AttentionDetailPanel from '@/components/disposal/AttentionDetailPanel'
```

- [ ] **Step 2: 移除死碼常數 `CLAUSE3_VOL_MULT`（line 110–111）**

把：

```tsx
// 款三量門檻：當日量 ≥ 最近 60 日均量的此倍數
const CLAUSE3_VOL_MULT = 5
```

整段刪除（引擎已內含 `volMult`，此常數於移除 `clause3Panel` 後無引用）。

- [ ] **Step 3: 換掉「近 6 日收盤價」表格 section（lines 869–917）**

把整個 section（行 869 `{/* ── 基準日 / 收盤價 ── */}` 起，到行 917 `</section>` 止）換成：

```tsx
      {/* ── 注意細節條件（取代近 6 日收盤價表格）── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-gray-200 uppercase tracking-wider">📋 近 6 日 / 計算日</p>
          <div className="flex gap-1.5">
            <button onClick={addDay}
              className="text-sm px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 border border-gray-700 transition-colors">＋</button>
            <button onClick={removeLastDay} disabled={days.length <= 1}
              className="text-sm px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 border border-gray-700 disabled:opacity-40 transition-colors">－</button>
            <button onClick={resetSim}
              className="text-sm px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 border border-gray-700 transition-colors">重設</button>
          </div>
        </div>
        {days.length > 0 && (
          <AttentionDetailPanel
            results={evalCard(0, simPrices[0] ?? livePrice ?? startPrice)}
            calcDateLabel={calcMD(days[0])}
            statusLabel={!tdClosed && dayVolume != null ? '盤中即時' : '預估'}
            assume={{ c3: c3Assume, c4: c4Assume, c5: c5Assume, c6: clause6Assume }}
            onToggleAssume={k => {
              if (k === 'c3') setC3Assume(v => !v)
              else if (k === 'c4') setC4Assume(v => !v)
              else if (k === 'c5') setC5Assume(v => !v)
              else setClause6Assume(v => !v)
            }}
          />
        )}
      </section>
```

> 註：每日 t1/t2 門檻仍可在右側互動沙盤每張卡的「注意≥」badge 看到（grid 保留），故移除唯讀表不損資訊。

- [ ] **Step 4: 移除 grid 內款十一 badge（lines 1022–1031）**

把這段（行 1022–1031，緊接在「款二解豁」badge 之後的 IIFE）：

```tsx
              {(() => {
                const g11 = gap11(market, dispPrice)
                const t11 = clTick(spreadBaseOf(i)) + g11
                return (
                  <span title={`起迄價差≥${g11}元(收盤≥${market === 'TPEx' ? 300 : 500}每+${market === 'TPEx' ? 15 : 25}加級距) → 收盤約≥${fNum(t11)}`}
                    className="text-xs px-1.5 py-0.5 rounded bg-orange-950/60 text-orange-400 border border-orange-800/60">
                    款十一 價差≥{g11}
                  </span>
                )
              })()}
```

整段刪除。

- [ ] **Step 5: 移除整個 `clause3Panel` 定義（lines 1123–1217）**

把行 1123 `/* ── 款三/四/五/七：需「當日量/籌碼」… */` 起到行 1217 `})()` 止（整個 `const clause3Panel = (() => { … })()`）刪除。

- [ ] **Step 6: 移除 `{clause3Panel}` 渲染（line 1463）**

把（行 1461–1463）：

```tsx
          {grid}

          {clause3Panel}
```

換成：

```tsx
          {grid}
```

- [ ] **Step 7: 跑 lint/型別 + build（CI gate 恢復綠）**

Run: `cd "C:/Users/user/chart-overlay" && npm run build`
Expected: 建置成功（無型別錯誤、無未使用 `clTick`/`gap11`/`CLAUSE3_VOL_MULT` 殘留報錯）。
> 若報「`clTick` 未使用」：確認 grid/其他處仍用 `clTick`（line 1024 已移除，但 thresh 內等仍用）；若真未使用則一併移除其宣告。實際以 build 訊息為準逐一清乾淨。

- [ ] **Step 8: Commit（僅在使用者要求時）**

```bash
git add components/DisposalTool.tsx
git commit -m "$(cat <<'EOF'
feat(disposal): replace 近6日表格 with AttentionDetailPanel; drop 款十一 badge & clause3Panel

- 注意細節條件面板接 evalCard(0)，盤中帶即時價/狀態
- 移除款十一價差 badge、clause3Panel(假設開關已折進卡片)、gap11 import、死碼常數
- build 綠燈恢復

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 對拍 attstock 黃金值（量門檻）整合測試

**Files:**
- Modify: `lib/clauseEngine.test.ts`（追加 describe）

**背景**：以已核實的官方資料對拍——國巨 2327 發行 2,071,465,484 股 → 0.10× → **款四量門檻 207,147 張**（attstock 截圖一致）。款三以公式對拍（5×均量）。

- [ ] **Step 1: 追加黃金值測試（先寫）**

於 `lib/clauseEngine.test.ts` 末尾追加：

```ts
describe('對拍 attstock 黃金值（量門檻）', () => {
  // 國巨 2327：發行 2,071,465,484 股 = 2,071,465.484 張；上市款四 10% → 207,146.55 張 → 顯示 207,147 張
  it('款四 0.1×發行張數 = 207,147 張（對拍 attstock）', () => {
    const r = evalClauses({ ...base, price: 130, sharesOutstanding: 2_071_465.484 })
    expect(find(r, '4').headerThreshold).toContain('207,147張')
  })
  it('款四 量達 207,147 張即觸發、206,000 張不觸發', () => {
    const inp = { ...base, price: 130, sharesOutstanding: 2_071_465.484, c4Assume: true }
    expect(find(evalClauses({ ...inp, dayVolume: 207_147 }), '4').fired).toBe(true)
    expect(find(evalClauses({ ...inp, dayVolume: 206_000 }), '4').fired).toBe(false)
  })
  it('款三 5×近60日均量公式（均量 48,873.4 張 → 244,367 張）', () => {
    const r = evalClauses({ ...base, price: 130, avgVol60: 48_873.4 })
    expect(find(r, '3').headerThreshold).toContain('244,367張')
  })
  it('另一種算法對拍：量門檻/發行張數 = 門檻週轉率%', () => {
    const shares = 2_071_465.484, thLot = 0.10 * shares
    expect(thLot / shares * 100).toBeCloseTo(10, 6) // 反推回 10%
  })
})
```

- [ ] **Step 2: 跑測試確認通過**

Run: `cd "C:/Users/user/chart-overlay" && npx vitest run lib/clauseEngine.test.ts`
Expected: PASS（全部，含黃金值）。
> 若 `207,147` 不符：檢查 `fmtLot` 用 `Math.round`（207,146.55→207,147）；`toLocaleString('en-US')` 產生半形逗號。

- [ ] **Step 3: Commit（僅在使用者要求時）**

```bash
git add lib/clauseEngine.test.ts
git commit -m "$(cat <<'EOF'
test(disposal): 對拍 attstock 量門檻黃金值（款四 207,147張 / 款三 5×均量）

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 全測試 + build gate + 清理 + 文檔

**Files:**
- Modify: `docs/PROJECT_NOTES.md`（追加）
- （選擇性）Delete: `app/api/sbl/route.ts`（款十二移除後孤兒；確認無其他引用再刪）

- [ ] **Step 1: 全測試 + build 綠**

Run: `cd "C:/Users/user/chart-overlay" && npm test && npm run build`
Expected: vitest 全綠（含既有 58+ 測試不回歸）、`next build` 成功。

- [ ] **Step 2: 確認 `/api/sbl` 是否孤兒並處理**

Run: `cd "C:/Users/user/chart-overlay" && grep -rn "api/sbl\|/sbl" app components lib --include=*.ts --include=*.tsx | grep -v "app/api/sbl/route.ts" || echo "no remaining /api/sbl references"`
Expected: `no remaining /api/sbl references`。
- 若無引用：刪除 `app/api/sbl/route.ts`（及其相依 lib，若該 lib 僅被它用——先 grep 確認）。
- 若仍有引用：保留，於本步註記待後續。

- [ ] **Step 3: 更新 PROJECT_NOTES.md**

在 `docs/PROJECT_NOTES.md` 適當段落（處置工具相關）追加：

```markdown
## 注意細節條件面板（2026-05-30）
- 引擎 `lib/clauseEngine.ts` 收斂為款一~六：移除款十一(價差級距)/款十二(借券)，新增款四(週轉率硬量門檻)/款五(券商集中)。
- 款三量門檻 = 5×近60日均量(張)；款四 = 門檻%×發行張數（上市10%/上櫃5%）；款六項三 = max(5%×發行張數, 3000/2000張)。**當日週轉率 = 成交量 ÷ 發行股數** → 第二條件反推成硬量門檻，盤中即時比對。
- 款六改 OR→AND（項一∧項二∧項三∧項四假設），貼法規「同時達」。
- 殘差(全市場量/週轉率均值比較)以「次要條件假設成立」開關帶過：c3/c4 預設開（絕對門檻必綁定）、c5/c6 預設關（整段非公開）。
- 發行股數：上市 MI_QFIIS `row[3]`、上櫃 tpex_3insti_qfii `NumberOfSharesIssued`（`fetchIssuedShares`，24h 快取，經 `/api/shares`）。國巨 2327=2,071,465,484 股 → 款四門檻 207,147 張（對拍 attstock）。
- UI：`components/disposal/AttentionDetailPanel.tsx` 6 張可收合卡片，錨定計算日，盤中帶 Yahoo 即時價＋累積量。引擎為唯一真相來源，面板近乎純渲染。
- 單位：引擎一律「張」，UI 在 evalCard 呼叫點 股→張(÷1000)。
```

- [ ] **Step 4: 最終全測試 + build 再確認**

Run: `cd "C:/Users/user/chart-overlay" && npm test && npm run build`
Expected: 皆綠。

- [ ] **Step 5: Commit（僅在使用者要求時）**

```bash
git add docs/PROJECT_NOTES.md app/api/sbl/route.ts
git commit -m "$(cat <<'EOF'
chore(disposal): update PROJECT_NOTES; remove orphaned /api/sbl (款十二)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## 風險與注意

1. **build 紅燈視窗（Task 1→6）**：引擎介面改動後 DisposalTool 暫時型別錯，屬預期；Task 1~5 以 `npm test`(vitest) 為關卡，Task 6/8 恢復 build 綠。subagent 執行時，spec/code reviewer 不應以「build 紅」否決 Task 1~5（但 vitest 必須綠）。
2. **發行股數可能查無**（非交易日/盤前 MI_QFIIS 空、上櫃端點偶發）：`fetchIssuedShares` 回 null → UI `sharesOutstanding=null` → 款四/六量門檻不可算 → 退回假設開關語意（款四 headerThreshold 顯示「週轉率 ≥10%」而非張數）。屬正常降級。
3. **款六 AND 解讀**：以法規「同時達」落地（修正既有 OR bug），須 attstock 對拍；若 attstock 較寬鬆，回頭調整 c6 並補測試（spec §10/§11#4）。
4. **盤中量定案差異**：`dayVolume` 為盤中累積即時值，最終以收盤定案為準；面板 `statusLabel` 標「盤中即時 / 預估」避免誤判（spec §6）。
5. **上櫃小型股（實收資本<8000萬）** 本輪不特判（缺實收資本資料），一律套差幅閘門；列為已知差異，待 attstock 對拍若偏差再處理（spec §11#7）。
6. **`clTick`/其他 helper 是否變孤兒**：移除款十一 badge 後逐一以 build 訊息確認，未使用就刪，避免 lint 報錯。
