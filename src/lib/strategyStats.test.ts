import { describe, expect, it } from 'vitest'
import { calculateStrategyStats } from './strategyStats'

describe('strategy statistics', () => {
  it('separates live, stopped and target-closed trades and sums dollar PnL', () => {
    const result = calculateStrategyStats([
      { setupType: 'breakout-retest', status: 'active', outcomeR: null },
      { setupType: 'breakout-retest', status: 'stop', outcomeR: -1 },
      { setupType: 'breakout-retest', status: 'tp2', outcomeR: 2.25 },
      { setupType: 'trend-reclaim', status: 'tp1', tp2Price: 110, outcomeR: 1 },
    ])

    expect(result.find((item) => item.strategyId === 'breakout-retest')).toMatchObject({ total: 3, open: 1, stopped: 1, profitable: 1, pnl: 2.5 })
    expect(result.find((item) => item.strategyId === 'trend-reclaim')).toMatchObject({ total: 1, open: 1, pnl: 0 })
  })

  it('groups bullish and bearish RSI divergence signals under one scanner strategy', () => {
    const result = calculateStrategyStats([
      { setupType: 'bottom-reversal', status: 'active', outcomeR: null },
      { setupType: 'top-reversal', status: 'stop', outcomeR: -1 },
    ])

    expect(result.find((item) => item.strategyId === 'divergence')).toMatchObject({ total: 2, open: 1, stopped: 1, pnl: -2 })
  })
})
