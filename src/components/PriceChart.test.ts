import { describe, expect, it, vi } from 'vitest'
import { enableInitialVerticalPanning } from './PriceChart'

describe('PriceChart options', () => {
  it('allows vertical panning as soon as the chart opens', () => {
    const applyOptions = vi.fn()
    const priceScale = vi.fn(() => ({ applyOptions }))

    enableInitialVerticalPanning({ priceScale } as never)

    expect(priceScale).toHaveBeenCalledWith('right')
    expect(applyOptions).toHaveBeenCalledWith({ autoScale: false })
  })
})
