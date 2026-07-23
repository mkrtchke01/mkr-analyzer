import { describe, expect, it } from 'vitest'
import { fibonacciLevels } from './Fibonacci'

describe('fibonacciLevels', () => {
  it('builds standard retracement levels between two ascending points', () => {
    const levels = fibonacciLevels({
      id: 'fib-1',
      start: { price: 100, time: 10 },
      end: { price: 200, time: 20 },
    })

    expect(levels.map(({ price }) => price)).toEqual([100, 138.2, 150, 161.8, 200])
    expect(levels.every(({ time, endTime }) => time === 10 && endTime === 20)).toBe(true)
  })

  it('keeps the direction selected on the chart for descending points', () => {
    const levels = fibonacciLevels({
      id: 'fib-2',
      start: { price: 200, time: 10 },
      end: { price: 100, time: 20 },
    })

    expect(levels[3].price).toBeCloseTo(138.2)
  })
})
