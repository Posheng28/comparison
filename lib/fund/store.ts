import { promises as fs } from 'fs'
import path from 'path'
import type { FundSnapshot, ReportType } from './types'

const ETF_CACHE = path.join(process.cwd(), '.funddata', 'etf')
const mem = new Map<string, FundSnapshot>()
const diskOk = new Map<string, boolean>()

const key = (fundId: string, rt: ReportType, period: string) => `${fundId}|${rt}|${period}`

export function snapshotPath(s: FundSnapshot): string {
  return path.join(ETF_CACHE, s.fundId, `${s.period}.json`)
}

async function ensureDir(dir: string): Promise<boolean> {
  if (diskOk.has(dir)) return diskOk.get(dir)!
  try { await fs.mkdir(dir, { recursive: true }); diskOk.set(dir, true) }
  catch { diskOk.set(dir, false) }
  return diskOk.get(dir)!
}

export async function saveSnapshot(s: FundSnapshot): Promise<void> {
  mem.set(key(s.fundId, s.reportType, s.period), s)
  const file = snapshotPath(s)
  if (await ensureDir(path.dirname(file))) {
    try { await fs.writeFile(file, JSON.stringify(s, null, 0)) }
    catch { /* read-only FS: memory only */ }
  }
}

export async function loadSnapshot(fundId: string, rt: ReportType, period: string): Promise<FundSnapshot | null> {
  const k = key(fundId, rt, period)
  if (mem.has(k)) return mem.get(k)!
  const file = snapshotPath({ fundId, reportType: rt, period } as FundSnapshot)
  try {
    const raw = await fs.readFile(file, 'utf-8')
    const obj = JSON.parse(raw) as FundSnapshot
    mem.set(k, obj)
    return obj
  } catch { return null }
}

export async function listPeriods(fundId: string, _rt: ReportType): Promise<string[]> {
  const dir = path.join(ETF_CACHE, fundId)
  try {
    const files = await fs.readdir(dir)
    return files.filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort()
  } catch { return [] }
}

export function __resetMem() { mem.clear(); diskOk.clear() }
