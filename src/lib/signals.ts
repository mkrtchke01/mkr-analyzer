export type SignalState = 'open' | 'closed'
export type SignalStatus = 'active' | 'tp1' | 'tp2' | 'tp3' | 'stop' | 'expired' | 'ambiguous'
export type SavedSetupType = 'trend-reclaim' | 'level-breakout' | 'breakout-retest' | 'consensus'
export type SavedSignal = {
  id: string
  symbol: string
  setupType: SavedSetupType
  side: 'long' | 'short'
  status: SignalStatus
  detectedAt: string
  closedAt: string | null
  entryPrice: number
  stopPrice: number
  initialStopPrice: number
  tp1Price: number
  tp2Price: number
  takeProfits?: TradePlan['takeProfits']
  lastPrice: number
  outcomeR: number | null
  snapshotUrl: string | null
}

export function tradePlanFromSavedSignal(signal: SavedSignal): TradePlan {
  const initialRisk = Math.abs(signal.entryPrice - signal.initialStopPrice)
  const riskMultiple = initialRisk ? Math.abs(signal.tp2Price - signal.entryPrice) / initialRisk : 3
  return {
    setupType: signal.setupType,
    setupName: SETUP_META[signal.setupType].name,
    setupNote: 'Сигнал зафиксирован со снимком. Цели не пересчитываются до завершения сделки.',
    stop: {
      side: signal.side,
      entry: signal.entryPrice,
      price: signal.stopPrice,
      distancePercent: signal.entryPrice ? Math.abs(signal.entryPrice - signal.initialStopPrice) / signal.entryPrice * 100 : 0,
      distanceAtr: 0,
      reason: 'Зафиксированный стоп',
    },
    takeProfits: signal.takeProfits ?? [
      { id: 'TP1', price: signal.tp1Price, share: 50, riskMultiple: initialRisk ? Math.abs(signal.tp1Price - signal.entryPrice) / initialRisk : 1.5 },
      { id: 'TP2', price: signal.tp2Price, share: 50, riskMultiple },
    ],
  }
}

export async function getSavedSignals(state: SignalState): Promise<SavedSignal[]> {
  const response = await fetch(`/api/signals?state=${state}`)
  if (!response.ok) throw new Error('Не удалось загрузить историю сигналов')
  const payload = await response.json() as { signals: SavedSignal[] }
  return payload.signals
}
import { SETUP_META, type TradePlan } from './trend'
