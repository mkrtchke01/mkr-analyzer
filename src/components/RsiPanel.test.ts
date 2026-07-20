import { describe, expect, it } from 'vitest'
import { rsiPath } from './RsiPanel'

describe('rsiPath', () => {
  it('aligns the first RSI value with its candle in the full chart history', () => {
    expect(rsiPath([{ time: 3, value: 70 }, { time: 4, value: 30 }], 4)).toBe('M 66.667 30.000 L 100.000 70.000')
  })

  it('maps RSI points to the currently visible candle range', () => {
    expect(rsiPath([{ time: 3, value: 70 }, { time: 4, value: 30 }], 4, { from: 1, to: 3 })).toBe('M 50.000 30.000 L 100.000 70.000')
  })
})
