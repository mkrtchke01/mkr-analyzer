import { describe, expect, it } from 'vitest'
import type { Candle } from './bybit'
import { getMarketInfo, marketInfoText } from './marketInfo'

const baseCandles = (): Candle[] => Array.from({ length: 100 }, (_, index) => ({ time: index, open: 100, high: 101, low: 99, close: 100, volume: 100 }))
const setCandle = (candles: Candle[], index: number, open: number, high: number, low: number, close: number) => { candles[index] = { time: index, open, high, low, close, volume: 100 } }

const breakoutCandles = () => {
  const candles = baseCandles()
  setCandle(candles, 85, 109, 110.2, 108, 109.5)
  setCandle(candles, 90, 108, 110, 107, 109)
  setCandle(candles, 91, 100, 101, 99, 100)
  setCandle(candles, 92, 100, 101, 99, 100)
  setCandle(candles, 96, 109.8, 110.1, 109.2, 109.6)
  setCandle(candles, 97, 110, 113, 109.8, 112)
  setCandle(candles, 98, 112, 113, 111.1, 112)
  setCandle(candles, 99, 112, 113, 111.2, 112.4)
  return candles
}

describe('market info signals', () => {
  it('reports a fresh breakout and a retest of the broken level', () => {
    expect(getMarketInfo(breakoutCandles(), '15m')).toContainEqual({ type: 'breakout', side: 'bullish', timeframe: '15m' })

    const retest = breakoutCandles()
    setCandle(retest, 98, 111, 112, 110.2, 111)
    expect(getMarketInfo(retest, '15m')).toContainEqual({ type: 'retest', side: 'bullish', timeframe: '15m' })
  })

  it('reports consolidation directly below a prior resistance', () => {
    const candles = baseCandles()
    setCandle(candles, 90, 109, 110.5, 108, 110)
    setCandle(candles, 91, 100, 101, 99, 100)
    setCandle(candles, 92, 100, 101, 99, 100)
    for (let index = 94; index < 100; index += 1) setCandle(candles, index, 109.8, 110, 109.3, 109.8)

    expect(getMarketInfo(candles, '1h')).toContainEqual({ type: 'consolidation', side: 'bullish', timeframe: '1h' })
  })

  it('reports a Fibonacci-sized correction after a strong impulse', () => {
    const candles = baseCandles()
    setCandle(candles, 60, 100, 101, 98, 100)
    setCandle(candles, 61, 101, 102, 99, 101)
    setCandle(candles, 74, 118, 119, 117, 118)
    setCandle(candles, 75, 119, 120, 118, 119)
    for (let index = 76; index < 95; index += 1) {
      const close = 118 - (index - 76) * 0.45
      setCandle(candles, index, close + 0.1, close + 1, close - 1, close)
    }
    setCandle(candles, 95, 110, 111, 109, 110)
    setCandle(candles, 96, 110, 111, 109.5, 110.2)
    setCandle(candles, 97, 110.2, 111, 109.7, 110.1)
    setCandle(candles, 98, 110.1, 111, 109.8, 110.3)
    setCandle(candles, 99, 110.3, 111, 109.9, 110.2)

    expect(getMarketInfo(candles, '4h')).toContainEqual({ type: 'impulse-correction', side: 'bullish', timeframe: '4h' })
  })

  it('writes the requested text for every Info event', () => {
    expect(marketInfoText({ type: 'bullish-divergence', side: 'bullish', timeframe: '1h' })).toBe('Обнаружена бычья дивергенция на 1h таймфрейме')
    expect(marketInfoText({ type: 'breakout', side: 'bullish', timeframe: '15m' })).toBe('Монета пробила уровень на 15m таймфрейме')
    expect(marketInfoText({ type: 'consolidation', side: 'bearish', timeframe: '4h' })).toBe('Монета проторговывается перед пробитием уровня на 4h таймфрейме')
    expect(marketInfoText({ type: 'retest', side: 'bullish', timeframe: '1h' })).toBe('Монета пробила уровень и ретестит его на 1h таймфрейме')
    expect(marketInfoText({ type: 'impulse-correction', side: 'bearish', timeframe: '4h' })).toBe('Коррекция после дампа на 4h таймфрейме')
  })
})
