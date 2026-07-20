import { describe, expect, it } from 'vitest'
import { rsiDivergencePath, rsiPath } from './RsiPanel'

describe('rsiPath', () => {
  it('aligns the first RSI value with its candle in the full chart history', () => {
    expect(rsiPath([{ time: 3, value: 70 }, { time: 4, value: 30 }], 4)).toBe('M 66.667 30.000 L 100.000 70.000')
  })

  it('maps RSI points to the currently visible candle range', () => {
    expect(rsiPath([{ time: 3, value: 70 }, { time: 4, value: 30 }], 4, { from: 1, to: 3 })).toBe('M 50.000 30.000 L 100.000 70.000')
  })

  it('draws a divergence between the RSI pivots that generated the signal', () => {
    const points = [{ time: 1, value: 30 }, { time: 2, value: 40 }, { time: 3, value: 35 }, { time: 4, value: 50 }]
    const divergence = { first: { priceTime: 1, price: 100, rsiTime: 1, rsiValue: 30 }, second: { priceTime: 3, price: 90, rsiTime: 3, rsiValue: 35 } }
    expect(rsiDivergencePath(points, 4, divergence)).toBe('M 0.000 70.000 L 66.667 65.000')
  })
})
