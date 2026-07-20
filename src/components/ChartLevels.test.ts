import { describe, expect, it } from 'vitest'
import { getLevelStartX } from './ChartLevels'

describe('manual chart levels', () => {
  it('shows the visible part of a level that started before the loaded chart history', () => {
    expect(getLevelStartX(null)).toBe(0)
    expect(getLevelStartX(124)).toBe(124)
  })
})
