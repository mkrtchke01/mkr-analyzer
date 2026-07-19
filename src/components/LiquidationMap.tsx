import { useEffect, useMemo, useState } from 'react'
import { createLiquidationLevels, formatUsd, toLiquidationEvent, type LiquidationEvent } from '../lib/liquidations'

type LiquidationMapProps = {
  symbol: string
  currentPrice: number
}

const WINDOW_MS = 60 * 60_000
const MAX_EVENTS = 160

export default function LiquidationMap({ symbol, currentPrice }: LiquidationMapProps) {
  const [events, setEvents] = useState<LiquidationEvent[]>([])
  const [status, setStatus] = useState<'loading' | 'live' | 'offline'>('loading')

  useEffect(() => {
    let socket: WebSocket | undefined
    let disposed = false
    let retryId: number | undefined

    const connect = () => {
      setStatus('loading')
      socket = new WebSocket('wss://stream.bybit.com/v5/public/linear')
      const topic = `allLiquidation.${symbol}`
      socket.onopen = () => socket?.send(JSON.stringify({ op: 'subscribe', args: [topic] }))
      socket.onmessage = (message) => {
        const payload = JSON.parse(message.data) as { topic?: string; data?: Array<{ T: number; s: string; S: 'Buy' | 'Sell'; v: string; p: string }> }
        if (payload.topic !== topic || !payload.data) return
        const received = payload.data.map(toLiquidationEvent).filter((event): event is LiquidationEvent => Boolean(event))
        if (!received.length) return
        setEvents((previous) => {
          const cutoff = Date.now() - WINDOW_MS
          const unique = new Map([...received, ...previous].filter((event) => event.time >= cutoff).map((event) => [event.id, event]))
          return [...unique.values()].sort((left, right) => right.time - left.time).slice(0, MAX_EVENTS)
        })
        setStatus('live')
      }
      socket.onerror = () => setStatus('offline')
      socket.onclose = () => {
        if (!disposed) {
          setStatus('offline')
          retryId = window.setTimeout(connect, 3000)
        }
      }
    }

    setEvents([])
    connect()
    return () => {
      disposed = true
      if (retryId) window.clearTimeout(retryId)
      socket?.close()
    }
  }, [symbol])

  const levels = useMemo(() => createLiquidationLevels(events, currentPrice), [events, currentPrice])
  const maxValue = Math.max(...levels.map((level) => level.longUsd + level.shortUsd), 1)
  const totalLong = events.filter((event) => event.side === 'long').reduce((sum, event) => sum + event.valueUsd, 0)
  const totalShort = events.filter((event) => event.side === 'short').reduce((sum, event) => sum + event.valueUsd, 0)

  return (
    <section className="liquidation-map" aria-label="Карта ликвидаций Bybit">
      <header className="liquidation-heading">
        <div><div className="eyebrow">BYBIT PUBLIC STREAM</div><h2>Карта ликвидаций</h2></div>
        <span className={`liquidation-connection ${status}`}><i /> {status === 'live' ? 'Поток ликвидаций' : status === 'loading' ? 'Подключение' : 'Переподключение'}</span>
      </header>
      <div className="liquidation-summary"><span className="liquidated-long">LONG ликвидации {formatUsd(totalLong)}</span><span className="liquidated-short">SHORT ликвидации {formatUsd(totalShort)}</span><small>За последний час · {events.length} событий</small></div>
      <div className="liquidation-levels">
        {levels.map((level) => {
          const total = level.longUsd + level.shortUsd
          const longWidth = `${(level.longUsd / maxValue) * 100}%`
          const shortWidth = `${(level.shortUsd / maxValue) * 100}%`
          const above = currentPrice ? level.price >= currentPrice : false
          return <div className="liquidation-level" key={level.price}>
            <span className={above ? 'above' : 'below'}>{level.price.toLocaleString('en-US', { maximumFractionDigits: 6 })}</span>
            <div className="liquidation-bars"><i className="liquidation-long-bar" style={{ width: longWidth }} /><i className="liquidation-short-bar" style={{ width: shortWidth }} /></div>
            <b>{formatUsd(total)}</b>
          </div>
        })}
        {!levels.length && <div className="liquidation-empty">Ожидаем фактические ликвидации {symbol} от Bybit. Карта заполнится по мере поступления событий.</div>}
      </div>
      <footer>Красный — ликвидации LONG, зелёный — ликвидации SHORT. Уровни строятся по цене банкротства из публичного потока Bybit.</footer>
    </section>
  )
}
