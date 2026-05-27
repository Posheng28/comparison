import { promises as fs } from 'fs'
import path from 'path'
import { transformHoldings } from '../lib/fund/seed'
import { saveSnapshot } from '../lib/fund/store'

async function main() {
  const seedDir = process.argv[2] || process.env.JOY88_SEED || 'C:/Users/user/joy88-seed'
  const holdings = JSON.parse(await fs.readFile(path.join(seedDir, 'holdings.json'), 'utf-8'))
  const fi = JSON.parse(await fs.readFile(path.join(seedDir, 'fund-info.json'), 'utf-8'))
  const snaps = transformHoldings(holdings, fi, new Date().toISOString())
  for (const s of snaps) await saveSnapshot(s)
  const byFund = new Map<string, number>()
  let rows = 0
  for (const s of snaps) { byFund.set(s.fundId, (byFund.get(s.fundId) ?? 0) + 1); rows += s.holdings.length }
  console.log(`寫入 ${snaps.length} 個快照、${rows} 列，涵蓋 ${byFund.size} 檔基金：`)
  for (const [id, n] of [...byFund].sort()) console.log(`  ${id}: ${n} 期`)
}
main().catch(e => { console.error(e); process.exit(1) })
