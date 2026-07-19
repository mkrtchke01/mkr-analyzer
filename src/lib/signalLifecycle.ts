import type { Candle } from './bybit'

export type PersistedSignalStatus = 'active' | 'tp1' | 'tp2' | 'stop' | 'expired' | 'ambiguous'
export type PersistedSignalSide = 'long' | 'short'

export type ManagedSignal = {
  side: PersistedSignalSide
  status: Extract<PersistedSignalStatus, 'active' | 'tp1'>
  entryPrice: number
  stopPrice: number
  initialStopPrice: number
  tp1Price: number
  tp2Price: number
  tp1RiskMultiple: number
}

export type SignalCandleOutcome =
  | { type: 'none' }
  | { type: 'tp1'; nextStopPrice: number; outcomeR: number }
  | { type: 'tp2'; outcomeR: number }
  | { type: 'stop'; outcomeR: number }
  | { type: 'ambiguous' }

function reached(side: PersistedSignalSide, candle: Candle, price: number, kind: 'target' | 'stop') {
  if (side === 'long') return kind === 'target' ? candle.high >= price : candle.low <= price
  return kind === 'target' ? candle.low <= price : candle.high >= price
}

export function evaluateSignalCandle(signal: ManagedSignal, candle: Candle): SignalCandleOutcome {
  const hitStop = reached(signal.side, candle, signal.stopPrice, 'stop')
  const hitTp1 = signal.status === 'active' && reached(signal.side, candle, signal.tp1Price, 'target')
  const hitTp2 = reached(signal.side, candle, signal.tp2Price, 'target')

  if (hitStop && (hitTp1 || hitTp2)) return { type: 'ambiguous' }
  if (hitTp2) return { type: 'tp2', outcomeR: signal.tp1RiskMultiple * 0.5 + 1.5 }
  if (hitTp1) return { type: 'tp1', nextStopPrice: signal.entryPrice, outcomeR: signal.tp1RiskMultiple * 0.5 }
  if (hitStop) return { type: 'stop', outcomeR: signal.status === 'tp1' ? signal.tp1RiskMultiple * 0.5 : -1 }
  return { type: 'none' }
}

export function calculateOpenSignalR(signal: Pick<ManagedSignal, 'side' | 'entryPrice' | 'initialStopPrice'>, price: number): number {
  const risk = Math.abs(signal.entryPrice - signal.initialStopPrice)
  if (!risk) return 0
  const move = signal.side === 'long' ? price - signal.entryPrice : signal.entryPrice - price
  return move / risk
}
