import type { SignalStrength, TradePlan, TrendAnalysis } from './trend.js'

const DIRECTION_BY_SIDE = { long: 'bullish', short: 'bearish' } as const
const CONTEXT_WEIGHTS = { '4h': 1.3, '1h': 1, '15m': 0.7 } as const

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function patternScore(plan: TradePlan) {
  return plan.setupType === 'trend-reclaim' ? 0.7 : 0
}

function rewardScore(plan: TradePlan) {
  const bestTarget = Math.max(...plan.takeProfits.map((target) => target.riskMultiple))
  if (bestTarget >= 6) return 2
  if (bestTarget >= 4) return 1.5
  if (bestTarget >= 3) return 1.1
  if (bestTarget >= 2) return 0.7
  return 0.3
}

function entryScore(plan: TradePlan) {
  const distanceAtr = plan.stop.distanceAtr
  if (distanceAtr === undefined || !Number.isFinite(distanceAtr)) return 0.5
  if (distanceAtr >= 0.25 && distanceAtr <= 1.5) return 1
  if (distanceAtr >= 0.15 && distanceAtr <= 2) return 0.65
  return 0.3
}

/** Fixed 1–10 score calculated only at setup confirmation. */
export function calculateSignalStrength(plan: TradePlan, analyses: TrendAnalysis[]): SignalStrength {
  const expectedDirection = DIRECTION_BY_SIDE[plan.stop.side]
  const contextAnalyses = analyses.filter((analysis): analysis is TrendAnalysis & { timeframe: keyof typeof CONTEXT_WEIGHTS } => analysis.timeframe in CONTEXT_WEIGHTS)
  const context = contextAnalyses.reduce((sum, analysis) => sum + (analysis.direction === expectedDirection ? CONTEXT_WEIGHTS[analysis.timeframe] : 0), 0)
  const trend = contextAnalyses.length
    ? clamp(contextAnalyses.reduce((sum, analysis) => sum + analysis.strength, 0) / contextAnalyses.length / 50, 0, 2)
    : 0
  const reward = rewardScore(plan)
  const entry = entryScore(plan)
  const pattern = patternScore(plan)
  const score = Math.round(clamp(1 + context + trend + reward + entry + pattern, 1, 10))

  return { score, context, trend, reward, entry, pattern }
}
