import type { FundDef } from './types'

export const ETFS: FundDef[] = [
  { fundId: '00980A', company: 'nomura',  etfTicker: '00980A', crawl: 'moneydj' }, // 主動野村臺灣優選
  { fundId: '00981A', company: 'uni',     etfTicker: '00981A', crawl: 'moneydj' }, // 主動統一台股增長
  { fundId: '00982A', company: 'capital', etfTicker: '00982A', crawl: 'moneydj' }, // 主動群益台灣強棒
  { fundId: '00985A', company: 'nomura',  etfTicker: '00985A', crawl: 'moneydj' }, // 主動野村台灣50
  { fundId: '00988A', company: 'uni',     etfTicker: '00988A', crawl: 'moneydj' }, // 主動統一全球創新
  { fundId: '00990A', company: 'yuanta',  etfTicker: '00990A', crawl: 'moneydj' }, // 主動元大 AI 新經濟
  { fundId: '00991A', company: 'fuhua',   etfTicker: '00991A', crawl: 'moneydj' }, // 主動復華未來 50
  { fundId: '00992A', company: 'capital', etfTicker: '00992A', crawl: 'moneydj' }, // 主動群益科技創新
]

export const ALL_DEFS: FundDef[] = ETFS
export const defById = (id: string) => ALL_DEFS.find(d => d.fundId === id)
