export type Candle = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type Market = {
  symbol: string
  price: number
  change: number
  turnover: number
  tickSize?: number
  pricePrecision?: number
}

export const TIMEFRAMES = {
  '5m': '5',
  '15m': '15',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
} as const

export type Timeframe = keyof typeof TIMEFRAMES

export const MARKET_LIST_LIMIT = 150
const STABLE_BASE_ASSETS = new Set(['USDC', 'USDT'])

type KlineResponse = {
  result?: { list?: string[][] }
}

type TickerResponse = {
  result?: { list?: Array<Record<string, string>> }
}

type InstrumentsResponse = {
  result?: {
    list?: Array<{ symbol: string, priceFilter?: { tickSize?: string } }>
    nextPageCursor?: string
  }
}

const apiBase = 'https://api.bybit.com/v5/market'

const toNumber = (value: string | undefined) => Number(value ?? 0)

export function klineRowsToCandles(rows: string[][]): Candle[] {
  return rows
    .map(([time, open, high, low, close, volume]) => ({
      time: Math.floor(toNumber(time) / 1000),
      open: toNumber(open),
      high: toNumber(high),
      low: toNumber(low),
      close: toNumber(close),
      volume: toNumber(volume),
    }))
    .reverse()
}

export function klineEventToCandle(event: Record<string, string | number>): Candle {
  return {
    time: Math.floor(Number(event.start) / 1000),
    open: Number(event.open),
    high: Number(event.high),
    low: Number(event.low),
    close: Number(event.close),
    volume: Number(event.volume),
  }
}

export function pricePrecisionFromTickSize(tickSize: string | number | undefined): number | undefined {
  if (tickSize === undefined || tickSize === '') return undefined
  const normalized = String(tickSize).toLowerCase()
  const exponentMatch = normalized.match(/^([\d.]+)e-(\d+)$/)
  if (exponentMatch) {
    const coefficientDecimals = (exponentMatch[1].split('.')[1] ?? '').length
    return Number(exponentMatch[2]) + coefficientDecimals
  }
  const decimalPart = normalized.split('.')[1]
  return decimalPart?.replace(/0+$/, '').length ?? 0
}

export function formatPrice(value: number, pricePrecision?: number): string {
  if (pricePrecision !== undefined) {
    return value.toLocaleString('en-US', {
      minimumFractionDigits: pricePrecision,
      maximumFractionDigits: pricePrecision,
    })
  }
  if (value >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (value >= 1) return value.toLocaleString('en-US', { maximumFractionDigits: 4 })
  return value.toLocaleString('en-US', { maximumFractionDigits: 8 })
}

export function timeframeToBybitInterval(timeframe: Timeframe): string {
  return TIMEFRAMES[timeframe]
}

export function filterMarkets(markets: Market[]): Market[] {
  return markets
    .filter((market) => {
      const baseAsset = market.symbol.replace('USDT', '')
      return !STABLE_BASE_ASSETS.has(baseAsset)
    })
    .sort((left, right) => right.turnover - left.turnover)
    .slice(0, MARKET_LIST_LIMIT)
}

export function filterMarketList(markets: Market[], query: string, setupSymbols: ReadonlySet<string>, setupsOnly: boolean): Market[] {
  const normalizedQuery = query.trim().toUpperCase()

  return markets.filter((market) => market.symbol.includes(normalizedQuery) && (!setupsOnly || setupSymbols.has(market.symbol)))
}

export function sortMarketsByTrend(markets: Market[], strengths: Record<string, number>, direction: 'asc' | 'desc'): Market[] {
  return [...markets].sort((left, right) => {
    const difference = (strengths[left.symbol] ?? 0) - (strengths[right.symbol] ?? 0)
    return direction === 'desc' ? -difference : difference
  })
}

export function getNextMarketSymbol(markets: Market[], currentSymbol: string): string | undefined {
  if (!markets.length) return undefined

  const currentIndex = markets.findIndex((market) => market.symbol === currentSymbol)
  return markets[(currentIndex + 1) % markets.length].symbol
}

export async function getMarkets(): Promise<Market[]> {
  const [tickerResponse, instrumentsResponse] = await Promise.all([
    fetch(`${apiBase}/tickers?category=linear`),
    fetch(`${apiBase}/instruments-info?category=linear&limit=1000`),
  ])
  if (!tickerResponse.ok) throw new Error(`Не удалось загрузить рынки Bybit (HTTP ${tickerResponse.status})`)
  if (!instrumentsResponse.ok) throw new Error(`Не удалось загрузить параметры инструментов Bybit (HTTP ${instrumentsResponse.status})`)
  const payload = (await tickerResponse.json()) as TickerResponse
  const instrumentsPayload = (await instrumentsResponse.json()) as InstrumentsResponse
  const priceFormats = new Map((instrumentsPayload.result?.list ?? []).map((item) => {
    const tickSize = item.priceFilter?.tickSize
    return [item.symbol, {
      tickSize: tickSize === undefined ? undefined : toNumber(tickSize),
      pricePrecision: pricePrecisionFromTickSize(tickSize),
    }]
  }))

  const markets = (payload.result?.list ?? [])
    .filter((item) => item.symbol.endsWith('USDT') && Number(item.turnover24h) > 0)
    .map((item) => ({
      symbol: item.symbol,
      price: toNumber(item.lastPrice),
      change: toNumber(item.price24hPcnt) * 100,
      turnover: toNumber(item.turnover24h),
      ...priceFormats.get(item.symbol),
    }))

  return filterMarkets(markets)
}

export async function getCandles(symbol: string, timeframe: Timeframe, limit = 1000): Promise<Candle[]> {
  const params = new URLSearchParams({ category: 'linear', symbol, interval: timeframeToBybitInterval(timeframe), limit: String(limit) })
  const response = await fetch(`${apiBase}/kline?${params}`)
  if (!response.ok) throw new Error(`Не удалось загрузить историю графика (HTTP ${response.status})`)
  const payload = (await response.json()) as KlineResponse
  return klineRowsToCandles(payload.result?.list ?? [])
}

export function chartWebSocketUrl(): string {
  return 'wss://stream.bybit.com/v5/public/linear'
}
