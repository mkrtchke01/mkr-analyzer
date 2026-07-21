import { describe, expect, it } from 'vitest'
import { calculateAccountSummary, calculatePnlUsd, calculatePositionSizing } from './positionSizing'

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
    expect(calculateAccountSummary([3, -1, null, 0.5], [12, 8])).toEqual({ balance: 35, equity: 55, lockedMargin: 20, pnl: 5, closedTrades: 3 })
  })

  it('converts a closed trade result to its fixed-risk dollar PnL', () => {
    expect(calculatePnlUsd(-1)).toBe(-2)
    expect(calculatePnlUsd(2.25)).toBe(4.5)
  })
})
