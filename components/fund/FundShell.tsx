'use client'
import { useState, useEffect, useRef } from 'react'
import MovesView from './MovesView'
import HoldingsView from './HoldingsView'
import ChampionsView from './ChampionsView'
import FlowView from './FlowView'

type SectionId = '01' | '02' | '03' | '04'

interface NavItem {
  id: SectionId
  index: string
  label: string
}

const NAV_ITEMS: NavItem[] = [
  { id: '01', index: '01', label: '動向' },
  { id: '02', index: '02', label: '持股' },
  { id: '03', index: '03', label: '冠軍' },
  { id: '04', index: '04', label: '個股流向' },
]

const NARROW_BREAKPOINT = 720

export default function FundShell() {
  const [section, setSection] = useState<SectionId>('01')
  const [narrow, setNarrow] = useState(false)
  const [autoCrawl, setAutoCrawl] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return

    const obs = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth
      setNarrow(w < NARROW_BREAKPOINT)
    })
    obs.observe(el)
    setNarrow(el.clientWidth < NARROW_BREAKPOINT)
    return () => obs.disconnect()
  }, [])

  // 進場自動爬取：台灣時間（UTC+8）為平日且過 18:30 → 背景觸發「一次爬全 8 檔」。
  // 週末直接略過（不打 API）；節慶休市由後端以來源日期判定 period 已存在而跳過。
  // 以 localStorage 旗標確保每日只觸發一次（失敗則不設旗標、下次進場重試）。
  useEffect(() => {
    const tw = new Date(Date.now() + 8 * 3600 * 1000)
    const dow = tw.getUTCDay() // 0=日, 6=六
    const min = tw.getUTCHours() * 60 + tw.getUTCMinutes()
    if (dow === 0 || dow === 6) return // 週末不抓
    if (min < 18 * 60 + 30) return // 未過 18:30
    const ymd = tw.toISOString().slice(0, 10)
    const flag = `fund-autocrawl:${ymd}`
    try {
      if (localStorage.getItem(flag)) return
    } catch {
      return
    }

    let cancelled = false
    setAutoCrawl('資料更新中…')
    fetch('/api/fund-crawl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    })
      .then(r => r.json())
      .then((d: { saved?: number; skipped?: number }) => {
        if (cancelled) return
        try {
          localStorage.setItem(flag, '1')
        } catch {
          /* private mode 等 */
        }
        const saved = d.saved ?? 0
        setAutoCrawl(saved > 0 ? `已更新 ${saved} 檔` : '資料已是最新')
        setTimeout(() => {
          if (!cancelled) setAutoCrawl(null)
        }, 4000)
      })
      .catch(() => {
        if (!cancelled) setAutoCrawl(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function renderSection() {
    switch (section) {
      case '01': return <MovesView />
      case '02': return <HoldingsView />
      case '03': return <ChampionsView />
      case '04': return <FlowView />
    }
  }

  const crawlPill = autoCrawl ? (
    <div
      style={{
        display: 'inline-block',
        marginBottom: 12,
        fontSize: '0.72rem',
        color: 'var(--accent)',
        background: 'var(--accent-dim)',
        border: '1px solid var(--line)',
        borderRadius: 999,
        padding: '4px 12px',
      }}
    >
      {autoCrawl}
    </div>
  ) : null

  if (narrow) {
    return (
      <div
        ref={rootRef}
        className="fund-term"
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          background: 'var(--bg)',
          color: 'var(--txt)',
          fontFamily: 'inherit',
          overflow: 'hidden',
          minWidth: 0,
        }}
      >
        <nav
          style={{
            display: 'flex',
            flexDirection: 'row',
            overflowX: 'auto',
            overflowY: 'hidden',
            background: 'var(--panel)',
            borderBottom: '1px solid var(--line)',
            flexShrink: 0,
            scrollbarWidth: 'none',
          }}
        >
          {NAV_ITEMS.map(item => {
            const isActive = section === item.id
            return (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  flexShrink: 0,
                  padding: '10px 14px',
                  border: 'none',
                  borderBottom: isActive
                    ? '2px solid var(--accent)'
                    : '2px solid transparent',
                  background: isActive ? 'var(--accent-dim)' : 'transparent',
                  color: isActive ? 'var(--accent)' : 'var(--txt-dim)',
                  fontSize: '0.85rem',
                  fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'background 0.12s, color 0.12s',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                    fontSize: '0.68rem',
                    color: isActive ? 'var(--accent)' : 'var(--txt-mute)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {item.index}
                </span>
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '16px',
            minWidth: 0,
            minHeight: 0,
          }}
        >
          {crawlPill}
          {renderSection()}
        </main>
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className="fund-term"
      style={{
        display: 'flex',
        height: '100%',
        background: 'var(--bg)',
        color: 'var(--txt)',
        fontFamily: 'inherit',
        overflow: 'hidden',
      }}
    >
      <aside
        style={{
          width: 200,
          flexShrink: 0,
          background: 'var(--panel)',
          borderRight: '1px solid var(--line)',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '20px 18px 16px', borderBottom: '1px solid var(--line)' }}>
          <div
            style={{
              fontSize: '1.15rem',
              fontWeight: 700,
              color: 'var(--accent)',
              letterSpacing: '0.02em',
              fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
            }}
          >
            訊號台
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--txt-mute)', marginTop: 4 }}>
            主動式 ETF 持股動向
          </div>
        </div>

        <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
          {NAV_ITEMS.map(item => {
            const isActive = section === item.id
            return (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '9px 10px',
                  marginBottom: 2,
                  border: 'none',
                  borderLeft: isActive
                    ? '2px solid var(--accent)'
                    : '2px solid transparent',
                  borderRadius: '0 7px 7px 0',
                  background: isActive ? 'var(--accent-dim)' : 'transparent',
                  color: isActive ? 'var(--accent)' : 'var(--txt-dim)',
                  fontSize: '0.85rem',
                  fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.12s, color 0.12s',
                }}
                onMouseEnter={e => {
                  if (!isActive)
                    (e.currentTarget as HTMLButtonElement).style.background = 'var(--panel2)'
                }}
                onMouseLeave={e => {
                  if (!isActive)
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                    fontSize: '0.72rem',
                    color: isActive ? 'var(--accent)' : 'var(--txt-mute)',
                    flexShrink: 0,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {item.index}
                </span>
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div
          style={{
            padding: '12px 18px 16px',
            borderTop: '1px solid var(--line)',
            fontSize: '0.66rem',
            color: 'var(--txt-mute)',
            lineHeight: 1.9,
          }}
        >
          <div>資料：MoneyDJ 每日</div>
          <div>8 檔主動式 ETF</div>
          <div style={{ marginTop: 4, opacity: 0.7 }}>v0.2.0</div>
        </div>
      </aside>

      <main
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px',
          minWidth: 0,
        }}
      >
        {crawlPill}
        {renderSection()}
      </main>
    </div>
  )
}
