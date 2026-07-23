import { describe, expect, it } from 'vitest'
import { clipboardPriceValue, overallTrendLabel } from './TrendPanel'

describe('trade-plan clipboard price', () => {
  it('copies the displayed precision without a thousands separator', () => {
    expect(clipboardPriceValue(1941.66)).toBe('1941.66')
    expect(clipboardPriceValue(0.02944)).toBe('0.02944')
  })
})

describe('overall trend label', () => {
  it('includes the final trend strength', () => {
    expect(overallTrendLabel('strong-long', 53)).toBe('LONG / КОНТЕКСТ · 53/100')
  })
})
