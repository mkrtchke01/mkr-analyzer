import { describe, expect, it } from 'vitest'
import type { Candle } from './bybit'
import { analyzeTrend, calculateBreakoutRetestPlan, calculateEma, calculateLevelBreakoutPlan, calculateStop, calculateTradePlan, getOverallTrend, getTrendIndicator, type TrendAnalysis } from './trend'

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
  set(94, 120.3, 121, 120.6, 120.8, 110)
  set(95, 120.8, 121.1, 120.5, 120.7)
  set(96, 120.7, 121, 119.9, 120.4)
  set(97, 120.4, 120.9, 120.3, 120.5)
  set(98, 120.5, 120.95, 120.25, 120.55)
  set(99, 120.55, 121.8, 120.3, 121.6)
  return candles
}

const makeHourlyBreakoutRange = (): Candle[] => {
  const candles: Candle[] = Array.from({ length: 100 }, (_, index) => ({ time: index * 3600, open: 118, high: 119, low: 117, close: 118, volume: 100 }))
  const set = (index: number, open: number, high: number, low: number, close: number) => { candles[index] = { time: index * 3600, open, high, low, close, volume: 130 } }

  // Earlier 1h resistance, which becomes the second objective after the measured move.
  set(48, 124, 125, 123, 124)
  set(49, 124, 126, 123.5, 125)
  set(50, 125, 127, 124, 125)
  set(51, 125, 125.5, 122, 123)

  // Significant level at 121: after it price had a 1 ATR reaction, then compressed below it.
  set(68, 119, 120, 118, 119)
  set(69, 119, 120.4, 118, 119.5)
  set(70, 119.5, 121, 119, 120)
  set(71, 120, 120.5, 118, 118.5)
  set(72, 118.5, 119, 117, 117.5)
  set(73, 117.5, 118.5, 116.8, 117.5)
  set(74, 117.5, 119, 117, 118.5)

  for (let index = 88; index < 100; index += 1) {
    const high = index % 2 === 0 ? 120.8 : 120.7
    const low = index % 3 === 0 ? 116 : 117.2
    set(index, 119.5, high, low, 120.1)
  }
  return candles
}


const makeBreakoutRetestCandles = (): Candle[] => {
  const candles: Candle[] = Array.from({ length: 24 }, (_, index) => ({ time: index * 300, open: 100, high: 101, low: 99, close: 100, volume: 100 }))
  const set = (index: number, open: number, high: number, low: number, close: number) => { candles[index] = { time: index * 300, open, high, low, close, volume: 150 } }
  set(12, 103, 105, 102.8, 104)
  set(18, 104, 106.5, 103.8, 106)
  set(19, 106, 107, 105.8, 106.5)
  set(20, 106.5, 107.2, 106, 106.8)
  set(21, 106.8, 107, 104.8, 105.1)
  set(22, 105.1, 105.8, 104.9, 105.2)
  set(23, 105.2, 106.4, 105, 106)
  return candles
}

const makeHourlyPullbackCandles = (): Candle[] => {
  const candles: Candle[] = Array.from({ length: 100 }, (_, index) => ({ time: index * 3600, open: 100, high: 101, low: 99, close: 100, volume: 100 }))
  const set = (index: number, open: number, high: number, low: number, close: number) => { candles[index] = { time: index * 3600, open, high, low, close, volume: 140 } }
  set(50, 98, 101, 95, 98)
  set(70, 118, 120, 117, 119)
  set(71, 118, 119, 115, 116)
  for (let index = 72; index < 99; index += 1) set(index, 112, 113, 110, 112)
  set(99, 114, 116, 113, 115)
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
    const strongShort = strongLong.map((item) => ({ ...item, direction: 'bearish' as const }))
    expect(getOverallTrend(strongShort)).toBe('strong-short')
    expect(getOverallTrend([...strongLong.slice(0, 3), analysis('5m', 'bearish', 55)])).toBe('flat')
  })

  it('uses 4h as context and 1h as the required setup direction', () => {
    const permissiveLong = [
      analysis('4h', 'flat', 20),
      analysis('1h', 'bullish', 40),
      analysis('15m', 'flat', 20),
      analysis('5m', 'bearish', 35),
    ]
    expect(getOverallTrend(permissiveLong)).toBe('strong-long')

    expect(getOverallTrend([{ ...permissiveLong[0], direction: 'bearish' }, ...permissiveLong.slice(1)])).toBe('flat')
    expect(getOverallTrend([{ ...permissiveLong[0], direction: 'bullish', strength: 34 }, ...permissiveLong.slice(1)])).toBe('flat')
    expect(getOverallTrend([...permissiveLong.slice(0, 2), { ...permissiveLong[2], direction: 'bearish', strength: 55 }, permissiveLong[3]])).toBe('flat')
    expect(getOverallTrend([...permissiveLong.slice(0, 3), { ...permissiveLong[3], direction: 'bearish', strength: 55 }])).toBe('flat')
  })

  it('colors a market by the dominant weighted direction even without full confirmation', () => {
    const mixed = [analysis('4h', 'bullish', 70), analysis('1h', 'bearish', 30), analysis('15m', 'bullish', 50), analysis('5m', 'bullish', 40)]

    expect(getOverallTrend(mixed)).toBe('flat')
    expect(getTrendIndicator(mixed)).toEqual({ direction: 'bullish', strength: 51 })
    expect(getTrendIndicator(mixed.map((item) => ({ ...item, direction: 'flat' as const })))).toEqual({ direction: 'flat', strength: 51 })
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
    const plan = calculateTradePlan(candles, { fourHour: analysis('4h', 'bullish', 60), hourlyCandles: makeHourlyPullbackCandles() })
    const risk = plan!.stop.entry - plan!.stop.price!

    expect(plan!.takeProfits).toHaveLength(2)
    expect(plan!.takeProfits[0]).toMatchObject({ id: 'TP1', share: 50, price: 121 })
    expect(plan!.takeProfits[0].riskMultiple).toBeGreaterThanOrEqual(1)
    expect(plan!.takeProfits[1]).toMatchObject({ id: 'TP2', share: 50, riskMultiple: 3, price: plan!.stop.entry + risk * 3 })
    expect(plan!.setupType).toBe('trend-reclaim')
    expect(plan!.setupNote).toContain('Коррекция 1h')
  })

  it('uses 4h and a 1h Fibonacci pullback while ignoring a 15m countertrend', () => {
    const context = { fourHour: analysis('4h', 'bullish', 60), hourlyCandles: makeHourlyPullbackCandles() }
    const plan = calculateTradePlan(makeStoppedPullbackCandles(), context)

    expect(plan).toMatchObject({ setupType: 'trend-reclaim', stop: { side: 'long' } })
    expect(plan!.setupNote).toContain('5m подтверждён 2 свечами')
  })

  it('mirrors the 4h/1h pullback entry for a short', () => {
    const plan = calculateTradePlan(mirrorCandles(makeStoppedPullbackCandles()), {
      fourHour: analysis('4h', 'bearish', 60),
      hourlyCandles: mirrorCandles(makeHourlyPullbackCandles()),
    })

    expect(plan).toMatchObject({ setupType: 'trend-reclaim', stop: { side: 'short' } })
    expect(plan!.stop.price).toBeGreaterThan(plan!.stop.entry)
  })

  it('builds a level-breakout plan after a closed breakout of resistance', () => {
    const plan = calculateLevelBreakoutPlan(makeLevelBreakoutCandles(), 'strong-long', { hourlyCandles: makeHourlyBreakoutRange() })
    const risk = plan!.stop.entry - plan!.stop.price!

    expect(plan).toMatchObject({ setupType: 'level-breakout', setupName: 'Пробой уровня' })
    expect(plan!.setupNote).toContain('Пробой 1h уровня')
    expect(plan!.stop.price).toBeLessThan(plan!.stop.entry)
    expect(plan!.takeProfits).toHaveLength(2)
    expect(plan!.takeProfits[0]).toMatchObject({ id: 'TP1', share: 50 })
    expect(plan!.takeProfits[0].riskMultiple).toBeGreaterThanOrEqual(1.5)
    expect(plan!.takeProfits[1]).toMatchObject({ id: 'TP2', share: 50 })
    expect(plan!.takeProfits[1].price).toBeGreaterThan(plan!.takeProfits[0].price)
    expect(risk).toBeGreaterThan(0)
  })

  it('mirrors the level-breakout plan for a short below support', () => {
    const plan = calculateLevelBreakoutPlan(mirrorCandles(makeLevelBreakoutCandles()), 'strong-short', { hourlyCandles: mirrorCandles(makeHourlyBreakoutRange()) })

    expect(plan).toMatchObject({ setupType: 'level-breakout', stop: { side: 'short' } })
    expect(plan!.stop.price).toBeGreaterThan(plan!.stop.entry)
    expect(plan!.takeProfits[0].riskMultiple).toBeGreaterThanOrEqual(1.5)
    expect(plan!.takeProfits[1].price).toBeLessThan(plan!.takeProfits[0].price)
  })

  it('does not create a level-breakout plan without a 1h range context', () => {
    expect(calculateLevelBreakoutPlan(makeLevelBreakoutCandles(), 'strong-long')).toBeNull()
  })

  it('builds a breakout-retest plan after a bullish reaction from the broken resistance', () => {
    const plan = calculateBreakoutRetestPlan(makeBreakoutRetestCandles(), 'strong-long')

    expect(plan).toMatchObject({ setupType: 'breakout-retest', stop: { side: 'long' } })
    expect(plan!.setupNote).toContain('Ретест пробитого уровня')
    expect(plan!.stop.price).toBeLessThan(plan!.stop.entry)
  })

  it('mirrors the breakout-retest plan for a short after resistance retest', () => {
    const plan = calculateBreakoutRetestPlan(mirrorCandles(makeBreakoutRetestCandles()), 'strong-short')

    expect(plan).toMatchObject({ setupType: 'breakout-retest', stop: { side: 'short' } })
    expect(plan!.stop.price).toBeGreaterThan(plan!.stop.entry)
  })

})
