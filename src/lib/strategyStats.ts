const RISK_PER_TRADE_USDT = 2
import { getScannerStrategy, SCANNER_STRATEGIES, type ScannerStrategyId, type SetupType } from './trend.js'

export type StrategyStatsSignal = {
  setupType: SetupType
  status: 'active' | 'tp1' | 'tp2' | 'tp3' | 'stop' | 'expired' | 'ambiguous'
  tp2Price?: number
  tp3Price?: number
  outcomeR: number | null
  netPnlUsd?: number | null
}

export type StrategyStats = {
  strategyId: ScannerStrategyId
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
  const stats = SCANNER_STRATEGIES.map((strategy) => ({
    strategyId: strategy.id,
    total: 0,
    open: 0,
    stopped: 0,
    profitable: 0,
    pnl: 0,
  }))
  const byStrategyId = new Map(stats.map((item) => [item.strategyId, item]))

  signals.forEach((signal) => {
    const strategy = getScannerStrategy(signal.setupType)
    if (!strategy) return
    const item = byStrategyId.get(strategy.id)
    if (!item) return
    item.total += 1
    if (isOpenSignalForStats(signal)) item.open += 1
    if (signal.status === 'stop') item.stopped += 1
    if (isProfitClosure(signal)) item.profitable += 1
    if (!isOpenSignalForStats(signal) && typeof signal.outcomeR === 'number' && Number.isFinite(signal.outcomeR)) {
      item.pnl += typeof signal.netPnlUsd === 'number' && Number.isFinite(signal.netPnlUsd)
        ? signal.netPnlUsd
        : signal.outcomeR * RISK_PER_TRADE_USDT
    }
  })

  return stats
}
