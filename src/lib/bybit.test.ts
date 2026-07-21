import { describe, expect, it, vi } from 'vitest'
import { filterMarketList, filterMarkets, formatPrice, getCandles, getMarkets, getNextMarketSymbol, klineEventToCandle, klineRowsToCandles, MARKET_LIST_LIMIT, pricePrecisionFromTickSize, sortMarketsByTrend, timeframeToBybitInterval } from './bybit'

describe('Bybit market data conversion', () => {
  it('converts reverse-ordered REST klines into chronological candles', () => {
    const candles = klineRowsToCandles([
      ['1710000060000', '11', '13', '10', '12'],
      ['1710000000000', '9', '12', '8', '11'],
    ])

    expect(candles).toEqual([
      { time: 1710000000, open: 9, high: 12, low: 8, close: 11, volume: 0 },
      { time: 1710000060, open: 11, high: 13, low: 10, close: 12, volume: 0 },
    ])
  })

  it('converts a streaming kline event into a chart candle', () => {
    expect(klineEventToCandle({ start: 1710000000123, open: '1.1', high: '1.3', low: '1', close: '1.2', volume: '200' })).toEqual({
      time: 1710000000,
      open: 1.1,
      high: 1.3,
      low: 1,
      close: 1.2,
      volume: 200,
    })
  })

  it('formats small and large prices for the market list', () => {
    expect(formatPrice(65321.987)).toBe('65,321.99')
    expect(formatPrice(0.0000123456)).toBe('0.00001235')
  })

  it('maps every visible timeframe to the Bybit interval', () => {
    expect(timeframeToBybitInterval('5m')).toBe('5')
    expect(timeframeToBybitInterval('15m')).toBe('15')
    expect(timeframeToBybitInterval('1h')).toBe('60')
    expect(timeframeToBybitInterval('4h')).toBe('240')
    expect(timeframeToBybitInterval('1d')).toBe('D')
  })

  it('keeps the 150 most liquid USDT perpetual markets and excludes stablecoins', () => {
    const markets = filterMarkets([
      { symbol: 'BTCUSDT', price: 64000, change: 1, turnover: 50_000_000 },
      { symbol: 'ETHUSDT', price: 3000, change: -1, turnover: 10_000_000 },
      { symbol: 'SOLUSDT', price: 150, change: 2, turnover: 9_999_999 },
      { symbol: 'USDCUSDT', price: 1, change: 0, turnover: 100_000_000 },
      { symbol: 'USDTUSDT', price: 1, change: 0, turnover: 100_000_000 },
    ])

    expect(markets.map((market) => market.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT'])
  })

  it('caps the market list at 150 pairs ordered by 24-hour turnover', () => {
    const markets = Array.from({ length: MARKET_LIST_LIMIT + 5 }, (_, index) => ({
      symbol: `COIN${index}USDT`,
      price: 1,
      change: 0,
      turnover: index,
    }))

    const filtered = filterMarkets(markets)

    expect(filtered).toHaveLength(MARKET_LIST_LIMIT)
    expect(filtered[0].symbol).toBe(`COIN${MARKET_LIST_LIMIT + 4}USDT`)
    expect(filtered.at(-1)?.symbol).toBe('COIN5USDT')
  })

  it('selects the next market and wraps to the beginning of the list', () => {
    const markets = [
      { symbol: 'BTCUSDT', price: 1, change: 0, turnover: 1 },
      { symbol: 'ETHUSDT', price: 1, change: 0, turnover: 1 },
      { symbol: 'SOLUSDT', price: 1, change: 0, turnover: 1 },
    ]

    expect(getNextMarketSymbol(markets, 'BTCUSDT')).toBe('ETHUSDT')
    expect(getNextMarketSymbol(markets, 'SOLUSDT')).toBe('BTCUSDT')
    expect(getNextMarketSymbol([], 'BTCUSDT')).toBeUndefined()
  })

  it('shows only setup markets when the setup filter is enabled', () => {
    const markets = [
      { symbol: 'BTCUSDT', price: 1, change: 0, turnover: 1 },
      { symbol: 'ETHUSDT', price: 1, change: 0, turnover: 1 },
      { symbol: 'SOLUSDT', price: 1, change: 0, turnover: 1 },
    ]
    const setupSymbols = new Set(['BTCUSDT', 'SOLUSDT'])

    expect(filterMarketList(markets, '', setupSymbols, true).map((market) => market.symbol)).toEqual(['BTCUSDT', 'SOLUSDT'])
    expect(filterMarketList(markets, 'sol', setupSymbols, true).map((market) => market.symbol)).toEqual(['SOLUSDT'])
    expect(filterMarketList(markets, '', setupSymbols, false)).toHaveLength(3)
    expect(filterMarketList(markets, '', setupSymbols, true, new Set(['BTCUSDT'])).map((market) => market.symbol)).toEqual(['BTCUSDT'])
  })

  it('uses the Bybit tick size for an exact displayed price precision', () => {
    expect(pricePrecisionFromTickSize('0.000001')).toBe(6)
    expect(pricePrecisionFromTickSize('0.0000010')).toBe(6)
    expect(pricePrecisionFromTickSize('0.5')).toBe(1)
    expect(pricePrecisionFromTickSize('1')).toBe(0)
    expect(formatPrice(0.003066, 6)).toBe('0.003066')
    expect(formatPrice(64_242.2, 1)).toBe('64,242.2')
  })

  it('sorts markets by the supplied trend strength in both directions', () => {
    const markets = [
      { symbol: 'BTCUSDT', price: 1, change: 0, turnover: 1 },
      { symbol: 'ETHUSDT', price: 1, change: 0, turnover: 1 },
      { symbol: 'SOLUSDT', price: 1, change: 0, turnover: 1 },
    ]
    const strengths = { BTCUSDT: 35, ETHUSDT: 80, SOLUSDT: 15 }

    expect(sortMarketsByTrend(markets, strengths, 'desc').map((market) => market.symbol)).toEqual(['ETHUSDT', 'BTCUSDT', 'SOLUSDT'])
    expect(sortMarketsByTrend(markets, strengths, 'asc').map((market) => market.symbol)).toEqual(['SOLUSDT', 'BTCUSDT', 'ETHUSDT'])
  })

  it('reports the Bybit status code when loading markets fails', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 403 }))

    await expect(getMarkets()).rejects.toThrow('Не удалось загрузить рынки Bybit (HTTP 403)')

    fetchMock.mockRestore()
  })

  it('loads one thousand candles for the chart by default', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ result: { list: [] } })))

    await getCandles('BTCUSDT', '5m')

    expect(String(fetchMock.mock.calls[0][0])).toContain('limit=1000')
    fetchMock.mockRestore()
  })
})
