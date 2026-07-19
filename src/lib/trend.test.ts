import { describe, expect, it } from 'vitest'
import type { Candle } from './bybit'
import { analyzeTrend, calculateEma, calculateStop, calculateTradePlan, getOverallTrend, getSetupSignal, type TrendAnalysis } from './trend'

const makeCandles = (step: number): Candle[] => Array.from({ length: 100 }, (_, index) => {
  const close = 100 + step * index + Math.sin(index / 3) * 0.08
  return { time: index, open: close - step / 2, high: close + 0.3, low: close - 0.3, close, volume: 100 + (index % 7) }
})

const makeStoppedPullbackCandles = (): Candle[] => {
  const candles = makeCandles(0.2)
  const set = (index: number, open: number, high: number, low: number, close: number) => { candles[index] = { time: index, open, high, low, close, volume: 140 } }
  set(90, 119.5, 121, 119.3, 120)
  set(91, 120, 120.3, 119.7, 120)
  set(92, 120, 120, 119.5, 119.7)
  set(93, 119.7, 119.8, 119.4, 119.5)
  set(94, 119.4, 119.8, 119.3, 119.5)
  set(95, 119.5, 119.7, 119.35, 119.45)
  set(96, 119.45, 119.65, 119.4, 119.5)
  set(97, 119.5, 119.7, 119.45, 119.55)
  set(98, 119.55, 119.7, 119.5, 119.6)
  set(99, 119.5, 120, 119.45, 119.8)
  return candles
}

const mirrorCandles = (candles: Candle[]): Candle[] => candles.map((candle) => ({
  ...candle,
  open: 200 - candle.open,
  high: 200 - candle.low,
  low: 200 - candle.high,
  close: 200 - candle.close,
}))

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
    expect(getSetupSignal(strongLong, makeStoppedPullbackCandles())).toBe('long')
    const strongShort = strongLong.map((item) => ({ ...item, direction: 'bearish' as const }))
    expect(getOverallTrend(strongShort)).toBe('strong-short')
    expect(getSetupSignal(strongShort, mirrorCandles(makeStoppedPullbackCandles()))).toBe('short')
    expect(getSetupSignal(strongLong, makeCandles(0.5))).toBeUndefined()
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

  it('builds targets from a stopped pullback and the local high', () => {
    const candles = makeStoppedPullbackCandles()
    const plan = calculateTradePlan(candles, 'strong-long')
    const risk = plan!.stop.entry - plan!.stop.price!

    expect(plan!.takeProfits).toHaveLength(2)
    expect(plan!.takeProfits[0]).toMatchObject({ id: 'TP1', share: 50, price: 121 })
    expect(plan!.takeProfits[0].riskMultiple).toBeGreaterThanOrEqual(1)
    expect(plan!.takeProfits[1]).toMatchObject({ id: 'TP2', share: 50, riskMultiple: 3, price: plan!.stop.entry + risk * 3 })
    expect(plan!.pullback.correctionAtr).toBeGreaterThanOrEqual(0.5)
  })
})
