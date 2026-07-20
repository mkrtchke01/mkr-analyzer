import type { Candle, Timeframe } from './bybit'
import { calculateRsi } from './rsi'
import { calculateAtr } from './trend'

export type MarketInfoType = 'bullish-divergence' | 'bearish-divergence' | 'breakout' | 'consolidation' | 'retest' | 'impulse-correction'
export type DivergencePoint = { priceTime: number, price: number, rsiTime: number, rsiValue: number }
export type DivergenceInfo = { first: DivergencePoint, second: DivergencePoint }
export type MarketInfoLevel = { time: number, price: number, eventTime: number }
export type MarketInfoPoint = { time: number, price: number }
export type CorrectionInfo = { origin: MarketInfoPoint, impulseEnd: MarketInfoPoint, correctionEnd: MarketInfoPoint }
export type MarketInfoSignal = {
  type: MarketInfoType
  timeframe: Extract<Timeframe, '15m' | '1h' | '4h'>
  side: 'bullish' | 'bearish'
  divergence?: DivergenceInfo
  level?: MarketInfoLevel
  correction?: CorrectionInfo
}

type Swing = { index: number, price: number }
type Side = MarketInfoSignal['side']
type LevelTimeframe = MarketInfoSignal['timeframe']

const PIVOT_RADIUS = 2
const RECENT_SIGNAL_CANDLES = 40
const LEVEL_RULES: Record<LevelTimeframe, { pivotRadius: number, minimumReversalAtr: number }> = {
  '4h': { pivotRadius: 5, minimumReversalAtr: 3 },
  '1h': { pivotRadius: 4, minimumReversalAtr: 2 },
  '15m': { pivotRadius: 3, minimumReversalAtr: 1.5 },
}

function isSwing(candles: Candle[], index: number, kind: 'high' | 'low', radius = PIVOT_RADIUS): boolean {
  if (index < radius || index > candles.length - radius - 1) return false
  const candle = candles[index]
  for (let offset = 1; offset <= radius; offset += 1) {
    if (kind === 'high' && (candle.high <= candles[index - offset].high || candle.high < candles[index + offset].high)) return false
    if (kind === 'low' && (candle.low >= candles[index - offset].low || candle.low > candles[index + offset].low)) return false
  }
  return true
}

function swings(candles: Candle[], kind: 'high' | 'low', radius = PIVOT_RADIUS): Swing[] {
  const result: Swing[] = []
  for (let index = radius; index < candles.length - radius; index += 1) {
    if (isSwing(candles, index, kind, radius)) result.push({ index, price: kind === 'high' ? candles[index].high : candles[index].low })
  }
  return result
}

function reversalFromLevel(candles: Candle[], level: Swing, kind: 'high' | 'low', until: number): number {
  const following = candles.slice(level.index + 1, until)
  if (!following.length) return 0
  return kind === 'high'
    ? level.price - Math.min(...following.map((candle) => candle.low))
    : Math.max(...following.map((candle) => candle.high)) - level.price
}

export function findRsiDivergence(candles: Candle[]): { type: 'bullish-divergence' | 'bearish-divergence', divergence: DivergenceInfo } | undefined {
  const atr = calculateAtr(candles)
  if (!atr || candles.length < 35) return undefined
  const rsi = calculateRsi(candles)
  const rsiAt = (index: number, kind: 'high' | 'low') => {
    const nearby = rsi.slice(Math.max(0, index - 14 - 2), index - 14 + 3)
    if (!nearby.length) return undefined
    return nearby.reduce((selected, point) => (kind === 'low' ? point.value < selected.value : point.value > selected.value) ? point : selected)
  }

  const compare = (kind: 'high' | 'low') => {
    const points = swings(candles, kind)
    for (let index = points.length - 1; index >= 1; index -= 1) {
      const last = points[index]
      const previous = points[index - 1]
      if (candles.length - 1 - last.index > RECENT_SIGNAL_CANDLES || last.index - previous.index > 80) continue
      const currentRsi = rsiAt(last.index, kind)
      const previousRsi = rsiAt(previous.index, kind)
      if (currentRsi === undefined || previousRsi === undefined) continue

      const divergence = {
        first: { priceTime: candles[previous.index].time, price: previous.price, rsiTime: previousRsi.time, rsiValue: previousRsi.value },
        second: { priceTime: candles[last.index].time, price: last.price, rsiTime: currentRsi.time, rsiValue: currentRsi.value },
      }
      if (kind === 'low' && last.price < previous.price - atr * 0.15 && currentRsi.value > previousRsi.value + 3) return { type: 'bullish-divergence' as const, divergence }
      if (kind === 'high' && last.price > previous.price + atr * 0.15 && currentRsi.value < previousRsi.value - 3) return { type: 'bearish-divergence' as const, divergence }
    }
    return undefined
  }

  return compare('low') ?? compare('high')
}

type BreakoutState = { type: 'breakout' | 'retest', side: Side, level: MarketInfoLevel } | undefined

function findBreakoutState(candles: Candle[], atr: number, timeframe: LevelTimeframe): BreakoutState {
  // The last candle is live and can close back inside the range, so it never confirms a breakout.
  const lastIndex = candles.length - 2
  if (lastIndex < 3) return undefined
  const rules = LEVEL_RULES[timeframe]
  const candidates: Array<{ level: Swing, side: Side }> = [
    ...swings(candles, 'high', rules.pivotRadius).map((level) => ({ level, side: 'bullish' as const })),
    ...swings(candles, 'low', rules.pivotRadius).map((level) => ({ level, side: 'bearish' as const })),
  ]
  const detected: Array<{ state: Exclude<BreakoutState, undefined>, score: number, index: number }> = []

  for (const { level, side } of candidates) {
    if (level.index >= lastIndex - 1) continue
    const levelTolerance = atr * 0.35
    const touches = candles.slice(Math.max(0, level.index - 80), level.index + 1).filter((candle) => side === 'bullish'
      ? Math.abs(candle.high - level.price) <= levelTolerance
      : Math.abs(candle.low - level.price) <= levelTolerance).length

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
    const kind = side === 'bullish' ? 'high' : 'low'
    const reversal = reversalFromLevel(candles, level, kind, breakoutIndex)
    if (reversal < atr * rules.minimumReversalAtr) continue

    const current = candles[lastIndex]
    const retest = breakoutIndex < lastIndex && (side === 'bullish'
      ? current.low <= level.price + atr * 0.25 && current.low >= level.price - atr * 0.7 && current.close >= level.price
      : current.high >= level.price - atr * 0.25 && current.high <= level.price + atr * 0.7 && current.close <= level.price)
    const levelInfo = (eventIndex: number): MarketInfoLevel => ({ time: candles[level.index].time, price: level.price, eventTime: candles[eventIndex].time })
    const state = retest
      ? { type: 'retest' as const, side, level: levelInfo(lastIndex) }
      : lastIndex - breakoutIndex <= 3 ? { type: 'breakout' as const, side, level: levelInfo(breakoutIndex) } : undefined
    if (state) detected.push({ state, score: reversal / atr + Math.min(touches, 3) * 0.25, index: level.index })
  }
  return detected.sort((left, right) => right.score - left.score || right.index - left.index).at(0)?.state
}

type ConsolidationState = { side: Side, level: MarketInfoLevel } | undefined

function findConsolidation(candles: Candle[], atr: number, timeframe: LevelTimeframe): ConsolidationState {
  const rangeCandles = candles.slice(-6)
  const rangeHigh = Math.max(...rangeCandles.map((candle) => candle.high))
  const rangeLow = Math.min(...rangeCandles.map((candle) => candle.low))
  const range = rangeHigh - rangeLow
  if (!range || range > atr * 1.5) return undefined

  const firstRangeIndex = candles.length - rangeCandles.length
  const rules = LEVEL_RULES[timeframe]
  const strongest = (kind: 'high' | 'low') => swings(candles, kind, rules.pivotRadius)
    .filter((point) => point.index < firstRangeIndex && firstRangeIndex - point.index <= 80)
    .map((point) => ({ point, reversal: reversalFromLevel(candles, point, kind, firstRangeIndex) }))
    .filter(({ reversal }) => reversal >= atr * rules.minimumReversalAtr)
    .sort((left, right) => right.reversal - left.reversal || right.point.index - left.point.index)
    .at(0)?.point
  const high = strongest('high')
  const low = strongest('low')
  const current = candles.at(-1)!
  if (high && high.price >= rangeHigh && high.price - rangeHigh <= atr * 0.7 && current.close >= rangeLow + range * 0.6) return { side: 'bullish', level: { time: candles[high.index].time, price: high.price, eventTime: current.time } }
  if (low && low.price <= rangeLow && rangeLow - low.price <= atr * 0.7 && current.close <= rangeHigh - range * 0.6) return { side: 'bearish', level: { time: candles[low.index].time, price: low.price, eventTime: current.time } }
  return undefined
}

type CorrectionState = { side: Side, correction: CorrectionInfo } | undefined

function findImpulseCorrection(candles: Candle[], atr: number): CorrectionState {
  const lastIndex = candles.length - 1
  const allHighs = swings(candles, 'high')
  const allLows = swings(candles, 'low')
  const highs = allHighs.filter((point) => lastIndex - point.index >= 3 && lastIndex - point.index <= 36)
  const lows = allLows.filter((point) => lastIndex - point.index >= 3 && lastIndex - point.index <= 36)

  for (const bullishPeak of [...highs].reverse()) {
    const origin = allLows.filter((point) => point.index < bullishPeak.index && bullishPeak.index - point.index <= 80).at(-1)
    const correctionCandle = candles.slice(bullishPeak.index + 1).reduce((lowest, candle) => candle.low < lowest.low ? candle : lowest)
    if (origin) {
      const impulse = bullishPeak.price - origin.price
      const retracement = (bullishPeak.price - correctionCandle.low) / impulse
      if (impulse >= atr * 4 && retracement >= 0.382 && retracement <= 0.786 && candles.at(-1)!.close < bullishPeak.price - atr * 0.2) {
        return {
          side: 'bullish',
          correction: {
            origin: { time: candles[origin.index].time, price: origin.price },
            impulseEnd: { time: candles[bullishPeak.index].time, price: bullishPeak.price },
            correctionEnd: { time: correctionCandle.time, price: correctionCandle.low },
          },
        }
      }
    }
  }

  for (const bearishTrough of [...lows].reverse()) {
    const origin = allHighs.filter((point) => point.index < bearishTrough.index && bearishTrough.index - point.index <= 80).at(-1)
    const correctionCandle = candles.slice(bearishTrough.index + 1).reduce((highest, candle) => candle.high > highest.high ? candle : highest)
    if (origin) {
      const impulse = origin.price - bearishTrough.price
      const retracement = (correctionCandle.high - bearishTrough.price) / impulse
      if (impulse >= atr * 4 && retracement >= 0.382 && retracement <= 0.786 && candles.at(-1)!.close > bearishTrough.price + atr * 0.2) {
        return {
          side: 'bearish',
          correction: {
            origin: { time: candles[origin.index].time, price: origin.price },
            impulseEnd: { time: candles[bearishTrough.index].time, price: bearishTrough.price },
            correctionEnd: { time: correctionCandle.time, price: correctionCandle.high },
          },
        }
      }
    }
  }

  return undefined
}

export function getMarketInfo(candles: Candle[], timeframe: MarketInfoSignal['timeframe']): MarketInfoSignal[] {
  const atr = calculateAtr(candles)
  if (!atr || candles.length < 35) return []

  const result: MarketInfoSignal[] = []
  const divergence = findRsiDivergence(candles)
  if (divergence) result.push({ type: divergence.type, timeframe, side: divergence.type === 'bullish-divergence' ? 'bullish' : 'bearish', divergence: divergence.divergence })

  const breakout = findBreakoutState(candles, atr, timeframe)
  if (breakout) return [...result, { type: breakout.type, timeframe, side: breakout.side, level: breakout.level }]

  const consolidation = findConsolidation(candles, atr, timeframe)
  if (consolidation) return [...result, { type: 'consolidation', timeframe, side: consolidation.side, level: consolidation.level }]

  const correction = findImpulseCorrection(candles, atr)
  if (correction) result.push({ type: 'impulse-correction', timeframe, side: correction.side, correction: correction.correction })
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
