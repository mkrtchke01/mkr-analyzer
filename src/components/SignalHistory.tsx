import { useEffect, useState } from 'react'
import { formatPrice } from '../lib/bybit'
import { getSavedSignals, type SavedSignal, type SignalState } from '../lib/signals'
import { SETUP_META } from '../lib/trend'

type SignalHistoryProps = {
  openSignals: SavedSignal[]
  onClose: () => void
  onSelectSymbol: (symbol: string) => void
}

const statusText: Record<SavedSignal['status'], string> = {
  active: 'АКТИВЕН',
  tp1: 'TP1 · Б/У',
  tp2: 'TP2',
  stop: 'STOP',
  expired: 'ИСТЁК',
  ambiguous: 'НЕОДНОЗНАЧНО',
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

export default function SignalHistory({ openSignals, onClose, onSelectSymbol }: SignalHistoryProps) {
  const [state, setState] = useState<SignalState>('open')
  const [closedSignals, setClosedSignals] = useState<SavedSignal[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<SavedSignal | null>(null)
  const signals = state === 'open' ? openSignals : closedSignals

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

  const switchState = (next: SignalState) => {
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
          </div>
          <button className="signal-history-close" onClick={onClose} aria-label="Закрыть историю">×</button>
        </div>
      </header>
      <p className="signal-history-note">Снимок фиксирует свечи и уровни на момент подтверждения сетапа. Дальше сигнал не исчезает, а получает итоговый статус.</p>
      <div className="signal-list">
        {signals.map((signal) => <button key={signal.id} className={`signal-card ${signal.side} ${selected?.id === signal.id ? 'selected' : ''}`} onClick={() => { setSelected(signal); onSelectSymbol(signal.symbol) }}>
          <span className="signal-card-main"><b>{signal.symbol.replace('USDT', '')} · {signal.side.toUpperCase()}</b><small>{SETUP_META[signal.setupType].shortName} · {SETUP_META[signal.setupType].name} · {formatTimestamp(signal.detectedAt)}</small></span>
          <span className={`signal-status-badge ${signal.status}`}>{statusText[signal.status]}</span>
          <span className="signal-card-price">Вход {formatPrice(signal.entryPrice)}<small>Стоп {formatPrice(signal.initialStopPrice)} · TP2 {formatPrice(signal.tp2Price)}</small></span>
          <span className={signal.outcomeR === null ? 'signal-r' : signal.outcomeR >= 0 ? 'signal-r positive' : 'signal-r negative'}>{signal.outcomeR === null ? '—' : `${signal.outcomeR >= 0 ? '+' : ''}${signal.outcomeR.toFixed(2)}R`}</span>
        </button>)}
        {!signals.length && <div className="signal-empty">{loading ? 'Загружаем историю…' : state === 'open' ? 'Открытых зафиксированных сигналов пока нет' : 'Закрытых сигналов пока нет'}</div>}
      </div>
      {selected && <article className="signal-snapshot">
        <header><div><span className="eyebrow">FIXED SNAPSHOT</span><strong>{selected.symbol} · {SETUP_META[selected.setupType].name} · {selected.side.toUpperCase()} · {formatTimestamp(selected.detectedAt)}</strong></div><button onClick={() => setSelected(null)} aria-label="Закрыть снимок">×</button></header>
        {selected.snapshotUrl ? <img src={selected.snapshotUrl} alt={`Снимок сетапа ${selected.symbol}`} /> : <p>Снимок ещё сохраняется. Повторите позже.</p>}
      </article>}
    </section>
  )
}
