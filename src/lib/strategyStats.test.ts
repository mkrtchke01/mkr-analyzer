import { describe, expect, it } from 'vitest'
import { calculateStrategyStats } from './strategyStats'

describe('strategy statistics', () => {
  it('summarizes only trend-reclaim trades', () => {
    const result = calculateStrategyStats([
      { setupType: 'trend-reclaim', status: 'active', outcomeR: null },
      { setupType: 'trend-reclaim', status: 'stop', outcomeR: -1 },
      { setupType: 'trend-reclaim', status: 'tp2', outcomeR: 2.25 },
      { setupType: 'breakout-retest', status: 'tp1', outcomeR: 1 },
    ])

    expect(result).toEqual([expect.objectContaining({ strategyId: 'trend-reclaim', total: 3, open: 1, stopped: 1, profitable: 1, pnl: 2.5 })])
  })

  it('starts the sole strategy with zero values when there are no trend-reclaim signals', () => {
    const result = calculateStrategyStats([
      { setupType: 'bottom-reversal', status: 'active', outcomeR: null },
      { setupType: 'top-reversal', status: 'stop', outcomeR: -1 },
    ])

    expect(result).toEqual([expect.objectContaining({ strategyId: 'trend-reclaim', total: 0, open: 0, stopped: 0, profitable: 0, pnl: 0 })])
  })

  it('uses net dollar PnL when the server has deducted fees', () => {
    const result = calculateStrategyStats([
      { setupType: 'trend-reclaim', status: 'tp1', outcomeR: 1.5, netPnlUsd: 2.44 },
    ])

    expect(result).toEqual([expect.objectContaining({ strategyId: 'trend-reclaim', total: 1, profitable: 1, pnl: 2.44 })])
  })
})
