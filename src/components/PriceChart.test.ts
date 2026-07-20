import { describe, expect, it, vi } from 'vitest'
import type { Time } from 'lightweight-charts'
import { enableInitialVerticalPanning, fitChartHistory, manualLevelFromChartPoint, resetPriceScaleForNewCandles } from './PriceChart'

describe('PriceChart options', () => {
  it('allows vertical panning as soon as the chart opens', () => {
    const applyOptions = vi.fn()
    const priceScale = vi.fn(() => ({ applyOptions }))

    enableInitialVerticalPanning({ priceScale } as never)

    expect(priceScale).toHaveBeenCalledWith('right')
    expect(applyOptions).toHaveBeenCalledWith({ autoScale: false })
  })

  it('fits the new timeframe before enabling vertical panning again', () => {
    const applyOptions = vi.fn()
    const priceScale = vi.fn(() => ({ applyOptions }))

    resetPriceScaleForNewCandles({ priceScale } as never)

    expect(priceScale).toHaveBeenCalledWith('right')
    expect(applyOptions).toHaveBeenCalledWith({ autoScale: true })
  })

  it('keeps the clicked candle time and price for a manual level', () => {
    expect(manualLevelFromChartPoint(64_059.6, 1_720_000_000 as Time)).toEqual({
      price: 64_059.6,
      time: 1_720_000_000,
    })
  })

  it('fits the full loaded history into the chart', () => {
    const fitContent = vi.fn()

    fitChartHistory({ timeScale: () => ({ fitContent }) } as never)

    expect(fitContent).toHaveBeenCalledOnce()
  })
})
