'use client'
import { useEffect, useState, useMemo } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface FlowCell {
  period: string
  total_weight: number
  fund_count: number
  delta: number | null
  funds: Record<string, number>
}

interface FlowRow {
  stock_id: string
  stock_name: string
  cells: FlowCell[]
}

interface FlowData {
  periods: string[]
  funds: string[]
  rows: FlowRow[]
}

type ColorBy = 'weight' | 'delta'
type SortBy = 'latest' | 'mover' | 'persistence'

// ── Helpers ───────────────────────────────────────────────────────────────────

function period(p: string): string {
  // "202505" → "2025-05"
  return p.slice(0, 4) + '-' + p.slice(4, 6)
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function weightOpacity(w: number, maxW: number): number {
  return clamp(0.06 + (w / maxW) * (0.92 - 0.06), 0.06, 0.92)
}

function deltaOpacity(d: number, maxAbs: number): number {
  if (maxAbs === 0) return 0.06
  return clamp(0.06 + (Math.abs(d) / maxAbs) * (0.92 - 0.06), 0.06, 0.92)
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend({
  colorBy,
  maxW,
  maxAbsDelta,
}: {
  colorBy: ColorBy
  maxW: number
  maxAbsDelta: number
}) {
  const barStyle: React.CSSProperties = {
    height: 8,
    borderRadius: 4,
    width: 160,
    display: 'inline-block',
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: '0.72rem',
        color: 'var(--txt-mute)',
        fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
        fontVariantNumeric: 'tabular-nums',
        flexWrap: 'wrap',
      }}
    >
      {colorBy === 'weight' ? (
        <>
          <span>低</span>
          <div
            style={{
              ...barStyle,
              background:
                'linear-gradient(to right, rgba(53,201,214,0.06), rgba(53,201,214,0.92))',
            }}
          />
          <span>高（權重 {maxW.toFixed(0)}%）</span>
        </>
      ) : (
        <>
          <span>−{maxAbsDelta.toFixed(0)}%</span>
          <div
            style={{
              ...barStyle,
              background:
                'linear-gradient(to right, rgba(52,211,153,0.92), rgba(52,211,153,0.06), rgba(52,211,153,0.06) 48%, rgba(255,93,108,0.06) 52%, rgba(255,93,108,0.06), rgba(255,93,108,0.92))',
            }}
          />
          <span>+{maxAbsDelta.toFixed(0)}%</span>
          <span style={{ color: 'var(--down)', marginLeft: 4 }}>● 減</span>
          <span style={{ color: 'var(--up)' }}>● 增</span>
        </>
      )}
    </div>
  )
}

// ── Heatmap cell ──────────────────────────────────────────────────────────────

interface CellProps {
  cell: FlowCell | undefined
  colorBy: ColorBy
  maxW: number
  maxAbsDelta: number
}

function HeatCell({ cell, colorBy, maxW, maxAbsDelta }: CellProps) {
  const [hovered, setHovered] = useState(false)

  if (!cell) {
    return (
      <div
        style={{
          background: 'var(--panel)',
          width: '100%',
          height: '100%',
          borderRadius: 2,
        }}
      />
    )
  }

  let bg: string
  if (colorBy === 'weight') {
    const op = weightOpacity(cell.total_weight, maxW)
    bg = `rgba(53,201,214,${op})`
  } else {
    if (cell.delta === null || cell.delta === 0) {
      bg = 'var(--panel)'
    } else if (cell.delta > 0) {
      const op = deltaOpacity(cell.delta, maxAbsDelta)
      bg = `rgba(255,93,108,${op})`
    } else {
      const op = deltaOpacity(cell.delta, maxAbsDelta)
      bg = `rgba(52,211,153,${op})`
    }
  }

  // Build tooltip text
  const fundBreakdown = Object.entries(cell.funds)
    .map(([f, w]) => `${f}: ${w.toFixed(2)}%`)
    .join('\n')
  const deltaStr =
    cell.delta === null ? '—' : (cell.delta > 0 ? '+' : '') + cell.delta.toFixed(2) + '%'
  const tooltipText = `${period(cell.period)}\n總權重 ${cell.total_weight.toFixed(2)}% | ${cell.fund_count} 檔\nΔ ${deltaStr}\n──────────\n${fundBreakdown}`

  return (
    <div
      title={tooltipText}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: bg,
        width: '100%',
        height: '100%',
        borderRadius: 2,
        cursor: 'pointer',
        position: 'relative',
        outline: hovered ? '1.5px solid var(--accent)' : 'none',
        outlineOffset: '-1px',
        transition: 'outline 0.08s',
      }}
    >
      {/* Show fund_count when ≥ 5 in weight mode */}
      {colorBy === 'weight' && cell.fund_count >= 5 && (
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: 3,
            fontSize: '0.55rem',
            lineHeight: 1,
            color: 'var(--txt)',
            fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
            fontVariantNumeric: 'tabular-nums',
            pointerEvents: 'none',
            opacity: 0.7,
          }}
        >
          {cell.fund_count}
        </span>
      )}
    </div>
  )
}

// ── FlowView (main export) ────────────────────────────────────────────────────

export default function FlowView() {
  const [data, setData] = useState<FlowData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [colorBy, setColorBy] = useState<ColorBy>('weight')
  const [sortBy, setSortBy] = useState<SortBy>('latest')

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    fetch('/api/fund-flow', { signal: ac.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d: FlowData) => setData(d))
      .catch(e => {
        if (e.name !== 'AbortError') setError(e.message ?? '載入失敗')
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })
    return () => ac.abort()
  }, [])

  // Precompute max values from ALL cells
  const { maxW, maxAbsDelta } = useMemo(() => {
    if (!data) return { maxW: 1, maxAbsDelta: 1 }
    let mW = 0
    let mD = 0
    for (const row of data.rows) {
      for (const c of row.cells) {
        if (c.total_weight > mW) mW = c.total_weight
        if (c.delta !== null && Math.abs(c.delta) > mD) mD = Math.abs(c.delta)
      }
    }
    return { maxW: mW || 1, maxAbsDelta: mD || 1 }
  }, [data])

  // Sorted rows
  const sortedRows = useMemo(() => {
    if (!data) return []
    const rows = [...data.rows]
    if (sortBy === 'latest') {
      return rows.sort((a, b) => {
        const aw = a.cells[a.cells.length - 1]?.total_weight ?? 0
        const bw = b.cells[b.cells.length - 1]?.total_weight ?? 0
        return bw - aw
      })
    } else if (sortBy === 'mover') {
      return rows.sort((a, b) => {
        const aSum = a.cells.reduce((s, c) => s + (c.delta ?? 0), 0)
        const bSum = b.cells.reduce((s, c) => s + (c.delta ?? 0), 0)
        // Sort by magnitude desc, preserve sign for tie-break
        return Math.abs(bSum) - Math.abs(aSum)
      })
    } else {
      // persistence: count cells with fund_count > 0, then latest total_weight
      return rows.sort((a, b) => {
        const aCount = a.cells.filter(c => c.fund_count > 0).length
        const bCount = b.cells.filter(c => c.fund_count > 0).length
        if (bCount !== aCount) return bCount - aCount
        const aw = a.cells[a.cells.length - 1]?.total_weight ?? 0
        const bw = b.cells[b.cells.length - 1]?.total_weight ?? 0
        return bw - aw
      })
    }
  }, [data, sortBy])

  // Pill toggle styles
  const pillBase: React.CSSProperties = {
    padding: '4px 12px',
    borderRadius: 20,
    fontSize: '0.78rem',
    fontWeight: 500,
    cursor: 'pointer',
    border: '1px solid var(--line)',
    transition: 'background 0.12s, color 0.12s, border-color 0.12s',
    whiteSpace: 'nowrap' as const,
  }
  function pillStyle(active: boolean): React.CSSProperties {
    return {
      ...pillBase,
      background: active ? 'var(--accent)' : 'transparent',
      color: active ? '#0e1116' : 'var(--txt-dim)',
      borderColor: active ? 'var(--accent)' : 'var(--line)',
      fontWeight: active ? 700 : 500,
    }
  }

  // Cell dimensions (CSS custom props via inline style on container)
  // Wide: 40px wide × 30px tall; narrow: handled via CSS clamp in container
  const CELL_W = 'clamp(22px, 3.2vw, 40px)'
  const CELL_H = 'clamp(24px, 2.6vw, 30px)'
  const GAP = 2
  const LABEL_W = 'clamp(80px, 13vw, 132px)'

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        minWidth: 0,
      }}
    >
      {/* ── Header ── */}
      <div style={{ minWidth: 0 }}>
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
          資金流
        </h1>
        <p style={{ fontSize: '0.82rem', color: 'var(--txt-dim)', margin: '8px 0 0' }}>
          30 檔最具共識度的個股 × 跨 13 檔基金 12 個月權重變化
        </p>
      </div>

      {/* ── Controls row ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          minWidth: 0,
        }}
      >
        {/* colorBy toggle */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={pillStyle(colorBy === 'weight')} onClick={() => setColorBy('weight')}>
            權重
          </button>
          <button style={pillStyle(colorBy === 'delta')} onClick={() => setColorBy('delta')}>
            變化
          </button>
        </div>

        <div
          style={{
            width: 1,
            height: 20,
            background: 'var(--line)',
            flexShrink: 0,
          }}
        />

        {/* sortBy toggle */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={pillStyle(sortBy === 'latest')} onClick={() => setSortBy('latest')}>
            最新權重
          </button>
          <button style={pillStyle(sortBy === 'mover')} onClick={() => setSortBy('mover')}>
            累積動向
          </button>
          <button
            style={pillStyle(sortBy === 'persistence')}
            onClick={() => setSortBy('persistence')}
          >
            持有家數
          </button>
        </div>

        {/* Meta — push to right on wide screens */}
        <div
          style={{
            marginLeft: 'auto',
            fontSize: '0.7rem',
            color: 'var(--txt-mute)',
            whiteSpace: 'nowrap',
          }}
        >
          資料來源：投信投顧公會 月報
        </div>
      </div>

      {/* ── Error / Loading ── */}
      {error && (
        <div style={{ color: 'var(--up)', fontSize: '0.85rem' }}>載入失敗：{error}</div>
      )}
      {loading && (
        <div style={{ color: 'var(--txt-mute)', fontSize: '0.85rem', padding: '32px 0' }}>
          載入中…
        </div>
      )}

      {/* ── Heatmap card ── */}
      {!loading && data && (
        <div
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            overflow: 'hidden',
            minWidth: 0,
          }}
        >
          {/* Scrollable heatmap container — only THIS scrolls horizontally */}
          <div
            style={{
              overflowX: 'auto',
              overflowY: 'visible',
              // Prevent the outer fund area from expanding
              maxWidth: '100%',
            }}
          >
            <div
              style={{
                // min-width needed so content doesn't collapse
                minWidth: `calc(${LABEL_W} + 12 * (${CELL_W} + ${GAP}px) + 64px)`,
                padding: '10px 12px 14px',
              }}
            >
              {/* Period header row */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: GAP,
                  marginBottom: GAP + 2,
                  position: 'sticky',
                  top: 0,
                  background: 'var(--panel)',
                  zIndex: 2,
                  paddingBottom: 4,
                  borderBottom: '1px solid var(--line)',
                }}
              >
                {/* blank corner for stock label column */}
                <div style={{ width: LABEL_W, flexShrink: 0 }} />
                {data.periods.map(p => (
                  <div
                    key={p}
                    style={{
                      width: CELL_W,
                      flexShrink: 0,
                      fontSize: '0.62rem',
                      color: 'var(--txt-dim)',
                      fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                      fontVariantNumeric: 'tabular-nums',
                      textAlign: 'center',
                      lineHeight: 1.2,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {period(p)}
                  </div>
                ))}
                {/* Right badge columns header */}
                <div
                  style={{
                    width: 60,
                    flexShrink: 0,
                    fontSize: '0.62rem',
                    color: 'var(--txt-mute)',
                    textAlign: 'right',
                    paddingRight: 4,
                  }}
                >
                  最新
                </div>
              </div>

              {/* Data rows */}
              {sortedRows.map(row => {
                // Build a map from period → cell for fast lookup
                const cellMap: Record<string, FlowCell> = {}
                for (const c of row.cells) cellMap[c.period] = c

                const lastCell = cellMap[data.periods[data.periods.length - 1]]

                return (
                  <div
                    key={row.stock_id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: GAP,
                      marginBottom: GAP,
                    }}
                  >
                    {/* Stock label */}
                    <div
                      style={{
                        width: LABEL_W,
                        flexShrink: 0,
                        paddingRight: 8,
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--txt)',
                          fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                          fontVariantNumeric: 'tabular-nums',
                          lineHeight: 1.2,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {row.stock_id}
                      </div>
                      <div
                        style={{
                          fontSize: '0.65rem',
                          color: 'var(--txt-dim)',
                          lineHeight: 1.2,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {row.stock_name}
                      </div>
                    </div>

                    {/* 12 heat cells */}
                    {data.periods.map(p => (
                      <div
                        key={p}
                        style={{
                          width: CELL_W,
                          height: CELL_H,
                          flexShrink: 0,
                        }}
                      >
                        <HeatCell
                          cell={cellMap[p]}
                          colorBy={colorBy}
                          maxW={maxW}
                          maxAbsDelta={maxAbsDelta}
                        />
                      </div>
                    ))}

                    {/* Right: badge + latest weight */}
                    <div
                      style={{
                        width: 60,
                        flexShrink: 0,
                        textAlign: 'right',
                        paddingLeft: 4,
                      }}
                    >
                      {lastCell ? (
                        <>
                          <div
                            style={{
                              fontSize: '0.65rem',
                              color: 'var(--txt-dim)',
                              fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                              fontVariantNumeric: 'tabular-nums',
                              lineHeight: 1.3,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {lastCell.fund_count} 檔
                          </div>
                          <div
                            style={{
                              fontSize: '0.68rem',
                              color: 'var(--txt)',
                              fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                              fontVariantNumeric: 'tabular-nums',
                              lineHeight: 1.3,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {lastCell.total_weight.toFixed(1)}%
                          </div>
                        </>
                      ) : (
                        <div style={{ fontSize: '0.65rem', color: 'var(--txt-mute)' }}>—</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Legend */}
          <div
            style={{
              padding: '8px 12px 12px',
              borderTop: '1px solid var(--line)',
            }}
          >
            <Legend colorBy={colorBy} maxW={maxW} maxAbsDelta={maxAbsDelta} />
          </div>
        </div>
      )}
    </div>
  )
}
