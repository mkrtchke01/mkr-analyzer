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
}

export const TIMEFRAMES = {
  '5m': '5',
  '15m': '15',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
} as const

export type Timeframe = keyof typeof TIMEFRAMES

const MIN_TURNOVER = 10_000_000
const STABLE_BASE_ASSETS = new Set(['USDC', 'USDT'])

type KlineResponse = {
  result?: { list?: string[][] }
}

type TickerResponse = {
  result?: { list?: Array<Record<string, string>> }
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

export function formatPrice(value: number): string {
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
      return !STABLE_BASE_ASSETS.has(baseAsset) && market.turnover >= MIN_TURNOVER
    })
    .sort((left, right) => right.turnover - left.turnover)
}

export function getNextMarketSymbol(markets: Market[], currentSymbol: string): string | undefined {
  if (!markets.length) return undefined

  const currentIndex = markets.findIndex((market) => market.symbol === currentSymbol)
  return markets[(currentIndex + 1) % markets.length].symbol
}

export async function getMarkets(): Promise<Market[]> {
  const response = await fetch(`${apiBase}/tickers?category=linear`)
  if (!response.ok) throw new Error('Не удалось загрузить рынки Bybit')
  const payload = (await response.json()) as TickerResponse

  const markets = (payload.result?.list ?? [])
    .filter((item) => item.symbol.endsWith('USDT') && Number(item.turnover24h) > 0)
    .map((item) => ({
      symbol: item.symbol,
      price: toNumber(item.lastPrice),
      change: toNumber(item.price24hPcnt) * 100,
      turnover: toNumber(item.turnover24h),
    }))

  return filterMarkets(markets)
}

export async function getCandles(symbol: string, timeframe: Timeframe, limit = 500): Promise<Candle[]> {
  const params = new URLSearchParams({ category: 'linear', symbol, interval: timeframeToBybitInterval(timeframe), limit: String(limit) })
  const response = await fetch(`${apiBase}/kline?${params}`)
  if (!response.ok) throw new Error('Не удалось загрузить историю графика')
  const payload = (await response.json()) as KlineResponse
  return klineRowsToCandles(payload.result?.list ?? [])
}

export function chartWebSocketUrl(): string {
  return 'wss://stream.bybit.com/v5/public/linear'
}
