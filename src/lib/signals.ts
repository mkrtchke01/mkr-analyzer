export type SignalState = 'open' | 'closed'
export type SignalStatus = 'active' | 'tp1' | 'tp2' | 'stop' | 'expired' | 'ambiguous'
export type SavedSignal = {
  id: string
  symbol: string
  side: 'long' | 'short'
  status: SignalStatus
  detectedAt: string
  closedAt: string | null
  entryPrice: number
  stopPrice: number
  initialStopPrice: number
  tp1Price: number
  tp2Price: number
  lastPrice: number
  outcomeR: number | null
  snapshotUrl: string | null
}

export async function getSavedSignals(state: SignalState): Promise<SavedSignal[]> {
  const response = await fetch(`/api/signals?state=${state}`)
  if (!response.ok) throw new Error('Не удалось загрузить историю сигналов')
  const payload = await response.json() as { signals: SavedSignal[] }
  return payload.signals
}
