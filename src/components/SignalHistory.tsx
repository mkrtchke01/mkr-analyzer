import { useEffect, useMemo, useState } from 'react'
import { formatPrice } from '../lib/bybit'
import { getSavedSignals, getStrategyStats, type SavedSignal, type SignalState } from '../lib/signals'
import { calculatePnlUsd } from '../lib/positionSizing'
import { SCANNER_STRATEGIES, SETUP_META } from '../lib/trend'
import SetupStrength from './SetupStrength'
import type { StrategyStats } from '../lib/strategyStats'

type SignalHistoryProps = {
  openSignals: SavedSignal[]
  onClose: () => void
  onSelectSymbol: (symbol: string) => void
}

const statusText: Record<SavedSignal['status'], string> = {
  active: 'АКТИВЕН',
  tp1: 'TP1 · Б/У',
  tp2: 'TP2',
  tp3: 'TP3',
  stop: 'STOP',
  expired: 'ИСТЁК',
  ambiguous: 'НЕОДНОЗНАЧНО',
}

type HistoryTab = SignalState | 'statistics'
type StrengthSort = 'none' | 'asc' | 'desc'

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function formatPnlUsd(signal: SavedSignal) {
  const { outcomeR } = signal
  if (outcomeR === null) return '—'
  const pnl = signal.netPnlUsd ?? calculatePnlUsd(outcomeR)
  return `${pnl < 0 ? '-' : '+'}$${Math.abs(pnl).toFixed(2)}`
}

export default function SignalHistory({ openSignals, onClose, onSelectSymbol }: SignalHistoryProps) {
  const [state, setState] = useState<HistoryTab>('open')
  const [closedSignals, setClosedSignals] = useState<SavedSignal[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<SavedSignal | null>(null)
  const [strategyStats, setStrategyStats] = useState<StrategyStats[]>([])
  const [strengthSort, setStrengthSort] = useState<StrengthSort>('none')
  const signals = useMemo(() => {
    const source = state === 'open' ? openSignals : closedSignals
    if (strengthSort === 'none') return source

    return [...source].sort((left, right) => {
      if (left.signalStrength === null) return right.signalStrength === null ? 0 : 1
      if (right.signalStrength === null) return -1
      return strengthSort === 'desc' ? right.signalStrength - left.signalStrength : left.signalStrength - right.signalStrength
    })
  }, [closedSignals, openSignals, state, strengthSort])

  useEffect(() => {
    if (state !== 'closed') return
    let disposed = false
    setLoading(true)
    void getSavedSignals('closed')
      .then((items) => { if (!disposed) setClosedSignals(items) })
      .catch(() => { if (!disposed) setClosedSignals([]) })
      .finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [state])

  useEffect(() => {
    if (state !== 'statistics') return
    let disposed = false
    const loadStats = () => void getStrategyStats().then((items) => { if (!disposed) setStrategyStats(items) }).catch(() => { if (!disposed) setStrategyStats([]) })
    loadStats()
    const refreshId = window.setInterval(loadStats, 5_000)
    return () => {
      disposed = true
      window.clearInterval(refreshId)
    }
  }, [state])

  const switchState = (next: HistoryTab) => {
    setState(next)
    setSelected(null)
  }

  return (
    <section className="signal-history" aria-label="История торговых сигналов">
      <header className="signal-history-heading">
        <div><div className="eyebrow">SIGNAL JOURNAL · ВСЕ ИНСТРУМЕНТЫ</div><h2>История сигналов</h2></div>
        <div className="signal-history-actions">
          <div className="signal-tabs">
            <button className={state === 'open' ? 'active' : ''} onClick={() => switchState('open')}>Открытые <b>{openSignals.length}</b></button>
            <button className={state === 'closed' ? 'active' : ''} onClick={() => switchState('closed')}>Закрытые</button>
            <button className={state === 'statistics' ? 'active' : ''} onClick={() => switchState('statistics')}>Статистика</button>
            {state !== 'statistics' && <button className={strengthSort !== 'none' ? 'active' : ''} onClick={() => setStrengthSort((current) => current === 'none' ? 'desc' : current === 'desc' ? 'asc' : 'none')}>Сила <b>{strengthSort === 'desc' ? '↓' : strengthSort === 'asc' ? '↑' : '↕'}</b></button>}
          </div>
          <button className="signal-history-close" onClick={onClose} aria-label="Закрыть историю">×</button>
        </div>
      </header>
      <p className="signal-history-note">Снимок фиксирует свечи и уровни на момент подтверждения сетапа. Дальше сигнал не исчезает, а получает итоговый статус.</p>
      {state === 'statistics' && <section className="strategy-statistics" aria-label="Статистика стратегий">
        <div className="strategy-statistics-heading"><span>СТРАТЕГИЯ</span><span>ВСЕГО</span><span>ОТКР.</span><span>СТОП</span><span>ПРОФИТ</span><span>PNL</span></div>
        {strategyStats.map((stat) => {
          const strategy = SCANNER_STRATEGIES.find((item) => item.id === stat.strategyId)!
          return <div className="strategy-statistics-row" key={stat.strategyId}>
          <span><b>{strategy.shortName}</b>{strategy.name}</span>
          <span>{stat.total}</span>
          <span>{stat.open}</span>
          <span className={stat.stopped ? 'negative' : ''}>{stat.stopped}</span>
          <span className={stat.profitable ? 'positive' : ''}>{stat.profitable}</span>
          <strong className={stat.pnl > 0 ? 'positive' : stat.pnl < 0 ? 'negative' : ''}>{stat.pnl >= 0 ? '+' : ''}${stat.pnl.toFixed(2)}</strong>
        </div>})}
        {!strategyStats.length && <div className="strategy-statistics-empty">Загружаем статистику…</div>}
      </section>}
      {state !== 'statistics' && <div className="signal-list">
        {signals.map((signal) => <button key={signal.id} className={`signal-card ${signal.side} ${selected?.id === signal.id ? 'selected' : ''}`} onClick={() => { setSelected(signal); onSelectSymbol(signal.symbol) }}>
          <span className="signal-card-main"><b>{signal.symbol.replace('USDT', '')} · {signal.side.toUpperCase()}</b><small>{SETUP_META[signal.setupType].shortName} · {SETUP_META[signal.setupType].name} · {formatTimestamp(signal.detectedAt)}</small></span>
          <span className={`signal-status-badge ${signal.status}`}>{statusText[signal.status]}</span>
          <SetupStrength score={signal.signalStrength} />
          <span className="signal-card-price">Вход {formatPrice(signal.entryPrice)}<small>Стоп {formatPrice(signal.initialStopPrice)} · {signal.tp2Price === undefined ? 'TP1 — финальная цель' : `TP2 ${formatPrice(signal.tp2Price)}`}</small></span>
          <span className={signal.outcomeR === null ? 'signal-r' : (signal.netPnlUsd ?? calculatePnlUsd(signal.outcomeR)) >= 0 ? 'signal-r positive' : 'signal-r negative'}>{formatPnlUsd(signal)}{signal.feeUsd !== null && <small>ком. −${signal.feeUsd.toFixed(2)}</small>}</span>
        </button>)}
        {!signals.length && <div className="signal-empty">{loading ? 'Загружаем историю…' : state === 'open' ? 'Открытых зафиксированных сигналов пока нет' : 'Закрытых сигналов пока нет'}</div>}
      </div>}
      {selected && <article className="signal-snapshot">
        <header><div><span className="eyebrow">FIXED SNAPSHOT</span><strong>{selected.symbol} · {SETUP_META[selected.setupType].name} · {selected.side.toUpperCase()} · {formatTimestamp(selected.detectedAt)}</strong></div><button onClick={() => setSelected(null)} aria-label="Закрыть снимок">×</button></header>
        {selected.snapshotUrl ? <img src={selected.snapshotUrl} alt={`Снимок сетапа ${selected.symbol}`} /> : <p>Снимок ещё сохраняется. Повторите позже.</p>}
      </article>}
    </section>
  )
}
