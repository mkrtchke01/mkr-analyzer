import { describe, expect, it } from 'vitest'
import { calculateAccountSummary, calculatePnlUsd, calculatePositionSizing } from './positionSizing'

describe('position sizing', () => {
  it('sizes the notional so a technical stop risks exactly $2', () => {
    expect(calculatePositionSizing(100, 95, 50)).toMatchObject({
      riskAmount: 2,
      stopDistancePercent: 5,
      notional: 40,
      quantity: 0.4,
      leverage: 1,
      margin: 40,
    })
  })

  it('uses the minimum whole-number leverage required by the current balance', () => {
    expect(calculatePositionSizing(100, 99, 50)).toMatchObject({ notional: 200, leverage: 4, margin: 50 })
  })

  it('updates the virtual balance from closed trade results in R', () => {
    expect(calculateAccountSummary([3, -1, null, 0.5])).toEqual({ balance: 55, pnl: 5, closedTrades: 3 })
  })

  it('converts a closed trade result to its fixed-risk dollar PnL', () => {
    expect(calculatePnlUsd(-1)).toBe(-2)
    expect(calculatePnlUsd(2.25)).toBe(4.5)
  })
})
