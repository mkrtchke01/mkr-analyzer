import { describe, expect, it } from 'vitest'
import { createSignalSnapshot } from './signalSnapshot'
import type { TradePlan } from './trend'

const candles = Array.from({ length: 100 }, (_, index) => ({
  time: 1_710_000_000 + index * 300,
  open: 100 + index * 0.1,
  high: 101 + index * 0.1,
  low: 99 + index * 0.1,
  close: 100.5 + index * 0.1,
  volume: 10,
}))

const plan: TradePlan = {
  setupType: 'trend-reclaim',
  setupName: 'Возврат к тренду',
  setupNote: 'Коррекция остановлена · 1.0 ATR',
  stop: { side: 'long', entry: 110, price: 105 },
  takeProfits: [
    { id: 'TP1', price: 120, share: 50, riskMultiple: 2 },
    { id: 'TP2', price: 125, share: 50, riskMultiple: 3 },
  ],
  chartLevels: [
    { price: 108, label: 'TR ОТКАТ 1h', color: '#f2c15d' },
    { price: 112, label: 'TR ФИБО 0.5 1h', color: '#b991ff' },
  ],
}

describe('signal snapshot', () => {
  it('renders fixed candles and risk levels into an SVG', () => {
    const snapshot = createSignalSnapshot('BTC<USDT', candles, plan, '2026-07-19T12:00:00.000Z')

    expect(snapshot).toContain('<svg')
    expect(snapshot).toContain('BTC&lt;USDT')
    expect(snapshot).toContain('Возврат к тренду')
    expect(snapshot).toContain('STOP')
    expect(snapshot).toContain('TP1')
    expect(snapshot).toContain('TP2')
    expect(snapshot).toContain('TR ОТКАТ 1h')
    expect(snapshot).toContain('TR ФИБО 0.5 1h')
  })
})
