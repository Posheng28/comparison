'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import SeriesPanel from '@/components/SeriesPanel'
import { SeriesConfig, DateRange, DATE_RANGE_LABELS, ChartType } from '@/lib/types'

const ChartOverlay = dynamic(() => import('@/components/ChartOverlay'), { ssr: false })

const STORAGE_KEY = 'chart-overlay-series'
const RANGE_KEY   = 'chart-overlay-range'

type SeriesSaved = Omit<SeriesConfig, 'data' | 'loading' | 'error'>

function saveSeries(series: SeriesConfig[]) {
  const saved: SeriesSaved[] = series.map(({ data: _d, loading: _l, error: _e, ...rest }) => rest)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
}

const TICKER_MIGRATION: Record<string, string> = {
  '^spx': '^GSPC', '^ndx': '^NDX', '^ndq': '^NDX', '^dji': '^DJI',
  'soxx.us': 'SOXX', 'qqq.us': 'QQQ', 'qqq': 'QQQ',
}

function migrateSaved(items: SeriesSaved[]): SeriesSaved[] {
  return items.map((s) => {
    if (s.type === 'stocks' && s.ticker) {
      const mapped = TICKER_MIGRATION[s.ticker.toLowerCase()]
      if (mapped) return { ...s, ticker: mapped }
    }
    return s
  })
}

function loadSeries(): SeriesSaved[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return migrateSaved(JSON.parse(raw))
  } catch { return [] }
}

async function fetchSeries(
  cfg: Omit<SeriesConfig, 'data' | 'loading'>,
  range: DateRange,
): Promise<{ data: { date: string; value: number }[]; error?: string }> {
  try {
    let url: string
    if (cfg.type === 'stocks') {
      url = `/api/stocks?ticker=${encodeURIComponent(cfg.ticker!)}&range=${range}`
    } else {
      url = `/api/fred?series=${encodeURIComponent(cfg.fredId!)}&range=${range}`
    }
    const res = await fetch(url)
    const json = await res.json()
    if (json.error) return { data: [], error: json.error }
    return { data: json.data }
  } catch (e) {
    return { data: [], error: e instanceof Error ? e.message : 'Failed to fetch' }
  }
}

export default function Home() {
  const [series, setSeries]           = useState<SeriesConfig[]>([])
  const [range, setRange]             = useState<DateRange>(() => {
    if (typeof window === 'undefined') return '2Y'
    return (localStorage.getItem(RANGE_KEY) as DateRange) || '2Y'
  })
  const [normalizeAll, setNormalizeAll] = useState(false)
  const [sidebarOpen, setSidebarOpen]   = useState(false)
  const hydrated = useRef(false)

  useEffect(() => {
    if (!hydrated.current) return
    saveSeries(series)
  }, [series])

  useEffect(() => {
    hydrated.current = true
    const saved = loadSeries()
    if (saved.length === 0) return
    const restored: SeriesConfig[] = saved.map((s) => ({
      ...s,
      visible: s.visible ?? true,
      data: [],
      loading: s.type !== 'formula',
    }))
    setSeries(restored)
    const r = (localStorage.getItem(RANGE_KEY) as DateRange) || '2Y'
    for (const s of saved) {
      if (s.type !== 'formula') {
        fetchSeries(s, r).then(({ data, error }) => {
          setSeries((prev) => prev.map((p) => p.id === s.id ? { ...p, data, loading: false, error } : p))
        })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadData = useCallback(async (cfg: Omit<SeriesConfig, 'data' | 'loading'>, r: DateRange) => {
    if (cfg.type === 'formula') return
    setSeries((prev) => prev.map((s) => s.id === cfg.id ? { ...s, loading: true, error: undefined } : s))
    const { data, error } = await fetchSeries(cfg, r)
    setSeries((prev) => prev.map((s) => s.id === cfg.id ? { ...s, data, loading: false, error } : s))
  }, [])

  const handleToggleVisible = useCallback((id: string) => {
    setSeries((prev) => prev.map((s) => s.id === id ? { ...s, visible: !s.visible } : s))
  }, [])

  const handleAdd = useCallback(async (cfg: Omit<SeriesConfig, 'data' | 'loading'>) => {
    const newSeries: SeriesConfig = { ...cfg, visible: true, data: [], loading: cfg.type !== 'formula' && cfg.type !== undefined }
    setSeries((prev) => [...prev, newSeries])
    if (cfg.type !== 'formula') {
      const { data, error } = await fetchSeries(cfg, range)
      setSeries((prev) => prev.map((s) => s.id === cfg.id ? { ...s, data, loading: false, error } : s))
    }
  }, [range])

  const handleRemove = useCallback((id: string) => {
    setSeries((prev) => prev.filter((s) => s.id !== id))
  }, [])

  const handleToggleAxis = useCallback((id: string) => {
    setSeries((prev) => prev.map((s) =>
      s.id === id ? { ...s, axis: s.axis === 'left' ? 'right' : 'left' } : s
    ))
  }, [])

  const handleToggleNormalize = useCallback((id: string) => {
    setSeries((prev) => prev.map((s) => s.id === id ? { ...s, normalize: !s.normalize } : s))
  }, [])

  const handleColorChange = useCallback((id: string, color: string) => {
    setSeries((prev) => prev.map((s) => s.id === id ? { ...s, color } : s))
  }, [])

  const handleChartTypeChange = useCallback((id: string, chartType: ChartType) => {
    setSeries((prev) => prev.map((s) => s.id === id ? { ...s, chartType } : s))
  }, [])

  const handleRangeChange = useCallback((newRange: DateRange) => {
    setRange(newRange)
    localStorage.setItem(RANGE_KEY, newRange)
    series.forEach((s) => loadData(s, newRange))
  }, [series, loadData])

  const anyLoading = series.some((s) => s.loading)
  const [showHelp, setShowHelp] = useState(false)

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">

      {/* Mobile sidebar overlay backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — fixed drawer on mobile, static on desktop */}
      <div className={`
        fixed inset-y-0 left-0 z-30 flex transition-transform duration-300 ease-in-out
        lg:static lg:translate-x-0 lg:z-auto
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <SeriesPanel
          series={series}
          onAdd={handleAdd}
          onRemove={handleRemove}
          onToggleVisible={handleToggleVisible}
          onToggleAxis={handleToggleAxis}
          onToggleNormalize={handleToggleNormalize}
          onColorChange={handleColorChange}
          onChartTypeChange={handleChartTypeChange}
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0 gap-2">

          {/* Left: hamburger + title */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="lg:hidden w-8 h-8 flex flex-col items-center justify-center gap-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
            >
              <span className="w-5 h-0.5 bg-current rounded" />
              <span className="w-5 h-0.5 bg-current rounded" />
              <span className="w-5 h-0.5 bg-current rounded" />
            </button>
            <h1 className="text-sm font-semibold text-white whitespace-nowrap">圖表疊加工具</h1>
            {anyLoading && <span className="text-xs text-gray-400 animate-pulse">載入中…</span>}
          </div>

          {/* Right: controls */}
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <button
              onClick={() => setShowHelp(true)}
              className="text-xs px-2 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:border-gray-500 transition-colors whitespace-nowrap">
              使用說明
            </button>
            <button
              onClick={() => setNormalizeAll((v) => !v)}
              className={`text-xs px-2 py-1.5 rounded-lg transition-colors border whitespace-nowrap
                ${normalizeAll
                  ? 'bg-green-700/40 border-green-600 text-green-300'
                  : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'}`}
            >
              {normalizeAll ? '% 變化' : '原始值'}
            </button>

            <div className="flex gap-1">
              {(Object.keys(DATE_RANGE_LABELS) as DateRange[]).map((r) => (
                <button key={r} onClick={() => handleRangeChange(r)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap
                    ${range === r ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                >
                  {DATE_RANGE_LABELS[r]}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="flex-1 p-2 min-h-0">
          <ChartOverlay series={series} normalizeAll={normalizeAll} />
        </div>
      </main>

      {/* Help modal */}
      {showHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
          onClick={() => setShowHelp(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 sticky top-0 bg-gray-900">
              <h2 className="text-base font-semibold text-white">使用說明</h2>
              <button onClick={() => setShowHelp(false)}
                className="text-gray-500 hover:text-gray-200 text-xl leading-none transition-colors">✕</button>
            </div>
            <div className="px-5 py-4 space-y-5 text-sm text-gray-300">

              <p className="text-gray-400 leading-relaxed border-l-2 border-blue-500 pl-3">
                主要使用：疊加台美股（可看同類族群連動與否）與各大經濟數據疊加
              </p>

              <section>
                <h3 className="text-white font-semibold mb-2">新增指標</h3>
                <ul className="space-y-1.5 text-gray-400">
                  <li>• 點左上角 ☰ 開啟側欄</li>
                  <li>• <span className="text-gray-200">預設指標</span>：點分類名稱展開，點指標名稱加入</li>
                  <li>• <span className="text-gray-200">自訂代碼</span>：
                    <ul className="ml-4 mt-1 space-y-1">
                      <li>美股直接輸入代碼，例如 <code className="bg-gray-800 px-1 rounded text-xs">AAPL</code>、<code className="bg-gray-800 px-1 rounded text-xs">TSLA</code></li>
                      <li>台股輸入四位數字，例如 <code className="bg-gray-800 px-1 rounded text-xs">2330</code>，自動判斷上市/上櫃</li>
                      <li>指數加 ^，例如 <code className="bg-gray-800 px-1 rounded text-xs">^GSPC</code>（S&P 500）</li>
                    </ul>
                  </li>
                  <li>• <span className="text-gray-200">四則運算</span>：用已加入的指標 ID 組合公式，例如 <code className="bg-gray-800 px-1 rounded text-xs">US10Y - US2Y</code>（長短天期利差）</li>
                </ul>
              </section>

              <section>
                <h3 className="text-white font-semibold mb-2">圖表操作</h3>
                <ul className="space-y-1.5 text-gray-400">
                  <li>• 滾輪 / 雙指捏合：縮放</li>
                  <li>• 拖拉：左右平移</li>
                  <li>• <code className="bg-gray-800 px-1 rounded text-xs">+</code> / <code className="bg-gray-800 px-1 rounded text-xs">−</code> 按鈕：縮放</li>
                  <li>• 全覽：回到完整時間範圍</li>
                </ul>
              </section>

              <section>
                <h3 className="text-white font-semibold mb-2">指標設定</h3>
                <ul className="space-y-1.5 text-gray-400">
                  <li>• 色塊：點擊更改顏色</li>
                  <li>• <code className="bg-gray-800 px-1 rounded text-xs">〰</code> <code className="bg-gray-800 px-1 rounded text-xs">◭</code> <code className="bg-gray-800 px-1 rounded text-xs">▊</code>：切換折線 / 面積 / 長棒圖</li>
                  <li>• 左軸 / 右軸：切換 Y 軸位置（建議股價左軸、殖利率右軸）</li>
                  <li>• %變化：改為顯示相對起點的百分比，方便不同單位比較</li>
                  <li>• 👁 眼睛：隱藏/顯示（資料保留，可用於公式計算）</li>
                  <li>• × ：刪除指標</li>
                </ul>
              </section>

              <section>
                <h3 className="text-white font-semibold mb-2">其他</h3>
                <ul className="space-y-1.5 text-gray-400">
                  <li>• 右上角「原始值 / % 變化」：一鍵切換所有指標同步顯示百分比</li>
                  <li>• 時間範圍：1年 / 2年 / 5年</li>
                  <li>• 設定自動儲存，重整後恢復上次的指標</li>
                </ul>
              </section>

            </div>
          </div>
        </div>
      )}
    </div>
  )
}
