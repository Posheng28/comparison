'use client'
import { useEffect, useState } from 'react'
import type { FundDef } from '@/lib/fund/types'

interface Holding {
  code: string
  name: string
  weightPct: number
  rank?: number
  amount?: number
  market?: string
}

interface Snapshot {
  fundId: string
  reportType: string
  period: string
  source: string
  fetchedAt: string
  holdings: Holding[]
  meta?: { aum?: number; manager?: string; cashPct?: number; note?: string }
}

const mono = {
  fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
  fontVariantNumeric: 'tabular-nums' as const,
}

export default function HoldingsView() {
  const [funds, setFunds] = useState<FundDef[]>([])
  const [sel, setSel] = useState<string>('')
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(false)

  const [updating, setUpdating] = useState(false)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/fund')
      .then(r => r.json())
      .then(d => {
        const list: FundDef[] = d.funds ?? []
        setFunds(list)
        if (list.length && !sel) setSel(list[0].fundId)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!sel) return
    const ac = new AbortController()
    setSnap(null)
    setUpdateMsg(null)
    setLoading(true)
    fetch(`/api/fund?fund=${sel}`, { signal: ac.signal })
      .then(r => r.json())
      .then(d => setSnap(d.etfDaily ?? null))
      .catch(e => {
        if (e.name !== 'AbortError') setSnap(null)
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })
    return () => ac.abort()
  }, [sel])

  function refetchSnap() {
    const ac = new AbortController()
    setLoading(true)
    fetch(`/api/fund?fund=${sel}`, { signal: ac.signal })
      .then(r => r.json())
      .then(d => setSnap(d.etfDaily ?? null))
      .catch(() => {})
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })
  }

  async function handleUpdate() {
    setUpdating(true)
    setUpdateMsg(null)
    try {
      const res = await fetch('/api/fund-crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fundId: sel }),
      })
      if (res.status === 425) {
        setUpdateMsg('資料當日尚未定案（18:30 後再試）')
      } else if (res.ok) {
        setUpdateMsg('更新成功')
        refetchSnap()
      } else {
        const d = await res.json().catch(() => ({}))
        setUpdateMsg(d.error ?? `錯誤 ${res.status}`)
      }
    } catch {
      setUpdateMsg('網路錯誤，請稍後再試')
    } finally {
      setUpdating(false)
    }
  }

  const cardStyle: React.CSSProperties = {
    background: 'var(--panel)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    overflow: 'hidden',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
        ETF 持股
      </h1>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <select
          value={sel}
          onChange={e => setSel(e.target.value)}
          style={{
            background: 'var(--panel2)',
            color: 'var(--txt)',
            borderRadius: 8,
            padding: '6px 12px',
            border: '1px solid var(--line)',
            fontSize: '0.85rem',
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          {funds.map(f => (
            <option key={f.fundId} value={f.fundId}>
              {f.fundId}
            </option>
          ))}
        </select>
        {snap && (
          <span style={{ color: 'var(--txt-mute)', fontSize: '0.75rem', ...mono }}>
            {snap.period}　ETF 每日
            {snap.meta?.manager && <span>　經理人：{snap.meta.manager}</span>}
          </span>
        )}
        {loading && (
          <span style={{ color: 'var(--txt-mute)', fontSize: '0.75rem' }}>載入中…</span>
        )}
        <button
          onClick={handleUpdate}
          disabled={updating || !sel}
          style={{
            marginLeft: 'auto',
            fontSize: '0.75rem',
            padding: '5px 12px',
            borderRadius: 8,
            background: 'var(--panel2)',
            border: '1px solid var(--line)',
            color: 'var(--txt-dim)',
            cursor: updating ? 'not-allowed' : 'pointer',
            opacity: updating ? 0.5 : 1,
            transition: 'opacity 0.15s',
          }}
        >
          {updating ? '更新中…' : '更新本期'}
        </button>
      </div>

      {updateMsg && (
        <div
          style={{
            fontSize: '0.75rem',
            color: 'var(--txt-dim)',
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 6,
            padding: '8px 12px',
          }}
        >
          {updateMsg}
        </div>
      )}

      {snap && snap.holdings.length > 0 && (
        <div style={cardStyle}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr
                style={{
                  textAlign: 'left',
                  color: 'var(--txt-mute)',
                  borderBottom: '1px solid var(--line)',
                  fontSize: '0.72rem',
                }}
              >
                <th style={{ padding: '8px 12px', width: 32 }}>#</th>
                <th style={{ padding: '8px 12px', width: 80 }}>代號</th>
                <th style={{ padding: '8px 12px' }}>名稱</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', width: 80 }}>權重%</th>
              </tr>
            </thead>
            <tbody>
              {snap.holdings.map((h, i) => (
                <tr
                  key={h.code}
                  style={{ borderTop: '1px solid var(--line)', transition: 'background 0.1s' }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLTableRowElement).style.background = 'var(--panel2)'
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'
                  }}
                >
                  <td style={{ padding: '6px 12px', color: 'var(--txt-mute)' }}>
                    {h.rank ?? i + 1}
                  </td>
                  <td style={{ padding: '6px 12px', color: 'var(--accent)', ...mono }}>
                    {h.code}
                  </td>
                  <td style={{ padding: '6px 12px', color: 'var(--txt)' }}>{h.name}</td>
                  <td style={{ padding: '6px 12px', textAlign: 'right', color: 'var(--txt)', ...mono }}>
                    {h.weightPct.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {snap && snap.holdings.length === 0 && (
        <div style={{ color: 'var(--txt-mute)', fontSize: '0.85rem', padding: '32px 0', textAlign: 'center' }}>
          無持股資料
        </div>
      )}

      {!snap && !loading && funds.length > 0 && (
        <div style={{ color: 'var(--txt-mute)', fontSize: '0.85rem', padding: '32px 0', textAlign: 'center' }}>
          無資料（點「更新本期」抓取最新持股）
        </div>
      )}
    </div>
  )
}
