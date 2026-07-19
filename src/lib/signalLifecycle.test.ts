import { describe, expect, it } from 'vitest'
import { calculateOpenSignalR, evaluateSignalCandle, type ManagedSignal } from './signalLifecycle'

const signal: ManagedSignal = {
  side: 'long', status: 'active', entryPrice: 100, initialStopPrice: 95, stopPrice: 95, tp1Price: 110, tp2Price: 115, tp1RiskMultiple: 2,
}

describe('signal lifecycle', () => {
  it('moves the remaining position to breakeven after TP1', () => {
    expect(evaluateSignalCandle(signal, { time: 1, open: 101, high: 111, low: 100, close: 110, volume: 1 })).toEqual({ type: 'tp1', nextStopPrice: 100, outcomeR: 1 })
  })

  it('does not invent an outcome when the same candle touches stop and target', () => {
    expect(evaluateSignalCandle(signal, { time: 1, open: 100, high: 111, low: 94, close: 102, volume: 1 })).toEqual({ type: 'ambiguous' })
  })

  it('calculates open result in risk units', () => {
    expect(calculateOpenSignalR(signal, 107.5)).toBe(1.5)
  })
})
