export type ReportType = 'etf_daily'
export type CrawlStrategy = 'moneydj' | 'none'

export interface FundHolding {
  code: string
  name: string
  weightPct: number
  rank?: number
  shares?: number   // 持股股數（張數×1000 = 股）；流向指標的主要度量
  amount?: number
  market?: string
}

export interface FundSnapshot {
  fundId: string
  reportType: ReportType
  period: string
  source: string
  fetchedAt: string
  holdings: FundHolding[]
  meta?: { aum?: number; manager?: string; cashPct?: number; note?: string }
}

export interface FundDef {
  fundId: string
  company: string
  etfTicker: string
  crawl: CrawlStrategy
}
