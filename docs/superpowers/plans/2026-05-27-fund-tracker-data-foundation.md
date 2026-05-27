# 基金經理人持股追蹤 — 資料地基 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 chart-overlay 內建一個隔離的 `lib/fund/` 資料層 + 讀取 API + 前端視圖，先用 JOY88 歷史種子（2023Q1→2026Q1 季報、2025-03→2026-04 月報）跑通端到端，再逐投信補上 live 爬蟲；最後才把 mode 接進主程式。

**Architecture:** 沿用 chart-overlay 慣例（`lib/*Store` disk+memory fallback、`app/api/*` route、`components/*View`）。資料層集中在 `lib/fund/` 子目錄保持隔離（合併最後處理）。基金月/季報存 `data/funds/`（committed、SITCA 歷史抓不回來）；ETF 每日存 `.funddata/etf/`（gitignore、可重抓）。

**Tech Stack:** Next.js 16 App Router、TypeScript、vitest（新增）、xlsx(SheetJS)、puppeteer-extra + stealth（統一/Nuxt 來源，本機限定）。

**先決閱讀：** chart-overlay 的 `AGENTS.md` 警告「This is NOT the Next.js you know」→ 寫任何 route 前先讀 `node_modules/next/dist/docs/` 對應 App Router Route Handler 指南。

**Spec：** `docs/superpowers/specs/2026-05-27-fund-tracker-data-foundation-design.md`

**種子資料位置：** `C:\Users\user\joy88-seed\`（14 檔，已驗證）。

---

## 檔案結構（本計畫建立/修改）

```
建立：
  lib/fund/types.ts            FundSnapshot / FundHolding / FundDef 型別
  lib/fund/sources.ts          13 基金 + 6 ETF registry（ASCII slug 映射）
  lib/fund/store.ts            快照存取（disk+memory，仿 chipsStore）
  lib/fund/period.ts           JOY88 period（202604/202603）→ 我們格式（2026-04 / 2026-Q1）
  lib/fund/seed.ts             holdings.json + fund-info.json → FundSnapshot[]
  lib/fund/query.ts            純查詢：單基金 / 跨基金個股分佈 / 雙軌比對
  lib/fund/timegate.ts         18:30 台灣時間閘門（純函式）
  lib/fund/parse/sitca.ts      SITCA HTML → FundSnapshot（Part 5）
  lib/fund/parse/etfApi.ts     野村/群益 JSON → FundSnapshot（Part 5）
  lib/fund/parse/fuhuaXlsx.ts  復華 Excel → FundSnapshot（Part 5）
  lib/fund/parse/uniStealth.ts 統一 stealth → FundSnapshot（Part 5）
  lib/fund/__tests__/*.test.ts vitest 測試 + fixtures/
  scripts/fund-seed.ts         一次性種子匯入 CLI
  app/api/fund/route.ts        前端讀取端點
  app/api/fund-crawl/route.ts  live 抓取端點（lazy 分批）
  components/FundView.tsx       前端視圖（持股表 + 雙軌比對）
  vitest.config.ts             測試設定

修改：
  package.json                 加 vitest / xlsx / puppeteer-extra 依賴 + test script
  .gitignore                   確保 .funddata/etf/ 忽略、data/funds/ 不忽略
  app/page.tsx                 接 mode='fund'（Part 6，最後）
```

---

## Part 0 — 設定與資料模型

### Task 1: 測試框架 + 型別 + registry

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `lib/fund/types.ts`
- Create: `lib/fund/sources.ts`
- Test: `lib/fund/__tests__/sources.test.ts`

- [ ] **Step 1: 安裝 vitest 並加 test script**

Run:
```bash
npm install -D vitest
```
然後在 `package.json` 的 `"scripts"` 加一行：
```json
    "test": "vitest run"
```

- [ ] **Step 2: 建立 vitest 設定**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: { environment: 'node', include: ['lib/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
})
```

- [ ] **Step 3: 建立型別**

Create `lib/fund/types.ts`:
```ts
export type ReportType = 'monthly_top10' | 'quarterly_full' | 'etf_daily'
export type FundKind = 'fund' | 'etf'
export type CrawlStrategy =
  | 'sitca' | 'nomura-api' | 'capital-api' | 'fuhua-excel' | 'uni-stealth' | 'allianz' | 'none'

export interface FundHolding {
  code: string          // 股票代號 e.g. '2330'
  name: string          // 股票名稱
  weightPct: number     // 佔淨值/比重 %
  rank?: number         // 排名（月報 Top10 / 季報）
  amount?: number       // 持股市值（種子有）
  market?: string       // 市場別（種子有）
}

export interface FundSnapshot {
  fundId: string        // 我們的 slug，如 'uni-benteng' 或 ETF ticker '00981A'
  reportType: ReportType
  period: string        // 月 '2026-04' / 季 '2026-Q1' / ETF '2026-04-30'
  source: string        // 'joy88-seed' | 'sitca' | 'nomura-api' | ...
  fetchedAt: string     // ISO timestamp
  holdings: FundHolding[]
  meta?: { aum?: number; manager?: string; cashPct?: number; note?: string }
}

export interface FundDef {
  fundId: string
  kind: FundKind
  company: string       // ASCII: 'uni'|'fuhua'|'nomura'|'allianz'|'taishin'|'yuanta'|'capital'
  sitcaCode?: string    // fund-info.json 的 code（A09002…），live SITCA 抓取用
  etfTicker?: string    // kind==='etf' 時 = ticker
  relatedEtf?: string   // 基金對應的 ETF ticker（雙軌比對用）
  crawl: CrawlStrategy
}
```

- [ ] **Step 4: 寫 registry 的失敗測試**

Create `lib/fund/__tests__/sources.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { FUNDS, ETFS, ALL_DEFS, slugBySitca } from '../sources'

describe('fund registry', () => {
  it('有 13 檔基金、6 檔 ETF', () => {
    expect(FUNDS).toHaveLength(13)
    expect(ETFS).toHaveLength(6)
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
```

- [ ] **Step 5: 跑測試確認失敗**

Run: `npm test -- sources`
Expected: FAIL（`../sources` 不存在）

- [ ] **Step 6: 實作 registry**

Create `lib/fund/sources.ts`:
```ts
import type { FundDef } from './types'

// SITCA 每檔基金 code（fund-info.json 的 code，ASCII）→ 我們的 slug。
// ⚠️ A09003/A09011 的「黑馬 vs 中小」對應在種子匯入時需用 manager/style 核對（見 Task 4 Step 4）。
const SLUG_BY_SITCA: Record<string, string> = {
  A09002: 'uni-allweather',         // 統一全天候（陳意婷, 00988A）
  A09012: 'uni-benteng',            // 統一奔騰（陳釧瑤, 00981A）
  A09003: 'uni-blackhorse',         // 統一黑馬
  A09011: 'uni-sme',                // 統一中小
  A09:    'uni-greater-china-sme',  // 統一大中華中小
  A22001: 'fh-growth',              // 復華高成長（呂宏宇, 00991A）
  A22:    'fh-allround',            // 復華全方位
  A32001: 'nomura-quality',         // 野村優質
  A32:    'nomura-hitech',          // 野村高科技
  A36001: 'allianz-dabar',          // 安聯台灣大壩
  A36004: 'allianz-tech',           // 安聯台灣科技
  A47:    'taishin-mainstream',     // 台新主流
  A05:    'yuanta-newmain',         // 元大新主流
}

export function slugBySitca(code: string): string | undefined {
  return SLUG_BY_SITCA[code]
}

export const FUNDS: FundDef[] = [
  { fundId: 'uni-allweather',        kind: 'fund', company: 'uni',     sitcaCode: 'A09002', relatedEtf: '00988A', crawl: 'sitca' },
  { fundId: 'uni-benteng',           kind: 'fund', company: 'uni',     sitcaCode: 'A09012', relatedEtf: '00981A', crawl: 'sitca' },
  { fundId: 'uni-blackhorse',        kind: 'fund', company: 'uni',     sitcaCode: 'A09003', crawl: 'sitca' },
  { fundId: 'uni-sme',               kind: 'fund', company: 'uni',     sitcaCode: 'A09011', crawl: 'sitca' },
  { fundId: 'uni-greater-china-sme', kind: 'fund', company: 'uni',     sitcaCode: 'A09',    crawl: 'sitca' },
  { fundId: 'fh-growth',             kind: 'fund', company: 'fuhua',   sitcaCode: 'A22001', relatedEtf: '00991A', crawl: 'sitca' },
  { fundId: 'fh-allround',           kind: 'fund', company: 'fuhua',   sitcaCode: 'A22',    crawl: 'sitca' },
  { fundId: 'nomura-quality',        kind: 'fund', company: 'nomura',  sitcaCode: 'A32001', crawl: 'sitca' },
  { fundId: 'nomura-hitech',         kind: 'fund', company: 'nomura',  sitcaCode: 'A32',    crawl: 'sitca' },
  { fundId: 'allianz-dabar',         kind: 'fund', company: 'allianz', sitcaCode: 'A36001', crawl: 'sitca' },
  { fundId: 'allianz-tech',          kind: 'fund', company: 'allianz', sitcaCode: 'A36004', relatedEtf: '00993A', crawl: 'sitca' },
  { fundId: 'taishin-mainstream',    kind: 'fund', company: 'taishin', sitcaCode: 'A47',    crawl: 'sitca' },
  { fundId: 'yuanta-newmain',        kind: 'fund', company: 'yuanta',  sitcaCode: 'A05',    crawl: 'sitca' },
]

export const ETFS: FundDef[] = [
  { fundId: '00980A', kind: 'etf', company: 'nomura',  etfTicker: '00980A', crawl: 'nomura-api' },
  { fundId: '00981A', kind: 'etf', company: 'uni',     etfTicker: '00981A', crawl: 'uni-stealth' },
  { fundId: '00982A', kind: 'etf', company: 'capital', etfTicker: '00982A', crawl: 'capital-api' },
  { fundId: '00988A', kind: 'etf', company: 'uni',     etfTicker: '00988A', crawl: 'uni-stealth' },
  { fundId: '00991A', kind: 'etf', company: 'fuhua',   etfTicker: '00991A', crawl: 'fuhua-excel' },
  { fundId: '00993A', kind: 'etf', company: 'allianz', etfTicker: '00993A', crawl: 'allianz' },
]

export const ALL_DEFS: FundDef[] = [...FUNDS, ...ETFS]
export const defById = (id: string) => ALL_DEFS.find(d => d.fundId === id)
```

- [ ] **Step 7: 跑測試確認通過**

Run: `npm test -- sources`
Expected: PASS（4 個 it 全綠）

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts lib/fund/types.ts lib/fund/sources.ts lib/fund/__tests__/sources.test.ts
git commit -m "feat(fund): add vitest, fund types and source registry"
```

---

## Part 1 — Store（資料層）

### Task 2: FundSnapshot 存取（disk + memory fallback）

**Files:**
- Create: `lib/fund/store.ts`
- Test: `lib/fund/__tests__/store.test.ts`

- [ ] **Step 1: 寫失敗測試（冪等 upsert + 路徑分流）**

Create `lib/fund/__tests__/store.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { saveSnapshot, loadSnapshot, snapshotPath, __resetMem } from '../store'
import type { FundSnapshot } from '../types'

const fund: FundSnapshot = {
  fundId: 'uni-benteng', reportType: 'monthly_top10', period: '2026-04',
  source: 'test', fetchedAt: '2026-04-11T00:00:00Z',
  holdings: [{ code: '2330', name: '台積電', weightPct: 7.24, rank: 5 }],
}
const etf: FundSnapshot = {
  fundId: '00981A', reportType: 'etf_daily', period: '2026-04-30',
  source: 'test', fetchedAt: '2026-04-30T10:00:00Z',
  holdings: [{ code: '2330', name: '台積電', weightPct: 9.11 }],
}

describe('fundStore', () => {
  beforeEach(() => __resetMem())
  afterEach(async () => {
    await fs.rm(path.join(process.cwd(), 'data/funds/uni-benteng'), { recursive: true, force: true })
    await fs.rm(path.join(process.cwd(), '.funddata/etf/00981A'), { recursive: true, force: true })
  })

  it('基金月報存到 data/funds/（committed 區）', () => {
    expect(snapshotPath(fund)).toContain(path.join('data', 'funds', 'uni-benteng'))
  })
  it('ETF 每日存到 .funddata/etf/（gitignore 區）', () => {
    expect(snapshotPath(etf)).toContain(path.join('.funddata', 'etf', '00981A'))
  })
  it('存後可讀回', async () => {
    await saveSnapshot(fund)
    const got = await loadSnapshot('uni-benteng', 'monthly_top10', '2026-04')
    expect(got?.holdings[0].code).toBe('2330')
  })
  it('同鍵重存為覆寫、不重複', async () => {
    await saveSnapshot(fund)
    await saveSnapshot({ ...fund, holdings: [{ code: '3017', name: '奇鋐', weightPct: 9.74, rank: 1 }] })
    const got = await loadSnapshot('uni-benteng', 'monthly_top10', '2026-04')
    expect(got?.holdings).toHaveLength(1)
    expect(got?.holdings[0].code).toBe('3017')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test -- store`
Expected: FAIL（`../store` 不存在）

- [ ] **Step 3: 實作 store（仿 lib/chipsStore.ts 的 disk+memory 模式）**

Create `lib/fund/store.ts`:
```ts
import { promises as fs } from 'fs'
import path from 'path'
import type { FundSnapshot, ReportType } from './types'

const COMMITTED = path.join(process.cwd(), 'data', 'funds')   // 基金月/季報（git 留歷史）
const ETF_CACHE = path.join(process.cwd(), '.funddata', 'etf') // ETF 每日（gitignore）
const mem = new Map<string, FundSnapshot>()
const diskOk = new Map<string, boolean>()

const key = (fundId: string, rt: ReportType, period: string) => `${fundId}|${rt}|${period}`

export function snapshotPath(s: FundSnapshot): string {
  if (s.reportType === 'etf_daily') return path.join(ETF_CACHE, s.fundId, `${s.period}.json`)
  return path.join(COMMITTED, s.fundId, `${s.reportType}_${s.period}.json`)
}

async function ensureDir(dir: string): Promise<boolean> {
  if (diskOk.has(dir)) return diskOk.get(dir)!
  try { await fs.mkdir(dir, { recursive: true }); diskOk.set(dir, true) }
  catch { diskOk.set(dir, false) }
  return diskOk.get(dir)!
}

export async function saveSnapshot(s: FundSnapshot): Promise<void> {
  mem.set(key(s.fundId, s.reportType, s.period), s)
  const file = snapshotPath(s)
  if (await ensureDir(path.dirname(file))) {
    try { await fs.writeFile(file, JSON.stringify(s, null, 0)) }
    catch { /* 唯讀 FS：僅記憶體 */ }
  }
}

export async function loadSnapshot(fundId: string, rt: ReportType, period: string): Promise<FundSnapshot | null> {
  const k = key(fundId, rt, period)
  if (mem.has(k)) return mem.get(k)!
  const file = snapshotPath({ fundId, reportType: rt, period } as FundSnapshot)
  try {
    const raw = await fs.readFile(file, 'utf-8')
    const obj = JSON.parse(raw) as FundSnapshot
    mem.set(k, obj)
    return obj
  } catch { return null }
}

export async function listPeriods(fundId: string, rt: ReportType): Promise<string[]> {
  const dir = rt === 'etf_daily' ? path.join(ETF_CACHE, fundId) : path.join(COMMITTED, fundId)
  try {
    const files = await fs.readdir(dir)
    const prefix = rt === 'etf_daily' ? '' : `${rt}_`
    return files.filter(f => f.endsWith('.json') && f.startsWith(prefix))
      .map(f => f.slice(prefix.length, -5)).sort()
  } catch { return [] }
}

export function __resetMem() { mem.clear(); diskOk.clear() }
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test -- store`
Expected: PASS（4 個 it 全綠）

- [ ] **Step 5: Commit**

```bash
git add lib/fund/store.ts lib/fund/__tests__/store.test.ts
git commit -m "feat(fund): add snapshot store with disk+memory fallback"
```

---

## Part 2 — 種子匯入（驗證 store + 取得歷史厚度）

### Task 3: period 轉換 + 種子轉換器

**Files:**
- Create: `lib/fund/period.ts`
- Create: `lib/fund/seed.ts`
- Test: `lib/fund/__tests__/period.test.ts`
- Test: `lib/fund/__tests__/seed.test.ts`
- Create: `lib/fund/__tests__/fixtures/holdings.sample.json`
- Create: `lib/fund/__tests__/fixtures/fund-info.sample.json`

- [ ] **Step 1: 寫 period 轉換失敗測試**

Create `lib/fund/__tests__/period.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { joyPeriod } from '../period'

describe('joyPeriod', () => {
  it('月報 202604 → 2026-04', () => expect(joyPeriod('202604', 'monthly')).toBe('2026-04'))
  it('季報 202603 → 2026-Q1', () => expect(joyPeriod('202603', 'quarterly')).toBe('2026-Q1'))
  it('季報 202606 → 2026-Q2', () => expect(joyPeriod('202606', 'quarterly')).toBe('2026-Q2'))
  it('季報 202612 → 2026-Q4', () => expect(joyPeriod('202612', 'quarterly')).toBe('2026-Q4'))
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test -- period`
Expected: FAIL

- [ ] **Step 3: 實作 period.ts**

Create `lib/fund/period.ts`:
```ts
// JOY88 period 'YYYYMM'（月報=當月、季報=季末月 03/06/09/12）→ 我們格式
export function joyPeriod(p: string, reportType: 'monthly' | 'quarterly'): string {
  const y = p.slice(0, 4), m = p.slice(4, 6)
  if (reportType === 'monthly') return `${y}-${m}`
  const q = { '03': 1, '06': 2, '09': 3, '12': 4 }[m]
  if (!q) throw new Error(`非季末月: ${p}`)
  return `${y}-Q${q}`
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test -- period`
Expected: PASS

- [ ] **Step 5: 建立 golden fixtures（從真實種子裁切）**

Run（從種子產生小樣本，含統一全天候 202604 月報 + 一檔基金一季）：
```bash
node -e "const h=require('C:/Users/user/joy88-seed/holdings.json'); const fi=require('C:/Users/user/joy88-seed/fund-info.json'); const fs=require('fs'); const name=Object.keys(h)[0]; const rows=h[name].filter(r=>['202604','202603'].includes(r.period)); fs.writeFileSync('lib/fund/__tests__/fixtures/holdings.sample.json', JSON.stringify({[name]:rows})); fs.writeFileSync('lib/fund/__tests__/fixtures/fund-info.sample.json', JSON.stringify({last_updated:fi.last_updated, funds: fi.funds.filter(f=>f.name===name)}));"
```
確認兩個 fixture 檔已建立且非空。

- [ ] **Step 6: 寫種子轉換失敗測試**

Create `lib/fund/__tests__/seed.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { transformHoldings } from '../seed'
import holdings from './fixtures/holdings.sample.json'
import fundInfo from './fixtures/fund-info.sample.json'

describe('transformHoldings', () => {
  const snaps = transformHoldings(holdings as any, fundInfo as any, '2026-04-11T00:00:00Z')

  it('產出含 monthly_top10 與 quarterly_full', () => {
    const types = new Set(snaps.map(s => s.reportType))
    expect(types.has('monthly_top10')).toBe(true)
    expect(types.has('quarterly_full')).toBe(true)
  })
  it('fundId 是我們的 slug（非 A0009 公司碼）', () => {
    expect(snaps.every(s => /^[a-z-]+$/.test(s.fundId))).toBe(true)
  })
  it('holdings 依 rank 排序、欄位齊全', () => {
    const s = snaps.find(s => s.reportType === 'monthly_top10')!
    expect(s.holdings[0].rank).toBe(1)
    expect(s.holdings[0].code).toMatch(/^\d{4,}$/)
    expect(typeof s.holdings[0].weightPct).toBe('number')
  })
})
```

- [ ] **Step 7: 跑測試確認失敗**

Run: `npm test -- seed`
Expected: FAIL（`../seed` 不存在）

- [ ] **Step 8: 實作 seed.ts**

Create `lib/fund/seed.ts`:
```ts
import { slugBySitca } from './sources'
import { joyPeriod } from './period'
import type { FundSnapshot, FundHolding, ReportType } from './types'

interface JoyRow {
  period: string; report_type: 'monthly' | 'quarterly'
  fund_code: string; fund_name: string
  rank: number; market?: string; stock_id: string; stock_name: string
  amount?: number; weight_pct: number
}
interface JoyFundInfo { last_updated: string; funds: { name: string; code: string; manager?: string; aum_nt_yi?: number }[] }

// 用 fund_name（holdings 唯一鍵）→ fund-info.name → fund-info.code → slug
function buildNameToSlug(fi: JoyFundInfo): Map<string, { fundId: string; manager?: string; aum?: number }> {
  const m = new Map<string, { fundId: string; manager?: string; aum?: number }>()
  for (const f of fi.funds) {
    const fundId = slugBySitca(f.code)
    if (!fundId) continue // 非追蹤名單
    m.set(f.name, { fundId, manager: f.manager, aum: f.aum_nt_yi })
  }
  return m
}

export function transformHoldings(
  holdings: Record<string, JoyRow[]>, fi: JoyFundInfo, fetchedAt: string,
): FundSnapshot[] {
  const nameToSlug = buildNameToSlug(fi)
  // group：(fundId, reportType, period) → holdings
  const groups = new Map<string, FundSnapshot>()
  for (const rows of Object.values(holdings)) {
    for (const r of rows) {
      const meta = nameToSlug.get(r.fund_name)
      if (!meta) continue
      const reportType: ReportType = r.report_type === 'monthly' ? 'monthly_top10' : 'quarterly_full'
      const period = joyPeriod(r.period, r.report_type)
      const k = `${meta.fundId}|${reportType}|${period}`
      if (!groups.has(k)) {
        groups.set(k, {
          fundId: meta.fundId, reportType, period, source: 'joy88-seed',
          fetchedAt, holdings: [], meta: { manager: meta.manager, aum: meta.aum },
        })
      }
      const h: FundHolding = {
        code: r.stock_id, name: r.stock_name, weightPct: r.weight_pct,
        rank: r.rank, amount: r.amount, market: r.market,
      }
      groups.get(k)!.holdings.push(h)
    }
  }
  for (const s of groups.values()) s.holdings.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
  return [...groups.values()]
}
```

- [ ] **Step 9: 跑測試確認通過**

Run: `npm test -- seed`
Expected: PASS（3 個 it 全綠）

- [ ] **Step 10: Commit**

```bash
git add lib/fund/period.ts lib/fund/seed.ts lib/fund/__tests__/period.test.ts lib/fund/__tests__/seed.test.ts lib/fund/__tests__/fixtures/
git commit -m "feat(fund): add period conversion and JOY88 seed transformer"
```

### Task 4: 種子匯入 CLI + 實跑 + 核對 + commit 歷史

**Files:**
- Create: `scripts/fund-seed.ts`
- Modify: `package.json`（加 script）
- Modify: `.gitignore`

- [ ] **Step 1: 確保 .gitignore 規則正確**

確認 `.gitignore` 含 `/.funddata/`（已有）。在其後加一行明確排除例外（committed 區不被忽略——預設即不忽略，此步僅加註解）：
```
# 基金月/季報歷史（committed，SITCA 歷史抓不回來）：data/funds/ 不忽略
```

- [ ] **Step 2: 寫匯入 CLI**

Create `scripts/fund-seed.ts`:
```ts
import { promises as fs } from 'fs'
import path from 'path'
import { transformHoldings } from '../lib/fund/seed'
import { saveSnapshot } from '../lib/fund/store'

async function main() {
  const seedDir = process.argv[2] || process.env.JOY88_SEED || 'C:/Users/user/joy88-seed'
  const holdings = JSON.parse(await fs.readFile(path.join(seedDir, 'holdings.json'), 'utf-8'))
  const fi = JSON.parse(await fs.readFile(path.join(seedDir, 'fund-info.json'), 'utf-8'))
  const snaps = transformHoldings(holdings, fi, new Date().toISOString())
  for (const s of snaps) await saveSnapshot(s)
  // 摘要
  const byFund = new Map<string, number>()
  for (const s of snaps) byFund.set(s.fundId, (byFund.get(s.fundId) ?? 0) + 1)
  console.log(`寫入 ${snaps.length} 個快照，涵蓋 ${byFund.size} 檔基金：`)
  for (const [id, n] of [...byFund].sort()) console.log(`  ${id}: ${n} 期`)
}
main().catch(e => { console.error(e); process.exit(1) })
```
在 `package.json` scripts 加：
```json
    "fund:seed": "node --import tsx scripts/fund-seed.ts"
```
若無 tsx：`npm install -D tsx`。

- [ ] **Step 3: 實跑種子匯入**

Run: `npm run fund:seed`
Expected: 印出「寫入 N 個快照，涵蓋 13 檔基金」，且 `data/funds/<slug>/` 下出現 `monthly_top10_*.json` 與 `quarterly_full_*.json`。

- [ ] **Step 4: ⚠️ 核對黑馬/中小 slug（A09003 vs A09011 唯一不確定點）**

Run:
```bash
node -e "const fi=require('C:/Users/user/joy88-seed/fund-info.json'); fi.funds.forEach(f=>console.log(f.code, f.short_name, f.manager, '|', f.style))"
```
對照 PDF 名單（黑馬=尤文毅、中小=莊承憲）。若 `A09003` 實為「中小」、`A09011` 實為「黑馬」，到 `lib/fund/sources.ts` 對調這兩行的 slug，重跑 `npm run fund:seed`。

- [ ] **Step 5: 驗證資料品質（總量對拍 6246 列）**

Run:
```bash
node -e "const fs=require('fs'),p='data/funds';let rows=0,snaps=0;for(const d of fs.readdirSync(p))for(const f of fs.readdirSync(p+'/'+d)){snaps++;rows+=JSON.parse(fs.readFileSync(p+'/'+d+'/'+f)).holdings.length}console.log('snapshots:',snaps,'holding rows:',rows)"
```
Expected: holding rows 接近 6246（種子總列數；未匹配到 slug 的不計）。

- [ ] **Step 6: Commit 歷史資料**

```bash
git add .gitignore package.json package-lock.json scripts/fund-seed.ts data/funds/
git commit -m "feat(fund): seed 13 funds history (22 periods) from JOY88 into data/funds"
```

---

## Part 3 — 讀取 API

### Task 5: 純查詢函式 + fund route

**Files:**
- Create: `lib/fund/query.ts`
- Test: `lib/fund/__tests__/query.test.ts`
- Create: `app/api/fund/route.ts`

- [ ] **Step 1: 寫查詢失敗測試**

Create `lib/fund/__tests__/query.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { stockDistribution, dualTrack } from '../query'
import type { FundSnapshot } from '../types'

const snaps: FundSnapshot[] = [
  { fundId: 'uni-benteng', reportType: 'monthly_top10', period: '2026-04', source: 's', fetchedAt: '', holdings: [{ code: '2330', name: '台積電', weightPct: 7.24, rank: 5 }] },
  { fundId: '00981A', reportType: 'etf_daily', period: '2026-04-30', source: 's', fetchedAt: '', holdings: [{ code: '2330', name: '台積電', weightPct: 9.11 }] },
]

describe('query', () => {
  it('stockDistribution 列出持有某股的所有基金與權重', () => {
    const d = stockDistribution(snaps, '2330')
    expect(d).toHaveLength(2)
    expect(d.find(x => x.fundId === '00981A')?.weightPct).toBe(9.11)
  })
  it('dualTrack 配對同股票、算權重差', () => {
    const r = dualTrack(snaps[0], snaps[1])
    const row = r.find(x => x.code === '2330')!
    expect(row.fundWeight).toBe(7.24)
    expect(row.etfWeight).toBe(9.11)
    expect(row.diff).toBeCloseTo(-1.87, 2)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test -- query`
Expected: FAIL

- [ ] **Step 3: 實作 query.ts**

Create `lib/fund/query.ts`:
```ts
import type { FundSnapshot } from './types'

export interface StockDistRow { fundId: string; reportType: string; period: string; weightPct: number; rank?: number }
export function stockDistribution(snaps: FundSnapshot[], code: string): StockDistRow[] {
  const out: StockDistRow[] = []
  for (const s of snaps) {
    const h = s.holdings.find(x => x.code === code)
    if (h) out.push({ fundId: s.fundId, reportType: s.reportType, period: s.period, weightPct: h.weightPct, rank: h.rank })
  }
  return out.sort((a, b) => b.weightPct - a.weightPct)
}

export interface DualRow { code: string; name: string; fundWeight: number | null; etfWeight: number | null; diff: number | null }
export function dualTrack(fund: FundSnapshot, etf: FundSnapshot): DualRow[] {
  const map = new Map<string, DualRow>()
  for (const h of fund.holdings) map.set(h.code, { code: h.code, name: h.name, fundWeight: h.weightPct, etfWeight: null, diff: null })
  for (const h of etf.holdings) {
    const r = map.get(h.code) ?? { code: h.code, name: h.name, fundWeight: null, etfWeight: null, diff: null }
    r.etfWeight = h.weightPct
    map.set(h.code, r)
  }
  for (const r of map.values()) {
    if (r.fundWeight != null && r.etfWeight != null) r.diff = +(r.fundWeight - r.etfWeight).toFixed(2)
  }
  return [...map.values()].sort((a, b) => (b.fundWeight ?? b.etfWeight ?? 0) - (a.fundWeight ?? a.etfWeight ?? 0))
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test -- query`
Expected: PASS

- [ ] **Step 5: 先讀 Next.js 16 Route Handler 指南**

Run: `ls node_modules/next/dist/docs/` 找 App Router / route handler 文件並閱讀（AGENTS.md 要求）。確認 `GET(request: Request)` 簽名與 `NextResponse`/`Response.json` 用法符合此版本。

- [ ] **Step 6: 實作 fund route（聚合 store + query）**

Create `app/api/fund/route.ts`（依 Step 5 確認的簽名調整；以下為標準 App Router 形式）:
```ts
import { NextResponse } from 'next/server'
import { ALL_DEFS, defById } from '@/lib/fund/sources'
import { loadSnapshot, listPeriods } from '@/lib/fund/store'
import { stockDistribution, dualTrack } from '@/lib/fund/query'
import type { FundSnapshot, ReportType } from '@/lib/fund/types'

async function latest(fundId: string, rt: ReportType): Promise<FundSnapshot | null> {
  const periods = await listPeriods(fundId, rt)
  if (!periods.length) return null
  return loadSnapshot(fundId, rt, periods[periods.length - 1])
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const fundId = sp.get('fund'), stock = sp.get('stock'), pair = sp.get('pair')

  if (fundId) {
    const monthly = await latest(fundId, 'monthly_top10')
    const quarterly = await latest(fundId, 'quarterly_full')
    return NextResponse.json({ def: defById(fundId), monthly, quarterly })
  }
  if (stock) {
    const all: FundSnapshot[] = []
    for (const d of ALL_DEFS) {
      for (const rt of ['monthly_top10', 'quarterly_full', 'etf_daily'] as ReportType[]) {
        const s = await latest(d.fundId, rt); if (s) all.push(s)
      }
    }
    return NextResponse.json({ stock, distribution: stockDistribution(all, stock) })
  }
  if (pair) {
    const [fId, eId] = pair.split(',')
    const f = await latest(fId, 'monthly_top10'), e = await latest(eId, 'etf_daily')
    return NextResponse.json({ rows: f && e ? dualTrack(f, e) : [] })
  }
  return NextResponse.json({ funds: ALL_DEFS })
}
```

- [ ] **Step 7: 手動驗證 route**

Run: `npm run dev`，另開終端：
```bash
curl -s "http://localhost:3000/api/fund?fund=uni-benteng" | head -c 400
curl -s "http://localhost:3000/api/fund?stock=2330" | head -c 400
```
Expected: 回傳含 holdings / distribution 的 JSON（種子資料）。

- [ ] **Step 8: Commit**

```bash
git add lib/fund/query.ts lib/fund/__tests__/query.test.ts app/api/fund/route.ts
git commit -m "feat(fund): add query helpers and fund read API route"
```

---

## Part 4 — 前端視圖（跑在種子資料上）

### Task 6: FundView 元件（持股表 + 雙軌比對）

**Files:**
- Create: `components/FundView.tsx`

> 此元件本計畫**不接進 `app/page.tsx`**（合併最後處理，Part 6）。先獨立驗證：暫時把它掛到一個臨時測試頁或用既有 dev 入口手動 render。

- [ ] **Step 1: 實作 FundView（client component，fetch /api/fund）**

Create `components/FundView.tsx`:
```tsx
'use client'
import { useEffect, useState } from 'react'

interface Holding { code: string; name: string; weightPct: number; rank?: number }
interface Snapshot { fundId: string; period: string; holdings: Holding[] }

export default function FundView() {
  const [funds, setFunds] = useState<{ fundId: string; kind: string }[]>([])
  const [sel, setSel] = useState<string>('uni-benteng')
  const [snap, setSnap] = useState<Snapshot | null>(null)

  useEffect(() => { fetch('/api/fund').then(r => r.json()).then(d => setFunds(d.funds)) }, [])
  useEffect(() => {
    if (!sel) return
    fetch(`/api/fund?fund=${sel}`).then(r => r.json()).then(d => setSnap(d.monthly ?? d.quarterly))
  }, [sel])

  return (
    <div className="p-4 text-sm">
      <select value={sel} onChange={e => setSel(e.target.value)} className="mb-3 bg-neutral-800 px-2 py-1 rounded">
        {funds.map(f => <option key={f.fundId} value={f.fundId}>{f.fundId}</option>)}
      </select>
      {snap && (
        <table className="tabular-nums w-full">
          <thead><tr className="text-left text-neutral-400"><th>#</th><th>代號</th><th>名稱</th><th className="text-right">權重%</th></tr></thead>
          <tbody>
            {snap.holdings.map(h => (
              <tr key={h.code} className="border-t border-neutral-800">
                <td>{h.rank ?? ''}</td><td>{h.code}</td><td>{h.name}</td>
                <td className="text-right">{h.weightPct.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 手動驗證（preview）**

用 preview 工具：`npm run dev` → 暫時在 `app/page.tsx` 頂部臨時 render `<FundView/>`（或建臨時 `app/fund-preview/page.tsx`）→ 開瀏覽器確認下拉切換基金、持股表顯示種子資料、權重 tabular-nums 對齊。驗證後**還原臨時改動**（勿留在 page.tsx）。

- [ ] **Step 3: Commit**

```bash
git add components/FundView.tsx
git commit -m "feat(fund): add FundView holdings table component"
```

---

## Part 5 — Live 爬蟲（逐投信，recon-gated）

> 每個來源的確切端點/參數**尚未逆向**，是各 Task 的 recon 交付物。共通流程：① recon 出可複製的 HTTP/瀏覽器配方 → ② **存一份真實回應為 fixture** → ③ 對 fixture 寫 parser 的 golden 測試 → ④ 實作 parser → ⑤ 接進 `fund-crawl` route。Parser 吃「raw 回應」吐 `FundSnapshot`，與抓取解耦、可測。

### Task 7: fund-crawl 骨架 + 18:30 閘門

**Files:**
- Create: `lib/fund/timegate.ts`
- Test: `lib/fund/__tests__/timegate.test.ts`
- Create: `app/api/fund-crawl/route.ts`

- [ ] **Step 1: 寫閘門失敗測試**

Create `lib/fund/__tests__/timegate.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { isAfterCutoff } from '../timegate'

describe('isAfterCutoff (台灣 18:30)', () => {
  it('18:29 → false', () => expect(isAfterCutoff(new Date('2026-05-27T10:29:00Z'))).toBe(false)) // 18:29 TST
  it('18:30 → true', () => expect(isAfterCutoff(new Date('2026-05-27T10:30:00Z'))).toBe(true))   // 18:30 TST
  it('22:00 → true', () => expect(isAfterCutoff(new Date('2026-05-27T14:00:00Z'))).toBe(true))
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test -- timegate`
Expected: FAIL

- [ ] **Step 3: 實作 timegate.ts**

Create `lib/fund/timegate.ts`:
```ts
// 台灣固定 UTC+8（無日光節約）。18:30 後資料當日定案。
export function isAfterCutoff(now: Date = new Date(), cutoffMin = 18 * 60 + 30): boolean {
  const tst = new Date(now.getTime() + 8 * 3600 * 1000)
  const min = tst.getUTCHours() * 60 + tst.getUTCMinutes()
  return min >= cutoffMin
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test -- timegate`
Expected: PASS

- [ ] **Step 5: 實作 fund-crawl route 骨架（dispatch by crawl 策略；HTTP 類先回 501 待各 Task 補）**

Create `app/api/fund-crawl/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { defById } from '@/lib/fund/sources'
import { saveSnapshot } from '@/lib/fund/store'
import { isAfterCutoff } from '@/lib/fund/timegate'

export async function POST(req: Request) {
  const { fundId, force } = await req.json().catch(() => ({}))
  if (!force && !isAfterCutoff()) return NextResponse.json({ error: '尚未過 18:30，資料當日未定案' }, { status: 425 })
  const def = fundId ? defById(fundId) : null
  if (!def) return NextResponse.json({ error: 'unknown fundId' }, { status: 400 })

  switch (def.crawl) {
    // 各 Task 補：呼叫對應 parser 抓取 → saveSnapshot → 回 { ok, period }
    case 'nomura-api':
    case 'capital-api':
    case 'fuhua-excel':
    case 'uni-stealth':
    case 'allianz':
    case 'sitca':
    default:
      return NextResponse.json({ error: `crawl '${def.crawl}' 尚未實作` }, { status: 501 })
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/fund/timegate.ts lib/fund/__tests__/timegate.test.ts app/api/fund-crawl/route.ts
git commit -m "feat(fund): add 18:30 timegate and fund-crawl route skeleton"
```

### Task 8: 野村 + 群益 ETF（REST API，最穩，先做）

**Files:**
- Create: `lib/fund/parse/etfApi.ts`
- Test: `lib/fund/__tests__/etfApi.test.ts`
- Create: `lib/fund/__tests__/fixtures/nomura-00980A.json`, `capital-00982A.json`
- Modify: `app/api/fund-crawl/route.ts`

- [ ] **Step 1: Recon — 找出野村/群益的持股 API**

用瀏覽器（Claude in Chrome 或 DevTools Network）開野村投信 00980A、群益 00982A 的 ETF 每日持股頁，觀察 XHR：記下 endpoint URL、method、必要參數、回應 JSON 結構。把各自一份真實回應存成 `lib/fund/__tests__/fixtures/nomura-00980A.json`、`capital-00982A.json`。在 `lib/fund/sources.ts` 對應 ETF 的註解處記下 endpoint（或加 `apiUrl` 欄位）。

- [ ] **Step 2: 對 fixture 寫 parser 失敗測試**

Create `lib/fund/__tests__/etfApi.test.ts`（依 fixture 實際結構填欄位路徑；以下為模板，逆向後替換 `r.xxx`）:
```ts
import { describe, it, expect } from 'vitest'
import { parseEtfApi } from '../parse/etfApi'
import nomura from './fixtures/nomura-00980A.json'

describe('parseEtfApi', () => {
  it('野村 00980A 解析出持股、權重和約 100%', () => {
    const snap = parseEtfApi('00980A', 'nomura-api', nomura as any, '2026-05-27')
    expect(snap.fundId).toBe('00980A')
    expect(snap.reportType).toBe('etf_daily')
    expect(snap.holdings.length).toBeGreaterThan(10)
    const sum = snap.holdings.reduce((a, h) => a + h.weightPct, 0)
    expect(sum).toBeGreaterThan(80); expect(sum).toBeLessThan(105)
  })
})
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `npm test -- etfApi`
Expected: FAIL

- [ ] **Step 4: 實作 parseEtfApi（依 recon 出的 JSON 結構對應欄位）**

Create `lib/fund/parse/etfApi.ts`:
```ts
import type { FundSnapshot, FundHolding } from '../types'

// 依 recon 結果調整：不同投信回應結構不同，這裡用 normalizer 對應。
type Raw = any
export function parseEtfApi(fundId: string, source: string, raw: Raw, date: string): FundSnapshot {
  // TODO(recon)：把 raw 的持股陣列對應到 {code,name,weightPct}
  // 範例（野村假設 raw.holdings = [{stockId,stockName,weight}]）：
  const rows: any[] = raw.holdings ?? raw.data ?? raw.Data ?? []
  const holdings: FundHolding[] = rows.map((r: any) => ({
    code: String(r.stockId ?? r.code ?? r.stock_id),
    name: String(r.stockName ?? r.name ?? r.stock_name),
    weightPct: Number(r.weight ?? r.weightPct ?? r.weight_pct),
  })).filter(h => h.code && !Number.isNaN(h.weightPct))
  return { fundId, reportType: 'etf_daily', period: date, source, fetchedAt: new Date().toISOString(), holdings }
}
```
> recon 後把上面 normalizer 改成 fixture 的真實欄位路徑，使測試通過。

- [ ] **Step 5: 跑測試確認通過**

Run: `npm test -- etfApi`
Expected: PASS

- [ ] **Step 6: 接進 fund-crawl route**

修改 `app/api/fund-crawl/route.ts`，`case 'nomura-api':` 與 `case 'capital-api':`：用 recon 的 URL `fetch` → `parseEtfApi(def.fundId, def.crawl, await res.json(), today)` → `saveSnapshot` → 回 `{ ok: true, period }`。`today` = 台灣日期 `YYYY-MM-DD`。

- [ ] **Step 7: 手動驗證**

Run: `npm run dev` → `curl -X POST localhost:3000/api/fund-crawl -H 'content-type: application/json' -d '{"fundId":"00980A","force":true}'`
Expected: `{ok:true,period:"..."}`，且 `.funddata/etf/00980A/<date>.json` 出現。

- [ ] **Step 8: Commit**

```bash
git add lib/fund/parse/etfApi.ts lib/fund/__tests__/etfApi.test.ts lib/fund/__tests__/fixtures/nomura-00980A.json lib/fund/__tests__/fixtures/capital-00982A.json app/api/fund-crawl/route.ts lib/fund/sources.ts
git commit -m "feat(fund): nomura+capital ETF holdings via REST API"
```

### Task 9: 復華 ETF（Excel 下載 + SheetJS）

**Files:**
- Create: `lib/fund/parse/fuhuaXlsx.ts`
- Test: `lib/fund/__tests__/fuhuaXlsx.test.ts`
- Create: `lib/fund/__tests__/fixtures/fuhua-00991A.xlsx`
- Modify: `package.json`, `app/api/fund-crawl/route.ts`

- [ ] **Step 1: 安裝 xlsx**

Run: `npm install xlsx`

- [ ] **Step 2: Recon — 找復華 00991A 持股 Excel 下載連結**

開復華投信 00991A 頁面，找「持股明細」Excel 下載 URL（觀察 Network 的 .xls/.xlsx 請求）。下載一份存成 `lib/fund/__tests__/fixtures/fuhua-00991A.xlsx`。記下 URL 到 sources.ts。先用 SheetJS 印出 sheet 名與前幾列，確認持股表的欄位列位置（標頭可能不在第一列）：
```bash
node -e "const X=require('xlsx');const wb=X.readFile('lib/fund/__tests__/fixtures/fuhua-00991A.xlsx');const ws=wb.Sheets[wb.SheetNames[0]];console.log(X.utils.sheet_to_json(ws,{header:1}).slice(0,12))"
```

- [ ] **Step 3: 對 fixture 寫 parser 失敗測試**

Create `lib/fund/__tests__/fuhuaXlsx.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { parseFuhuaXlsx } from '../parse/fuhuaXlsx'

describe('parseFuhuaXlsx', () => {
  it('解析 00991A 持股', async () => {
    const buf = await fs.readFile(path.join(__dirname, 'fixtures/fuhua-00991A.xlsx'))
    const snap = parseFuhuaXlsx('00991A', buf, '2026-05-27')
    expect(snap.holdings.length).toBeGreaterThan(10)
    expect(snap.holdings[0].code).toMatch(/^\d{4,}$/)
    const sum = snap.holdings.reduce((a, h) => a + h.weightPct, 0)
    expect(sum).toBeGreaterThan(80)
  })
})
```

- [ ] **Step 4: 跑測試確認失敗**

Run: `npm test -- fuhuaXlsx`
Expected: FAIL

- [ ] **Step 5: 實作 parseFuhuaXlsx（依 Step 2 觀察到的欄位位置）**

Create `lib/fund/parse/fuhuaXlsx.ts`:
```ts
import * as XLSX from 'xlsx'
import type { FundSnapshot, FundHolding } from '../types'

export function parseFuhuaXlsx(fundId: string, buf: Buffer, date: string): FundSnapshot {
  const wb = XLSX.read(buf, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })
  // TODO(recon)：依 Step 2 觀察填正確的「代號/名稱/權重」欄 index 與資料起始列。
  const COL = { code: 0, name: 1, weight: 2 }, START = 1
  const holdings: FundHolding[] = []
  for (let i = START; i < rows.length; i++) {
    const r = rows[i]; if (!r) continue
    const code = String(r[COL.code] ?? '').trim()
    const weight = Number(String(r[COL.weight] ?? '').replace('%', ''))
    if (/^\d{4,}$/.test(code) && !Number.isNaN(weight)) {
      holdings.push({ code, name: String(r[COL.name] ?? '').trim(), weightPct: weight })
    }
  }
  return { fundId, reportType: 'etf_daily', period: date, source: 'fuhua-excel', fetchedAt: new Date().toISOString(), holdings }
}
```

- [ ] **Step 6: 跑測試確認通過**

Run: `npm test -- fuhuaXlsx`
Expected: PASS

- [ ] **Step 7: 接進 route + 手動驗證**

`case 'fuhua-excel':`：`fetch` Excel URL → `Buffer.from(await res.arrayBuffer())` → `parseFuhuaXlsx` → `saveSnapshot`。`curl -X POST ... -d '{"fundId":"00991A","force":true}'` 確認落檔。

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json lib/fund/parse/fuhuaXlsx.ts lib/fund/__tests__/fuhuaXlsx.test.ts lib/fund/__tests__/fixtures/fuhua-00991A.xlsx app/api/fund-crawl/route.ts lib/fund/sources.ts
git commit -m "feat(fund): fuhua ETF holdings via Excel (SheetJS)"
```

### Task 10: 統一 ETF（puppeteer-extra stealth，本機限定）

**Files:**
- Create: `lib/fund/parse/uniStealth.ts`
- Test: `lib/fund/__tests__/uniStealth.test.ts`
- Create: `lib/fund/__tests__/fixtures/uni-00981A.html`（或 __NUXT__ JSON）
- Modify: `package.json`, `app/api/fund-crawl/route.ts`

- [ ] **Step 1: 安裝 puppeteer-extra + stealth**

Run: `npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth`

- [ ] **Step 2: Recon — 取得統一 00981A/00988A 持股**

用 stealth 開統一投信 ETF 頁，等持股表載入。判斷資料在 DOM 表格還是 `window.__NUXT__`/其他全域變數。**優先攔截底層 JSON**（`page.evaluate(() => window.__NUXT__)`）而非解析 DOM（PDF 踩坑：DOM 易因改版失效）。把攔到的 JSON（或 HTML 片段）存成 fixture。記錄頁面 URL 與等待條件到 sources.ts。

- [ ] **Step 3: 對 fixture 寫 parser 失敗測試**

Create `lib/fund/__tests__/uniStealth.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import fixture from './fixtures/uni-00981A.json' // recon 攔到的 __NUXT__ 片段
import { parseUniHoldings } from '../parse/uniStealth'

describe('parseUniHoldings', () => {
  it('解析統一 00981A 持股', () => {
    const snap = parseUniHoldings('00981A', fixture as any, '2026-05-27')
    expect(snap.holdings.length).toBeGreaterThan(20)
    expect(snap.holdings.some(h => h.code === '2330')).toBe(true)
  })
})
```
> 若 recon 結果是 HTML，改存 `.html` 並讓 parser 吃字串、用既有 DOM-free 解析（cheerio 或 regex）。

- [ ] **Step 4: 跑測試確認失敗**

Run: `npm test -- uniStealth`
Expected: FAIL

- [ ] **Step 5: 實作 parseUniHoldings（純函式，吃 recon 的 JSON）**

Create `lib/fund/parse/uniStealth.ts`:
```ts
import type { FundSnapshot, FundHolding } from '../types'

// 純解析：吃 recon 攔截到的底層資料物件，吐 holdings。抓取（puppeteer）在 route 做。
export function parseUniHoldings(fundId: string, nuxt: any, date: string): FundSnapshot {
  // TODO(recon)：對應 __NUXT__ 內持股陣列的實際路徑
  const rows: any[] = nuxt?.state?.holdings ?? nuxt?.data?.[0]?.holdings ?? []
  const holdings: FundHolding[] = rows.map((r: any) => ({
    code: String(r.code ?? r.stockId ?? r.stock_id),
    name: String(r.name ?? r.stockName),
    weightPct: Number(r.weight ?? r.weightPct),
  })).filter(h => h.code && !Number.isNaN(h.weightPct))
  return { fundId, reportType: 'etf_daily', period: date, source: 'uni-stealth', fetchedAt: new Date().toISOString(), holdings }
}
```

- [ ] **Step 6: 跑測試確認通過**

Run: `npm test -- uniStealth`
Expected: PASS

- [ ] **Step 7: route 接 puppeteer（標記本機限定）**

`case 'uni-stealth':`：用 puppeteer-extra + stealth 開頁、`page.evaluate` 取 __NUXT__ → `parseUniHoldings` → `saveSnapshot`。Chromium 不可用時 catch 回 `{ error: '此來源限本機（需 Chromium）' }, 501`（spec 約束）。本機 `npm run dev` 驗證落檔。

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json lib/fund/parse/uniStealth.ts lib/fund/__tests__/uniStealth.test.ts lib/fund/__tests__/fixtures/uni-00981A.json app/api/fund-crawl/route.ts lib/fund/sources.ts
git commit -m "feat(fund): uni ETF holdings via puppeteer stealth (local-only)"
```

### Task 11: 安聯 ETF（00993A，recon）

**Files:** `lib/fund/parse/`（依 recon 歸到 etfApi 或新 parser）、fixture、route、test

- [ ] **Step 1: Recon 安聯 00993A** — 先驗證有無乾淨 API（同 Task 8 流程）；有 API → 重用 `parseEtfApi('00993A','allianz', ...)`；否則比照 stealth/Excel 擇一。存 fixture。
- [ ] **Step 2-7:** 比照 Task 8（API 類）或 Task 9/10（檔案/瀏覽器類）的「fixture → golden 測試 → parser → route case 'allianz' → 手動驗證」流程，逐步完成。
- [ ] **Step 8: Commit** `feat(fund): allianz ETF holdings`

### Task 12: SITCA 基金月報/季報（live 增量，補種子之後的新期）

**Files:**
- Create: `lib/fund/parse/sitca.ts`
- Test: `lib/fund/__tests__/sitca.test.ts`
- Create: `lib/fund/__tests__/fixtures/sitca-monthly.html`, `sitca-quarterly.html`
- Modify: `app/api/fund-crawl/route.ts`

- [ ] **Step 1: Recon SITCA postback** — 用瀏覽器開 `www.sitca.org.tw/ROC/Industry/IN2607.aspx?PGMID=IN2629`（月報）與 `PGMID=IN2630`（季報），DevTools Network 觀察送出的 `__VIEWSTATE/__EVENTVALIDATION/__EVENTTARGET` 與基金/年月下拉欄位。複製一檔基金一期的完整 POST，存回應 HTML 為 fixture。**順帶確認能否翻歷史月份**（種子已涵蓋到 2026-04，live 只需補之後新期）。記錄 POST 配方到 sources.ts。
- [ ] **Step 2: 寫 parser 失敗測試** — 對 `sitca-monthly.html` fixture：`parseSitca(fundId,'monthly_top10', html, period)` 應吐 ≤10 檔（月報 Top10）、含 rank/weightPct；季報吐占淨值≥1% 多檔。
```ts
import { describe, it, expect } from 'vitest'
import { promises as fs } from 'fs'; import path from 'path'
import { parseSitca } from '../parse/sitca'
describe('parseSitca', () => {
  it('月報 Top10：≤10 檔、有 rank', async () => {
    const html = await fs.readFile(path.join(__dirname, 'fixtures/sitca-monthly.html'), 'utf-8')
    const snap = parseSitca('uni-benteng', 'monthly_top10', html, '2026-05')
    expect(snap.holdings.length).toBeLessThanOrEqual(10)
    expect(snap.holdings[0].rank).toBe(1)
  })
})
```
- [ ] **Step 3: 跑測試確認失敗** — `npm test -- sitca` → FAIL
- [ ] **Step 4: 實作 parseSitca** — 用 DOM-free 解析（cheerio：`npm install cheerio`，或 regex）抓持股表 `<tr>`，對應代號/名稱/權重/排名欄。big5 不適用（SITCA 為 utf-8）。
- [ ] **Step 5: 跑測試確認通過** — `npm test -- sitca` → PASS
- [ ] **Step 6: route 接 SITCA** — `case 'sitca':` 用 recon 的 token 流（GET 取 `__VIEWSTATE` → POST 帶基金+期別）抓月報與季報 → `parseSitca` → `saveSnapshot`（注意：寫進 `data/funds/`、committed）。禮貌延遲、逐基金序列。
- [ ] **Step 7: 手動驗證** — `curl -X POST ... -d '{"fundId":"uni-benteng","force":true}'`，確認 `data/funds/uni-benteng/monthly_top10_<新期>.json` 出現且與種子格式一致。
- [ ] **Step 8: Commit** `feat(fund): SITCA monthly/quarterly live crawl`

---

## Part 6 — 合併進主程式（最後處理）

### Task 13: 接 mode='fund' 進 page.tsx + lazy 觸發 UI

**Files:**
- Modify: `app/page.tsx`
- Modify: `components/FundView.tsx`（加爬取按鈕 + 18:30 提示 + 進度）

- [ ] **Step 1: 讀現有 page.tsx 的 mode 切換**

Run: `Read app/page.tsx` 看 `mode`（overlay/period/disposal/chips）如何切換與渲染，照同模式加 `'fund'`。

- [ ] **Step 2: FundView 加 lazy 觸發**

在 `components/FundView.tsx` 加「更新本期」按鈕：點擊先檢查（前端呼叫或本地 `isAfterCutoff`）→ 未過 18:30 顯示「資料當日未定案，請 18:30 後再抓」；過了則對選定標的逐一 `POST /api/fund-crawl`，顯示逐標的進度（仿 `components/ChipsScreener.tsx` 的 lazy 批次寫法——先讀它參考）。

- [ ] **Step 3: 接進 page.tsx**

在 `app/page.tsx` 的 mode 列表與渲染處加入 `fund` 分頁，render `<FundView/>`。

- [ ] **Step 4: 手動驗證（preview，含 18:30 閘門）**

`npm run dev` → 切到「基金」分頁 → 確認：種子持股表正常、雙軌比對（如 uni-benteng vs 00981A）、按「更新本期」在 18:30 前被擋、之後可觸發。截圖佐證。

- [ ] **Step 5: 更新 PROJECT_NOTES.md**

在 `docs/PROJECT_NOTES.md` 檔案地圖與模式清單加入 `fund` 模式與 `lib/fund/*`、`data/funds/` 說明。

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx components/FundView.tsx docs/PROJECT_NOTES.md
git commit -m "feat(fund): wire fund mode into app with lazy crawl trigger"
```

---

## Self-Review 紀錄

- **Spec 覆蓋**：13+6 標的(Task1) / SQLite→JSON store(Task2) / 歷史種子(Task3-4) / 讀取 API(Task5) / 前端(Task6,13) / 18:30 lazy 觸發(Task7,13) / 逐投信抓取 SITCA+ETF(Task8-12) / git 規則 data/funds committed‧.funddata gitignore(Task2,4) / 測試 golden-file(各 parser Task) / Puppeteer 本機限定(Task10) — 皆有對應 Task。
- **型別一致**：`FundSnapshot/FundHolding/FundDef/ReportType/CrawlStrategy` 於 Task1 定義，後續 store/seed/query/parse/route 全沿用同名同欄位（`fundId/reportType/period/source/fetchedAt/holdings/meta`）。store 函式 `saveSnapshot/loadSnapshot/listPeriods/snapshotPath` 跨 Task 一致。
- **已知不確定點**：①各 live 來源端點為 recon 交付物（Part 5 各 Task Step 1）；② A09003/A09011 黑馬↔中小 slug 需種子時核對(Task4 Step4)。兩者皆有明確處理步驟，非 placeholder。
- **新依賴**：vitest, tsx, xlsx, puppeteer(-extra,-stealth), cheerio — 各於使用的 Task 內安裝。
```
