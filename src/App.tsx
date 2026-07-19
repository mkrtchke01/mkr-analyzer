import { useCallback, useEffect, useMemo, useState } from 'react'
import PriceChart from './components/PriceChart'
import SignalHistory from './components/SignalHistory'
import TrendPanel from './components/TrendPanel'
import { filterMarketList, formatPrice, getCandles, getMarkets, getNextMarketSymbol, TIMEFRAMES, type Market, type Timeframe } from './lib/bybit'
import { getSavedSignals, type SavedSignal } from './lib/signals'
import { analyzeTrend, calculateTradePlans, getOverallTrend, getSetupSignals, SETUP_META, type SetupSignal, type TradePlan, type TrendAnalysis } from './lib/trend'

const FALLBACK_MARKETS: Market[] = [
  { symbol: 'BTCUSDT', price: 0, change: 0, turnover: 0 },
  { symbol: 'ETHUSDT', price: 0, change: 0, turnover: 0 },
  { symbol: 'SOLUSDT', price: 0, change: 0, turnover: 0 },
]

const ANALYSIS_TIMEFRAMES: Timeframe[] = ['4h', '1h', '15m', '5m']
const SCAN_INTERVAL = 5 * 60_000
const SCAN_CONCURRENCY = 3

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
  const [setupsOnly, setSetupsOnly] = useState(false)
  const [status, setStatus] = useState<'loading' | 'live' | 'offline'>('loading')
  const [currentPrice, setCurrentPrice] = useState(0)
  const [marketsError, setMarketsError] = useState(false)
  const [trendAnalyses, setTrendAnalyses] = useState<TrendAnalysis[]>([])
  const [trendLoading, setTrendLoading] = useState(true)
  const [trendError, setTrendError] = useState(false)
  const [tradePlans, setTradePlans] = useState<TradePlan[]>([])
  const [marketsReady, setMarketsReady] = useState(false)
  const [marketSetups, setMarketSetups] = useState<Record<string, SetupSignal[]>>({})
  const [setupScanning, setSetupScanning] = useState(false)
  const [savedOpenSignals, setSavedOpenSignals] = useState<SavedSignal[]>([])

  useEffect(() => {
    void getMarkets()
      .then((items) => {
        setMarkets(items)
        setMarketsReady(true)
      })
      .catch(() => setMarketsError(true))
  }, [])

  useEffect(() => {
    if (!marketsReady || !markets.length) return

    let disposed = false
    const symbols = markets.map((market) => market.symbol)
    const scanSetups = async () => {
      setSetupScanning(true)
      const found: Record<string, SetupSignal[]> = {}
      let nextIndex = 0
      const scanOne = async () => {
        while (nextIndex < symbols.length) {
          const currentSymbol = symbols[nextIndex]
          nextIndex += 1
          try {
            const candles = await Promise.all(ANALYSIS_TIMEFRAMES.map((item) => getCandles(currentSymbol, item, 120)))
            const analyses = candles.map((items, index) => analyzeTrend(items, ANALYSIS_TIMEFRAMES[index]))
            const setups = getSetupSignals(analyses, candles[3])
            if (setups.length) found[currentSymbol] = setups
          } catch {
            // A single unavailable market must not interrupt the complete scan.
          }
        }
      }

      await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, symbols.length) }, () => scanOne()))
      if (!disposed) {
        setMarketSetups(found)
        setSetupScanning(false)
      }
    }

    void scanSetups()
    const scanId = window.setInterval(() => void scanSetups(), SCAN_INTERVAL)
    return () => {
      disposed = true
      window.clearInterval(scanId)
    }
  }, [markets, marketsReady])

  useEffect(() => {
    let disposed = false
    const loadTrendAnalyses = async () => {
      setTrendLoading(true)
      try {
        const candles = await Promise.all(ANALYSIS_TIMEFRAMES.map((item) => getCandles(symbol, item, 300)))
        if (!disposed) {
          const analyses = candles.map((items, index) => analyzeTrend(items, ANALYSIS_TIMEFRAMES[index]))
          setTrendAnalyses(analyses)
          const nextTradePlans = calculateTradePlans(candles[3], getOverallTrend(analyses))
          setTradePlans(nextTradePlans)
          const setups = getSetupSignals(analyses, candles[3])
          setMarketSetups((previous) => {
            const next = { ...previous }
            if (setups.length) next[symbol] = setups
            else delete next[symbol]
            return next
          })
          setTrendError(false)
        }
      } catch {
        if (!disposed) setTrendError(true)
      } finally {
        if (!disposed) setTrendLoading(false)
      }
    }

    void loadTrendAnalyses()
    const refreshId = window.setInterval(() => void loadTrendAnalyses(), 30_000)
    return () => {
      disposed = true
      window.clearInterval(refreshId)
    }
  }, [symbol])

  useEffect(() => {
    let disposed = false
    const loadSavedSignals = async () => {
      try {
        const items = await getSavedSignals('open')
        if (!disposed) setSavedOpenSignals(items)
      } catch {
        // The feature remains usable before the first database migration is applied.
      }
    }
    void loadSavedSignals()
    const refreshId = window.setInterval(() => void loadSavedSignals(), 30_000)
    return () => {
      disposed = true
      window.clearInterval(refreshId)
    }
  }, [])

  const activeMarketSetups = useMemo(() => {
    const next = { ...marketSetups }
    savedOpenSignals.forEach((signal) => {
      const savedSetup: SetupSignal = { side: signal.side, type: signal.setupType }
      const current = next[signal.symbol] ?? []
      if (!current.some((setup) => setup.side === savedSetup.side && setup.type === savedSetup.type)) next[signal.symbol] = [...current, savedSetup]
    })
    return next
  }, [marketSetups, savedOpenSignals])

  const setupSymbols = useMemo(() => new Set(Object.keys(activeMarketSetups)), [activeMarketSetups])
  const visibleMarkets = useMemo(
    () => filterMarketList(markets, search, setupSymbols, setupsOnly).slice(0, 80),
    [markets, search, setupSymbols, setupsOnly],
  )

  useEffect(() => {
    const selectNextMarket = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return

      const target = event.target as Element | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return

      const nextSymbol = getNextMarketSymbol(visibleMarkets, symbol)
      if (!nextSymbol) return

      event.preventDefault()
      setSymbol(nextSymbol)
    }

    window.addEventListener('keydown', selectNextMarket)
    return () => window.removeEventListener('keydown', selectNextMarket)
  }, [symbol, visibleMarkets])

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
          <PriceChart key={symbol} symbol={symbol} timeframe={timeframe} tradePlans={tradePlans} onStatusChange={handleStatusChange} onPriceChange={handlePriceChange} />
          <footer className="chart-footer">
            <span>Свечи · {timeframe}</span>
            <span>Источник: Bybit public market data</span>
          </footer>
        </section>
        <TrendPanel analyses={trendAnalyses} loading={trendLoading} error={trendError} tradePlans={tradePlans} />
        <SignalHistory openSignals={savedOpenSignals} onSelectSymbol={setSymbol} />
      </section>

      <aside className="markets-panel">
        <header className="markets-header">
          <div>
            <div className="eyebrow">РЫНКИ</div>
            <h1>USDT perpetual</h1>
          </div>
          <div className="market-heading-meta">
            <span className={`scan-status ${setupScanning ? 'scanning' : ''}`}>{setupScanning ? 'SCAN' : `${Object.values(activeMarketSetups).reduce((count, setups) => count + setups.length, 0)} SETUP`}</span>
            <span className="market-count">{markets.length}</span>
          </div>
        </header>
        <label className="search-box">
          <span>⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти монету" aria-label="Найти монету" />
        </label>
        <label className="setups-only-filter">
          <input type="checkbox" checked={setupsOnly} onChange={(event) => setSetupsOnly(event.target.checked)} />
          <span>Только сетапы</span>
          <b>{Object.keys(activeMarketSetups).length}</b>
        </label>
        <div className="list-label"><span>ПАРА</span><span>ЦЕНА / 24Ч</span></div>
        <div className="market-list">
          {visibleMarkets.map((market) => (
            <button className={`market-row ${market.symbol === symbol ? 'selected' : ''} ${activeMarketSetups[market.symbol]?.[0] ? `setup-${activeMarketSetups[market.symbol]![0].side}` : ''}`} key={market.symbol} onClick={() => setSymbol(market.symbol)}>
              <span className="coin-icon">{baseAsset(market.symbol).slice(0, 1)}</span>
              <span className="coin-name"><span className="market-symbol"><b>{baseAsset(market.symbol)}</b>{activeMarketSetups[market.symbol]?.map((setup) => <em key={`${setup.type}-${setup.side}`}>{`${SETUP_META[setup.type].shortName} ${setup.side.toUpperCase()}`}</em>)}</span><small>USDT · PERP</small></span>
              <span className="market-values"><b>{market.price ? formatPrice(market.price) : '—'}</b><small className={market.change >= 0 ? 'positive' : 'negative'}>{market.change >= 0 ? '+' : ''}{market.change.toFixed(2)}%</small></span>
            </button>
          ))}
          {!visibleMarkets.length && <div className="empty-state">{setupsOnly ? 'Открытых сетапов пока нет' : 'Монеты не найдены'}</div>}
        </div>
        <footer className="markets-footer">{marketsError ? 'Не удалось обновить список — показаны популярные пары.' : `Объём 24ч · ${formatTurnover(markets.reduce((sum, market) => sum + market.turnover, 0))}`}</footer>
      </aside>
    </main>
  )
}
