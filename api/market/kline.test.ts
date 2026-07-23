import { describe, expect, it } from 'vitest'
import { buildKlineRequestUrl } from './kline'

describe('buildKlineRequestUrl', () => {
  it('builds a bounded Bybit request for an allowed perpetual interval', () => {
    expect(buildKlineRequestUrl({ category: 'linear', symbol: 'BTCUSDT', interval: '5', limit: '500' }))
      .toBe('https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=5&limit=500')
  })

  it('rejects unsupported intervals and invalid symbols', () => {
    expect(buildKlineRequestUrl({ category: 'linear', symbol: 'BTCUSDT', interval: '1', limit: '100' })).toBeUndefined()
    expect(buildKlineRequestUrl({ category: 'linear', symbol: 'BTC/USDT', interval: '5', limit: '100' })).toBeUndefined()
  })

  it('uses the chart default limit when it is omitted', () => {
    expect(buildKlineRequestUrl({ category: 'linear', symbol: 'ETHUSDT', interval: '15' }))
      .toContain('limit=1000')
  })
})
