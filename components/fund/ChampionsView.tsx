'use client'
import { useEffect, useState, useMemo } from 'react'
import type { RankRow } from '@/lib/fund/parse/moneyDjRank'
import type { FundSnapshot } from '@/lib/fund/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RankData {
  top7: RankRow[]
  fetchedAt: string
}

interface FundData {
  def: { fundId: string; kind: string }
  etfDaily: FundSnapshot | null
}

interface HoldingDetail {
  code: string
  name: string
  weightPct: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(v: number | null, decimals = 2): string {
  if (v === null) return 'N/A'
  return (v > 0 ? '+' : '') + v.toFixed(decimals)
}

function numColor(v: number | null): string {
  if (v === null) return 'var(--txt-dim)'
  return v > 0 ? 'var(--up)' : v < 0 ? 'var(--down)' : 'var(--txt-dim)'
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

// Jaccard similarity between two sets of stock codes
function jaccard(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 0
  let inter = 0
  for (const c of setA) if (setB.has(c)) inter++
  return inter / (setA.size + setB.size - inter)
}

// ── Panel A — Performance Table ───────────────────────────────────────────────

function PanelA({ top7, loading }: { top7: RankRow[]; loading: boolean }) {
  return (
    <div
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--line)' }}>
        <span
          style={{
            fontSize: '0.9rem',
            fontWeight: 700,
            color: 'var(--txt)',
            borderBottom: '2px solid var(--accent)',
            paddingBottom: 2,
          }}
        >
          績效表
        </span>
      </div>

      {loading && <div style={{ padding: 32, textAlign: 'center', color: 'var(--txt-mute)', fontSize: '0.82rem' }}>載入中…</div>}
      {!loading && top7.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--txt-mute)', fontSize: '0.82rem' }}>無資料</div>
      )}

      {!loading && top7.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.78rem',
              fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <thead>
              <tr style={{ color: 'var(--txt-mute)', textAlign: 'right' }}>
                {['名次', '代號', '名稱', 'YTD%', '6m%', '3m%', '1m%', '1w%', '1d%'].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      padding: '7px 10px',
                      fontWeight: 500,
                      borderBottom: '1px solid var(--line)',
                      textAlign: i < 3 ? 'left' : 'right',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {top7.map((r, i) => {
                const isFirst = i === 0
                return (
                  <tr
                    key={r.code}
                    style={{
                      borderTop: '1px solid var(--line)',
                      background: isFirst ? 'rgba(53,201,214,0.05)' : 'transparent',
                    }}
                    onMouseEnter={e => ((e.currentTarget as HTMLTableRowElement).style.background = 'var(--panel2)')}
                    onMouseLeave={e => ((e.currentTarget as HTMLTableRowElement).style.background = isFirst ? 'rgba(53,201,214,0.05)' : 'transparent')}
                  >
                    <td style={{ padding: '7px 10px', textAlign: 'left', color: isFirst ? 'var(--accent)' : 'var(--txt-mute)' }}>
                      {i + 1}
                    </td>
                    <td style={{ padding: '7px 10px', textAlign: 'left', color: 'var(--txt)' }}>{r.code}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'left', color: 'var(--txt-dim)', whiteSpace: 'nowrap', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</td>
                    {[r.ytd, r.m6, r.m3, r.m1, r.w1, r.d1].map((v, j) => (
                      <td key={j} style={{ padding: '7px 10px', textAlign: 'right', color: numColor(v) }}>
                        {pct(v)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Panel B — Consensus Holdings ─────────────────────────────────────────────

interface ConsensusItem {
  code: string
  name: string
  count: number
  totalWeight: number
  avgWeight: number
  maxEtf: string
  maxWeight: number
}

function PanelB({ top7, holdings, loading }: { top7: RankRow[]; holdings: Map<string, HoldingDetail[]>; loading: boolean }) {
  const n = top7.length

  const consensus = useMemo<ConsensusItem[]>(() => {
    if (!n) return []
    const map = new Map<string, ConsensusItem & { maxWeight: number; maxEtf: string }>()
    for (const r of top7) {
      const hs = holdings.get(r.code) ?? []
      for (const h of hs) {
        const existing = map.get(h.code)
        if (existing) {
          existing.count++
          existing.totalWeight += h.weightPct
          existing.avgWeight = existing.totalWeight / existing.count
          if (h.weightPct > existing.maxWeight) { existing.maxWeight = h.weightPct; existing.maxEtf = r.code }
        } else {
          map.set(h.code, { code: h.code, name: h.name, count: 1, totalWeight: h.weightPct, avgWeight: h.weightPct, maxWeight: h.weightPct, maxEtf: r.code })
        }
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.count - a.count || b.totalWeight - a.totalWeight)
      .slice(0, 15)
  }, [top7, holdings])

  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--line)' }}>
        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--txt)', borderBottom: '2px solid var(--up)', paddingBottom: 2 }}>
          共識持股
        </span>
        <span style={{ marginLeft: 10, fontSize: '0.72rem', color: 'var(--txt-mute)' }}>7 檔 ETF 共同持有</span>
      </div>

      {loading && <div style={{ padding: 32, textAlign: 'center', color: 'var(--txt-mute)', fontSize: '0.82rem' }}>載入中…</div>}
      {!loading && consensus.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: 'var(--txt-mute)', fontSize: '0.82rem' }}>無持股資料</div>}

      {!loading && consensus.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem', fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)', fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr style={{ color: 'var(--txt-mute)' }}>
                {['代號', '名稱', '持有檔數', '合計%', '均值%', '最大重壓'].map((h, i) => (
                  <th key={h} style={{ padding: '6px 10px', fontWeight: 500, borderBottom: '1px solid var(--line)', textAlign: i < 2 ? 'left' : 'center' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {consensus.map(item => {
                const frac = item.count / n
                const isHigh = item.count >= Math.ceil(n * 0.7)
                return (
                  <tr key={item.code} style={{ borderTop: '1px solid var(--line)' }}
                    onMouseEnter={e => ((e.currentTarget as HTMLTableRowElement).style.background = 'var(--panel2)')}
                    onMouseLeave={e => ((e.currentTarget as HTMLTableRowElement).style.background = 'transparent')}
                  >
                    <td style={{ padding: '6px 10px', color: 'var(--txt)' }}>{item.code}</td>
                    <td style={{ padding: '6px 10px', color: 'var(--txt-dim)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <span style={{
                          display: 'inline-block',
                          background: isHigh ? 'rgba(53,201,214,0.25)' : 'var(--panel2)',
                          color: isHigh ? 'var(--accent)' : 'var(--txt-dim)',
                          borderRadius: 4,
                          padding: '1px 6px',
                          fontWeight: isHigh ? 700 : 400,
                          minWidth: 32,
                          textAlign: 'center',
                        }}>
                          {item.count}/{n}
                        </span>
                        <div style={{ width: 40, height: 4, background: 'var(--line)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ width: `${frac * 100}%`, height: '100%', background: 'var(--accent)', opacity: 0.7, borderRadius: 2 }} />
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--txt)' }}>{item.totalWeight.toFixed(2)}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--txt-dim)' }}>{item.avgWeight.toFixed(2)}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--txt-mute)', fontSize: '0.7rem' }}>
                      {item.maxEtf}&nbsp;<span style={{ color: 'var(--txt-dim)' }}>{item.maxWeight.toFixed(1)}%</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Panel C — Overlap Matrix ──────────────────────────────────────────────────

function PanelC({ top7, holdings, loading }: { top7: RankRow[]; holdings: Map<string, HoldingDetail[]>; loading: boolean }) {
  const matrix = useMemo(() => {
    return top7.map(ri => {
      const si = new Set((holdings.get(ri.code) ?? []).map(h => h.code))
      return top7.map(rj => {
        if (ri.code === rj.code) return null
        const sj = new Set((holdings.get(rj.code) ?? []).map(h => h.code))
        const j = jaccard(si, sj)
        const shared = [...si].filter(c => sj.has(c)).length
        return { j, shared }
      })
    })
  }, [top7, holdings])

  const cellSize = 50

  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--line)' }}>
        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--txt)', borderBottom: '2px solid var(--accent)', paddingBottom: 2 }}>
          持股重疊矩陣
        </span>
        <span style={{ marginLeft: 10, fontSize: '0.72rem', color: 'var(--txt-mute)' }}>Jaccard 相似度</span>
      </div>

      {loading && <div style={{ padding: 32, textAlign: 'center', color: 'var(--txt-mute)', fontSize: '0.82rem' }}>載入中…</div>}
      {!loading && top7.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: 'var(--txt-mute)', fontSize: '0.82rem' }}>無資料</div>}

      {!loading && top7.length > 0 && (
        <div style={{ padding: 16, overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: `48px repeat(${top7.length}, ${cellSize}px)`, gap: 2, width: 'fit-content' }}>
            {/* Header row */}
            <div />
            {top7.map(r => (
              <div key={r.code} style={{ fontSize: '0.65rem', color: 'var(--txt-mute)', fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)', textAlign: 'center', paddingBottom: 4, fontVariantNumeric: 'tabular-nums' }}>
                {r.code.replace('00', '')}
              </div>
            ))}
            {/* Data rows */}
            {top7.map((ri, i) => (
              <>
                <div key={ri.code + '-label'} style={{ fontSize: '0.65rem', color: 'var(--txt-mute)', fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)', textAlign: 'right', paddingRight: 6, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', fontVariantNumeric: 'tabular-nums' }}>
                  {ri.code.replace('00', '')}
                </div>
                {top7.map((rj, j) => {
                  const cell = matrix[i]?.[j]
                  if (cell === null || !cell) {
                    return (
                      <div key={rj.code} style={{ width: cellSize, height: cellSize, background: 'var(--panel2)', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', color: 'var(--txt-mute)' }}>
                        —
                      </div>
                    )
                  }
                  const opacity = clamp(cell.j * 0.92, 0.04, 0.92)
                  return (
                    <div
                      key={rj.code}
                      title={`${ri.code} × ${rj.name || rj.code}\n共 ${cell.shared} 支股票`}
                      style={{
                        width: cellSize,
                        height: cellSize,
                        background: `rgba(53,201,214,${opacity})`,
                        borderRadius: 3,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.68rem',
                        fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                        fontVariantNumeric: 'tabular-nums',
                        color: opacity > 0.5 ? 'rgba(0,0,0,0.8)' : 'var(--txt-dim)',
                        cursor: 'default',
                      }}
                    >
                      {cell.j.toFixed(2)}
                    </div>
                  )
                })}
              </>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Panel D — Concentration × YTD Scatter ────────────────────────────────────

function PanelD({ top7, holdings, loading }: { top7: RankRow[]; holdings: Map<string, HoldingDetail[]>; loading: boolean }) {
  const W = 520
  const H = 360
  const padL = 52, padR = 20, padT = 20, padB = 44

  const points = useMemo(() => {
    return top7.map(r => {
      const hs = holdings.get(r.code) ?? []
      const sorted = [...hs].sort((a, b) => b.weightPct - a.weightPct)
      const top5 = sorted.slice(0, 5).reduce((s, h) => s + h.weightPct, 0)
      const top1 = sorted[0]?.weightPct ?? 0
      return { code: r.code, ytd: r.ytd ?? 0, conc: top5, top1 }
    }).filter(p => p.conc > 0)
  }, [top7, holdings])

  if (!points.length) {
    return (
      <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--line)' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--txt)', borderBottom: '2px solid var(--down)', paddingBottom: 2 }}>集中度 × YTD</span>
        </div>
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--txt-mute)', fontSize: '0.82rem' }}>
          {loading ? '載入中…' : '無持股資料'}
        </div>
      </div>
    )
  }

  const xMin = Math.min(...points.map(p => p.conc)) * 0.9
  const xMax = Math.max(...points.map(p => p.conc)) * 1.1
  const yMin = Math.min(...points.map(p => p.ytd)) * 0.9
  const yMax = Math.max(...points.map(p => p.ytd)) * 1.1
  const maxTop1 = Math.max(...points.map(p => p.top1), 1)

  function px(v: number) { return padL + ((v - xMin) / (xMax - xMin || 1)) * (W - padL - padR) }
  function py(v: number) { return padT + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - padT - padB) }

  const xTicks = [xMin, (xMin + xMax) / 2, xMax].map(v => Math.round(v))
  const yTicks = [yMin, (yMin + yMax) / 2, yMax].map(v => Math.round(v))

  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--line)' }}>
        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--txt)', borderBottom: '2px solid var(--down)', paddingBottom: 2 }}>集中度 × YTD</span>
        <span style={{ marginLeft: 10, fontSize: '0.72rem', color: 'var(--txt-mute)' }}>x = Top5 集中度 (%) &nbsp;·&nbsp; y = YTD% &nbsp;·&nbsp; 泡泡大小 = Top1 重壓</span>
      </div>
      <div style={{ padding: 16, overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, display: 'block' }}>
          {/* Gridlines */}
          {yTicks.map(v => (
            <line key={v} x1={padL} x2={W - padR} y1={py(v)} y2={py(v)} stroke="var(--line)" strokeWidth={1} />
          ))}
          {xTicks.map(v => (
            <line key={v} x1={px(v)} x2={px(v)} y1={padT} y2={H - padB} stroke="var(--line)" strokeWidth={1} />
          ))}
          {/* Axis labels */}
          {xTicks.map(v => (
            <text key={v} x={px(v)} y={H - padB + 16} textAnchor="middle" fontSize={10} fill="var(--txt-mute)" fontFamily="ui-monospace,monospace">{v}</text>
          ))}
          {yTicks.map(v => (
            <text key={v} x={padL - 6} y={py(v) + 4} textAnchor="end" fontSize={10} fill="var(--txt-mute)" fontFamily="ui-monospace,monospace">{v > 0 ? '+' : ''}{v}%</text>
          ))}
          {/* Axis titles */}
          <text x={(padL + W - padR) / 2} y={H - 4} textAnchor="middle" fontSize={10} fill="var(--txt-mute)" fontFamily="ui-monospace,monospace">Top5 集中度%</text>
          {/* Bubbles */}
          {points.map(p => {
            const r = clamp(6 + (p.top1 / maxTop1) * 16, 6, 22)
            return (
              <g key={p.code}>
                <circle
                  cx={px(p.conc)}
                  cy={py(p.ytd)}
                  r={r}
                  fill="rgba(53,201,214,0.35)"
                  stroke="var(--accent)"
                  strokeWidth={1.2}
                />
                <text
                  x={px(p.conc)}
                  y={py(p.ytd) - r - 4}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--txt-dim)"
                  fontFamily="ui-monospace,monospace"
                >
                  {p.code}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

// ── ChampionsView (main export) ───────────────────────────────────────────────

export default function ChampionsView() {
  const [rankData, setRankData] = useState<RankData | null>(null)
  const [holdings, setHoldings] = useState<Map<string, HoldingDetail[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError(null)

    fetch('/api/fund-rank', { signal: ac.signal })
      .then(r => { if (!r.ok) throw new Error(`fund-rank HTTP ${r.status}`); return r.json() })
      .then(async (data: RankData) => {
        setRankData(data)

        // Fetch holdings for each ETF in parallel
        const entries = await Promise.allSettled(
          data.top7.map(async r => {
            const res = await fetch(`/api/fund?fund=${r.code}`, { signal: ac.signal })
            if (!res.ok) return [r.code, []] as [string, HoldingDetail[]]
            const fd: FundData = await res.json()
            const snap = fd.etfDaily
            if (!snap) return [r.code, []] as [string, HoldingDetail[]]
            return [r.code, snap.holdings] as [string, HoldingDetail[]]
          })
        )
        const map = new Map<string, HoldingDetail[]>()
        for (const result of entries) {
          if (result.status === 'fulfilled') {
            const [code, hs] = result.value
            map.set(code, hs)
          }
        }
        setHoldings(map)
      })
      .catch(e => { if (e.name !== 'AbortError') setError(e.message ?? '載入失敗') })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })

    return () => ac.abort()
  }, [])

  const top7 = rankData?.top7 ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--txt)', margin: 0, borderBottom: '2px solid var(--accent)', paddingBottom: 3, display: 'inline-block' }}>
            冠軍 — YTD Top 7 主動式 ETF
          </h1>
        </div>
        {rankData && (
          <div style={{ alignSelf: 'center', border: '1px solid var(--accent)', borderRadius: 20, padding: '3px 12px', fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)', fontVariantNumeric: 'tabular-nums', fontSize: '0.78rem', color: 'var(--accent)', whiteSpace: 'nowrap' }}>
            data: {rankData.fetchedAt.slice(0, 10)}
          </div>
        )}
      </div>

      {/* Subtitle */}
      <p style={{ fontSize: '0.8rem', color: 'var(--txt-dim)', margin: 0 }}>
        今年績效最強的 7 檔主動式 ETF，跨四維度比較
      </p>

      {/* Error */}
      {error && (
        <div style={{ color: 'var(--up)', fontSize: '0.85rem', padding: '16px 0' }}>
          載入失敗：{error}
        </div>
      )}

      {/* Four panels in responsive grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))', gap: 16, minWidth: 0 }}>
        <PanelA top7={top7} loading={loading} />
        <PanelB top7={top7} holdings={holdings} loading={loading} />
        <PanelC top7={top7} holdings={holdings} loading={loading} />
        <PanelD top7={top7} holdings={holdings} loading={loading} />
      </div>
    </div>
  )
}
