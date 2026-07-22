import { describe, expect, it } from 'vitest'
import { calculateSignalStrength } from './signalStrength'
import type { TradePlan, TrendAnalysis } from './trend'

const plan: TradePlan = {
  setupType: 'trend-reclaim',
  setupName: 'Возврат к тренду',
  setupNote: 'Тест',
  stop: { side: 'long', entry: 100, price: 98, distancePercent: 2, distanceAtr: 0.8, reason: 'Тест' },
  takeProfits: [{ id: 'TP1', price: 106, share: 100, riskMultiple: 6 }],
}

const analysis = (timeframe: TrendAnalysis['timeframe'], direction: TrendAnalysis['direction'], strength: number): TrendAnalysis => ({ timeframe, direction, strength, adx: 30, atr: 1, volumeRatio: 1.2, reasons: [] })

describe('signal strength', () => {
  it('scores a high-R/R trend reclaim aligned across the context timeframes', () => {
    expect(calculateSignalStrength(plan, [analysis('4h', 'bullish', 90), analysis('1h', 'bullish', 90), analysis('15m', 'bullish', 90)]).score).toBe(10)
  })

  it('penalizes a weak setup that conflicts with the higher-timeframe context', () => {
    const weakPlan: TradePlan = { ...plan, stop: { ...plan.stop, distanceAtr: 3 }, takeProfits: [{ id: 'TP1', price: 102, share: 100, riskMultiple: 1.5 }] }
    expect(calculateSignalStrength(weakPlan, [analysis('4h', 'bearish', 20), analysis('1h', 'bearish', 20), analysis('15m', 'flat', 20)]).score).toBeLessThan(5)
  })
})
