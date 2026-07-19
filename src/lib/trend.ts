import type { Candle, Timeframe } from './bybit'

export type TrendDirection = 'bullish' | 'bearish' | 'flat'
export type OverallTrend = 'strong-long' | 'strong-short' | 'flat'
export type SetupType = 'trend-reclaim' | 'level-breakout'
export type SetupSignal = { type: SetupType; side: 'long' | 'short' }

export const SETUP_META: Record<SetupType, { shortName: string; name: string }> = {
  'trend-reclaim': { shortName: 'TR', name: 'Trend Reclaim' },
  'level-breakout': { shortName: 'LB', name: 'Level Breakout' },
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
  id: 'TP1' | 'TP2'
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
}

const FAST_EMA = 21
const SLOW_EMA = 55
const PERIOD = 14

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
  const allBullish = ordered.every((analysis) => analysis?.direction === 'bullish')
  const allBearish = ordered.every((analysis) => analysis?.direction === 'bearish')
  const weightedStrength = global.strength * 0.4 + confirmation.strength * 0.3 + local.strength * 0.2 + entry.strength * 0.1

  if (allBullish && global.strength >= 60 && confirmation.strength >= 50 && weightedStrength >= 55) return 'strong-long'
  if (allBearish && global.strength >= 60 && confirmation.strength >= 50 && weightedStrength >= 55) return 'strong-short'
  return 'flat'
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

export function calculateTradePlan(candles: Candle[], trend: OverallTrend): TradePlan | null {
  return calculateTrendReclaimPlan(candles, trend)
}

export function calculateTrendReclaimPlan(candles: Candle[], trend: OverallTrend): TradePlan | null {
  if (trend === 'flat' || candles.length < PERIOD + 8) return null

  const side = trend === 'strong-long' ? 'long' : 'short'
  const atr = calculateAtr(candles)
  const entry = candles.at(-1)!.close
  const pullback = findLastSwing(candles, side === 'long' ? 'low' : 'high')
  if (!pullback || !atr) return null

  const localTarget = findLastSwing(candles, side === 'long' ? 'high' : 'low', pullback.index - 1)
  if (!localTarget) return null

  const correction = side === 'long' ? localTarget.price - pullback.price : pullback.price - localTarget.price
  const correctionAtr = correction / atr
  if (correctionAtr < 0.5 || correctionAtr > 3) return null

  const previous = candles.at(-2)!
  const reversalConfirmed = side === 'long'
    ? entry > previous.high && candles.at(-1)!.close > candles.at(-1)!.open
    : entry < previous.low && candles.at(-1)!.close < candles.at(-1)!.open
  if (!reversalConfirmed) return null

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
    setupNote: `Коррекция остановлена · ${correctionAtr.toFixed(1)} ATR`,
    stop,
    takeProfits: [
      { id: 'TP1', price: localTarget.price, share: 50, riskMultiple: rewardToTarget / risk },
      { id: 'TP2', price: entry + direction * risk * 3, share: 50, riskMultiple: 3 },
    ],
  }
}

const CONSOLIDATION_CANDLES = 5

export function calculateLevelBreakoutPlan(candles: Candle[], trend: OverallTrend): TradePlan | null {
  if (trend === 'flat' || candles.length < PERIOD + CONSOLIDATION_CANDLES + 8) return null

  const side = trend === 'strong-long' ? 'long' : 'short'
  const atr = calculateAtr(candles)
  if (!atr) return null

  const consolidation = candles.slice(-CONSOLIDATION_CANDLES)
  const rangeHigh = Math.max(...consolidation.map((candle) => candle.high))
  const rangeLow = Math.min(...consolidation.map((candle) => candle.low))
  const range = rangeHigh - rangeLow
  const rangeAtr = range / atr
  if (rangeAtr <= 0 || rangeAtr > 1.5) return null

  const level = findLastSwing(candles, side === 'long' ? 'high' : 'low', candles.length - CONSOLIDATION_CANDLES - 2)
  if (!level) return null

  const entryCandle = candles.at(-1)!
  const entry = entryCandle.close
  const volumeBefore = candles.slice(-(CONSOLIDATION_CANDLES + 20), -CONSOLIDATION_CANDLES)
  const averageBefore = volumeBefore.reduce((sum, candle) => sum + candle.volume, 0) / volumeBefore.length
  const averageConsolidation = consolidation.reduce((sum, candle) => sum + candle.volume, 0) / consolidation.length
  if (averageBefore && averageConsolidation < averageBefore) return null

  const nearLevel = side === 'long'
    ? level.price >= rangeHigh && level.price - rangeHigh <= atr * 0.6
    : level.price <= rangeLow && rangeLow - level.price <= atr * 0.6
  const holdsNearEdge = side === 'long'
    ? entry >= rangeLow + range * 0.6 && entryCandle.close >= entryCandle.open
    : entry <= rangeHigh - range * 0.6 && entryCandle.close <= entryCandle.open
  if (!nearLevel || !holdsNearEdge) return null

  const buffer = atr * 0.25
  const stopPrice = side === 'long' ? rangeLow - buffer : rangeHigh + buffer
  const risk = side === 'long' ? entry - stopPrice : stopPrice - entry
  if (risk <= 0) return null

  const direction = side === 'long' ? 1 : -1
  return {
    setupType: 'level-breakout',
    setupName: SETUP_META['level-breakout'].name,
    setupNote: `Наторговка перед уровнем ${level.price.toPrecision(6)} · диапазон ${rangeAtr.toFixed(1)} ATR`,
    stop: {
      side,
      entry,
      price: stopPrice,
      distancePercent: (risk / entry) * 100,
      distanceAtr: risk / atr,
    },
    takeProfits: [
      { id: 'TP1', price: entry + direction * risk * 1.5, share: 50, riskMultiple: 1.5 },
      { id: 'TP2', price: entry + direction * risk * 3, share: 50, riskMultiple: 3 },
    ],
  }
}

export function calculateTradePlans(candles: Candle[], trend: OverallTrend): TradePlan[] {
  return [calculateTrendReclaimPlan(candles, trend), calculateLevelBreakoutPlan(candles, trend)].filter((plan): plan is TradePlan => Boolean(plan))
}
