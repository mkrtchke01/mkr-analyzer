export const STARTING_BALANCE_USDT = 50
export const RISK_PER_TRADE_USDT = 2
export const MAX_OPEN_POSITIONS = 3
export const PREFERRED_CONCURRENT_POSITIONS = 2
export const MAX_SAFE_LEVERAGE = 100
export const LIQUIDATION_SAFETY_MULTIPLIER = 1.5

/** Converts a finished trade result from R to its fixed-risk USD equivalent. */
export function calculatePnlUsd(outcomeR: number): number {
  return outcomeR * RISK_PER_TRADE_USDT
}

export type PositionSizing = {
  riskAmount: number
  stopDistancePercent: number
  notional: number
  quantity: number
  leverage: number
  margin: number
  marginBudget: number
  liquidationDistancePercent: number
}

export type AccountSummary = {
  balance: number
  equity: number
  lockedMargin: number
  pnl: number
  closedTrades: number
}

/**
 * Keeps the technical stop intact while choosing the highest safe leverage.
 * The estimated liquidation distance stays at least 1.5× farther than the stop,
 * and the margin is capped so two larger or three smaller positions can coexist.
 */
export function calculatePositionSizing(entry: number, stop: number, availableBalance: number, accountEquity = availableBalance): PositionSizing | undefined {
  const distance = Math.abs(entry - stop)
  if (!Number.isFinite(entry) || !Number.isFinite(stop) || entry <= 0 || distance <= 0 || availableBalance <= 0) return undefined

  const stopFraction = distance / entry
  const notional = RISK_PER_TRADE_USDT / stopFraction
  const safeLeverage = Math.floor(1 / (stopFraction * LIQUIDATION_SAFETY_MULTIPLIER))
  const leverage = Math.max(1, Math.min(MAX_SAFE_LEVERAGE, safeLeverage))
  const margin = notional / leverage
  const marginBudget = Math.min(availableBalance, accountEquity / PREFERRED_CONCURRENT_POSITIONS)
  if (margin > marginBudget) return undefined

  return {
    riskAmount: RISK_PER_TRADE_USDT,
    stopDistancePercent: stopFraction * 100,
    notional,
    quantity: notional / entry,
    leverage,
    margin,
    marginBudget,
    liquidationDistancePercent: 100 / leverage,
  }
}

export function calculateAccountSummary(outcomesR: Array<number | null | undefined>, openMargins: Array<number | null | undefined> = []): AccountSummary {
  return calculateAccountSummaryFromPnl(outcomesR.map((outcomeR) => typeof outcomeR === 'number' && Number.isFinite(outcomeR) ? calculatePnlUsd(outcomeR) : null), openMargins)
}

export function calculateAccountSummaryFromPnl(pnlsUsd: Array<number | null | undefined>, openMargins: Array<number | null | undefined> = []): AccountSummary {
  const closedTrades = pnlsUsd.filter((pnl): pnl is number => Number.isFinite(pnl)).length
  const pnl = pnlsUsd.reduce<number>((sum, value) => sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0), 0)
  const equity = STARTING_BALANCE_USDT + pnl
  const lockedMargin = openMargins.reduce<number>((sum, margin) => sum + (typeof margin === 'number' && Number.isFinite(margin) && margin > 0 ? margin : 0), 0)
  return { balance: Math.max(0, equity - lockedMargin), equity, lockedMargin, pnl, closedTrades }
}
