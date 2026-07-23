export const STARTING_BALANCE_USDT = 100
export const RISK_PER_TRADE_USDT = 2
export const MAX_OPEN_POSITIONS = 3
export const PREFERRED_CONCURRENT_POSITIONS = 2
export const MAX_SAFE_LEVERAGE = 100
export const LIQUIDATION_SAFETY_MULTIPLIER = 1.5

export type AccountSummary = {
  balance: number
  equity: number
  lockedMargin: number
  pnl: number
  closedTrades: number
}

export function calculateAccountSummary(outcomesR: Array<number | null | undefined>, openMargins: Array<number | null | undefined> = []): AccountSummary {
  return calculateAccountSummaryFromPnl(outcomesR.map((outcomeR) => typeof outcomeR === 'number' && Number.isFinite(outcomeR) ? outcomeR * RISK_PER_TRADE_USDT : null), openMargins)
}

export function calculateAccountSummaryFromPnl(pnlsUsd: Array<number | null | undefined>, openMargins: Array<number | null | undefined> = []): AccountSummary {
  const closedTrades = pnlsUsd.filter((pnl): pnl is number => Number.isFinite(pnl)).length
  const pnl = pnlsUsd.reduce((sum, value) => sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0), 0)
  const equity = STARTING_BALANCE_USDT + pnl
  const lockedMargin = openMargins.reduce((sum, margin) => sum + (typeof margin === 'number' && Number.isFinite(margin) && margin > 0 ? margin : 0), 0)
  return { balance: Math.max(0, equity - lockedMargin), equity, lockedMargin, pnl, closedTrades }
}

export function calculatePositionSizing(entry: number, stop: number, availableBalance: number, accountEquity = availableBalance) {
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
