import { describe, expect, it } from 'vitest'
import type { Candle } from './bybit'
import { analyzeTrend, calculateAtr, calculateBreakoutRetestPlan, calculateDivergenceReversalPlan, calculateEma, calculateFalseBreakoutPlan, calculateLevelBreakoutPlan, calculateStop, calculateTradePlan, countPreBreakoutLevelTouches, findHourlyPullback, getEntryReadiness, getOverallTrend, getScannerStrategy, getTrendIndicator, hasEnoughBreakoutLevelTouches, selectPrimaryRetestLevel, type TrendAnalysis } from './trend'

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
  const candles: Candle[] = Array.from({ length: 24 }, (_, index) => ({ time: 30000 + index * 300, open: 100, high: 101, low: 99, close: 100, volume: 100 }))
  const set = (index: number, open: number, high: number, low: number, close: number) => { candles[index] = { time: 30000 + index * 300, open, high, low, close, volume: 150 } }
  set(12, 103, 105, 102.8, 104)
  set(18, 104, 106.5, 103.8, 106)
  set(19, 106, 107, 105.8, 106.5)
  set(20, 106.5, 107.2, 106, 106.8)
  set(21, 106.8, 107, 104.8, 105.1)
  set(22, 105.1, 105.8, 104.9, 105.2)
  set(23, 105.2, 106.4, 105, 106)
  return candles
}

const makeFalseBreakoutCandles = (): Candle[] => {
  const candles: Candle[] = Array.from({ length: 32 }, (_, index) => ({ time: 40000 + index * 300, open: 120, high: 120.5, low: 119.5, close: 120, volume: 100 }))
  const set = (index: number, open: number, high: number, low: number, close: number) => { candles[index] = { time: 40000 + index * 300, open, high, low, close, volume: 150 } }

  // Nearest 5m swing low is a valid first target for the short after the failed resistance breakout.
  set(22, 119.5, 120, 119, 119.3)
  set(23, 118, 118.5, 116, 117)
  set(24, 117, 117.8, 117.2, 117.5)
  set(25, 117.5, 118.5, 117.6, 118)
  set(27, 120.4, 120.8, 120, 120.6)
  // Цена открылась за 1h сопротивлением 121 и вернулась под него; тело больше верхней тени.
  set(28, 121.3, 121.4, 120.2, 120.7)
  set(29, 120.7, 120.8, 119.8, 120)
  set(30, 120, 120.1, 119.5, 119.7)
  set(31, 119.7, 119.8, 119.2, 119.5)
  return candles
}

const makeHourlyRetestRange = (): Candle[] => {
  const candles: Candle[] = Array.from({ length: 100 }, (_, index) => ({ time: index * 300, open: 100, high: 101, low: 99, close: 100, volume: 100 }))
  const set = (index: number, open: number, high: number, low: number, close: number) => { candles[index] = { time: index * 300, open, high, low, close, volume: 130 } }

  set(48, 110, 111, 109, 110)
  set(49, 110, 111.5, 109, 110.5)
  set(50, 110.5, 112, 109.5, 110)
  set(51, 110, 110.5, 107, 108)

  set(68, 103, 104, 102, 103)
  set(69, 103, 104.5, 102, 103.5)
  set(70, 103.5, 105, 103, 104)
  set(71, 104, 104.2, 101, 102)
  set(72, 102, 102.5, 99, 100)
  set(73, 100, 102, 99.5, 101)

  for (let index = 88; index < 100; index += 1) set(index, 103.5, index % 2 ? 104.7 : 104.8, index % 3 ? 100.5 : 100.4, 104)
  return candles
}

const makeHourlyRetestPivot = (): Candle[] => {
  const candles: Candle[] = Array.from({ length: 100 }, (_, index) => ({ time: index * 300, open: 100, high: 101, low: 99, close: 100, volume: 100 }))
  const set = (index: number, open: number, high: number, low: number, close: number) => { candles[index] = { time: index * 300, open, high, low, close, volume: 130 } }

  // A lone 1h pivot high with a strong reaction; no compact range is formed below it.
  set(48, 110, 111, 109, 110)
  set(49, 110, 111.5, 109, 110.5)
  set(50, 110.5, 112, 109.5, 110)
  set(51, 110, 110.5, 107, 108)
  set(68, 103, 104, 102, 103)
  set(69, 103, 104.5, 102, 103.5)
  set(70, 103.5, 105, 103, 104)
  set(71, 104, 104.2, 101, 102)
  set(72, 102, 102.5, 99, 100)
  set(73, 100, 102, 99.5, 101)
  for (let index = 74; index < 100; index += 1) set(index, 102, 103, 101, 102)
  return candles
}

const makeHourlyPullbackCandles = (): Candle[] => {
  const candles: Candle[] = Array.from({ length: 100 }, (_, index) => ({ time: index * 3600, open: 110, high: 111, low: 109, close: 110, volume: 100 }))
  const set = (index: number, open: number, high: number, low: number, close: number) => { candles[index] = { time: index * 3600, open, high, low, close, volume: 140 } }
  // A genuine 1h impulse: a clear swing low followed by nineteen bullish hourly candles.
  set(67, 110, 111, 108, 109)
  for (let index = 68; index < 87; index += 1) {
    const close = 109 + (index - 67) * 0.75
    set(index, close - 0.45, close + 0.5, close - 0.7, close)
  }
  set(87, 123.5, 125, 122.8, 124)
  // The correction returns 34% of the 1h impulse and is still active.
  set(88, 124, 124.2, 119.2, 120)
  for (let index = 89; index < 99; index += 1) set(index, 120, 120.8, 119.4, 120)
  set(99, 120, 121, 119.6, 120.5)
  return candles
}

const makeHourlyBullishDivergence = (): Candle[] => {
  const candles: Candle[] = Array.from({ length: 60 }, (_, index) => ({ time: index * 3600, open: 100, high: 100.4, low: 99.6, close: 100, volume: 100 }))
  const set = (index: number, open: number, high: number, low: number, close: number) => { candles[index] = { time: index * 3600, open, high, low, close, volume: 150 } }

  // First low is sharp; after a full recovery the lower low forms gradually with a higher RSI low.
  set(21, 100, 100.2, 93.5, 94)
  set(22, 94, 98.5, 93.8, 98)
  set(23, 98, 103.5, 97.5, 103)
  set(24, 103, 107.5, 102.5, 107)
  set(25, 107, 110.5, 106.5, 110)
  set(26, 110, 112, 109.5, 111)
  for (let index = 27; index <= 46; index += 1) {
    const close = 111 - (index - 26) * 0.85
    set(index, close + 0.2, close + 0.45, close - 0.45, close)
  }
  set(47, 94, 94.3, 92.5, 93)
  set(48, 93, 97.5, 92.8, 97)
  set(49, 97, 101, 96.5, 100)
  return candles
}

const makeFifteenMinuteBullishReversal = (): Candle[] => {
  const start = 47 * 3600
  const candles: Candle[] = Array.from({ length: 32 }, (_, index) => ({ time: start + index * 900, open: 94, high: 94.4, low: 93.6, close: 94, volume: 100 }))
  const set = (index: number, open: number, high: number, low: number, close: number) => { candles[index] = { time: start + index * 900, open, high, low, close, volume: 150 } }

  // A prior 15m swing high is the first target after the reversal.
  set(5, 108.5, 110, 108, 109)
  set(6, 109, 109.2, 99, 100)
  set(7, 100, 100.2, 94, 94.5)

  // The 15m change of character: break the local high, retest it, then two bullish candles.
  set(15, 99, 100, 98.7, 99.5)
  set(16, 99.5, 99.8, 98.5, 99)
  set(17, 99, 99.4, 98.6, 99.2)
  set(25, 99.8, 101.5, 99.6, 101)
  set(26, 101, 102, 100.8, 101.6)
  set(27, 101.6, 102.1, 100.5, 101.2)
  set(28, 101.2, 101.5, 99.6, 100.4)
  set(29, 100.4, 101.4, 100.1, 101.1)
  set(30, 101.1, 102.2, 100.8, 101.8)
  set(31, 101.8, 103, 101.5, 102.6)
  return candles
}

const makeFastHourlyBullishDivergence = (): Candle[] => {
  const candles: Candle[] = Array.from({ length: 27 }, (_, index) => ({ time: index * 3600, open: 100, high: 100.4, low: 99.6, close: 100, volume: 100 }))
  const set = (index: number, open: number, high: number, low: number, close: number) => { candles[index] = { time: index * 3600, open, high, low, close, volume: 150 } }

  // The second, lower low is the current 1h candle, only five candles after the first pivot.
  set(21, 100, 100.2, 93.5, 94)
  set(22, 94, 102.5, 93.8, 102)
  set(23, 102, 102.3, 99.5, 100)
  set(24, 100, 100.3, 97.5, 98)
  set(25, 98, 98.3, 95.5, 96)
  set(26, 96, 96.2, 92.5, 93)
  return candles
}

const makeFiveMinuteBullishReclaim = (): Candle[] => {
  const start = 47 * 3600
  const candles: Candle[] = Array.from({ length: 32 }, (_, index) => ({ time: start + index * 300, open: 94, high: 94.4, low: 93.6, close: 94, volume: 100 }))
  const set = (index: number, open: number, high: number, low: number, close: number) => { candles[index] = { time: start + index * 300, open, high, low, close, volume: 150 } }

  set(30, 94, 95.3, 93.8, 95)
  // The second candle can close below the first one, but not below its own open.
  set(31, 95, 95.4, 94.5, 95)
  return candles
}

const analysis = (timeframe: TrendAnalysis['timeframe'], direction: TrendAnalysis['direction'], strength: number): TrendAnalysis => ({
  timeframe, direction, strength, adx: 30, atr: 1, volumeRatio: 1.2, reasons: [],
})

describe('trend analysis', () => {
  it('does not expose scanner strategies while scanning is disabled', () => {
    expect(getScannerStrategy('trend-reclaim')).toBeUndefined()
    expect(getScannerStrategy('bottom-reversal')).toBeUndefined()
  })

  it('calculates an EMA after the requested warm-up period', () => {
    const ema = calculateEma([1, 2, 3, 4, 5], 3)
    expect(ema.slice(0, 3)).toEqual([Number.NaN, Number.NaN, 2])
    expect(ema.at(-1)).toBe(4)
  })

  it('requires a range touch count selected by the breakout setup', () => {
    expect(hasEnoughBreakoutLevelTouches(0)).toBe(false)
    expect(hasEnoughBreakoutLevelTouches(1)).toBe(true)
    expect(hasEnoughBreakoutLevelTouches(1, 2)).toBe(false)
    expect(hasEnoughBreakoutLevelTouches(2, 2)).toBe(true)
  })

  it('detects an upward and a downward trend from candles', () => {
    expect(analyzeTrend(makeCandles(0.5), '1h').direction).toBe('bullish')
    expect(analyzeTrend(makeCandles(-0.5), '1h').direction).toBe('bearish')
  })

  it('returns a strong long only when the lower timeframes confirm it', () => {
    const strongLong = [analysis('4h', 'bullish', 75), analysis('1h', 'bullish', 65), analysis('15m', 'bullish', 60), analysis('5m', 'bullish', 55)]
    expect(getOverallTrend(strongLong)).toBe('strong-long')
    const strongShort = strongLong.map((item) => ({ ...item, direction: 'bearish' as const }))
    expect(getOverallTrend(strongShort)).toBe('strong-short')
    expect(getOverallTrend([...strongLong.slice(0, 3), analysis('5m', 'bearish', 65)])).toBe('flat')
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
    expect(getOverallTrend([...permissiveLong.slice(0, 2), { ...permissiveLong[2], direction: 'bearish', strength: 65 }, permissiveLong[3]])).toBe('flat')
    expect(getOverallTrend([...permissiveLong.slice(0, 3), { ...permissiveLong[3], direction: 'bearish', strength: 65 }])).toBe('flat')
  })

  it('colors a market by the dominant weighted direction even without full confirmation', () => {
    const mixed = [analysis('4h', 'bullish', 70), analysis('1h', 'bearish', 30), analysis('15m', 'bullish', 50), analysis('5m', 'bullish', 40)]

    expect(getOverallTrend(mixed)).toBe('flat')
    expect(getTrendIndicator(mixed)).toEqual({ direction: 'bullish', strength: 51 })
    expect(getTrendIndicator(mixed.map((item) => ({ ...item, direction: 'flat' as const })))).toEqual({ direction: 'flat', strength: 51 })
  })

  it('measures the lower-timeframe counter-trend pullback independently from entry readiness', () => {
    const analyses = [analysis('4h', 'bullish', 100), analysis('1h', 'bullish', 100), analysis('15m', 'bearish', 80), analysis('5m', 'bearish', 90)]

    expect(getEntryReadiness(analyses)).toEqual({ pullback: { direction: 'bearish', strength: 83 }, entry: { direction: 'flat', strength: 0 } })
  })

  it('marks entry readiness only after 5m reclaims a strong 4h/1h trend', () => {
    const analyses = [analysis('4h', 'bullish', 90), analysis('1h', 'bullish', 80), analysis('15m', 'bearish', 80), analysis('5m', 'bullish', 70)]

    expect(getEntryReadiness(analyses)).toEqual({ pullback: { direction: 'bearish', strength: 56 }, entry: { direction: 'bullish', strength: 77 } })
  })

  it('does not mark entry readiness without a strong 4h and 1h context', () => {
    const analyses = [analysis('4h', 'bearish', 64), analysis('1h', 'bearish', 100), analysis('15m', 'bullish', 80), analysis('5m', 'bearish', 70)]

    expect(getEntryReadiness(analyses)).toEqual({ pullback: { direction: 'bullish', strength: 56 }, entry: { direction: 'flat', strength: 0 } })
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
    const plan = calculateTradePlan(candles, {
      fourHour: analysis('4h', 'bullish', 60),
      oneHour: analysis('1h', 'bullish', 60),
      fifteenMinute: analysis('15m', 'bullish', 60),
      hourlyCandles: makeHourlyPullbackCandles(),
    })
    const risk = plan!.stop.entry - plan!.stop.price!

    expect(plan!.takeProfits).toHaveLength(2)
    expect(plan!.takeProfits[0]).toMatchObject({ id: 'TP1', share: 50, price: 121 })
    expect(plan!.takeProfits[0].riskMultiple).toBeGreaterThanOrEqual(1)
    expect(plan!.takeProfits[1]).toMatchObject({ id: 'TP2', share: 50, riskMultiple: 3, price: plan!.stop.entry + risk * 3 })
    expect(plan!.setupType).toBe('trend-reclaim')
    expect(plan!.setupNote).toContain('импульс 1h')
    expect(plan!.chartLevels).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'TR ОТКАТ 1h' }),
      expect.objectContaining({ label: 'TR ФИБО 0.5 1h' }),
    ]))
  })

  it('requires 4h, 1h and 15m to have the same trend direction', () => {
    const context = {
      fourHour: analysis('4h', 'bullish', 60),
      oneHour: analysis('1h', 'bullish', 60),
      fifteenMinute: analysis('15m', 'bullish', 60),
      hourlyCandles: makeHourlyPullbackCandles(),
    }
    const plan = calculateTradePlan(makeStoppedPullbackCandles(), context)

    expect(plan).toMatchObject({ setupType: 'trend-reclaim', stop: { side: 'long' } })
    expect(plan!.setupNote).toContain('15m разворот от экстремума коррекции')
  })

  it('recognizes a fresh 1h correction only after a directional 1h impulse', () => {
    expect(findHourlyPullback(makeHourlyPullbackCandles(), 'long')).toMatchObject({ correctionPrice: 119.2 })
  })

  it('rejects a 15m reversal that is not formed at the active 1h correction', () => {
    const hourlyCandles = makeHourlyPullbackCandles()
    const fifteenMinuteCandles = makeStoppedPullbackCandles().map((candle) => ({
      ...candle,
      open: candle.open + 4,
      high: candle.high + 4,
      low: candle.low + 4,
      close: candle.close + 4,
    }))

    expect(calculateTradePlan(fifteenMinuteCandles, {
      fourHour: analysis('4h', 'bullish', 60),
      oneHour: analysis('1h', 'bullish', 60),
      fifteenMinute: analysis('15m', 'bullish', 60),
      hourlyCandles,
    })).toBeNull()
  })

  it('rejects a trend reclaim when one of 4h, 1h or 15m disagrees', () => {
    const plan = calculateTradePlan(makeStoppedPullbackCandles(), {
      fourHour: analysis('4h', 'bullish', 60),
      oneHour: analysis('1h', 'bullish', 60),
      fifteenMinute: analysis('15m', 'bearish', 60),
      hourlyCandles: makeHourlyPullbackCandles(),
    })

    expect(plan).toBeNull()
  })

  it('mirrors the 4h/1h pullback entry for a short', () => {
    const plan = calculateTradePlan(mirrorCandles(makeStoppedPullbackCandles()), {
      fourHour: analysis('4h', 'bearish', 60),
      oneHour: analysis('1h', 'bearish', 60),
      fifteenMinute: analysis('15m', 'bearish', 60),
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
    expect(plan!.chartLevels).toEqual([{ price: 121, label: 'LB УРОВЕНЬ 1h', color: '#f2c15d' }])
  })

  it('builds a short false-breakout plan after a 1h resistance sweep and 5m rejection', () => {
    const plan = calculateFalseBreakoutPlan(makeFalseBreakoutCandles(), 'short', { hourlyCandles: makeHourlyBreakoutRange() })

    expect(plan).toMatchObject({ setupType: 'false-breakout', stop: { side: 'short' } })
    expect(plan!.setupNote).toContain('Ложный пробой 1h уровня')
    expect(plan!.setupNote).toContain('5m реакция 3 свечи')
    expect(plan!.stop.price).toBeGreaterThan(plan!.stop.entry)
    expect(plan!.stop.distanceAtr).toBeLessThanOrEqual(2.5)
    expect(plan!.takeProfits[0].riskMultiple).toBeGreaterThanOrEqual(1.5)
    expect(plan!.chartLevels).toEqual([expect.objectContaining({ label: 'FB УРОВЕНЬ 1h', color: '#f2c15d' })])
  })

  it('uses 3R for the first false-breakout target when the nearest level is farther away', () => {
    const candles = makeFalseBreakoutCandles()
    candles[23] = { ...candles[23], low: 110 }
    const plan = calculateFalseBreakoutPlan(candles, 'short', { hourlyCandles: makeHourlyBreakoutRange() })

    expect(plan).not.toBeNull()
    expect(plan!.takeProfits[0].riskMultiple).toBeCloseTo(3, 6)
  })

  it('rejects a false breakout when the breakout wick is larger than its body', () => {
    const candles = makeFalseBreakoutCandles()
    candles[28] = { ...candles[28], open: 120.6, high: 121.4, close: 120.7 }

    expect(calculateFalseBreakoutPlan(candles, 'short', { hourlyCandles: makeHourlyBreakoutRange() })).toBeNull()
  })

  it('mirrors the false-breakout plan for a sweep below 1h support', () => {
    const plan = calculateFalseBreakoutPlan(mirrorCandles(makeFalseBreakoutCandles()), 'long', { hourlyCandles: mirrorCandles(makeHourlyBreakoutRange()) })

    expect(plan).toMatchObject({ setupType: 'false-breakout', stop: { side: 'long' } })
    expect(plan!.stop.price).toBeLessThan(plan!.stop.entry)
    expect(plan!.takeProfits[0].riskMultiple).toBeGreaterThanOrEqual(1.5)
  })

  it('mirrors the level-breakout plan for a short below support', () => {
    const plan = calculateLevelBreakoutPlan(mirrorCandles(makeLevelBreakoutCandles()), 'strong-short', { hourlyCandles: mirrorCandles(makeHourlyBreakoutRange()) })

    expect(plan).toMatchObject({ setupType: 'level-breakout', stop: { side: 'short' } })
    expect(plan!.stop.price).toBeGreaterThan(plan!.stop.entry)
    expect(plan!.takeProfits[0].riskMultiple).toBeGreaterThanOrEqual(1.5)
    expect(plan!.takeProfits[1].price).toBeLessThan(plan!.takeProfits[0].price)
  })

  it('builds a reversal plan after a 1h RSI divergence and a two-candle 5m reclaim', () => {
    const plan = calculateDivergenceReversalPlan({
      hourlyCandles: makeHourlyBullishDivergence(),
      fifteenMinuteCandles: makeFifteenMinuteBullishReversal(),
      fiveMinuteCandles: makeFiveMinuteBullishReclaim(),
    })

    expect(plan).toMatchObject({ setupType: 'bottom-reversal', setupName: 'RSI-дивергенция', stop: { side: 'long' } })
    expect(plan!.setupNote).toContain('26 свечей')
    expect(plan!.setupNote).toContain('5m отскок')
    expect(plan!.stop.price).toBeLessThan(plan!.stop.entry)
    expect(plan!.takeProfits[0].riskMultiple).toBeGreaterThanOrEqual(1.25)
    expect(plan!.chartLevels).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'DV ПИВОТ 1 1h' }),
      expect.objectContaining({ label: 'DV ПИВОТ 2 1h' }),
    ]))
  })

  it('rejects a five-candle 1h divergence before the second hourly pivot is confirmed', () => {
    const plan = calculateDivergenceReversalPlan({
      hourlyCandles: makeFastHourlyBullishDivergence(),
      fifteenMinuteCandles: makeFifteenMinuteBullishReversal(),
      fiveMinuteCandles: makeFiveMinuteBullishReclaim(),
    })

    expect(plan).toBeNull()
  })

  it('rejects a shallow price extension even when the RSI divergence is clear', () => {
    const hourlyCandles = makeFastHourlyBullishDivergence()
    hourlyCandles[26] = { ...hourlyCandles[26], low: 93.2 }
    const extension = hourlyCandles[21].low - hourlyCandles[26].low

    expect(extension).toBeGreaterThan(calculateAtr(hourlyCandles) * 0.05)
    expect(extension).toBeLessThan(calculateAtr(hourlyCandles) * 0.25)
    expect(calculateDivergenceReversalPlan({
      hourlyCandles,
      fifteenMinuteCandles: makeFifteenMinuteBullishReversal(),
      fiveMinuteCandles: makeFiveMinuteBullishReclaim(),
    })).toBeNull()
  })

  it('accepts a second 5m candle below the first close when it holds its own open', () => {
    const fiveMinuteCandles = makeFiveMinuteBullishReclaim()
    fiveMinuteCandles[31] = { ...fiveMinuteCandles[31], open: 94.6, close: 94.8 }

    expect(calculateDivergenceReversalPlan({
      hourlyCandles: makeHourlyBullishDivergence(),
      fifteenMinuteCandles: makeFifteenMinuteBullishReversal(),
      fiveMinuteCandles,
    })).toMatchObject({ setupType: 'bottom-reversal', stop: { side: 'long' } })
  })

  it('requires the second 5m candle to close no lower than its own open', () => {
    const fiveMinuteCandles = makeFiveMinuteBullishReclaim()
    fiveMinuteCandles[31] = { ...fiveMinuteCandles[31], close: 94.9 }

    expect(calculateDivergenceReversalPlan({
      hourlyCandles: makeHourlyBullishDivergence(),
      fifteenMinuteCandles: makeFifteenMinuteBullishReversal(),
      fiveMinuteCandles,
    })).toBeNull()
  })

  it('does not create a level-breakout plan without a 1h range context', () => {
    expect(calculateLevelBreakoutPlan(makeLevelBreakoutCandles(), 'strong-long')).toBeNull()
  })

  it('rejects a breakout-retest without a confirmed multi-timeframe trend', () => {
    const fifteenMinuteCandles = makeHourlyRetestRange()
    const plan = calculateBreakoutRetestPlan(makeBreakoutRetestCandles(), 'flat', { hourlyCandles: makeHourlyRetestRange(), fifteenMinuteCandles })

    expect(plan).toBeNull()
  })

  it('keeps a qualified 1h structural breakout-retest with TP1 at 3R and TP2 at 6R', () => {
    const fifteenMinuteCandles = makeHourlyRetestRange()
    fifteenMinuteCandles[50] = { ...fifteenMinuteCandles[50], high: 120 }
    const plan = calculateBreakoutRetestPlan(makeBreakoutRetestCandles(), 'strong-long', {
      hourlyCandles: makeHourlyRetestRange(),
      fifteenMinuteCandles,
    })

    expect(plan).toMatchObject({ setupType: 'breakout-retest', stop: { side: 'long' } })
    expect(plan!.triggerLevel).toMatchObject({ label: 'BR УРОВЕНЬ 1h' })
    expect(plan!.chartLevels).toEqual([{ price: plan!.triggerLevel!.price, label: 'BR УРОВЕНЬ 1h', color: '#f2c15d' }])
    expect(plan!.takeProfits).toHaveLength(2)
    expect(plan!.takeProfits[0].riskMultiple).toBe(3)
    expect(plan!.takeProfits[1].riskMultiple).toBe(6)
    expect(plan!.stop.price).toBeLessThan(104.8)
  })

  it('uses the base 15m support or resistance instead of a later micro-level', () => {
    expect(selectPrimaryRetestLevel([{ level: 1_928, side: 'long' as const }, { level: 1_941, side: 'long' as const }], 'long')?.level).toBe(1_928)
    expect(selectPrimaryRetestLevel([{ level: 1_928, side: 'short' as const }, { level: 1_941, side: 'short' as const }], 'short')?.level).toBe(1_941)
  })

  it('counts the required three 15m touches before a breakout', () => {
    const fifteenMinuteCandles = makeHourlyRetestRange()
    expect(countPreBreakoutLevelTouches(fifteenMinuteCandles, 70, 'high', 2)).toBe(2)
    fifteenMinuteCandles[69] = { ...fifteenMinuteCandles[69], high: 103.8 }
    expect(countPreBreakoutLevelTouches(fifteenMinuteCandles, 70, 'high', 2)).toBe(1)
  })

  it('rejects a breakout-retest when the candidate 1h level was repeatedly chopped through', () => {
    const hourlyCandles = makeHourlyRetestRange()
    for (let index = 74; index < hourlyCandles.length; index += 1) {
      const crossesUp = index % 2 === 0
      hourlyCandles[index] = {
        ...hourlyCandles[index],
        open: crossesUp ? 104.5 : 105.6,
        high: 106.2,
        low: 104.2,
        close: crossesUp ? 105.6 : 104.5,
      }
    }

    expect(calculateBreakoutRetestPlan(makeBreakoutRetestCandles(), 'strong-long', {
      hourlyCandles,
      fifteenMinuteCandles: makeHourlyRetestRange(),
    })).toBeNull()
  })

  it('rejects a sideways drift through the level without an impulse candle', () => {
    const candles = makeBreakoutRetestCandles()
    candles[18] = { ...candles[18], open: 105.9, close: 106 }
    candles[19] = { ...candles[19], open: 106.45, close: 106.5 }
    candles[20] = { ...candles[20], open: 106.75, close: 106.8 }

    expect(calculateBreakoutRetestPlan(candles, 'strong-long', {
      hourlyCandles: makeHourlyRetestRange(),
      fifteenMinuteCandles: makeHourlyRetestRange(),
    })).toBeNull()
  })

  it('keeps the first breakout-retest target at 3R even when a nearer 15m high exists', () => {
    const fifteenMinuteCandles = makeHourlyRetestRange()
    fifteenMinuteCandles[20] = { time: fifteenMinuteCandles[20].time, open: 106, high: 109, low: 105, close: 106, volume: 150 }
    const plan = calculateBreakoutRetestPlan(makeBreakoutRetestCandles(), 'strong-long', {
      hourlyCandles: makeHourlyRetestRange(),
      fifteenMinuteCandles,
    })

    expect(plan!.takeProfits[0]).toMatchObject({ id: 'TP1', share: 50 })
    expect(plan!.takeProfits[0].riskMultiple).toBe(3)
    expect(plan!.takeProfits[1].riskMultiple).toBe(6)
  })

  it('rejects a breakout-retest ten 5m candles after the retest low', () => {
    const candles = makeBreakoutRetestCandles()
    candles[22] = { ...candles[22], open: 105.8, high: 106.2, low: 105.7, close: 106 }
    candles[23] = { ...candles[23], open: 106, high: 106.4, low: 105.8, close: 106.1 }
    for (let index = 24; index < 32; index += 1) candles.push({ time: 30000 + index * 300, open: 106, high: 106.5, low: 105.8, close: index === 31 ? 106.2 : 106, volume: 150 })

    expect(calculateBreakoutRetestPlan(candles, 'strong-long', {
      hourlyCandles: makeHourlyRetestRange(),
      fifteenMinuteCandles: makeHourlyRetestRange(),
    })).toBeNull()
  })

  it('rejects a short breakout-retest without a confirmed multi-timeframe trend', () => {
    const fifteenMinuteCandles = mirrorCandles(makeHourlyRetestRange())
    const plan = calculateBreakoutRetestPlan(mirrorCandles(makeBreakoutRetestCandles()), 'flat', { hourlyCandles: mirrorCandles(makeHourlyRetestRange()), fifteenMinuteCandles })

    expect(plan).toBeNull()
  })

  it('requires one 5m reversal candle after the retest', () => {
    const candles = makeBreakoutRetestCandles()
    candles[22] = { ...candles[22], open: 105.2, close: 105.1 }
    candles[23] = { ...candles[23], open: 106, close: 105.8 }

    expect(calculateBreakoutRetestPlan(candles, 'flat', {
      hourlyCandles: makeHourlyRetestRange(),
      fifteenMinuteCandles: makeHourlyRetestRange(),
    })).toBeNull()
  })

  it('rejects an otherwise valid retest when its 15m level has only one touch', () => {
    const candles = makeBreakoutRetestCandles()
    candles[22] = { ...candles[22], open: 105.1, close: 105.8 }
    candles[23] = { ...candles[23], open: 105.8, high: 106.4, low: 105.5, close: 105.6 }

    expect(calculateBreakoutRetestPlan(candles, 'strong-long', {
      hourlyCandles: makeHourlyRetestRange(),
      fifteenMinuteCandles: makeHourlyRetestRange(),
    })).toBeNull()
  })

  it('expires a retest setup after price breaks the local high', () => {
    const candles = makeBreakoutRetestCandles()
    candles[23] = { ...candles[23], high: 107.3, close: 107.2 }

    expect(calculateBreakoutRetestPlan(candles, 'flat', {
      hourlyCandles: makeHourlyRetestRange(),
      fifteenMinuteCandles: makeHourlyRetestRange(),
    })).toBeNull()
  })

  it('does not create a breakout-retest plan without 1h level context', () => {
    expect(calculateBreakoutRetestPlan(makeBreakoutRetestCandles(), 'strong-long')).toBeNull()
  })

})
