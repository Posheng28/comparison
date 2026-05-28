# 專案筆記（PROJECT_NOTES）

> 給未來的 AI / 開發者：這份是「決策與規則的長期記憶」，避免每次重新推導。
> 程式碼才是真相來源，但**法規數字、設計決策、踩雷紀錄**寫在這裡，省得重查重想。

## 專案概觀

台股圖表比較工具（Next.js 16 App Router + TypeScript + Tailwind，dev: `npm run dev` → http://localhost:3000）。
五個模式（`app/page.tsx` 的 `mode`）：
- `overlay`：多檔疊加比較（`SeriesPanel` + `ChartOverlay`）
- `period`：時段比較，起點對齊（`PeriodPanel` + `PeriodChart`）
- `disposal`：**台股注意/處置推演**（`DisposalTool`）
- `chips`：**集保大戶 / 內部大戶籌碼**（`ChipsView` 個股趨勢 + `ChipsScreener` 篩選排行）← 見第六節
- `fund`：**基金 / 經理人持股**（`FundView`）← 見第七節

---

## 一、注意/處置推演（DisposalTool.tsx）

互動沙盤：匯入股號 → 自動載入近 6 日收盤、注意/處置紀錄 → 拖滑桿模擬未來股價，判斷會不會被注意/處置。

### 注意門檻（第一款，6 個營業日累積漲幅，依市場別）

| 款項 | 上市 TWSE | 上櫃 TPEx | 說明 |
|------|-----------|-----------|------|
| **款一①**（純價格） | 超過 **32%** | 超過 **30%** | 光靠價格成立 |
| **款一②**（價格+價差） | 超過 **25%** 且起迄價差 ≥ **50 元** | 超過 **23%** 且起迄價差 ≥ **40 元** | 漲幅門檻較低，但需同時達價差 |

- 「起迄價差」= 計算日收盤 − **6 日窗口第一天收盤**（`closePath[1]`，即基準日後第一個交易日；**非 `closePath[0]` 基準日本身**）。
- 個股**已知累積漲幅 = 逐日漲跌%「2 位無條件捨去（向零）」相加**（非連乘）：`knownSum = Σ trunc2((close[i]/close[i-1]−1)×100)`。
- 門檻價 = `最近收盤 × (1 + (max(價格門檻%, 全體均值+20) − knownSum) / 100)` 取 `nextTick`（嚴格超過）；款一② 同時取 `max(nextTick(...), clTick(spreadBase+gap))`。
- 款一①② **都屬第一款**，都計入「連 3 日 → 處置」。
- `MARKET_PCT`（百分比）：TWSE `{p1:32, p2:25, p3:25, gap:50}`、TPEx `{p1:30, p2:23, p3:27, gap:40}`。

#### 差幅 ≥ 20% 條件（已部分實作，2026/05）
法規款一①② **逐字**：漲幅與**全體 _及_ 同類**差幅**_均_ ≥ 20%**（AND）。
- **全體差幅已納入**：用 `/api/market-avg` 取全體累積漲幅 `mAvgPct`，門檻改為 `max(價格門檻, mAvgPct+20%)`。
  - `thresh(bp, prevClose, sumKnown, spreadBase, mkt, mAvgPct)`：`diffPct = mAvgPct+20`；`t1=nextTick(prevClose×(1+(max(p1,diffPct)−sumKnown)/100))`、`t2=max(nextTick(prevClose×(1+(max(p2,diffPct)−sumKnown)/100)), clTick(spreadBase+gap))`（`bp` 僅為呼叫對稱保留，價差改用 `spreadBase`）。
  - 市場平靜時門檻 = 價格門檻（不變）；大盤一熱，差幅門檻 > 價格門檻 → 注意門檻自動升。
  - `mAvgPct=null`（未載入/取不到）→ 退回純價格門檻。貫穿卡片/表格/滑桿判色/處置模擬（`computeTriggers`）。
- **上市/上櫃分開**：上市股比上市全體、上櫃股比上櫃全體。`mAvgPct = marketAvg[market]`，三者綁同一 `market`。
- **當日（第 6 間隔）全體漲幅以 0% 計**（無法預測 → 假設）；故 `mAvgPct` = 「已知 5 間隔」值即等於「6 日窗口當日=0」的結果。
- **同類差幅仍無產業資料、未驗證** → 結果為估計（UI 已標註）。**未來若接產業分類可補上同類那半條**。

### 第三款（價量同時異常）— 已實作於原子引擎
- 條件：6 日累積漲幅 > **25%（上市）/ 27%（上櫃）** + 全體差幅 ≥ 20% + 當日量 ≥ **5×最近 60 日均量**。
- 引擎位置：`lib/clauseEngine.ts` 的 `c3()` evaluator（`PCT` 用百分比 `p3:25/27`）；`first:false`，`any` 計規則②③④、不計①。
- 量資料：`stocks` API 的 `fetchYahoo` 已解析 `volume`；匯入時算 `avg60Vol`（最近 60 日均量，當日為變數）。
- **UI**：款三等「需當日量/籌碼」的款，因當日量為變數、只對下一交易日有意義 → 放在沙盤**下方整列寬面板**（非卡片內），含「☐ 假設當日量達標」開關（勾選才把 `volMet` 傳進 `evalCard` 餵處置模擬）。卡片本身只放純價格款（款一、款十一）。
- **未做的款三量條件**：「放大倍數與全體差 ≥ 4 倍」（需全市場量能）、週轉率/本益比除外 → 資料不足，略過。

### 款一~十二 實作現況（2026/05 全補齊）— `lib/clauseEngine.ts`

判定改用**原子引擎** `lib/clauseEngine.ts`：每款為純函式 evaluator → `summarize`→`{first,any}`→`computeTriggers`，live 沙盤與回測共用同一引擎。

**已實作款（可判定）**
- **款一①②**（第一款，計連3日）：純價格漲幅 / 價格+起迄價差，6日窗口，trunc2 精度修正後累加。
- **款二**（純價格 first→當日比值，計連5/10/30）：30/60/90日起迄漲幅門檻，含防重複豁免。
- **款三**（價+當日量，假設開關）：漲幅 > p3 + 5×60日均量，量條件以 UI 開關代入，level 3 計規則②③④不計規則①。
- **款六**（PE/PBR，雙市場 `/api/peratio`，中位數均值）：個股 PE/PBR 對比市場中位數，需當日週轉/券商假設，資料有限標假設。
- **款十一**（起迄價差=當日−窗口第一天 ≥ gap；gap：上櫃=70+floor(P/300)×15、上市=100+floor(P/500)×25）。
- **款十二**（借券，雙市場 `/api/sbl`，6日率>9%上櫃/12%上市 + 放大≥4/5×，假設開關）。

**trunc2 精度修正**：`Math.round(x*1e8)/1e8` 後截斷（整除日如47.3/43→10.00，避免浮點誤差截錯位）。

**新端點**
- `/api/peratio`：上櫃 `tpex_mainboard_peratio_analysis`（回最新快照）、上市 `BWIBBU_d`（日資料）。
- `/api/sbl`：上櫃 `margin/sbl`（借券當日賣出 col9）、上市 `TWT93U`（col9 + 成交量）。

**資料不足、不判定**
- 款四（週轉率，需流通股數）、款五（券商分點）：無公開批量 API → UI 標「資料不足」，不判定。

**處置計數對應**：第一款計規則①（連3日）；款一~十二任一計規則②③④（連5日6次/10日6次/30日12次）。

### 各款可算性現況（差幅一律「全體 AND 同類 均 ≥20%」；同類產業均值無資料，標估計）
- **✅ 已實作（`lib/clauseEngine.ts`）**：款一①②、款二（純價格、含豁免）、款三（價+量+假設）、款六（PE/PBR+假設）、款十一（起迄價差）、款十二（借券+假設）。
- **❌ 資料卡死、UI 標「資料不足」**：
  - 款四 週轉率：分母需「流通在外股數」，`發行股數` 算出差 ~3 倍；無免費批量 API（TDCC/MOPS 僅個別查詢）。
  - 款五 單一券商買賣占比：券商分點全量無公開 API（僅熱門前 30 排行）。
  - 款七 券資比、款八 TDR 溢折價、款六單一投資人占比、同類產業均值：資料不足或未接。
- 原子引擎模式已成型：純函式 evaluator → `summarize` → `{first,any}` → `computeTriggers`，live 沙盤與未來回測共用同一引擎。價格類每張卡都算；當日量/籌碼類只對卡 0（下一交易日）有意義、用假設開關。

### 第二款（起迄兩營業日，長窗口倍漲）— `CLAUSE2`

| 窗口 | 上市 | 上櫃 |
|------|------|------|
| 30 日 | > 100% | > 100% |
| 60 日 | > 130% | > **140%** |
| 90 日 | > 160% | > 160% |

- 用實際匯入的歷史股價算 30/60/90 日起迄漲幅（差幅條件無資料，僅價格面）。
- **防重複豁免（唯一實作的豁免）**：最近 30 日內已有第一款注意 **且** 最近 6 日累積漲幅 ≤ **25%（上市）/ 27%（上櫃）** → 第二款不適用。
- 表格「款二不豁免≥」= `nextTick(bp × (1+dupPct%))`，達此價代表 6 日漲幅破 25/27%，豁免失效。
- 其他豁免（類股均值、溢折價、IPO、除權息…）**未實作**（資料不足）。

### 處置規則（FL007225）

- 規則①：連 **3** 日第一款 → 處置
- 規則②：連 **5** 日（第一款~第八款）→ 處置
- 規則③：最近 **10** 日內 **6** 日 → 處置
- 規則④：最近 **30** 日內 **12** 日 → 處置（門檻永遠 12，不因第幾次處置而降）
- 被處置後，計數從**處置生效日重新起算**（`baseReset`，工具自動帶入最近一次處置日）。

### 台股 tick（最小升降單位，`tickOf`）

`<10:0.01｜10~50:0.05｜50~100:0.1｜100~500:0.5｜500~1000:1｜≥1000:5`
- `flTick/clTick/snapTick/nextTick` 都依價位 tick。
- 漲停 = 前收 ×1.1 無條件捨去到 tick（`lup`）；跌停 = ×0.9 無條件進位（`ldn`）。
- 「超過 X%」採嚴格大於 → `nextTick(p)` = 剛好超過 p 的第一個合法 tick 價。

### 重要設計決策

- **規則卡 = 只算「已確定注意」**（真實紀錄，不含沙盤模擬）；模擬結果只反映在下方「此路徑安全/觸發處置」結果列（`computeTriggers`）。
- **窗口結尾 = 下一個交易日（預測目標）** = `nextTD(todayTD)`；週末跳過。**盤中（台股 <14:00 收盤定案前）`todayTD` 排除今天**（今天那場未完成）→ 例：5/26 盤中 → todayTD=5/25、預測日=5/26（即預測今天收盤）；14:00 後才納入今天、推進到 5/27。
- **規則①②連續 streak**：`getRules` 從 ref(預測日，本身無確定注意) 的**前一完成交易日**起算，否則會被空的預測日打斷成 0（例：5/25 有第一款、5/26 未收盤 → 規則①應為 1/3，非 0）。連續規則中間任一**已完成**交易日無注意才歸零。
- 歷史注意 level：API 將「含第一款字樣」標 level 1、其餘標 level 2（=款二~八）。**規則①只算 level 1**（模擬日的 level 2=款一②則算第一款）。
- 卡片配色：🔴 紅 = 款一①②（第一款）；🟠 橘 = 任一其他注意款 fired（款二/三/六/十一/十二，計連5/10/30）；🟢 綠 = 無注意。處置觸發那張卡 → 紅底加重 + ⚠️觸發。
- 滑桿輸入框：打字時自由輸入（`editStr` 暫存原始字串），**離開欄位(blur)才** snap+clamp。
- 市場別由股價 API 回傳 `market`（`.TWO`→TPEx、`.TW`→TWSE）。
- **盤中不採計今日未定案價**（`dropUnclosedToday`）：台灣時間 **< 14:00 且最新 bar = 今天** → 丟掉那根（Yahoo 盤中給即時價非收盤），只用到上一個完成交易日；≥14:00 收盤定案後才納入。僅注意/處置匯入需要（它把價當收盤判定）；籌碼/大戶用 TDCC 官方收盤資料、不受影響。
- 規則說明彈窗（📖）+ 全市場處置清單彈窗（🚨 查詢清單）。

---

## 二、API 端點（app/api/）— ⚠️ 正確的官方 URL（踩過雷）

| 端點 | 用途 | 關鍵 |
|------|------|------|
| `stocks/route.ts` | Yahoo Finance 股價 | **時間戳要 +8h**（台股 UTC+8，否則日期少一天）；Yahoo 對 .TWO 有延遲 → 補抓 TWSE/TPEx 當月資料；回傳 `market`；`bust=1` 清快取 |
| `notices/route.ts` | 注意紀錄 | TWSE `rwd/zh/announcement/notice`；TPEx `www/zh-tw/bulletin/attention`（直接回 JSON `tables[0].data`） |
| `disposal/route.ts` | 單股處置 | **TWSE 是 `announcement/punish`**（不是 disposal！）；**TPEx 是 `bulletin/disposal`**（不是 disposition！） |
| `disposal-list/route.ts` | 全市場處置清單 | 同上兩個 URL，不帶 code |
| `market-avg/route.ts` | 全體均值（款一差幅 ≥ 20% 基底）；**上市/上櫃算法不同**：上市=普通股等權、上櫃=櫃買指數 | 見下方專段 |

### `market-avg` — 全體累積漲幅（差幅 ≥ 20% 用）⚠️ 上市/上櫃兩套算法
- **上市 = 全體普通股「逐日漲跌%(2 位無條件捨去) 相加」再等權(簡單)平均**（**非** TAIEX 指數）。逐檔抓 `twse.com.tw/exchangeReport/MI_INDEX?response=json&date=YYYYMMDD&type=ALLBUT0999`（`row[0]`=代號、`row[8]`=收盤、`row[9]`=漲跌方向(green=跌)、`row[10]`=漲跌價差），只取普通股 `[1-9]\d{3}`，6 日窗口交集後等權平均（`fetchTwseStocks`+`twseEqAvg`，含重試避免掉檔）。
- **上櫃 = 櫃買指數(發行量加權) 逐日漲跌% 相加(全精度)**。`tpex.org.tw/openapi/v1/tpex_index`（`{Date:YYYYMMDD, Close}`，近一個月）。
- 上市交易日窗口用 TAIEX `MI_5MINS_HIST?response=json&date=YYYYMMDD`（ROC 日期、`row[4]`=收盤指數）定出，再對那 6 日逐檔抓個股。
- **窗口**由 `?date=`（個股最近收盤日）決定，取 ≤ 該日最近 **6** 交易日（**5** 間隔）。回傳 `{ knownIntervals, baseDate, lastClosedDate, twse:{avg}, tpex:{avg} }`；`avg` 取不到為 `null`（個股端退回純價格門檻）。結果快取 6h（key=endYMD），`bust=1` 清。
- **對拍 attstock（2026/05, 5/19→5/26）**：上櫃 9.98（=櫃買指數，本工具一致）；上市 attstock=4.99、本工具普通股等權=**5.24**，差 ~0.25 推測為 attstock 的「全體上市」**排除已被注意/處置的極端漲幅股**（無法從外部精確還原其清單）；此 0.25 對差幅閘門（mAvg+20）幾乎不影響觸發。

### 處置 API 欄位對應（重要）
- **TWSE punish**：`row[2]`=代號、`row[3]`=名稱、`row[6]`=處置起迄時間（斜線格式 `115/05/08～115/05/21`）
- **TPEx disposal**：`row[1]`=公布日期、`row[2]`=代號、`row[3]`=名稱(含HTML連結，要 strip `\(.*?\)`)、`row[5]`=處置起迄時間
- 日期是 ROC 格式，可能是「起~迄」範圍（全形/半形波浪號都要處理）。

### 注意 API 日期 = 計算日；處置起迄時間第一個日期 = 處置生效日（起算點）

---

## 三、時段比較（PeriodPanel.tsx）

- 移除舊固定 presets，改兩類：
  1. **📅 年份**（可展開收合）：今年=年初至今、往年=整年。
  2. **🕘 歷史紀錄**：用 **localStorage** 持久化（key `period_history_v1`），上限 **15** 筆 FIFO，去重（ticker+from+to），點擊套用、✕ 刪除。
- localStorage = 同網域+同裝置+同瀏覽器設定檔才共用；不同人/裝置看不到彼此（無後端帳號）。

### 已加入時段卡片：複製 ⧉ + 行內編輯 ✎
- 每張卡片右上角四鈕：**✎ 編輯｜⧉ 複製｜👁 顯示｜× 刪除**。
- **✎ 編輯**：卡片就地展開成輸入欄，**預填現有 標的/名稱/起迄日期（絕不清空）** → 可只改時間不動標的。Enter 完成、Esc 取消。
- **⧉ 複製**：複製同標的/名稱/時間的新卡，**立刻進入編輯模式**、autoFocus 在代碼欄（工作流：複製→改時間或標的→完成）。
- 改 ticker/from/to 才會重新 fetch；存檔同樣寫入歷史紀錄。
- 父層機制：`page.tsx` 的 `handleUpdateSegment(id, patch)`（`'ticker'|'from'|'to' in patch` 才 refetch），透過 `onUpdate` prop 傳入；複製沿用既有 `onAdd`（自帶 fetch）。

---

## 四、檔案地圖

```
app/page.tsx                  五模式切換（overlay/period/disposal/chips/fund）
components/
  DisposalTool.tsx            注意/處置推演（核心，~1100 行）
  PeriodPanel.tsx             時段比較側欄（年份+歷史）
  SeriesPanel/ChartOverlay/PeriodPanel/PeriodChart   疊加與時段圖
  ChipsView.tsx               籌碼-個股大戶趨勢（自訂張數區間、逐週扣三大法人）
  ChipsScreener.tsx           籌碼-篩選排行（大戶/內部大戶 top50、lazy 自動爬）
  FundView.tsx                訊號台 entry → renders <FundShell/>
  fund/FundShell.tsx          6 區段 sidebar + 冠軍頁；container ResizeObserver < 720px 收合成 top-nav
  fund/MovesView.tsx          01 動向（加減碼聚合）
  fund/HoldingsView.tsx       02 持股 / 03 雙軌（基金 vs 同經理人 ETF）
  fund/StrategiesView.tsx     04 策略（9 訊號回測表，種子資料）
  fund/DnaView.tsx            05 經理人 DNA（concentration × turnover 四象限散佈 + 指標表）
  fund/FlowView.tsx           06 資金流（30×12 cross-fund 熱力圖）
  fund/ChampionsView.tsx      🏆 主動式 ETF YTD Top7 4 維度比較
app/api/
  stocks/                     Yahoo + TWSE/TPEx 補抓股價，回 market（含 volume）
  notices/ disposal/ disposal-list/   注意/處置紀錄
  market-avg/                 全體累積漲幅平均（款一差幅 ≥ 20% 基底）
  chips/                      單股 TDCC 集保級距週歷史（on-demand 爬 qryStock）
  foreign/                    單股逐週三大法人持股%（DJ，via lib/dj）
  chips-rank/                 全市場大戶/內部大戶排行（opendata + legalStore）
  chips-crawl/                背景漸進爬 DJ 三大法人（種子/維護/去重）
  fund/                       基金 API（?fund=、?stock=、?pair=、?moves=1、bare）
  fund-crawl/                 live 抓取（POST {fundId}），18:30 gate (→ 425)
  fund-strategies/            GET data/fund-strategies.json（9 策略回測）
  fund-dna/                   GET data/fund-dna.json（13 基金 DNA）
  fund-flow/                  GET data/fund-flow.json（30×12 熱力圖）
  fund-rank/                  GET data/fund-rank.json（主動式 ETF 排行 snapshot）
lib/fund/
  types.ts                    types (CrawlStrategy 簡化為 'sitca'|'moneydj'|'none')
  sources.ts                  ALL_DEFS（13 基金 + 6 ETF）
  store.ts                    disk+memory snapshot store（仿 chipsStore）
  query.ts                    stockDistribution / dualTrack
  moves.ts                    fundMoves / aggregateMoves（純函式）
  seed.ts                     transformHoldings / transformEtfHoldings（純）
  period.ts                   joyPeriod (YYYYMM → YYYY-MM 或 YYYY-Qn)
  timegate.ts                 isAfterCutoff（台灣 18:30，純）
  parse/moneyDjEtf.ts         統一 ETF parser（cheerio：td.col05/06/07）
  __tests__/fixtures/         moneydj-*.html（6 ETF + rank 真實 fixtures）
scripts/fund-seed.ts          一次性 CLI：npm run fund:seed
data/funds/                   committed 月/季報歷史 seed（JOY88，3 年 × 13 檔 = 6246 列）
data/fund-{strategies,dna,flow,rank}.json   committed 衍生資料
.funddata/etf/                ETF 每日快照本機快取（gitignore，可重抓）
lib/cache.ts                  記憶體快取（getCached/setCached/deleteCachePrefix）
lib/chipsStore.ts             單股 TDCC 級距週資料（per-ticker）
lib/rankStore.ts              全市場大戶佔比每週快照（opendata）
lib/legalStore.ts             全市場三大法人持股 per-stock 週資料（DJ，留 52 週）+ 爬取進度
lib/dj.ts                     DJ 法人持股明細抓取（big5、上市櫃通吃）
docs/PROJECT_NOTES.md         （本檔）
```

---

## 五、法規來源
- FL007225（公布注意交易資訊暨處置作業要點）、FL007226（注意標準附表）
- 上市標準：twse-regulation.twse.com.tw；上櫃標準：證券櫃買中心（用戶提供 PDF）
- 上市/上櫃**數字不同**（如上表），務必依市場別套用。

---

## 六、籌碼 / 大戶（chips 模式）

目標：看「集保大戶持股集中度」與「**內部大戶 = 大戶 − 三大法人**」的趨勢與全市場排行（仿 CMoney 內部大戶 APP，不做財報篩選/社團）。

### 概念與級距
- **大戶**：集保戶股權分散表中持股達門檻的級距佔比。門檻**只能對齊集保級距邊界**（張）：`50/100/200/400/600/800/1000`。
- 級距 index(0-14) → ≥張數下界 `tierLots = [0,1,5,10,15,20,30,40,50,100,200,400,600,800,1000]`。≥X張 = 從該級距加總到 tier15。常用：≥400張=級距12-15、≥1000張=級距15。
- **內部大戶 = 大戶佔比 − 三大法人持股比重%**（扣掉法人才是「非法人大戶」）。

### 資料源（關鍵）
| 用途 | 來源 | 範圍 |
|------|------|------|
| 單股大戶級距週歷史 | TDCC 個股查詢 `qryStock`（POST，Struts **SYNCHRONIZER_TOKEN** 一次性、**token 鏈**、cookie；`firDate`=最新日不是查詢週） | 約 1 年 |
| 全市場大戶（最新週） | TDCC opendata `getOD.ashx?id=1-5`（一次回全市場 ~3900 檔 × 17 級距，欄位：日期,代號,分級,人數,股數,佔比%） | 僅最新一週 |
| 三大法人持股 | **DJ**（富邦/嘉實）`zcl.djhtm?a=代號&c=起&d=迄`（**big5**、伺服器渲染、上市櫃通吃；明細表末欄序：外資/投信/自營**估計持股(張)**、三大法人合計(張)、外資%、三大法人%）| 約 1 年每日 |
| `lib/dj` 回傳 | `LegalRow = [外資%, 三大法人%, 外資張, 投信張, 自營張]`（chips-rank 只讀 index 1=三大法人%；ChipsView 柱圖用張數） | — |
| **`/api/foreign` 快取規則** | 一律抓**固定近 54 週**（不跟著請求 dates 變），快取以 code 為 key → 永遠完整。**勿用請求區間當抓取範圍**（曾因此只快取到 1 天、線圖最後一週暴跌） | — |
| 外資官方（備用） | 上市 MI_QFIIS、上櫃 OpenAPI `tpex_3insti_qfii`（⚠️ MI_QFIIS `row[6]`=**尚可投資比率非持股**，持股要 `(發行−尚可)/發行`，已改用 DJ） | — |
| 全市場三大法人買賣超週報（維護用） | 上市 `TWT54U?date=週起&dymd=週迄&selectType=ALLBUT0999`（1335 檔）；上櫃週報端點未接 | 每週 |

### 內部大戶爬蟲策略（`chips-crawl` + `legalStore`）
- **DJ 逐檔**（一個來源就給完整三大法人，省掉外資/投信/自營分開接）。背景漸進、禮貌延遲 300ms、可中斷續爬（`_progress.json`，換週自動重置）。
- **三層省抓**：①已含本週→**跳過不抓**（dedup）；②有舊資料→**只抓近 3 週**合併進既有；③全新股→才抓滿 ~52 週（種子）。
- **52 週滾動**：DJ 每日 → 收斂每週一點（該週最後一日）→ 只留最新 52 週，新進舊出。
- **lazy 自動**：開「篩選排行→內部大戶」時前端自動分批呼叫 `chips-crawl` 補齊本週並顯示進度；新週自動重爬。**無排程器**、本機/雲端通用。

### 資料時間 / 對齊（重要，別貼錯週）
- **一律用資料源自己的日期欄位當週次**，不要用「今天」推。
- 延遲 ≈「最新可得 = 上一個完成的週五」（週五資料約週一到位），**非整整一週**。opendata 與 DJ 通常都對齊到同一個上週五。
- **同週相減**：`chips-rank` 的 `legalAt()` 把三大法人錨定到「≤ opendata 週」最近一筆 → 兩源更新時間差也不混週。

### 排行（`chips-rank`）
- `?net=1` = 內部大戶（大戶 − 三大法人）；否則原始大戶。`?lots=400|1000`、`?sort=level|d1`、`limit` 預設 100、UI 取 **top 50**。
- **net 全覆蓋 + 資料品質 `src`**（每列回傳）：①legalStore 有 DJ → `src='dj'`（扣完整三大法人，且有 d1 增減）；②否則官方外資 map（`fetchForeignMap`：MI_QFIIS 上市 + tpex_3insti_qfii 上櫃）有 → `src='qfii'`（僅扣外資、無 d1）；③都無 → 法人視同 0、`src='none'`（內部大戶≈大戶）。UI 代號標記：`外`=qfii、`＊`=none、無標=dj。
- **DJ 覆蓋缺口**：全市場 ~2933 檔中 DJ 約 **1970 檔有法人資料**；缺的 ~960 檔（多為低量傳產 11xx/12xx）**DJ 與官方外資皆查無**（法人持股極低），故落到 `src='none'`、頂端會出現 100% 的封閉持有小股（屬正常、非訊號）。**未加過濾開關**（用戶決定）。
- **週對週增減**：opendata 大戶每週累積（rankStore）+ DJ 三大法人歷史 → 第 2 個 opendata 週後自動長出（僅 `src='dj'` 有）。

### ChipsView 個股圖（lightweight-charts，**單張疊圖**，price+volume 式）
- **同一個 chart**：內部大戶%折線走**右軸**（`scaleMargins {top:0.05,bottom:0.42}` → 佔上方）；三大法人庫存**三色堆疊柱**走**左軸**（`scaleMargins {top:0.62,bottom:0}` → 壓底部），共用時間軸 → 每個線點正上方對齊它的柱。
- 堆疊柱用「**累積值 + z-order**」技巧：先 addSeries 總和(自營綠)、再外資+投信(投信橘)、再外資(外資藍)，最後才 addSeries 折線（疊最上層）。視覺由下而上 = 外資/投信/自營。
- **crosshair tooltip**：顯示該週「內部大戶%」+ 外資/投信/自營**個別庫存(張)**（tooltip 用 `qByRef/iByRef/dByRef` 取最新，因 init effect 只跑一次）。
- 自訂「股價區間→張數門檻」可加區間（localStorage `chips_bands_v1`），依股價挑門檻。

### 踩雷
- **勿在 server 執行中 `rm .legaldata`**：store 的 `ensureDisk` 快取了「目錄存在」，刪目錄後 mkdir 不再執行 → 寫檔靜默失敗。要重置請重建目錄或重啟 dev server。
- DJ 是第三方、big5、格式可能改版 → 會需要修 `lib/dj.ts`。投信/自營是 DJ 估算、持股比重以**佔已發行**計（與集保庫存略差），UI 已標。
- TDCC `qryStock` 的 token 一次性：每次 POST 從回應頁抓新 token 給下一週（鏈式）。

### 現況（2026/05 種子完成）
- DJ 種子爬蟲已跑完：**1970 檔**有三大法人週資料（52 週）；其餘 ~960 檔 DJ/官方外資皆無（低法人股）。
- net 排行全市場可用（含品質標記）；lazy 自動（開內部大戶頁→分批補本週、新週重爬）已生效。

### 待辦（之後）
- 週報買賣超維護匯入器（取代維護期的 DJ 抓取，更省）：缺上櫃週報端點 + 需發行股數換算（買賣超→%）+ 除權息漂移處理。**有 1970 檔的 DJ 絕對持股當基準，可改用 `TWT54U?...&selectType=ALLBUT0999` 全市場買賣超累加維護**。
- 回測系統（之前規劃過，未做）：抽 `disposalEngine` 純函式 + 歷史逐日重跑（見對話規劃）。

---

## 七、基金 / 經理人持股（fund 模式）

目標：仿 JOY88 Fund Tracker 的「投信基金月報 × 主動式 ETF 每日持股」交叉比對；核心訊號是**多基金共識**（圈內共識）。**用自有原創設計**，不是 JOY88 視覺拷貝。

### 「訊號台」識別（自有）
- CSS vars 在 `app/globals.css` 的 `.fund-term`：`--bg #0e1116 / --panel #161a22 / --panel2 #1c2230 / --line / --accent #35c9d6 (cyan) / --txt / --txt-dim / --txt-mute / --up #ff5d6c (red) / --down #34d399 (green)`。
- 台股慣例 **red=漲/加碼、green=跌/減碼**（跟西方相反，別搞錯）。
- `font-mono` + `tabular-nums` 所有數字；nav 加 mono index `01..06`。
- RWD：FundShell 用 ResizeObserver 監看 container 寬度，**< 720px 自動把 sidebar 收成 top-nav**；MovesView grid 用 `repeat(auto-fit, minmax(min(100%, 300px), 1fr))` 保證子欄不溢位（`min(100%, X)` 是關鍵 trick）。

### 6 個分頁
| # | 名稱 | 元件 | 內容 |
|---|------|------|------|
| 01 | 動向 | `MovesView` | 本期 vs 上期跨 13 基金 加碼/減碼/新進/落榜聚合 |
| 02 | 持股 | `HoldingsView` | 各基金 Top10 + 雙軌（基金 vs 同經理人 ETF） |
| 03 | 雙軌 | (reuses HoldingsView) | 同 02 切重點 |
| 04 | 策略 | `StrategiesView` | 9 種訊號回測表（Sharpe/Sortino/Alpha…，種子資料） |
| 05 | 經理人 | `DnaView` | concentration × turnover 四象限散佈 + DNA 指標表（13 基金） |
| 06 | 資金流 | `FlowView` | 30 股 × 12 月 cross-fund 熱力圖 |
| 🏆 | 冠軍 | `ChampionsView` | 主動式 ETF YTD Top7 四維比較：績效表 / 共識持股 / 重疊矩陣 / 集中度×YTD 散佈 |

### 資料模型（`lib/fund/types.ts`）
- `ReportType: 'monthly_top10' | 'quarterly_full' | 'etf_daily'`
- `CrawlStrategy: 'sitca' | 'moneydj' | 'none'` — **單純化後**；曾有 7 種策略，refactor 後合併。
- `FundSnapshot { fundId, reportType, period, source, fetchedAt, holdings[], meta? }`
- `FundHolding { code, name, weightPct, rank?, amount?, market? }`
- `FundDef { fundId, kind, company, sitcaCode?, etfTicker?, relatedEtf?, crawl }`
- 唯一鍵 `(fundId, reportType, period)`，重存 = upsert（冪等）。

### 儲存（`lib/fund/store.ts`，仿 chipsStore disk+memory）
| 資料 | 路徑 | git |
|------|------|-----|
| 基金月/季報 | `data/funds/<fundId>/<reportType>_<period>.json` | ✅ commit（SITCA 歷史抓不回來） |
| ETF 每日 | `.funddata/etf/<ticker>/<period>.json` | ❌ gitignore（可重抓快取） |

`saveSnapshot/loadSnapshot/listPeriods` API；唯讀 FS 自動退記憶體（仿 chipsStore 模式）。

### Live 爬蟲 — 6/6 ETF 全部走 MoneyDJ（統一）
經多輪反覆，最終收斂到單一來源：
- **`crawl: 'moneydj'`**：`GET https://www.moneydj.com/ETF/X/Basic/Basic0007B.xdjhtm?etfid=<TICKER>.TW`
  - **UTF-8、無 cookie/token/auth、server-to-server 直接 200**。
  - Cheerio selector：`tr` filter has both `td.col05` + `td.col06`。
  - 取 row：`td.col05 a` text 為 `<中文名>(<code>.TW)`；`td.col06` weight%；`td.col07` shares。
  - Period：掃全頁第一個 `YYYY/MM/DD` → `YYYY-MM-DD`。
  - 一個 parser (`lib/fund/parse/moneyDjEtf.ts`) 通吃 6 檔 ETF。
  - 對拍結果（fixtures 已存）：00980A 45 檔、00981A 51 檔、00982A 59 檔、00988A 13 檔（含日韓股，DJ 只展示台股部分）、00991A 50 檔、00993A 52 檔。
- **`crawl: 'sitca'`**（13 檔基金月報）→ **目前 501 未實作**。詳見死路段。

### Live 爬蟲 — 死路歷史（保留警示，請看完再決定方向）
我們曾把各 ETF 接成「per-issuer 4 個 parser + token bootstrap」一團，全部被 MoneyDJ 取代。保留警示：

| 來源 | 端點 | 為什麼廢 |
|------|------|----------|
| **野村** | `POST nomurafunds.com.tw/API/ETFAPI/api/Fund/GetFundAssets` body `{FundID,SearchDate:null}` 純 REST | 能用，被 MoneyDJ 收編 |
| **群益** | `POST capitalfund.com.tw/CFWeb/api/etf/buyback` body `{fundId,date:null}` (fundId 是內部碼如 "399" 不是 ticker) | 同上 |
| **安聯** | XSRF 2-step：先 `GET /webapi/api/AntiForgery/GetAntiForgeryToken`（24h token + AspNetCore antiforgery cookie），再 `POST /webapi/api/Fund/GetFundAssets {FundID:"E0002"}` 帶 `X-XSRF-TOKEN` header + 上一步 cookie。內部碼 E0002→00993A | XSRF chain 工，但 MoneyDJ 不必做 |
| **CMoney** | `POST /api/customReport/app/v2/dtno/JsonCsv` body `{Dtno:59449513, Params:"AssignID=<ticker>;...;MajorTable=M722;", FilterNo:"0"}` + `Bearer <guest JWT 24h>` + `X-System-Kind` header；token bootstrap 在 `/api/identity/token` 但需公開不可知的 `client_id`，曾用 env `CMONEY_GUEST_TOKEN` | 純人工 token refresh 痛，被 MoneyDJ 收編 |
| **SITCA WebForms `IN2607.aspx?PGMID=IN2629`** | 多步 WebForms postback：GET 拿 `__VIEWSTATE` → POST 公司變更 → POST `BtnQuery=查詢`，token chain 一次性 | **這頁實際是 fund-of-funds 投資比率表**（基金下拉只列「組合型基金」、欄是國內/境外投資比率，無個股代號）。**JOY88 文章宣稱這頁是「月報前十大持股」是錯的**。多步 postback chain 伺服器端復現也未成功（懷疑缺 ASP.NET_SessionId 預熱）。SITCA 真正的個股月報頁尚未找到 |
| **cnYES API** | `GET fund.api.cnyes.com/fund/api/v1/funds/<8字fundId>/holdings` + `X-System-Kind: FUND-DESKTOP` + `X-Platform: WEB` headers | 無 auth 但**致命缺陷**：`id` 欄是英文公司名（"Taiwan Semiconductor Manufacturing Co Ltd"）非台股代號，跨基金 code 匹配壞掉；`portfolioDate` 落後 1-2 個月，**比種子還舊** |

### 種子資料 — 歷史回補
`data/funds/` 已 commit：
- **13 檔 × 22 期 = 6,246 holding rows**
- 季報 2023Q1 → 2026-Q1（4,466 列） + 月報 Top10 2025-03 → 2026-04（1,780 列）
- 來源：JOY88 Fund Tracker 站 `joy88-fund-tracker.web.app` 的靜態 JSON 模式（`/data/holdings.json` 直接抓 1.5MB；不需逆向）
- 一次性 CLI：`scripts/fund-seed.ts`（`npm run fund:seed`），純函式 `lib/fund/seed.ts`。
- Join 規則：JOY88 `fund_name`(中文) ↔ `fund-info.name` → `fund-info.code`(A09002 等) → `slugBySitca(code)` → 我們的 slug；`SLUG_BY_SITCA` 全 ASCII 不嵌中文。**坑**：JOY88 `holdings.json` 的 `fund_code` 是**公司碼**（A0009 = 統一 5 檔基金共用），非每檔唯一；必須用 `fund_name` 當 join key。
- SITCA 月報官方公佈日：**每月第 10 個營業日**。下次發 2026-05 月資料 → 2026/06 月初；屆時 seed 失效需重抓或解 live 來源。

### 加減碼聚合（`lib/fund/moves.ts`，純）
- `fundMoves(prev, curr): FundMove[]` per-stock 變化（`kind: 'add' | 'reduce' | 'enter' | 'exit'`）
- `aggregateMoves(perFund): StockAgg[]` 跨基金 group by code，計 `upCount/downCount/netCount/totalDelta`
- `?moves=1` API 回 `{currPeriod, prevPeriod, up[], down[]}`
- **真實結果（2026-04 vs 2026-03）**：11 檔基金同步加碼台光電（+12.53 合計權重）vs 11 檔基金同步減碼台積電（−16.09 合計）——半導體上游 → PCB/載板 鏈鬱輪轉訊號自然浮現。這就是 JOY88 想做的「圈內共識」。

### 衍生資料檔（committed JSON, FundView 直接 fetch）
| 檔案 | 用途 | 來源 |
|------|------|------|
| `data/fund-strategies.json` | 9 策略回測表 | JOY88 seed `backtest.json` 修剪（保留 summary，丟 trades 陣列） |
| `data/fund-dna.json` | 13 基金 DNA 指標 | JOY88 seed `dna-dual.json` 去 photo 路徑 |
| `data/fund-flow.json` | 30 股 × 12 月 cross-fund 熱力圖 | JOY88 seed `flow-heatmap.json` 原樣 |
| `data/fund-rank.json` | 主動式 ETF YTD 排行 + meta | MoneyDJ `Rank0001.xdjhtm` parsed snapshot |

### ⚠️ Data-integrity 教訓
**Sub-agent 自生「寫實 spread」假資料事故**：曾有 implementer 自行生成 `fund-strategies.json`，graduation 6m 寫成 `0.1634` / 387 trades，與 JOY88 真實 (63.54% / 510 trades) 差距巨大。**Data fixture 必須 verbatim 真實 server response 或 seed 直接 cp**，任何「我幫你補一些寫實 spread」自生資料都是 fabrication，後果嚴重。修補後所有 fixtures 已對拍真實值（含 6 個 MoneyDJ ETF 的 byte-identical 重 curl 驗證）。

### 觸發流程
1. 開 chart-overlay「基金」分頁 → MovesView 預設顯示。
2. 點某基金 → HoldingsView 顯示 Top10 + 切換雙軌按鈕。
3. 點「更新本期」→ POST `/api/fund-crawl {fundId}`；18:30 前回 425、未實作 → 501、live ETF → 200 + 寫 `.funddata/etf/<ticker>/<date>.json`。
4. 冠軍頁從 `data/fund-rank.json` 直接讀，不走 fund-crawl。

### 待辦
- **SITCA 月報 live**：fund-of-funds 那頁不是答案；要找對的 SITCA 頁/PDF 或換家。
- **MoneyDJ 基金區**（`charset=big5`，仿 ETF 流程）：覆蓋全 13 檔最強候選；需 1 個 cURL 解 fund-ID pattern（DJ 用內部 6-字英數碼如 `ACIC06`）+ 13 個 ID 對應。可重用 `lib/dj.ts` 的 big5 流。
- **cnYES 補完**：能補但缺代號+資料落後，CP 值偏低，不推。
- **00988A 統一全球創新** 含日韓股部分，MoneyDJ 不展示——若要完整 23 檔需另案。
- 2026/06 月初 SITCA 發 5 月資料時，要決定走哪條 live 路。
