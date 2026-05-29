'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  IChartApi,
  ISeriesApi,
  Time,
} from 'lightweight-charts'
import type { FlowSeries } from '@/lib/fund/flow'

// 個股「主動 ETF 流向指標」：上方 K 線，下方以柱狀顯示當日跨 8 檔主動式 ETF
// 的淨持股股數變動（紅=加碼、綠=減碼，與台股漲跌色一致）。
// 資料：/api/fund?flow=CODE（ETF 持股歷史聚合）+ /api/stocks?ohlc=1（Yahoo K 線）。

const UP = '#ff5d6c'      // 加碼（紅）
const DOWN = '#34d399'    // 減碼（綠）
const ACCENT = '#35c9d6'

interface PricePoint { date: string; open?: number; high?: number; low?: number; value: number }

/** 股數 → 張（1 張 = 1000 股），1 位小數，含正負號 */
function lots(shares: number): string {
  const l = shares / 1000
  return (l > 0 ? '+' : '') + l.toLocaleString('en-US', { maximumFractionDigits: 1 })
}

export default function FlowView() {
  const [input, setInput] = useState('')
  const [flow, setFlow] = useState<FlowSeries | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const barRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  // 供 tooltip 取最新 flow（init effect 只跑一次）
  const flowByDateRef = useRef<Map<string, FlowSeries['points'][number]>>(new Map())

  const query = useCallback(async (raw: string) => {
    const code = raw.trim().toUpperCase()
    if (!/^\d{4,6}[A-Z]?$/.test(code)) { setError('請輸入台股代號，如 2330'); return }
    setLoading(true); setError(null)
    try {
      const [fRes, sRes] = await Promise.all([
        fetch(`/api/fund?flow=${code}`),
        fetch(`/api/stocks?ticker=${code}&range=1Y&ohlc=1`),
      ])
      const fJson = (await fRes.json()) as FlowSeries & { error?: string }
      if (fJson.error) { setError(fJson.error); setFlow(null); return }
      setFlow(fJson)

      // K 線資料
      let candles: { time: Time; open: number; high: number; low: number; close: number }[] = []
      try {
        const sJson = await sRes.json()
        const arr = (sJson.data as PricePoint[] | undefined) ?? []
        candles = arr
          .filter(d => d.open != null && d.high != null && d.low != null)
          .map(d => ({ time: d.date as Time, open: d.open!, high: d.high!, low: d.low!, close: d.value }))
      } catch { /* 價格抓不到仍顯示流向柱 */ }

      const flowMap = new Map(fJson.points.map(p => [p.date, p]))
      flowByDateRef.current = flowMap

      // 繪圖
      candleRef.current?.setData(candles)
      barRef.current?.setData(
        fJson.points.map(p => ({
          time: p.date as Time,
          value: p.netShares,
          color: p.netShares >= 0 ? UP : DOWN,
        })),
      )
      chartRef.current?.timeScale().fitContent()
    } catch {
      setError('查詢失敗，請稍後再試')
    } finally {
      setLoading(false)
    }
  }, [])

  // 初始化圖表（一張：K 線走右軸於上方、流向柱走左軸壓底部）
  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: { background: { color: '#0e1116' }, textColor: '#8b93a1', fontFamily: 'system-ui, sans-serif', fontSize: 12 },
      grid: { vertLines: { color: 'rgba(255,255,255,0.05)' }, horzLines: { color: 'rgba(255,255,255,0.05)' } },
      crosshair: { vertLine: { color: '#5f6775', labelBackgroundColor: '#1c2230' }, horzLine: { color: '#5f6775', labelBackgroundColor: '#1c2230' } },
      timeScale: { borderColor: '#2a3140', timeVisible: false },
      rightPriceScale: { borderColor: '#2a3140', scaleMargins: { top: 0.05, bottom: 0.42 } }, // K 線在上方
      leftPriceScale: { borderColor: '#2a3140', visible: true, scaleMargins: { top: 0.62, bottom: 0 } }, // 流向柱壓底部
    })
    chartRef.current = chart

    barRef.current = chart.addSeries(HistogramSeries, {
      priceScaleId: 'left',
      priceFormat: { type: 'custom', minMove: 1, formatter: (v: number) => `${Math.round(v / 1000).toLocaleString()}張` },
      priceLineVisible: false,
      lastValueVisible: false,
    })
    candleRef.current = chart.addSeries(CandlestickSeries, {
      priceScaleId: 'right',
      upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
    })

    const ro = new ResizeObserver(([e]) => chart.applyOptions({ width: e.contentRect.width, height: e.contentRect.height }))
    ro.observe(containerRef.current)

    chart.subscribeCrosshairMove(param => {
      const tip = tooltipRef.current
      if (!tip) return
      if (!param.time || !param.point || param.point.x < 0) { tip.style.opacity = '0'; return }
      const pt = flowByDateRef.current.get(String(param.time))
      if (!pt) { tip.style.opacity = '0'; return }
      const head = `<div style="color:#8b93a1;font-size:11px;margin-bottom:4px">${String(param.time)}</div>` +
        `<div style="color:${pt.netShares >= 0 ? UP : DOWN};font-size:13px;font-weight:700;margin-bottom:6px">淨 ${lots(pt.netShares)} 張</div>`
      const rows = pt.contributors.map(c =>
        `<div style="display:flex;gap:10px;align-items:center"><span style="color:#8b93a1;flex:1;font-family:monospace">${c.fundId}</span><span style="color:${c.delta >= 0 ? UP : DOWN};font-family:monospace">${lots(c.delta)} 張</span></div>`,
      ).join('')
      tip.innerHTML = head + rows
      tip.style.opacity = '1'
    })

    return () => {
      ro.disconnect(); chart.remove()
      chartRef.current = null; candleRef.current = null; barRef.current = null
    }
  }, [])

  // 統計
  const pts = flow?.points ?? []
  const cumNet = pts.reduce((s, p) => s + p.netShares, 0)
  const latest = pts.length ? pts[pts.length - 1] : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', minHeight: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--txt)', margin: 0, borderBottom: '2px solid var(--accent)', paddingBottom: 3, display: 'inline-block' }}>
          個股流向
        </h1>
      </div>
      <p style={{ fontSize: '0.8rem', color: 'var(--txt-dim)', margin: 0 }}>
        輸入台股代號，下方柱狀顯示當日跨主動式 ETF 的淨持股變動（紅 = 加碼、綠 = 減碼），上方為 K 線
      </p>

      {/* 查詢列 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && query(input)}
          placeholder="輸入台股代號，如 2330"
          style={{ width: 200, background: 'var(--panel2)', color: 'var(--txt)', fontSize: '0.85rem', borderRadius: 8, padding: '8px 12px', border: '1px solid var(--line)', outline: 'none' }}
        />
        <button
          onClick={() => query(input)}
          disabled={loading}
          style={{ fontSize: '0.85rem', padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#042226', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.5 : 1, fontWeight: 600 }}
        >
          {loading ? '查詢中…' : '查詢'}
        </button>
        {flow && (
          <span style={{ fontSize: '0.82rem', color: 'var(--txt-dim)' }}>
            {flow.code} {flow.name}
            區間累計 <b style={{ color: cumNet >= 0 ? UP : DOWN }}>{lots(cumNet)} 張</b>
            {latest && <>　最新 {latest.date}　<b style={{ color: latest.netShares >= 0 ? UP : DOWN }}>{lots(latest.netShares)} 張</b></>}
            　涵蓋 {flow.etfsCovered.length} 檔 ETF
          </span>
        )}
        {error && <span style={{ fontSize: '0.82rem', color: 'var(--up)' }}>{error}</span>}
      </div>

      {flow && flow.points.length === 0 && !error && (
        <div style={{ fontSize: '0.82rem', color: 'var(--txt-mute)' }}>
          此股票在現有 ETF 快照中無持股變動紀錄（8 檔主動式 ETF 每日累積中，需 ≥2 個交易日才有變動）
        </div>
      )}

      {/* 圖表 */}
      <div style={{ flex: 1, minHeight: 360, position: 'relative' }}>
        {!flow && !loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--txt-mute)', fontSize: '0.85rem', gap: 8, pointerEvents: 'none', zIndex: 10 }}>
            <span>輸入股號查詢主動 ETF 流向</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--txt-mute)' }}>8 檔主動式 ETF 每日累積（過 18:30 進場自動爬），需 ≥2 個交易日才有流向</span>
          </div>
        )}
        {flow && (
          <div style={{ position: 'absolute', top: 4, left: 8, zIndex: 10, display: 'flex', gap: 12, fontSize: '0.72rem', pointerEvents: 'none' }}>
            <span style={{ color: ACCENT }}>K 線</span>
            <span style={{ color: 'var(--txt-mute)' }}>｜ETF 淨流向：</span>
            <span style={{ color: UP }}>■ 加碼</span>
            <span style={{ color: DOWN }}>■ 減碼</span>
          </div>
        )}
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        <div
          ref={tooltipRef}
          style={{ position: 'absolute', top: 24, right: 56, pointerEvents: 'none', opacity: 0, transition: 'opacity 0.1s', zIndex: 20, background: 'rgba(22,26,34,0.96)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', minWidth: 150 }}
        />
      </div>
    </div>
  )
}
