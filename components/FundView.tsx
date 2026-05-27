'use client'
import { useEffect, useState } from 'react'
import type { FundDef } from '@/lib/fund/types'
import type { DualRow } from '@/lib/fund/query'

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

export default function FundView() {
  const [funds, setFunds] = useState<FundDef[]>([])
  const [sel, setSel] = useState<string>('uni-benteng')
  const [def, setDef] = useState<FundDef | null>(null)
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(false)

  // dual-track state
  const [dualRows, setDualRows] = useState<DualRow[]>([])
  const [dualLoading, setDualLoading] = useState(false)
  const [showDual, setShowDual] = useState(false)

  // update-button state
  const [updating, setUpdating] = useState(false)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/fund')
      .then(r => r.json())
      .then(d => {
        setFunds(d.funds ?? [])
        if (d.funds?.length && !d.funds.find((f: FundDef) => f.fundId === 'uni-benteng')) {
          setSel(d.funds[0].fundId)
        }
      })
  }, [])

  // fetch snapshot + def when selection changes
  useEffect(() => {
    if (!sel) return
    const ac = new AbortController()
    setSnap(null)
    setDef(null)
    setDualRows([])
    setShowDual(false)
    setUpdateMsg(null)
    setLoading(true)
    fetch(`/api/fund?fund=${sel}`, { signal: ac.signal })
      .then(r => r.json())
      .then(d => {
        setSnap(d.monthly ?? d.quarterly ?? null)
        setDef(d.def ?? null)
      })
      .catch(e => { if (e.name !== 'AbortError') setSnap(null) })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [sel])

  // fetch dual-track when toggled on (and def has relatedEtf)
  useEffect(() => {
    if (!showDual || !def?.relatedEtf) return
    const ac = new AbortController()
    setDualRows([])
    setDualLoading(true)
    fetch(`/api/fund?pair=${sel},${def.relatedEtf}`, { signal: ac.signal })
      .then(r => r.json())
      .then(d => setDualRows(d.rows ?? []))
      .catch(e => { if (e.name !== 'AbortError') setDualRows([]) })
      .finally(() => { if (!ac.signal.aborted) setDualLoading(false) })
    return () => ac.abort()
  }, [showDual, sel, def])

  // re-fetch snapshot (used after a successful crawl update)
  function refetchSnap() {
    const ac = new AbortController()
    setLoading(true)
    fetch(`/api/fund?fund=${sel}`, { signal: ac.signal })
      .then(r => r.json())
      .then(d => { setSnap(d.monthly ?? d.quarterly ?? null); setDef(d.def ?? null) })
      .catch(() => {})
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
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
      } else if (res.status === 501) {
        setUpdateMsg('此來源的 live 更新尚未啟用（目前為歷史種子資料）')
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

  const relatedEtf = def?.relatedEtf

  return (
    <div className="h-full flex flex-col gap-3 p-3 overflow-y-auto text-sm">
      {/* 基金選擇 + 更新按鈕 */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={sel}
          onChange={e => setSel(e.target.value)}
          className="bg-gray-800 text-gray-200 rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:border-teal-500 text-sm"
        >
          {funds.map(f => (
            <option key={f.fundId} value={f.fundId}>
              {f.fundId}
            </option>
          ))}
        </select>
        {snap && (
          <span className="text-gray-400 text-xs">
            {snap.period}
            {snap.reportType === 'monthly_top10' ? '　月報 Top10' : '　季報全持股'}
            {snap.meta?.manager && <span className="text-gray-500">　經理人：{snap.meta.manager}</span>}
          </span>
        )}
        {loading && <span className="text-gray-500 text-xs">載入中…</span>}

        <button
          onClick={handleUpdate}
          disabled={updating}
          className="ml-auto text-xs px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:border-teal-600 hover:text-teal-300 disabled:opacity-50 transition-colors"
        >
          {updating ? '更新中…' : '更新本期'}
        </button>
      </div>

      {/* 更新狀態提示 */}
      {updateMsg && (
        <div className="text-xs text-gray-400 bg-gray-900 border border-gray-800 rounded px-3 py-2">
          {updateMsg}
        </div>
      )}

      {/* 持股表格 */}
      {snap && snap.holdings.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <table className="tabular-nums w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-800 bg-gray-900">
                <th className="px-3 py-2 w-8">#</th>
                <th className="px-3 py-2 w-20">代號</th>
                <th className="px-3 py-2">名稱</th>
                <th className="px-3 py-2 text-right w-20">權重%</th>
              </tr>
            </thead>
            <tbody>
              {snap.holdings.map((h, i) => (
                <tr
                  key={h.code}
                  className="border-t border-gray-800 hover:bg-gray-800 transition-colors"
                >
                  <td className="px-3 py-1.5 text-gray-500">{h.rank ?? i + 1}</td>
                  <td className="px-3 py-1.5 text-amber-300 font-mono">{h.code}</td>
                  <td className="px-3 py-1.5 text-gray-200">{h.name}</td>
                  <td className="px-3 py-1.5 text-right text-gray-200">{h.weightPct.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {snap && snap.holdings.length === 0 && (
        <div className="text-gray-500 text-sm p-4 text-center">無持股資料</div>
      )}

      {!snap && !loading && funds.length > 0 && (
        <div className="text-gray-500 text-sm p-4 text-center">無資料</div>
      )}

      {/* 雙軌比較（僅當 relatedEtf 存在時顯示） */}
      {relatedEtf && (
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setShowDual(v => !v)}
            className={`self-start text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              showDual
                ? 'bg-teal-700/30 border-teal-600 text-teal-300'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-teal-700 hover:text-teal-300'
            }`}
          >
            {showDual ? '▾ 雙軌比較' : '▸ 雙軌比較'} vs {relatedEtf}
          </button>

          {showDual && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
              {dualLoading && (
                <div className="text-gray-500 text-xs p-3">載入中…</div>
              )}
              {!dualLoading && dualRows.length === 0 && (
                <div className="text-gray-500 text-xs p-3">無雙軌資料</div>
              )}
              {!dualLoading && dualRows.length > 0 && (
                <table className="tabular-nums w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-gray-800 bg-gray-900 text-xs">
                      <th className="px-3 py-2 w-20">代號</th>
                      <th className="px-3 py-2">名稱</th>
                      <th className="px-3 py-2 text-right w-20">基金%</th>
                      <th className="px-3 py-2 text-right w-20">ETF%</th>
                      <th className="px-3 py-2 text-right w-20">差異</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dualRows.map(r => (
                      <tr key={r.code} className="border-t border-gray-800 hover:bg-gray-800 transition-colors">
                        <td className="px-3 py-1.5 text-amber-300 font-mono">{r.code}</td>
                        <td className="px-3 py-1.5 text-gray-200">{r.name}</td>
                        <td className="px-3 py-1.5 text-right text-gray-200">
                          {r.fundWeight != null ? r.fundWeight.toFixed(2) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right text-gray-200">
                          {r.etfWeight != null ? r.etfWeight.toFixed(2) : '—'}
                        </td>
                        <td className={`px-3 py-1.5 text-right font-mono ${
                          r.diff == null ? 'text-gray-500'
                          : r.diff > 0 ? 'text-teal-400'
                          : r.diff < 0 ? 'text-red-400'
                          : 'text-gray-400'
                        }`}>
                          {r.diff != null ? (r.diff > 0 ? '+' : '') + r.diff.toFixed(2) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
