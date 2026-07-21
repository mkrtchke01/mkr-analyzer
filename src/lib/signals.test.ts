import { describe, expect, it } from 'vitest'
import { tradePlanFromSavedSignal, type SavedSignal } from './signals'

const savedSignal: SavedSignal = {
  id: 'signal-1',
  symbol: 'BANKUSDT',
  setupType: 'breakout-retest',
  side: 'long',
  status: 'active',
  detectedAt: '2026-07-20T10:00:00.000Z',
  closedAt: null,
  entryPrice: 100,
  stopPrice: 95,
  initialStopPrice: 95,
  tp1Price: 107.5,
  tp2Price: 115,
  signalStrength: null,
  lastPrice: 103,
  outcomeR: null,
  snapshotUrl: 'https://example.com/signal.svg',
}

describe('fixed signal plan', () => {
  it('keeps the original entry, targets and stop from the saved signal', () => {
    const plan = tradePlanFromSavedSignal(savedSignal)

    expect(plan.entryTime).toBe(Math.floor(new Date(savedSignal.detectedAt).getTime() / 1000))
    expect(plan.stop).toMatchObject({ side: 'long', entry: 100, price: 95 })
    expect(plan.takeProfits).toEqual([
      { id: 'TP1', price: 107.5, share: 50, riskMultiple: 1.5 },
      { id: 'TP2', price: 115, share: 50, riskMultiple: 3 },
    ])
  })
})
