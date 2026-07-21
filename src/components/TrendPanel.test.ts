import { describe, expect, it } from 'vitest'
import { clipboardPriceValue } from './TrendPanel'

describe('trade-plan clipboard price', () => {
  it('copies the displayed precision without a thousands separator', () => {
    expect(clipboardPriceValue(1941.66)).toBe('1941.66')
    expect(clipboardPriceValue(0.02944)).toBe('0.02944')
  })
})
