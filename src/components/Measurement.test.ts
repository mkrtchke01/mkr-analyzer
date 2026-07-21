import { describe, expect, it } from 'vitest'
import { calculateMeasurement } from './Measurement'

describe('chart measurement', () => {
  it('calculates signed price movement, percentage and candle count', () => {
    expect(calculateMeasurement({ start: { price: 100, time: 300 }, end: { price: 105, time: 1_200 } }, 300)).toEqual({ priceChange: 5, percentChange: 5, candles: 3 })
  })

  it('keeps a negative move and rounds the elapsed candles', () => {
    expect(calculateMeasurement({ start: { price: 200, time: 0 }, end: { price: 190, time: 740 } }, 300)).toEqual({ priceChange: -10, percentChange: -5, candles: 2 })
  })
})
