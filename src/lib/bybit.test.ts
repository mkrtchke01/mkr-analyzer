import { describe, expect, it } from 'vitest'
import { formatPrice, klineEventToCandle, klineRowsToCandles } from './bybit'

describe('Bybit market data conversion', () => {
  it('converts reverse-ordered REST klines into chronological candles', () => {
    const candles = klineRowsToCandles([
      ['1710000060000', '11', '13', '10', '12'],
      ['1710000000000', '9', '12', '8', '11'],
    ])

    expect(candles).toEqual([
      { time: 1710000000, open: 9, high: 12, low: 8, close: 11 },
      { time: 1710000060, open: 11, high: 13, low: 10, close: 12 },
    ])
  })

  it('converts a streaming kline event into a chart candle', () => {
    expect(klineEventToCandle({ start: 1710000000123, open: '1.1', high: '1.3', low: '1', close: '1.2' })).toEqual({
      time: 1710000000,
      open: 1.1,
      high: 1.3,
      low: 1,
      close: 1.2,
    })
  })

  it('formats small and large prices for the market list', () => {
    expect(formatPrice(65321.987)).toBe('65,321.99')
    expect(formatPrice(0.0000123456)).toBe('0.00001235')
  })
})
