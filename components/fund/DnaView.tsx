'use client'
import { useEffect, useState, useRef } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Concentration {
  avg_top3: number
  avg_top5: number
  avg_hhi: number
}

interface Turnover {
  avg_rate: number
  history: number[]
}

interface Stability {
  avg_months_in_top10: number
  unique_stocks: number
  top_persistent: { stock_id: string; stock_name: string; months: number }[]
}

interface PeriodBlock {
  periods: number
  date_range: string
  concentration: Concentration
  turnover: Turnover
  stability: Stability
}

interface FundDna {
  fund_name: string
  short_name: string
  fund_aum_nt: number
  manager: string
  related_etf: string
  monthly: PeriodBlock
  quarterly: PeriodBlock
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAum(nt: number): string {
  const yi = nt / 1e8
  return yi >= 10 ? yi.toFixed(0) + '億' : yi.toFixed(1) + '億'
}

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

// ── Scatter chart (hand-built SVG) ────────────────────────────────────────────

const VB_W = 520
const VB_H = 420
const MARGIN = { top: 36, right: 40, bottom: 54, left: 58 }
const PLOT_W = VB_W - MARGIN.left - MARGIN.right
const PLOT_H = VB_H - MARGIN.top - MARGIN.bottom

function scaleLinear(domain: [number, number], range: [number, number]) {
  return (v: number) =>
    range[0] + ((v - domain[0]) / (domain[1] - domain[0])) * (range[1] - range[0])
}

function bubbleRadius(aum: number, minAum: number, maxAum: number): number {
  const t = (Math.sqrt(aum) - Math.sqrt(minAum)) / (Math.sqrt(maxAum) - Math.sqrt(minAum) + 1e-9)
  return 6 + t * 20
}

interface TooltipState {
  x: number
  y: number
  fund: FundDna
  block: PeriodBlock
}

function ScatterChart({
  funds,
  block,
  getBlock,
}: {
  funds: FundDna[]
  block: 'monthly' | 'quarterly'
  getBlock: (f: FundDna) => PeriodBlock
}) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const xs = funds.map(f => getBlock(f).turnover.avg_rate)
  const ys = funds.map(f => getBlock(f).concentration.avg_top5)
  const auMs = funds.map(f => f.fund_aum_nt)

  const xMax = Math.ceil(Math.max(...xs) * 1.1)
  const yMax = Math.ceil(Math.max(...ys) * 1.1)
  const xMin = 0
  const yMin = 0

  const xScale = scaleLinear([xMin, xMax], [0, PLOT_W])
  const yScale = scaleLinear([yMin, yMax], [PLOT_H, 0])

  const medX = median(xs)
  const medY = median(ys)
  const qx = xScale(medX)
  const qy = yScale(medY)

  const minAum = Math.min(...auMs)
  const maxAum = Math.max(...auMs)

  const xTicks = Array.from({ length: 6 }, (_, i) => Math.round((xMax / 5) * i))
  const yTicks = Array.from({ length: 6 }, (_, i) => Math.round((yMax / 5) * i))

  function handleMouseMove(e: React.MouseEvent<SVGCircleElement>, fund: FundDna) {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const scaleX = VB_W / rect.width
    const scaleY = VB_H / rect.height
    const px = (e.clientX - rect.left) * scaleX
    const py = (e.clientY - rect.top) * scaleY
    setTooltip({ x: px, y: py, fund, block: getBlock(fund) })
  }

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        style={{ width: '100%', display: 'block' }}
        onMouseLeave={() => setTooltip(null)}
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {/* X axis */}
          <line x1={0} y1={PLOT_H} x2={PLOT_W} y2={PLOT_H} stroke="var(--line)" strokeWidth={1} />
          {xTicks.map(t => (
            <g key={t} transform={`translate(${xScale(t)},${PLOT_H})`}>
              <line y2={5} stroke="var(--line)" strokeWidth={0.8} />
              <text
                y={18}
                textAnchor="middle"
                fill="var(--txt-mute)"
                fontSize={11}
                fontFamily="ui-monospace,monospace"
              >
                {t}
              </text>
            </g>
          ))}
          {/* X axis label */}
          <text
            x={PLOT_W / 2}
            y={PLOT_H + 40}
            textAnchor="middle"
            fill="var(--txt-dim)"
            fontSize={12}
          >
            換股率%
          </text>

          {/* Y axis */}
          <line x1={0} y1={0} x2={0} y2={PLOT_H} stroke="var(--line)" strokeWidth={1} />
          {yTicks.map(t => (
            <g key={t} transform={`translate(0,${yScale(t)})`}>
              <line x2={-5} stroke="var(--line)" strokeWidth={0.8} />
              <text
                x={-10}
                textAnchor="end"
                dominantBaseline="middle"
                fill="var(--txt-mute)"
                fontSize={11}
                fontFamily="ui-monospace,monospace"
              >
                {t}
              </text>
            </g>
          ))}
          {/* Y axis label */}
          <text
            x={-PLOT_H / 2}
            y={-44}
            textAnchor="middle"
            fill="var(--txt-dim)"
            fontSize={12}
            transform="rotate(-90)"
          >
            Top5 集中度%
          </text>

          {/* Quadrant divider lines at median */}
          <line
            x1={qx}
            y1={0}
            x2={qx}
            y2={PLOT_H}
            stroke="var(--line)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          <line
            x1={0}
            y1={qy}
            x2={PLOT_W}
            y2={qy}
            stroke="var(--line)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />

          {/* Quadrant labels */}
          <text x={qx / 2} y={qy / 2 + 6} textAnchor="middle" fill="var(--txt-mute)" fontSize={11}>
            重壓長抱
          </text>
          <text
            x={qx + (PLOT_W - qx) / 2}
            y={qy / 2 + 6}
            textAnchor="middle"
            fill="var(--txt-mute)"
            fontSize={11}
          >
            重壓輪動
          </text>
          <text
            x={qx / 2}
            y={qy + (PLOT_H - qy) / 2 + 6}
            textAnchor="middle"
            fill="var(--txt-mute)"
            fontSize={11}
          >
            分散長抱
          </text>
          <text
            x={qx + (PLOT_W - qx) / 2}
            y={qy + (PLOT_H - qy) / 2 + 6}
            textAnchor="middle"
            fill="var(--txt-mute)"
            fontSize={11}
          >
            分散短打
          </text>

          {/* Bubbles */}
          {funds.map((fund, i) => {
            const pb = getBlock(fund)
            const cx = xScale(pb.turnover.avg_rate)
            const cy = yScale(pb.concentration.avg_top5)
            const r = bubbleRadius(fund.fund_aum_nt, minAum, maxAum)
            // Simple label offset: alternate above/below to reduce overlap
            const labelDy = i % 2 === 0 ? -(r + 5) : r + 13
            return (
              <g key={fund.short_name}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="rgba(53,201,214,0.45)"
                  stroke="var(--accent)"
                  strokeWidth={1.2}
                  style={{ cursor: 'default' }}
                  onMouseMove={e => handleMouseMove(e, fund)}
                  onMouseLeave={() => setTooltip(null)}
                />
                <text
                  x={cx}
                  y={cy + labelDy}
                  textAnchor="middle"
                  fill="var(--txt-dim)"
                  fontSize={9.5}
                  fontFamily="ui-monospace,monospace"
                  style={{ pointerEvents: 'none' }}
                >
                  {fund.short_name}
                </text>
              </g>
            )
          })}
        </g>
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          style={{
            position: 'absolute',
            left: `${(tooltip.x / VB_W) * 100}%`,
            top: `${(tooltip.y / VB_H) * 100}%`,
            transform: 'translate(10px, -50%)',
            background: 'var(--panel2)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: '0.75rem',
            color: 'var(--txt)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 10,
            lineHeight: 1.8,
          }}
        >
          <div style={{ fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>
            {tooltip.fund.short_name}
          </div>
          <div style={{ color: 'var(--txt-dim)' }}>
            經理人 <span style={{ color: 'var(--txt)' }}>{tooltip.fund.manager}</span>
          </div>
          <div>
            Top5{' '}
            <span style={{ color: 'var(--txt)', fontFamily: 'ui-monospace,monospace' }}>
              {tooltip.block.concentration.avg_top5.toFixed(1)}%
            </span>
          </div>
          <div>
            換股率{' '}
            <span style={{ color: 'var(--txt)', fontFamily: 'ui-monospace,monospace' }}>
              {tooltip.block.turnover.avg_rate.toFixed(1)}%
            </span>
          </div>
          <div>
            HHI{' '}
            <span style={{ color: 'var(--txt)', fontFamily: 'ui-monospace,monospace' }}>
              {Math.round(tooltip.block.concentration.avg_hhi)}
            </span>
          </div>
          <div>
            AUM{' '}
            <span style={{ color: 'var(--txt)', fontFamily: 'ui-monospace,monospace' }}>
              {fmtAum(tooltip.fund.fund_aum_nt)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── DNA Metrics Table ─────────────────────────────────────────────────────────

function DnaTable({
  funds,
  getBlock,
}: {
  funds: FundDna[]
  getBlock: (f: FundDna) => PeriodBlock
}) {
  const sorted = [...funds].sort(
    (a, b) => getBlock(b).concentration.avg_top5 - getBlock(a).concentration.avg_top5,
  )

  const headerStyle: React.CSSProperties = {
    padding: '9px 12px',
    fontSize: '0.75rem',
    color: 'var(--txt-dim)',
    fontWeight: 600,
    borderBottom: '1px solid var(--line)',
    textAlign: 'right',
    whiteSpace: 'nowrap',
  }
  const headerStyleLeft: React.CSSProperties = { ...headerStyle, textAlign: 'left' }
  const cellStyle: React.CSSProperties = {
    padding: '8px 12px',
    fontSize: '0.8rem',
    color: 'var(--txt)',
    fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'right',
    whiteSpace: 'nowrap',
  }
  const cellStyleLeft: React.CSSProperties = { ...cellStyle, textAlign: 'left' }

  return (
    <div
      style={{
        overflowX: 'auto',
        borderRadius: 10,
        border: '1px solid var(--line)',
        background: 'var(--panel)',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
        <thead>
          <tr>
            <th style={headerStyleLeft}>基金</th>
            <th style={headerStyleLeft}>經理人</th>
            <th style={headerStyle}>Top3%</th>
            <th style={headerStyle}>Top5%</th>
            <th style={headerStyle}>HHI</th>
            <th style={headerStyle}>換股率%</th>
            <th style={headerStyle}>平均在榜月</th>
            <th style={headerStyle}>接觸檔數</th>
            <th style={headerStyle}>AUM</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(fund => {
            const pb = getBlock(fund)
            return (
              <tr
                key={fund.fund_name}
                style={{ borderTop: '1px solid var(--line)', transition: 'background 0.1s' }}
                onMouseEnter={e => {
                  ;(e.currentTarget as HTMLTableRowElement).style.background = 'var(--panel2)'
                }}
                onMouseLeave={e => {
                  ;(e.currentTarget as HTMLTableRowElement).style.background = 'transparent'
                }}
              >
                <td style={cellStyleLeft}>{fund.short_name}</td>
                <td style={{ ...cellStyleLeft, color: 'var(--txt-dim)', fontFamily: 'inherit' }}>
                  {fund.manager}
                </td>
                <td style={cellStyle}>{pb.concentration.avg_top3.toFixed(1)}%</td>
                <td style={cellStyle}>{pb.concentration.avg_top5.toFixed(1)}%</td>
                <td style={cellStyle}>{Math.round(pb.concentration.avg_hhi)}</td>
                <td style={cellStyle}>{pb.turnover.avg_rate.toFixed(1)}%</td>
                <td style={cellStyle}>{pb.stability.avg_months_in_top10.toFixed(1)}</td>
                <td style={cellStyle}>{pb.stability.unique_stocks}</td>
                <td style={cellStyle}>{fmtAum(fund.fund_aum_nt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── DnaView (main export) ─────────────────────────────────────────────────────

export default function DnaView() {
  const [funds, setFunds] = useState<FundDna[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'monthly' | 'quarterly'>('monthly')

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    fetch('/api/fund-dna', { signal: ac.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d: FundDna[]) => setFunds(d))
      .catch(e => {
        if (e.name !== 'AbortError') setError(e.message ?? '載入失敗')
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })
    return () => ac.abort()
  }, [])

  const getBlock = (f: FundDna): PeriodBlock => f[view]

  const pillBase: React.CSSProperties = {
    padding: '4px 14px',
    borderRadius: 20,
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid var(--line)',
    transition: 'background 0.12s, color 0.12s, border-color 0.12s',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div>
        <h1
          style={{
            fontSize: '1.4rem',
            fontWeight: 700,
            color: 'var(--txt)',
            margin: 0,
            borderBottom: '2px solid var(--accent)',
            paddingBottom: 3,
            display: 'inline-block',
          }}
        >
          經理人 DNA
        </h1>
        <p style={{ fontSize: '0.82rem', color: 'var(--txt-dim)', margin: '8px 0 0' }}>
          13 檔基金的操盤風格量化：集中度 × 換股率
        </p>
      </div>

      {/* Monthly / Quarterly toggle */}
      <div style={{ display: 'flex', gap: 8 }}>
        {(['monthly', 'quarterly'] as const).map(v => {
          const active = view === v
          return (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                ...pillBase,
                background: active ? 'var(--accent)' : 'transparent',
                color: active ? '#0e1116' : 'var(--txt-dim)',
                borderColor: active ? 'var(--accent)' : 'var(--line)',
                fontWeight: active ? 700 : 400,
              }}
            >
              {v === 'monthly' ? '月頻' : '季頻'}
            </button>
          )
        })}
      </div>

      {/* Error */}
      {error && (
        <div style={{ color: 'var(--up)', fontSize: '0.85rem' }}>載入失敗：{error}</div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ color: 'var(--txt-mute)', fontSize: '0.85rem', padding: '32px 0' }}>
          載入中…
        </div>
      )}

      {/* Content */}
      {!loading && funds && (
        <>
          {/* Scatter chart */}
          <div
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              borderRadius: 10,
              padding: '16px',
              maxWidth: 580,
            }}
          >
            <div
              style={{
                fontSize: '0.8rem',
                color: 'var(--txt-dim)',
                marginBottom: 12,
                display: 'flex',
                gap: 16,
                flexWrap: 'wrap',
              }}
            >
              <span>
                泡泡大小 ∝ AUM；分隔線 = 各軸中位數；
                {view === 'monthly'
                  ? `月頻 (${funds[0]?.monthly.date_range})`
                  : `季頻 (${funds[0]?.quarterly.date_range})`}
              </span>
            </div>
            <ScatterChart funds={funds} block={view} getBlock={getBlock} />
          </div>

          {/* DNA metrics table */}
          <div>
            <div
              style={{
                fontSize: '0.82rem',
                fontWeight: 600,
                color: 'var(--txt-dim)',
                marginBottom: 10,
                letterSpacing: '0.02em',
              }}
            >
              DNA 指標一覽（依 Top5 集中度降序）
            </div>
            <DnaTable funds={funds} getBlock={getBlock} />
          </div>
        </>
      )}
    </div>
  )
}
