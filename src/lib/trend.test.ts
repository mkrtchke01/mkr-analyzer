import { describe, expect, it } from 'vitest'
import type { Candle } from './bybit'
import { analyzeTrend, calculateEma, calculateStop, calculateTradePlan, getOverallTrend, type TrendAnalysis } from './trend'

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

  it('puts a long stop below the last confirmed swing low with an ATR buffer', () => {
    const candles = makeCandles(0.02)
    candles[94] = { ...candles[94], low: candles[94].low - 0.6 }
    const stop = calculateStop(candles, 'strong-long')

    expect(stop?.side).toBe('long')
    expect(stop?.price).toBeLessThan(stop!.entry)
    expect(stop?.distanceAtr).toBeLessThanOrEqual(2)
  })

  it('does not propose a stop without a strong multi-timeframe direction', () => {
    expect(calculateStop(makeCandles(0.05), 'flat')).toBeNull()
  })

  it('builds a 30/40/30 take-profit plan from the initial risk', () => {
    const candles = makeCandles(0.02)
    candles[94] = { ...candles[94], low: candles[94].low - 0.6 }
    const plan = calculateTradePlan(candles, 'strong-long')
    const risk = plan!.stop.entry - plan!.stop.price!

    expect(plan!.takeProfits).toHaveLength(2)
    expect(plan!.takeProfits[0]).toMatchObject({ id: 'TP1', share: 30, riskMultiple: 1, price: plan!.stop.entry + risk })
    expect(plan!.takeProfits[1]).toMatchObject({ id: 'TP2', share: 40, riskMultiple: 2, price: plan!.stop.entry + risk * 2 })
    expect(plan!.runner).toMatchObject({ share: 30, activationPrice: plan!.takeProfits[1].price })
  })
})
