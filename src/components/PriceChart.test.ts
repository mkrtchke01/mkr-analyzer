import { describe, expect, it, vi } from 'vitest'
import { CrosshairMode, type Time } from 'lightweight-charts'
import { enableInitialVerticalPanning, entryLevelFromTradePlan, fitChartHistory, focusChartOnTime, freeCrosshairOptions, manualLevelFromChartPoint, resetPriceScaleForNewCandles } from './PriceChart'

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
      endPrice: 64_059.6,
      endTime: 1_720_000_000,
    })
  })

  it('draws an entry line from the signal candle through the right chart edge', () => {
    expect(entryLevelFromTradePlan({
      setupType: 'breakout-retest',
      setupName: 'Пробой + ретест',
      setupNote: 'Тест',
      entryTime: 1_720_000_300,
      stop: { side: 'long', entry: 100 },
      takeProfits: [],
    }, '15m')).toEqual(expect.objectContaining({
      time: 1_719_999_900,
      endTime: 1_719_999_900,
      price: 100,
      endPrice: 100,
      extendRight: true,
      lineWidth: 1,
      dashed: true,
    }))
  })

  it('keeps the crosshair freely under the cursor instead of snapping it to candles', () => {
    expect(freeCrosshairOptions).toEqual({ mode: CrosshairMode.Normal })
  })

  it('fits the full loaded history into the chart', () => {
    const fitContent = vi.fn()

    fitChartHistory({ timeScale: () => ({ fitContent }) } as never)

    expect(fitContent).toHaveBeenCalledOnce()
  })

  it('focuses the chart around a requested divergence time', () => {
    const setVisibleRange = vi.fn()

    focusChartOnTime({ timeScale: () => ({ setVisibleRange }) } as never, '4h', 1_720_000_000)

    expect(setVisibleRange).toHaveBeenCalledWith({ from: 1_719_136_000, to: 1_720_864_000 })
  })
})
