import { describe, expect, it } from 'vitest'
import type { Candle } from './bybit'
import { analyzeTrend, calculateEma, calculateLevelBreakoutPlan, calculateStop, calculateTradePlan, getOverallTrend, getSetupSignal, type TrendAnalysis } from './trend'

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

const makeLevelBreakoutCandles = (): Candle[] => {
  const candles = makeCandles(0.2)
  const set = (index: number, open: number, high: number, low: number, close: number, volume = 160) => { candles[index] = { time: index, open, high, low, close, volume } }
  set(90, 119.6, 121, 119.4, 120, 110)
  set(91, 120, 120.4, 119.7, 120.1, 110)
  set(92, 120.1, 120.3, 119.8, 120, 110)
  set(93, 120, 120.2, 119.9, 120.05, 110)
  set(94, 120.05, 120.25, 119.9, 120.1, 110)
  set(95, 120.1, 120.55, 120, 120.35)
  set(96, 120.35, 120.65, 120.1, 120.45)
  set(97, 120.45, 120.7, 120.2, 120.5)
  set(98, 120.5, 120.75, 120.25, 120.55)
  set(99, 120.55, 120.8, 120.3, 120.75)
  return candles
}

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
    expect(getSetupSignal(strongLong, makeStoppedPullbackCandles())).toMatchObject({ type: 'trend-reclaim', side: 'long' })
    const strongShort = strongLong.map((item) => ({ ...item, direction: 'bearish' as const }))
    expect(getOverallTrend(strongShort)).toBe('strong-short')
    expect(getSetupSignal(strongShort, mirrorCandles(makeStoppedPullbackCandles()))).toMatchObject({ type: 'trend-reclaim', side: 'short' })
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
    expect(plan!.setupType).toBe('trend-reclaim')
    expect(plan!.setupNote).toContain('Коррекция остановлена')
  })

  it('builds a level-breakout plan after consolidation just below resistance', () => {
    const plan = calculateLevelBreakoutPlan(makeLevelBreakoutCandles(), 'strong-long')
    const risk = plan!.stop.entry - plan!.stop.price!

    expect(plan).toMatchObject({ setupType: 'level-breakout', setupName: 'Level Breakout' })
    expect(plan!.takeProfits).toMatchObject([
      { id: 'TP1', share: 50, riskMultiple: 1.5, price: plan!.stop.entry + risk * 1.5 },
      { id: 'TP2', share: 50, riskMultiple: 3, price: plan!.stop.entry + risk * 3 },
    ])
    expect(plan!.stop.price).toBeLessThan(120)
  })

  it('mirrors the level-breakout plan for a short below support', () => {
    const plan = calculateLevelBreakoutPlan(mirrorCandles(makeLevelBreakoutCandles()), 'strong-short')
    const risk = plan!.stop.price! - plan!.stop.entry

    expect(plan).toMatchObject({ setupType: 'level-breakout', stop: { side: 'short' } })
    expect(plan!.stop.price).toBeGreaterThan(plan!.stop.entry)
    expect(plan!.takeProfits[0]).toMatchObject({ riskMultiple: 1.5, price: plan!.stop.entry - risk * 1.5 })
  })
})
