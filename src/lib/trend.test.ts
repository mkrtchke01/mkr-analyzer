import { describe, expect, it } from 'vitest'
import type { Candle } from './bybit'
import { analyzeTrend, calculateEma, getOverallTrend, type TrendAnalysis } from './trend'

const makeCandles = (step: number): Candle[] => Array.from({ length: 100 }, (_, index) => {
  const close = 100 + step * index + Math.sin(index / 3) * 0.08
  return { time: index, open: close - step / 2, high: close + 0.3, low: close - 0.3, close, volume: 100 + (index % 7) }
})

const analysis = (timeframe: TrendAnalysis['timeframe'], direction: TrendAnalysis['direction'], strength: number): TrendAnalysis => ({
  timeframe, direction, strength, adx: 30, atr: 1, volumeRatio: 1.2, reasons: [],
})

describe('trend analysis', () => {
  it('calculates an EMA after the requested warm-up period', () => {
    const ema = calculateEma([1, 2, 3, 4, 5], 3)
    expect(ema.slice(0, 3)).toEqual([Number.NaN, Number.NaN, 2])
    expect(ema.at(-1)).toBe(4)
  })

  it('detects an upward and a downward trend from candles', () => {
    expect(analyzeTrend(makeCandles(0.5), '1h').direction).toBe('bullish')
    expect(analyzeTrend(makeCandles(-0.5), '1h').direction).toBe('bearish')
  })

  it('returns a strong long only when every timeframe confirms it', () => {
    const strongLong = [analysis('4h', 'bullish', 75), analysis('1h', 'bullish', 65), analysis('15m', 'bullish', 60), analysis('5m', 'bullish', 55)]
    expect(getOverallTrend(strongLong)).toBe('strong-long')
    const strongShort = strongLong.map((item) => ({ ...item, direction: 'bearish' as const }))
    expect(getOverallTrend(strongShort)).toBe('strong-short')
    expect(getOverallTrend([...strongLong.slice(0, 3), analysis('5m', 'bearish', 55)])).toBe('flat')
  })
})
