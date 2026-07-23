import { describe, expect, it } from 'vitest'
import { distanceToSegment, extrapolateChartTime, isNearPoint } from './DrawingEditor'

describe('drawing editor geometry', () => {
  it('finds the distance from a line segment and its endpoints', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3)
    expect(distanceToSegment({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5)
    expect(isNearPoint({ x: 4, y: 4 }, { x: 0, y: 0 }, 6)).toBe(true)
  })

  it('extrapolates a timestamp when a pointer is past the final candle', () => {
    expect(extrapolateChartTime(null, 140, { time: 1_000, x: 100 }, { time: 900, x: 80 })).toBe(1_200)
    expect(extrapolateChartTime(950, 140, { time: 1_000, x: 100 }, { time: 900, x: 80 })).toBe(950)
  })
})
