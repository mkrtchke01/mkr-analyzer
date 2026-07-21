import type { Candle, Timeframe } from './bybit.js'
import { calculateRsi } from './rsi.js'
export type TrendDirection = 'bullish' | 'bearish' | 'flat'
export type OverallTrend = 'strong-long' | 'strong-short' | 'flat'
export type SetupType = 'trend-reclaim' | 'level-breakout' | 'false-breakout' | 'bottom-reversal' | 'top-reversal' | 'breakout-retest' | 'consensus'
export type SetupSignal = { type: SetupType; side: 'long' | 'short' }

export const SETUP_META: Record<SetupType, { shortName: string; name: string }> = {
  'trend-reclaim': { shortName: 'TR', name: 'Trend Reclaim' },
  'level-breakout': { shortName: 'LB', name: 'Пробой уровня' },
  'false-breakout': { shortName: 'FB', name: 'Ложный пробой' },
  'bottom-reversal': { shortName: 'RL', name: 'Разворот от дна' },
  'top-reversal': { shortName: 'RH', name: 'Разворот от вершины' },
  'breakout-retest': { shortName: 'BR', name: 'Пробой + ретест' },
  // Оставляем метаданные только для уже сохранённых исторических сигналов CS.
  consensus: { shortName: 'CS', name: 'Directional Consensus' },
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

export type TradePlan = {
  setupType: SetupType
  setupName: string
  setupNote: string
  stop: StopProposal
  takeProfits: TakeProfitLevel[]
  signalKey?: string
  entryTime?: number
}

export type ManualChartLevel = {
  id: string
  price: number
  time: number
  endPrice: number
  endTime: number
  color?: string
  label?: string
  dashed?: boolean
  extendRight?: boolean
}

export type TrendIndicator = {
  direction: TrendDirection
  strength: number
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
const CONTEXT_MIN_STRENGTH = 25
const STRONG_OPPOSING_STRENGTH = 65

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

type HourlyPullback = { side: 'long' | 'short', retracement: number }

function findHourlyPullback(candles: Candle[], side: 'long' | 'short'): HourlyPullback | undefined {
  const atr = calculateAtr(candles)
  if (!atr || candles.length < 35) return undefined

  const lastIndex = candles.length - 1
  const kind = side === 'long' ? 'high' : 'low'
  for (let impulseEndIndex = Math.min(candles.length - 3, lastIndex - 3); impulseEndIndex >= Math.max(2, candles.length - 36); impulseEndIndex -= 1) {
    if (!isSwingAt(candles, impulseEndIndex, kind)) continue
    const origin = findLastSwing(candles, side === 'long' ? 'low' : 'high', impulseEndIndex - 1)
    if (!origin || impulseEndIndex - origin.index > 80) continue

    const impulseEnd = kind === 'high' ? candles[impulseEndIndex].high : candles[impulseEndIndex].low
    const correctionEnd = side === 'long'
      ? Math.min(...candles.slice(impulseEndIndex + 1).map((candle) => candle.low))
      : Math.max(...candles.slice(impulseEndIndex + 1).map((candle) => candle.high))
    const impulse = side === 'long' ? impulseEnd - origin.price : origin.price - impulseEnd
    const retracement = side === 'long'
      ? (impulseEnd - correctionEnd) / impulse
      : (correctionEnd - impulseEnd) / impulse
    const stillInPullback = side === 'long'
      ? candles.at(-1)!.close < impulseEnd - atr * 0.1
      : candles.at(-1)!.close > impulseEnd + atr * 0.1
    if (impulse >= atr * 3 && retracement >= 0.25 && retracement <= 0.9 && stillInPullback) return { side, retracement }
  }

  return undefined
}

function hasDirectionalReclaim(candles: Candle[], side: 'long' | 'short'): boolean {
  if (candles.length < 2) return false
  const current = candles.at(-1)!
  const previous = candles.at(-2)!
  const directional = (candle: Candle) => side === 'long' ? candle.close > candle.open : candle.close < candle.open
  const progressing = side === 'long'
    ? current.close > previous.close
    : current.close < previous.close

  return directional(current) && progressing
}

export function calculateTradePlan(candles: Candle[], context: TrendReclaimContext): TradePlan | null {
  return calculateTrendReclaimPlan(candles, context)
}

export function calculateTrendReclaimPlan(candles: Candle[], context: TrendReclaimContext): TradePlan | null {
  if (candles.length < PERIOD + 8) return null
  const { fourHour, hourlyCandles } = context
  if (fourHour.direction === 'flat' || fourHour.strength < CONTEXT_MIN_STRENGTH) return null

  const side = fourHour.direction === 'bullish' ? 'long' : 'short'
  const hourlyPullback = findHourlyPullback(hourlyCandles, side)
  if (!hourlyPullback || !hasDirectionalReclaim(candles, side)) return null

  const atr = calculateAtr(candles)
  const entry = candles.at(-1)!.close
  const pullback = findLastSwing(candles, side === 'long' ? 'low' : 'high')
  if (!pullback || !atr) return null

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
  return {
    setupType: 'trend-reclaim',
    setupName: SETUP_META['trend-reclaim'].name,
    setupNote: `Коррекция 1h ${(hourlyPullback.retracement * 100).toFixed(1)}% · 5m подтверждён возвратом`,
    stop,
    takeProfits: [
      { id: 'TP1', price: localTarget.price, share: 50, riskMultiple: rewardToTarget / risk },
      { id: 'TP2', price: entry + direction * risk * 3, share: 50, riskMultiple: 3 },
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

function hasMeaningfulReaction(candles: Candle[], index: number, kind: 'high' | 'low', atr: number, until = candles.length): boolean {
  const after = candles.slice(index + 1, until)
  if (!after.length) return false
  const pivot = kind === 'high' ? candles[index].high : candles[index].low
  const reaction = kind === 'high'
    ? pivot - Math.min(...after.map((candle) => candle.low))
    : Math.max(...after.map((candle) => candle.high)) - pivot
  return reaction >= atr * 0.5
}

function findHourlyRangeBeforeBreakout(candles: Candle[], side: 'long' | 'short', endIndex = candles.length - 1, minTouches = 1): HourlyRange | undefined {
  const atr = calculateAtr(candles)
  if (!atr || candles.length < 20) return undefined

  const levelKind = side === 'long' ? 'high' : 'low'
  let best: (HourlyRange & { score: number }) | undefined

  for (let size = 2; size <= 24; size += 1) {
    const start = endIndex - size + 1
    if (start < 5) continue
    const range = candles.slice(start, endIndex + 1)
    const rangeHigh = Math.max(...range.map((candle) => candle.high))
    const rangeLow = Math.min(...range.map((candle) => candle.low))
    const height = rangeHigh - rangeLow
    if (height < atr * 0.35 || height > atr * 4.5) continue

    for (let index = start - 3; index >= Math.max(2, start - 100); index -= 1) {
      if (!isSwingAt(candles, index, levelKind) || !hasMeaningfulReaction(candles, index, levelKind, atr, start)) continue
      const level = levelKind === 'high' ? candles[index].high : candles[index].low
      const boundary = side === 'long' ? rangeHigh : rangeLow
      if (Math.abs(boundary - level) > atr * 0.5) continue

      const touches = range.filter((candle) => side === 'long'
        ? candle.high >= level - atr * 0.5 && candle.close <= level + atr * 0.3
        : candle.low <= level + atr * 0.5 && candle.close >= level - atr * 0.3).length
      // Один подтверждённый контакт с уровнем достаточен для пробойных сценариев:
      // после импульса рынок часто не успевает сформировать второе касание до выхода.
      if (!hasEnoughBreakoutLevelTouches(touches, minTouches)) continue

      const score = touches * 10 + size
      if (!best || score > best.score) best = { level, height, touches, endTime: candles[endIndex].time, score }
      break
    }
  }

  return best
}

export function hasEnoughBreakoutLevelTouches(touches: number, minTouches = 1): boolean {
  return touches >= minTouches
}

function findSignificantHourlyLevels(candles: Candle[], kind: 'high' | 'low'): SignificantHourlyLevel[] {
  const atr = calculateAtr(candles)
  if (!atr) return []
  const levels: SignificantHourlyLevel[] = []

  for (let index = candles.length - 3; index >= Math.max(2, candles.length - 100); index -= 1) {
    if (!isSwingAt(candles, index, kind)) continue
    const level = kind === 'high' ? candles[index].high : candles[index].low
    const after = candles.slice(index + 1)
    const reaction = kind === 'high'
      ? level - Math.min(...after.map((candle) => candle.low))
      : Math.max(...after.map((candle) => candle.high)) - level
    const reactionAtr = reaction / atr
    const touches = after.filter((candle) => kind === 'high'
      ? candle.high >= level - atr * 0.4 && candle.close <= level + atr * 0.25
      : candle.low <= level + atr * 0.4 && candle.close >= level - atr * 0.25).length
    const invalidatingCloses = after.filter((candle) => kind === 'high'
      ? candle.close > level + atr * 0.5
      : candle.close < level - atr * 0.5).length
    if ((touches < 1 && reactionAtr < 1) || invalidatingCloses > 2) continue
    if (!levels.some((candidate) => Math.abs(candidate.level - level) < atr * 0.2)) levels.push({ level, kind, touches, reactionAtr, time: candles[index].time })
  }

  return levels
}

type RetestLevel = HourlyRange & { side: 'long' | 'short' }

function findRecentFifteenMinuteRetestLevels(candles: Candle[]): RetestLevel[] {
  const atr = calculateAtr(candles)
  if (!atr) return []
  const levels: RetestLevel[] = []

  for (const [kind, side] of [['high', 'long'], ['low', 'short']] as const) {
    for (let index = candles.length - 3; index >= Math.max(2, candles.length - 100); index -= 1) {
      if (!isSwingAt(candles, index, kind)) continue
      const level = kind === 'high' ? candles[index].high : candles[index].low
      if (levels.some((candidate) => candidate.side === side && Math.abs(candidate.level - level) < atr * 0.15)) continue
      const reaction = kind === 'high'
        ? level - Math.min(...candles.slice(index + 1).map((candle) => candle.low))
        : Math.max(...candles.slice(index + 1).map((candle) => candle.high)) - level
      levels.push({
        side,
        level,
        height: Math.min(atr * 3, Math.max(atr * 1.25, reaction)),
        touches: 1,
        endTime: candles[index].time,
      })
    }
  }

  return levels
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

function hasFalseBreakoutConfirmation(candles: Candle[], sweepIndex: number, side: 'long' | 'short', level: number, atr: number): boolean {
  const confirmation = candles.slice(sweepIndex + 1)
  if (confirmation.length < 1 || confirmation.length > 4) return false
  const directionalCandles = confirmation.filter((candle) => side === 'long' ? candle.close > candle.open : candle.close < candle.open)
  const current = confirmation.at(-1)!
  const movedAway = side === 'long' ? current.close >= level + atr * 0.1 : current.close <= level - atr * 0.1
  const invalidated = confirmation.some((candle) => side === 'long'
    ? candle.close < level - atr * 0.5
    : candle.close > level + atr * 0.5)
  return directionalCandles.length >= 1 && (side === 'long' ? current.close > current.open : current.close < current.open) && movedAway && !invalidated
}

function buildFalseBreakoutTargets(entry: number, stopPrice: number, side: 'long' | 'short', candles: Candle[], hourlyCandles: Candle[], sweepIndex: number): TakeProfitLevel[] | undefined {
  const risk = side === 'long' ? entry - stopPrice : stopPrice - entry
  if (risk <= 0) return undefined
  const localTarget = findLastSwing(candles, side === 'long' ? 'high' : 'low', sweepIndex - 1)
  if (!localTarget) return undefined
  const firstReward = side === 'long' ? localTarget.price - entry : entry - localTarget.price
  if (firstReward < risk) return undefined

  const followUpTargets = findHourlyTargets(hourlyCandles, side, entry)
    .filter((price) => side === 'long' ? price > localTarget.price : price < localTarget.price)
  const selected = [localTarget.price, ...followUpTargets]
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
    for (let sweepIndex = lastIndex - 4; sweepIndex <= lastIndex - 2; sweepIndex += 1) {
      const sweep = candles[sweepIndex]
      const sweptAndClosedBack = side === 'long'
        ? sweep.low <= level.level - atr * 0.1 && sweep.close >= level.level - atr * 0.1
        : sweep.high >= level.level + atr * 0.1 && sweep.close <= level.level + atr * 0.1
      if (!sweptAndClosedBack || !hasFalseBreakoutConfirmation(candles, sweepIndex, side, level.level, atr)) continue

      const entry = candles.at(-1)!.close
      const stopPrice = side === 'long' ? sweep.low - atr * 0.25 : sweep.high + atr * 0.25
      const risk = side === 'long' ? entry - stopPrice : stopPrice - entry
      if (risk <= 0 || risk / atr > 3) continue
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
      }
    }
  }

  return null
}

export function calculateLevelBreakoutPlan(candles: Candle[], trend: OverallTrend, context?: LevelBreakoutContext): TradePlan | null {
  if (trend === 'flat' || candles.length < PERIOD + 5 || !context) return null

  const side = trend === 'strong-long' ? 'long' : 'short'
  const atr = calculateAtr(candles)
  const hourlyRange = findHourlyRangeBeforeBreakout(context.hourlyCandles, side)
  if (!atr || !hourlyRange) return null

  const entryCandle = candles.at(-1)!
  const previous = candles.at(-2)!
  const entry = entryCandle.close
  const threshold = atr * 0.1
  const brokeNow = side === 'long'
    ? entry > hourlyRange.level + threshold && previous.close <= hourlyRange.level + threshold && entryCandle.close >= entryCandle.open
    : entry < hourlyRange.level - threshold && previous.close >= hourlyRange.level - threshold && entryCandle.close <= entryCandle.open
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
    for (let secondIndex = candles.length - 1; secondIndex >= Math.max(16, candles.length - 40); secondIndex -= 1) {
      if (!isDivergencePivot(candles, secondIndex, kind)) continue
      const secondRsi = rsiAtPivot(candles, rsiByTime, secondIndex, kind)
      if (secondRsi === undefined) continue

      // Five to forty 1h candles retain the meaningful swing while admitting fast reversals.
      for (let firstIndex = secondIndex - 5; firstIndex >= Math.max(2, secondIndex - 40); firstIndex -= 1) {
        if (!isSwingAt(candles, firstIndex, kind)) continue
        const firstRsi = rsiAtPivot(candles, rsiByTime, firstIndex, kind)
        if (firstRsi === undefined) continue
        const hasDivergence = side === 'long'
          ? candles[secondIndex].low < candles[firstIndex].low - atr * 0.05 && secondRsi > firstRsi + 3
          : candles[secondIndex].high > candles[firstIndex].high + atr * 0.05 && secondRsi < firstRsi - 3
        if (hasDivergence) return { side, firstIndex, secondIndex, secondPrice: side === 'long' ? candles[secondIndex].low : candles[secondIndex].high }
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

function buildBreakoutRetestTargets(entry: number, stopPrice: number, side: 'long' | 'short', fifteenMinuteCandles: Candle[]): TakeProfitLevel[] | undefined {
  const risk = side === 'long' ? entry - stopPrice : stopPrice - entry
  if (risk <= 0) return undefined

  const direction = side === 'long' ? 1 : -1
  const firstTarget = entry + direction * risk * 3
  const secondTarget = findFifteenMinuteTargets(fifteenMinuteCandles, side, entry)
    .find((price) => side === 'long' ? price >= entry + direction * risk * 4 : price <= entry + direction * risk * 4)
  const prices = secondTarget === undefined ? [firstTarget] : [firstTarget, secondTarget]
  const shares = prices.length === 2 ? [50, 50] : [100]

  return prices.map((price, index) => ({
    id: `TP${index + 1}` as TakeProfitLevel['id'],
    price,
    share: shares[index],
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
    signalKey: `${divergenceCandles[divergence.firstIndex].time}:${divergenceTime}`,
  }
}

export function calculateBreakoutRetestPlan(candles: Candle[], _trend: OverallTrend, context?: LevelBreakoutContext): TradePlan | null {
  if (candles.length < PERIOD + 10 || !context?.fifteenMinuteCandles) return null
  const atr = calculateAtr(candles)
  if (!atr) return null

  const lastIndex = candles.length - 1
  const current = candles[lastIndex]
  for (const level of findRecentFifteenMinuteRetestLevels(context.fifteenMinuteCandles)) {
    const { side } = level
    let breakoutIndex = -1
    for (let index = lastIndex - 1; index >= Math.max(1, lastIndex - 144); index -= 1) {
      const candle = candles[index]
      const previous = candles[index - 1]
      const brokeLevel = side === 'long'
        ? candle.close > level.level + atr * 0.05 && previous.close <= level.level + atr * 0.05
        : candle.close < level.level - atr * 0.05 && previous.close >= level.level - atr * 0.05
      if (candle.time >= level.endTime && brokeLevel) {
        breakoutIndex = index
        break
      }
    }
    if (breakoutIndex < 0) continue

    let retestIndex = -1
    for (let index = lastIndex - 2; index > breakoutIndex; index -= 1) {
      const candle = candles[index]
      const isRetest = side === 'long'
        ? candle.low <= level.level + atr * 0.4 && candle.low >= level.level - atr * 0.5
        : candle.high >= level.level - atr * 0.4 && candle.high <= level.level + atr * 0.5
      if (isRetest) {
        retestIndex = index
        break
      }
    }
    if (retestIndex < 0 || retestIndex >= lastIndex) continue
    const responseCandles = candles.slice(retestIndex + 1)
    const hasReversal = responseCandles.some((candle) => side === 'long'
      ? candle.close > candle.open && candle.close >= level.level
      : candle.close < candle.open && candle.close <= level.level)
    const localExtreme = side === 'long'
      ? Math.max(...candles.slice(breakoutIndex, retestIndex + 1).map((candle) => candle.high))
      : Math.min(...candles.slice(breakoutIndex, retestIndex + 1).map((candle) => candle.low))
    const remainsBelowLocalExtreme = side === 'long'
      ? current.high < localExtreme && current.close >= level.level
      : current.low > localExtreme && current.close <= level.level
    if (!hasReversal || !remainsBelowLocalExtreme) continue

    const retest = candles[retestIndex]
    const stopPrice = side === 'long' ? retest.low - atr * 0.25 : retest.high + atr * 0.25
    const risk = side === 'long' ? current.close - stopPrice : stopPrice - current.close
    if (risk <= 0) continue

    const takeProfits = buildBreakoutRetestTargets(current.close, stopPrice, side, context.fifteenMinuteCandles)
    if (!takeProfits) continue

    return {
      setupType: 'breakout-retest',
      setupName: SETUP_META['breakout-retest'].name,
      setupNote: `Пробой 15m уровня ${level.level.toPrecision(6)} · 5m ретест с реакцией, до пробоя локального экстремума · TP1 3R, TP2 прошлый 15m уровень от 4R`,
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

export type TradePlansContext = TrendReclaimContext & Partial<DivergenceReversalContext>

export function calculateTradePlans(candles: Candle[], trend: OverallTrend, context?: TradePlansContext): TradePlan[] {
  return [
    context ? calculateTrendReclaimPlan(candles, context) : null,
    calculateLevelBreakoutPlan(candles, trend, context),
    calculateBreakoutRetestPlan(candles, trend, context),
    calculateFalseBreakoutPlan(candles, 'long', context),
    calculateFalseBreakoutPlan(candles, 'short', context),
    context?.fifteenMinuteCandles && context.fiveMinuteCandles ? calculateDivergenceReversalPlan(context as DivergenceReversalContext) : null,
  ].filter((plan): plan is TradePlan => Boolean(plan))
}
