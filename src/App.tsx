import { useCallback, useEffect, useMemo, useState } from 'react'
import PriceChart from './components/PriceChart'
import { formatPrice, getMarkets, TIMEFRAMES, type Market, type Timeframe } from './lib/bybit'

const FALLBACK_MARKETS: Market[] = [
  { symbol: 'BTCUSDT', price: 0, change: 0, turnover: 0 },
  { symbol: 'ETHUSDT', price: 0, change: 0, turnover: 0 },
  { symbol: 'SOLUSDT', price: 0, change: 0, turnover: 0 },
]

function baseAsset(symbol: string) {
  return symbol.replace('USDT', '')
}

function formatTurnover(turnover: number) {
  if (turnover >= 1_000_000_000) return `$${(turnover / 1_000_000_000).toFixed(2)}B`
  if (turnover >= 1_000_000) return `$${(turnover / 1_000_000).toFixed(1)}M`
  return `$${(turnover / 1_000).toFixed(0)}K`
}

export default function App() {
  const [markets, setMarkets] = useState<Market[]>(FALLBACK_MARKETS)
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [timeframe, setTimeframe] = useState<Timeframe>('5m')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'loading' | 'live' | 'offline'>('loading')
  const [currentPrice, setCurrentPrice] = useState(0)
  const [marketsError, setMarketsError] = useState(false)

  useEffect(() => {
    void getMarkets()
      .then((items) => setMarkets(items))
      .catch(() => setMarketsError(true))
  }, [])

  const visibleMarkets = useMemo(() => {
    const query = search.trim().toUpperCase()
    return markets.filter((market) => market.symbol.includes(query)).slice(0, 80)
  }, [markets, search])

  const selectedMarket = markets.find((market) => market.symbol === symbol)
  const change = selectedMarket?.change ?? 0
  const handleStatusChange = useCallback((nextStatus: 'loading' | 'live' | 'offline') => setStatus(nextStatus), [])
  const handlePriceChange = useCallback((price: number) => setCurrentPrice(price), [])

  return (
    <main className="terminal-shell">
      <section className="workspace" aria-label="Терминал анализа рынков">
        <header className="topbar">
          <div className="brand"><span className="brand-mark">M</span> MKR <span>ANALYZER</span></div>
          <div className="market-mode"><span className="live-dot" /> PERPETUAL · BYBIT</div>
          <div className="timeframe-selector" aria-label="Таймфрейм графика">
            {Object.keys(TIMEFRAMES).map((item) => {
              const value = item as Timeframe
              return <button className={timeframe === value ? 'active' : ''} key={value} onClick={() => setTimeframe(value)}>{value}</button>
            })}
          </div>
        </header>

        <section className="chart-panel">
          <div className="chart-heading">
            <div>
              <div className="eyebrow">{baseAsset(symbol)} / USDT · PERPETUAL</div>
              <div className="price-row">
                <strong>{currentPrice ? formatPrice(currentPrice) : '—'}</strong>
                <span className={change >= 0 ? 'positive' : 'negative'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</span>
              </div>
            </div>
            <div className={`connection ${status}`}>
              <i /> {status === 'live' ? 'Поток данных' : status === 'loading' ? 'Загрузка' : 'Переподключение'}
            </div>
          </div>
          <PriceChart key={symbol} symbol={symbol} timeframe={timeframe} onStatusChange={handleStatusChange} onPriceChange={handlePriceChange} />
          <footer className="chart-footer">
            <span>Свечи · {timeframe}</span>
            <span>Источник: Bybit public market data</span>
          </footer>
        </section>
      </section>

      <aside className="markets-panel">
        <header className="markets-header">
          <div>
            <div className="eyebrow">РЫНКИ</div>
            <h1>USDT perpetual</h1>
          </div>
          <span className="market-count">{markets.length}</span>
        </header>
        <label className="search-box">
          <span>⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти монету" aria-label="Найти монету" />
        </label>
        <div className="list-label"><span>ПАРА</span><span>ЦЕНА / 24Ч</span></div>
        <div className="market-list">
          {visibleMarkets.map((market) => (
            <button className={`market-row ${market.symbol === symbol ? 'selected' : ''}`} key={market.symbol} onClick={() => setSymbol(market.symbol)}>
              <span className="coin-icon">{baseAsset(market.symbol).slice(0, 1)}</span>
              <span className="coin-name"><b>{baseAsset(market.symbol)}</b><small>USDT · PERP</small></span>
              <span className="market-values"><b>{market.price ? formatPrice(market.price) : '—'}</b><small className={market.change >= 0 ? 'positive' : 'negative'}>{market.change >= 0 ? '+' : ''}{market.change.toFixed(2)}%</small></span>
            </button>
          ))}
          {!visibleMarkets.length && <div className="empty-state">Монеты не найдены</div>}
        </div>
        <footer className="markets-footer">{marketsError ? 'Не удалось обновить список — показаны популярные пары.' : `Объём 24ч · ${formatTurnover(markets.reduce((sum, market) => sum + market.turnover, 0))}`}</footer>
      </aside>
    </main>
  )
}
