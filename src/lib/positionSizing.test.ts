import { describe, expect, it } from 'vitest'
import { calculateAccountSummary, calculateAccountSummaryFromPnl, calculatePnlUsd, calculatePositionSizing } from './positionSizing'

describe('position sizing', () => {
  it('sizes the notional so a technical stop risks exactly $2 with liquidation beyond the stop', () => {
    expect(calculatePositionSizing(100, 95, 50)).toMatchObject({
      riskAmount: 2,
      stopDistancePercent: 5,
      notional: 40,
      quantity: 0.4,
      leverage: 13,
      margin: 40 / 13,
      liquidationDistancePercent: 100 / 13,
    })
  })

  it('uses the highest safe leverage while fitting a two-position margin budget', () => {
    expect(calculatePositionSizing(100, 99, 50)).toMatchObject({ notional: 200, leverage: 66, margin: 200 / 66, marginBudget: 25 })
  })

  it('does not create a position when its safe margin exceeds the remaining balance', () => {
    expect(calculatePositionSizing(100, 99.9, 10, 50)).toBeUndefined()
  })

  it('reserves open-trade margin from the available balance', () => {
    expect(calculateAccountSummary([3, -1, null, 0.5], [12, 8])).toEqual({ balance: 85, equity: 105, lockedMargin: 20, pnl: 5, closedTrades: 3 })
  })

  it('converts a closed trade result to its fixed-risk dollar PnL', () => {
    expect(calculatePnlUsd(-1)).toBe(-2)
    expect(calculatePnlUsd(2.25)).toBe(4.5)
  })

  it('can use already netted dollar PnL in the account balance', () => {
    const account = calculateAccountSummaryFromPnl([3.45, -2.55], [10])
    expect(account).toMatchObject({ balance: 90.9, lockedMargin: 10, closedTrades: 2 })
    expect(account.equity).toBeCloseTo(100.9, 6)
    expect(account.pnl).toBeCloseTo(0.9, 6)
  })
})
