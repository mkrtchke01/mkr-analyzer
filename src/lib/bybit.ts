export type Candle = {
  time: number
  open: number
  high: number
  low: number
  close: number
}

export type Market = {
  symbol: string
  price: number
  change: number
  turnover: number
}

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
    .map(([time, open, high, low, close]) => ({
      time: Math.floor(toNumber(time) / 1000),
      open: toNumber(open),
      high: toNumber(high),
      low: toNumber(low),
      close: toNumber(close),
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
  }
}

export function formatPrice(value: number): string {
  if (value >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (value >= 1) return value.toLocaleString('en-US', { maximumFractionDigits: 4 })
  return value.toLocaleString('en-US', { maximumFractionDigits: 8 })
}

export async function getMarkets(): Promise<Market[]> {
  const response = await fetch(`${apiBase}/tickers?category=spot`)
  if (!response.ok) throw new Error('Не удалось загрузить рынки Bybit')
  const payload = (await response.json()) as TickerResponse

  return (payload.result?.list ?? [])
    .filter((item) => item.symbol.endsWith('USDT') && Number(item.turnover24h) > 0)
    .map((item) => ({
      symbol: item.symbol,
      price: toNumber(item.lastPrice),
      change: toNumber(item.price24hPcnt) * 100,
      turnover: toNumber(item.turnover24h),
    }))
    .sort((left, right) => right.turnover - left.turnover)
}

export async function getCandles(symbol: string): Promise<Candle[]> {
  const params = new URLSearchParams({ category: 'spot', symbol, interval: '1', limit: '500' })
  const response = await fetch(`${apiBase}/kline?${params}`)
  if (!response.ok) throw new Error('Не удалось загрузить историю графика')
  const payload = (await response.json()) as KlineResponse
  return klineRowsToCandles(payload.result?.list ?? [])
}

export function chartWebSocketUrl(): string {
  return 'wss://stream.bybit.com/v5/public/spot'
}
