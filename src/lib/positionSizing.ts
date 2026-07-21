export const STARTING_BALANCE_USDT = 50
export const RISK_PER_TRADE_USDT = 2

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
}

export type AccountSummary = {
  balance: number
  pnl: number
  closedTrades: number
}

/** Keeps the technical stop intact; the position size makes a stop equal $2 before fees. */
export function calculatePositionSizing(entry: number, stop: number, availableBalance: number): PositionSizing | undefined {
  const distance = Math.abs(entry - stop)
  if (!Number.isFinite(entry) || !Number.isFinite(stop) || entry <= 0 || distance <= 0 || availableBalance <= 0) return undefined

  const stopFraction = distance / entry
  const notional = RISK_PER_TRADE_USDT / stopFraction
  const leverage = Math.max(1, Math.ceil(notional / availableBalance))

  return {
    riskAmount: RISK_PER_TRADE_USDT,
    stopDistancePercent: stopFraction * 100,
    notional,
    quantity: notional / entry,
    leverage,
    margin: notional / leverage,
  }
}

export function calculateAccountSummary(outcomesR: Array<number | null | undefined>): AccountSummary {
  const closedTrades = outcomesR.filter((outcomeR): outcomeR is number => Number.isFinite(outcomeR)).length
  const pnl = outcomesR.reduce<number>((sum, outcomeR) => sum + (typeof outcomeR === 'number' && Number.isFinite(outcomeR) ? calculatePnlUsd(outcomeR) : 0), 0)
  return { balance: STARTING_BALANCE_USDT + pnl, pnl, closedTrades }
}
