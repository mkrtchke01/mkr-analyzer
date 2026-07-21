import { describe, expect, it } from 'vitest'
import { getLevelEndX, getLevelStartX } from './ChartLevels'

describe('manual chart levels', () => {
  it('shows the visible part of a level that started before the loaded chart history', () => {
    expect(getLevelStartX(null)).toBe(0)
    expect(getLevelStartX(124)).toBe(124)
  })

  it('extends an entry line to the right chart edge', () => {
    expect(getLevelEndX({ endTime: 1, endX: 124, extendRight: true }, 640)).toBe(640)
    expect(getLevelEndX({ endTime: 1, endX: 124 }, 640)).toBe(124)
  })
})
