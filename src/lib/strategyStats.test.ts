import { describe, expect, it } from 'vitest'
import { calculateStrategyStats } from './strategyStats'

describe('strategy statistics', () => {
  it('does not calculate statistics when all strategies are disabled', () => {
    const result = calculateStrategyStats([
      { setupType: 'trend-reclaim', status: 'active', outcomeR: null },
      { setupType: 'trend-reclaim', status: 'stop', outcomeR: -1 },
      { setupType: 'trend-reclaim', status: 'tp2', outcomeR: 2.25 },
      { setupType: 'breakout-retest', status: 'tp1', outcomeR: 1 },
    ])

    expect(result).toEqual([])
  })

  it('does not expose empty rows for disabled strategies', () => {
    const result = calculateStrategyStats([
      { setupType: 'bottom-reversal', status: 'active', outcomeR: null },
      { setupType: 'top-reversal', status: 'stop', outcomeR: -1 },
    ])

    expect(result).toEqual([])
  })

  it('does not retain PnL for disabled strategies', () => {
    const result = calculateStrategyStats([
      { setupType: 'trend-reclaim', status: 'tp1', outcomeR: 1.5, netPnlUsd: 2.44 },
    ])

    expect(result).toEqual([])
  })
})
