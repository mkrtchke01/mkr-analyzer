import { describe, expect, it } from 'vitest'
import { calculateRsi, calculateRsiSma } from './rsi'

const candles = (closes: number[]) => closes.map((close, index) => ({ time: index + 1, open: close, high: close, low: close, close, volume: 0 }))

describe('calculateRsi', () => {
  it('requires a full period before returning a value', () => {
    expect(calculateRsi(candles([1, 2, 3]), 3)).toEqual([])
  })

  it('returns 100 for an uninterrupted rise and 0 for an uninterrupted fall', () => {
    expect(calculateRsi(candles([1, 2, 3, 4]), 3)).toEqual([{ time: 4, value: 100 }])
    expect(calculateRsi(candles([4, 3, 2, 1]), 3)).toEqual([{ time: 4, value: 0 }])
  })

  it('returns 50 for an unchanged price', () => {
    expect(calculateRsi(candles([10, 10, 10, 10]), 3)).toEqual([{ time: 4, value: 50 }])
  })

  it('calculates the RSI moving average used by TradingView', () => {
    expect(calculateRsiSma([{ time: 1, value: 20 }, { time: 2, value: 40 }, { time: 3, value: 70 }], 2)).toEqual([
      { time: 2, value: 30 },
      { time: 3, value: 55 },
    ])
  })
})
