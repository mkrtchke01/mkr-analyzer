import type { Candle, Timeframe } from './bybit.js'
import type { PositionSizing } from './positionSizing.js'
import { calculateRsi } from './rsi.js'
export type TrendDirection = 'bullish' | 'bearish' | 'flat'
export type OverallTrend = 'strong-long' | 'strong-short' | 'flat'
export type SetupType = 'trend-reclaim' | 'level-breakout' | 'false-breakout' | 'bottom-reversal' | 'top-reversal' | 'breakout-retest' | 'consensus'
export type SetupSignal = { type: SetupType; side: 'long' | 'short' }

export type ScannerStrategyId = 'breakout-retest' | 'level-breakout' | 'false-breakout' | 'trend-reclaim' | 'divergence'
export type ScannerStrategy = {
  id: ScannerStrategyId
  shortName: string
  name: string
  setupTypes: readonly SetupType[]
}

export const SCANNER_STRATEGIES: readonly ScannerStrategy[] = [
]

export function getScannerStrategy(setupType: SetupType): ScannerStrategy | undefined {
  return SCANNER_STRATEGIES.find((strategy) => strategy.setupTypes.includes(setupType))
}

export const SETUP_META: Record<SetupType, { shortName: string; name: string }> = {
  'trend-reclaim': { shortName: 'TR', name: 'Возврат к тренду' },
  'level-breakout': { shortName: 'LB', name: 'Пробой уровня' },
  'false-breakout': { shortName: 'FB', name: 'Ложный пробой' },
  // Направления хранятся разными типами для логики и истории, но для пользователя
  // это одна стратегия: вход после подтверждённой RSI-дивергенции.
  'bottom-reversal': { shortName: 'DV', name: 'RSI-дивергенция' },
  'top-reversal': { shortName: 'DV', name: 'RSI-дивергенция' },
  'breakout-retest': { shortName: 'BR', name: 'Пробой + ретест' },
  // Оставляем метаданные только для уже сохранённых исторических сигналов CS.
  consensus: { shortName: 'CS', name: 'Согласованный тренд' },
}

export type TrendAnalysis = {
  timeframe: Timeframe
  direction: TrendDirection
  strength: number
  adx: number
  atr: number
  volumeRatio: number
  reasons: string[]
}

export type StopProposal = {
  side: 'long' | 'short'
  entry: number
  price?: number
  distancePercent?: number
  distanceAtr?: number
  reason?: string
}

export type TakeProfitLevel = {
  id: 'TP1' | 'TP2' | 'TP3'
  price: number
  share: number
  riskMultiple: number
}

export type SignalStrength = {
  score: number
  context: number
  trend: number
  reward: number
  entry: number
  pattern: number
}

export type ChartReferenceLevel = {
  price: number
  label: string
  color?: string
}

export type TradePlan = {
  setupType: SetupType
  setupName: string
  setupNote: string
  stop: StopProposal
  takeProfits: TakeProfitLevel[]
  triggerLevel?: { price: number, label: string }
  /** Fixed structural levels used to explain why this setup exists. */
  chartLevels?: ChartReferenceLevel[]
  signalKey?: string
  entryTime?: number
  signalStrength?: SignalStrength
  positionSizing?: PositionSizing
}

export type ManualChartLevel = {
  id: string
  price: number
  time: number
  endPrice: number
  endTime: number
  color?: string
  label?: string
  lineWidth?: number
  dashed?: boolean
  extendRight?: boolean
}

export type TrendIndicator = {
  direction: TrendDirection
  strength: number
}

export type EntryReadiness = {
  pullback: TrendIndicator
  entry: TrendIndicator
}

export type RiskRewardBox = {
  id: string
  time: number
  endTime: number
  entry: number
  takeProfit: number
  stopLoss: number
}

const FAST_EMA = 21
const SLOW_EMA = 55
const PERIOD = 14
const CONTEXT_MIN_STRENGTH = 35
const STRONG_OPPOSING_STRENGTH = 55
const ENTRY_CONTEXT_MIN_STRENGTH = 65
const BREAKOUT_RETEST_STOP_BUFFER_ATR = 0.4
const BREAKOUT_RETEST_MAX_ENTRY_DISTANCE_ATR = 0.75
const BREAKOUT_RETEST_MAX_RETEST_AGE_CANDLES = 1
const BREAKOUT_RETEST_LEVEL_TOUCH_ATR = 0.15
const BREAKOUT_RETEST_MIN_LEVEL_TOUCHES = 3
const BREAKOUT_RETEST_MIN_BREAKOUT_BODY_ATR = 0.7

const clamp = (value: number, min = 0, max = 100) => Math.min(Math.max(value, min), max)

export function calculateEma(values: number[], period: number): number[] {
  if (values.length < period) return []

  const result = Array.from({ length: period - 1 }, () => Number.NaN)
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period
  result.push(current)
  const multiplier = 2 / (period + 1)

  for (let index = period; index < values.length; index += 1) {
    current = (values[index] - current) * multiplier + current
    result.push(current)
  }

  return result
}

export function calculateAtr(candles: Candle[], period = PERIOD): number {
  if (candles.length <= period) return 0
  const ranges = candles.slice(1).map((candle, index) => {
    const previousClose = candles[index].close
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose))
  })
  let atr = ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period

  for (let index = period; index < ranges.length; index += 1) {
    atr = ((atr * (period - 1)) + ranges[index]) / period
  }

  return atr
}

export function calculateAdx(candles: Candle[], period = PERIOD): number {
  if (candles.length < period * 2 + 1) return 0

  const trueRanges: number[] = []
  const plusDm: number[] = []
  const minusDm: number[] = []
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index]
    const previous = candles[index - 1]
    const upMove = current.high - previous.high
    const downMove = previous.low - current.low
    trueRanges.push(Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close)))
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0)
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0)
  }

  let smoothedTr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0)
  let smoothedPlus = plusDm.slice(0, period).reduce((sum, value) => sum + value, 0)
  let smoothedMinus = minusDm.slice(0, period).reduce((sum, value) => sum + value, 0)
  const dx: number[] = []

  const addDx = () => {
    const plusDi = smoothedTr ? (100 * smoothedPlus) / smoothedTr : 0
    const minusDi = smoothedTr ? (100 * smoothedMinus) / smoothedTr : 0
    dx.push(plusDi + minusDi ? (100 * Math.abs(plusDi - minusDi)) / (plusDi + minusDi) : 0)
  }

  addDx()
  for (let index = period; index < trueRanges.length; index += 1) {
    smoothedTr = smoothedTr - smoothedTr / period + trueRanges[index]
    smoothedPlus = smoothedPlus - smoothedPlus / period + plusDm[index]
    smoothedMinus = smoothedMinus - smoothedMinus / period + minusDm[index]
    addDx()
  }

  if (dx.length < period) return 0
  let adx = dx.slice(0, period).reduce((sum, value) => sum + value, 0) / period
  for (let index = period; index < dx.length; index += 1) adx = ((adx * (period - 1)) + dx[index]) / period
  return adx
}

function getStructure(candles: Candle[]): TrendDirection {
  const highs: number[] = []
  const lows: number[] = []
  const start = Math.max(2, candles.length - 80)

  for (let index = start; index < candles.length - 2; index += 1) {
    const candle = candles[index]
    if (candle.high > candles[index - 1].high && candle.high > candles[index - 2].high && candle.high >= candles[index + 1].high && candle.high >= candles[index + 2].high) highs.push(candle.high)
    if (candle.low < candles[index - 1].low && candle.low < candles[index - 2].low && candle.low <= candles[index + 1].low && candle.low <= candles[index + 2].low) lows.push(candle.low)
  }

  if (highs.length < 2 || lows.length < 2) return 'flat'
  const higherHigh = highs.at(-1)! > highs.at(-2)!
  const higherLow = lows.at(-1)! > lows.at(-2)!
  if (higherHigh && higherLow) return 'bullish'
  if (!higherHigh && !higherLow) return 'bearish'
  return 'flat'
}

function findLastSwing(candles: Candle[], kind: 'high' | 'low', beforeIndex = candles.length - 3): { index: number; price: number } | undefined {
  for (let index = beforeIndex; index >= 2; index -= 1) {
    const candle = candles[index]
    const isSwingHigh = candle.high > candles[index - 1].high && candle.high > candles[index - 2].high && candle.high >= candles[index + 1].high && candle.high >= candles[index + 2].high
    const isSwingLow = candle.low < candles[index - 1].low && candle.low < candles[index - 2].low && candle.low <= candles[index + 1].low && candle.low <= candles[index + 2].low
    if (kind === 'high' && isSwingHigh) return { index, price: candle.high }
    if (kind === 'low' && isSwingLow) return { index, price: candle.low }
  }

  return undefined
}

export function analyzeTrend(candles: Candle[], timeframe: Timeframe): TrendAnalysis {
  if (candles.length < SLOW_EMA + 8) {
    return { timeframe, direction: 'flat', strength: 0, adx: 0, atr: 0, volumeRatio: 0, reasons: ['Недостаточно свечей'] }
  }

  const closes = candles.map((candle) => candle.close)
  const fast = calculateEma(closes, FAST_EMA)
  const slow = calculateEma(closes, SLOW_EMA)
  const last = candles.at(-1)!
  const atr = calculateAtr(candles)
  const adx = calculateAdx(candles)
  const fastLast = fast.at(-1)!
  const slowLast = slow.at(-1)!
  const fastEarlier = fast.at(-6)!
  const structure = getStructure(candles)
  const alignment: TrendDirection = last.close > fastLast && fastLast > slowLast ? 'bullish' : last.close < fastLast && fastLast < slowLast ? 'bearish' : 'flat'
  const slope: TrendDirection = fastLast > fastEarlier ? 'bullish' : fastLast < fastEarlier ? 'bearish' : 'flat'
  const votes = [alignment, slope, structure]
  const voteScore = votes.reduce((score, vote) => score + (vote === 'bullish' ? 1 : vote === 'bearish' ? -1 : 0), 0)
  const direction: TrendDirection = voteScore >= 2 ? 'bullish' : voteScore <= -2 ? 'bearish' : 'flat'
  const averageVolume = candles.slice(-21, -1).reduce((sum, candle) => sum + candle.volume, 0) / 20
  const volumeRatio = averageVolume ? last.volume / averageVolume : 1
  const normalizedAtr = atr || Number.EPSILON
  const adxScore = clamp(((adx - 15) / 25) * 35)
  const separationScore = clamp((Math.abs(fastLast - slowLast) / normalizedAtr / 1.5) * 25)
  const slopeScore = clamp((Math.abs(fastLast - fastEarlier) / normalizedAtr / 1.5) * 20)
  const structureScore = structure === direction && direction !== 'flat' ? 15 : 0
  const volumeBonus = volumeRatio >= 1.1 ? 5 : 0
  const strength = Math.round(direction === 'flat' ? Math.min(45, adxScore + separationScore / 2) : clamp(adxScore + separationScore + slopeScore + structureScore + volumeBonus))
  const relation = alignment === 'bullish' ? 'EMA 21 выше EMA 55' : alignment === 'bearish' ? 'EMA 21 ниже EMA 55' : 'EMA без направления'
  const reasons = [relation, `ADX ${adx.toFixed(1)}`, volumeRatio >= 1.1 ? 'Объём выше SMA 20' : 'Объём ниже SMA 20']

  return { timeframe, direction, strength, adx, atr, volumeRatio, reasons }
}

export function getOverallTrend(analyses: TrendAnalysis[]): OverallTrend {
  const ordered = ['4h', '1h', '15m', '5m'].map((timeframe) => analyses.find((analysis) => analysis.timeframe === timeframe))
  if (ordered.some((analysis) => !analysis)) return 'flat'
  const [global, confirmation, local, entry] = ordered as TrendAnalysis[]

  const supportsSide = (analysis: TrendAnalysis, side: TrendDirection) => analysis.direction === side || analysis.direction === 'flat' || analysis.strength < STRONG_OPPOSING_STRENGTH
  const allowsContext = (side: TrendDirection) => global.direction === 'flat' || (global.direction === side && global.strength >= CONTEXT_MIN_STRENGTH)
  const hasConfirmation = (side: TrendDirection) => confirmation.direction === side && confirmation.strength >= CONTEXT_MIN_STRENGTH

  if (allowsContext('bullish') && hasConfirmation('bullish') && supportsSide(local, 'bullish') && supportsSide(entry, 'bullish')) return 'strong-long'
  if (allowsContext('bearish') && hasConfirmation('bearish') && supportsSide(local, 'bearish') && supportsSide(entry, 'bearish')) return 'strong-short'
  return 'flat'
}

export function getTrendIndicator(analyses: TrendAnalysis[]): TrendIndicator {
  const weights: Partial<Record<TrendAnalysis['timeframe'], number>> = { '4h': 0.4, '1h': 0.3, '15m': 0.2, '5m': 0.1 }
  const strength = Math.round(analyses.reduce((sum, analysis) => sum + analysis.strength * (weights[analysis.timeframe] ?? 0), 0))
  const directionScore = analyses.reduce((sum, analysis) => {
    const sign = analysis.direction === 'bullish' ? 1 : analysis.direction === 'bearish' ? -1 : 0
    return sum + sign * analysis.strength * (weights[analysis.timeframe] ?? 0)
  }, 0)

  if (directionScore === 0) return { direction: 'flat', strength }
  return { direction: directionScore > 0 ? 'bullish' : 'bearish', strength }
}

/** Separates a lower-timeframe pullback from a confirmed return toward the 4h/1h trend. */
export function getEntryReadiness(analyses: TrendAnalysis[]): EntryReadiness {
  const fourHour = analyses.find((analysis) => analysis.timeframe === '4h')
  const oneHour = analyses.find((analysis) => analysis.timeframe === '1h')
  const fifteenMinute = analyses.find((analysis) => analysis.timeframe === '15m')
  const fiveMinute = analyses.find((analysis) => analysis.timeframe === '5m')
  const empty: EntryReadiness = { pullback: { direction: 'flat', strength: 0 }, entry: { direction: 'flat', strength: 0 } }
  if (!fourHour || !oneHour || !fifteenMinute || !fiveMinute) return empty
  if (fourHour.direction === 'flat' || fourHour.direction !== oneHour.direction) return empty

  const trendDirection = fourHour.direction
  const isCounterTrend = (analysis: TrendAnalysis) => analysis.direction !== 'flat' && analysis.direction !== trendDirection
  const pullbackStrength = Math.round(
    (isCounterTrend(fifteenMinute) ? fifteenMinute.strength * 0.7 : 0)
    + (isCounterTrend(fiveMinute) ? fiveMinute.strength * 0.3 : 0),
  )
  const pullback: TrendIndicator = {
    direction: pullbackStrength > 0 ? (trendDirection === 'bullish' ? 'bearish' : 'bullish') : 'flat',
    strength: pullbackStrength,
  }

  const hasStrongContext = fourHour.strength >= ENTRY_CONTEXT_MIN_STRENGTH && oneHour.strength >= ENTRY_CONTEXT_MIN_STRENGTH
  const hasFifteenMinutePullback = isCounterTrend(fifteenMinute)
  const hasFiveMinuteReclaim = fiveMinute.direction === trendDirection
  if (!hasStrongContext || !hasFifteenMinutePullback || !hasFiveMinuteReclaim) return { pullback, entry: { direction: 'flat', strength: 0 } }

  return {
    pullback,
    entry: {
      direction: trendDirection,
      strength: Math.round(fifteenMinute.strength * 0.7 + fiveMinute.strength * 0.3),
    },
  }
}

export function getSetupSignal(analyses: TrendAnalysis[], candles: Candle[]): SetupSignal | undefined {
  return getSetupSignals(analyses, candles).at(0)
}

export function getSetupSignals(analyses: TrendAnalysis[], candles: Candle[]): SetupSignal[] {
  const overall = getOverallTrend(analyses)
  return calculateTradePlans(candles, overall).map((plan) => ({ type: plan.setupType, side: plan.stop.side }))
}

export function calculateStop(candles: Candle[], trend: OverallTrend): StopProposal | null {
  if (trend === 'flat' || candles.length < PERIOD + 3) return null

  const side = trend === 'strong-long' ? 'long' : 'short'
  const entry = candles.at(-1)!.close
  const atr = calculateAtr(candles)
  const pivot = findLastSwing(candles, side === 'long' ? 'low' : 'high')
  if (!pivot || !atr) return { side, entry, reason: 'Не найден подтверждённый 5m swing для стопа' }

  const buffer = atr * 0.25
  const price = side === 'long' ? pivot.price - buffer : pivot.price + buffer
  const distance = side === 'long' ? entry - price : price - entry
  if (distance <= 0) return { side, entry, reason: 'Стоп оказался по неверную сторону от цены входа' }

  const distanceAtr = distance / atr
  if (distanceAtr > 2) return { side, entry, distanceAtr, reason: 'Стоп дальше 2 ATR — риск слишком высок' }

  return {
    side,
    entry,
    price,
    distancePercent: (distance / entry) * 100,
    distanceAtr,
  }
}

export type TrendReclaimContext = {
  fourHour: TrendAnalysis
  oneHour: TrendAnalysis
  fifteenMinute: TrendAnalysis
  hourlyCandles: Candle[]
}

export type LevelBreakoutContext = {
  hourlyCandles: Candle[]
  fifteenMinuteCandles?: Candle[]
}

export type DivergenceReversalContext = {
  hourlyCandles: Candle[]
  hourlyDivergenceCandles?: Candle[]
  fifteenMinuteCandles: Candle[]
  fiveMinuteCandles: Candle[]
}

type HourlyPullback = {
  side: 'long' | 'short'
  retracement: number
  correctionPrice: number
  originPrice: number
  impulsePrice: number
  atr: number
}

export function findHourlyPullback(candles: Candle[], side: 'long' | 'short'): HourlyPullback | undefined {
  const atr = calculateAtr(candles)
  if (!atr || candles.length < 35) return undefined

  const lastIndex = candles.length - 1
  const kind = side === 'long' ? 'high' : 'low'
  for (let impulseEndIndex = Math.min(candles.length - 3, lastIndex - 2); impulseEndIndex >= Math.max(2, candles.length - 24); impulseEndIndex -= 1) {
    if (!isSwingAt(candles, impulseEndIndex, kind)) continue
    const origin = findLastSwing(candles, side === 'long' ? 'low' : 'high', impulseEndIndex - 1)
    if (!origin || impulseEndIndex - origin.index < 3 || impulseEndIndex - origin.index > 24) continue

    const impulseEnd = kind === 'high' ? candles[impulseEndIndex].high : candles[impulseEndIndex].low
    const correctionCandles = candles.slice(impulseEndIndex + 1)
    const correctionOffset = correctionCandles.reduce((bestIndex, candle, index) => {
      const best = correctionCandles[bestIndex]
      return side === 'long' ? candle.low < best.low ? index : bestIndex : candle.high > best.high ? index : bestIndex
    }, 0)
    const correctionIndex = impulseEndIndex + 1 + correctionOffset
    const correctionEnd = side === 'long' ? correctionCandles[correctionOffset].low : correctionCandles[correctionOffset].high
    const impulse = side === 'long' ? impulseEnd - origin.price : origin.price - impulseEnd
    const retracement = side === 'long'
      ? (impulseEnd - correctionEnd) / impulse
      : (correctionEnd - impulseEnd) / impulse
    const directionalImpulseCandles = candles.slice(origin.index + 1, impulseEndIndex + 1)
      .filter((candle) => side === 'long' ? candle.close > candle.open : candle.close < candle.open).length
    const recovery = side === 'long'
      ? (candles.at(-1)!.close - correctionEnd) / (impulseEnd - correctionEnd)
      : (correctionEnd - candles.at(-1)!.close) / (correctionEnd - impulseEnd)
    const stillInPullback = side === 'long'
      ? candles.at(-1)!.close < impulseEnd - atr * 0.2
      : candles.at(-1)!.close > impulseEnd + atr * 0.2
    const recentCorrection = lastIndex - correctionIndex <= 12
    const directionalImpulse = directionalImpulseCandles >= Math.ceil((impulseEndIndex - origin.index) * 0.55)
    if (impulse >= atr * 5 && retracement >= 0.3 && retracement <= 0.65 && recovery <= 0.5 && stillInPullback && recentCorrection && directionalImpulse) {
      return { side, retracement, correctionPrice: correctionEnd, originPrice: origin.price, impulsePrice: impulseEnd, atr }
    }
  }

  return undefined
}

function hasDirectionalReclaim(candles: Candle[], side: 'long' | 'short'): boolean {
  if (candles.length < 3) return false
  const lastThree = candles.slice(-3)
  const current = lastThree[2]
  const previous = lastThree[1]
  const directional = (candle: Candle) => side === 'long' ? candle.close > candle.open : candle.close < candle.open
  const directionalCandles = lastThree.filter(directional).length
  const progressing = side === 'long'
    ? current.close > previous.close
    : current.close < previous.close

  return directional(current) && directionalCandles >= 2 && progressing
}

export function calculateTradePlan(candles: Candle[], context: TrendReclaimContext): TradePlan | null {
  return calculateTrendReclaimPlan(candles, context)
}

export function calculateTrendReclaimPlan(candles: Candle[], context: TrendReclaimContext): TradePlan | null {
  if (candles.length < PERIOD + 8) return null
  const { fourHour, oneHour, fifteenMinute, hourlyCandles } = context
  if (fourHour.direction === 'flat' || fourHour.strength < CONTEXT_MIN_STRENGTH) return null
  if (oneHour.direction !== fourHour.direction || fifteenMinute.direction !== fourHour.direction) return null

  const side = fourHour.direction === 'bullish' ? 'long' : 'short'
  const hourlyPullback = findHourlyPullback(hourlyCandles, side)
  if (!hourlyPullback || !hasDirectionalReclaim(candles, side)) return null

  const atr = calculateAtr(candles)
  const entry = candles.at(-1)!.close
  const pullback = findLastSwing(candles, side === 'long' ? 'low' : 'high')
  if (!pullback || !atr) return null
  const isFreshFiveMinutePullback = pullback.index >= candles.length - 10
  const isAtHourlyPullback = Math.abs(pullback.price - hourlyPullback.correctionPrice) <= hourlyPullback.atr * 1.25
  if (!isFreshFiveMinutePullback || !isAtHourlyPullback) return null

  const localTarget = findLastSwing(candles, side === 'long' ? 'high' : 'low', pullback.index - 1)
  if (!localTarget) return null

  const buffer = atr * 0.25
  const stopPrice = side === 'long' ? pullback.price - buffer : pullback.price + buffer
  const risk = side === 'long' ? entry - stopPrice : stopPrice - entry
  const rewardToTarget = side === 'long' ? localTarget.price - entry : entry - localTarget.price
  if (risk <= 0 || rewardToTarget < risk) return null

  const stop: StopProposal = {
    side,
    entry,
    price: stopPrice,
    distancePercent: (risk / entry) * 100,
    distanceAtr: risk / atr,
  }
  const direction = side === 'long' ? 1 : -1
  const impulseRange = Math.abs(hourlyPullback.impulsePrice - hourlyPullback.originPrice)
  const fibonacciLevels = [0.382, 0.5, 0.618].map((ratio) => ({
    price: hourlyPullback.impulsePrice - direction * impulseRange * ratio,
    label: `TR ФИБО ${ratio} 1h`,
    color: '#b991ff',
  }))
  return {
    setupType: 'trend-reclaim',
    setupName: SETUP_META['trend-reclaim'].name,
    setupNote: `4h / 1h / 15m ${side.toUpperCase()} · импульс 1h и коррекция ${(hourlyPullback.retracement * 100).toFixed(1)}% · 15m разворот от экстремума коррекции`,
    stop,
    takeProfits: [
      { id: 'TP1', price: localTarget.price, share: 50, riskMultiple: rewardToTarget / risk },
      { id: 'TP2', price: entry + direction * risk * 3, share: 50, riskMultiple: 3 },
    ],
    chartLevels: [
      { price: hourlyPullback.correctionPrice, label: 'TR ОТКАТ 1h', color: '#f2c15d' },
      ...fibonacciLevels,
    ],
  }
}

function isSwingAt(candles: Candle[], index: number, kind: 'high' | 'low') {
  if (index < 2 || index > candles.length - 3) return false
  const candle = candles[index]
  return kind === 'high'
    ? candle.high > candles[index - 1].high && candle.high > candles[index - 2].high && candle.high >= candles[index + 1].high && candle.high >= candles[index + 2].high
    : candle.low < candles[index - 1].low && candle.low < candles[index - 2].low && candle.low <= candles[index + 1].low && candle.low <= candles[index + 2].low
}

type HourlyRange = { level: number; height: number; touches: number; endTime: number }

type SignificantHourlyLevel = { level: number; kind: 'high' | 'low'; touches: number; reactionAtr: number; time: number }

type CleanStructuralLevel = SignificantHourlyLevel & { endTime: number }

function hasMeaningfulReaction(candles: Candle[], index: number, kind: 'high' | 'low', atr: number, until = candles.length): boolean {
  const after = candles.slice(index + 1, until)
  if (!after.length) return false
  const pivot = kind === 'high' ? candles[index].high : candles[index].low
  const reaction = kind === 'high'
    ? pivot - Math.min(...after.map((candle) => candle.low))
    : Math.max(...after.map((candle) => candle.high)) - pivot
  return reaction >= atr * 0.75
}

function getTouchGroups(candles: Candle[], indices: number[]) {
  return indices.reduce<number[][]>((groups, index) => {
    const current = groups.at(-1)
    if (!current || index - current.at(-1)! > 2) groups.push([index])
    else current.push(index)
    return groups
  }, [])
}

/**
 * A structural level is a reaction zone, not merely a price that happened to
 * be visited often.  Contacts must be separated by a real reaction and price
 * may not repeatedly close through the zone.  This deliberately rejects the
 * kind of "sawn through" 15m level that produced late BR entries.
 */
function assessCleanStructuralLevel(candles: Candle[], index: number, kind: 'high' | 'low', atr: number): CleanStructuralLevel | undefined {
  const level = kind === 'high' ? candles[index].high : candles[index].low
  const after = candles.slice(index)
  const touches = after
    .map((candle, offset) => ({ candle, index: index + offset }))
    .filter(({ candle }) => kind === 'high'
      ? candle.high >= level - atr * 0.25 && candle.high <= level + atr * 0.35 && candle.close <= level + atr * 0.2
      : candle.low <= level + atr * 0.25 && candle.low >= level - atr * 0.35 && candle.close >= level - atr * 0.2)
    .map(({ index: touchIndex }) => touchIndex)
  const touchGroups = getTouchGroups(candles, touches)
  if (touchGroups.length < 2) return undefined

  // Every completed contact must be followed by a visible move away from the
  // zone before the next contact.  Several adjacent candles at the same price
  // are one interaction, not several confirmations.
  for (let groupIndex = 0; groupIndex < touchGroups.length - 1; groupIndex += 1) {
    const reactionStart = touchGroups[groupIndex].at(-1)! + 1
    const reactionEnd = touchGroups[groupIndex + 1][0]
    const reactionCandles = candles.slice(reactionStart, reactionEnd)
    if (!reactionCandles.length) return undefined
    const reaction = kind === 'high'
      ? level - Math.min(...reactionCandles.map((candle) => candle.low))
      : Math.max(...reactionCandles.map((candle) => candle.high)) - level
    if (reaction < atr * 0.75) return undefined
  }

  const invalidatingCloses = after.filter((candle) => kind === 'high'
    ? candle.close > level + atr * 0.35
    : candle.close < level - atr * 0.35).length
  const closesInsideZone = after.filter((candle) => Math.abs(candle.close - level) <= atr * 0.2).length
  const bodyCrossesZone = after.filter((candle) => kind === 'high'
    ? (candle.open < level - atr * 0.1 && candle.close > level + atr * 0.1) || (candle.open > level + atr * 0.1 && candle.close < level - atr * 0.1)
    : (candle.open > level + atr * 0.1 && candle.close < level - atr * 0.1) || (candle.open < level - atr * 0.1 && candle.close > level + atr * 0.1)).length
  if (invalidatingCloses > 1 || closesInsideZone > 3 || bodyCrossesZone > 0) return undefined

  const reaction = kind === 'high'
    ? level - Math.min(...after.map((candle) => candle.low))
    : Math.max(...after.map((candle) => candle.high)) - level
  return {
    level,
    kind,
    touches: touchGroups.length,
    reactionAtr: reaction / atr,
    time: candles[index].time,
    endTime: candles[touchGroups.at(-1)!.at(-1)!].time,
  }
}

function findCleanStructuralHourlyLevels(candles: Candle[], kind: 'high' | 'low'): CleanStructuralLevel[] {
  const atr = calculateAtr(candles)
  if (!atr) return []
  const levels: CleanStructuralLevel[] = []
  for (let index = candles.length - 3; index >= Math.max(2, candles.length - 100); index -= 1) {
    if (!isSwingAt(candles, index, kind)) continue
    const level = assessCleanStructuralLevel(candles, index, kind, atr)
    if (!level || levels.some((candidate) => Math.abs(candidate.level - level.level) < atr * 0.2)) continue
    levels.push(level)
  }
  return levels
}

function findHourlyRangeBeforeBreakout(candles: Candle[], side: 'long' | 'short', endIndex = candles.length - 1, minTouches = 1): HourlyRange | undefined {
  const atr = calculateAtr(candles)
  if (!atr || candles.length < 20) return undefined
  const kind = side === 'long' ? 'high' : 'low'
  const candidates = findCleanStructuralHourlyLevels(candles.slice(0, endIndex + 1), kind)
    .filter((level) => hasEnoughBreakoutLevelTouches(level.touches, minTouches))

  for (const candidate of candidates) {
    const structure = candles.slice(Math.max(0, candles.findIndex((candle) => candle.time === candidate.endTime) - 12), endIndex + 1)
    const boundary = side === 'long'
      ? Math.max(...structure.map((candle) => candle.high))
      : Math.min(...structure.map((candle) => candle.low))
    if (Math.abs(boundary - candidate.level) > atr * 0.35) continue
    const height = Math.max(...structure.map((candle) => candle.high)) - Math.min(...structure.map((candle) => candle.low))
    if (height < atr * 0.5 || height > atr * 3.5) continue
    return { level: candidate.level, height, touches: candidate.touches, endTime: candidate.endTime }
  }
  return undefined
}

export function hasEnoughBreakoutLevelTouches(touches: number, minTouches = 1): boolean {
  return touches >= minTouches
}

function findSignificantHourlyLevels(candles: Candle[], kind: 'high' | 'low'): SignificantHourlyLevel[] {
  return findCleanStructuralHourlyLevels(candles, kind)
}

type RetestLevel = HourlyRange & { side: 'long' | 'short' }

export function countPreBreakoutLevelTouches(candles: Candle[], index: number, kind: 'high' | 'low', atr: number): number {
  const level = kind === 'high' ? candles[index].high : candles[index].low
  return candles.slice(Math.max(0, index - 80), index + 1).filter((candle) => kind === 'high'
    ? candle.high >= level - atr * 0.25 && candle.high <= level + atr * 0.15
    : candle.low <= level + atr * 0.25 && candle.low >= level - atr * 0.15).length
}

function findRecentFifteenMinuteRetestLevels(candles: Candle[]): RetestLevel[] {
  const atr = calculateAtr(candles)
  if (!atr) return []
  const levels: RetestLevel[] = []

  for (const [kind, side] of [['high', 'long'], ['low', 'short']] as const) {
    for (let index = candles.length - 3; index >= Math.max(2, candles.length - 100); index -= 1) {
      if (!isSwingAt(candles, index, kind) || !hasMeaningfulReaction(candles, index, kind, atr)) continue
      const level = kind === 'high' ? candles[index].high : candles[index].low
      if (levels.some((candidate) => candidate.side === side && Math.abs(candidate.level - level) < atr * 0.2)) continue
      const after = candles.slice(index + 1)
      const reaction = kind === 'high'
        ? level - Math.min(...after.map((candle) => candle.low))
        : Math.max(...after.map((candle) => candle.high)) - level
      const touchesBeforeBreakout = countPreBreakoutLevelTouches(candles, index, kind, atr)
      // A breakout level must be visible before the breakout. Counting later candles
      // here turns an arbitrary pullback pivot into a false "level".
      if (touchesBeforeBreakout < BREAKOUT_RETEST_MIN_LEVEL_TOUCHES) continue
      levels.push({
        side,
        level,
        height: Math.min(atr * 3, Math.max(atr * 1.5, reaction)),
        touches: touchesBeforeBreakout,
        endTime: candles[index].time,
      })
    }
  }

  return levels
}

export function selectPrimaryRetestLevel<T extends { level: number; side: 'long' | 'short' }>(levels: T[], side: 'long' | 'short'): T | undefined {
  return levels
    .filter((level) => level.side === side)
    .sort((first, second) => side === 'long' ? first.level - second.level : second.level - first.level)
    .at(0)
}

function findHourlyTargets(candles: Candle[], side: 'long' | 'short', entry: number): number[] {
  const atr = calculateAtr(candles)
  if (!atr) return []
  const kind = side === 'long' ? 'high' : 'low'
  const targets: number[] = []

  for (let index = candles.length - 3; index >= Math.max(2, candles.length - 100); index -= 1) {
    if (!isSwingAt(candles, index, kind) || !hasMeaningfulReaction(candles, index, kind, atr)) continue
    const price = kind === 'high' ? candles[index].high : candles[index].low
    const isAhead = side === 'long' ? price > entry + atr * 0.1 : price < entry - atr * 0.1
    if (isAhead && !targets.some((target) => Math.abs(target - price) < atr * 0.2)) targets.push(price)
  }

  return targets.sort((first, second) => side === 'long' ? first - second : second - first)
}

function buildStructuralTargets(entry: number, stopPrice: number, side: 'long' | 'short', hourlyRange: HourlyRange, hourlyCandles: Candle[]): TakeProfitLevel[] | undefined {
  const risk = side === 'long' ? entry - stopPrice : stopPrice - entry
  if (risk <= 0) return undefined

  const direction = side === 'long' ? 1 : -1
  const measuredTarget = hourlyRange.level + direction * hourlyRange.height
  const candidates = [measuredTarget, ...findHourlyTargets(hourlyCandles, side, entry)]
    .filter((price, index, prices) => (side === 'long' ? price > entry : price < entry) && prices.findIndex((candidate) => Math.abs(candidate - price) < risk * 0.15) === index)
    .sort((first, second) => side === 'long' ? first - second : second - first)
  if (candidates.length < 2) return undefined
  const firstReward = side === 'long' ? candidates[0] - entry : entry - candidates[0]
  if (firstReward < risk * 1.5) return undefined

  const selected = candidates.slice(0, 3)
  const shares = selected.length === 3 ? [40, 35, 25] : selected.length === 2 ? [50, 50] : [100]
  return selected.map((price, index) => ({
    id: `TP${index + 1}` as TakeProfitLevel['id'],
    price,
    share: shares[index],
    riskMultiple: (side === 'long' ? price - entry : entry - price) / risk,
  }))
}

function hasFalseBreakoutConfirmation(candles: Candle[], sweepIndex: number, side: 'long' | 'short', level: number, atr: number): boolean {
  const confirmation = candles.slice(sweepIndex + 1)
  if (confirmation.length < 2 || confirmation.length > 3) return false
  const directionalCandles = confirmation.filter((candle) => side === 'long' ? candle.close > candle.open : candle.close < candle.open)
  const current = confirmation.at(-1)!
  const movedAway = side === 'long' ? current.close >= level + atr * 0.15 : current.close <= level - atr * 0.15
  const invalidated = confirmation.some((candle) => side === 'long'
    ? candle.close < level - atr * 0.35
    : candle.close > level + atr * 0.35)
  return directionalCandles.length >= 2 && (side === 'long' ? current.close > current.open : current.close < current.open) && movedAway && !invalidated
}

function hasDominantFalseBreakoutBody(candle: Candle, side: 'long' | 'short'): boolean {
  const body = Math.abs(candle.close - candle.open)
  const breakoutWick = side === 'long'
    ? Math.min(candle.open, candle.close) - candle.low
    : candle.high - Math.max(candle.open, candle.close)
  return body > breakoutWick
}

function buildFalseBreakoutTargets(entry: number, stopPrice: number, side: 'long' | 'short', candles: Candle[], hourlyCandles: Candle[], sweepIndex: number): TakeProfitLevel[] | undefined {
  const risk = side === 'long' ? entry - stopPrice : stopPrice - entry
  if (risk <= 0) return undefined
  const localTarget = findLastSwing(candles, side === 'long' ? 'high' : 'low', sweepIndex - 1)
  if (!localTarget) return undefined
  const firstReward = side === 'long' ? localTarget.price - entry : entry - localTarget.price
  if (firstReward < risk * 1.5) return undefined

  const direction = side === 'long' ? 1 : -1
  const targetAtThreeR = entry + direction * risk * 3
  const nearestLevelIsCloser = side === 'long'
    ? localTarget.price < targetAtThreeR
    : localTarget.price > targetAtThreeR
  const firstTarget = nearestLevelIsCloser ? localTarget.price : targetAtThreeR
  const followUpTargets = [localTarget.price, ...findHourlyTargets(hourlyCandles, side, entry)]
    .filter((price) => side === 'long' ? price > firstTarget : price < firstTarget)
  const selected = [firstTarget, ...followUpTargets]
    .filter((price, index, prices) => prices.findIndex((candidate) => Math.abs(candidate - price) < risk * 0.15) === index)
    .slice(0, 3)
  const shares = selected.length === 3 ? [40, 35, 25] : selected.length === 2 ? [50, 50] : [100]
  return selected.map((price, index) => ({
    id: `TP${index + 1}` as TakeProfitLevel['id'],
    price,
    share: shares[index],
    riskMultiple: (side === 'long' ? price - entry : entry - price) / risk,
  }))
}

export function calculateFalseBreakoutPlan(candles: Candle[], side: 'long' | 'short', context?: LevelBreakoutContext): TradePlan | null {
  if (!context || candles.length < PERIOD + 8) return null
  const atr = calculateAtr(candles)
  if (!atr) return null

  const levelKind = side === 'long' ? 'low' : 'high'
  const recentLevels = findSignificantHourlyLevels(context.hourlyCandles, levelKind)
  const lastIndex = candles.length - 1
  for (const level of recentLevels) {
    for (let sweepIndex = lastIndex - 3; sweepIndex <= lastIndex - 2; sweepIndex += 1) {
      const sweep = candles[sweepIndex]
      const sweptAndClosedBack = side === 'long'
        ? sweep.low <= level.level - atr * 0.15 && sweep.close >= level.level
        : sweep.high >= level.level + atr * 0.15 && sweep.close <= level.level
      if (!sweptAndClosedBack || !hasDominantFalseBreakoutBody(sweep, side) || !hasFalseBreakoutConfirmation(candles, sweepIndex, side, level.level, atr)) continue

      const entry = candles.at(-1)!.close
      const stopPrice = side === 'long' ? sweep.low - atr * 0.25 : sweep.high + atr * 0.25
      const risk = side === 'long' ? entry - stopPrice : stopPrice - entry
      if (risk <= 0 || risk / atr > 2.5) continue
      const takeProfits = buildFalseBreakoutTargets(entry, stopPrice, side, candles, context.hourlyCandles, sweepIndex)
      if (!takeProfits) continue

      return {
        setupType: 'false-breakout',
        setupName: SETUP_META['false-breakout'].name,
        setupNote: `Ложный пробой 1h уровня ${level.level.toPrecision(6)} · вынос ${((side === 'long' ? level.level - sweep.low : sweep.high - level.level) / atr).toFixed(2)} ATR · 5m реакция ${lastIndex - sweepIndex} свечи`,
        stop: {
          side,
          entry,
          price: stopPrice,
          distancePercent: (risk / entry) * 100,
          distanceAtr: risk / atr,
        },
        takeProfits,
        chartLevels: [{ price: level.level, label: 'FB УРОВЕНЬ 1h', color: '#f2c15d' }],
      }
    }
  }

  return null
}

export function calculateLevelBreakoutPlan(candles: Candle[], trend: OverallTrend, context?: LevelBreakoutContext): TradePlan | null {
  if (trend === 'flat' || candles.length < PERIOD + 5 || !context) return null

  const side = trend === 'strong-long' ? 'long' : 'short'
  const atr = calculateAtr(candles)
  const hourlyRange = findHourlyRangeBeforeBreakout(context.hourlyCandles, side, context.hourlyCandles.length - 1, 2)
  if (!atr || !hourlyRange) return null

  const entryCandle = candles.at(-1)!
  const previous = candles.at(-2)!
  const entry = entryCandle.close
  const threshold = atr * 0.2
  const brokeNow = side === 'long'
    ? entry > hourlyRange.level + threshold && previous.close <= hourlyRange.level + threshold && entryCandle.close > entryCandle.open
    : entry < hourlyRange.level - threshold && previous.close >= hourlyRange.level - threshold && entryCandle.close < entryCandle.open
  if (!brokeNow) return null

  const localStop = findLastSwing(candles, side === 'long' ? 'low' : 'high')
  if (!localStop) return null
  const stopPrice = side === 'long' ? localStop.price - atr * 0.25 : localStop.price + atr * 0.25
  const risk = side === 'long' ? entry - stopPrice : stopPrice - entry
  if (risk <= 0) return null
  const stop: StopProposal = {
    side,
    entry,
    price: stopPrice,
    distancePercent: (risk / entry) * 100,
    distanceAtr: risk / atr,
  }

  const takeProfits = buildStructuralTargets(entry, stopPrice, side, hourlyRange, context.hourlyCandles)
  if (!takeProfits) return null

  return {
    setupType: 'level-breakout',
    setupName: SETUP_META['level-breakout'].name,
    setupNote: `Пробой 1h уровня ${hourlyRange.level.toPrecision(6)} · наторговка ${hourlyRange.touches} касания · диапазон ${hourlyRange.height.toPrecision(4)}`,
    stop,
    takeProfits,
    chartLevels: [{ price: hourlyRange.level, label: 'LB УРОВЕНЬ 1h', color: '#f2c15d' }],
  }
}

function findLatestSwingAfter(candles: Candle[], kind: 'high' | 'low', afterIndex: number) {
  for (let index = candles.length - 3; index >= afterIndex; index -= 1) {
    if (isSwingAt(candles, index, kind)) return { index, price: kind === 'high' ? candles[index].high : candles[index].low }
  }
  return undefined
}

type HourlyRsiDivergence = {
  side: 'long' | 'short'
  firstIndex: number
  secondIndex: number
  secondPrice: number
  firstPrice: number
}

function rsiAtPivot(candles: Candle[], rsiByTime: Map<number, number>, index: number, kind: 'high' | 'low') {
  const values = candles
    .slice(Math.max(0, index - 2), Math.min(candles.length, index + 3))
    .map((candle) => rsiByTime.get(candle.time))
    .filter((value): value is number => value !== undefined)
  if (!values.length) return undefined
  return kind === 'high' ? Math.max(...values) : Math.min(...values)
}

function isDivergencePivot(candles: Candle[], index: number, kind: 'high' | 'low') {
  if (index < 2) return false
  if (index < candles.length - 1) return isSwingAt(candles, index, kind)
  const candle = candles[index]
  return kind === 'high'
    ? candle.high > candles[index - 1].high && candle.high > candles[index - 2].high
    : candle.low < candles[index - 1].low && candle.low < candles[index - 2].low
}

function findHourlyRsiDivergence(candles: Candle[]): HourlyRsiDivergence | undefined {
  const atr = calculateAtr(candles)
  const rsiByTime = new Map(calculateRsi(candles).map((point) => [point.time, point.value]))
  if (!atr || rsiByTime.size === 0) return undefined

  for (const [kind, side] of [['low', 'long'], ['high', 'short']] as const) {
    for (let secondIndex = candles.length - 3; secondIndex >= Math.max(16, candles.length - 40); secondIndex -= 1) {
      if (!isSwingAt(candles, secondIndex, kind)) continue
      const secondRsi = rsiAtPivot(candles, rsiByTime, secondIndex, kind)
      if (secondRsi === undefined) continue

      // 10–40 candles keep the divergence visible and reject adjacent micro-pivots.
      for (let firstIndex = secondIndex - 10; firstIndex >= Math.max(2, secondIndex - 40); firstIndex -= 1) {
        if (!isSwingAt(candles, firstIndex, kind)) continue
        const firstRsi = rsiAtPivot(candles, rsiByTime, firstIndex, kind)
        if (firstRsi === undefined) continue
        const hasDivergence = side === 'long'
          ? candles[secondIndex].low < candles[firstIndex].low - atr * 0.25 && secondRsi > firstRsi + 3
          : candles[secondIndex].high > candles[firstIndex].high + atr * 0.25 && secondRsi < firstRsi - 3
        if (hasDivergence) {
          return {
            side,
            firstIndex,
            secondIndex,
            firstPrice: side === 'long' ? candles[firstIndex].low : candles[firstIndex].high,
            secondPrice: side === 'long' ? candles[secondIndex].low : candles[secondIndex].high,
          }
        }
      }
    }
  }

  return undefined
}

function hasFiveMinuteDivergenceReclaim(candles: Candle[], side: 'long' | 'short', divergenceTime: number) {
  if (candles.length < 2) return false
  const [first, second] = candles.slice(-2)
  if (first.time < divergenceTime) return false
  return side === 'long'
    ? first.close > first.open && second.close >= second.open
    : first.close < first.open && second.close <= second.open
}

function findFifteenMinuteTargets(candles: Candle[], side: 'long' | 'short', entry: number): number[] {
  const atr = calculateAtr(candles)
  if (!atr) return []
  const kind = side === 'long' ? 'high' : 'low'
  const targets: number[] = []
  for (let index = candles.length - 3; index >= Math.max(2, candles.length - 100); index -= 1) {
    if (!isSwingAt(candles, index, kind) || !hasMeaningfulReaction(candles, index, kind, atr)) continue
    const price = kind === 'high' ? candles[index].high : candles[index].low
    const isAhead = side === 'long' ? price > entry + atr * 0.1 : price < entry - atr * 0.1
    if (isAhead && !targets.some((target) => Math.abs(target - price) < atr * 0.2)) targets.push(price)
  }
  return targets.sort((first, second) => side === 'long' ? first - second : second - first)
}

function buildDivergenceTargets(entry: number, stopPrice: number, side: 'long' | 'short', fifteenMinuteCandles: Candle[], hourlyCandles: Candle[]): TakeProfitLevel[] | undefined {
  const risk = side === 'long' ? entry - stopPrice : stopPrice - entry
  if (risk <= 0) return undefined

  const candidates = [...findFifteenMinuteTargets(fifteenMinuteCandles, side, entry), ...findHourlyTargets(hourlyCandles, side, entry)]
    .filter((price, index, prices) => (side === 'long' ? price > entry : price < entry) && prices.findIndex((candidate) => Math.abs(candidate - price) < risk * 0.15) === index)
    .sort((first, second) => side === 'long' ? first - second : second - first)
  if (!candidates.length) return undefined
  const firstReward = side === 'long' ? candidates[0] - entry : entry - candidates[0]
  if (firstReward < risk) return undefined

  const selected = candidates.slice(0, 3)
  const shares = selected.length === 3 ? [40, 35, 25] : selected.length === 2 ? [50, 50] : [100]
  return selected.map((price, index) => ({
    id: `TP${index + 1}` as TakeProfitLevel['id'],
    price,
    share: shares[index],
    riskMultiple: (side === 'long' ? price - entry : entry - price) / risk,
  }))
}

function buildBreakoutRetestTargets(entry: number, stopPrice: number, side: 'long' | 'short'): TakeProfitLevel[] | undefined {
  const risk = side === 'long' ? entry - stopPrice : stopPrice - entry
  if (risk <= 0) return undefined

  const direction = side === 'long' ? 1 : -1
  const firstTarget = entry + direction * risk * 3
  const secondTarget = entry + direction * risk * 6

  return [firstTarget, secondTarget].map((price, index) => ({
    id: `TP${index + 1}` as TakeProfitLevel['id'],
    price,
    share: 50,
    riskMultiple: (side === 'long' ? price - entry : entry - price) / risk,
  }))
}

export function calculateDivergenceReversalPlan(context?: DivergenceReversalContext): TradePlan | null {
  if (!context) return null
  const divergenceCandles = context.hourlyDivergenceCandles ?? context.hourlyCandles
  const divergence = findHourlyRsiDivergence(divergenceCandles)
  if (!divergence) return null

  const divergenceTime = divergenceCandles[divergence.secondIndex].time
  if (!hasFiveMinuteDivergenceReclaim(context.fiveMinuteCandles, divergence.side, divergenceTime)) return null

  const atr = calculateAtr(context.fiveMinuteCandles)
  const entry = context.fiveMinuteCandles.at(-1)?.close
  if (!atr || entry === undefined) return null

  const stopPrice = divergence.side === 'long' ? divergence.secondPrice - atr * 0.25 : divergence.secondPrice + atr * 0.25
  const risk = divergence.side === 'long' ? entry - stopPrice : stopPrice - entry
  if (risk <= 0) return null
  const takeProfits = buildDivergenceTargets(entry, stopPrice, divergence.side, context.fifteenMinuteCandles, context.hourlyCandles)
  if (!takeProfits) return null

  const divergenceName = divergence.side === 'long' ? 'бычья' : 'медвежья'
  const reclaimName = divergence.side === 'long' ? 'первая зелёная, вторая не ниже её открытия' : 'первая красная, вторая не выше её открытия'
  return {
    setupType: divergence.side === 'long' ? 'bottom-reversal' : 'top-reversal',
    setupName: SETUP_META[divergence.side === 'long' ? 'bottom-reversal' : 'top-reversal'].name,
    setupNote: `1h ${divergenceName} RSI-дивергенция (${divergence.secondIndex - divergence.firstIndex} свечей) · 5m отскок: ${reclaimName}`,
    stop: {
      side: divergence.side,
      entry,
      price: stopPrice,
      distancePercent: (risk / entry) * 100,
      distanceAtr: risk / atr,
    },
    takeProfits,
    chartLevels: [
      { price: divergence.firstPrice, label: 'DV ПИВОТ 1 1h', color: '#b991ff' },
      { price: divergence.secondPrice, label: 'DV ПИВОТ 2 1h', color: '#b991ff' },
    ],
    signalKey: `${divergenceCandles[divergence.firstIndex].time}:${divergenceTime}`,
  }
}

export function calculateBreakoutRetestPlan(candles: Candle[], trend: OverallTrend, context?: LevelBreakoutContext): TradePlan | null {
  if (trend === 'flat' || candles.length < PERIOD + 10 || !context?.hourlyCandles) return null
  const atr = calculateAtr(candles)
  if (!atr) return null

  const lastIndex = candles.length - 1
  const current = candles[lastIndex]
  const side = trend === 'strong-long' ? 'long' : 'short'
  // 5m determines the retest entry only.  The broken boundary itself must be
  // a clean 1h reaction level; a repeatedly traded 15m micro-level is not a
  // structural breakout and must never create a BR signal.
  const levelKind = side === 'long' ? 'high' : 'low'
  const structuralLevels = findCleanStructuralHourlyLevels(context.hourlyCandles, levelKind)
  for (const level of structuralLevels) {
    let breakoutIndex = -1
    for (let index = lastIndex - 1; index >= Math.max(1, lastIndex - 72); index -= 1) {
      const candle = candles[index]
      const previous = candles[index - 1]
      const body = Math.abs(candle.close - candle.open)
      const brokeLevel = side === 'long'
        ? candle.close > level.level + atr * 0.35 && previous.close <= level.level + atr * 0.1 && candle.close > candle.open
        : candle.close < level.level - atr * 0.35 && previous.close >= level.level - atr * 0.1 && candle.close < candle.open
      const isImpulse = body >= atr * BREAKOUT_RETEST_MIN_BREAKOUT_BODY_ATR
      if (candle.time >= level.endTime && brokeLevel && isImpulse) {
        breakoutIndex = index
        break
      }
    }
    if (breakoutIndex < 0) continue

    let retestIndex = -1
    for (let index = lastIndex; index > breakoutIndex; index -= 1) {
      const candle = candles[index]
      const isRetest = side === 'long'
        ? candle.low <= level.level + atr * BREAKOUT_RETEST_LEVEL_TOUCH_ATR && candle.low >= level.level - atr * 0.6 && candle.close >= level.level - atr * 0.1
        : candle.high >= level.level - atr * BREAKOUT_RETEST_LEVEL_TOUCH_ATR && candle.high <= level.level + atr * 0.6 && candle.close <= level.level + atr * 0.1
      if (isRetest) {
        retestIndex = index
        break
      }
    }
    if (retestIndex < 0 || lastIndex - retestIndex > BREAKOUT_RETEST_MAX_RETEST_AGE_CANDLES) continue
    const hasFreshReversal = side === 'long'
      ? current.close > current.open && current.close >= level.level
      : current.close < current.open && current.close <= level.level
    const candlesBeforeRetest = candles.slice(breakoutIndex, retestIndex)
    if (!candlesBeforeRetest.length) continue
    const localExtreme = side === 'long'
      ? Math.max(...candlesBeforeRetest.map((candle) => candle.high))
      : Math.min(...candlesBeforeRetest.map((candle) => candle.low))
    const remainsBelowLocalExtreme = side === 'long'
      ? current.high < localExtreme && current.close >= level.level
      : current.low > localExtreme && current.close <= level.level

    const retest = candles[retestIndex]
    const entryDistanceFromRetest = side === 'long' ? current.close - retest.low : retest.high - current.close
    if (!hasFreshReversal || !remainsBelowLocalExtreme || entryDistanceFromRetest < 0 || entryDistanceFromRetest > atr * BREAKOUT_RETEST_MAX_ENTRY_DISTANCE_ATR) continue
    const stopBase = side === 'long' ? Math.min(retest.low, level.level) : Math.max(retest.high, level.level)
    const stopPrice = side === 'long' ? stopBase - atr * BREAKOUT_RETEST_STOP_BUFFER_ATR : stopBase + atr * BREAKOUT_RETEST_STOP_BUFFER_ATR
    const risk = side === 'long' ? current.close - stopPrice : stopPrice - current.close
    if (risk <= 0) continue

    const takeProfits = buildBreakoutRetestTargets(current.close, stopPrice, side)
    if (!takeProfits) continue

    return {
      setupType: 'breakout-retest',
      setupName: SETUP_META['breakout-retest'].name,
      setupNote: `Импульсный пробой чистого 1h уровня ${level.level.toPrecision(6)} (${level.touches} реакции) · свежий 5m отскок от экстремума ретеста (не дальше ${BREAKOUT_RETEST_MAX_ENTRY_DISTANCE_ATR} ATR) · TP1 3R · TP2 6R`,
      triggerLevel: { price: level.level, label: 'BR УРОВЕНЬ 1h' },
      chartLevels: [{ price: level.level, label: 'BR УРОВЕНЬ 1h', color: '#f2c15d' }],
      stop: {
        side,
        entry: current.close,
        price: stopPrice,
        distancePercent: (risk / current.close) * 100,
        distanceAtr: risk / atr,
      },
      takeProfits,
      signalKey: `${level.endTime}:${candles[breakoutIndex].time}`,
    }
  }

  return null
}

export type TradePlansContext = TrendReclaimContext

export function calculateTradePlans(candles: Candle[], _trend: OverallTrend, context?: TradePlansContext): TradePlan[] {
  const plan = context ? calculateTrendReclaimPlan(candles, context) : null
  return plan ? [plan] : []
}
