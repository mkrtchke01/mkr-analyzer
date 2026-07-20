import { describe, expect, it } from 'vitest'
import { createRiskRewardBox, getRiskRewardHandle } from './RiskReward'

describe('risk reward controls', () => {
  it('selects the nearest TP or SL handle for vertical resizing', () => {
    expect(getRiskRewardHandle(102, [
      { id: 'risk-1', target: 'takeProfit', y: 98 },
      { id: 'risk-1', target: 'stopLoss', y: 170 },
    ])).toEqual({ id: 'risk-1', target: 'takeProfit', y: 98 })
  })

  it('creates the opposite boundary with a 1:3 risk-reward ratio', () => {
    expect(createRiskRewardBox('long', { price: 100, time: 10 }, { price: 112, time: 20 })).toMatchObject({
      entry: 100,
      takeProfit: 112,
      stopLoss: 96,
    })
    const short = createRiskRewardBox('short', { price: 100, time: 10 }, { price: 96, time: 20 })
    expect(short).toMatchObject({ entry: 100, takeProfit: 96 })
    expect(short?.stopLoss).toBeCloseTo(101.333333)
  })
})
