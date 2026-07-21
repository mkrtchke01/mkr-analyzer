import { RISK_PER_TRADE_USDT } from './positionSizing'
import { SETUP_META, type SetupType } from './trend'

export type StrategyStatsSignal = {
  setupType: SetupType
  status: 'active' | 'tp1' | 'tp2' | 'tp3' | 'stop' | 'expired' | 'ambiguous'
  tp2Price?: number
  tp3Price?: number
  outcomeR: number | null
}

export type StrategyStats = {
  setupType: SetupType
  total: number
  open: number
  stopped: number
  profitable: number
  pnl: number
}

export function isOpenSignalForStats(signal: Pick<StrategyStatsSignal, 'status' | 'tp2Price' | 'tp3Price'>) {
  return signal.status === 'active'
    || (signal.status === 'tp1' && signal.tp2Price !== undefined)
    || (signal.status === 'tp2' && signal.tp3Price !== undefined)
}

function isProfitClosure(signal: StrategyStatsSignal) {
  return signal.status === 'tp3'
    || (signal.status === 'tp2' && signal.tp3Price === undefined)
    || (signal.status === 'tp1' && signal.tp2Price === undefined)
}

export function calculateStrategyStats(signals: StrategyStatsSignal[]): StrategyStats[] {
  const stats = Object.keys(SETUP_META).map((setupType) => ({
    setupType: setupType as SetupType,
    total: 0,
    open: 0,
    stopped: 0,
    profitable: 0,
    pnl: 0,
  }))
  const bySetupType = new Map(stats.map((item) => [item.setupType, item]))

  signals.forEach((signal) => {
    const item = bySetupType.get(signal.setupType)
    if (!item) return
    item.total += 1
    if (isOpenSignalForStats(signal)) item.open += 1
    if (signal.status === 'stop') item.stopped += 1
    if (isProfitClosure(signal)) item.profitable += 1
    if (!isOpenSignalForStats(signal) && typeof signal.outcomeR === 'number' && Number.isFinite(signal.outcomeR)) item.pnl += signal.outcomeR * RISK_PER_TRADE_USDT
  })

  return stats
}
