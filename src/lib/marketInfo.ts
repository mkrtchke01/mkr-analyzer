import type { Candle, Timeframe } from './bybit'
import { calculateRsi } from './rsi'
import { calculateAtr } from './trend'

export type MarketInfoType = 'bullish-divergence' | 'bearish-divergence' | 'breakout' | 'consolidation' | 'retest' | 'impulse-correction'
export type MarketInfoSignal = {
  type: MarketInfoType
  timeframe: Extract<Timeframe, '15m' | '1h' | '4h'>
  side: 'bullish' | 'bearish'
}

type Swing = { index: number, price: number }
type Side = MarketInfoSignal['side']

const PIVOT_RADIUS = 2
const RECENT_SIGNAL_CANDLES = 14

function isSwing(candles: Candle[], index: number, kind: 'high' | 'low'): boolean {
  if (index < PIVOT_RADIUS || index > candles.length - PIVOT_RADIUS - 1) return false
  const candle = candles[index]
  for (let offset = 1; offset <= PIVOT_RADIUS; offset += 1) {
    if (kind === 'high' && (candle.high <= candles[index - offset].high || candle.high < candles[index + offset].high)) return false
    if (kind === 'low' && (candle.low >= candles[index - offset].low || candle.low > candles[index + offset].low)) return false
  }
  return true
}

function swings(candles: Candle[], kind: 'high' | 'low'): Swing[] {
  const result: Swing[] = []
  for (let index = PIVOT_RADIUS; index < candles.length - PIVOT_RADIUS; index += 1) {
    if (isSwing(candles, index, kind)) result.push({ index, price: kind === 'high' ? candles[index].high : candles[index].low })
  }
  return result
}

export function findRsiDivergence(candles: Candle[]): Exclude<MarketInfoType, 'breakout' | 'consolidation' | 'retest' | 'impulse-correction'> | undefined {
  const atr = calculateAtr(candles)
  if (!atr || candles.length < 35) return undefined
  const rsi = calculateRsi(candles)
  const rsiAt = (index: number) => rsi[index - 14]?.value

  const compare = (kind: 'high' | 'low') => {
    const points = swings(candles, kind)
    const last = points.at(-1)
    const previous = points.at(-2)
    if (!last || !previous || candles.length - 1 - last.index > RECENT_SIGNAL_CANDLES) return undefined
    const currentRsi = rsiAt(last.index)
    const previousRsi = rsiAt(previous.index)
    if (currentRsi === undefined || previousRsi === undefined) return undefined

    if (kind === 'low' && last.price < previous.price - atr * 0.15 && currentRsi > previousRsi + 4) return 'bullish-divergence' as const
    if (kind === 'high' && last.price > previous.price + atr * 0.15 && currentRsi < previousRsi - 4) return 'bearish-divergence' as const
    return undefined
  }

  return compare('low') ?? compare('high')
}

type BreakoutState = { type: 'breakout' | 'retest', side: Side } | undefined

function findBreakoutState(candles: Candle[], atr: number): BreakoutState {
  // The last candle is live and can close back inside the range, so it never confirms a breakout.
  const lastIndex = candles.length - 2
  if (lastIndex < 3) return undefined
  const candidates: Array<{ level: Swing, side: Side }> = [
    ...swings(candles, 'high').map((level) => ({ level, side: 'bullish' as const })),
    ...swings(candles, 'low').map((level) => ({ level, side: 'bearish' as const })),
  ].sort((left, right) => right.level.index - left.level.index)

  for (const { level, side } of candidates) {
    if (level.index >= lastIndex - 1) continue
    const levelTolerance = atr * 0.35
    const touches = candles.slice(Math.max(0, level.index - 80), level.index + 1).filter((candle) => side === 'bullish'
      ? Math.abs(candle.high - level.price) <= levelTolerance
      : Math.abs(candle.low - level.price) <= levelTolerance).length
    if (touches < 2) continue

    const threshold = atr * 0.35
    let breakoutIndex = -1
    for (let index = level.index + 1; index <= lastIndex; index += 1) {
      const crossed = side === 'bullish' ? candles[index].close > level.price + threshold : candles[index].close < level.price - threshold
      const beforeLevel = index === level.index + 1 || (side === 'bullish' ? candles[index - 1].close <= level.price + threshold : candles[index - 1].close >= level.price - threshold)
      const body = Math.abs(candles[index].close - candles[index].open)
      if (crossed && beforeLevel && body >= atr * 0.35) {
        breakoutIndex = index
        break
      }
    }
    if (breakoutIndex < 0 || lastIndex - breakoutIndex > RECENT_SIGNAL_CANDLES) continue

    const current = candles[lastIndex]
    const retest = breakoutIndex < lastIndex && (side === 'bullish'
      ? current.low <= level.price + atr * 0.45 && current.low >= level.price - atr * 0.7 && current.close >= level.price
      : current.high >= level.price - atr * 0.45 && current.high <= level.price + atr * 0.7 && current.close <= level.price)
    if (retest) return { type: 'retest', side }
    if (lastIndex - breakoutIndex <= 3) return { type: 'breakout', side }
  }
  return undefined
}

function findConsolidation(candles: Candle[], atr: number): Side | undefined {
  const rangeCandles = candles.slice(-6)
  const rangeHigh = Math.max(...rangeCandles.map((candle) => candle.high))
  const rangeLow = Math.min(...rangeCandles.map((candle) => candle.low))
  const range = rangeHigh - rangeLow
  if (!range || range > atr * 1.5) return undefined

  const firstRangeIndex = candles.length - rangeCandles.length
  const high = swings(candles, 'high').filter((point) => point.index < firstRangeIndex).at(-1)
  const low = swings(candles, 'low').filter((point) => point.index < firstRangeIndex).at(-1)
  const current = candles.at(-1)!
  if (high && high.price >= rangeHigh && high.price - rangeHigh <= atr * 0.7 && current.close >= rangeLow + range * 0.6) return 'bullish'
  if (low && low.price <= rangeLow && rangeLow - low.price <= atr * 0.7 && current.close <= rangeHigh - range * 0.6) return 'bearish'
  return undefined
}

function findImpulseCorrection(candles: Candle[], atr: number): Side | undefined {
  const lastIndex = candles.length - 1
  const highs = swings(candles, 'high').filter((point) => lastIndex - point.index >= 3 && lastIndex - point.index <= 36)
  const lows = swings(candles, 'low').filter((point) => lastIndex - point.index >= 3 && lastIndex - point.index <= 36)

  const bullishPeak = highs.at(-1)
  if (bullishPeak) {
    const origin = lows.filter((point) => point.index < bullishPeak.index && bullishPeak.index - point.index <= 80).at(-1)
    const correctionLow = Math.min(...candles.slice(bullishPeak.index + 1).map((candle) => candle.low))
    if (origin) {
      const impulse = bullishPeak.price - origin.price
      const retracement = (bullishPeak.price - correctionLow) / impulse
      if (impulse >= atr * 4 && retracement >= 0.382 && retracement <= 0.786 && candles.at(-1)!.close < bullishPeak.price - atr * 0.2) return 'bullish'
    }
  }

  const bearishTrough = lows.at(-1)
  if (bearishTrough) {
    const origin = highs.filter((point) => point.index < bearishTrough.index && bearishTrough.index - point.index <= 80).at(-1)
    const correctionHigh = Math.max(...candles.slice(bearishTrough.index + 1).map((candle) => candle.high))
    if (origin) {
      const impulse = origin.price - bearishTrough.price
      const retracement = (correctionHigh - bearishTrough.price) / impulse
      if (impulse >= atr * 4 && retracement >= 0.382 && retracement <= 0.786 && candles.at(-1)!.close > bearishTrough.price + atr * 0.2) return 'bearish'
    }
  }

  return undefined
}

export function getMarketInfo(candles: Candle[], timeframe: MarketInfoSignal['timeframe']): MarketInfoSignal[] {
  const atr = calculateAtr(candles)
  if (!atr || candles.length < 35) return []

  const result: MarketInfoSignal[] = []
  const divergence = findRsiDivergence(candles)
  if (divergence) result.push({ type: divergence, timeframe, side: divergence === 'bullish-divergence' ? 'bullish' : 'bearish' })

  const breakout = findBreakoutState(candles, atr)
  if (breakout) return [...result, { type: breakout.type, timeframe, side: breakout.side }]

  const consolidation = findConsolidation(candles, atr)
  if (consolidation) return [...result, { type: 'consolidation', timeframe, side: consolidation }]

  const correction = findImpulseCorrection(candles, atr)
  if (correction) result.push({ type: 'impulse-correction', timeframe, side: correction })
  return result
}

export function marketInfoText(signal: MarketInfoSignal): string {
  const direction = signal.side === 'bullish' ? 'бычья' : 'медвежья'
  if (signal.type === 'bullish-divergence' || signal.type === 'bearish-divergence') return `Обнаружена ${direction} дивергенция на ${signal.timeframe} таймфрейме`
  if (signal.type === 'breakout') return `Монета пробила уровень на ${signal.timeframe} таймфрейме`
  if (signal.type === 'consolidation') return `Монета проторговывается перед пробитием уровня на ${signal.timeframe} таймфрейме`
  if (signal.type === 'retest') return `Монета пробила уровень и ретестит его на ${signal.timeframe} таймфрейме`
  return `Коррекция после ${signal.side === 'bullish' ? 'пампа' : 'дампа'} на ${signal.timeframe} таймфрейме`
}
