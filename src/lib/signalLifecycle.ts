import type { Candle } from './bybit.js'

export type PersistedSignalStatus = 'active' | 'tp1' | 'tp2' | 'tp3' | 'stop' | 'expired' | 'ambiguous'
export type PersistedSignalSide = 'long' | 'short'

export type ManagedSignal = {
  side: PersistedSignalSide
  status: Extract<PersistedSignalStatus, 'active' | 'tp1' | 'tp2'>
  entryPrice: number
  stopPrice: number
  initialStopPrice: number
  tp1Price: number
  tp2Price?: number
  tp3Price?: number
  tp1RiskMultiple: number
  tp2RiskMultiple?: number
}

export type SignalCandleOutcome =
  | { type: 'none' }
  | { type: 'tp1'; nextStopPrice?: number; outcomeR: number }
  | { type: 'tp2'; nextStopPrice?: number; outcomeR: number }
  | { type: 'tp3'; outcomeR: number }
  | { type: 'stop'; outcomeR: number }
  | { type: 'ambiguous' }

function reached(side: PersistedSignalSide, candle: Candle, price: number, kind: 'target' | 'stop') {
  if (side === 'long') return kind === 'target' ? candle.high >= price : candle.low <= price
  return kind === 'target' ? candle.low <= price : candle.high >= price
}

export function evaluateSignalCandle(signal: ManagedSignal, candle: Candle): SignalCandleOutcome {
  const hasTp2 = signal.tp2Price !== undefined && signal.tp2RiskMultiple !== undefined
  const tp2RiskMultiple = signal.tp2RiskMultiple ?? 0
  const hitStop = reached(signal.side, candle, signal.stopPrice, 'stop')
  const hitTp1 = signal.status === 'active' && reached(signal.side, candle, signal.tp1Price, 'target')
  const hitTp2 = hasTp2 && signal.status !== 'tp2' && reached(signal.side, candle, signal.tp2Price!, 'target')
  const hitTp3 = signal.tp3Price !== undefined && reached(signal.side, candle, signal.tp3Price, 'target')
  const tp1Share = !hasTp2 ? 1 : signal.tp3Price === undefined ? 0.5 : 0.34
  const tp2Share = signal.tp3Price === undefined ? 0.5 : 0.33
  const tp3RiskMultiple = signal.tp3Price === undefined ? 0 : Math.abs(signal.tp3Price - signal.entryPrice) / Math.abs(signal.entryPrice - signal.initialStopPrice)
  const priorOutcome = signal.status === 'active' ? 0 : signal.status === 'tp1' ? signal.tp1RiskMultiple * tp1Share : signal.tp1RiskMultiple * tp1Share + tp2RiskMultiple * tp2Share

  if (hitStop && (hitTp1 || hitTp2 || hitTp3)) return { type: 'ambiguous' }
  if (hitTp3) return { type: 'tp3', outcomeR: signal.tp1RiskMultiple * tp1Share + tp2RiskMultiple * tp2Share + tp3RiskMultiple * 0.33 }
  if (hitTp2) {
    const outcomeR = (signal.status === 'active' ? signal.tp1RiskMultiple * tp1Share : priorOutcome) + tp2RiskMultiple * tp2Share
    return signal.tp3Price === undefined ? { type: 'tp2', outcomeR } : { type: 'tp2', nextStopPrice: signal.entryPrice, outcomeR }
  }
  if (hitTp1) return hasTp2
    ? { type: 'tp1', nextStopPrice: signal.entryPrice, outcomeR: signal.tp1RiskMultiple * tp1Share }
    : { type: 'tp1', outcomeR: signal.tp1RiskMultiple }
  if (hitStop) return { type: 'stop', outcomeR: priorOutcome || -1 }
  return { type: 'none' }
}

export function calculateOpenSignalR(signal: Pick<ManagedSignal, 'side' | 'entryPrice' | 'initialStopPrice'>, price: number): number {
  const risk = Math.abs(signal.entryPrice - signal.initialStopPrice)
  if (!risk) return 0
  const move = signal.side === 'long' ? price - signal.entryPrice : signal.entryPrice - price
  return move / risk
}
