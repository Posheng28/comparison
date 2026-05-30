'use client'
import { useState } from 'react'
import type { ClauseResult, CondStatus } from '@/lib/clauseEngine'

type AssumeKey = 'c3' | 'c4' | 'c5' | 'c6'
interface Props {
  results: ClauseResult[]                       // evalCard(0, price0)
  calcDateLabel: string                         // 如 "6/02"
  statusLabel: string                           // "盤中即時" | "預估"
  assume: Record<AssumeKey, boolean>
  onToggleAssume: (k: AssumeKey) => void
}

const BADGE: Record<ClauseResult['badge'], { txt: string; cls: string }> = {
  fired:    { txt: '已觸發',   cls: 'bg-red-900/50 text-red-300 border-red-700' },
  possible: { txt: '可能觸發', cls: 'bg-orange-900/50 text-orange-300 border-orange-700' },
  safe:     { txt: '無風險',   cls: 'bg-green-900/50 text-green-300 border-green-700' },
}
const STATUS: Record<CondStatus, { txt: string; cls: string }> = {
  met:      { txt: '已達',     cls: 'text-red-300' },
  possible: { txt: '可能',     cls: 'text-orange-300' },
  safe:     { txt: '未達',     cls: 'text-green-400' },
  assumed:  { txt: '假設',     cls: 'text-sky-300' },
  raised:   { txt: '拉高門檻', cls: 'text-purple-300' },
}
const rank: Record<ClauseResult['badge'], number> = { safe: 0, possible: 1, fired: 2 }

// 6 張卡片：款一合 1①/1②，其餘 1:1
const CARDS: { key: string; label: string; ids: ClauseResult['id'][]; assumeKey?: AssumeKey }[] = [
  { key: '1', label: '款一', ids: ['1①', '1②'] },
  { key: '2', label: '款二', ids: ['2'] },
  { key: '3', label: '款三', ids: ['3'], assumeKey: 'c3' },
  { key: '4', label: '款四', ids: ['4'], assumeKey: 'c4' },
  { key: '5', label: '款五', ids: ['5'], assumeKey: 'c5' },
  { key: '6', label: '款六', ids: ['6'], assumeKey: 'c6' },
]

function StatusPill({ s }: { s: CondStatus }) {
  return <span className={`text-[11px] font-semibold ${STATUS[s].cls}`}>{STATUS[s].txt}</span>
}

function ClauseBody({ r }: { r: ClauseResult }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-gray-500 leading-snug">
        <span className="inline-block px-1 mr-1 rounded bg-gray-800 text-gray-400">法規</span>{r.lawText}
      </p>
      {r.groups.map((g, gi) => (
        <div key={gi} className="rounded-lg border border-gray-800 bg-gray-900/40 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-gray-200">{g.title}</span>
            <span className="text-[11px] text-gray-400">{g.threshold}</span>
            <StatusPill s={g.status} />
          </div>
          <ul className="mt-1 space-y-0.5">
            {g.subs.map((s, si) => (
              <li key={si} className="flex items-baseline gap-1.5 text-[11px]">
                <span className="text-gray-400 shrink-0">{s.label}</span>
                <span className="text-gray-500">{s.threshold}</span>
                {s.current && <span className="text-gray-200 font-medium">{s.current}</span>}
                <StatusPill s={s.status} />
                {s.note && <span className="text-gray-600">— {s.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {r.exclusions && r.exclusions.length > 0 && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-gray-500 hover:text-gray-300">除外條件（{r.exclusions.length}）</summary>
          <ul className="mt-1 space-y-0.5 pl-2">
            {r.exclusions.map((e, ei) => (
              <li key={ei} className="flex items-center gap-1.5">
                <span className={e.status === 'met' ? 'text-amber-400' : e.status === 'unimpl' ? 'text-gray-600' : 'text-gray-500'}>
                  {e.status === 'met' ? '✓' : e.status === 'unimpl' ? '—' : '·'}
                </span>
                <span className="text-gray-500">{e.label}</span>
                {e.status === 'unimpl' && <span className="text-gray-700">(未實作)</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

export default function AttentionDetailPanel({ results, calcDateLabel, statusLabel, assume, onToggleAssume }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const byId = (id: ClauseResult['id']) => results.find(r => r.id === id)

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-bold text-gray-200 uppercase tracking-wider">🔎 注意細節條件</p>
        <span className="text-xs text-gray-500">計算日 {calcDateLabel}・{statusLabel}</span>
      </div>
      <div className="space-y-1.5">
        {CARDS.map(card => {
          const rs = card.ids.map(byId).filter((r): r is ClauseResult => !!r)
          if (rs.length === 0) return null
          const badge = rs.reduce((b, r) => rank[r.badge] > rank[b] ? r.badge : b, 'safe' as ClauseResult['badge'])
          const isOpen = !!open[card.key]
          // 假設開關的可見性只看「這張卡是否有 assumeKey」（c3/c4/c5/c6），
          // 不可綁定 group 的 assumed 狀態：assumed 狀態本身由開關決定，會造成
          // 「關了就消失、再也開不回來」的單向陷阱（c5/c6 預設關 → 永遠開不了 → 款五/款六無法觸發）。
          const showToggle = !!card.assumeKey
          return (
            <div key={card.key} className="rounded-xl border border-gray-700 bg-gray-900/60">
              <button
                onClick={() => setOpen(o => ({ ...o, [card.key]: !o[card.key] }))}
                className="w-full flex items-center gap-2 px-3 py-2 text-left">
                <span className="text-sm font-bold text-gray-100 shrink-0">{card.label}</span>
                <span className="text-[11px] text-gray-400 truncate flex-1">
                  {rs.map(r => r.headerThreshold).join('　')}
                </span>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${BADGE[badge].cls}`}>{BADGE[badge].txt}</span>
                <span className="text-gray-500 text-xs shrink-0">{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen && (
                <div className="px-3 pb-3 space-y-3 border-t border-gray-800 pt-2">
                  {rs.map(r => (
                    <div key={r.id}>
                      {card.ids.length > 1 && <p className="text-xs font-semibold text-gray-300 mb-1">{r.id}　{r.name}</p>}
                      <ClauseBody r={r} />
                    </div>
                  ))}
                  {showToggle && card.assumeKey && (
                    <button
                      onClick={() => onToggleAssume(card.assumeKey!)}
                      className={`self-start text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                        assume[card.assumeKey] ? 'bg-orange-900/50 text-orange-200 border-orange-600'
                                               : 'bg-gray-800 text-gray-300 border-gray-700 hover:border-gray-500'}`}>
                      {assume[card.assumeKey] ? '☑ 次要條件假設成立（已計入處置模擬）' : '☐ 假設次要條件成立'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <p className="text-[11px] text-gray-600 mt-2">收合顯示門檻總結＋燈號；展開看逐項條件。款三~六僅對計算日有意義。</p>
    </section>
  )
}
