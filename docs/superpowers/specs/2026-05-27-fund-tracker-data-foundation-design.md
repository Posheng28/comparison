# 基金經理人持股追蹤 — 資料地基設計（Phase 1，2026-05-27）

## 背景與目標

仿 JOY88 Fund Tracker（投信基金月報/季報 × 主動式 ETF 每日持股的交叉比對），但**併入既有的 chart-overlay**（Next.js 16 App Router）成為一個新模式，沿用其既有慣例（`app/api/*-crawl` 端點 + `lib/*Store.ts` + `lib/cache.ts` + lazy 觸發），不另開獨立專案。

最終價值（後續階段才做）：同一檔股票被多檔基金同時持有 = 共識訊號；同經理人的基金（狙擊手）vs ETF（步兵團）差異；ETF 候選池預測基金下一步。**本 spec 只到「資料抽得乾淨、可查、可被後續訊號層使用」為止。**

### 為什麼是 Node + JSON 而非 Python + SQLite（決策翻案紀錄）
- **要併入 chart-overlay**（Node/Next.js）→ 不能用 Python 獨立專案。
- chart-overlay 部署在 **Vercel 唯讀 FS**、所有資料層都是「JSON 快照 + 記憶體 fallback」（見 `lib/chipsStore.ts` 範式）→ 不用 SQLite。
- 使用者要**手動觸發、不要自動排程** → 複製既有 `chips-crawl` 的「開分頁 → lazy 分批爬 → 進度回報」模式。
- 抓法參考「我架了一個網站」一文（Node + Puppeteer 逐投信策略）。

## 範圍

**Phase 1（本 spec）**：13 檔基金月報/季報 + 6 檔 ETF 每日持股的**抽取、正規化、儲存、最小前端呈現（持股表 + 同投信雙軌比對）**。

**明確 out-of-scope（後續階段，各自 spec）**：9 種經理人行為訊號引擎、經理人風格 DNA 四象限、資金流向熱力圖、回測（Sharpe/Sortino…）、月季交叉生命週期看板、Telegram 推播。

## 追蹤標的（輕量 registry：`lib/fundSources.ts`）

### 13 檔主動式基金
| 投信 | 基金 | 經理人 |
|---|---|---|
| 統一 | 全天候、奔騰、黑馬、中小、大中華中小 | 陳意婷、陳釧瑤、尤文毅、莊承憲、林叡廷 |
| 復華 | 高成長、全方位 | 呂宏宇 |
| 野村 | 優質、高科技 | 陳茹婷、謝文雄 |
| 安聯 | 台灣大壩、台灣科技 | 蕭惠中、周敬烈 |
| 台新 | 主流 | 黃千雲 |
| 元大 | 新主流 | 葉信良 |

### 6 檔主動式 ETF
| 代號 | 名稱 | 發行投信 |
|---|---|---|
| 00981A | 統一台股增長 | 統一 |
| 00988A | 統一全球創新 | 統一 |
| 00991A | 復華台灣未來50 | 復華 |
| 00980A | 野村臺灣智慧優選 | 野村 |
| 00993A | 安聯台灣主動式 | 安聯 |
| 00982A | 群益台灣精選強棒 | 群益 |

同經理人雙軌組（建倉訊號最一致）：統一奔騰/00981A（陳釧瑤）、統一全天候/00988A（陳意婷）、復華高成長/00991A（呂宏宇）。

## 兩種資料 × 來源策略

### A. 基金 月報(Top10)/季報(占淨值≥1%)
- **主來源 = SITCA 投信投顧公會**（通吃 13 檔）：IN2629（月報前十大，每月第 10 營業日）、IN2630（季報，每季 1/4/7/10 月）。ASP.NET postback 頁面（已驗證 `__VIEWSTATE` 存在、可達），純 HTTP 即可，無需 Puppeteer。
- **官網提前版（搶先 SITCA 公告）**：統一 `ezmoney.com.tw`、元大 `yuantafunds.com` API。僅這兩家有提前版。

### B. ETF 每日持股（逐投信策略，參考「我架了一個網站」）
| 發行投信 | 對應 ETF | 抓取策略 | 工具 |
|---|---|---|---|
| 野村 | 00980A | 純 REST API | `fetch`/axios |
| 群益 | 00982A | 純 REST API | `fetch`/axios |
| 復華 | 00991A | Excel 下載 → 記憶體解析 | `xlsx`(SheetJS) |
| 統一 | 00981A、00988A | 防護嚴，無頭瀏覽器偽裝 | `puppeteer-extra` + `stealth` |
| 安聯 | 00993A | 待實作時逆向（先驗證有無 API） | TBD |

元大新主流（基金，非 ETF）官網提前版若用 Nuxt → 攔截 `window.__NUXT__`（Puppeteer），別解析 DOM。

### C. 歷史回補（bootstrap seed，已抓妥）
SITCA 只給當期、歷史抓不回來 —— 但 **JOY88 Fund Tracker 站本身是靜態 JSON 模式**（`fetch('/data/*.json')`），已累積完整歷史，可直接抓來一次回補。**已下載到 `C:\Users\user\joy88-seed\`（14 檔，~2.4MB，全部驗證可解析）**：

| 檔案 | 內容 | 對我們的用途 |
|---|---|---|
| `holdings.json` (1.5MB) | **基金持股全史**：13 檔 × 22 期、6246 列。季報 **2023Q1→2026Q1**、月報 Top10 **2025-03→2026-04**。列含 `period/report_type/fund_code/rank/stock_id/stock_name/amount/weight_pct` | **核心歷史種子** → 轉成我們的 `FundSnapshot` 寫進 `data/funds/`（committed） |
| `fund-info.json` | 13 檔 metadata：manager/company/aum/related_etf/style | 填 `fundSources.ts` registry |
| `funds.json` | 13 檔 name+code | 對照 |
| `etf-holdings.json` | 7 ETF，**僅最新快照**（無每日史） | ETF 起始快照；每日史往後自行累積 |
| `signals.json`(1030)、`strategies.json`(9)、`dna-dual.json`、`backtest.json`、`flow-heatmap.json`、`overlap.json`、`quarterly-consensus/diffs.json`、`sector-weights.json`、`etf-lead-signals.json` | JOY88 的**衍生輸出** | **驗證 oracle**：後續自建訊號/DNA/回測引擎時對拍 JOY88 結果 |

- **轉換時機**：併入 chart-overlay 時（使用者指示「合併最後再處理」），寫一支一次性 `seed` 轉換器把 `holdings.json` → `data/funds/<fundId>/<period>.json`。`fundId` 對應用 `fund_code`（如 A0009）或自訂 slug，需在 registry 定 mapping。
- **編碼**：檔為 UTF-8（CJK 在 cp950 console 顯示為亂碼屬正常，資料正確）。
- 這讓 Phase 1 一上線就有 ~3 年季報 + 14 個月月報的厚度，訊號層不必等累積。

### Puppeteer 的部署約束（重要）
統一(stealth)、（元大提前版若需）Nuxt 攔截需 Puppeteer + Chromium → **這些來源實務上只在本機 `npm run dev` 執行**；Vercel serverless 跑無頭瀏覽器成本高、不在 Phase 1 解決。純 HTTP 來源（SITCA、野村/群益 API、復華 Excel）哪裡都能跑。設計上把抓取端點分「HTTP 類」與「Puppeteer 類」，後者標記為本機限定。

## 架構與檔案地圖（併入 chart-overlay）

```
app/page.tsx                  新增 mode: 'fund'（經理人追蹤）
app/api/fund-crawl/route.ts   抓取端點：?source=sitca-monthly|sitca-quarterly|etf|early
                              逐標的 lazy 分批、回報進度（仿 chips-crawl）
app/api/fund/route.ts         前端讀取：?fund=<id> 單基金持股；?stock=<code> 跨基金分佈；
                              ?pair=<fundId>,<etfId> 雙軌比對
lib/fundSources.ts            13+6 標的清單 + 各來源抓法設定（registry）
lib/fundStore.ts              JSON 快照存取（仿 chipsStore：disk + 記憶體 fallback）
lib/fundParse.ts              各來源 raw → 統一 FundSnapshot（可單元測試）
lib/types.ts                  新增 FundHolding / FundSnapshot / FundMeta 型別
components/FundView.tsx        Phase 1 前端：持股表 + 同投信雙軌比對（最小集）
```

資料層分兩層（不另立 raw 落地層；committed JSON 本身即可重解析的真相）：
- **抓取**（`fund-crawl` route）：逐投信策略取得資料 → 交給 `fundParse` 正規化 → `fundStore` 存。
- **讀取/匯出**（`fund` route + `FundView`）：`fundStore` 讀 JSON → 回前端。

## 資料模型與儲存位置

### 型別（`lib/types.ts`）
```ts
type ReportType = 'monthly_top10' | 'quarterly_full' | 'etf_daily'
interface FundHolding { code: string; name: string; weightPct: number; rank?: number; shares?: number }
interface FundSnapshot {
  fundId: string            // e.g. 'uni-benteng' 或 ETF 代號 '00981A'
  reportType: ReportType
  period: string            // 月報 '2026-04' / 季報 '2026-Q1' / ETF '2026-04-30'
  source: string            // 'sitca' | 'ezmoney' | 'yuanta' | 'nomura-api' | ...
  fetchedAt: string         // ISO
  holdings: FundHolding[]
  meta?: { aum?: number; cashPct?: number; note?: string }
}
```
唯一鍵 `(fundId, reportType, period)` → 同期重抓為 **覆寫(upsert)**，不重複累積。

### 儲存位置與 git 規則（使用者拍板）
| 資料 | 路徑 | git |
|---|---|---|
| 基金 月報/季報（SITCA，**歷史抓不回來**） | `data/funds/<fundId>/<period>.json` | **commit**（留歷史；月頻、檔小，無 PDF#2 警告的高頻肥大） |
| ETF 每日持股（可重抓） | `.funddata/etf/<ticker>/<period>.json` | **gitignore**（沿用 chart-overlay 快取慣例） |

`.gitignore` 需調整：現有 `/.funddata/` 整個忽略可保留（ETF 在其下），但 `data/funds/` 不可被忽略（預設不會）。**先清掉 `.funddata/qfii_*.json`**（已標 orphaned、fundStore 已移除的死檔）。

## 觸發流程（手動 lazy，無排程器）

1. 使用者開「經理人」分頁（mode='fund'）。
2. 前端檢查現在是否 **≥ 18:30（台灣時間）**：未到 → 顯示「資料當日尚未定案，請 18:30 後再抓」，不發抓取請求。
3. 過 18:30 → 前端**分批**呼叫 `fund-crawl`（逐標的 / 逐投信），邊抓邊顯示進度（仿 `ChipsScreener` 的 lazy 自動補齊）。
4. 每標的：先查 `fundStore` 是否已有當期 → 有則跳過（dedup）；無則抓 → parse → 存。

## 錯誤處理與資料品質

- **逐標的隔離**：一檔抓失敗（網站改版/逾時）記錄後**繼續抓其他**，不拖垮整批。
- **禮貌延遲**（≥300ms）、SITCA 若有同步 token 則序列處理（沿用既有 chips 經驗）。
- **編碼**：政府/券商老站若 big5 → `new TextDecoder('big5').decode(arrayBuffer)`（沿用 `lib/dj.ts` 作法）。
- **期別對齊**：一律用**資料源自己的期別欄位**，不用「今天」推。
- **資料品質標記**：月報只揭露 Top10 → `holdings` 權重和 < 100% 屬正常，型別/UI 需標明範疇（`monthly_top10` vs `quarterly_full`），呼應「每個數字追溯來源、標明範疇」原則。
- **Puppeteer 類**：抓不到（非本機/無 Chromium）時回明確錯誤「此來源限本機」，不靜默失敗。

## 測試

- **`fundParse` golden-file 測試**：存少量真實 raw（SITCA HTML、ETF API JSON、復華 Excel）為 fixtures → 測解析出正確 `FundSnapshot`，不連網。這是正確性核心防線。
- **`fundStore` 冪等性測試**：同 `(fundId,reportType,period)` 重存只覆寫、不重複。
- **sanity 驗證器**（當測試）：權重範圍合理、季報 rank 不重複、ETF 權重和接近 100%。

## 待計畫階段確認/逆向（不阻擋本設計）

- SITCA IN2629/IN2630 的 postback 確切欄位（基金下拉、年月參數）→ 用瀏覽器 network 逆向出可複製的 POST 配方；確認**能否翻歷史月份**（能翻則回補，不能則從現在累積）。
- 各 ETF 官網確切端點：野村/群益 API 路徑與 JSON 結構、復華 Excel 下載 URL、統一頁面 stealth 等待條件、安聯有無 API。
- 統一/元大 官網提前版的實際資料路徑。
- chart-overlay 是 Next.js 16（破壞性改版）→ 寫 route/前端前先讀 `node_modules/next/dist/docs/` 對應指南（見 AGENTS.md）。

## 後續階段（路線圖，各自 spec）

1. **訊號引擎**：9 種經理人行為策略（建倉/加減碼/退場），純函式 + registry，吃 `FundSnapshot` 時間序列。
2. **經理人 DNA**：Top3/Top5 集中度、HHI、換股率、四象限散佈圖。
3. **資金流向熱力圖** + Sparkline/Bump Chart（沿用 chart-overlay 的純 SVG / lightweight-charts 風格）。
4. **回測**：抽純函式引擎 + 歷史逐日重跑 + yfinance 或既有 `stocks` API 價格。
